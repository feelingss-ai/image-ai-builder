import { expect } from 'chai'
import type * as tfjs from '@tensorflow/tfjs'
import { tf } from 'tensorflow-helpers'
import {
  createRelationModel,
  createRelationClassifierModel,
  saveRelationModel,
  loadRelationModel,
  deleteRelationModel,
  scorePairs,
  normalizeVector,
  RELATION_LABELS,
  type RelationModelBundle,
} from './relation-model.js'
import { splitBySession, type RankingConstraint } from './relation-training.js'
import {
  trainRelationModelOnData,
  evaluateRanking,
} from './relation-training.js'

describe('createRelationModel', () => {
  it('should share the projector weights between both inputs', () => {
    let bundle = createRelationModel({
      inputDims: 1280,
      projDims: 64,
      headUnits: 1,
    })
    // the projector holds all the embedding parameters
    expect(bundle.projector.countParams()).to.equal(1280 * 64 + 64)
    // the scorer takes the dot product (1 value) as input
    expect(bundle.scorer.countParams()).to.equal(1 + 1)
    // the model must not hold a second copy of the projector
    expect(bundle.model.countParams()).to.equal(
      bundle.projector.countParams() + bundle.scorer.countParams(),
    )
  })

  it('should not grow the projector when applied to more inputs', () => {
    let bundle = createRelationModel({
      inputDims: 8,
      projDims: 4,
      headUnits: 1,
    })
    let before = bundle.projector.countParams()
    let kernelBefore = bundle.projector.getWeights()[0]!.shape

    // re-applying the same layer instance must reuse the same weights
    bundle.projector.apply(tf.tensor2d([[1, 2, 3, 4, 5, 6, 7, 8]]))

    expect(bundle.projector.countParams()).to.equal(before)
    expect(bundle.projector.getWeights()[0]!.shape).to.deep.equal(kernelBefore)
  })

  it('should produce a symmetric similarity score', () => {
    let bundle = createRelationModel({
      inputDims: 8,
      projDims: 4,
      headUnits: 1,
    })
    let a = tf.tensor2d([[1, 2, 3, 4, 5, 6, 7, 8]])
    let b = tf.tensor2d([[8, 7, 6, 5, 4, 3, 2, 1]])

    let scoreAB = (bundle.model.predict([a, b]) as tfjs.Tensor).dataSync()[0]!
    let scoreBA = (bundle.model.predict([b, a]) as tfjs.Tensor).dataSync()[0]!

    expect(scoreAB).to.be.closeTo(scoreBA, 1e-6)
  })

  it('should return an unbounded score with a linear scorer', () => {
    let bundle = createRelationModel({
      inputDims: 8,
      projDims: 4,
      headUnits: 1,
    })
    let a = tf.tensor2d([[1, 2, 3, 4, 5, 6, 7, 8]])
    let b = tf.tensor2d([[3, 1, 4, 1, 5, 9, 2, 6]])
    let score = (bundle.model.predict([a, b]) as tfjs.Tensor).dataSync()[0]!
    // the scorer is linear on purpose: a sigmoid saturates on the raw
    // MobileNet embeddings (norm ~24) and destroys the ranking
    expect(score).to.be.a('number')
    expect(Number.isNaN(score)).to.equal(false)
  })
})

describe('createRelationClassifierModel', () => {
  it('should build a 3-input model with a 4-way output', () => {
    let { model, projector, relationHead } = createRelationClassifierModel({
      inputDims: 1280,
      projDims: 32,
    })
    expect(model.inputs.length).to.equal(3)
    expect(model.outputs.length).to.equal(1)
    expect(model.outputs[0]!.shape[1]).to.equal(RELATION_LABELS.length)
    expect(RELATION_LABELS.length).to.equal(4)
    // the projector is shared between the three inputs
    expect(projector.countParams()).to.equal(1280 * 32 + 32)
    expect(relationHead.countParams()).to.equal(3 * 4 + 4)
  })

  it('should produce probabilities that sum to one', () => {
    let { model } = createRelationClassifierModel({
      inputDims: 8,
      projDims: 4,
    })
    let result = model.predict([
      tf.tensor2d([[1, 2, 3, 4, 5, 6, 7, 8]]),
      tf.tensor2d([[2, 2, 3, 4, 5, 6, 7, 8]]),
      tf.tensor2d([[0, 0, 0, 0, 0, 0, 0, 1]]),
    ]) as tfjs.Tensor
    let values = result.dataSync()
    expect(values.length).to.equal(4)
    let sum = 0
    for (let value of values) sum += value
    expect(sum).to.be.closeTo(1, 1e-5)
  })

  it('should give the same result for the same input', () => {
    let { model } = createRelationClassifierModel({
      inputDims: 8,
      projDims: 4,
    })
    let inputs = [
      tf.tensor2d([[1, 2, 3, 4, 5, 6, 7, 8]]),
      tf.tensor2d([[2, 2, 3, 4, 5, 6, 7, 8]]),
      tf.tensor2d([[0, 0, 0, 0, 0, 0, 0, 1]]),
    ]
    let first = (model.predict(inputs) as tfjs.Tensor).dataSync()
    let second = (model.predict(inputs) as tfjs.Tensor).dataSync()
    expect(Array.from(first)).to.deep.equal(Array.from(second))
  })
})

