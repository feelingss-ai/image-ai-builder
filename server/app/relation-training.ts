import { tf } from 'tensorflow-helpers'
import { layers } from '@tensorflow/tfjs-layers'
import type { Dense } from '@tensorflow/tfjs-layers/dist/layers/core'
import type * as tfjs from '@tensorflow/tfjs'
import { db } from '../../db/db.js'
import {
  EMBEDDING_DIMS,
  getProjectVectorCache,
  getEmbeddingWeight,
} from './embedding.js'
import {
  createRelationModel,
  saveRelationModel,
  normalizeVector,
  DEFAULT_PROJ_DIMS,
  type RelationModelBundle,
} from './relation-model.js'

/**
 * Trains the shared similarity model from the user's pair ranking
 * feedback (similar_pair_comparison).
 *
 * Each comparison row says "the pair (hi) is more similar than the
 * pair (lo)". That is a *ranking* constraint between two pairs, which
 * is exactly what a margin ranking loss consumes:
 *
 *   L = max(0, margin - (s(winner) - s(loser)))
 *
 * A standard `model.fit()` cannot express this: the loss callback is
 * per-sample, while this constraint is a relation between samples. So
 * the loop below is hand-written with `optimizer.minimize()`.
 */

export type RankingConstraint = {
  /** the pair that should score higher */
  winner: { a: number; b: number }
  /** the pair that should score lower */
  loser: { a: number; b: number }
  /** ranking session id (constraints from the same session overlap) */
  session: number
}

export type ConstraintSet = {
  constraints: RankingConstraint[]
  /** the distinct images referenced by the constraints */
  imageIds: number[]
  /** how many rows were dropped because they contradicted an earlier one */
  contradictory: number
}

let select_pair_comparisons = db.prepare<
  { project_id: number },
  {
    pair_hi_a_id: number
    pair_hi_b_id: number
    pair_lo_a_id: number
    pair_lo_b_id: number
    hi_more_similar: number
    created_at: number
  }
>(/* sql */ `
  select pair_hi_a_id, pair_hi_b_id, pair_lo_a_id, pair_lo_b_id,
         hi_more_similar, created_at
  from similar_pair_comparison
  where project_id = :project_id
`)

/**
 * Build the ranking constraints of a project from the saved pair
 * comparisons.
 *
 * Two normalisations are applied:
 *
 * 1. each pair is canonicalised to (min, max) so that (a,b) and (b,a)
 *    are the same pair
 * 2. a (winner, loser) combination that was already seen is skipped,
 *    and so is the reverse combination �?the user contradicting
 *    themselves means the pair is ambiguous and must not be trained on
 *
 * De-duplication matters a lot here: a single ranking session expands
 * to n·(n-1)/2 comparison rows, but those rows only cover a handful of
 * distinct pairs, so without de-duplication the same handful of pairs
 * would dominate the loss.
 */
export function buildConstraints(options: {
  project_id: number
}): ConstraintSet {
  let rows = select_pair_comparisons.all({ project_id: options.project_id })

  // rows written within the same second belong to the same ranking
  // session �?the client saves the whole ordering in one go
  let sessionOf = new Map<number, number>()
  let timestamps = [...new Set(rows.map(row => row.created_at))].sort(
    (a, b) => a - b,
  )
  timestamps.forEach((timestamp, index) => sessionOf.set(timestamp, index))

  let seen = new Set<string>()
  let constraints: RankingConstraint[] = []
  let imageIds = new Set<number>()
  let contradictory = 0

  for (let row of rows) {
    let hi = {
      a: Math.min(row.pair_hi_a_id, row.pair_hi_b_id),
      b: Math.max(row.pair_hi_a_id, row.pair_hi_b_id),
    }
    let lo = {
      a: Math.min(row.pair_lo_a_id, row.pair_lo_b_id),
      b: Math.max(row.pair_lo_a_id, row.pair_lo_b_id),
    }
    // a pair of the same image carries no similarity signal
    if (hi.a === hi.b || lo.a === lo.b) continue

    let winner = row.hi_more_similar ? hi : lo
    let loser = row.hi_more_similar ? lo : hi

    let key = `${winner.a},${winner.b}>${loser.a},${loser.b}`
    let reverseKey = `${loser.a},${loser.b}>${winner.a},${winner.b}`
    if (seen.has(reverseKey)) {
      contradictory++
      continue
    }
    if (seen.has(key)) continue
    seen.add(key)

    constraints.push({
      winner,
      loser,
      session: sessionOf.get(row.created_at)!,
    })
    imageIds.add(winner.a)
    imageIds.add(winner.b)
    imageIds.add(loser.a)
    imageIds.add(loser.b)
  }

  return { constraints, imageIds: [...imageIds], contradictory }
}

