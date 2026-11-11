import { tf } from 'tensorflow-helpers'
import { layers } from '@tensorflow/tfjs-layers'
import type { Dense } from '@tensorflow/tfjs-layers/dist/layers/core'
import type * as tfjs from '@tensorflow/tfjs'
import { db } from '../../db/db.js'
import { EMBEDDING_DIMS, getProjectVectorCache } from './embedding.js'
import {
  createRelationClassifierModel,
  normalizeVector,
  RELATION_LABELS,
  type RelationClass,
} from './relation-model.js'

/**
 * Triplet relation annotation: "which two of these three images are
 * the most similar".
 *
 * This is the direct counterpart of the pair ranking feedback: the
 * pairs say which of two pairs is more similar, the triplets say which
 * of three images forms the closest pair (or that all three are about
 * equally similar).
 *
 * The four classes are:
 *   0: a and b are the most similar, c is the odd one out
 *   1: a and c are the most similar, b is the odd one out
 *   2: b and c are the most similar, a is the odd one out
 *   3: all three are about equally similar
 */

export type TripletAnnotation = {
  image_a_id: number
  image_b_id: number
  image_c_id: number
  relation: RelationClass
  created_at: number
}

let select_triplets = db.prepare<
  { project_id: number },
  {
    image_a_id: number
    image_b_id: number
    image_c_id: number
    relation: number
    created_at: number
  }
>(/* sql */ `
  select image_a_id, image_b_id, image_c_id, relation, created_at
  from similar_triplet
  where project_id = :project_id
`)

/**
 * Load the triplet annotations of a project.
 */
export function loadTriplets(project_id: number): TripletAnnotation[] {
  return select_triplets.all({ project_id }).map(row => ({
    image_a_id: row.image_a_id,
    image_b_id: row.image_b_id,
    image_c_id: row.image_c_id,
    relation: row.relation as RelationClass,
    created_at: row.created_at,
  }))
}

/**
 * Count the triplet annotations of a project.
 */
export function countTriplets(project_id: number): number {
  return (
    db
      .prepare<{ project_id: number }, number>(
        /* sql */ `select count(*) from similar_triplet where project_id = :project_id`,
      )
      .pluck()
      .get({ project_id }) ?? 0
  )
}

/**
 * Score a triplet with the relation model and return the probability
 * of each relation class.
 */
export function predictRelation(
  bundle: { projector: Dense; relationHead: Dense },
  vectors: [Float32Array, Float32Array, Float32Array],
): Float32Array {
  let { projector, relationHead } = bundle
  return tf.tidy(() => {
    // the three images are projected one by one: a single batch would
    // mix them up, because the pairwise dots need the three
    // projections side by side, not three independent rows
    let projA = projector.apply(
      tf.tensor2d([Array.from(normalizeVector(vectors[0]))], [1, EMBEDDING_DIMS]),
    ) as tfjs.Tensor
    let projB = projector.apply(
      tf.tensor2d([Array.from(normalizeVector(vectors[1]))], [1, EMBEDDING_DIMS]),
    ) as tfjs.Tensor
    let projC = projector.apply(
      tf.tensor2d([Array.from(normalizeVector(vectors[2]))], [1, EMBEDDING_DIMS]),
    ) as tfjs.Tensor

    let dotAB = layers.dot({ axes: 1 }).apply([projA, projB]) as tfjs.Tensor
    let dotAC = layers.dot({ axes: 1 }).apply([projA, projC]) as tfjs.Tensor
    let dotBC = layers.dot({ axes: 1 }).apply([projB, projC]) as tfjs.Tensor

    let features = tf.concat(
      [dotAB, dotAC, dotBC].map(t => tf.reshape(t, [-1, 1])),
      -1,
    )
    return (relationHead.apply(features) as tfjs.Tensor).dataSync() as Float32Array
  }) as Float32Array
}

export type TripletTrainingOptions = {
  project_id: number
  projDims?: number
  learningRate?: number
  epochs?: number
  batchSize?: number
  onProgress?: (epoch: number, loss: number) => void
}

/**
 * Train the relation head on the triplet annotations.
 *
 * Returns null when there is not enough triplet feedback.
 */
