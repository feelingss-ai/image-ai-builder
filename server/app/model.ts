import { loadModels } from 'image-dataset/dist/model'
import {
  calcHiddenLayerSize,
  loadImageClassifierModel,
  loadImageModel,
  PreTrainedImageModels,
} from 'tensorflow-helpers'
import { Label } from '../../db/proxy'

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
