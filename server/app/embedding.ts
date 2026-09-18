import { filter } from 'better-sqlite3-proxy'
import { proxy, Label } from '../../db/proxy.js'
import { db } from '../../db/db.js'
import { baseModel, getBestClassifierModel } from './model.js'
import { env } from '../env.js'
import { join } from 'path'
import { existsSync } from 'fs'
import { GaIsland, best } from 'ga-island'
import { DAGSort, NativeSort, TreeSort } from 'graph-sort'

/**
 * Embedding service for "find similar images".
 *
 * Each image gets a 1280-dim MobileNet V3 feature vector, stored as a
 * Float32 BLOB in the `image_embedding` table. Similarity is weighted
 * cosine: an optional per-project/label weight vector `w` (from
 * `embedding_weight`) scales each dimension before the dot products.
 */

export const EMBEDDING_MODEL_VERSION = 'mobilenet-v3-large-100'

export const EMBEDDING_DIMS = baseModel.spec.features

let get_embedding_by_image = db.prepare<
  { image_id: number; model_version: string },
  { vector: Buffer } | null
>(/* sql */ `
  select vector
  from image_embedding
  where image_id = :image_id
    and model_version = :model_version
  limit 1
`)

let select_project_embeddings = db.prepare<
  { project_id: number; model_version: string },
  { image_id: number; vector: Buffer }
>(/* sql */ `
  select image_id, vector
  from image_embedding
  where project_id = :project_id
    and model_version = :model_version
`)

let select_weight_by_project = db.prepare<
  { project_id: number },
  { vector: Buffer }
>(/* sql */ `
  select vector
  from embedding_weight
  where project_id = :project_id
    and label_id is null
  order by trained_at desc
  limit 1
`)

let select_weight_by_label = db.prepare<
  { project_id: number; label_id: number },
  { vector: Buffer }
>(/* sql */ `
  select vector
  from embedding_weight
  where project_id = :project_id
    and label_id = :label_id
  order by trained_at desc
  limit 1
`)

export type EmbeddingVector = Float32Array

function blobToVector(blob: Buffer): EmbeddingVector {
  return new Float32Array(
    blob.buffer,
    blob.byteOffset,
    blob.byteLength / 4,
  ).slice()
}

function vectorToBlob(vector: EmbeddingVector): Buffer {
  return Buffer.from(
    vector.buffer,
    vector.byteOffset,
    vector.byteLength,
  ) as Buffer
}

/**
 * In-memory cache of a project's full embedding matrix, so repeated
 * similarity searches don't re-load ~50MB of vectors from SQLite on
 * every click. Invalidated whenever an embedding is written or deleted.
 */
type ProjectVectorCache = {
  image_ids: number[]
  vectors: Float32Array[]
  model_version: string
}

let projectVectorCache = new Map<number, ProjectVectorCache>()

/**
 * Drop the cached embedding matrix for a project. Call after any write
 * (new embedding, deleted image, re-trained weight) so searches reflect
 * the latest data.
 */
export function invalidateProjectVectorCache(project_id: number): void {
  projectVectorCache.delete(project_id)
}

/**
 * Get the embedding of an image, computing and caching it on first use.
 * Returns null when the image row or the image file is missing.
 */
export async function getImageEmbedding(
  image_id: number,
): Promise<EmbeddingVector | null> {
  let image = proxy.image[image_id]
  if (!image) return null

  let cached = get_embedding_by_image.get({
    image_id,
    model_version: EMBEDDING_MODEL_VERSION,
  })
  if (cached) return blobToVector(cached.vector)

  let file = join(env.UPLOAD_DIR, image.filename)
  let tensor = await baseModel.imageFileToEmbedding(file)
  let data = new Float32Array(await tensor.data())
  tensor.dispose()

  // one row per image per model version; replace stale rows
  db.prepare(/* sql */ `
    delete from image_embedding
    where image_id = :image_id
      and model_version = :model_version
  `).run({ image_id, model_version: EMBEDDING_MODEL_VERSION })
  db.prepare(/* sql */ `
    insert into image_embedding (image_id, project_id, vector, model_version, created_at)
    values (:image_id, :project_id, :vector, :model_version, :created_at)
  `).run({
    image_id,
    project_id: image.project_id!,
    vector: vectorToBlob(data),
    model_version: EMBEDDING_MODEL_VERSION,
    created_at: Math.floor(Date.now() / 1000),
  })

  // the project's cached embedding matrix is now stale
  invalidateProjectVectorCache(image.project_id!)

  return data
}

