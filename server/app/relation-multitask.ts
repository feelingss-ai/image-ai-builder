import { tf } from 'tensorflow-helpers'
import { layers } from '@tensorflow/tfjs-layers'
import type { Dense } from '@tensorflow/tfjs-layers/dist/layers/core'
import type * as tfjs from '@tensorflow/tfjs'
import { EMBEDDING_DIMS, getProjectVectorCache } from './embedding.js'
import {
  createRelationModel,
  createRelationClassifierModel,
  copyProjectorWeights,
  saveRelationModel,
  loadRelationModel,
  normalizeVector,
  RELATION_LABELS,
  type RelationModelBundle,
} from './relation-model.js'
import {
  buildConstraints,
  splitBySession,
  type RankingConstraint,
} from './relation-training.js'
import { loadTriplets, type TripletAnnotation } from './relation-triplet.js'

/**
 * Multi-task training: the pair ranking head and the triplet relation
 * head share one projector.
 *
 * The two tasks are complementary:
 * - the ranking head learns "which pair of images is more similar"
 * - the relation head learns "which two of three images form the
 *   closest pair" (and "are all three equally similar")
 *
 * Because both heads read the same projected space, training them
 * together lets the projector learn a representation that satisfies
 * both. The triplet annotations in particular carry information the
 * pair ranking cannot: "all three are equally similar" says something
 * about the absolute similarity level, while a ranking constraint only
 * compares two pairs.
 *
 * The loss is:
 *
 *   L = L_rank + lambda * L_class + l2 * ||W||^2
 */

export type MultiTaskTrainingOptions = {
  project_id: number
  projDims?: number
  learningRate?: number
  epochs?: number
  batchSize?: number
  margin?: number
  /** weight of the classification loss relative to the ranking loss */
  classificationWeight?: number
  l2?: number
  /** stop after this many epochs without validation improvement */
  patience?: number
  /** use the triplet annotations; when false only the ranking is trained */
  useTriplets?: boolean
  onProgress?: (epoch: number, loss: number) => void
  onValidation?: (
    epoch: number,
    rankingAccuracy: number,
    classificationAccuracy: number | null,
  ) => void
}

export type MultiTaskTrainingResult = {
  bundle: RelationModelBundle
  loss: number
  epochs: number
  bestEpoch: number
  rankingAccuracy: number | null
  classificationAccuracy: number | null
  constraintCount: number
  tripletCount: number
}

/**
 * The three pairwise similarities of a triplet, in the order the
 * relation head expects them: (a,b), (a,c), (b,c).
 */
function tripletFeatures(
  projector: Dense,
  a: tfjs.Tensor2D,
  b: tfjs.Tensor2D,
  c: tfjs.Tensor2D,
): tfjs.Tensor {
  let projA = projector.apply(a) as tfjs.Tensor
  let projB = projector.apply(b) as tfjs.Tensor
  let projC = projector.apply(c) as tfjs.Tensor
  let dotAB = layers.dot({ axes: 1 }).apply([projA, projB]) as tfjs.Tensor
  let dotAC = layers.dot({ axes: 1 }).apply([projA, projC]) as tfjs.Tensor
  let dotBC = layers.dot({ axes: 1 }).apply([projB, projC]) as tfjs.Tensor
  return tf.concat(
    [dotAB, dotAC, dotBC].map(t => tf.reshape(t, [-1, 1])),
    -1,
  )
}

/**
 * Train the pair ranking head and the triplet relation head together.
 *
 * Returns null when there is not enough feedback for the ranking head
 * (the triplet head alone cannot train a projector reliably).
 */
