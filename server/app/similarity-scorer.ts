import { tf } from 'tensorflow-helpers'
import { layers } from '@tensorflow/tfjs-layers'
import type * as tfjs from '@tensorflow/tfjs'
import {
  loadRelationModel,
  normalizeVector,
  type RelationModelBundle,
} from './relation-model.js'

/**
 * Pair scoring for "find similar images".
 *
 * Two modes are supported:
 *
 * - `relation` (default): a small trained network that projects both
 *   embeddings into a shared space and scores the pair. It can express
 *   that some dimensions matter more than others, and that dimensions
 *   combine with each other — which a per-dimension weight vector
 *   cannot.
 * - `weighted`: the original approach — a diagonal weight vector from
 *   `embedding_weight` applied to the raw embeddings, then a cosine.
 *
 * The relation model is used whenever the project has one; when it is
 * missing the weighted mode is used instead, so the feature keeps
 * working before a model has been trained.
 */

export type SimilarityMode = 'relation' | 'weighted'

export type PairScorer = {
  mode: SimilarityMode
  /**
   * Score a pair of raw embeddings. Higher means more similar.
   */
  score: (a: Float32Array, b: Float32Array) => number
  /**
   * Score many pairs at once. The index of each result matches the
   * index of the input.
   */
  scoreMany: (pairs: { a: Float32Array; b: Float32Array }[]) => number[]
}

/**
 * Cache of the loaded relation model per project, so repeated searches
 * do not re-read the model from disk.
 *
 * The scorer has to be usable synchronously (the websocket components
 * that render the pair list are synchronous), so the model is loaded
 * ahead of time — see `preloadProjectScorer`.
 */
let relationModelCache = new Map<number, RelationModelBundle | null>()

/**
 * Drop the cached relation model of a project. Call after training a
 * new model or deleting one.
 */
export function invalidateRelationModelCache(project_id: number): void {
  relationModelCache.delete(project_id)
}

/**
 * Get the relation model of a project, loading it on first use.
 * Returns null when the project has no trained model.
 */
export async function getRelationModel(
  project_id: number,
): Promise<RelationModelBundle | null> {
  if (relationModelCache.has(project_id)) {
    return relationModelCache.get(project_id)!
  }
  let bundle = await loadRelationModel(project_id)
  relationModelCache.set(project_id, bundle)
  return bundle
}

/**
 * Load the relation model of a project into the cache and build the
 * scorers for it.
 *
 * Both modes are built up-front: the pair list is rendered by a
 * synchronous websocket component, so switching the mode later has to
 * be a cache lookup rather than an await.
 *
 * Call this before rendering the pair list: the scoring itself stays
 * synchronous, only the model loading is asynchronous.
 */
export async function preloadProjectScorer(options: {
  project_id: number
  mode?: SimilarityMode
  weight?: Float32Array | null
}): Promise<PairScorer> {
  let { project_id, mode = 'relation', weight = null } = options

  // the weighted scorer is cheap to build, so always have it ready
  let weighted = createWeightedScorer({ weight })
  weightedScorerCache.set(project_id, weighted)

  if (mode === 'relation') {
    let bundle = await getRelationModel(project_id)
    if (bundle) {
      let relation = createRelationScorer(bundle)
      relationScorerCache.set(project_id, relation)
      return relation
    }
  }

  relationScorerCache.delete(project_id)
  return weighted
}

/**
 * The relation scorer of a project, if it has been preloaded.
 */
let relationScorerCache = new Map<number, PairScorer>()

/**
 * The weighted scorer of a project, if it has been preloaded.
 */
let weightedScorerCache = new Map<number, PairScorer>()

/**
 * Get the scorer of a project without loading anything.
 *
 * Returns null when the project has not been preloaded — the caller
 * should then use `preloadProjectScorer` first.
 */
export function getPreloadedScorer(project_id: number): PairScorer | null {
  let mode = getSimilarityMode(project_id)
  if (mode === 'weighted') {
    return weightedScorerCache.get(project_id) ?? null
  }
  return (
    relationScorerCache.get(project_id) ?? weightedScorerCache.get(project_id) ?? null
  )
}

/**
 * The scoring mode the user picked for a project.
 *
 * 'relation' is the default (the trained model); 'weighted' is the
 * original per-dimension weight. The choice lives on the server
 * because the websocket component that renders the pair list has to
 * stay synchronous and cannot await a scorer.
 */
let similarityModeCache = new Map<number, SimilarityMode>()

/**
 * Which version of the page is shown: the new one (the trained model
 * plus the triplet annotation) or the legacy one (the weighted cosine
 * plus the pair ranking only).
 *
 * The legacy version is kept so a user who prefers the old workflow
 * can switch back without losing anything.
 */
export type UiVersion = 'new' | 'legacy'

let uiVersionCache = new Map<number, UiVersion>()

