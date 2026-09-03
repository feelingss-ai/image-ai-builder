import { loadModels } from 'image-dataset/dist/model'
import {
  calcHiddenLayerSize,
  loadLayersModel,
  loadImageClassifierModel,
  loadImageModel,
  PreTrainedImageModels,
} from 'tensorflow-helpers'
import { Label, Project } from '../../db/proxy.js'
import * as tf from '@tensorflow/tfjs'
import { existsSync } from 'fs'
import { join } from 'path'

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

export async function getClassifierModel(label: Label, project_id: number) {
  let classifierModelPromise = classifierModelCache[label.title]
  if (!classifierModelPromise) {
    classifierModelPromise = loadImageClassifierModel({
      baseModel,
      modelDir: `saved_models/project-${project_id}/latest/label-${label.id}`,
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
    classifierModelCache[`project-${project_id}-${label.title}`] =
      classifierModelPromise
  }
  return classifierModelPromise
}

export async function getBestClassifierModel(label: Label, project_id: number) {
  let bestClassifierModelPromise = loadImageClassifierModel({
    baseModel,
    modelDir: `saved_models/project-${project_id}/best/label-${label.id}`,
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
  classifierModelCache[`project-${project_id}-${label.title}-best`] =
    bestClassifierModelPromise
  return bestClassifierModelPromise
}

export async function modelCheckpoint(option: {
  label: Label
  x: tf.Tensor
  y: tf.Tensor
  project_id: number
}) {
  let { label, x, y, project_id } = option
  let latestModel = await getClassifierModel(label, project_id)
  let bestModel = await getBestClassifierModel(label, project_id)

  latestModel.compile()
  bestModel.compile()

  let [latestModelLoss, latestModelAccruacy] = getValueFromScalar(
    latestModel.classifierModel.evaluate(x, y),
  ) as [number, number]

  let [bestModelLoss, bestModelAccruacy] = getValueFromScalar(
    bestModel.classifierModel.evaluate(x, y),
  ) as [number, number]

  let bestDir = `saved_models/project-${project_id}/best/label-${label.id}`
  let hasBest = existsSync(join(bestDir, 'model.json'))

  // Save the first best checkpoint unconditionally; afterwards only save when
  // the latest model improves on it. Without this, a label with no best yet
  // would compare against a fresh untrained model whose loss can be lower by
  // chance, so best would never be saved.
  if (!hasBest || latestModelLoss < bestModelLoss) {
    console.log(
      `Latest Model ${label.title} Loss: ${latestModelLoss}, Best Model ${label.title} Loss: ${bestModelLoss}`,
    )
    await latestModel.save(bestDir)
    await latestModel.save()
    delete classifierModelCache[label.title + '-best']
  } else {
    console.log(`Model ${label.title} no improve`)
  }
}

export function compileModel(model: Model, learningRate: number) {
  model.classifierModel.compile({
    optimizer: tf.train.sgd(learningRate),
    loss: tf.metrics.categoricalCrossentropy,
    metrics: [tf.metrics.categoricalAccuracy],
  })
}

function getValueFromScalar(result: tf.Scalar | tf.Scalar[]) {
  if (Array.isArray(result)) {
    return result.map(scalar => scalar.dataSync()[0])
  } else {
    return result.dataSync()[0]
  }
}