export async function trainMultiTaskModel(
  options: MultiTaskTrainingOptions,
): Promise<MultiTaskTrainingResult | null> {
  let {
    project_id,
    projDims = 64,
    learningRate = 0.005,
    epochs = 30,
    batchSize = 32,
    margin = 1.0,
    classificationWeight = 0.5,
    l2 = 1e-3,
    patience = 5,
    useTriplets = true,
    onProgress,
    onValidation,
  } = options

  let allConstraints = buildConstraints({ project_id }).constraints
  if (allConstraints.length < 4) return null

  // map image ids to their index in the project's embedding matrix
  let cache = getProjectVectorCache(project_id)
  let indexOf = new Map<number, number>()
  cache.image_ids.forEach((image_id, index) => indexOf.set(image_id, index))
  let getVector = (image_id: number) =>
    cache.vectors[indexOf.get(image_id)!]!

  let usableConstraints = allConstraints.filter(
    constraint =>
      indexOf.has(constraint.winner.a) &&
      indexOf.has(constraint.winner.b) &&
      indexOf.has(constraint.loser.a) &&
      indexOf.has(constraint.loser.b),
  )
  if (usableConstraints.length < 4) return null

  // hold out the newest session(s) for validation
  let split = splitBySession(usableConstraints, 0.2)
  let trainConstraints = split.train
  let validationConstraints = split.val
  if (validationConstraints.length < 1) validationConstraints = []

  // the triplet annotations (optional second task)
  let allTriplets = useTriplets ? loadTriplets(project_id) : []
  let usableTriplets = allTriplets.filter(
    triplet =>
      indexOf.has(triplet.image_a_id) &&
      indexOf.has(triplet.image_b_id) &&
      indexOf.has(triplet.image_c_id),
  )

  // ------------------------------------------------------------------
  // build the two heads on ONE shared projector
  // ------------------------------------------------------------------
  let pairBundle = createRelationModel({
    inputDims: EMBEDDING_DIMS,
    projDims,
    headUnits: 1,
  })
  let relation = createRelationClassifierModel({
    inputDims: EMBEDDING_DIMS,
    projDims,
    // reuse the pair model's projector: the two heads then read the
    // same feature space and are trained together
    projector: pairBundle.projector,
  })

  // seed the shared projector from the saved pair model when one
  // exists, so a fresh run starts from the already learned space
  // instead of a random projection
  await loadSavedProjectorWeights(project_id, pairBundle)

  let { projector, scorer } = pairBundle
  let { relationHead } = relation

  // Each task gets its own optimizer. A single optimizer shared by two
  // minimize() calls mixes up the variable lists: the second call
  // would assign its gradients to the first call's variables (the
  // scorer has a [1, 1] kernel, the relation head a [3, 4] one, so
  // the shapes clash). Two optimizers keep the tasks apart while both
  // still update the shared projector.
  let rankingOptimizer = tf.train.adam(learningRate)
  let classificationOptimizer = tf.train.adam(learningRate)
  let lastLoss = 0

  let bestCombined = -1
  let bestRanking = -1
  let bestClassification = -1
  let bestEpoch = 0
  let bestWeights: { kernel: Float32Array; bias: Float32Array } | null = null
  let epochsWithoutImprovement = 0

  for (let epoch = 0; epoch < epochs; epoch++) {
    shuffleInPlace(trainConstraints)
    shuffleInPlace(usableTriplets)

    let epochLoss = 0
    let batches = 0

    // ---- the ranking task ----
    for (let start = 0; start < trainConstraints.length; start += batchSize) {
      let batch = trainConstraints.slice(start, start + batchSize)
      if (batch.length === 0) continue

      let lossTensor = rankingOptimizer.minimize(
        () => {
          return tf.tidy(() => {
            let winnerA = tf.tensor2d(
              batch.map(c => Array.from(normalizeVector(getVector(c.winner.a)))),
              [batch.length, EMBEDDING_DIMS],
            )
            let winnerB = tf.tensor2d(
              batch.map(c => Array.from(normalizeVector(getVector(c.winner.b)))),
              [batch.length, EMBEDDING_DIMS],
            )
            let loserA = tf.tensor2d(
              batch.map(c => Array.from(normalizeVector(getVector(c.loser.a)))),
              [batch.length, EMBEDDING_DIMS],
            )
            let loserB = tf.tensor2d(
              batch.map(c => Array.from(normalizeVector(getVector(c.loser.b)))),
              [batch.length, EMBEDDING_DIMS],
            )

            let projWinnerA = projector.apply(winnerA) as tfjs.Tensor
            let projWinnerB = projector.apply(winnerB) as tfjs.Tensor
            let projLoserA = projector.apply(loserA) as tfjs.Tensor
            let projLoserB = projector.apply(loserB) as tfjs.Tensor

            let sWinner = scorer.apply(
              layers
                .dot({ axes: 1 })
                .apply([projWinnerA, projWinnerB]) as tfjs.Tensor,
            ) as tfjs.Tensor
            let sLoser = scorer.apply(
              layers
                .dot({ axes: 1 })
                .apply([projLoserA, projLoserB]) as tfjs.Tensor,
            ) as tfjs.Tensor

            let loss = tf.maximum(
              tf.scalar(0),
              tf.scalar(margin).sub(sWinner.sub(sLoser)),
            ).mean()

            // L2 regularisation on the projector kernel
            let kernel = projector.trainableWeights[0]!.read()
            return loss.add(kernel.square().sum().mul(l2)) as tfjs.Scalar
          })
        },
        true,
      ) as unknown as tfjs.Scalar

      epochLoss += lossTensor.dataSync()[0]!
      lossTensor.dispose()
      batches++
    }

    // ---- the classification task ----
    // It runs as its own loop so the two tasks do not fight over the
    // projector: mixing them inside a single batch made the (much
    // larger) triplet set drown out the ranking signal.
    if (usableTriplets.length > 0 && classificationWeight > 0) {
      for (let start = 0; start < usableTriplets.length; start += batchSize) {
        let batch = usableTriplets.slice(start, start + batchSize)
        if (batch.length === 0) continue

        let lossTensor = classificationOptimizer.minimize(
          () => {
            return tf.tidy(() => {
              let tA = tf.tensor2d(
                batch.map(t =>
                  Array.from(normalizeVector(getVector(t.image_a_id))),
                ),
                [batch.length, EMBEDDING_DIMS],
              )
              let tB = tf.tensor2d(
                batch.map(t =>
                  Array.from(normalizeVector(getVector(t.image_b_id))),
                ),
                [batch.length, EMBEDDING_DIMS],
              )
              let tC = tf.tensor2d(
                batch.map(t =>
                  Array.from(normalizeVector(getVector(t.image_c_id))),
                ),
                [batch.length, EMBEDDING_DIMS],
              )
              let features = tripletFeatures(projector, tA, tB, tC)
              let probabilities = relationHead.apply(features) as tfjs.Tensor
              let labels = tf.oneHot(
                batch.map(t => t.relation),
                RELATION_LABELS.length,
              ) as tfjs.Tensor
              let classLoss = tf.losses
                .logLoss(probabilities, labels)
                .mean()
              let kernel = projector.trainableWeights[0]!.read()
              return classLoss
                .mul(classificationWeight)
                .add(kernel.square().sum().mul(l2)) as tfjs.Scalar
            })
          },
          true,
        ) as unknown as tfjs.Scalar

        epochLoss += lossTensor.dataSync()[0]!
        lossTensor.dispose()
        batches++
      }
    }

    lastLoss = epochLoss / Math.max(batches, 1)
    onProgress?.(epoch + 1, lastLoss)

    // ---- validation ----
    if (validationConstraints.length > 0) {
      let rankingAccuracy = evaluateRankingAccuracy(
        pairBundle,
        validationConstraints,
        getVector,
      )
      let classificationAccuracy =
        usableTriplets.length > 0
          ? evaluateClassificationAccuracy(
              { projector, relationHead },
              usableTriplets,
              getVector,
            )
          : null
      onValidation?.(epoch + 1, rankingAccuracy, classificationAccuracy)

      // the combined score decides which epoch is kept: the ranking
      // accuracy first, the classification accuracy as the tie-breaker
      let combined =
        rankingAccuracy +
        (classificationAccuracy == null ? 0 : classificationAccuracy) * 0.5
      if (combined > bestCombined) {
        bestCombined = combined
        bestRanking = rankingAccuracy
        bestClassification = classificationAccuracy ?? -1
        bestEpoch = epoch + 1
        bestWeights = {
          kernel: Float32Array.from(
            projector.trainableWeights[0]!.read().dataSync(),
          ),
          bias: Float32Array.from(
            projector.trainableWeights[1]!.read().dataSync(),
          ),
        }
        epochsWithoutImprovement = 0
      } else {
        epochsWithoutImprovement++
        if (epochsWithoutImprovement >= patience) break
      }
    }
  }

  // restore the best weights
  if (bestWeights) {
    let kernelVariable = projector.trainableWeights[0]!
    let biasVariable = projector.trainableWeights[1]!
    kernelVariable.write(
      tf.tensor2d(bestWeights.kernel, [
        kernelVariable.shape[0]!,
        kernelVariable.shape[1]!,
      ]),
    )
    biasVariable.write(tf.tensor1d(bestWeights.bias))
  }

  // attach the relation head to the bundle so it is saved with it
  let bundle: RelationModelBundle = {
    ...pairBundle,
    relationHead,
    relationModel: relation.model,
  }
  await saveRelationModel(bundle, project_id)

  return {
    bundle,
    loss: lastLoss,
    epochs,
    bestEpoch,
    rankingAccuracy: bestRanking < 0 ? null : bestRanking,
    classificationAccuracy: bestClassification < 0 ? null : bestClassification,
    constraintCount: trainConstraints.length,
    tripletCount: usableTriplets.length,
  }
}

