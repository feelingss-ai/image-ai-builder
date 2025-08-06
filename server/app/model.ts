import { loadModels } from 'image-dataset/dist/model'
import {
  calcHiddenLayerSize,
  loadLayersModel,
  loadImageClassifierModel,
  loadImageModel,
  PreTrainedImageModels,
} from 'tensorflow-helpers'
import { Label } from '../../db/proxy'
import { Tensor, Scalar, models } from '@tensorflow/tfjs'

// label -> model
let classifierModelCache: Record<string, Promise<Model>> = {}

// filename -> number[] (for base image model)
let embeddingCache = new Map<string, number[]>()

export type Model = Awaited<ReturnType<typeof loadImageClassifierModel>>

export let baseModel = await loadImageModel({
  spec: PreTrainedImageModels.mobilenet['mobilenet-v3-large-100'],
  dir: `saved_models/mobilenet-v3-large-100`,
  cache: embeddingCache,
})

export async function getClassifierModel(label: Label) {
  let classifierModelPromise = classifierModelCache[label.title]
  if (!classifierModelPromise) {
    classifierModelPromise = loadImageClassifierModel({
      baseModel,
      modelDir: `saved_models/label-${label.id}`,
      datasetDir: `datasets/label-${label.id}`,
      classNames: ['yes', 'no'],
      hiddenLayers: [
        calcHiddenLayerSize({
          inputSize: baseModel.spec.features,
          outputSize: 2,
          // 1 to 5
          // 1 is easiest
          // 5 is hardest
          difficulty: 3,
        }),
      ],
    })
    classifierModelCache[label.title] = classifierModelPromise
  }
  return classifierModelPromise
}

export async function getBestClassifierModel(label: Label) {
  let bestClassifierModelPromise = classifierModelCache[label.title + '-best']

  if (!bestClassifierModelPromise) {
    bestClassifierModelPromise = loadImageClassifierModel({
      baseModel,
      modelDir: `saved_models/label-${label.id}/best`,
      datasetDir: `datasets/label-${label.id}`,
      classNames: ['yes', 'no'],
      hiddenLayers: [
        calcHiddenLayerSize({
          inputSize: baseModel.spec.features,
          outputSize: 2,
          // 1 to 5
          // 1 is easiest
          // 5 is hardest
          difficulty: 3,
        }),
      ],
    })
    classifierModelCache[label.title + '-best'] = bestClassifierModelPromise
  }
  return bestClassifierModelPromise
}

export async function modelCheckpoint(label: Label, x: Tensor, y: Tensor) {
  let latestClassifierModel = await getClassifierModel(label)
  let bestClassifierModel = await getBestClassifierModel(label)
  bestClassifierModel.compile()
  let [latestModelLoss, latestModelAccruacy] = getValueFromScalar(
    latestClassifierModel.classifierModel.evaluate(x, y),
  ) as [number, number]

  let [bestModelLoss, bestModelAccruacy] = getValueFromScalar(
    bestClassifierModel.classifierModel.evaluate(x, y),
  ) as [number, number]
  console.log(
    `Label${label.id} Latest model loss: ${latestModelLoss}, Best Model loss: ${bestModelLoss}`,
  )
  if (latestModelLoss < bestModelLoss) {
    return true
  } else {
    return false
  }
}

function getValueFromScalar(result: Scalar | Scalar[]) {
  if (Array.isArray(result)) {
    return result.map(scalar => scalar.dataSync()[0])
  } else {
    return result.dataSync()[0]
  }
}
