import { o } from '../jsx/jsx.js'
import { Routes } from '../routes.js'
import Style from '../components/style.js'
import { mapArray } from '../components/fragment.js'
import { proxy } from '../../../db/proxy.js'
import {
  Locale,
  makeThrows,
  ProjectPageTitle,
  Title,
} from '../components/locale.js'
import { DynamicContext, getContextFormBody, WsContext } from '../context.js'
import { db } from '../../../db/db.js'
import { getAuthUser, getAuthUserId } from '../auth/user.js'
import { IonButton } from '../components/ion-button.js'
import { EarlyTerminate } from '../../exception.js'
import { showError } from '../components/error.js'
import { id, number, object, optional } from 'cast.ts'
import { Script } from '../components/script.js'
import { loadClientPlugin } from '../../client-plugin.js'
import { getContextProject } from '../context/project-context.js'
import { ProjectPageBackButton } from '../components/project-page-back-button.js'
import { NoProjectMessage } from '../components/no-project-message.js'
import { filter } from 'better-sqlite3-proxy'

let keypointEditorPlugin = loadClientPlugin({
  entryFile: 'dist/client/keypoint-editor.js',
})

let sweetAlertPlugin = loadClientPlugin({
  entryFile: 'dist/client/sweetalert.js',
})

let pageTitle = (
  <Locale en="Mark Keypoint" zh_hk="標記關鍵點" zh_cn="标记关键点" />
)

let style = Style(/* css */ `
#AnnotateKeypoint #editorContainer {
  position: relative;
}
#AnnotateKeypoint #preview-container {
  position: relative;
  width: 100%;
  height: calc(68dvh - 6rem);
}
#AnnotateKeypoint #keypointCanvas {
  width: 100%;
  height: 100%;
  object-fit: contain;
  touch-action: none;
  background: #f8f8f8;
}
#AnnotateKeypoint #keypoint-info {
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: 10;
  background: rgba(255, 255, 255, 0.8);
  border-radius: 8px;
  padding: 4px 10px;
  font-size: 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}
#AnnotateKeypoint .kp-button-row {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
}
@media (max-width: 480px) {
  #AnnotateKeypoint .kp-button-row {
    gap: 0.2rem;
  }
  #AnnotateKeypoint .kp-button-row ion-button {
    --padding-start: 4px;
    --padding-end: 4px;
    font-size: 12px;
  }
}
#AnnotateKeypoint #keypoint-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  padding: 0.25rem 0.5rem;
}
#AnnotateKeypoint #keypoint-list .kp-chip {
  border: 1px solid #ccc;
  border-radius: 1rem;
  padding: 0.1rem 0.6rem;
  font-size: 0.75rem;
  cursor: pointer;
  background: #fff;
  user-select: none;
}
#AnnotateKeypoint #keypoint-list .kp-chip.done {
  background: #4caf50;
  color: #fff;
  border-color: #4caf50;
}
#AnnotateKeypoint #keypoint-list .kp-chip.active {
  background: #ff9800;
  color: #fff;
  border-color: #ff9800;
}
#AnnotateKeypoint #keypoint-list .kp-chip.invisible {
  opacity: 0.4;
  text-decoration: line-through;
}
#AnnotateKeypoint #keypoint-list .kp-hint {
  font-size: 0.8rem;
  color: var(--ion-color-medium, #92949c);
  padding: 0.25rem 0;
}
`)