/**
 * Ranking accuracy of a bundle on a set of constraints.
 */
export function evaluateRankingAccuracy(
  bundle: RelationModelBundle,
  constraints: RankingConstraint[],
  getVector: (image_id: number) => Float32Array,
): number {
  if (constraints.length === 0) return 0
  let { projector, scorer, spec } = bundle
  let scores = tf.tidy(() => {
    let winners = constraints.map(c => ({
      a: normalizeVector(getVector(c.winner.a)),
      b: normalizeVector(getVector(c.winner.b)),
    }))
    let losers = constraints.map(c => ({
      a: normalizeVector(getVector(c.loser.a)),
      b: normalizeVector(getVector(c.loser.b)),
    }))
    let pairs = [...winners, ...losers]
    let batchA = tf.tensor2d(
      pairs.map(pair => Array.from(pair.a)),
      [pairs.length, spec.inputDims],
    )
    let batchB = tf.tensor2d(
      pairs.map(pair => Array.from(pair.b)),
      [pairs.length, spec.inputDims],
    )
    let projA = projector.apply(batchA) as tfjs.Tensor
    let projB = projector.apply(batchB) as tfjs.Tensor
    let inner = layers.dot({ axes: 1 }).apply([projA, projB]) as tfjs.Tensor
    return (scorer.apply(inner) as tfjs.Tensor).dataSync() as Float32Array
  }) as Float32Array

  let half = constraints.length
  let correct = 0
  for (let i = 0; i < half; i++) {
    if (scores[i]! > scores[half + i]!) correct++
  }
  return correct / half
}