describe('normalizeVector', () => {
  it('should scale a vector to unit length', () => {
    let vector = new Float32Array([3, 4])
    let normalized = normalizeVector(vector)
    let sum = 0
    for (let value of normalized) sum += value * value
    expect(Math.sqrt(sum)).to.be.closeTo(1, 1e-6)
    expect(normalized[0]).to.be.closeTo(0.6, 1e-6)
    expect(normalized[1]).to.be.closeTo(0.8, 1e-6)
  })

  it('should keep the direction', () => {
    let normalized = normalizeVector(new Float32Array([2, 4, 6]))
    expect(normalized[0]! / normalized[1]!).to.be.closeTo(0.5, 1e-6)
  })

  it('should not divide by zero', () => {
    let normalized = normalizeVector(new Float32Array([0, 0, 0]))
    expect(normalized.length).to.equal(3)
    for (let value of normalized) expect(value).to.equal(0)
  })
})

describe('scorePairs', () => {
  it('should score each pair', () => {
    let bundle = createRelationModel({
      inputDims: 4,
      projDims: 2,
      headUnits: 1,
    })
    let a = new Float32Array([1, 2, 3, 4])
    let b = new Float32Array([1, 2, 3, 4])
    let c = new Float32Array([4, 3, 2, 1])

    let scores = scorePairs(bundle, [
      { a, b },
      { a, b: c },
    ])

    expect(scores.length).to.equal(2)
    // the scorer is linear, so the values are unbounded
    for (let score of scores) {
      expect(score).to.be.a('number')
      expect(Number.isNaN(score)).to.equal(false)
    }
  })

  it('should be deterministic', () => {
    let bundle = createRelationModel({
      inputDims: 4,
      projDims: 2,
      headUnits: 1,
    })
    let a = new Float32Array([1, 2, 3, 4])
    let b = new Float32Array([4, 3, 2, 1])

    let first = scorePairs(bundle, [{ a, b }])
    let second = scorePairs(bundle, [{ a, b }])
    expect(first[0]).to.equal(second[0])
  })

  it('should return an empty array for no pairs', () => {
    let bundle = createRelationModel({
      inputDims: 4,
      projDims: 2,
      headUnits: 1,
    })
    expect(scorePairs(bundle, []).length).to.equal(0)
  })
})

describe('saveRelationModel / loadRelationModel', () => {
  // use a project id that does not exist so no real model is overwritten
  let project_id = 999999

  afterEach(() => {
    deleteRelationModel(project_id)
  })

  it('should return null when the project has no model', async () => {
    let loaded = await loadRelationModel(project_id)
    expect(loaded).to.equal(null)
  })

  it('should round-trip through save and load', async () => {
    let bundle = createRelationModel({
      inputDims: 8,
      projDims: 4,
      headUnits: 1,
    })
    let a = tf.tensor2d([[1, 2, 3, 4, 5, 6, 7, 8]])
    let b = tf.tensor2d([[3, 1, 4, 1, 5, 9, 2, 6]])
    let before = (bundle.model.predict([a, b]) as tfjs.Tensor).dataSync()[0]!

    await saveRelationModel(bundle, project_id)

    let loaded = await loadRelationModel(project_id)
    expect(loaded).to.not.equal(null)

    let after = (loaded!.model.predict([a, b]) as tfjs.Tensor).dataSync()[0]!
    expect(after).to.be.closeTo(before, 1e-6)
  })

  it('should restore the spec on load', async () => {
    let bundle = createRelationModel({
      inputDims: 16,
      projDims: 8,
      headUnits: 1,
    })
    await saveRelationModel(bundle, project_id)

    let loaded = await loadRelationModel(project_id)
    expect(loaded!.spec.inputDims).to.equal(16)
    expect(loaded!.spec.projDims).to.equal(8)
    expect(loaded!.spec.headUnits).to.equal(1)
  })

  it('should expose the layer instances needed for training', async () => {
    let bundle = createRelationModel({
      inputDims: 8,
      projDims: 4,
      headUnits: 1,
    })
    await saveRelationModel(bundle, project_id)

    let loaded = (await loadRelationModel(project_id)) as RelationModelBundle
    // the training loop re-applies these layers to concrete tensors
    expect(loaded.projector).to.not.equal(undefined)
    expect(loaded.scorer).to.not.equal(undefined)
    expect(loaded.projector.countParams()).to.equal(8 * 4 + 4)
  })
})