let script = Script(/* js */ `
// NOTE: use var (not let/const) for top-level bindings — the framework
// re-executes page scripts on every ws update (mount / SPA navigation),
// and re-declaring let/const in the global scope throws
// "Identifier ... has already been declared", aborting the whole script.
var keypointNames = []
var keypointEdges = []
var keypointBoxes = []
var currentBoxId = null
var currentImageId = null
var currentLabelId = null

function getProjectId() {
  const params = new URLSearchParams(window.location.search)
  return parseInt(params.get('project') || '1')
}

// Helper function to wait for WebSocket to be ready.
// NOTE: checking typeof emit === 'function' is not enough — emit is defined
// as soon as the client bundle loads, but the socket may still be CONNECTING,
// and ws.send() throws InvalidStateError in that state. Also wait for the
// socket to be OPEN.
async function waitForWebSocket(maxAttempts) {
  if (maxAttempts == null) maxAttempts = 50
  let attempts = 0
  function isReady() {
    if (typeof emit !== 'function') return false
    let ws = window.__ws
    // when the socket handle is not exposed, fall back to emit-only check
    if (!ws) return true
    return ws.readyState === 1 // WebSocket.OPEN
  }
  while (!isReady() && attempts < maxAttempts) {
    await new Promise(resolve => setTimeout(resolve, 100))
    attempts++
  }
  if (!isReady()) {
    console.error('WebSocket not ready after timeout')
    return false
  }
  return true
}

// Displays the next image for annotation based on selected label
async function showImage() {
  const labelId = label_select.value
  if (!labelId) {
    console.error('No label_id selected')
    return
  }
  const projectId = getProjectId()
  const params = new URLSearchParams(window.location.search)
  const imageId = params.get('image')
  if (!(await waitForWebSocket())) return
  let payload = {
    label_id: labelId,
    project_id: projectId,
  }
  if (imageId) {
    payload.image_id = parseInt(imageId)
  }
  emit('/annotate-keypoint/showImage', payload)
}

// Fetch bounding boxes + keypoints for the current image via WS
async function fetchKeypointData(image_id, label_id) {
  try {
    window.keypointBoxesData = null
    window.keypointData = null
    if (!(await waitForWebSocket())) return
    emit('/annotate-keypoint/getKeypoints', {
      image_id,
      label_id,
      project_id: getProjectId(),
    })
    let attempts = 0
    while (
      (window.keypointBoxesData == null || window.keypointData == null) &&
      attempts < 50
    ) {
      await new Promise(resolve => setTimeout(resolve, 100))
      attempts++
    }
  } catch (error) {
    console.error('fetchKeypointData error:', error)
  }
}

// Main setup: called from <img onLoad> and after box/keypoint updates
async function setupEditorUI() {
  console.log('setupEditorUI called')
  let label_image = document.getElementById('label_image')
  let canvas = document.getElementById('keypointCanvas')
  if (!label_image || !canvas) return

  let image_id = parseInt(label_image.dataset.imageId)
  let label_id = parseInt(document.getElementById('label_select').value)
  currentImageId = image_id
  currentLabelId = label_id

  if (!image_id || !label_id) return

  await fetchKeypointData(image_id, label_id)

  let boxes = window.keypointBoxesData || []
  keypointBoxes = boxes

  // populate the box select
  updateBoxSelect(boxes)

  // pick the box: keep current selection if still valid, else first box
  let boxId = currentBoxId != null && boxes.find(b => b.id === currentBoxId)
    ? currentBoxId
    : (boxes[0] && boxes[0].id) || null
  currentBoxId = boxId

  // sync template info from server-injected data
  if (window.keypointTemplateInfo) {
    keypointNames = window.keypointTemplateInfo.names || []
    keypointEdges = window.keypointTemplateInfo.edges || []
  }

  window.keypointBoxesData = boxes
  window.keypointTemplate = { names: keypointNames, edges: keypointEdges }

  setupKeypointEditor({
    image: label_image,
    canvas: canvas,
    resetCamera: true,
  })

  selectBox(boxId)
}

function updateBoxSelect(boxes) {
  let select = document.getElementById('box_select')
  if (!select) return
  select.innerHTML = ''
  if (boxes.length === 0) {
    let option = document.createElement('ion-select-option')
    option.value = ''
    option.disabled = true
    option.textContent = 'No bounding boxes'
    select.appendChild(option)
  } else {
    boxes.forEach(function(box, index) {
      let option = document.createElement('ion-select-option')
      option.value = box.id
      option.textContent = (index + 1) + '. ID:' + box.id
      select.appendChild(option)
    })
  }
  if (select.forceUpdate) select.forceUpdate()
}

// Select a bounding box: zoom the camera to it and load its keypoints
function selectBox(boxId) {
  currentBoxId = boxId
  window._keypointActiveBoxId = boxId
  let box = (window.keypointBoxesData || []).find(function(b) { return b.id === boxId })
  if (box && typeof window.setKeypointCameraToBox === 'function') {
    window.setKeypointCameraToBox(box)
  }
  // load keypoints for this box
  loadKeypointsForBox(boxId)
  updateBoxSelectValue(boxId)
  renderKeypointList()
}

function updateBoxSelectValue(boxId) {
  let select = document.getElementById('box_select')
  if (!select) return
  window._suppressBoxSelectChange = true
  select.value = boxId == null ? '' : boxId
  if (select.forceUpdate) select.forceUpdate()
  setTimeout(function() { window._suppressBoxSelectChange = false }, 0)
}

// Build the keypoint list from the template + existing data
function loadKeypointsForBox(boxId) {
  // no box (e.g. bounding boxes not confirmed yet) -> nothing to mark
  if (boxId == null) {
    window.keypointData = []
    window.selectedKeypointIdx = null
    if (typeof window.render === 'function') window.render()
    renderKeypointList()
    return
  }
  let existing = window.keypointData || []
  let boxKeypoints = existing.filter(function(kp) { return kp.box_id === boxId })
  let list = []
  for (let i = 0; i < keypointNames.length; i++) {
    let kp = boxKeypoints.find(function(k) { return k.idx === i })
    if (kp) {
      list.push({ idx: i, x: kp.x, y: kp.y, visibility: kp.visibility, box_id: boxId, id: kp.id })
    } else {
      list.push({ idx: i, x: null, y: null, visibility: 1, box_id: boxId, id: null })
    }
  }
  window.keypointData = list
  // select the first unmarked keypoint
  let firstUnmarked = list.find(function(kp) { return kp.x == null })
  window.selectedKeypointIdx = firstUnmarked ? firstUnmarked.idx : (list[0] ? list[0].idx : null)
  if (typeof window.render === 'function') window.render()
  renderKeypointList()
}

// Render the keypoint chip list
function renderKeypointList() {
  let container = document.getElementById('keypoint-list')
  if (!container) return
  container.innerHTML = ''
  let keypoints = window.keypointData || []
  let selectedIdx = window.selectedKeypointIdx
  let texts = window.keypointTexts || {}
  // empty list: distinguish "no box" from "no template" so the hint is not
  // misleading when boxes exist but the label has no keypoint template
  if (keypoints.length === 0) {
    let hint = document.createElement('span')
    hint.className = 'kp-hint'
    let hasBoxes = (window.keypointBoxesData || []).length > 0
    if (hasBoxes) {
      hint.textContent = texts.no_template ||
        'This label has no keypoint template.'
    } else {
      hint.textContent = texts.no_box ||
        'No bounding boxes. Annotate and confirm bounding boxes first.'
    }
    container.appendChild(hint)
    let info = document.getElementById('keypoint-info')
    if (info) info.textContent = 'Keypoints: 0/0'
    return
  }
  keypoints.forEach(function(kp) {
    let chip = document.createElement('span')
    chip.className = 'kp-chip'
    if (kp.idx === selectedIdx) chip.classList.add('active')
    if (kp.x != null) chip.classList.add('done')
    if (kp.visibility === 0) chip.classList.add('invisible')
    chip.textContent = (kp.idx + 1) + '. ' + (keypointNames[kp.idx] || kp.idx)
    chip.onclick = function() { selectKeypoint(kp.idx) }
    container.appendChild(chip)
  })
  // update progress text (preserve the opacity suffix added by
  // updateOpacityButton when the overlay is dimmed/hidden)
  let done = keypoints.filter(function(kp) { return kp.x != null }).length
  let info = document.getElementById('keypoint-info')
  if (info) {
    let text = 'Keypoints: ' + done + '/' + keypoints.length
    info.dataset.baseText = text
    let current = window.keypointOverlayOpacity == null ? 1 : window.keypointOverlayOpacity
    if (current !== 1) {
      text += ' (' + Math.round(current * 100) + '%)'
    }
    info.textContent = text
  }
}

// Select a keypoint by index (from chip click)
function selectKeypoint(idx) {
  window.selectedKeypointIdx = idx
  if (typeof window.render === 'function') window.render()
  renderKeypointList()
}

// Canvas click: place/move the selected keypoint
window.onCanvasClick = function(nx, ny) {
  // no box selected (bounding boxes not confirmed yet) -> nothing to mark on
  if (currentBoxId == null) return
  let idx = window.selectedKeypointIdx
  if (idx == null) return
  let keypoints = window.keypointData || []
  let kp = keypoints.find(function(k) { return k.idx === idx })
  if (!kp) return
  kp.x = nx
  kp.y = ny
  kp.visibility = 1
  if (typeof window.render === 'function') window.render()
  renderKeypointList()
  saveKeypoint(kp)
  // auto-advance to the next unmarked keypoint
  let next = keypoints.find(function(k) { return k.x == null })
  if (next) {
    window.selectedKeypointIdx = next.idx
    if (typeof window.render === 'function') window.render()
    renderKeypointList()
  }
}

// Keypoint drag committed: persist
window.onKeypointCommitted = function(kp) {
  saveKeypoint(kp)
}

// Toggle visibility of the selected keypoint
function toggleVisibility() {
  let idx = window.selectedKeypointIdx
  if (idx == null) return
  let keypoints = window.keypointData || []
  let kp = keypoints.find(function(k) { return k.idx === idx })
  if (!kp) return
  kp.visibility = kp.visibility === 0 ? 1 : 0
  if (typeof window.render === 'function') window.render()
  renderKeypointList()
  if (kp.x != null) saveKeypoint(kp)
}

// Cycle the global keypoint overlay opacity: 100% -> 50% -> 0% -> 100%.
// Affects keypoints + skeleton edges + labels on the canvas (the bounding
// box outline stays visible so the anchor is never lost). The selected
// keypoint stays fully visible at 50% so it can still be adjusted.
function cycleKeypointOpacity() {
  let current = window.keypointOverlayOpacity == null ? 1 : window.keypointOverlayOpacity
  let next = current === 1 ? 0.5 : current === 0.5 ? 0 : 1
  window.keypointOverlayOpacity = next
  updateOpacityButton()
  if (typeof window.render === 'function') window.render()
}

  // Sync the opacity button icon with the current opacity level
  function updateOpacityButton() {
    let btn = document.getElementById('opacity-toggle-btn')
    if (!btn) return
    let icon = btn.querySelector('ion-icon')
    if (!icon) return
    let current = window.keypointOverlayOpacity == null ? 1 : window.keypointOverlayOpacity
    if (current === 0) {
      icon.setAttribute('name', 'eye-off')
    } else if (current === 0.5) {
      icon.setAttribute('name', 'eye-outline')
    } else {
      icon.setAttribute('name', 'eye')
    }
    // refresh the info text via renderKeypointList (it preserves the suffix)
    if (typeof renderKeypointList === 'function') renderKeypointList()
  }

// Clear the selected keypoint
async function clearKeypoint() {
  let idx = window.selectedKeypointIdx
  if (idx == null) return
  let keypoints = window.keypointData || []
  let kp = keypoints.find(function(k) { return k.idx === idx })
  if (!kp) return
  kp.x = null
  kp.y = null
  kp.visibility = 1
  if (typeof window.render === 'function') window.render()
  renderKeypointList()
  if (kp.id) {
    if (!(await waitForWebSocket())) return
    emit('/annotate-keypoint/deleteKeypoint', {
      keypoint_id: kp.id,
      project_id: getProjectId(),
    })
    kp.id = null
  }
}

// Persist a keypoint (insert or update) via WS
// NOTE: no in-flight guard here — WS messages are delivered in order and the
// server upserts by (box_id, user_id, idx), so rapid saves are safe. A
// time-based guard dropped saves when clicks came faster than the round-trip.
async function saveKeypoint(kp) {
  if (kp.x == null) return
  if (currentBoxId == null) return
  if (!(await waitForWebSocket())) return
  emit('/annotate-keypoint/saveKeypoint', {
    box_id: currentBoxId,
    image_id: currentImageId,
    label_id: currentLabelId,
    idx: kp.idx,
    x: kp.x,
    y: kp.y,
    visibility: kp.visibility,
    project_id: getProjectId(),
  })
}

// Submit: confirm all keypoints of the current box and move to next image
async function submitKeypoints() {
  let image = document.getElementById('label_image')
  let image_id = image.dataset.imageId
  let label_id = document.getElementById('label_select').value
  if (!image_id || image_id === 'undefined' || image_id === 'null') return
  if (!label_id || label_id === 'undefined' || label_id === 'null') return
  if (!(await waitForWebSocket())) return
  emit('/annotate-keypoint/submitKeypoints', {
    image_id: parseInt(image_id),
    label_id: parseInt(label_id),
    project_id: getProjectId(),
  })
}

// Zoom helpers (press-and-hold repeating)
var zoomIntervalId = null
function startZoom(zoomFn) {
  stopZoom()
  zoomFn()
  zoomIntervalId = setInterval(zoomFn, 150)
}
function stopZoom() {
  if (zoomIntervalId !== null) {
    clearInterval(zoomIntervalId)
    zoomIntervalId = null
  }
}
function zoomIn() {
  if (!window.camera) return
  let camera = window.camera
  camera.width = Math.max(0.05, camera.width * 0.9)
  camera.height = Math.max(0.05, camera.height * 0.9)
  if (typeof window.resizeKeypointPreviewToCamera === 'function') {
    window.resizeKeypointPreviewToCamera()
  }
}
function zoomOut() {
  if (!window.camera) return
  let camera = window.camera
  camera.width = Math.min(1, camera.width * 1.1)
  camera.height = Math.min(1, camera.height * 1.1)
  if (typeof window.resizeKeypointPreviewToCamera === 'function') {
    window.resizeKeypointPreviewToCamera()
  }
}
function resetZoom() {
  // Reset back to the zoomed-in view of the selected bounding box (not the
  // full image) — this page is always annotating keypoints on a box, so the
  // natural "reset" target is the box framing that selectBox() applied.
  let boxId = window._keypointActiveBoxId
  let box = (window.keypointBoxesData || []).find(function(b) { return b.id === boxId })
  if (box && typeof window.setKeypointCameraToBox === 'function') {
    window.setKeypointCameraToBox(box)
    return
  }
  // no box selected: fall back to the full image view
  if (!window.camera) return
  let camera = window.camera
  camera.width = 1
  camera.height = 1
  camera.x = 0.5
  camera.y = 0.5
  camera.rotate = 0
  camera.rotate_angle = 0
  if (typeof window.resizeKeypointPreviewToCamera === 'function') {
    window.resizeKeypointPreviewToCamera()
  }
}

// Keyboard shortcuts: V = toggle visibility, Enter = submit
if (!window.__keypointKeysBound) {
  window.__keypointKeysBound = true
  document.addEventListener('keydown', function(event) {
    const target = event.target
    const tag = target && target.tagName ? target.tagName.toLowerCase() : ''
    const isEditable =
      tag === 'input' ||
      tag === 'textarea' ||
      tag === 'select' ||
      tag === 'ion-select' ||
      (target && target.isContentEditable)
    if (isEditable) return
    if (document.querySelector('ion-alert, ion-popover, ion-modal, ion-select-popover')) return
    if (event.key === 'v' || event.key === 'V') {
      toggleVisibility()
    } else if (event.key === 'o' || event.key === 'O') {
      cycleKeypointOpacity()
    } else if (event.key === 'Enter') {
      submitKeypoints()
    }
  })
}

// ionChange listeners (document-level, registered once)
if (!window.__keypointChangeListenerAdded) {
  document.addEventListener('ionChange', async function(event) {
    if (event.target.id === 'label_select') {
      const label_id = parseInt(event.target.value)
      if (!label_id) return
      currentBoxId = null
      window.keypointBoxesData = null
      window.keypointData = null
      if (!(await waitForWebSocket())) return
      emit('/annotate-keypoint/showImage', { label_id, project_id: getProjectId() })
    } else if (event.target.id === 'box_select') {
      if (window._suppressBoxSelectChange) return
      const boxId = parseInt(event.detail.value)
      if (boxId) selectBox(boxId)
    }
  })
  window.__keypointChangeListenerAdded = true
}

// Initialize the page with the default label when DOM is ready.
function initPage() {
  setTimeout(function() {
    const label_select = document.getElementById('label_select')
    if (label_select && label_select.value) {
      showImage()
    }
  }, 500)
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPage)
} else {
  initPage()
}
`)

