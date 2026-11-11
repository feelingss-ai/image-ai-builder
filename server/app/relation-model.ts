import { tf } from 'tensorflow-helpers'
import { model, input, layers } from '@tensorflow/tfjs-layers'
import type { Dense } from '@tensorflow/tfjs-layers/dist/layers/core'
import type { SymbolicTensor, LayersModel } from '@tensorflow/tfjs-layers'
import type * as tfjs from '@tensorflow/tfjs'
import { join } from 'path'
import { existsSync, mkdirSync, readdirSync, rmSync } from 'fs'

/**
 * Shared similarity model for "find similar images".
 *
 * Replaces the diagonal weight vector (`embedding_weight`) with a small
 * trainable network:
 *
 *   Input A ---+
 *              +--> [Shared Projector: Dense(inputDims -> projDims, gelu)]
 *   Input B ---+          |            |
 *                         v            v
 *                     Proj A        Proj B
 *                         \            /
 *                          dot({axes:1})   = sum(projA * projB)
 *                               |
 *                    Dense(projDims -> 1, linear) = similarity score
 *
 * Why `dot` and not `|A-B|`:
 * In tfjs-layers, the `add` / `multiply` / `maximum` / `concatenate`
 * merge layers do not implement `computeOutputShape`, so a downstream
 * `Dense` cannot infer its input shape and throws
 * "Cannot read properties of undefined (reading 'length')". `dot` is the
 * only merge layer that propagates shape ([batch, 1]) and can therefore
 * feed a Dense layer.
 *
 * Why an inner product and not a cosine:
 * sum(projA * projB) is a weighted cosine in the projected space - it
 * replaces the diagonal matrix `diag(w)` of the old weight vector with
 * the full matrix `W^T W`, which is what allows dimensions to be mixed
 * (the "main object matters more than background" case that a diagonal
 * weight can never express). It is also symmetric:
 * sim(A,B) === sim(B,A) by construction.
 */

export const RELATION_MODEL_VERSION = 'relation-v1'

/**
 * Default projection width. Deliberately small: the available ranking
 * feedback is sparse (a few hundred constraints), so a wide projection
 * would overfit.
 */
export const DEFAULT_PROJ_DIMS = 64

export type RelationModelSpec = {
  inputDims: number
  projDims: number
  headUnits: number
}

export type RelationModelBundle = {
  spec: RelationModelSpec
  model: LayersModel
  /**
   * The layer instances must be kept around: the training loop re-applies
   * them to concrete tensors to compute gradients, and the graph built
   * from symbolic tensors cannot be reused for that.
   */
  projector: Dense
  scorer: Dense
  /**
   * The 4-way relation head, present only when the model was built
   * with `createRelationClassifierModel`. It answers "which two of
   * these three images are the most similar".
   */
  relationHead?: Dense
  /**
   * The 3-input relation model, present only when the bundle was built
   * with `createRelationClassifierModel`.
   */
  relationModel?: LayersModel
}

// ---------------------------------------------------------------------------
// the relation head
// ---------------------------------------------------------------------------

/**
 * The four possible relations between three images.
 *
 * The first three say which pair is the most similar (the third image
 * is the odd one out); the last one says all three are about equally
 * similar.
 */
export const RELATION_LABELS = [
  'a~b',
  'a~c',
  'b~c',
  'all equal',
] as const

export type RelationClass = 0 | 1 | 2 | 3

/**
 * A layer that concatenates several [batch, 1] tensors into a single
 * [batch, n] tensor.
 *
 * The built-in `concatenate` layer does not implement
 * `computeOutputShape`, so a `Dense` after it cannot infer its input
 * shape and throws "Cannot read properties of undefined (reading
 * 'length')". Doing the concatenation inside `call()` avoids that,
 * because the tensors are real there.
 */
class ConcatFeatures extends layers.Layer {
  static className = 'ConcatFeatures'

  getClassName() {
    return 'ConcatFeatures'
  }

  getConfig() {
    return {}
  }

  computeOutputShape(inputShape: tfjs.Shape[] | tfjs.Shape) {
    let first = Array.isArray(inputShape[0]) ? inputShape[0] : [inputShape[0]]
    return [first[0]!, inputShape.length]
  }

  call(inputs: tfjs.Tensor | tfjs.Tensor[]) {
    let list = Array.isArray(inputs) ? inputs : [inputs]
    return tf.concat(
      list.map(tensor => tf.reshape(tensor, [-1, 1])),
      -1,
    )
  }
}

// register the layer so a saved model can be loaded back from disk
tf.serialization.registerClass(ConcatFeatures)