/**
 * Compute embeddings for all images of a project that do not have one yet.
 * Runs sequentially to keep TensorFlow memory usage low.
 * Returns the number of newly computed embeddings.
 */
export async function ensureProjectEmbeddings(options: {
  project_id: number
  onProgress?: (done: number, total: number) => void
}): Promise<number> {
  let { project_id, onProgress } = options
  let images = filter(proxy.image, { project_id })
  let total = images.length
  let done = 0
  for (let image of images) {
    let cached = get_embedding_by_image.get({
      image_id: image.id!,
      model_version: EMBEDDING_MODEL_VERSION,
    })
    if (!cached) {
      await getImageEmbedding(image.id!)
    }
    done++
    onProgress?.(done, total)
  }
  return done
}

/**
 * Get the learned weight vector for a project (optionally scoped to a
 * label). Label-level weights take precedence over project-level ones.
 * Returns null when no weight has been trained yet (plain cosine).
 */
export function getEmbeddingWeight(options: {
  project_id: number
  label_id?: number | null
}): EmbeddingVector | null {
  let { project_id, label_id } = options
  let row =
    (label_id &&
      select_weight_by_label.get({ project_id, label_id })) ||
    select_weight_by_project.get({ project_id })
  return row ? blobToVector(row.vector) : null
}

export type SimilarImage = {
  image_id: number
  filename: string
  score: number
}

/**
 * Find the top-K images most similar to the query image within a project.
 * Similarity is weighted cosine similarity; the query image itself is
 * excluded. Images without an embedding are skipped.
 */
export async function findSimilarImages(options: {
  image_id: number
  project_id: number
  label_id?: number
  k?: number
}): Promise<SimilarImage[]> {
  let { image_id, project_id, label_id, k = 20 } = options
  // cap k to avoid pathological requests
  k = Math.min(k, 100)

  let query = await getImageEmbedding(image_id)
  if (!query) return []

  let weight = getEmbeddingWeight({ project_id, label_id })

  // pre-scale the query vector by the weights
  let scaledQuery = new Float32Array(query.length)
  for (let i = 0; i < query.length; i++) {
    scaledQuery[i] = query[i] * (weight ? weight[i] : 1)
  }
  let queryNorm = norm(scaledQuery)

  // load (or reuse) the project's full embedding matrix
  let cache = projectVectorCache.get(project_id)
  if (!cache || cache.model_version !== EMBEDDING_MODEL_VERSION) {
    let rows = select_project_embeddings.all({
      project_id,
      model_version: EMBEDDING_MODEL_VERSION,
    })
    cache = {
      image_ids: rows.map(row => row.image_id),
      vectors: rows.map(row => blobToVector(row.vector)),
      model_version: EMBEDDING_MODEL_VERSION,
    }
    projectVectorCache.set(project_id, cache)
  }

  let results: SimilarImage[] = []
  for (let i = 0; i < cache.image_ids.length; i++) {
    let candidateId = cache.image_ids[i]
    if (candidateId === image_id) continue
    let score = weightedCosine(
      scaledQuery,
      queryNorm,
      cache.vectors[i],
      weight,
    )
    results.push({
      image_id: candidateId,
      filename: proxy.image[candidateId]?.filename ?? '',
      score,
    })
  }

  results.sort((a, b) => b.score - a.score)
  return results.slice(0, k)
}

function norm(vector: Float32Array): number {
  let sum = 0
  for (let i = 0; i < vector.length; i++) {
    sum += vector[i] * vector[i]
  }
  return Math.sqrt(sum)
}

export type SimilarPair = {
  image_id_a: number
  filename_a: string
  image_id_b: number
  filename_b: string
  score: number
}

/**
 * Find the top-K most similar image pairs across a whole project
 * (pairwise, not anchored to a single query image). Weighted cosine
 * similarity (bounded to [-1, 1], so the displayed percentage stays
 * within 100%); images without an embedding are skipped. Uses the same
 * project vector cache as findSimilarImages.
 *
 * Two-stage retrieval:
 * 1. coarse pass: plain (unweighted) cosine over all C(n,2) pairs, a
 *    min-heap keeps the top-(k*6) pairs as the candidate pool (~0.1s)
 * 2. refine: graph-sort (TreeSort/DAGSort by candidate count) ranks the
 *    small candidate pool by the weighted cosine — graph-sort shines
 *    here because the pool is small, so it needs only a few thousand
 *    cheap comparisons instead of hundreds of thousands over all pairs
 */