// Count images eligible for keypoint annotation: the user has CONFIRMED
// bounding boxes for this label. Images whose bounding boxes were only
// saved (not submitted) are excluded — keypoints are marked on top of
// confirmed boxes, so an unconfirmed box is not ready for keypoints.
let count_keypoint_eligible_images = db
  .prepare<{ label_id: number; user_id: number; project_id: number }, number>(
    /* sql */ `
select count(distinct ibbc.image_id)
from image_bounding_box_confirmation ibbc
inner join image on image.id = ibbc.image_id
where ibbc.label_id = :label_id
and ibbc.user_id = :user_id
and image.project_id = :project_id
`,
  )
  .pluck()

// Count images the user has finished marking keypoints for. Intersected with
// the bounding-box confirmation so the numerator is always a subset of
// count_keypoint_eligible_images (guards against legacy rows created before
// the "confirm bounding boxes first" rule was enforced).
let count_confirmed_keypoint_images = db
  .prepare<{ label_id: number; user_id: number; project_id: number }, number>(
    /* sql */ `
select count(distinct ikc.image_id)
from image_keypoint_confirmation ikc
inner join image on image.id = ikc.image_id
where ikc.label_id = :label_id
and ikc.user_id = :user_id
and image.project_id = :project_id
and exists (
  select 1 from image_bounding_box_confirmation ibbc
  where ibbc.image_id = ikc.image_id
    and ibbc.label_id = :label_id
    and ibbc.user_id = :user_id
)
`,
  )
  .pluck()

