/**
 * Smoke test for the one-click auto label feature (Phase 1).
 *
 * Verifies the full plumbing: read an image from uploads/ -> send it to a
 * local vision model (Ollama / LM Studio, OpenAI-compatible) via img-read ->
 * parse the yes/no JSON answer.
 *
 * Usage:
 *   node.exe test-vlm.mts                     # 1 image, default prompt
 *   node.exe test-vlm.mts <image-filename>    # specific image from uploads/
 *   node.exe test-vlm.mts --label "cat"       # custom label in the prompt
 *   node.exe test-vlm.mts --count 5           # test N images sequentially
 *
 * Reads VLM_BASE_URL / VLM_MODEL / VLM_API_KEY from the environment
 * (same values as server/env.ts), falling back to local Ollama defaults.
 */
import { read_img } from 'img-read'
import { readdirSync } from 'fs'
import { join } from 'path'

let base_url = process.env.VLM_BASE_URL || 'http://localhost:11434/v1'
let model = process.env.VLM_MODEL || 'minicpm-v4.6'
let api_key = process.env.VLM_API_KEY || 'no-api-key'

// parse args
let label = 'the target object'
let count = 1
let specific: string | null = null
let args = process.argv.slice(2)
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--label') {
    label = args[++i] ?? label
  } else if (args[i] === '--count') {
    count = +(args[++i] ?? 1)
  } else if (!args[i]!.startsWith('--')) {
    specific = args[i]!
  }
}

let upload_dir = join(process.cwd(), 'uploads')
let files = readdirSync(upload_dir).filter(name =>
  /\.(png|jpe?g|gif|webp|bmp)$/i.test(name),
)
if (files.length === 0) {
  console.error(`no image files found in ${upload_dir}`)
  process.exit(1)
}

let targets = specific ? [specific] : files.slice(0, count)
console.log(
  `VLM smoke test: ${targets.length} image(s), ` +
    `base_url=${base_url}, model=${model}, label="${label}"\n`,
)

let ok = 0
let failed = 0
let start = Date.now()

for (let filename of targets) {
  let input = join(upload_dir, filename)
  let prompt =
    `Look at this image. Does it show ${label}? ` +
    `Answer with JSON only: {"answer":"yes"} or {"answer":"no"}. ` +
    `No other text.`
  let image_start = Date.now()
  try {
    let result = await read_img({
      input,
      prompt,
      base_url,
      model,
      api_key,
    })
    let elapsed = ((Date.now() - image_start) / 1000).toFixed(1)
    let content = result.content.trim()
    let answer: string | null = null
    try {
      let parsed = JSON.parse(content)
      answer = String(parsed.answer ?? '').toLowerCase()
    } catch {
      // model may wrap JSON in markdown fence or add prose — try to recover
      let match = content.match(/\{\s*"answer"\s*:\s*"(yes|no)"\s*\}/i)
      if (match) answer = match[1]!.toLowerCase()
    }
    if (answer === 'yes' || answer === 'no') {
      ok++
      console.log(`[OK] ${filename} -> ${answer} (${elapsed}s)`)
    } else {
      failed++
      console.log(
        `[UNPARSED] ${filename} (${elapsed}s)\n` +
          `  content: ${JSON.stringify(content)}\n` +
          `  refusal: ${JSON.stringify(result.refusal)}`,
      )
    }
  } catch (error) {
    failed++
    console.log(`[ERROR] ${filename}: ${String(error)}`)
  }
}

let total_elapsed = ((Date.now() - start) / 1000).toFixed(1)
console.log(
  `\ndone: ${ok} parsed, ${failed} failed/unparsed, ` +
    `${total_elapsed}s total ` +
    `(${(Number(total_elapsed) / targets.length).toFixed(1)}s per image)`,
)