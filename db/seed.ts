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
}

proxy.label[1] = {
  title: '🦞',
  dependency_id: null,
  project_id: 1,
}
proxy.label[2] = {
  title: '🍜',
  dependency_id: null,
  project_id: 1,
}
proxy.label[3] = {
  title: '💩',
  dependency_id: null,
  project_id: 1,
}
proxy.label[4] = {
  title: '開尾',
  dependency_id: 1,
  project_id: 1,
}
proxy.label[5] = {
  title: '舉鉗',
  dependency_id: 1,
  project_id: 1,
}