/**
 * The UI version of a project. Defaults to 'new'.
 */
export function getUiVersion(project_id: number): UiVersion {
  return uiVersionCache.get(project_id) ?? 'new'
}

/**
 * Set the UI version of a project.
 */
export function setUiVersion(options: {
  project_id: number
  version: UiVersion
}): void {
  let { project_id, version } = options
  uiVersionCache.set(project_id, version)
}

/**
 * The mode of a project. Defaults to 'relation'.
 */
export function getSimilarityMode(project_id: number): SimilarityMode {
  return similarityModeCache.get(project_id) ?? 'relation'
}

/**
 * Set the mode of a project.
 *
 * The scorers for both modes are built up-front (see preloadProjectScorer)
 * so switching between them is a cache lookup, not an await: the pair
 * list is rendered by a synchronous websocket component.
 */
export function setSimilarityMode(options: {
  project_id: number
  mode: SimilarityMode
}): void {
  let { project_id, mode } = options
  similarityModeCache.set(project_id, mode)
}

/**
 * Build the scorer for a mode without touching the cache.
 *
 * Used when the user explicitly asks for a mode (e.g. the weighted
 * cosine even though a relation model exists): the cached scorer is
 * bypassed so the choice takes effect immediately.
 */
export async function createScorerForMode(options: {
  project_id: number
  mode: SimilarityMode
  weight?: Float32Array | null
}): Promise<PairScorer> {
  let { project_id, mode, weight = null } = options
  if (mode === 'relation') {
    let bundle = await getRelationModel(project_id)
    if (bundle) return createRelationScorer(bundle)
  }
  return createWeightedScorer({ weight })
}

/**
 * The weighted cosine scorer: scales each dimension by the weight
 * vector before computing the cosine.
 */
export function createWeightedScorer(options: {
  weight: Float32Array | null
}): PairScorer {
  let { weight } = options

  let score = (a: Float32Array, b: Float32Array): number => {
    let dot = 0
    let normA = 0
    let normB = 0
    for (let i = 0; i < a.length; i++) {
      let valueA = weight ? a[i]! * weight[i]! : a[i]!
      let valueB = weight ? b[i]! * weight[i]! : b[i]!
      dot += valueA * valueB
      normA += valueA * valueA
      normB += valueB * valueB
    }
    if (normA === 0 || normB === 0) return 0
    return dot / (Math.sqrt(normA) * Math.sqrt(normB))
  }

  return {
    mode: 'weighted',
    score,
    scoreMany: pairs => pairs.map(pair => score(pair.a, pair.b)),
  }
}

/**
 * The relation model scorer: projects both embeddings with the shared
 * projector and scores the inner product of the projections.
 */
export function createRelationScorer(
  bundle: RelationModelBundle,
): PairScorer {
  let { projector, scorer, spec } = bundle

  let scoreBatch = (
    batchA: tfjs.Tensor,
    batchB: tfjs.Tensor,
  ): Float32Array => {
    return tf.tidy(() => {
      let projA = projector.apply(batchA) as tfjs.Tensor
      let projB = projector.apply(batchB) as tfjs.Tensor
      let inner = layers.dot({ axes: 1 }).apply([projA, projB]) as tfjs.Tensor
      return (scorer.apply(inner) as tfjs.Tensor).dataSync() as Float32Array
    }) as Float32Array
  }

  let score = (a: Float32Array, b: Float32Array): number => {
    let scores = scoreBatch(
      tf.tensor2d([Array.from(normalizeVector(a))], [1, spec.inputDims]),
      tf.tensor2d([Array.from(normalizeVector(b))], [1, spec.inputDims]),
    )
    return scores[0]!
  }

  let scoreMany = (pairs: { a: Float32Array; b: Float32Array }[]): number[] => {
    if (pairs.length === 0) return []
    let scores = scoreBatch(
      tf.tensor2d(
        pairs.map(pair => Array.from(normalizeVector(pair.a))),
        [pairs.length, spec.inputDims],
      ),
      tf.tensor2d(
        pairs.map(pair => Array.from(normalizeVector(pair.b))),
        [pairs.length, spec.inputDims],
      ),
    )
    return Array.from(scores)
  }

  return { mode: 'relation', score, scoreMany }
}

/**
 * Build the scorer of a project.
 *
 * The relation model is preferred (it is the default mode); the
 * weighted cosine is the fallback when the project has no trained model
 * yet.
 */
export async function createProjectScorer(options: {
  project_id: number
  mode?: SimilarityMode
  weight?: Float32Array | null
}): Promise<PairScorer> {
  let { project_id, mode = 'relation', weight = null } = options

  if (mode === 'relation') {
    let bundle = await getRelationModel(project_id)
    if (bundle) return createRelationScorer(bundle)
  }
  return createWeightedScorer({ weight })
}