export async function trainRelationClassifier(
  options: TripletTrainingOptions,
): Promise<{
  accuracy: number
  loss: number
  epochs: number
  count: number
  /** the trained head, so the caller can predict with it */
  projector: Dense
  relationHead: Dense
} | null> {
  let {
    project_id,
    projDims = 64,
    learningRate = 0.005,
    epochs = 40,
    batchSize = 16,
    onProgress,
  } = options

  let triplets = loadTriplets(project_id)
  if (triplets.length < 4) return null

  let cache = getProjectVectorCache(project_id)
  let indexOf = new Map<number, number>()
  cache.image_ids.forEach((image_id, index) => indexOf.set(image_id, index))

  let usable = triplets.filter(
    triplet =>
      indexOf.has(triplet.image_a_id) &&
      indexOf.has(triplet.image_b_id) &&
      indexOf.has(triplet.image_c_id),
  )
  if (usable.length < 4) return null

  let { projector, relationHead } = createRelationClassifierModel({
    inputDims: EMBEDDING_DIMS,
    projDims,
  })

  let getVector = (image_id: number) => cache.vectors[indexOf.get(image_id)!]!

  let optimizer = tf.train.adam(learningRate)
  let lastLoss = 0

  for (let epoch = 0; epoch < epochs; epoch++) {
    shuffleInPlace(usable)

    let epochLoss = 0
    let batches = 0
    for (let start = 0; start < usable.length; start += batchSize) {
      let batch = usable.slice(start, start + batchSize)
      if (batch.length === 0) continue

      let lossTensor = optimizer.minimize(
        () => {
          return tf.tidy(() => {
            let a = tf.tensor2d(
              batch.map(t =>
                Array.from(normalizeVector(getVector(t.image_a_id))),
              ),
              [batch.length, EMBEDDING_DIMS],
            )
            let b = tf.tensor2d(
              batch.map(t =>
                Array.from(normalizeVector(getVector(t.image_b_id))),
              ),
              [batch.length, EMBEDDING_DIMS],
            )
            let c = tf.tensor2d(
              batch.map(t =>
                Array.from(normalizeVector(getVector(t.image_c_id))),
              ),
              [batch.length, EMBEDDING_DIMS],
            )

            let projA = projector.apply(a) as tfjs.Tensor
            let projB = projector.apply(b) as tfjs.Tensor
            let projC = projector.apply(c) as tfjs.Tensor

            // the three pairwise dots of every triplet in the batch
            let dotAB = layers
              .dot({ axes: 1 })
              .apply([projA, projB]) as tfjs.Tensor
            let dotAC = layers
              .dot({ axes: 1 })
              .apply([projA, projC]) as tfjs.Tensor
            let dotBC = layers
              .dot({ axes: 1 })
              .apply([projB, projC]) as tfjs.Tensor

            // -> [batch, 3] the features of every triplet
            let features = tf.concat(
              [
                tf.reshape(dotAB, [-1, 1]),
                tf.reshape(dotAC, [-1, 1]),
                tf.reshape(dotBC, [-1, 1]),
              ],
              -1,
            )

            let probabilities = relationHead.apply(features) as tfjs.Tensor
            let labels = tf.oneHot(
              batch.map(t => t.relation),
              RELATION_LABELS.length,
            ) as tfjs.Tensor
            // the head already has a softmax activation, so its output
            // is a probability distribution. logLoss is the categorical
            // cross entropy over those probabilities; softmaxCrossEntropy
            // would apply a second softmax to them.
            return tf.losses.logLoss(probabilities, labels).mean()
          })
        },
        true,
      ) as unknown as tfjs.Scalar

      epochLoss += lossTensor.dataSync()[0]!
      lossTensor.dispose()
      batches++
    }

    lastLoss = epochLoss / Math.max(batches, 1)
    onProgress?.(epoch + 1, lastLoss)
  }

  // evaluate the accuracy on the annotations
  let correct = 0
  for (let triplet of usable) {
    let probabilities = predictRelation(
      { projector, relationHead },
      [
        getVector(triplet.image_a_id),
        getVector(triplet.image_b_id),
        getVector(triplet.image_c_id),
      ],
    )
    let predicted = 0
    for (let i = 1; i < probabilities.length; i++) {
      if (probabilities[i]! > probabilities[predicted]!) predicted = i
    }
    if (predicted === triplet.relation) correct++
  }

  return {
    accuracy: correct / usable.length,
    loss: lastLoss,
    epochs,
    count: usable.length,
    projector,
    relationHead,
  }
}

/**
 * Suggest a batch of triplets for the user to annotate.
 *
 * Each triplet is two images the current scorer considers similar plus
 * a third one that is further away. The order inside a triplet is
 * shuffled so the user cannot just pick "the first two".
 *
 * The triplets are spread over the dataset (each one starts at a
 * different offset) so a batch covers different images instead of
 * hammering the same cluster.
 */