let select_next_unconfirmed_image = db.prepare<
  { label_id: number; user_id: number; project_id: number },
  {
    id: number
    filename: string
    rotation: number | null
  } | null
>(/* sql */ `
  SELECT i.id, i.filename, i.rotation
  FROM image i
  INNER JOIN image_label il ON il.image_id = i.id
  WHERE il.label_id = :label_id
    AND il.answer = 1
    AND i.project_id = :project_id
    AND i.id NOT IN (
      SELECT ikc.image_id
      FROM image_keypoint_confirmation ikc
      WHERE ikc.label_id = :label_id AND ikc.user_id = :user_id
    )
    -- only images whose bounding boxes the user has CONFIRMED: a box that
    -- was merely saved (not submitted) is not ready for keypoint marking
    AND EXISTS (
      SELECT 1 FROM image_bounding_box_confirmation ibbc
      WHERE ibbc.image_id = i.id
        AND ibbc.label_id = :label_id
        AND ibbc.user_id = :user_id
    )
    -- and the user must actually own at least one box on the image
    AND EXISTS (
      SELECT 1 FROM image_bounding_box ibb
      WHERE ibb.image_id = i.id
        AND ibb.label_id = :label_id
        AND ibb.user_id = :user_id
    )
  ORDER BY i.id
  LIMIT 1
`)

// Load a specific image by id (e.g. from a review page link). Applies the
// same eligibility rule as the queue: the user must have CONFIRMED bounding
// boxes for this label, otherwise there is nothing to mark keypoints on.
let select_image_by_id = db.prepare<
  { image_id: number; label_id: number; project_id: number; user_id: number },
  {
    id: number
    filename: string
    rotation: number | null
  } | null
>(/* sql */ `
  SELECT i.id, i.filename, i.rotation
  FROM image i
  INNER JOIN image_label il ON il.image_id = i.id
  WHERE i.id = :image_id
    AND il.label_id = :label_id
    AND il.answer = 1
    AND i.project_id = :project_id
    AND EXISTS (
      SELECT 1 FROM image_bounding_box_confirmation ibbc
      WHERE ibbc.image_id = i.id
        AND ibbc.label_id = :label_id
        AND ibbc.user_id = :user_id
    )
    AND EXISTS (
      SELECT 1 FROM image_bounding_box ibb
      WHERE ibb.image_id = i.id
        AND ibb.label_id = :label_id
        AND ibb.user_id = :user_id
    )
  LIMIT 1
`)

let get_my_bounding_boxes = db.prepare<
  { image_id: number; label_id: number; user_id: number },
  {
    id: number
    image_id: number
    x: number
    y: number
    width: number
    height: number
    rotate: number
    label_id: number
  }
>(/* sql */ `
  SELECT id, image_id, x, y, width, height, rotate, label_id
  FROM image_bounding_box
  WHERE image_id = :image_id AND label_id = :label_id AND user_id = :user_id
  ORDER BY id
`)

let get_box_keypoints = db.prepare<
  { box_id: number; user_id: number },
  {
    id: number
    box_id: number
    idx: number
    x: number
    y: number
    visibility: number
  }