/**
 * Build the 3-input relation model: the same shared projector as the
 * pair model, plus a head that classifies the relation between three
 * images into the four classes.
 *
 *   Input A ---+
 *              +--> [Shared Projector]
 *   Input B ---+          |    |    |
 *   Input C ---+          v    v    v
 *                      ProjA ProjB ProjC
 *                         \    |    /
 *                          pairwise dots
 *                          (AB, AC, BC)
 *                               |
 *                    ConcatFeatures -> [batch, 3]
 *                               |
 *                    Dense(3 -> 4, softmax) = relation class
 *
 * When `projector` is given, that layer instance is reused, so the
 * relation head and the pair scoring share the same weights — the
 * relation head then learns on top of the space the pair model already
 * established, and the two can be trained together.
 */
export function createRelationClassifierModel(spec: {
  inputDims: number
  projDims?: number
  /** an existing projector to reuse; a new one is created when omitted */
  projector?: Dense
}): {
  model: LayersModel
  projector: Dense
  relationHead: Dense
} {
  let { inputDims, projDims = DEFAULT_PROJ_DIMS } = spec

  let projector =
    spec.projector ??
    layers.dense({
      units: projDims,
      activation: 'gelu',
      name: 'projector',
    })
  let relationHead = layers.dense({
    units: RELATION_LABELS.length,
    activation: 'softmax',
    name: 'relation',
  })

  let inputA = input({ shape: [inputDims], name: 'a' })
  let inputB = input({ shape: [inputDims], name: 'b' })
  let inputC = input({ shape: [inputDims], name: 'c' })

  let projA = projector.apply(inputA) as SymbolicTensor
  let projB = projector.apply(inputB) as SymbolicTensor
  let projC = projector.apply(inputC) as SymbolicTensor

  let dotAB = layers.dot({ axes: 1 }).apply([projA, projB]) as SymbolicTensor
  let dotAC = layers.dot({ axes: 1 }).apply([projA, projC]) as SymbolicTensor
  let dotBC = layers.dot({ axes: 1 }).apply([projB, projC]) as SymbolicTensor

  let features = new ConcatFeatures().apply([
    dotAB,
    dotAC,
    dotBC,
  ]) as SymbolicTensor
  let output = relationHead.apply(features) as SymbolicTensor

  let relationModel = model({ inputs: [inputA, inputB, inputC], outputs: output })

  return { model: relationModel, projector, relationHead }
}

/**
 * L2-normalise a vector.
 *
 * The MobileNet embeddings have a norm of roughly 24, so the raw inner
 * product of two of them lands in the hundreds. Fed to a sigmoid
 * scorer that means every score saturates at 0 or 1 and all the ranking
 * information is lost - measured on the real dataset, an unnormalised
 * model scored 0% ranking accuracy while a normalised one scored 70%.
 *
 * Normalising the input turns the inner product into a cosine
 * similarity, which is bounded to [-1, 1] and keeps the sigmoid in its
 * useful range.
 */
export function normalizeVector(vector: Float32Array): Float32Array {
  let sum = 0
  for (let i = 0; i < vector.length; i++) {
    sum += vector[i]! * vector[i]!
  }
  let length = Math.sqrt(sum)
  if (length === 0) return vector
  let normalized = new Float32Array(vector.length)
  for (let i = 0; i < vector.length; i++) {
    normalized[i] = vector[i]! / length
  }
  return normalized
}

/**
 * Build the shared similarity model.
 */
export function createRelationModel(
  spec: RelationModelSpec,
): RelationModelBundle {
  let { inputDims, projDims, headUnits } = spec

  let projector = layers.dense({
    units: projDims,
    activation: 'gelu',
    name: 'projector',
  })
  let scorer = layers.dense({
    units: headUnits,
    // 'linear' keeps the score unbounded; a sigmoid saturates on
    // unnormalised embeddings and destroys the ranking information
    activation: 'linear',
    name: 'scorer',
  })

  let inputA = input({ shape: [inputDims], name: 'a' })
  let inputB = input({ shape: [inputDims], name: 'b' })

  // the same projector instance is applied to both inputs - shared weights
  let projA = projector.apply(inputA) as SymbolicTensor
  let projB = projector.apply(inputB) as SymbolicTensor

  // `dot` takes `axes` in its constructor args, NOT in apply()
  let innerProduct = layers.dot({ axes: 1 }).apply([projA, projB])
  let score = scorer.apply(innerProduct) as SymbolicTensor

  let relationModel = model({ inputs: [inputA, inputB], outputs: score })

  return { spec, model: relationModel, projector, scorer }
}

/**
 * Copy the weights of one projector into another.
 *
 * Used to seed the relation classifier's projector with the pair
 * model's weights (and the other way round), so the two heads learn on
 * top of the same feature space instead of each starting from a
 * different random projection.
 *
 * Returns false when the shapes do not match.
 */
