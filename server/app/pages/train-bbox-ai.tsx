import { createHash, randomUUID } from 'node:crypto'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { db } from '../../../db/db.js'
import { proxy } from '../../../db/proxy.js'
import { env } from '../../env.js'
import { canEditProject, canViewProject } from '../context/project-context.js'
import { getAuthUser } from '../auth/user.js'
import { DynamicContext, ExpressContext } from '../context.js'
import { Routes } from '../routes.js'
import { ajaxRoute } from '../api-route.js'
import { mapArray } from '../components/fragment.js'
import { ProjectPageBackButton } from '../components/project-page-back-button.js'
import { IonButton } from '../components/ion-button.js'
import { Locale, ProjectPageTitle } from '../components/locale.js'
import { NoAccessMessage } from '../components/no-access-message.js'
import { NoProjectMessage } from '../components/no-project-message.js'
import { Script } from '../components/script.js'
import Style from '../components/style.js'
import { o } from '../jsx/jsx.js'

type BBoxSample = {
  id: string
  imagePath: string
  width: number
  height: number
  boxes: { category: string; xyxy: [number, number, number, number]; clamped: boolean }[]
}
type BBoxJob = {
  projectId: number; labelId: number; runId: string; outputDirectory: string
  status: 'preparing' | 'running' | 'completed' | 'failed' | 'failed-quality-gate'
  progress: Record<string, unknown> | null; error?: string; child?: ChildProcessWithoutNullStreams
}
let jobs = new Map<string, BBoxJob>()
let title = <Locale en="Train Bounding Box AI" zh_hk="訓練 Bounding Box AI" zh_cn="训练 Bounding Box AI" />
let style = Style(/* css */ `
#TrainBBoxAI .summary { display:flex; gap:1rem; flex-wrap:wrap; margin:1rem 0; }
#TrainBBoxAI .summary-card { padding:1rem; background:var(--ion-color-light); border-radius:.5rem; min-width:9rem; }
#TrainBBoxAI .status { white-space:pre-wrap; }
`)
let script = Script(/* javascript */ `
let bboxPollTimer
async function startBoundingBoxTraining() {
  const label = document.querySelector('#bboxTrainLabel').value
  const epochs = Number(document.querySelector('#bboxTrainEpochs').value)
  const patience = Number(document.querySelector('#bboxTrainPatience').value)
  const button = document.querySelector('#bboxTrainStart')
  const status = document.querySelector('#bboxTrainStatus')
  button.disabled = true
  status.textContent = 'Preparing the confirmed bounding-box annotations…'
  try {
    const response = await fetch('/train-bbox-ai/start?project=' + encodeURIComponent(projectId), {
      method: 'POST', headers: {'content-type':'application/json'},
      body: JSON.stringify({label_id:Number(label), epochs, patience}),
    })
    const result = await response.json()
    if (!response.ok || result.error) throw new Error(result.error || 'Could not start training')
    status.textContent = 'Training started. Run ' + result.runId
    pollBoundingBoxTraining(label)
  } catch (error) {
    status.textContent = error.message || String(error)
    button.disabled = false
  }
}
function pollBoundingBoxTraining(label) {
  clearTimeout(bboxPollTimer)
  bboxPollTimer = setTimeout(async () => {
    try {
      const response = await fetch('/train-bbox-ai/status?project=' + encodeURIComponent(projectId) + '&label_id=' + encodeURIComponent(label))
      const job = await response.json()
      const status = document.querySelector('#bboxTrainStatus')
      if (job.progress) {
        const p = job.progress
        const metrics = p.summary && p.summary.validationMetrics
        status.textContent = 'Status: ' + (p.status || job.status) + (p.epoch ? '\\nEpoch: ' + p.epoch : '') + (p.loss != null ? '\\nLoss: ' + Number(p.loss).toFixed(4) : '') + (p.validationLoss != null ? '\\nValidation loss: ' + Number(p.validationLoss).toFixed(4) : '') + (metrics && metrics.meanIou != null ? '\\nValidation mean IoU: ' + Number(metrics.meanIou).toFixed(3) : '')
      } else status.textContent = 'Status: ' + job.status
      if (job.error) status.textContent += '\\n' + job.error
      if (job.status === 'running' || job.status === 'preparing') pollBoundingBoxTraining(label)
      else document.querySelector('#bboxTrainStart').disabled = false
    } catch (error) {
      document.querySelector('#bboxTrainStart').disabled = false
      document.querySelector('#bboxTrainStatus').textContent = error.message || String(error)
    }
  }, 1500)
}
`)
let page = (
  <>
    {style}
    <ion-header><ion-toolbar><ProjectPageBackButton /><ion-title><ProjectPageTitle t={title} short /></ion-title></ion-toolbar></ion-header>
    <ion-content id="TrainBBoxAI" class="ion-padding"><Main /><ProjectIdScript /></ion-content>
    {script}
  </>
)
let selectBboxCounts = db.prepare<
  { project_id: number },
  { id: number; title: string; confirmed: number; one_box: number; multiple_boxes: number; rotated_boxes: number; image_rotated: number }