>(/* sql */ `
  SELECT id, box_id, idx, x, y, visibility
  FROM image_keypoint
  WHERE box_id = :box_id AND user_id = :user_id
  ORDER BY idx
`)

let upsert_keypoint = db.prepare<
  {
    box_id: number
    user_id: number
    idx: number
    x: number
    y: number
    visibility: number
  },
  { id: number }
>(/* sql */ `
  INSERT INTO image_keypoint (box_id, user_id, idx, x, y, visibility)
  VALUES (:box_id, :user_id, :idx, :x, :y, :visibility)
  ON CONFLICT(box_id, user_id, idx) DO UPDATE SET
    x = excluded.x, y = excluded.y, visibility = excluded.visibility
  RETURNING id
`)

let delete_keypoint = db.prepare<
  { keypoint_id: number; user_id: number },
  { changes: number }
>(/* sql */ `
  DELETE FROM image_keypoint
  WHERE id = :keypoint_id AND user_id = :user_id
`)

// Whether the user has confirmed bounding boxes for this image+label.
// Keypoints may only be marked on confirmed boxes.
let check_bounding_box_confirmation = db.prepare<
  { image_id: number; user_id: number; label_id: number },
  { id: number } | null
>(/* sql */ `
  SELECT id FROM image_bounding_box_confirmation
  WHERE image_id = :image_id AND user_id = :user_id AND label_id = :label_id
  LIMIT 1
`)

let submit_keypoint_confirmation = db.prepare<
  {
    image_id: number
    user_id: number
    label_id: number
  },
  { id: number }
>(/* sql */ `
  INSERT INTO image_keypoint_confirmation (image_id, user_id, label_id)
  VALUES (:image_id, :user_id, :label_id)
  RETURNING id
`)

let check_keypoint_confirmation = db.prepare<
  {
    image_id: number
    user_id: number
    label_id: number
  },
  { id: number } | null
>(/* sql */ `
  SELECT id FROM image_keypoint_confirmation
  WHERE image_id = :image_id AND user_id = :user_id AND label_id = :label_id
  LIMIT 1
`)

let delete_keypoint_confirmation = db.prepare<
  {
    image_id: number
    user_id: number
    label_id: number
  },
  { changes: number }
>(/* sql */ `
  DELETE FROM image_keypoint_confirmation
  WHERE image_id = :image_id AND user_id = :user_id AND label_id = :label_id
`)

// Injects localized texts for the client script (which is a static string and
// cannot use Locale directly) — same pattern as annotate-image.tsx AIScript.
function KeypointTexts(attrs: {}, context: DynamicContext) {
  let texts = {
    no_box: Locale(
      {
        en: 'No bounding boxes. Annotate and confirm bounding boxes first.',
        zh_hk: '沒有邊界框。請先標註並確認邊界框。',
        zh_cn: '没有边界框。请先标注并确认边界框。',
      },
      context,
    ),
    no_template: Locale(
      {
        en: 'This label has no keypoint template.',
        zh_hk: '此標籤沒有關鍵點範本。',
        zh_cn: '此标签没有关键点模板。',
      },
      context,
    ),
  }
  return <script>window.keypointTexts = {JSON.stringify(texts)}</script>
}