describe('splitBySession', () => {
  it('should split by session, not randomly', () => {
    let constraints: RankingConstraint[] = [
      { winner: { a: 1, b: 2 }, loser: { a: 3, b: 4 }, session: 0 },
      { winner: { a: 5, b: 6 }, loser: { a: 7, b: 8 }, session: 1 },
    ]
    let { train, val } = splitBySession(constraints, 0.5)

    expect(train.length + val.length).to.equal(2)
    expect(val.length).to.be.greaterThan(0)

    // no session may appear in both sets
    let trainSessions = new Set(train.map(c => c.session))
    for (let constraint of val) {
      expect(trainSessions.has(constraint.session)).to.equal(false)
    }
  })

  it('should handle an empty constraint list', () => {
    let { train, val } = splitBySession([], 0.2)
    expect(train.length).to.equal(0)
    expect(val.length).to.equal(0)
  })

  it('should keep every constraint', () => {
    let constraints: RankingConstraint[] = []
    for (let session = 0; session < 10; session++) {
      constraints.push({
        winner: { a: session * 2, b: session * 2 + 1 },
        loser: { a: 100 + session * 2, b: 100 + session * 2 + 1 },
        session,
      })
    }
    let { train, val } = splitBySession(constraints, 0.2)
    expect(train.length + val.length).to.equal(constraints.length)
  })
})