/**
 * Split the constraints into a training and a validation set.
 *
 * The split is by ranking *session*, not randomly: the pairs shown in
 * one session overlap heavily, so a random split would leak the
 * training data into the validation set and report a meaningless
 * accuracy.
 */
export function splitBySession(
  constraints: RankingConstraint[],
  valRatio = 0.2,
): { train: RankingConstraint[]; val: RankingConstraint[] } {
  if (constraints.length === 0) return { train: [], val: [] }
  let sessions = [...new Set(constraints.map(c => c.session))].sort(
    (a, b) => a - b,
  )
  let valSessionCount = Math.max(1, Math.floor(sessions.length * valRatio))
  let valSessions = new Set(sessions.slice(-valSessionCount))
  return {
    train: constraints.filter(c => !valSessions.has(c.session)),
    val: constraints.filter(c => valSessions.has(c.session)),
  }
}

export type TrainingOptions = {
  project_id: number
  projDims?: number
  learningRate?: number
  epochs?: number
  batchSize?: number
  margin?: number
  l2?: number
  /** stop after this many epochs without validation improvement */
  patience?: number
  /** train on a subset of the constraints (the rest is used for validation) */
  constraints?: RankingConstraint[]
  onProgress?: (epoch: number, loss: number) => void
  onValidation?: (epoch: number, accuracy: number) => void
}

export type TrainingResult = {
  bundle: RelationModelBundle
  loss: number
  epochs: number
  constraintCount: number
  /** the epoch whose weights were kept (may be earlier than `epochs`) */
  bestEpoch: number
  /** validation ranking accuracy of the kept weights, or null when no
   * validation set was given */
  validationAccuracy: number | null
}

/**
 * The data a training run works on: the constraints plus a lookup for
 * the embedding of every image they reference.
 */
export type TrainingData = {
  constraints: RankingConstraint[]
  getVector: (image_id: number) => Float32Array
  /**
   * Validation constraints, used to pick the best epoch. When omitted no
   * early stopping happens and the final epoch is kept.
   */
  validation?: RankingConstraint[]
}

/**
 * Score a batch of pairs with concrete tensors, using the layer
 * instances (the graph built from symbolic tensors cannot be reused
 * for backprop).
 */
function scoreBatch(
  projector: Dense,
  scorer: Dense,
  batchA: tfjs.Tensor2D,
  batchB: tfjs.Tensor2D,
): tfjs.Tensor {
  let projA = projector.apply(batchA) as tfjs.Tensor
  let projB = projector.apply(batchB) as tfjs.Tensor
  let inner = layers.dot({ axes: 1 }).apply([projA, projB]) as tfjs.Tensor
  return scorer.apply(inner) as tfjs.Tensor
}

/**
 * The margin ranking loss over a batch of constraints:
 *
 *   L = max(0, margin - (s(winner) - s(loser)))
 *
 * plus an L2 penalty on the projector kernel.
 */
function rankingLoss(
  projector: Dense,
  scorer: Dense,
  batch: RankingConstraint[],
  getVector: (image_id: number) => Float32Array,
  margin: number,
  l2: number,
): tfjs.Scalar {
  return tf.tidy(() => {
    // normalise the embeddings so the score is a cosine similarity;
    // without this the raw inner products saturate the scorer and the
    // ranking information is lost
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

    let sWinner = scoreBatch(projector, scorer, winnerA, winnerB)
    let sLoser = scoreBatch(projector, scorer, loserA, loserB)

    let loss = tf.maximum(
      tf.scalar(0),
      tf.scalar(margin).sub(sWinner.sub(sLoser)),
    ).mean()

    // L2 regularisation on the projector kernel
    let kernel = projector.getWeights()[0]!
    return loss.add(kernel.square().sum().mul(l2)) as tfjs.Scalar
  })
}