function Main(
  attrs: { project_id: string; label_id: string; image_id: string },
  context: DynamicContext,
) {
  let user = getAuthUser(context)
  if (!user) {
    return (
      <>
        <div style="margin: auto; width: fit-content; text-align: center;">
          <p class="ion-padding ion-margin error">
            <Locale
              en="You must be logged in to mark keypoints"
              zh_hk="您必須登入才能標記關鍵點"
              zh_cn="您必须登录才能标记关键点"
            />
          </p>
          <IonButton url="/login" color="primary">
            <Locale en="Login" zh_hk="登入" zh_cn="登录" />
          </IonButton>
        </div>
      </>
    )
  }

  let project = getContextProject(context)
  if (!project) return <NoProjectMessage />
  let project_id = project.id!

  // Get labels for this project only
  let labels = filter(proxy.label, { project_id })
  let sortedLabels = [...labels].sort(
    (a, b) => (a.display_order ?? 999999) - (b.display_order ?? 999999),
  )

  let url_label_id = attrs.label_id ? +attrs.label_id : null
  let label_id =
    (url_label_id && sortedLabels.find(l => l.id === url_label_id)?.id) ||
    sortedLabels[0]?.id ||
    1

  let url_image_id = attrs.image_id ? +attrs.image_id : null
  let image = url_image_id
    ? select_image_by_id.get({
        image_id: url_image_id,
        label_id: label_id,
        project_id: project_id,
        user_id: user.id!,
      })
    : select_next_unconfirmed_image.get({
        label_id: label_id,
        user_id: user.id!,
        project_id: project_id,
      })

  // keypoint template of the selected label (injected for the client)
  let label = proxy.label[label_id]
  let template = label?.keypoint_template_id
    ? proxy.keypoint_template[label.keypoint_template_id]
    : null
  let templateInfo = template
    ? {
        names: JSON.parse(template.names) as string[],
        edges: JSON.parse(template.edges) as number[][],
      }
    : { names: [], edges: [] }

  return (
    <>
      <script>
        {'window.keypointTemplateInfo = ' + JSON.stringify(templateInfo)}
      </script>
      <KeypointTexts />
      <div style="height: 100%; display: flex; flex-direction: column; text-align: center">
        <ion-item>
          <ion-select
            value={label_id}
            label={Locale(
              { en: 'Class Label', zh_hk: '類別標籤', zh_cn: '类别标签' },
              context,
            )}
            id="label_select"
          >
            {mapArray(sortedLabels, label => {
              let eligible_images = count_keypoint_eligible_images.get({
                label_id: label.id!,
                user_id: user.id!,
                project_id: project_id,
              })
              let confirmed_images = count_confirmed_keypoint_images.get({
                label_id: label.id!,
                user_id: user.id!,
                project_id: project_id,
              })
              // labels without a keypoint template cannot be annotated here
              let has_template = label.keypoint_template_id
                ? !!proxy.keypoint_template[label.keypoint_template_id]
                : false
              return (
                <ion-select-option value={label.id}>
                  {label.title} ({confirmed_images}/{eligible_images})
                  {has_template ? '' : ' — no keypoints'}
                </ion-select-option>
              )
            })}
          </ion-select>
        </ion-item>
        <ion-item>
          <ion-select
            id="box_select"
            placeholder={Locale(
              {
                en: 'Select Bounding Box',
                zh_hk: '選擇邊界框',
                zh_cn: '选择边界框',
              },
              context,
            )}
            interface="popover"
          >
            {/* Options populated dynamically */}
          </ion-select>
        </ion-item>
        <div style="flex-grow: 1; overflow: hidden">
          <div id="editorContainer">
            <div id="keypoint-info">
              <Locale en="Keypoints" zh_hk="關鍵點" zh_cn="关键点" />: 0/0
            </div>
            <div id="preview-container">
              <canvas id="keypointCanvas"></canvas>
            </div>
          </div>
          <div id="keypoint-list"></div>
          <img
            data-image-id={image?.id}
            data-rotation={image?.rotation || 0}
            id="label_image"
            src={`/uploads/${image?.filename}`}
            alt={
              <Locale
                en="Loading image..."
                zh_hk="載入圖片中..."
                zh_cn="加载图像中..."
              />
            }
            style="position: absolute; left: -9999px; top: -9999px; width: 1px; height: 1px; opacity: 0; pointer-events: none;"
            onLoad="setTimeout(() => { if (typeof setupEditorUI === 'function') setupEditorUI(); }, 100);"
          />
          <div
            id="no-image-message"
            style="display: flex; align-items: center; justify-content: center; height: 100%; text-align: center; padding: 2rem;"
            hidden
          >
            <div>
              <ion-icon
                name="checkmark-circle"
                style="font-size: 4rem; color: var(--ion-color-success);"
              ></ion-icon>
              <h2>
                <Locale
                  en="All images marked!"
                  zh_hk="所有圖片已標記完成！"
                  zh_cn="所有图片已标记完成！"
                />
              </h2>
              <p>
                <Locale
                  en="You have completed marking keypoints for all images of this label."
                  zh_hk="您已完成此標籤所有圖片的關鍵點標記。"
                  zh_cn="您已完成此标签所有图像的关键点标记。"
                />
              </p>
              <p style="font-size: 0.85rem; color: var(--ion-color-medium);">
                <Locale
                  en="Only images with confirmed bounding boxes appear here. Annotate and confirm bounding boxes first."
                  zh_hk="只有已確認邊界框的圖片會出現在這裡。請先標註並確認邊界框。"
                  zh_cn="只有已确认边界框的图像会出现在这里。请先标注并确认边界框。"
                />
              </p>
            </div>
          </div>
        </div>
        <div style="display: flex; flex-direction: column; gap: 0.5rem;">
          <div class="kp-button-row">
            <ion-button
              color="secondary"
              style="flex: 1;"
              onmousedown="startZoom(zoomIn)"
              onmouseup="stopZoom()"
              onmouseleave="stopZoom()"
              ontouchstart="startZoom(zoomIn)"
              ontouchend="stopZoom()"
              ontouchcancel="stopZoom()"
              title={<Locale en="Zoom In" zh_hk="放大" zh_cn="放大" />}
            >
              <ion-icon name="expand" slot="icon-only"></ion-icon>
            </ion-button>
            <ion-button
              color="tertiary"
              style="flex: 1;"
              onmousedown="startZoom(zoomOut)"
              onmouseup="stopZoom()"
              onmouseleave="stopZoom()"
              ontouchstart="startZoom(zoomOut)"
              ontouchend="stopZoom()"
              ontouchcancel="stopZoom()"
              title={<Locale en="Zoom Out" zh_hk="縮小" zh_cn="缩小" />}
            >
              <ion-icon name="contract" slot="icon-only"></ion-icon>
            </ion-button>
            <ion-button
              color="warning"
              style="flex: 1;"
              onclick="resetZoom()"
              title={<Locale en="Reset" zh_hk="重設" zh_cn="重置" />}
            >
              <ion-icon name="refresh" slot="icon-only"></ion-icon>
            </ion-button>
            <ion-button
              color="medium"
              style="flex: 1;"
              id="opacity-toggle-btn"
              onclick="cycleKeypointOpacity()"
              title={
                <Locale
                  en="Cycle Keypoint Opacity (O): 100% -> 50% -> 0%"
                  zh_hk="循環關鍵點透明度 (O)：100% → 50% → 0%"
                  zh_cn="循环关键点透明度 (O)：100% → 50% → 0%"
                />
              }
            >
              <ion-icon name="eye" slot="icon-only"></ion-icon>
            </ion-button>
            <ion-button
              color="warning"
              style="flex: 1;"
              onclick="clearKeypoint()"
              title={
                <Locale
                  en="Clear Selected Keypoint"
                  zh_hk="清除選中關鍵點"
                  zh_cn="清除选中关键点"
                />
              }
            >
              <ion-icon name="close" slot="icon-only"></ion-icon>
            </ion-button>
          </div>
          <div class="kp-button-row">
            <ion-button
              color="success"
              style="flex: 1;"
              onclick="submitKeypoints()"
              title={
                <Locale
                  en="Submit and next image"
                  zh_hk="提交並下一張"
                  zh_cn="提交并下一张"
                />
              }
            >
              <ion-icon name="cloud-upload-outline" slot="icon-only"></ion-icon>
            </ion-button>
          </div>
        </div>
      </div>
    </>
  )
}

let showImageParser = object({
  label_id: id(),
  project_id: id(),
  image_id: optional(id()),
})

let getKeypointsParser = object({
  image_id: id(),
  label_id: id(),
  project_id: id(),
})

let saveKeypointParser = object({
  box_id: id(),
  image_id: id(),
  label_id: id(),
  idx: number(),
  x: number(),
  y: number(),
  visibility: number(),
  project_id: id(),
})

let deleteKeypointParser = object({
  keypoint_id: id(),
  project_id: id(),
})

let submitKeypointsParser = object({
  image_id: id(),
  label_id: id(),
  project_id: id(),
})

