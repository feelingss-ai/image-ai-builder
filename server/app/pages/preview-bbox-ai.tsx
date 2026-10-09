import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { filter } from 'better-sqlite3-proxy'
import { proxy } from '../../../db/proxy.js'
import { canViewProject } from '../context/project-context.js'
import { getAuthUser } from '../auth/user.js'
import { DynamicContext } from '../context.js'
import { Routes } from '../routes.js'
import { mapArray } from '../components/fragment.js'
import { ProjectPageBackButton } from '../components/project-page-back-button.js'
import { Locale, ProjectPageTitle } from '../components/locale.js'
import { NoAccessMessage } from '../components/no-access-message.js'
import { NoProjectMessage } from '../components/no-project-message.js'
import { Script } from '../components/script.js'
import Style from '../components/style.js'
import { o } from '../jsx/jsx.js'

let title = <Locale en="Preview Bounding Box AI" zh_hk="預覽 Bounding Box AI" zh_cn="预览 Bounding Box AI" />
let style = Style(/* css */ `
#PreviewBBoxAI .preview-frame { position:relative; width:min(100%, 960px); margin:1rem auto; background:#111; }
#PreviewBBoxAI #previewImage { display:block; width:100%; height:auto; }
#PreviewBBoxAI #bboxOverlay { position:absolute; inset:0; width:100%; height:100%; pointer-events:none; }
#PreviewBBoxAI #previewVideo { display:block; width:100%; max-height:75vh; background:#111; }
#PreviewBBoxAI .controls { display:flex; flex-wrap:wrap; gap:.5rem; align-items:center; }
`)
let script = Script(/* javascript */ `
let bboxModelCache = new Map()
let bboxStream = null
let currentBboxSource = null
let bboxFrameBusy = false
async function getTensorFlow() {
  if (window.tf) return window.tf
  return new Promise(resolve => { const poll = () => window.tf ? resolve(window.tf) : setTimeout(poll, 100) ; poll() })
}
async function loadBboxModel(path) {
  if (!path) throw new Error('Select a trained label model first.')
  if (!bboxModelCache.has(path)) {
    let tf = await getTensorFlow()
    bboxModelCache.set(path, tf.loadLayersModel('/saved_models/' + path + '/best/model.json'))
  }
  try { return await bboxModelCache.get(path) } catch (error) { bboxModelCache.delete(path); throw error }
}
async function predictBbox(source) {
  const path = document.querySelector('#bboxModelSelect').value
  const model = await loadBboxModel(path)
  const tf = await getTensorFlow()
  const input = tf.tidy(() => {
    const pixels = tf.browser.fromPixels(source)
    return tf.image.resizeBilinear(pixels, [224, 224], true).toFloat().div(127.5).sub(1).expandDims(0)
  })
  let output = model.predict(input)
  input.dispose()
  let values
  if (Array.isArray(output)) { values = output[0].dataSync(); output.forEach(t => t.dispose()) }
  else { values = output.dataSync(); output.dispose() }
  const cx = values[0], cy = values[1], width = values[2], height = values[3]
  if (![cx,cy,width,height].every(Number.isFinite)) throw new Error('Model returned invalid coordinates')
  const canvas = document.querySelector('#bboxOverlay')
  const sourceWidth = source.videoWidth || source.naturalWidth || source.width
  const sourceHeight = source.videoHeight || source.naturalHeight || source.height
  canvas.width = sourceWidth; canvas.height = sourceHeight
  const context = canvas.getContext('2d')
  context.clearRect(0,0,canvas.width,canvas.height)
  const x = Math.max(0, (cx-width/2)*sourceWidth), y = Math.max(0, (cy-height/2)*sourceHeight)
  const w = Math.min(sourceWidth-x, width*sourceWidth), h = Math.min(sourceHeight-y, height*sourceHeight)
  context.strokeStyle = '#ff3b30'; context.lineWidth = Math.max(2, sourceWidth/400); context.strokeRect(x,y,w,h)
  context.fillStyle = '#ff3b30'; context.font = 'bold ' + Math.max(14,sourceWidth/50) + 'px sans-serif'
  context.fillText(document.querySelector('#bboxModelSelect').selectedOptions[0].text, x, Math.max(18,y-6))
}
async function chooseBboxPhoto(event) {
  const file = event.target.files && event.target.files[0]
  if (!file) return
  stopBboxCamera()
  const image = document.querySelector('#previewImage')
  image.src = URL.createObjectURL(file); image.hidden = false
  image.onload = async () => { try { await predictBbox(image); setBboxPreviewStatus('Prediction updated.') } catch (error) { setBboxPreviewStatus(error.message || String(error)) } }
  document.querySelector('#previewVideo').hidden = true
}
async function startBboxCamera() {
  if (!document.querySelector('#bboxModelSelect').value) { setBboxPreviewStatus('Select a trained label model first.'); return }
  try {
    bboxStream = await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'},audio:false})
    const video = document.querySelector('#previewVideo'); video.srcObject = bboxStream; video.hidden = false; await video.play()
    document.querySelector('#previewImage').hidden = true
    currentBboxSource = video
    runBboxCameraFrame()
  } catch (error) { setBboxPreviewStatus(error.message || String(error)) }
}
function setBboxPreviewStatus(message) { document.querySelector('#bboxPreviewStatus').textContent = message }
function stopBboxCamera() {
  if (bboxStream) bboxStream.getTracks().forEach(track => track.stop())
  bboxStream = null; currentBboxSource = null
  const video = document.querySelector('#previewVideo'); video.pause(); video.srcObject = null; video.hidden = true
  const canvas = document.querySelector('#bboxOverlay'); canvas.getContext('2d').clearRect(0,0,canvas.width,canvas.height)
}
async function runBboxCameraFrame() {
  if (!currentBboxSource || bboxFrameBusy) return
  bboxFrameBusy = true
  try { await predictBbox(currentBboxSource) } catch (error) { console.error('bbox preview error', error) }
  finally { bboxFrameBusy = false; if (currentBboxSource) setTimeout(runBboxCameraFrame, 500) }
}
document.querySelector('#bboxModelSelect').addEventListener('change', async () => {
  if (currentBboxSource) return
  const image = document.querySelector('#previewImage')
  if (!image.hidden && image.complete) try { await predictBbox(image); setBboxPreviewStatus('Prediction updated.') } catch (error) { setBboxPreviewStatus(error.message || String(error)) }
})
`)
let page = (
  <>
    {style}
    <ion-header><ion-toolbar><ProjectPageBackButton /><ion-title><ProjectPageTitle t={title} short /></ion-title></ion-toolbar></ion-header>
    <ion-content id="PreviewBBoxAI" class="ion-padding">
      <Main />
      <div class="controls">
        <ion-button onclick="document.querySelector('#bboxPhotoInput').click()"><Locale en="Choose photo" zh_hk="選擇圖片" zh_cn="选择图片" /></ion-button>
        <ion-button onclick="startBboxCamera()"><Locale en="Open camera" zh_hk="開啟相機" zh_cn="开启相机" /></ion-button>
        <ion-button color="medium" onclick="stopBboxCamera()"><Locale en="Close camera" zh_hk="關閉相機" zh_cn="关闭相机" /></ion-button>
        <select id="bboxModelSelect"><option value=""><Locale en="Select trained label model" zh_hk="選擇已訓練的標籤模型" zh_cn="选择已训练的标签模型" /></option><ModelOptions /></select>
        <input id="bboxPhotoInput" type="file" accept="image/*" style="display:none" onchange="chooseBboxPhoto(event)" />
      </div>
      <p id="bboxPreviewStatus"><Locale en="Select a trained label model, then choose a photo or open the camera." zh_hk="選擇已訓練的標籤模型，再選取圖片或開啟相機。" zh_cn="选择已训练的标签模型，再选择图片或开启相机。" /></p>
      <p><Locale en="This single-box model always predicts one box. It does not return a confidence score." zh_hk="此單框模型每次都會預測一個框，暫不提供信心分數。" zh_cn="此单框模型每次都会预测一个框，暂不提供置信度。" /></p>
      <div class="preview-frame"><img id="previewImage" hidden /><video id="previewVideo" muted playsinline hidden></video><canvas id="bboxOverlay"></canvas></div>
    </ion-content>
    {script}
  </>
)
function Main(attrs: {}, context: DynamicContext) {
  let project = getProject(context)
  if (!project) return <NoProjectMessage />
  if (!canViewProject(getAuthUser(context), project)) return <NoAccessMessage />
  return null
}
function ModelOptions(attrs: {}, context: DynamicContext) {
  let project = getProject(context)
  if (!project || !canViewProject(getAuthUser(context), project)) return null
  let labels = filter(proxy.label, { project_id: project.id! })
    .sort((a,b) => (a.display_order ?? 999999) - (b.display_order ?? 999999))
  let options: { label: string; path: string }[] = []
  for (let label of labels) {
    let root = resolve(`saved_models/project-${project.id}/bbox/label-${label.id}`)
    if (!existsSync(root)) continue
    let dirs = readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory())
      .sort((a,b) => statSync(join(root,b.name)).mtimeMs - statSync(join(root,a.name)).mtimeMs)
    let run = dirs.find(entry => {
      let metadata = join(root, entry.name, 'builder-run.json')
      if (!existsSync(join(root,entry.name,'best','model.json')) || !existsSync(metadata)) return false
      try { return JSON.parse(readFileSync(metadata, 'utf8')).status === 'completed' } catch { return false }
    })
    if (!run) continue
    let modelPath = relative(resolve('saved_models'), join(root,run.name)).split(sep).join('/')
    options.push({ label: label.title, path: modelPath })
  }
  return options.length
    ? <>{mapArray(options, option => <option value={option.path}>{option.label}</option>)}</>
    : <option value="" disabled>No completed bounding-box model yet</option>
}
function getProject(context: DynamicContext) {
  let id = +(new URLSearchParams(context.routerMatch?.search).get('project') || 0)
  return id ? proxy.project[id] || null : null
}
let routes = {
  '/preview-bbox-ai': { title: <ProjectPageTitle t={title} />, description: 'Preview a trained single-box model on an image or camera.', node: page },
} satisfies Routes
export default { routes }