export function findTopSimilarPairs(options: {
  project_id: number
  k?: number
}): SimilarPair[] {
  let { project_id, k = 5 } = options
  k = Math.min(k, 100)

  // learned weight from user feedback (null = plain cosine)
  let weight = getEmbeddingWeight({ project_id })

  // load (or reuse) the project's full embedding matrix
  let cache = projectVectorCache.get(project_id)
  if (!cache || cache.model_version !== EMBEDDING_MODEL_VERSION) {
    let rows = select_project_embeddings.all({
      project_id,
      model_version: EMBEDDING_MODEL_VERSION,
    })
    cache = {
      image_ids: rows.map(row => row.image_id),
      vectors: rows.map(row => blobToVector(row.vector)),
      model_version: EMBEDDING_MODEL_VERSION,
    }
    projectVectorCache.set(project_id, cache)
  }

  let n = cache.image_ids.length
  if (n < 2) return []

  // capture the non-optional cache for use in nested functions
  let vectorCache = cache

  // pre-normalize all vectors twice:
  // - plainNormalized: for the coarse pass (unweighted cosine)
  // - weightedNormalized: for the refine pass (weighted cosine, what the
  //   page displays) — each dimension scaled by weight[d] before
  //   normalizing by the WEIGHTED norm, so the dot product is a true
  //   weighted cosine in [-1, 1]
  let plainNorms = new Float32Array(n)
  let weightedNorms = new Float32Array(n)
  let plainVectors: (Float32Array | null)[] = new Array(n)
  let weightedVectors: (Float32Array | null)[] = new Array(n)
  for (let i = 0; i < n; i++) {
    let vector = cache.vectors[i]!
    let dims = vector.length
    let plainLength = 0
    let weightedLength = 0
    for (let d = 0; d < dims; d++) {
      let value = vector[d]!
      plainLength += value * value
      // the weighted vector's dimension is value * weight[d], so its
      // squared norm contribution is (value * weight[d])^2
      let weightedValue = value * (weight ? weight[d]! : 1)
      weightedLength += weightedValue * weightedValue
    }
    plainLength = Math.sqrt(plainLength)
    weightedLength = Math.sqrt(weightedLength)
    if (plainLength === 0 || weightedLength === 0) {
      plainVectors[i] = null
      weightedVectors[i] = null
      continue
    }
    plainNorms[i] = plainLength
    weightedNorms[i] = weightedLength
    let plain = new Float32Array(dims)
    let weighted = new Float32Array(dims)
    for (let d = 0; d < dims; d++) {
      let value = vector[d]!
      plain[d] = value / plainLength
      weighted[d] = (value * (weight ? weight[d]! : 1)) / weightedLength
    }
    plainVectors[i] = plain
    weightedVectors[i] = weighted
  }

  // dot product of two pre-normalized vectors
  function dot(a: Float32Array, b: Float32Array): number {
    let sum = 0
    for (let d = 0; d < a.length; d++) {
      sum += a[d]! * b[d]!
    }
    return sum
  }

  // weighted cosine of one pair (i < j) — what the page displays
  function pairScore(i: number, j: number): number {
    let vectorA = weightedVectors[i]
    let vectorB = weightedVectors[j]
    if (!vectorA || !vectorB) return 0
    return dot(vectorA, vectorB)
  }

  // plain (unweighted) cosine of one pair — for the coarse pass
  function plainScore(i: number, j: number): number {
    let vectorA = plainVectors[i]
    let vectorB = plainVectors[j]
    if (!vectorA || !vectorB) return 0
    return dot(vectorA, vectorB)
  }

  function toSimilarPair(a: number, b: number, score: number): SimilarPair {
    return {
      image_id_a: vectorCache.image_ids[a],
      filename_a: proxy.image[vectorCache.image_ids[a]]?.filename ?? '',
      image_id_b: vectorCache.image_ids[b],
      filename_b: proxy.image[vectorCache.image_ids[b]]?.filename ?? '',
      score,
    }
  }

  // ------------------------------------------------------------------
  // stage 1: coarse pass — plain cosine over all pairs, a min-heap keeps
  // the top-(k * 6) pairs as the candidate pool
  // ------------------------------------------------------------------
  let candidateSize = Math.min(k * 6, 2000)
  // min-heap of { score, a, b }: the root is the WORST of the kept pairs
  let heap: { score: number; a: number; b: number }[] = []
  function heapSwap(x: number, y: number): void {
    let temp = heap[x]!
    heap[x] = heap[y]!
    heap[y] = temp
  }
  function heapPush(item: { score: number; a: number; b: number }): void {
    heap.push(item)
    let child = heap.length - 1
    while (child > 0) {
      let parent = (child - 1) >> 1
      if (heap[parent]!.score <= heap[child]!.score) break
      heapSwap(parent, child)
      child = parent
    }
  }
  function heapSiftDown(start: number): void {
    let parent = start
    for (;;) {
      let left = parent * 2 + 1
      let right = left + 1
      let smallest = parent
      if (
        left < heap.length &&
        heap[left]!.score < heap[smallest]!.score
      ) {
        smallest = left
      }
      if (
        right < heap.length &&
        heap[right]!.score < heap[smallest]!.score
      ) {
        smallest = right
      }
      if (smallest === parent) break
      heapSwap(parent, smallest)
      parent = smallest
    }
  }
  function heapReplaceTop(item: { score: number; a: number; b: number }): void {
    heap[0] = item
    heapSiftDown(0)
  }

  for (let i = 0; i < n; i++) {
    if (!plainVectors[i]) continue
    for (let j = i + 1; j < n; j++) {
      if (!plainVectors[j]) continue
      let score = plainScore(i, j)
      if (heap.length < candidateSize) {
        heapPush({ score, a: i, b: j })
      } else if (score > heap[0]!.score) {
        heapReplaceTop({ score, a: i, b: j })
      }
    }
  }
  if (heap.length === 0) return []

  // the heap holds the candidate pairs in no particular order
  let candidates = heap
  let candidateCount = candidates.length

  // ------------------------------------------------------------------
  // stage 2: refine — graph-sort ranks the small candidate pool by the
  // weighted cosine (the metric the page displays)
  // ------------------------------------------------------------------
  // when the candidate pool is small enough that k covers most of it,
  // scoring everything directly is simpler and just as fast
  if (k >= candidateCount) {
    let all: SimilarPair[] = candidates.map(candidate => ({
      ...toSimilarPair(
        candidate.a,
        candidate.b,
        pairScore(candidate.a, candidate.b),
      ),
    }))
    all.sort((a, b) => b.score - a.score)
    return all
  }

  let scoreCache = new Map<number, number>()
  function cachedScore(candidateIndex: number): number {
    let score = scoreCache.get(candidateIndex)
    if (score === undefined) {
      let candidate = candidates[candidateIndex]!
      score = pairScore(candidate.a, candidate.b)
      scoreCache.set(candidateIndex, score)
    }
    return score
  }
  function compareCandidates(
    ca: { index: number; a: number; b: number },
    cb: { index: number; a: number; b: number },
  ): {
    small: { index: number; a: number; b: number }
    large: { index: number; a: number; b: number }
  } {
    let scoreA = cachedScore(ca.index)
    let scoreB = cachedScore(cb.index)
    return scoreA <= scoreB
      ? { small: ca, large: cb }
      : { small: cb, large: ca }
  }

  // pick the sorter by the candidate count (thresholds from graph-sort's
  // benchmark table) — avoids the per-call benchmark that sortTopN()
  // would run
  let SorterClass =
    k <= 5 ? TreeSort : k <= 35 ? DAGSort : NativeSort
  let sorter = new SorterClass<{
    index: number
    a: number
    b: number
  }>(compareCandidates)
  sorter.addValues(
    candidates.map((candidate, index) => ({ ...candidate, index })),
  )
  let topCandidates = sorter.popTopN(k)

  return topCandidates.map(candidate =>
    toSimilarPair(candidate.a, candidate.b, cachedScore(candidate.index)),
  )
}