// Displays the next image for keypoint annotation based on the selected label
function ShowImage(attrs: {}, context: WsContext) {
  try {
    let throws = makeThrows(context)
    let user_id = getAuthUserId(context)!
    if (!user_id)
      throws({
        en: 'You must be logged in to show image',
        zh_hk: '您必須登入才能顯示圖片',
        zh_cn: '您必须登录才能显示图片',
      })

    let body = getContextFormBody(context)
    let input = showImageParser.parse(body)
    let label_id = input.label_id
    let project_id = input.project_id
    let image_id = input.image_id

    let next_image = image_id
      ? select_image_by_id.get({
          image_id: image_id,
          label_id: label_id,
          project_id: project_id,
          user_id: user_id,
        })
      : select_next_unconfirmed_image.get({
          label_id: label_id,
          user_id: user_id,
          project_id: project_id,
        })

    if (next_image) {
      context.ws.send([
        'update-attrs',
        '#label_image',
        {
          'src': `/uploads/${next_image.filename}`,
          'data-image-id': next_image.id,
          'data-rotation': next_image.rotation || 0,
        },
      ])
      context.ws.send([
        'eval',
        `
        document.getElementById('no-image-message').hidden = true;
        document.getElementById('preview-container').style.display = 'block';
        currentBoxId = null;
        window._keypointActiveBoxId = null;
        window.keypointBoxesData = null;
        window.keypointData = null;
        if (typeof updateBoxSelect === 'function') updateBoxSelect([]);
        `,
      ])
    } else {
      context.ws.send([
        'update-attrs',
        '#label_image',
        {
          'src': '',
          'data-image-id': '',
          'data-rotation': 0,
        },
      ])
      context.ws.send([
        'eval',
        `
        document.getElementById('preview-container').style.display = 'none';
        document.getElementById('no-image-message').hidden = false;
        window.keypointBoxesData = [];
        window.keypointData = [];
        currentBoxId = null;
        window._keypointActiveBoxId = null;
        if (typeof updateBoxSelect === 'function') updateBoxSelect([]);
        if (typeof renderKeypointList === 'function') renderKeypointList();
        `,
      ])
    }

    throw EarlyTerminate
  } catch (error) {
    if (error !== EarlyTerminate) {
      console.error(error)
      context.ws.send(showError(error))
    }
    throw EarlyTerminate
  }
}

// Get bounding boxes + saved keypoints for the current image
function GetKeypoints(attrs: {}, context: WsContext) {
  try {
    let throws = makeThrows(context)
    let user_id = getAuthUserId(context)!
    if (!user_id)
      throws({
        en: 'You must be logged in to get keypoints',
        zh_hk: '您必須登入才能獲取關鍵點',
        zh_cn: '您必须登录才能获取关键点',
      })

    let body = getContextFormBody(context)
    let input = getKeypointsParser.parse(body)

    // Guard: keypoints are marked on top of CONFIRMED bounding boxes. If the
    // user has not confirmed boxes for this image+label, return an empty set
    // so the client shows "no bounding boxes" instead of letting the user
    // mark keypoints on an unconfirmed box.
    let confirmed = check_bounding_box_confirmation.get({
      image_id: input.image_id,
      user_id: user_id,
      label_id: input.label_id,
    })

    let boxes = confirmed
      ? get_my_bounding_boxes.all({
          image_id: input.image_id,
          label_id: input.label_id,
          user_id: user_id,
        })
      : []

    // collect keypoints of all boxes of this image+label
    let keypoints: Array<{
      id: number
      box_id: number
      idx: number
      x: number
      y: number
      visibility: number
    }> = []
    for (let box of boxes) {
      let kps = get_box_keypoints.all({ box_id: box.id, user_id })
      for (let kp of kps) {
        keypoints.push({
          id: kp.id,
          box_id: kp.box_id,
          idx: kp.idx,
          x: kp.x,
          y: kp.y,
          visibility: kp.visibility,
        })
      }
    }

    context.ws.send([
      'eval',
      `window.keypointBoxesData = ${JSON.stringify(
        boxes.map(box => ({
          id: box.id,
          image_id: box.image_id,
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
          rotate: box.rotate,
          label_id: box.label_id,
        })),
      )};` + `window.keypointData = ${JSON.stringify(keypoints)};`,
    ])

    throw EarlyTerminate
  } catch (error) {
    if (error !== EarlyTerminate) {
      console.error(error)
      context.ws.send(showError(error))
    }
    throw EarlyTerminate
  }
}

// Insert or update a keypoint
function SaveKeypoint(attrs: {}, context: WsContext) {
  try {
    let throws = makeThrows(context)
    let user_id = getAuthUserId(context)!
    if (!user_id)
      throws({
        en: 'You must be logged in to save keypoint',
        zh_hk: '您必須登入才能儲存關鍵點',
        zh_cn: '您必须登录才能保存关键点',
      })

    let body = getContextFormBody(context)
    let input = saveKeypointParser.parse(body)

    // verify the box belongs to this user and image
    let box = proxy.image_bounding_box[input.box_id]
    if (!box || box.user_id !== user_id) {
      throws({
        en: 'Bounding box not found or permission denied',
        zh_hk: '找不到邊界框或權限不足',
        zh_cn: '找不到边界框或权限不足',
      })
    }

    // keypoints may only be marked on CONFIRMED bounding boxes
    let confirmed = check_bounding_box_confirmation.get({
      image_id: input.image_id,
      user_id: user_id,
      label_id: input.label_id,
    })
    if (!confirmed) {
      throws({
        en: 'Please confirm the bounding boxes first',
        zh_hk: '請先確認邊界框',
        zh_cn: '请先确认边界框',
      })
    }

    // clamp coordinates to [0,1]
    let x = Math.max(0, Math.min(1, input.x))
    let y = Math.max(0, Math.min(1, input.y))
    let visibility = input.visibility === 0 ? 0 : 1

    let result = upsert_keypoint.get({
      box_id: input.box_id,
      user_id: user_id,
      idx: input.idx,
      x,
      y,
      visibility,
    })

    // revoke confirmation since keypoints changed
    delete_keypoint_confirmation.run({
      image_id: input.image_id,
      user_id: user_id,
      label_id: input.label_id,
    })

    if (result) {
      context.ws.send([
        'eval',
        `
        let keypoints = window.keypointData || [];
        let kp = keypoints.find(k => k.idx === ${input.idx} && k.box_id === ${input.box_id});
        if (kp) kp.id = ${result.id};
        `,
      ])
    }

    throw EarlyTerminate
  } catch (error) {
    if (error !== EarlyTerminate) {
      console.error(error)
      context.ws.send(showError(error))
    }
    throw EarlyTerminate
  }
}