>(/* sql */ `
with confirmed as (
  select ibc.image_id, ibc.label_id, min(ibc.user_id) as user_id
  from image_bounding_box_confirmation ibc join image i on i.id = ibc.image_id
  where i.project_id = :project_id group by ibc.image_id, ibc.label_id
), per_image as (
  select c.image_id, c.label_id, count(b.id) as box_count,
    max(abs(coalesce(b.rotate, 0) - round(coalesce(b.rotate, 0)))) as box_rotation,
    max(abs(coalesce(i.rotation, 0))) as image_rotation
  from confirmed c
  join image i on i.id = c.image_id
  join image_label il on il.image_id = c.image_id and il.label_id = c.label_id and il.answer = 1
  left join image_bounding_box b on b.image_id = c.image_id and b.label_id = c.label_id and b.user_id = c.user_id
  group by c.image_id, c.label_id
)
select l.id, l.title, count(p.image_id) as confirmed,
  sum(case when p.box_count = 1 and p.image_rotation = 0 then 1 else 0 end) as one_box,
  sum(case when p.box_count > 1 then 1 else 0 end) as multiple_boxes,
  sum(case when p.box_count = 1 and p.box_rotation > 0.001 and p.image_rotation = 0 then 1 else 0 end) as rotated_boxes,
  sum(case when p.box_count = 1 and p.image_rotation > 0 then 1 else 0 end) as image_rotated
from label l left join per_image p on p.label_id = l.id
where l.project_id = :project_id group by l.id order by l.display_order, l.id
`)
function Main(attrs: {}, context: DynamicContext) {
  let project = getProject(context)
  if (!project) return <NoProjectMessage />
  let user = getAuthUser(context)
  if (!canViewProject(user, project)) return <NoAccessMessage />
  let labels = selectBboxCounts.all({ project_id: project.id! })
  return (
    <>
      <p><Locale en="Train one model per label. Each positive image must have one confirmed, axis-aligned box. Rotated boxes are excluded without changing their annotations." zh_hk="每個 label 訓練一個模型。每張正樣本圖片須有一個已確認的水平框；旋轉框不會改動標註，並會排除在訓練之外。" zh_cn="每个 label 训练一个模型。每张正样本图片须有一个已确认的水平框；旋转框不会修改标注，并会从训练中排除。" /></p>
      <ion-item><ion-label><Locale en="Label" zh_hk="標籤" zh_cn="标签" /></ion-label><select id="bboxTrainLabel">{mapArray(labels, label => <option value={label.id}>{label.title}</option>)}</select></ion-item>
      <ion-item><ion-label><Locale en="Epochs" zh_hk="訓練輪數" zh_cn="训练轮数" /></ion-label><ion-input id="bboxTrainEpochs" type="number" min="1" max="200" value="20" /></ion-item>
      <ion-item><ion-label><Locale en="Early stopping patience (0 = off)" zh_hk="提早停止耐性（0 = 關閉）" zh_cn="提前停止耐心值（0 = 关闭）" /></ion-label><ion-input id="bboxTrainPatience" type="number" min="0" max="50" value="5" /></ion-item>
      <div class="summary">{mapArray(labels, label => <div class="summary-card"><strong>{label.title}</strong><div>Confirmed: {label.confirmed}</div><div>Trainable one-box images: {label.one_box}</div><div>Rotated boxes excluded: {label.rotated_boxes}</div><div>Multi-box excluded: {label.multiple_boxes}</div><div>Image-rotation excluded: {label.image_rotated}</div></div>)}</div>
      {user ? <ion-button id="bboxTrainStart" onclick="startBoundingBoxTraining()"><Locale en="Start training" zh_hk="開始訓練" zh_cn="开始训练" /></ion-button> : <p><Locale en="Log in to train a model." zh_hk="登入後才可訓練模型。" zh_cn="登录后才可训练模型。" /></p>}
      <IonButton url={`/preview-bbox-ai?project=${project.id}`} fill="outline"><Locale en="Preview BBox AI" zh_hk="預覽 BBox AI" zh_cn="预览 BBox AI" /></IonButton>
      <pre id="bboxTrainStatus" class="status"></pre>
    </>
  )
}
function ProjectIdScript(attrs: {}, context: DynamicContext) {
  let project = getProject(context)
  return <script>projectId = {project?.id ?? 0}</script>
}
function getProject(context: DynamicContext) {
  let id = +(new URLSearchParams(context.routerMatch?.search).get('project') || 0)
  return id ? proxy.project[id] || null : null
}
function imageDimensions(filePath: string) {
  let bytes = readFileSync(filePath)
  if (bytes.toString('ascii', 1, 4) === 'PNG') return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
  if (bytes.toString('ascii', 0, 3) === 'GIF') return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) }
  if (bytes.toString('ascii', 0, 2) === 'BM') return { width: Math.abs(bytes.readInt32LE(18)), height: Math.abs(bytes.readInt32LE(22)) }
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') throw new Error(`WebP image is not supported by the current training package: ${basename(filePath)}`)
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2
    while (offset < bytes.length) {
      if (bytes[offset] !== 0xff) { offset++; continue }
      while (bytes[offset] === 0xff) offset++
      let marker = bytes[offset++]
      if (marker === 0xd9 || marker === 0xda) break
      if (marker === 0x01 || (marker !== undefined && marker >= 0xd0 && marker <= 0xd7)) continue
      if (offset + 2 > bytes.length) break
      let segmentLength = bytes.readUInt16BE(offset)
      if (segmentLength < 2 || offset + segmentLength > bytes.length) break
      if (marker !== undefined && [0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) {
        return { height: bytes.readUInt16BE(offset + 3), width: bytes.readUInt16BE(offset + 5) }
      }
      // JPEG segment length includes its own two length bytes.
      offset += segmentLength
    }
  }
  let signature = [...bytes.subarray(0, 12)].map(value => value.toString(16).padStart(2, '0')).join(' ')
  throw new Error(`Could not identify ${basename(filePath)} as PNG, JPEG, GIF or BMP (file signature: ${signature || 'empty file'})`)
}
function confirmedRows(project_id: number, label_id: number) {
  return db.prepare<{ project_id: number; label_id: number }, {
    image_id: number; filename: string; rotation: number | null; label_title: string
    x: number; y: number; width: number; height: number; rotate: number
  }>(/* sql */ `
with confirmed as (
  select ibc.image_id, ibc.label_id, min(ibc.user_id) as user_id
  from image_bounding_box_confirmation ibc join image i on i.id = ibc.image_id
  where i.project_id = :project_id and ibc.label_id = :label_id group by ibc.image_id, ibc.label_id
)
select i.id as image_id, i.filename, i.rotation, l.title as label_title, b.x, b.y, b.width, b.height, b.rotate
from confirmed c join image i on i.id = c.image_id join label l on l.id = c.label_id
join image_label il on il.image_id = i.id and il.label_id = l.id and il.answer = 1
join image_bounding_box b on b.image_id = i.id and b.label_id = l.id and b.user_id = c.user_id
where i.project_id = :project_id order by i.id, b.id
`).all({ project_id, label_id })
}
function buildSamples(project_id: number, label_id: number) {
  let rows = confirmedRows(project_id, label_id)
  let grouped = new Map<number, typeof rows>()
  for (let row of rows) grouped.set(row.image_id, [...(grouped.get(row.image_id) || []), row])
  let samples: BBoxSample[] = [], excludedMulti = 0, excludedImageRotation = 0, excludedRotated = 0
  for (let [image_id, imageRows] of grouped) {
    let row = imageRows[0]!
    if (imageRows.length !== 1) { excludedMulti++; continue }
    if (Math.abs(row.rotation || 0) > 0.001) { excludedImageRotation++; continue }
    if (Math.abs(row.rotate - Math.round(row.rotate)) > 0.001) { excludedRotated++; continue }
    let imagePath = resolve(env.UPLOAD_DIR, row.filename)
    let relativePath = relative(process.cwd(), imagePath)
    if (!relativePath || relativePath === '..' || relativePath.startsWith('..' + sep) || isAbsolute(relativePath)) throw new Error('Image file is outside the project data root')
    let { width, height } = imageDimensions(imagePath)
    let boxWidth = Math.abs(row.width)
    let boxHeight = Math.abs(row.height)
    let rawXmin = (row.x - boxWidth / 2) * width, rawYmin = (row.y - boxHeight / 2) * height
    let rawXmax = (row.x + boxWidth / 2) * width, rawYmax = (row.y + boxHeight / 2) * height
    let xmin = Math.max(0, Math.min(width, rawXmin)), ymin = Math.max(0, Math.min(height, rawYmin))
    let xmax = Math.max(0, Math.min(width, rawXmax)), ymax = Math.max(0, Math.min(height, rawYmax))
    if (xmax <= xmin || ymax <= ymin) continue
    let clamped = xmin !== rawXmin || ymin !== rawYmin || xmax !== rawXmax || ymax !== rawYmax
    samples.push({ id: String(image_id), imagePath: relativePath, width, height, boxes: [{ category: row.label_title, xyxy: [xmin, ymin, xmax, ymax], clamped }] })
  }
  return { samples, excludedMulti, excludedImageRotation, excludedRotated }
}
function makeManifest(samples: BBoxSample[], name: string) {
  return { schemaVersion: 1, name, split: name === 'train' ? 'train' : 'validation', task: 'class-agnostic-animal-bbox', sourceAnnotation: 'image_bounding_box_confirmation', annotationSha256: createHash('sha256').update(JSON.stringify(samples)).digest('hex'), splitSeed: 20260825, samples }
}
async function startTraining(context: ExpressContext) {
  let user = getAuthUser(context), project_id = +(context.req.query.project || 0)
  let label_id = +(context.req.body?.label_id || 0), epochs = Math.max(1, Math.min(200, Math.floor(+context.req.body?.epochs || 20)))
  let patienceValue = Number(context.req.body?.patience ?? 5)
  let patience = Number.isInteger(patienceValue) ? Math.max(0, Math.min(50, patienceValue)) : 5
  let project = proxy.project[project_id], label = proxy.label[label_id]
  if (!user) throw new Error('Log in before starting training')
  if (!project || !canEditProject(user, project)) throw new Error('You do not have permission to train this project')
  if (!label || label.project_id !== project_id) throw new Error('Choose a label from this project')
  if ([...jobs.values()].some(job => job.status === 'running' || job.status === 'preparing')) throw new Error('Another bounding-box training job is already running')
  let { samples, excludedMulti, excludedImageRotation, excludedRotated } = buildSamples(project_id, label_id)
  if (samples.length < 2) throw new Error(`Need at least two confirmed one-box images for ${label.title}; found ${samples.length}. Excluded ${excludedMulti} multi-box, ${excludedRotated} rotated-box and ${excludedImageRotation} image-rotated sample(s).`)
  let ordered = [...samples].sort((a,b) => createHash('sha1').update(a.id + ':20260825').digest('hex').localeCompare(createHash('sha1').update(b.id + ':20260825').digest('hex')))
  let validationCount = Math.max(1, Math.round(ordered.length * 0.2))
  if (validationCount >= ordered.length) validationCount = 1
  let validation = ordered.slice(0, validationCount), train = ordered.slice(validationCount)
  let runId = `run-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0,8)}`
  let outputDirectory = resolve(`saved_models/project-${project_id}/bbox/label-${label_id}/${runId}`)
  let trainerDirectory = process.env.TFJS_MODEL_TRAINING_DIR || resolve('..', 'tfjs-model-training-v0.1.0', 'tfjs-model-training')
  let tsx = join(trainerDirectory, 'node_modules', 'tsx', 'dist', 'cli.mjs'), source = join(trainerDirectory, 'src', 'cli', 'train.ts')
  let node = join(trainerDirectory, 'node_modules', 'node', 'bin', process.platform === 'win32' ? 'node.exe' : 'node')
  if (!existsSync(tsx) || !existsSync(source)) throw new Error(`Training package is not installed. Run npm ci in ${trainerDirectory} with Node 22.23.x.`)
  if (!existsSync(node)) node = process.execPath
  let temp = await mkdtemp(join(tmpdir(), 'bbox-training-'))
  let trainPath = join(temp, 'train.json'), validationPath = join(temp, 'validation.json'), configPath = join(temp, 'config.json')
  await Promise.all([
    writeFile(trainPath, JSON.stringify(makeManifest(train, 'train'))),
    writeFile(validationPath, JSON.stringify(makeManifest(validation, 'validation'))),
    mkdir(dirname(outputDirectory), { recursive: true }),
  ])
  await writeFile(configPath, JSON.stringify({ dataRoot: process.cwd(), outputDirectory, train: trainPath, validation: validationPath, epochs, batchSize: 8, learningRate: 0.001, patience, seed: 20260825, augment: true, calibrateBatchNorm: true }))
  let job: BBoxJob = { projectId: project_id, labelId: label_id, runId, outputDirectory, status: 'running', progress: null }
  jobs.set(`${project_id}:${label_id}`, job)
  let child = spawn(node, [tsx, source, 'bbox', configPath], { cwd: trainerDirectory, windowsHide: true, stdio: 'pipe' })
  job.child = child
  let stdout = '', stderr = ''
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    stdout += chunk; let lines = stdout.split(/\r?\n/); stdout = lines.pop() || ''
    for (let line of lines) { try { let event = JSON.parse(line); if (event && typeof event === 'object') job.progress = event } catch {} }
  })
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-4000) })
  child.on('error', error => { job.status = 'failed'; job.error = error.message })
  child.on('close', async code => {
    job.child = undefined
    job.status = code === 0 ? 'completed' : code === 2 ? 'failed-quality-gate' : 'failed'
    if (job.status === 'failed') job.error = stderr.trim() || `Training process exited with code ${code}`
    try { await writeFile(join(outputDirectory, 'builder-run.json'), JSON.stringify({ projectId: project_id, labelId: label_id, label: label.title, runId, status: job.status, trainSamples: train.length, validationSamples: validation.length, excludedMultiBox: excludedMulti, excludedRotatedBoxes: excludedRotated, excludedImageRotation, patience }, null, 2)) } catch {}
    try { job.progress = { status: job.status, summary: JSON.parse(await readFile(join(outputDirectory, 'summary.json'), 'utf8')) } } catch {}
  })
  return { success: true, runId, trainSamples: train.length, validationSamples: validation.length, excludedMultiBox: excludedMulti, excludedRotatedBoxes: excludedRotated, excludedImageRotation, patience }
}
async function trainingStatus(context: ExpressContext) {
  let user = getAuthUser(context), project_id = +(context.req.query.project || 0), label_id = +(context.req.query.label_id || 0)
  let project = proxy.project[project_id]
  if (!project || !canViewProject(user, project)) throw new Error('You do not have access to this project')
  let job = jobs.get(`${project_id}:${label_id}`)
  if (job) return { status: job.status, runId: job.runId, progress: job.progress, error: job.error }
  let root = resolve(`saved_models/project-${project_id}/bbox/label-${label_id}`)
  try {
    let dirs = (await readdir(root, { withFileTypes: true })).filter(entry => entry.isDirectory()).sort((a,b) => b.name.localeCompare(a.name))
    if (dirs[0]) { let file = join(root, dirs[0].name, 'status.json'); if (existsSync(file)) return JSON.parse(await readFile(file, 'utf8')) }
  } catch {}
  return { status: 'idle' }
}
function StartTraining(context: ExpressContext) { return startTraining(context) }
function TrainingStatus(context: ExpressContext) { return trainingStatus(context) }
let routes = {
  '/train-bbox-ai': { title: <ProjectPageTitle t={title} />, description: 'Train one bounding-box model per label.', node: page },
  '/train-bbox-ai/start': ajaxRoute({ description: 'Start bounding-box training for one project label.', api: StartTraining }),
  '/train-bbox-ai/status': ajaxRoute({ description: 'Get bounding-box training status.', api: TrainingStatus }),
} satisfies Routes
export default { routes }