/**
 * Derive a weight vector from the first Dense layer of the trained
 * classifier of a label: each input dimension is weighted by the L2 norm
 * of its column in the kernel, so dimensions the classifier relies on
 * matter more when comparing images. Zero-training-cost approximation of
 * "similarity as defined by this dataset's labels".
 * Returns null when the label has no trained (best) classifier yet.
 */
export async function deriveWeightFromClassifier(options: {
  label: Label
  project_id: number
}): Promise<EmbeddingVector | null> {
  let { label, project_id } = options

  // only derive from a trained model (same guard as predictImage)
  let modelDir = `saved_models/project-${project_id}/best/label-${label.id}`
  if (!existsSync(join(modelDir, 'model.json'))) return null

  let model = await getBestClassifierModel(label, project_id)
  // find the first Dense layer (layers[0] is the InputLayer, which has
  // no weights — getWeights() returns [] and [0] would be undefined)
  let firstDense = model.classifierModel.layers.find(
    layer => layer.getClassName() === 'Dense',
  )
  if (!firstDense) return null
  let weights = firstDense.getWeights()[0]
  if (!weights) return null
  // kernel shape: [inputSize (1280), outputSize (hidden)]
  let kernel = (await weights.array()) as number[][]
  // NOTE: do NOT dispose `weights` — it is the model's own variable
  // tensor. Disposing it breaks later model calls with
  // "LayersVariable dense_Dense5/kernel is already disposed".
  // guard against a model trained with a different input size
  if (kernel.length !== EMBEDDING_DIMS) return null

  let weight = new Float32Array(EMBEDDING_DIMS)
  for (let i = 0; i < EMBEDDING_DIMS; i++) {
    let sum = 0
    for (let j = 0; j < kernel[i].length; j++) {
      let value = kernel[i][j]
      sum += value * value
    }
    weight[i] = Math.sqrt(sum)
  }

  // normalize so the mean weight is 1 (keeps scores in a familiar range)
  let mean = 0
  for (let i = 0; i < weight.length; i++) mean += weight[i]
  mean /= weight.length
  if (mean > 0) {
    for (let i = 0; i < weight.length; i++) {
      weight[i] /= mean
    }
  }
  return weight
}