export function copyProjectorWeights(
  from: Dense,
  to: Dense,
): boolean {
  let fromKernel = from.trainableWeights[0]
  let toKernel = to.trainableWeights[0]
  if (!fromKernel || !toKernel) return false
  let fromShape = fromKernel.shape
  let toShape = toKernel.shape
  if (fromShape[0] !== toShape[0] || fromShape[1] !== toShape[1]) return false

  let fromBias = from.trainableWeights[1]
  let toBias = to.trainableWeights[1]
  toKernel.write(
    tf.tensor2d(
      Float32Array.from(fromKernel.read().dataSync()),
      [fromShape[0]!, fromShape[1]!],
    ),
  )
  if (fromBias && toBias) {
    toBias.write(tf.tensor1d(Float32Array.from(fromBias.read().dataSync())))
  }
  return true
}

/**
 * Project a batch of raw embeddings and score them against another
 * batch. Returns one similarity score per pair.
 *
 * The embeddings are L2-normalised first, so the score is a cosine
 * similarity in the projected space. Both batches are projected in a
 * single call, so the projection cost is O(n·m) for n pairs rather
 * than O(n²·m).
 */
export function scorePairs(
  bundle: RelationModelBundle,
  pairs: { a: Float32Array; b: Float32Array }[],
): Float32Array {
  if (pairs.length === 0) return new Float32Array(0)
  let { projector, scorer, spec } = bundle

  return tf.tidy(() => {
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
    let scores = scorer.apply(inner) as tfjs.Tensor

    // dataSync() on a [n, 1] tensor returns a flat Float32Array of n values
    return scores.dataSync() as Float32Array
  }) as Float32Array
}

/**
 * Project a batch of embeddings, reusing the result for many pairs.
 * Use this when scoring a large candidate set: projecting each image
 * once and pairing the cached tensors avoids re-projecting the same
 * image for every pair it appears in.
 */
export function projectBatch(
  bundle: RelationModelBundle,
  vectors: Float32Array[],
): tfjs.Tensor {
  return tf.tidy(() => {
    let batch = tf.tensor2d(
      vectors.map(vector => Array.from(normalizeVector(vector))),
      [vectors.length, bundle.spec.inputDims],
    )
    return bundle.projector.apply(batch) as tfjs.Tensor
  })
}

/**
 * Score already-projected pairs.
 */
export function scoreProjected(
  bundle: RelationModelBundle,
  projA: tfjs.Tensor,
  projB: tfjs.Tensor,
): tfjs.Tensor {
  return tf.tidy(() => {
    let inner = layers.dot({ axes: 1 }).apply([projA, projB]) as tfjs.Tensor
    return bundle.scorer.apply(inner) as tfjs.Tensor
  })
}

function relationModelDir(project_id: number): string {
  return `saved_models/project-${project_id}/relation`
}

/**
 * Save the model to saved_models/project-{id}/relation/.
 *
 * `tensorflow-helpers`'s saveModel() only supports Sequential models, so
 * the Functional model is saved through its own IOHandler.
 */
export async function saveRelationModel(
  bundle: RelationModelBundle,
  project_id: number,
): Promise<string> {
  let dir = join(process.cwd(), relationModelDir(project_id))
  rmSync(dir, { recursive: true, force: true })
  // model.save() creates the directory, but not its parents
  mkdirSync(dir, { recursive: true })
  await bundle.model.save(`file://${dir}`)
  return relationModelDir(project_id)
}

/**
 * Load the model of a project. Returns null when the project has no
 * trained relation model �?callers should fall back to the weighted
 * cosine similarity.
 */
export async function loadRelationModel(
  project_id: number,
): Promise<RelationModelBundle | null> {
  let dir = join(process.cwd(), relationModelDir(project_id))
  if (!existsSync(join(dir, 'model.json'))) return null

  let loaded = await tf.loadLayersModel(`file://${dir}/model.json`)

  // find the layer instances by name so the training loop can re-apply them
  let projector = loaded.getLayer('projector') as Dense
  let scorer = loaded.getLayer('scorer') as Dense

  return {
    spec: {
      inputDims: loaded.inputs[0]!.shape[1]!,
      projDims: projector.weights[0]!.shape[1]!,
      headUnits: scorer.weights[0]!.shape[0]!,
    },
    model: loaded,
    projector,
    scorer,
  }
}

/**
 * Remove the saved relation model of a project (used when the project
 * is deleted, and by the tests to clean up).
 */
export function deleteRelationModel(project_id: number): void {
  let dir = join(process.cwd(), relationModelDir(project_id))
  rmSync(dir, { recursive: true, force: true })
  // remove the project directory too when it became empty, so the tests
  // do not leave empty folders behind — but never when it still holds
  // other models
  let projectDir = join(process.cwd(), `saved_models/project-${project_id}`)
  if (existsSync(projectDir)) {
    try {
      if (readdirSync(projectDir).length === 0) rmSync(projectDir, { recursive: true })
    } catch {
      // not empty (or not removable) — leave it alone
    }
  }
}