// Delete a keypoint
function DeleteKeypoint(attrs: {}, context: WsContext) {
  try {
    let throws = makeThrows(context)
    let user_id = getAuthUserId(context)!
    if (!user_id)
      throws({
        en: 'You must be logged in to delete keypoint',
        zh_hk: '您必須登入才能刪除關鍵點',
        zh_cn: '您必须登录才能删除关键点',
      })

    let body = getContextFormBody(context)
    let input = deleteKeypointParser.parse(body)

    delete_keypoint.run({
      keypoint_id: input.keypoint_id,
      user_id: user_id,
    })

    throw EarlyTerminate
  } catch (error) {
    if (error !== EarlyTerminate) {
      console.error(error)
      context.ws.send(showError(error))
    }
    throw EarlyTerminate
  }
}

// Submit keypoint confirmation and move to next image
function SubmitKeypoints(attrs: {}, context: WsContext) {
  try {
    let throws = makeThrows(context)
    let user_id = getAuthUserId(context)!
    if (!user_id)
      throws({
        en: 'You must be logged in to submit keypoints',
        zh_hk: '您必須登入才能提交關鍵點',
        zh_cn: '您必须登录才能提交关键点',
      })

    let body = getContextFormBody(context)
    let input = submitKeypointsParser.parse(body)

    // keypoints may only be confirmed on top of CONFIRMED bounding boxes
    let bbox_confirmed = check_bounding_box_confirmation.get({
      image_id: input.image_id,
      user_id: user_id,
      label_id: input.label_id,
    })
    if (!bbox_confirmed) {
      throws({
        en: 'Please confirm the bounding boxes first',
        zh_hk: '請先確認邊界框',
        zh_cn: '请先确认边界框',
      })
    }

    // re-confirm allowed: delete old record then insert new one
    delete_keypoint_confirmation.run({
      image_id: input.image_id,
      user_id: user_id,
      label_id: input.label_id,
    })

    submit_keypoint_confirmation.get({
      image_id: input.image_id,
      user_id: user_id,
      label_id: input.label_id,
    })

    // Calculate updated counts for the current label
    let updated_confirmed = count_confirmed_keypoint_images.get({
      label_id: input.label_id,
      user_id: user_id,
      project_id: input.project_id,
    })
    let total_images = count_keypoint_eligible_images.get({
      label_id: input.label_id,
      user_id: user_id,
      project_id: input.project_id,
    })

    context.ws.send([
      'eval',
      `
      const labelOption = document.querySelector('ion-select-option[value="${input.label_id}"]');
      if (labelOption) {
        const labelTitle = labelOption.textContent.split(' (')[0];
        labelOption.textContent = labelTitle + ' (${updated_confirmed}/${total_images})';
      }
      `,
    ])

    // Find next unconfirmed image
    let next_image = select_next_unconfirmed_image.get({
      label_id: input.label_id,
      user_id: user_id,
      project_id: input.project_id,
    })

    if (next_image) {
      context.ws.send([
        'update-attrs',
        '#label_image',
        {
          'src': `/uploads/${next_image.filename}`,
          'data-image-id': next_image.id,
          'data-rotation': next_image.rotation || 0,
        },
      ])
      context.ws.send([
        'eval',
        `
        document.getElementById('no-image-message').hidden = true;
        document.getElementById('preview-container').style.display = 'block';
        currentBoxId = null;
        window._keypointActiveBoxId = null;
        window.keypointBoxesData = null;
        window.keypointData = null;
        if (typeof updateBoxSelect === 'function') updateBoxSelect([]);
        `,
      ])
    } else {
      context.ws.send([
        'eval',
        `
        document.getElementById('label_image').style.display = 'none';
        document.getElementById('label_image').src = '';
        document.getElementById('label_image').dataset.imageId = '';
        document.getElementById('preview-container').style.display = 'none';
        document.getElementById('no-image-message').hidden = false;
        window.keypointBoxesData = [];
        window.keypointData = [];
        currentBoxId = null;
        window._keypointActiveBoxId = null;
        if (typeof updateBoxSelect === 'function') updateBoxSelect([]);
        if (typeof renderKeypointList === 'function') renderKeypointList();
        `,
      ])
    }

    throw EarlyTerminate
  } catch (error) {
    if (error !== EarlyTerminate) {
      console.error(error)
      context.ws.send(showError(error))
    }
    throw EarlyTerminate
  }
}

let routes = {
  '/annotate-keypoint': {
    resolve(context) {
      let params = new URLSearchParams(context.routerMatch?.search)
      let project_id = params.get('project') ?? '1'
      let label_id = params.get('label') ?? ''
      let image_id = params.get('image') ?? ''
      return {
        title: <ProjectPageTitle t={pageTitle} />,
        description: 'Mark keypoints on bounding boxes of images',
        node: (
          <>
            {style}
            <ion-header>
              <ion-toolbar>
                <ProjectPageBackButton />
                <ion-title role="heading" aria-level="1">
                  {pageTitle}
                </ion-title>
              </ion-toolbar>
            </ion-header>
            <ion-content id="AnnotateKeypoint" class="ion-no-padding">
              {keypointEditorPlugin.node}
              {sweetAlertPlugin.node}
              {script}
              <Main
                project_id={project_id}
                label_id={label_id}
                image_id={image_id}
              />
            </ion-content>
          </>
        ),
      }
    },
  },
  '/annotate-keypoint/showImage': {
    title: <Title t={pageTitle} />,
    description: 'Show next image for keypoint annotation',
    node: <ShowImage />,
  },
  '/annotate-keypoint/getKeypoints': {
    title: <Title t={pageTitle} />,
    description: 'Get bounding boxes and keypoints for image and label',
    node: <GetKeypoints />,
  },
  '/annotate-keypoint/saveKeypoint': {
    title: <Title t={pageTitle} />,
    description: 'Save a keypoint',
    node: <SaveKeypoint />,
  },
  '/annotate-keypoint/deleteKeypoint': {
    title: <Title t={pageTitle} />,
    description: 'Delete a keypoint',
    node: <DeleteKeypoint />,
  },
  '/annotate-keypoint/submitKeypoints': {
    title: <Title t={pageTitle} />,
    description: 'Submit keypoint confirmation',
    node: <SubmitKeypoints />,
  },
} satisfies Routes

export default { routes }