export function suggestTripletBatch(options: {
  project_id: number
  count?: number
  scorer?: { score: (a: Float32Array, b: Float32Array) => number }
}): { image_a_id: number; image_b_id: number; image_c_id: number }[] {
  let { project_id, count = 4, scorer } = options
  let cache = getProjectVectorCache(project_id)
  let n = cache.image_ids.length
  if (n < 3) return []

  let normalized = cache.vectors.map(vector => normalizeVector(vector))

  let score =
    scorer?.score ??
    ((a: Float32Array, b: Float32Array) => {
      let dot = 0
      for (let i = 0; i < a.length; i++) dot += a[i]! * b[i]!
      return dot
    })

  // the images already annotated, so the suggestions stay fresh
  let annotated = new Set<number>()
  for (let triplet of loadTriplets(project_id)) {
    annotated.add(triplet.image_a_id)
    annotated.add(triplet.image_b_id)
    annotated.add(triplet.image_c_id)
  }

  let limit = Math.min(n, 80)
  let results: { image_a_id: number; image_b_id: number; image_c_id: number }[] = []

  // spread the starting offset over the dataset so the batches cover
  // different parts of it
  let stride = Math.max(1, Math.floor(limit / Math.max(count, 1)))

  for (let start = 0; start < limit && results.length < count; start += stride) {
    // find the most similar pair that has not been annotated yet
    let bestA = -1
    let bestB = -1
    let bestScore = -Infinity
    for (let i = start; i < limit; i++) {
      if (annotated.has(cache.image_ids[i]!)) continue
      for (let j = i + 1; j < limit; j++) {
        if (annotated.has(cache.image_ids[j]!)) continue
        let value = score(normalized[i]!, normalized[j]!)
        if (value > bestScore) {
          bestScore = value
          bestA = i
          bestB = j
        }
      }
    }
    if (bestA < 0 || bestB < 0) continue

    // the third image is the one furthest away from the pair
    let bestC = -1
    let worstScore = Infinity
    for (let i = 0; i < limit; i++) {
      if (i === bestA || i === bestB) continue
      if (annotated.has(cache.image_ids[i]!)) continue
      let value = score(normalized[bestA]!, normalized[i]!)
      if (value < worstScore) {
        worstScore = value
        bestC = i
      }
    }
    if (bestC < 0) continue

    // shuffle the three so the position does not give the answer away
    let ids = [
      cache.image_ids[bestA]!,
      cache.image_ids[bestB]!,
      cache.image_ids[bestC]!,
    ]
    for (let i = ids.length - 1; i > 0; i--) {
      let j = Math.floor(Math.random() * (i + 1))
      ;[ids[i], ids[j]] = [ids[j]!, ids[i]!]
    }

    results.push({
      image_a_id: ids[0]!,
      image_b_id: ids[1]!,
      image_c_id: ids[2]!,
    })
  }

  return results
}

/**
 * Suggest a triplet for the user to annotate: three images that are
 * close to each other, so the choice is meaningful.
 *
 * The first two form a pair the current scorer considers similar; the
 * third is a different image. The order is shuffled so the user
 * cannot just pick "the first two".
 */
export function suggestTriplet(options: {
  project_id: number
  scorer?: { score: (a: Float32Array, b: Float32Array) => number }
}): { image_a_id: number; image_b_id: number; image_c_id: number } | null {
  let { project_id, scorer } = options
  let cache = getProjectVectorCache(project_id)
  let n = cache.image_ids.length
  if (n < 3) return null

  let normalized = cache.vectors.map(vector => normalizeVector(vector))

  let score =
    scorer?.score ??
    ((a: Float32Array, b: Float32Array) => {
      let dot = 0
      for (let i = 0; i < a.length; i++) dot += a[i]! * b[i]!
      return dot
    })

  // find the most similar pair among the first images
  let bestA = 0
  let bestB = 1
  let bestScore = -Infinity
  let limit = Math.min(n, 60)
  for (let i = 0; i < limit; i++) {
    for (let j = i + 1; j < limit; j++) {
      let value = score(normalized[i]!, normalized[j]!)
      if (value > bestScore) {
        bestScore = value
        bestA = i
        bestB = j
      }
    }
  }

  // the third image is the one furthest away from the pair
  let bestC = -1
  let worstScore = Infinity
  for (let i = 0; i < limit; i++) {
    if (i === bestA || i === bestB) continue
    let value = score(normalized[bestA]!, normalized[i]!)
    if (value < worstScore) {
      worstScore = value
      bestC = i
    }
  }
  if (bestC < 0) return null

  // shuffle the three so the position does not give the answer away
  let ids = [
    cache.image_ids[bestA]!,
    cache.image_ids[bestB]!,
    cache.image_ids[bestC]!,
  ]
  for (let i = ids.length - 1; i > 0; i--) {
    let j = Math.floor(Math.random() * (i + 1))
    ;[ids[i], ids[j]] = [ids[j]!, ids[i]!]
  }

  return { image_a_id: ids[0]!, image_b_id: ids[1]!, image_c_id: ids[2]! }
}

function shuffleInPlace<T>(items: T[]): void {
  for (let i = items.length - 1; i > 0; i--) {
    let j = Math.floor(Math.random() * (i + 1))
    ;[items[i], items[j]] = [items[j]!, items[i]!]
  }
}
