/**
 * Accuracy test: run the VLM over annotated images of a project and compare
 * its yes/no answers against the human annotations in image_label.
 *
 * Usage:
 *   node.exe test-accuracy.mts <project_id> <label_id> [limit]
 * e.g.
 *   node.exe test-accuracy.mts 17 38 20
 */
import { proxy } from './dist/db/proxy.js'
import { filter } from 'better-sqlite3-proxy'
import { read_img } from 'img-read'
import { join } from 'path'

let project_id = +(process.argv[2] ?? 17)
let label_id = +(process.argv[3] ?? 0)
let limit = +(process.argv[4] ?? 20)

let label = proxy.label[label_id]
if (!label || label.project_id !== project_id) {
  console.error(`label ${label_id} not found in project ${project_id}`)
  process.exit(1)
}

let base_url = process.env.VLM_BASE_URL || 'http://localhost:11434/v1'
let model = process.env.VLM_MODEL || 'minicpm-v4.6'
let api_key = process.env.VLM_API_KEY || 'no-api-key'

let annotations = filter(proxy.image_label, { label_id })
console.log(
  `accuracy test: project ${project_id}, label [${label_id}] "${label.title}", ` +
    `${Math.min(limit, annotations.length)}/${annotations.length} annotated images, ` +
    `model=${model}\n`,
)

let prompt =
  `Look at this image. Does it show ${label.title}? ` +
  `Answer with JSON only: {"answer":"yes"} or {"answer":"no"}. ` +
  `No other text.`

let matrix = { tp: 0, tn: 0, fp: 0, fn: 0 }
let errors = 0
let start = Date.now()
let tested = 0

for (let annotation of annotations) {
  if (tested >= limit) break
  let image = proxy.image[annotation.image_id]
  if (!image) continue
  let truth = annotation.answer === 1 ? 'yes' : 'no'
  let input = join(process.cwd(), 'uploads', image.filename)
  let image_start = Date.now()
  tested++
  try {
    let result = await read_img({ input, prompt, base_url, model, api_key })
    let elapsed = ((Date.now() - image_start) / 1000).toFixed(1)
    let content = result.content.trim()
    let answer: string | null = null
    try {
      let parsed = JSON.parse(content)
      answer = String(parsed.answer ?? '').toLowerCase()
    } catch {
      let match = content.match(/\{\s*"answer"\s*:\s*"(yes|no)"\s*\}/i)
      if (match) answer = match[1]!.toLowerCase()
    }
    if (answer !== 'yes' && answer !== 'no') {
      errors++
      console.log(
        `[UNPARSED] ${image.filename} (${elapsed}s) ` +
          `content=${JSON.stringify(content)} refusal=${JSON.stringify(result.refusal)}`,
      )
      continue
    }
    let key =
      truth === 'yes'
        ? answer === 'yes'
          ? 'tp'
          : 'fn'
        : answer === 'no'
          ? 'tn'
          : 'fp'
    matrix[key]++
    let mark = answer === truth ? ' ✓' : ' ✗'
    console.log(
      `${mark} ${image.filename.slice(0, 12)}... truth=${truth} ai=${answer} (${elapsed}s)`,
    )
  } catch (error) {
    errors++
    console.log(`[ERROR] ${image.filename}: ${String(error)}`)
  }
}

let total_elapsed = ((Date.now() - start) / 1000).toFixed(1)
let correct = matrix.tp + matrix.tn
let accuracy = tested ? ((correct / tested) * 100).toFixed(1) : '0'
console.log(
  `\n=== result ===\n` +
    `tested: ${tested} (errors/unparsed: ${errors})\n` +
    `accuracy: ${correct}/${tested} = ${accuracy}%\n` +
    `confusion: tp=${matrix.tp} (yes→yes) tn=${matrix.tn} (no→no) ` +
    `fp=${matrix.fp} (no→yes) fn=${matrix.fn} (yes→no)\n` +
    `time: ${total_elapsed}s total` +
    (tested ? ` (${(Number(total_elapsed) / tested).toFixed(1)}s per image)` : ''),
)