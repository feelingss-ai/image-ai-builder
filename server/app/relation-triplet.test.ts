import { expect } from 'chai'
import { db } from '../../db/db.js'
import {
  selectLastTriplet,
  deleteTriplet,
  hasTripletAnnotation,
  countTriplets,
  TRIPLET_SCHEMA_VERSION,
} from './relation-triplet.js'

// The triplet annotation table has foreign keys, so the tests use a
// real project, user and images. A dedicated user id keeps the test
// rows apart from the real annotations, and they are cleaned up after
// every test.
const TEST_PROJECT_ID = 17
const TEST_USER_ID = 3
// a second real user, to check that the undo only touches the
// annotations of the user who asks for it
const OTHER_USER_ID = 1
const TEST_IMAGE_A = 6093
const TEST_IMAGE_B = 6094
const TEST_IMAGE_C = 6095
// the test rows use ids from this range, so they can be cleaned up
// without touching the annotations of the real users
const FIRST_TEST_ID = 900000

function insertTriplet(options: {
  id: number
  user_id: number
  relation: number
  created_at: number
  schema_version: number | null
}) {
  db.prepare(
    /* sql */ `insert into similar_triplet
      (id, project_id, user_id, image_a_id, image_b_id, image_c_id, relation, created_at, schema_version)
      values (:id, :project_id, :user_id, :a, :b, :c, :relation, :created_at, :schema_version)`,
  ).run({
    id: options.id,
    project_id: TEST_PROJECT_ID,
    user_id: options.user_id,
    a: TEST_IMAGE_A,
    b: TEST_IMAGE_B,
    c: TEST_IMAGE_C,
    relation: options.relation,
    created_at: options.created_at,
    schema_version: options.schema_version,
  })
}

function cleanup() {
  // the test rows are the ones with the reserved ids — the other
  // annotations of the project belong to the real users
  db.prepare(
    /* sql */ `delete from similar_triplet where id >= :first_id`,
  ).run({ first_id: FIRST_TEST_ID })
}

describe('triplet undo', () => {
  beforeEach(cleanup)
  afterEach(cleanup)

  describe('selectLastTriplet', () => {
    it('should return null when the user has no annotation', () => {
      expect(selectLastTriplet(TEST_PROJECT_ID, TEST_USER_ID)).to.equal(null)
    })

    it('should return the most recent annotation of the user', () => {
      insertTriplet({
        id: 900001,
        user_id: TEST_USER_ID,
        relation: 0,
        created_at: 1000,
        schema_version: TRIPLET_SCHEMA_VERSION,
      })
      insertTriplet({
        id: 900002,
        user_id: TEST_USER_ID,
        relation: 2,
        created_at: 2000,
        schema_version: TRIPLET_SCHEMA_VERSION,
      })

      let last = selectLastTriplet(TEST_PROJECT_ID, TEST_USER_ID)
      expect(last).to.not.equal(null)
      expect(last!.id).to.equal(900002)
      expect(last!.relation).to.equal(2)
    })

    it('should not return the annotation of another user', () => {
      insertTriplet({
        id: 900003,
        user_id: OTHER_USER_ID,
        relation: 1,
        created_at: 3000,
        schema_version: TRIPLET_SCHEMA_VERSION,
      })

      expect(selectLastTriplet(TEST_PROJECT_ID, TEST_USER_ID)).to.equal(null)
      expect(selectLastTriplet(TEST_PROJECT_ID, OTHER_USER_ID)).to.not.equal(null)
    })

    it('should break the tie between annotations of the same second', () => {
      insertTriplet({
        id: 900004,
        user_id: TEST_USER_ID,
        relation: 0,
        created_at: 1000,
        schema_version: TRIPLET_SCHEMA_VERSION,
      })
      insertTriplet({
        id: 900005,
        user_id: TEST_USER_ID,
        relation: 1,
        created_at: 1000,
        schema_version: TRIPLET_SCHEMA_VERSION,
      })

      // the higher id is the later one
      expect(selectLastTriplet(TEST_PROJECT_ID, TEST_USER_ID)!.id).to.equal(900005)
    })

    it('should convert the relation of a legacy annotation', () => {
      insertTriplet({
        id: 900006,
        user_id: TEST_USER_ID,
        relation: 0,
        created_at: 1000,
        schema_version: null,
      })

      // legacy 0 = "a and b are the most similar" -> c is the odd one out
      expect(selectLastTriplet(TEST_PROJECT_ID, TEST_USER_ID)!.relation).to.equal(2)
    })
  })

  describe('deleteTriplet', () => {
    it('should delete the annotation', () => {
      insertTriplet({
        id: 900007,
        user_id: TEST_USER_ID,
        relation: 0,
        created_at: 1000,
        schema_version: TRIPLET_SCHEMA_VERSION,
      })

      expect(deleteTriplet(900007)).to.equal(true)
      expect(selectLastTriplet(TEST_PROJECT_ID, TEST_USER_ID)).to.equal(null)
    })

    it('should report false for an annotation that does not exist', () => {
      expect(deleteTriplet(900999)).to.equal(false)
    })
  })

  describe('hasTripletAnnotation', () => {
    it('should be false when the user has no annotation', () => {
      expect(hasTripletAnnotation(TEST_PROJECT_ID, TEST_USER_ID)).to.equal(false)
    })

    it('should be true when the user has an annotation', () => {
      insertTriplet({
        id: 900008,
        user_id: TEST_USER_ID,
        relation: 0,
        created_at: 1000,
        schema_version: TRIPLET_SCHEMA_VERSION,
      })

      expect(hasTripletAnnotation(TEST_PROJECT_ID, TEST_USER_ID)).to.equal(true)
    })

    it('should not see the annotation of another user', () => {
      insertTriplet({
        id: 900008,
        user_id: TEST_USER_ID,
        relation: 0,
        created_at: 1000,
        schema_version: TRIPLET_SCHEMA_VERSION,
      })

      // the other user's own annotations are not offered for undo
      expect(hasTripletAnnotation(TEST_PROJECT_ID, OTHER_USER_ID)).to.equal(
        selectLastTriplet(TEST_PROJECT_ID, OTHER_USER_ID) !== null,
      )
      // the annotation of the other user is not the one we added
      let other = selectLastTriplet(TEST_PROJECT_ID, OTHER_USER_ID)
      if (other) expect(other.id).to.not.equal(900008)
    })

    it('should be false again after the annotation is deleted', () => {
      insertTriplet({
        id: 900009,
        user_id: TEST_USER_ID,
        relation: 0,
        created_at: 1000,
        schema_version: TRIPLET_SCHEMA_VERSION,
      })
      deleteTriplet(900009)

      expect(hasTripletAnnotation(TEST_PROJECT_ID, TEST_USER_ID)).to.equal(false)
    })
  })

  describe('countTriplets', () => {
    it('should count the annotations of the project', () => {
      // the project may already have annotations from other users, so
      // the count is compared against the value before the test rows
      let before = countTriplets(TEST_PROJECT_ID)
      insertTriplet({
        id: 900010,
        user_id: TEST_USER_ID,
        relation: 0,
        created_at: 1000,
        schema_version: TRIPLET_SCHEMA_VERSION,
      })
      insertTriplet({
        id: 900011,
        user_id: TEST_USER_ID,
        relation: 1,
        created_at: 2000,
        schema_version: TRIPLET_SCHEMA_VERSION,
      })

      expect(countTriplets(TEST_PROJECT_ID)).to.equal(before + 2)
    })
  })
})