let insert_embedding_weight = db.prepare<
  {
    project_id: number
    label_id: number | null
    vector: Buffer
    source: string
    trained_at: number
  },
  { id: number }
>(/* sql */ `
  insert into embedding_weight (project_id, label_id, vector, source, trained_at)
  values (:project_id, :label_id, :vector, :source, :trained_at)
  returning id
`)

/**
 * Save a weight vector for a project (optionally scoped to a label).
 * Older rows for the same scope are kept for history; lookups pick the
 * latest by trained_at.
 */
export function saveEmbeddingWeight(options: {
  project_id: number
  label_id: number | null
  weight: EmbeddingVector
  source: string
}): number {
  let { project_id, label_id, weight, source } = options
  let result = insert_embedding_weight.get({
    project_id,
    label_id,
    vector: vectorToBlob(weight),
    source,
    trained_at: Math.floor(Date.now() / 1000),
  })
  return result!.id
}

// ---------------------------------------------------------------------------
// train weight from pair ranking feedback
// ---------------------------------------------------------------------------

// all pairwise comparisons of a project (each row says "pair_hi is more
// similar than pair_lo" when hi_more_similar = 1, the reverse otherwise).
// Comparisons accumulate across sessions — every row is one training
// constraint.
let select_pair_comparisons = db.prepare<
  { project_id: number },
  {
    pair_hi_a_id: number
    pair_hi_b_id: number
    pair_lo_a_id: number
    pair_lo_b_id: number
    hi_more_similar: number
  }
>(/* sql */ `
  select pair_hi_a_id, pair_hi_b_id, pair_lo_a_id, pair_lo_b_id, hi_more_similar
  from similar_pair_comparison
  where project_id = :project_id
`)

/**
 * Train a per-project embedding weight vector from the user's pairwise
 * comparisons (similar_pair_comparison).
 *
 * Each comparison row is one constraint: "the winner pair should have a
 * HIGHER weighted-cosine score than the loser pair". For every violated
 * constraint (scoreWinner <= scoreLoser) we nudge the weight along the
 * contrast direction: dimensions that make the winner pair's two images
 * differ get boosted, and the same for the loser pair gets damped — so
 * after re-scoring, the winner pair's weighted cosine rises relative to
 * the loser one.
 *
 * This is a simple contrastive gradient approximation (no tfjs backprop):
 * fast (milliseconds), dependency-free, and interpretable. The result is
 * mean-normalized to 1 (same convention as deriveWeightFromClassifier)
 * and clamped to [0.1, 10] to avoid runaway weights.
 *
 * Returns null when there is not enough feedback (fewer than 2
 * comparisons) to learn from.
 */
