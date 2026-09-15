import { filter } from 'better-sqlite3-proxy'
import { proxy, Label } from '../../db/proxy.js'
import { db } from '../../db/db.js'
import { baseModel, getBestClassifierModel } from './model.js'
import { env } from '../env.js'
import { join } from 'path'
import { existsSync } from 'fs'

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