/**
 * Train a model on the given constraints. This is the core of the
 * training, free of database and file-system access so it can be
 * tested in isolation.
 *
 * When a validation set is supplied, the epoch with the best validation
 * ranking accuracy is kept and training stops early once the accuracy
 * has not improved for `patience` epochs. This matters a lot: the
 * available ranking feedback is sparse, and without early stopping the
 * model overfits (measured on the real dataset: 100% training accuracy
 * but 65% validation accuracy).
 *
 * Returns null when there is not enough feedback to learn from.
 */
export function trainRelationModelOnData(options: {
  data: TrainingData
  projDims?: number
  learningRate?: number
  epochs?: number
  batchSize?: number
  margin?: number
  l2?: number
  /** stop after this many epochs without validation improvement */
  patience?: number
  onProgress?: (epoch: number, loss: number) => void
  onValidation?: (epoch: number, accuracy: number) => void
}): TrainingResult | null {
  let {
    data,
    projDims = DEFAULT_PROJ_DIMS,
    learningRate = 0.005,
    epochs = 20,
    batchSize = 32,
    // the scorer is linear, so the score is unbounded; a margin of 1.0
    // asks for a clear separation without over-pushing the weights
    margin = 1.0,
    l2 = 1e-3,
    patience = 5,
    onProgress,
    onValidation,
  } = options

  let constraints = data.constraints
  if (constraints.length < 4) return null

  let bundle = createRelationModel({
    inputDims: EMBEDDING_DIMS,
    projDims,
    headUnits: 1,
  })
  let { projector, scorer } = bundle

  let optimizer = tf.train.adam(learningRate)
  let lastLoss = 0

  // the best weights seen so far, and how long they have been unbeaten
  let validation = data.validation
  let bestAccuracy = -1
  let bestEpoch = 0
  let bestWeights: { kernel: Float32Array; bias: Float32Array } | null = null
  let epochsWithoutImprovement = 0

  for (let epoch = 0; epoch < epochs; epoch++) {
    shuffleInPlace(constraints)

    let epochLoss = 0
    let batches = 0
    for (let start = 0; start < constraints.length; start += batchSize) {
      let batch = constraints.slice(start, start + batchSize)
      if (batch.length === 0) continue

      let lossTensor = optimizer.minimize(
        () => rankingLoss(projector, scorer, batch, data.getVector, margin, l2),
        true,
      ) as unknown as tfjs.Scalar

      epochLoss += lossTensor.dataSync()[0]!
      lossTensor.dispose()
      batches++
    }

    lastLoss = epochLoss / Math.max(batches, 1)
    onProgress?.(epoch + 1, lastLoss)

    if (validation && validation.length > 0) {
      let accuracy = evaluateRanking(bundle, validation, data.getVector)
      onValidation?.(epoch + 1, accuracy)
      if (accuracy > bestAccuracy) {
        bestAccuracy = accuracy
        bestEpoch = epoch + 1
        // snapshot the weights so they can be restored later
        bestWeights = {
          kernel: Float32Array.from(projector.getWeights()[0]!.dataSync()),
          bias: Float32Array.from(projector.getWeights()[1]!.dataSync()),
        }
        epochsWithoutImprovement = 0
      } else {
        epochsWithoutImprovement++
        if (epochsWithoutImprovement >= patience) break
      }
    }
  }

  // restore the best weights when a validation set was used
  if (validation && validation.length > 0 && bestWeights) {
    // trainableWeights holds the actual variables; getWeights() returns
    // read-only copies that cannot be written to
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

  return {
    bundle,
    loss: lastLoss,
    epochs,
    bestEpoch,
    validationAccuracy: validation && validation.length > 0 ? bestAccuracy : null,
    constraintCount: constraints.length,
  }
}

/**
 * Train the shared similarity model of a project and save it.
 *
 * The constraints are split by ranking session into a training and a
 * validation set; the validation set picks the best epoch (early
 * stopping). Splitting by session matters: the pairs shown in one
 * session overlap heavily, so a random split would leak the training
 * data into the validation set.
 *
 * Returns null when there is not enough feedback to learn from - the
 * caller should then keep using the weighted cosine similarity.
 */
export async function trainRelationModel(
  options: TrainingOptions,
): Promise<TrainingResult | null> {
  let { project_id } = options

  let allConstraints =
    options.constraints ?? buildConstraints({ project_id }).constraints
  if (allConstraints.length < 4) return null

  // map image ids to their index in the project's embedding matrix
  let cache = getProjectVectorCache(project_id)
  let indexOf = new Map<number, number>()
  cache.image_ids.forEach((image_id, index) => indexOf.set(image_id, index))

  let usable = allConstraints.filter(
    constraint =>
      indexOf.has(constraint.winner.a) &&
      indexOf.has(constraint.winner.b) &&
      indexOf.has(constraint.loser.a) &&
      indexOf.has(constraint.loser.b),
  )
  if (usable.length < 4) return null

  // hold out the newest session(s) for validation, unless the caller
  // already decided which constraints to train on
  let trainConstraints = usable
  let validationConstraints: RankingConstraint[] = []
  if (!options.constraints) {
    let split = splitBySession(usable, 0.2)
    trainConstraints = split.train
    validationConstraints = split.val
  }
  // a validation set needs at least one constraint to be useful
  if (validationConstraints.length < 1) validationConstraints = []

  let getVector = (image_id: number) => cache.vectors[indexOf.get(image_id)!]!

  let result = trainRelationModelOnData({
    data: {
      constraints: trainConstraints,
      getVector,
      validation: validationConstraints,
    },
    projDims: options.projDims,
    learningRate: options.learningRate,
    epochs: options.epochs,
    batchSize: options.batchSize,
    margin: options.margin,
    l2: options.l2,
    patience: options.patience,
    onProgress: options.onProgress,
    onValidation: options.onValidation,
  })
  if (!result) return null

  await saveRelationModel(result.bundle, project_id)
  return result
}

/**
 * Ranking accuracy on a set of constraints: the fraction where the
 * winner pair scores higher than the loser pair.
 *
 * This is the metric to compare against the diagonal weight vector �?
 * it answers "does the new model order the pairs the way the user did?"
 */
export function evaluateRanking(
  bundle: RelationModelBundle,
  constraints: RankingConstraint[],
  getVector: (image_id: number) => Float32Array,
): number {
  if (constraints.length === 0) return 0

  // winners first, losers second �?the two arrays are scored in one
  // batch and then compared index by index
  let winners = constraints.map(constraint => ({
    a: getVector(constraint.winner.a),
    b: getVector(constraint.winner.b),
  }))
  let losers = constraints.map(constraint => ({
    a: getVector(constraint.loser.a),
    b: getVector(constraint.loser.b),
  }))
  let pairs = [...winners, ...losers]

  let { projector, scorer, spec } = bundle
  let scores = tf.tidy(() => {
    let batchA = tf.tensor2d(
      pairs.map(pair => Array.from(normalizeVector(pair.a))),
      [pairs.length, spec.inputDims],
    )
    let batchB = tf.tensor2d(
      pairs.map(pair => Array.from(normalizeVector(pair.b))),
      [pairs.length, spec.inputDims],
    )
    let projA = projector.apply(batchA) as tfjs.Tensor
    let projB = projector.apply(batchB) as tfjs.Tensor
    let inner = layers.dot({ axes: 1 }).apply([projA, projB]) as tfjs.Tensor
    // dataSync() on a [n, 1] tensor returns a flat Float32Array of n values
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
 * Ranking accuracy of the existing diagonal weight vector, used as the
 * baseline the new model has to beat.
 */
export function evaluateDiagonalWeight(
  project_id: number,
  constraints: RankingConstraint[],
  getVector: (image_id: number) => Float32Array,
): number {
  if (constraints.length === 0) return 0
  let weight = getEmbeddingWeight({ project_id })
  if (!weight) return 0

  let score = (a: Float32Array, b: Float32Array) => {
    let dot = 0
    let normA = 0
    let normB = 0
    for (let i = 0; i < a.length; i++) {
      let wa = a[i]! * weight[i]!
      let wb = b[i]! * weight[i]!
      dot += wa * wb
      normA += wa * wa
      normB += wb * wb
    }
    if (normA === 0 || normB === 0) return 0
    return dot / (Math.sqrt(normA) * Math.sqrt(normB))
  }

  let correct = 0
  for (let constraint of constraints) {
    let winnerScore = score(
      getVector(constraint.winner.a),
      getVector(constraint.winner.b),
    )
    let loserScore = score(
      getVector(constraint.loser.a),
      getVector(constraint.loser.b),
    )
    if (winnerScore > loserScore) correct++
  }
  return correct / constraints.length
}

function shuffleInPlace<T>(items: T[]): void {
  for (let i = items.length - 1; i > 0; i--) {
    let j = Math.floor(Math.random() * (i + 1))
    ;[items[i], items[j]] = [items[j]!, items[i]!]
  }
}