export function deriveWeightFromFeedback(options: {
  project_id: number
}): EmbeddingVector | null {
  let { project_id } = options

  // load (or reuse) the project's full embedding matrix
  let cache = projectVectorCache.get(project_id)
  if (!cache || cache.model_version !== EMBEDDING_MODEL_VERSION) {
    let rows = select_project_embeddings.all({
      project_id,
      model_version: EMBEDDING_MODEL_VERSION,
    })
    cache = {
      image_ids: rows.map(row => row.image_id),
      vectors: rows.map(row => blobToVector(row.vector)),
      model_version: EMBEDDING_MODEL_VERSION,
    }
    projectVectorCache.set(project_id, cache)
  }
  let idToIndex = new Map<number, number>()
  cache.image_ids.forEach((image_id, index) => idToIndex.set(image_id, index))

  // comparisons as (winner, loser) index pairs, only when both images of
  // both pairs have embeddings
  let comparisons: {
    winner: { i: number; j: number }
    loser: { i: number; j: number }
  }[] = []
  for (let row of select_pair_comparisons.all({ project_id })) {
    let hiI = idToIndex.get(row.pair_hi_a_id)
    let hiJ = idToIndex.get(row.pair_hi_b_id)
    let loI = idToIndex.get(row.pair_lo_a_id)
    let loJ = idToIndex.get(row.pair_lo_b_id)
    if (hiI == null || hiJ == null || loI == null || loJ == null) continue
    if (hiI === hiJ || loI === loJ) continue
    comparisons.push({
      winner: row.hi_more_similar
        ? { i: hiI, j: hiJ }
        : { i: loI, j: loJ },
      loser: row.hi_more_similar
        ? { i: loI, j: loJ }
        : { i: hiI, j: hiJ },
    })
  }
  // need at least 2 comparisons to form a meaningful ordering constraint
  if (comparisons.length < 2) return null

  let dims = EMBEDDING_DIMS
  let weight = new Float32Array(dims)
  weight.fill(1)

  const LEARNING_RATE = 0.05
  const ITERATIONS = 50
  const WEIGHT_MIN = 0.1
  const WEIGHT_MAX = 10

  // pre-normalize embeddings once (plain cosine space, like findTopSimilarPairs)
  let normalized: (Float32Array | null)[] = cache.vectors.map(vector => {
    let length = norm(vector)
    if (length === 0) return null
    let scaled = new Float32Array(vector.length)
    for (let d = 0; d < vector.length; d++) {
      scaled[d] = vector[d] / length
    }
    return scaled
  })

  function pairScore(i: number, j: number): number {
    let a = normalized[i]
    let b = normalized[j]
    if (!a || !b) return 0
    let dot = 0
    for (let d = 0; d < dims; d++) {
      dot += a[d] * weight[d] * b[d] * weight[d]
    }
    return dot
  }

  for (let iter = 0; iter < ITERATIONS; iter++) {
    let changed = false
    for (let comparison of comparisons) {
      let winner = comparison.winner
      let loser = comparison.loser
      let scoreWinner = pairScore(winner.i, winner.j)
      let scoreLoser = pairScore(loser.i, loser.j)
      // only nudge when the constraint is violated (or nearly tied)
      if (scoreWinner >= scoreLoser - 1e-6) continue
      changed = true
      let margin = scoreLoser - scoreWinner
      // contrast direction per dimension: the winner pair's |a-b| profile
      // minus the loser pair's — boosting these dimensions raises the
      // winner's weighted cosine relative to the loser's
      for (let d = 0; d < dims; d++) {
        let aHigh = normalized[winner.i]![d]
        let bHigh = normalized[winner.j]![d]
        let aLow = normalized[loser.i]![d]
        let bLow = normalized[loser.j]![d]
        let contrast =
          Math.abs(aHigh - bHigh) - Math.abs(aLow - bLow)
        weight[d] += LEARNING_RATE * margin * contrast
        if (weight[d] < WEIGHT_MIN) weight[d] = WEIGHT_MIN
        if (weight[d] > WEIGHT_MAX) weight[d] = WEIGHT_MAX
      }
    }
    if (!changed) break
  }

  // normalize so the mean weight is 1 (keeps scores in a familiar range)
  let mean = 0
  for (let d = 0; d < dims; d++) mean += weight[d]!
  mean /= dims
  if (mean > 0) {
    for (let d = 0; d < dims; d++) {
      weight[d] = Math.min(WEIGHT_MAX, Math.max(WEIGHT_MIN, weight[d]! / mean))
    }
  }
  return weight
}

