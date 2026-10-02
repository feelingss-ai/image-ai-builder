import { seedRow } from 'better-sqlite3-proxy'
import { proxy } from './proxy'

// This file serve like the knex seed file.
//
// You can setup the database with initial config and sample data via the db proxy.

seedRow(proxy.method, { method: 'GET' })
seedRow(proxy.method, { method: 'POST' })
seedRow(proxy.method, { method: 'ws' })

proxy.user[1] = {
  username: 'demo',
  password_hash: null,
  email: 'demo@example.com',
  tel: '98765432',
  avatar: null,
  is_admin: true,
  nickname: 'Demo',
}

proxy.project[1] = {
  creator_id: 1,
  title: 'Lobster Pose',
  is_public: null,
}

proxy.label[1] = {
  display_order: 1,
  title: '🦞',
  dependency_id: null,
  project_id: 1,
  keypoint_template_id: null,
  children_collapsed: null,
  mutually_exclusive: null,
}
proxy.label[2] = {
  display_order: 2,
  title: '🍜',
  dependency_id: null,
  project_id: 1,
  keypoint_template_id: null,
  children_collapsed: null,
  mutually_exclusive: null,
}
proxy.label[3] = {
  display_order: 3,
  title: '💩',
  dependency_id: null,
  project_id: 1,
  keypoint_template_id: null,
  children_collapsed: null,
  mutually_exclusive: null,
}
proxy.label[4] = {
  display_order: 4,
  title: '開尾',
  dependency_id: 1,
  project_id: 1,
  keypoint_template_id: null,
  children_collapsed: null,
  mutually_exclusive: null,
}
proxy.label[5] = {
  display_order: 5,
  title: '舉鉗',
  dependency_id: 1,
  project_id: 1,
  keypoint_template_id: null,
  children_collapsed: null,
  mutually_exclusive: null,
}

// keypoint template: 2-point default (left eye + right eye) — the minimal
// template used by default. names/edges are JSON strings; edges reference
// keypoint indexes.
let eyeKeypointNames = ['eye_left', 'eye_right']
let eyeKeypointEdges: number[][] = []
let eyeKeypointTemplateId = proxy.keypoint_template.push({
  project_id: 1,
  title: 'eyes-2',
  names: JSON.stringify(eyeKeypointNames),
  edges: JSON.stringify(eyeKeypointEdges),
  flip_idx: null,
})
proxy.label[1].keypoint_template_id = eyeKeypointTemplateId

// 12-point dog skeleton (example of a richer template)
let dogKeypointNames = [
  'nose',
  'eye_left',
  'eye_right',
  'ear_left',
  'ear_right',
  'neck',
  'shoulder_left',
  'shoulder_right',
  'hip_left',
  'hip_right',
  'tail_base',
  'tail_tip',
]
let dogKeypointEdges = [
  [0, 1],
  [1, 2],
  [1, 3],
  [2, 4],
  [3, 5],
  [4, 5],
  [5, 6],
  [5, 7],
  [6, 8],
  [7, 9],
  [8, 10],
  [9, 10],
  [10, 11],
]
let dogKeypointTemplateId = proxy.keypoint_template.push({
  project_id: 1,
  title: 'dog-pose-12',
  names: JSON.stringify(dogKeypointNames),
  edges: JSON.stringify(dogKeypointEdges),
  flip_idx: null,
})
proxy.label[1].keypoint_template_id = dogKeypointTemplateId
