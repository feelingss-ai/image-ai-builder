/** List labels and image counts for a project (ad-hoc inspection script). */
import { proxy } from './dist/db/proxy.js'
import { filter } from 'better-sqlite3-proxy'

let project_id = +(process.argv[2] ?? 17)
let project = proxy.project[project_id]
if (!project) {
  console.error(`project ${project_id} not found`)
  process.exit(1)
}
console.log(`project ${project_id}: ${project.title}`)

let labels = filter(proxy.label, { project_id })
console.log(`\nlabels (${labels.length}):`)
for (let label of labels) {
  let answers = filter(proxy.image_label, { label_id: label.id })
  let yes = answers.filter(a => a.answer === 1).length
  let no = answers.filter(a => a.answer === 0).length
  console.log(
    `  [${label.id}] "${label.title}" ` +
      `(dependency_id: ${label.dependency_id ?? 'none'}) — ` +
      `annotated: ${yes} yes / ${no} no / ${answers.length} total`,
  )
}

let images = filter(proxy.image, { project_id })
console.log(`\nimages: ${images.length}`)
console.log(`first 5 filenames:`)
for (let image of images.slice(0, 5)) {
  console.log(`  ${image.filename}`)
}