// ---------------------------------------------------------------------------
// train weight from pair ranking feedback (genetic algorithm)
// ---------------------------------------------------------------------------

const GA_POPULATION_SIZE = 60
const GA_GENERATIONS = 40
const GA_WEIGHT_MIN = 0.1
const GA_WEIGHT_MAX = 10
const GA_MARGIN = 0.01

type WeightGene = { w: Float32Array }

/**
 * Train the per-project embedding weight with a genetic algorithm
 * (ga-island). The gene is the 1280-dim weight vector; fitness counts
 * how well the weighted pair scores satisfy the user's ranking
 * (a higher-ranked pair must outscore a lower-ranked one, with margin).
 *
 * The population is seeded with the all-1 vector and the result of the
 * gradient method (deriveWeightFromFeedback), so the GA refines from a
 * good starting point instead of searching blind.
 *
 * Returns null when there is not enough ranked feedback (< 2 pairs).
 */
export function deriveWeightFromFeedbackGA(options: {
  project_id: number
}): EmbeddingVector | null {
  let { project_id } = options

  // load (or reuse) the project's full embedding matrix
  let cache = projectVectorCache.get(project_id)
  if (!cache || cache.model_version !== EMBEDDING_MODEL_VERSION) {
    let rows = select_project_embeddings.all({
      project_id,
      model_version: EMBEDDING_MODEL_VERSION,
    })
    cache = {
      image_ids: rows.map(row => row.image_id),
      vectors: rows.map(row => blobToVector(row.vector)),
      model_version: EMBEDDING_MODEL_VERSION,
    }
    projectVectorCache.set(project_id, cache)
  }
  let idToIndex = new Map<number, number>()
  cache.image_ids.forEach((image_id, index) => idToIndex.set(image_id, index))

  // comparisons as (winner, loser) index pairs, only when both images of
  // both pairs have embeddings
  let comparisons: {
    winner: { i: number; j: number }
    loser: { i: number; j: number }
  }[] = []
  for (let row of select_pair_comparisons.all({ project_id })) {
    let hiI = idToIndex.get(row.pair_hi_a_id)
    let hiJ = idToIndex.get(row.pair_hi_b_id)
    let loI = idToIndex.get(row.pair_lo_a_id)
    let loJ = idToIndex.get(row.pair_lo_b_id)
    if (hiI == null || hiJ == null || loI == null || loJ == null) continue
    if (hiI === hiJ || loI === loJ) continue
    comparisons.push({
      winner: row.hi_more_similar
        ? { i: hiI, j: hiJ }
        : { i: loI, j: loJ },
      loser: row.hi_more_similar
        ? { i: loI, j: loJ }
        : { i: hiI, j: hiJ },
    })
  }
  // need at least 2 comparisons to form a meaningful ordering constraint
  if (comparisons.length < 2) return null

  let dims = EMBEDDING_DIMS

  // pre-normalize embeddings once (plain cosine space, like findTopSimilarPairs)
  let normalized: (Float32Array | null)[] = cache.vectors.map(vector => {
    let length = norm(vector)
    if (length === 0) return null
    let scaled = new Float32Array(vector.length)
    for (let d = 0; d < vector.length; d++) {
      scaled[d] = vector[d] / length
    }
    return scaled
  })

  // weighted pair score with an explicit weight (not a closure variable).
  // normalized by the weighted norms so the score is a weighted cosine
  // in [-1, 1] — the same metric findTopSimilarPairs displays
  function pairScoreWith(
    w: Float32Array,
    i: number,
    j: number,
  ): number {
    let a = normalized[i]
    let b = normalized[j]
    if (!a || !b) return 0
    let dot = 0
    let normA = 0
    let normB = 0
    for (let d = 0; d < dims; d++) {
      let wa = a[d]! * w[d]!
      let wb = b[d]! * w[d]!
      dot += wa * wb
      normA += wa * wa
      normB += wb * wb
    }
    if (normA === 0 || normB === 0) return 0
    return dot / (Math.sqrt(normA) * Math.sqrt(normB))
  }

  // fitness: how well the comparison constraints are satisfied.
  // sum of hinge losses over all comparisons; 0 = perfect ordering.
  // higher is better, so negate the loss and add a constant ceiling.
  let ceiling = comparisons.length
  function fitness(gene: WeightGene): number {
    let w = gene.w
    let loss = 0
    for (let comparison of comparisons) {
      let scoreWinner = pairScoreWith(
        w,
        comparison.winner.i,
        comparison.winner.j,
      )
      let scoreLoser = pairScoreWith(
        w,
        comparison.loser.i,
        comparison.loser.j,
      )
      // violated (or too close): penalize by the margin shortfall
      if (scoreWinner < scoreLoser + GA_MARGIN) {
        loss += scoreLoser + GA_MARGIN - scoreWinner
      }
    }
    return ceiling - loss
  }

  function clampWeight(w: Float32Array): void {
    for (let d = 0; d < dims; d++) {
      if (w[d]! < GA_WEIGHT_MIN) w[d] = GA_WEIGHT_MIN
      else if (w[d]! > GA_WEIGHT_MAX) w[d] = GA_WEIGHT_MAX
    }
  }

  function randomWeight(): number {
    // log-uniform in [GA_WEIGHT_MIN, GA_WEIGHT_MAX]
    let lo = Math.log(GA_WEIGHT_MIN)
    let hi = Math.log(GA_WEIGHT_MAX)
    return Math.exp(lo + Math.random() * (hi - lo))
  }

  function randomIndividual(): WeightGene {
    let w = new Float32Array(dims)
    for (let d = 0; d < dims; d++) w[d] = randomWeight()
    return { w }
  }

  function mutate(input: WeightGene, output: WeightGene): void {
    let w = output.w
    w.set(input.w)
    // perturb a few random dimensions in log space
    let nMutate = 8 + Math.floor(Math.random() * 24)
    for (let k = 0; k < nMutate; k++) {
      let d = Math.floor(Math.random() * dims)
      let factor = Math.exp((Math.random() - 0.5) * 1.0) // ×0.6..×1.65
      w[d] = Math.min(GA_WEIGHT_MAX, Math.max(GA_WEIGHT_MIN, w[d]! * factor))
    }
  }

  function crossover(
    aParent: WeightGene,
    bParent: WeightGene,
    child: WeightGene,
  ): void {
    let a = aParent.w
    let b = bParent.w
    let c = child.w
    // uniform crossover per dimension
    for (let d = 0; d < dims; d++) {
      c[d] = Math.random() < 0.5 ? a[d]! : b[d]!
    }
  }

  // seed the population: all-1 + gradient result + random individuals
  let seedWeight = new Float32Array(dims)
  seedWeight.fill(1)
  let gradientWeight = deriveWeightFromFeedback({ project_id })

  let population: WeightGene[] = [{ w: seedWeight }]
  if (gradientWeight) population.push({ w: gradientWeight })
  // GaIsland populates the rest via randomIndividual

  let ga = new GaIsland<WeightGene>({
    populationSize: GA_POPULATION_SIZE,
    population,
    randomIndividual,
    mutate,
    crossover,
    fitness,
    mutationRate: 0.5,
  })

  for (let gen = 0; gen < GA_GENERATIONS; gen++) {
    ga.evolve()
  }

  let { gene } = best({ population: ga.options.population, fitness })
  let weight = new Float32Array(gene.w) // copy out (the population is reused)
  clampWeight(weight)
  // normalize so the mean weight is 1 (keeps scores in a familiar range)
  let mean = 0
  for (let d = 0; d < dims; d++) mean += weight[d]!
  mean /= dims
  if (mean > 0) {
    for (let d = 0; d < dims; d++) {
      weight[d] = Math.min(
        GA_WEIGHT_MAX,
        Math.max(GA_WEIGHT_MIN, weight[d]! / mean),
      )
    }
  }
  return weight
}

/**
 * Weighted cosine similarity between the (already weight-scaled) query
 * and a candidate vector. When `weight` is null the candidate is used
 * as-is (plain cosine).
 */
function weightedCosine(
  scaledQuery: Float32Array,
  queryNorm: number,
  vector: Float32Array,
  weight: EmbeddingVector | null,
): number {
  let dot = 0
  let vectorNorm = 0
  for (let i = 0; i < vector.length; i++) {
    let value = weight ? vector[i] * weight[i] : vector[i]
    dot += scaledQuery[i] * value
    vectorNorm += value * value
  }
  if (queryNorm === 0 || vectorNorm === 0) return 0
  return dot / (queryNorm * Math.sqrt(vectorNorm))
}