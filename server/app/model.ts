import { loadModels } from 'image-dataset/dist/model'
import {
  calcHiddenLayerSize,
  loadGraphModel,
  loadImageClassifierModel,
  loadImageModel,
  PreTrainedImageModels,
} from 'tensorflow-helpers'
import { Label } from '../../db/proxy'
import { Tensor, Scalar } from '@tensorflow/tfjs'

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
  let bestClassifierModel = loadGraphModel({
    dir: `saved_models/label-${label.id}/best_model/model.json`,})
  return bestClassifierModel
}

export async function modelCheckpoint(label : Label, x : Tensor, y : Tensor) : Promise<boolean> {
  let latestClassifierModel = await getClassifierModel(label)
  let bestClassifierModel = await getBestClassifierModel(label)

  let [latestModelLoss, latestModelAccruacy] = getValueFromScalar(latestClassifierModel.classifierModel.evaluate(x, y)) as [number, number]
  let [bestModelLoss, bestModelAccruacy] = getValueFromScalar(bestClassifierModel.classifierModel.evaluate(x, y)) as [number, number]

  if(latestModelLoss < bestModelLoss) {
    return true
  }else{
    return false
  }
}

function getValueFromScalar(result: Scalar | Scalar[]){
  if (Array.isArray(result)) {
    return result.map((scalar) => scalar.dataSync()[0])
  } else {
    return result.dataSync()[0]
  }
}
  
