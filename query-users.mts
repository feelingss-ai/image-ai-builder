import { proxy } from './db/proxy.js'
const users = proxy.user.map(u => ({
  id: u.id,
  username: u.username,
  email: u.email,
  tel: u.tel,
}))
console.log(JSON.stringify(users))
const projects = proxy.project.map(p => ({ id: p.id, title: p.title, creator_id: p.creator_id }))
console.log(JSON.stringify(projects))