describe('trainRelationModelOnData', () => {
  // the model takes 1280-dim embeddings, matching the real pipeline
  const DIMS = 1280

  /**
   * Build a set of vectors where each "group" shares a distinct
   * direction, so a model that learns the grouping can rank a
   * within-group pair above a cross-group pair.
   *
   * The vectors are L2-normalised, mirroring the real pipeline where
   * the embeddings are compared by cosine similarity.
   */
  function makeGroupedVectors(groups: number, perGroup: number) {
    let vectors: Float32Array[] = []
    let groupOf: number[] = []
    for (let g = 0; g < groups; g++) {
      // a distinct basis direction per group
      let base = new Float32Array(DIMS)
      base[g * 7 % DIMS] = 1
      base[(g * 7 + 1) % DIMS] = 1
      for (let i = 0; i < perGroup; i++) {
        let vector = new Float32Array(DIMS)
        let sum = 0
        for (let d = 0; d < DIMS; d++) {
          vector[d] = base[d]! + (Math.random() - 0.5) * 0.01
          sum += vector[d]! * vector[d]!
        }
        let length = Math.sqrt(sum) || 1
        for (let d = 0; d < DIMS; d++) vector[d] = vector[d]! / length
        vectors.push(vector)
        groupOf.push(g)
      }
    }
    return { vectors, groupOf }
  }

  it('should return null when there is not enough feedback', () => {
    let { vectors } = makeGroupedVectors(2, 2)
    let result = trainRelationModelOnData({
      data: {
        constraints: [
          {
            winner: { a: 0, b: 1 },
            loser: { a: 2, b: 3 },
            session: 0,
          },
        ],
        getVector: id => vectors[id]!,
      },
    })
    expect(result).to.equal(null)
  })

  it('should learn to rank a within-group pair above a cross-group pair', () => {
    let groups = 4
    let perGroup = 6
    let { vectors, groupOf } = makeGroupedVectors(groups, perGroup)

    // Build constraints: a within-group pair must beat a cross-group
    // pair. The winner pair has to be within the same group, otherwise
    // the constraints would contradict each other.
    let constraints: RankingConstraint[] = []
    for (let i = 0; i < vectors.length; i++) {
      for (let j = i + 1; j < vectors.length; j++) {
        if (groupOf[i] !== groupOf[j]) continue
        let other = vectors.findIndex((_, index) => groupOf[index] !== groupOf[i])
        if (other < 0) continue
        constraints.push({
          winner: { a: i, b: j },
          loser: { a: i, b: other },
          session: 0,
        })
      }
    }

    let result = trainRelationModelOnData({
      data: { constraints, getVector: id => vectors[id]! },
      projDims: 32,
      epochs: 30,
      learningRate: 0.05,
      margin: 0.2,
    })

    expect(result).to.not.equal(null)

    // the trained model must order the pairs the way the constraints say
    let accuracy = evaluateRanking(
      result!.bundle,
      constraints,
      id => vectors[id]!,
    )
    expect(accuracy).to.be.greaterThan(0.9)
  })

  it('should reduce the loss while training', () => {
    let { vectors } = makeGroupedVectors(3, 4)
    let constraints: RankingConstraint[] = []
    for (let i = 0; i < vectors.length; i += 2) {
      constraints.push({
        winner: { a: i, b: i + 1 },
        loser: { a: (i + 2) % vectors.length, b: (i + 3) % vectors.length },
        session: 0,
      })
    }

    let losses: number[] = []
    let result = trainRelationModelOnData({
      data: { constraints, getVector: id => vectors[id]! },
      projDims: 16,
      epochs: 25,
      learningRate: 0.05,
      onProgress: (_epoch, loss) => losses.push(loss),
    })

    expect(result).to.not.equal(null)
    expect(losses.length).to.equal(25)
    // the loss must go down over the run
    expect(losses[losses.length - 1]!).to.be.lessThan(losses[0]!)
  })

  it('should keep the best epoch when a validation set is given', () => {
    let { vectors } = makeGroupedVectors(3, 6)
    let train: RankingConstraint[] = []
    let validation: RankingConstraint[] = []
    for (let i = 0; i < vectors.length; i += 2) {
      train.push({
        winner: { a: i, b: i + 1 },
        loser: { a: (i + 2) % vectors.length, b: (i + 3) % vectors.length },
        session: 0,
      })
      validation.push({
        winner: { a: i, b: i + 1 },
        loser: { a: (i + 4) % vectors.length, b: (i + 5) % vectors.length },
        session: 1,
      })
    }

    let accuracies: number[] = []
    let result = trainRelationModelOnData({
      data: { constraints: train, validation, getVector: id => vectors[id]! },
      projDims: 16,
      epochs: 20,
      learningRate: 0.05,
      onValidation: (_epoch, accuracy) => accuracies.push(accuracy),
    })

    expect(result).to.not.equal(null)
    expect(accuracies.length).to.be.greaterThan(0)
    expect(result!.validationAccuracy).to.not.equal(null)
    expect(result!.bestEpoch).to.be.at.least(1)
    // the reported accuracy must be the best one seen
    expect(result!.validationAccuracy!).to.equal(Math.max(...accuracies))
  })

  it('should stop early when the validation accuracy stops improving', () => {
    let { vectors } = makeGroupedVectors(3, 6)
    let train: RankingConstraint[] = []
    let validation: RankingConstraint[] = []
    for (let i = 0; i < vectors.length; i += 2) {
      train.push({
        winner: { a: i, b: i + 1 },
        loser: { a: (i + 2) % vectors.length, b: (i + 3) % vectors.length },
        session: 0,
      })
      validation.push({
        winner: { a: i, b: i + 1 },
        loser: { a: (i + 4) % vectors.length, b: (i + 5) % vectors.length },
        session: 1,
      })
    }

    let epochsSeen = 0
    let result = trainRelationModelOnData({
      data: { constraints: train, validation, getVector: id => vectors[id]! },
      projDims: 16,
      epochs: 100,
      patience: 3,
      learningRate: 0.05,
      onProgress: () => epochsSeen++,
    })

    expect(result).to.not.equal(null)
    // early stopping must kick in well before the 100 epochs
    expect(epochsSeen).to.be.lessThan(100)
    expect(result!.bestEpoch).to.be.at.least(1)
  })
})
