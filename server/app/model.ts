import { loadModels } from 'image-dataset/dist/model'
import {
  calcHiddenLayerSize,
  loadLayersModel,
  loadImageClassifierModel,
  loadImageModel,
  PreTrainedImageModels,
} from 'tensorflow-helpers'
import { Label } from '../../db/proxy'
import * as tf from '@tensorflow/tfjs'

// label -> model
export let classifierModelCache: Record<string, Promise<Model>> = {}

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

export async function modelCheckpoint(
  label: Label,
  x: tf.Tensor,
  y: tf.Tensor,
) {
  let latestModel = await getClassifierModel(label)
  let bestModel = await getBestClassifierModel(label)
  latestModel.compile()
  bestModel.compile()
  let [latestModelLoss, latestModelAccruacy] = getValueFromScalar(
    latestModel.classifierModel.evaluate(x, y),
  ) as [number, number]

  let [bestModelLoss, bestModelAccruacy] = getValueFromScalar(
    bestModel.classifierModel.evaluate(x, y),
  ) as [number, number]
  console.log(`Latest Model ${label.title} Loss: ${latestModelLoss}`)
  console.log(`Best Model ${label.title} Loss: ${bestModelLoss}`)

  if (latestModelLoss < bestModelLoss) {
    await latestModel.save(`saved_models/label-${label.id}/best`)
    delete classifierModelCache[label.title + '-best']
    await getBestClassifierModel(label)
  }
}

export function compileModel(model: Model, learningRate: number) {
  if (learningRate === 0) {
    model.classifierModel.compile({
      optimizer: 'Adam',
      loss: tf.metrics.categoricalCrossentropy,
      metrics: [tf.metrics.categoricalAccuracy],
    })
  } else {
    model.classifierModel.compile({
      optimizer: tf.train.sgd(learningRate),
      loss: tf.metrics.categoricalCrossentropy,
      metrics: [tf.metrics.categoricalAccuracy],
    })
  }
}

export async function reloadModel(label: Label) {
  classifierModelCache[label.title + '-best'] = loadImageClassifierModel({
    baseModel,
    modelDir: `saved_models/label-${label.id}/best`,
    datasetDir: `datasets/label-${label.id}`,
    classNames: ['yes', 'no'],
    hiddenLayers: [
      calcHiddenLayerSize({
        inputSize: baseModel.spec.features,
        outputSize: 2,
        difficulty: 3,
      }),
    ],
  })
}

function getValueFromScalar(result: tf.Scalar | tf.Scalar[]) {
  if (Array.isArray(result)) {
    return result.map(scalar => scalar.dataSync()[0])
  } else {
    return result.dataSync()[0]
  }
}