/**
 * Classification accuracy of the relation head on a set of triplets.
 */
export function evaluateClassificationAccuracy(
  bundle: { projector: Dense; relationHead: Dense },
  triplets: TripletAnnotation[],
  getVector: (image_id: number) => Float32Array,
): number {
  if (triplets.length === 0) return 0
  let { projector, relationHead } = bundle
  let correct = 0
  for (let triplet of triplets) {
    let probabilities = tf.tidy(() => {
      let a = tf.tensor2d(
        [Array.from(normalizeVector(getVector(triplet.image_a_id)))],
        [1, EMBEDDING_DIMS],
      )
      let b = tf.tensor2d(
        [Array.from(normalizeVector(getVector(triplet.image_b_id)))],
        [1, EMBEDDING_DIMS],
      )
      let c = tf.tensor2d(
        [Array.from(normalizeVector(getVector(triplet.image_c_id)))],
        [1, EMBEDDING_DIMS],
      )
      let features = tripletFeatures(projector, a, b, c)
      return (relationHead.apply(features) as tfjs.Tensor)
        .dataSync() as Float32Array
    }) as Float32Array
    let predicted = 0
    for (let i = 1; i < probabilities.length; i++) {
      if (probabilities[i]! > probabilities[predicted]!) predicted = i
    }
    if (predicted === triplet.relation) correct++
  }
  return correct / triplets.length
}

/**
 * Seed the projector from the saved pair model of a project, so a
 * fresh training run continues from the learned space instead of
 * starting from a random projection.
 *
 * Returns true when the weights were copied.
 */
async function loadSavedProjectorWeights(
  project_id: number,
  bundle: RelationModelBundle,
): Promise<boolean> {
  let saved = await loadRelationModel(project_id)
  if (!saved) return false
  return copyProjectorWeights(saved.projector, bundle.projector)
}

function shuffleInPlace<T>(items: T[]): void {
  for (let i = items.length - 1; i > 0; i--) {
    let j = Math.floor(Math.random() * (i + 1))
    ;[items[i], items[j]] = [items[j]!, items[i]!]
  }
}
