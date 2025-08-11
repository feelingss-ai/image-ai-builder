import { o } from '../jsx/jsx.js'
import { Routes } from '../routes.js'
import Style from '../components/style.js'
import { IonBackButton } from '../components/ion-back-button.js'
import { mapArray } from '../components/fragment.js'
import { proxy } from '../../../db/proxy.js'
import { Locale, makeThrows, Title } from '../components/locale.js'
import {
  DynamicContext,
  ExpressContext,
  getContextFormBody,
  WsContext,
} from '../context.js'
import { db } from '../../../db/db.js'
import { getAuthUser, getAuthUserId } from '../auth/user.js'
import { IonButton } from '../components/ion-button.js'
import { EarlyTerminate } from '../../exception.js'
import { showError } from '../components/error.js'
import { id, number, object, values } from 'cast.ts'
import { Script } from '../components/script.js'
import { loadClientPlugin } from '../../client-plugin.js'

let dragUIPlugin = loadClientPlugin({
  entryFile: 'dist/client/drag-ui.js',
})

let pageTitle = (
  <Locale en="Annotate Bounding Box" zh_hk="標註邊界框" zh_cn="标注边界框" />
)

let style = Style(/* css */ `
#AnnotateBoundingBox .bounding-box-area {
}

#bounding_box_canvas {
  width: calc(100% - 1rem);
  height: 400px;
  outline: 1px solid red;
  margin: 0.5rem;
  background: #f8f8f8;
}

#gesture_info {
  white-space: pre-wrap;
  font-family: monospace;
}

#editorContainer canvas {
  width: 100%;
}
#minimapCanvas {
  height: calc(30dvh - 6rem);
  object-fit: contain;
}
#previewCanvas {
  height: calc(70dvh - 6rem);
  object-fit: fill;
}
`)

let script = Script(/* js */ `
// Displays the next image for annotation based on selected label
function showImage() {
  const labelId = label_select.value
  if (!labelId) {
    console.error('No label_id selected')
    return
  }
  console.log('showImage called with label_id:', labelId)
  emit('/annotate-bounding-box/showImage', {
    label_id: labelId,
  })
}

// Submits an image annotation and updates the UI with new count
function addBoundingBox() {
  let image = document.getElementById('label_image')
  let image_id = image.dataset.imageId
  let label_id = document.getElementById('label_select').value
  
  console.log('addBoundingBox: image_id =', image_id, 'type:', typeof image_id)
  console.log('addBoundingBox: label_id =', label_id, 'type:', typeof label_id)
  console.log('addBoundingBox: camera =', window.camera)
  
  // Validate data before sending
  if (!image_id || image_id === 'undefined' || image_id === 'null') {
    console.error('addBoundingBox: Invalid image_id:', image_id)
    return
  }
  
  if (!label_id || label_id === 'undefined' || label_id === 'null') {
    console.error('addBoundingBox: Invalid label_id:', label_id)
    return
  }
  
  // Convert to numbers
  image_id = parseInt(image_id)
  label_id = parseInt(label_id)
  
  console.log('addBoundingBox: Converted image_id =', image_id, 'type:', typeof image_id)
  console.log('addBoundingBox: Converted label_id =', label_id, 'type:', typeof label_id)
  
  // Get current camera position from drag-ui
  if (typeof window.camera !== 'undefined') {
    // Debug: Check if this is the same camera object
    console.log('addBoundingBox: Window camera reference:', window.camera)
    
    // Try to get the actual camera state from the drag-ui module
    let currentCamera = window.camera
    
    // If we have access to the drag-ui's internal camera, use that instead
    if (typeof setupDragUI === 'function' && window._dragUICamera) {
      currentCamera = window._dragUICamera
      console.log('addBoundingBox: Using drag-ui internal camera:', currentCamera)
    }
    
    // Try to get the most up-to-date camera state using the getCurrentCamera function
    if (typeof getCurrentCamera === 'function') {
      currentCamera = getCurrentCamera()
      console.log('addBoundingBox: Using getCurrentCamera():', currentCamera)
    }
    
    // Force a render to ensure camera state is up to date
    if (typeof render === 'function') {
      render()
    }
    
    // Get the most up-to-date camera values by directly accessing the camera object
    // that's being used by the drag-ui module
    let data = {
      image_id: image_id,
      label_id: label_id,
      x: currentCamera.x,
      y: currentCamera.y,
      width: currentCamera.width,
      height: currentCamera.height,
      rotate: currentCamera.rotate
    }
    
    console.log('addBoundingBox: Camera object:', currentCamera)
    console.log('addBoundingBox: Sending data:', data)
    emit('/annotate-bounding-box/addBoundingBox', data);
  } else {
    console.error('Camera not initialized')
  }
}

function draw_image() {
  let width = viewport.width * label_image.naturalWidth
  let height = viewport.height * label_image.naturalHeight
  let x = viewport.x * label_image.naturalWidth
  let y = viewport.y * label_image.naturalHeight
  let left = x - width / 2
  let top = y - height / 2
  context.drawImage(
    label_image,
    /* source */
    left,
    top,
    width,
    height,
    /* destination */
    0, 0, canvas.width, canvas.height,
  )
}
var last_time = 0
async function setupEditorUI() {
  console.log('setupEditorUI called')
  
  // Get DOM elements
  let label_image = document.getElementById('label_image')
  let minimapCanvas = document.getElementById('minimapCanvas')
  let previewCanvas = document.getElementById('previewCanvas')
  let debugMessage = document.getElementById('debugMessage')
  let debugStartMessage = document.getElementById('debugStartMessage')
  let debugMoveMessage = document.getElementById('debugMoveMessage')
  let debugEndMessage = document.getElementById('debugEndMessage')
  
  // Clear any existing touch listeners to prevent conflicts
  if (previewCanvas._dragUiListenersAttached) {
    console.log('setupEditorUI: Removing existing listeners before re-initializing')
    // Remove existing listeners by cloning the element
    let newCanvas = previewCanvas.cloneNode(true)
    previewCanvas.parentNode.replaceChild(newCanvas, previewCanvas)
    // Update reference to the new canvas
    previewCanvas = document.getElementById('previewCanvas')
  }
  
  // TODO: get bounding boxes from database
  let bounding_boxes = []
  // debugger;
  setupDragUI({
    image: label_image,
    minimap_canvas: minimapCanvas,
    preview_canvas: previewCanvas,

    debugMessage: debugMessage,
    debugStartMessage: debugStartMessage,
    debugMoveMessage: debugMoveMessage,
    debugEndMessage: debugEndMessage,

    bounding_boxes: bounding_boxes,
    resetCamera: true,
  })
  
  // Camera reset is now handled in setupDragUI with resetCamera: true
  console.log('setupEditorUI: Camera reset handled by setupDragUI')
}

function updateSelectOptionText(selector, text) {
  let option = document.querySelector(selector)
  if (option) {
    console.log('Updating option text:', selector, text)
    option.textContent = text
    let ionSelect = document.querySelector('ion-select#label_select')
    if (ionSelect) {
      ionSelect.forceUpdate?.()
      console.log('Triggered ion-select update and ionChange event')
    } else {
      console.error('ion-select#label_select not found')
    }
  } else {
    console.error('Option not found:', selector)
  }
}

AnnotateBoundingBox.addEventListener('ionChange', function(event) {
  if (event.target.id !== 'label_select') {
    return;
  }
  const label_id = event.target.value;
  if (!label_id) {
    console.error('No label_id selected');
    return;
  }
  emit('/annotate-bounding-box/showImage', { label_id });
});

// Function to zoom in the image by reducing camera width and height
function zoomInImage() {
  console.log('zoomInImage called')
  
  if (!window.camera) {
    console.error('Camera not initialized')
    return
  }
  
  // Get current camera state
  let camera = window.camera
  console.log('zoomInImage: Current camera state:', camera)
  
  // Calculate zoom factor (reduce width and height by 20%)
  let zoomFactor = 0.8
  
  // Update camera dimensions
  let newWidth = camera.width * zoomFactor
  let newHeight = camera.height * zoomFactor
  
  // Ensure minimum size to prevent zooming too much
  let minSize = 0.1
  if (newWidth < minSize) {
    newWidth = minSize
  }
  if (newHeight < minSize) {
    newHeight = minSize
  }
  
  // Update camera state
  camera.width = newWidth
  camera.height = newHeight
  
  console.log('zoomInImage: Updated camera state:', camera)
  
  // Force immediate re-render
  if (typeof window.render === 'function') {
    window.render()
    console.log('zoomInImage: Render function called')
  } else {
    console.error('zoomInImage: Render function not available')
  }
    
  // Log the zoom operation
  console.log('zoomInImage: Image zoomed in by', (1 - zoomFactor) * 100, '%')
}

// Function to zoom out the image by increasing camera width and height
function zoomOutImage() {
  console.log('zoomOutImage called')
  
  if (!window.camera) {
    console.error('Camera not initialized')
    return
  }
  
  // Get current camera state
  let camera = window.camera
  console.log('zoomOutImage: Current camera state:', camera)
  
  // Calculate zoom factor (increase width and height by 25%)
  let zoomFactor = 1.25
  
  // Update camera dimensions
  let newWidth = camera.width * zoomFactor
  let newHeight = camera.height * zoomFactor
  
  // Ensure maximum size to prevent zooming out too much
  let maxSize = 1.0
  if (newWidth > maxSize) {
    newWidth = maxSize
  }
  if (newHeight > maxSize) {
    newHeight = maxSize
  }
  
  // Always allow zooming out, even if current size is 1.0
  // Only prevent if we're already at max size
  if (camera.width < maxSize || camera.height < maxSize) {
    // Update camera state
    camera.width = newWidth
    camera.height = newHeight
    
    console.log('zoomOutImage: Updated camera state:', camera)
    
    // Force immediate re-render
    if (typeof window.render === 'function') {
      window.render()
      console.log('zoomOutImage: Render function called')
    } else {
      console.error('zoomOutImage: Render function not available')
    }
    
    // Log the zoom operation
    console.log('zoomOutImage: Image zoomed out by', (zoomFactor - 1) * 100, '%')
  } else {
    console.log('zoomOutImage: Already at maximum zoom out level')
  }
}

// Function to reset zoom to original size
function resetZoom() {
  console.log('resetZoom called')
  
  if (!window.camera) {
    console.error('Camera not initialized')
    return
  }
  
  // Get current camera state
  let camera = window.camera
  console.log('resetZoom: Current camera state:', camera)
  
  // Reset to original size and center position
  camera.width = 1.0
  camera.height = 1.0
  camera.x = 0.5
  camera.y = 0.5
  camera.rotate = 0
  camera.rotate_angle = 0
  
  console.log('resetZoom: Reset camera state:', camera)
  
  // Force immediate re-render
  if (typeof window.render === 'function') {
    window.render()
    console.log('resetZoom: Render function called')
  } else {
    console.error('resetZoom: Render function not available')
  }
  
  // Log the reset operation
  console.log('resetZoom: Image zoom and position reset to original state')
}

function rotateLeft() {
  console.log('rotateLeft called')
  if (!window.camera) {
    console.error('Camera not initialized')
    return
  }
  let camera = window.camera
  camera.rotate = (camera.rotate - 0.05) % 1
  camera.rotate_angle = camera.rotate * 2 * Math.PI
  if (typeof window.render === 'function') {
    window.render()
    console.log('rotateLeft: Render function called')
  }
}

function rotateRight() {
  console.log('rotateRight called')
  if (!window.camera) {
    console.error('Camera not initialized')
    return
  }
  let camera = window.camera
  camera.rotate = (camera.rotate + 0.05) % 1
  camera.rotate_angle = camera.rotate * 2 * Math.PI
  if (typeof window.render === 'function') {
    window.render()
    console.log('rotateRight: Render function called')
  }
}

// --- Continuous rotation (press & hold) ---
let _isRotating = false
let _rotateDir = 0 // -1 (left) or +1 (right)
let _lastRotateTs = 0
const _rotationSpeedTurnsPerSecond = 0.25 // 0.25 turn = 90° per second

function _rotationLoop(ts) {
  if (!_isRotating) return
  if (!_lastRotateTs) _lastRotateTs = ts
  const dt = (ts - _lastRotateTs) / 1000
  _lastRotateTs = ts
  if (window.camera) {
    const cam = window.camera
    cam.rotate = (cam.rotate + _rotateDir * _rotationSpeedTurnsPerSecond * dt + 1) % 1
    cam.rotate_angle = cam.rotate * 2 * Math.PI
    if (typeof window.render === 'function') window.render()
  }
  requestAnimationFrame(_rotationLoop)
}

function startRotation(dir) {
  if (!_isRotating) {
    _isRotating = true
    _rotateDir = dir
    _lastRotateTs = 0
    requestAnimationFrame(_rotationLoop)
  } else {
    _rotateDir = dir // allow switching direction while holding different button
  }
}

function stopRotation() {
  _isRotating = false
  _rotateDir = 0
  _lastRotateTs = 0
}

// Safety: stop rotation if pointer released outside button or window loses focus
window.addEventListener('pointerup', stopRotation)
window.addEventListener('pointercancel', stopRotation)
window.addEventListener('blur', stopRotation)
window.addEventListener('visibilitychange', () => { if (document.hidden) stopRotation() })

window.setupEditorUI = setupEditorUI

`)

let page = (
  <>
    {style}
    {/* {hammerScript}
    {hammerInitScript} */}
    <ion-header>
      <ion-toolbar>
        <IonBackButton href="/" backText="Home" />
        <ion-title role="heading" aria-level="1">
          {pageTitle}
        </ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content id="AnnotateBoundingBox" class="ion-no-padding">
      {dragUIPlugin.node}
      {script}
      <Main />
    </ion-content>
  </>
)

let count_label_images = db
  .prepare<{ label_id: number }, number>(
    /* sql */ `
select count(distinct image_id)
from image_label
where label_id = :label_id
and answer = 1
`,
  )
  .pluck()

// let has_previous_annotation = db
//   .prepare<{ label_id: number }, number>(
//     /* sql */ `
// select count(*) from image_label where label_id = :label_id
// `,
//   )
//   .pluck()

let select_next_image = db.prepare<
  { label_id: number },
  { id: number; filename: string; rotation: number | null }
>(/* sql */ `
  select image.id, image.filename, image.rotation
  from image_label
  inner join image on image.id = image_label.image_id
  where answer = 1
    and image_label.label_id = :label_id
`)

let insert_bounding_box = db.prepare<
  {
    image_id: number
    user_id: number
    label_id: number
    x: number
    y: number
    width: number
    height: number
    rotate: number
  },
  { id: number }
>(/* sql */ `
  INSERT INTO image_bounding_box (image_id, user_id, label_id, x, y, width, height, rotate)
  VALUES (:image_id, :user_id, :label_id, :x, :y, :width, :height, :rotate)
  RETURNING id
`)

let check_image_label = db.prepare<
  {
    image_id: number
    user_id: number
    label_id: number
  },
  { id: number } | null
>(/* sql */ `
  SELECT id FROM image_label 
  WHERE image_id = :image_id AND user_id = :user_id AND label_id = :label_id
  LIMIT 1
`)

let ensure_image_label = db.prepare<
  {
    image_id: number
    user_id: number
    label_id: number
  },
  { id: number }
>(/* sql */ `
  INSERT INTO image_label (image_id, user_id, label_id, answer)
  VALUES (:image_id, :user_id, :label_id, 1)
  RETURNING id
`)

function Main(attrs: {}, context: any) {
  let user = getAuthUser(context)
  if (!user) {
    return (
      <>
        <div style="margin: auto; width: fit-content; text-align: center;">
          <p class="ion-padding ion-margin error">
            <Locale
              en="You must be logged in to annotate bounding boxes"
              zh_hk="您必須登入才能標註邊界框"
              zh_cn="您必须登录才能标注边界框"
            />
          </p>
          <IonButton url="/login" color="primary">
            <Locale en="Login" zh_hk="登入" zh_cn="登录" />
          </IonButton>
        </div>
      </>
    )
  }

  let label_id = 1
  // let image = proxy.image[0]
  let total_images = proxy.image.length
  let image = select_next_image.get({ label_id })

  return (
    <>
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
            {mapArray(proxy.label, label => {
              let label_images = count_label_images.get({
                label_id: label.id!,
              })
              return (
                <ion-select-option value={label.id}>
                  {label.title} (0/{label_images})
                </ion-select-option>
              )
            })}
          </ion-select>
        </ion-item>
        <div style="flex-grow: 1; overflow: hidden">
          <div id="editorContainer">
            <canvas id="minimapCanvas"></canvas>
            <canvas id="previewCanvas"></canvas>
          </div>
          <div id="debugMessage">
            <div id="debugStartMessage"></div>
            <div id="debugMoveMessage"></div>
            <div id="debugEndMessage"></div>
          </div>
          <img
            hidden
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
            style="width: 100vw; max-width: 100vw; height: auto; max-height: 60vh; object-fit: contain;"
            // hidden={!image}
            onLoad="setTimeout(() => { if (typeof setupEditorUI === 'function') setupEditorUI(); }, 100);"
          />
          <div
            id="no-image-message"
            style="display: flex; align-items: center; justify-content: center; height: 100%; text-align: center; padding: 2rem;"
            hidden={!!image}
          ></div>
        </div>
        <div style="display: flex; flex-direction: column; gap: 0.5rem; margin-top: 1rem;">
          <div style="display: flex; justify-content: space-between; gap: 1rem;">
          <ion-button
              color="secondary"
            style="flex: 1;"
              onclick="zoomInImage()"
              title={<Locale en="Zoom In" zh_hk="放大" zh_cn="放大" />}
          >
              <ion-icon name="expand" slot="icon-only"></ion-icon>
          </ion-button>
          <ion-button
              color="tertiary"
            style="flex: 1;"
              onclick="zoomOutImage()"
              title={<Locale en="Zoom Out" zh_hk="縮小" zh_cn="缩小" />}
            >
              <ion-icon name="contract" slot="icon-only"></ion-icon>
            </ion-button>
            <ion-button
              color="medium"
              style="flex: 1;"
              onmousedown="startRotation(-1)"
              onmouseup="stopRotation()"
              onmouseleave="stopRotation()"
              ontouchstart="startRotation(-1)"
              ontouchend="stopRotation()"
              ontouchcancel="stopRotation()"
            title={
                <Locale en="Rotate Left" zh_hk="向左旋轉" zh_cn="向左旋转" />
            }
          >
              <ion-icon
                name="refresh-circle"
                style="transform: scaleX(-1);"
                slot="icon-only"
              ></ion-icon>
          </ion-button>
          <ion-button
              color="medium"
            style="flex: 1;"
              onmousedown="startRotation(1)"
              onmouseup="stopRotation()"
              onmouseleave="stopRotation()"
              ontouchstart="startRotation(1)"
              ontouchend="stopRotation()"
              ontouchcancel="stopRotation()"
            title={
                <Locale en="Rotate Right" zh_hk="向右旋轉" zh_cn="向右旋转" />
            }
          >
              <ion-icon name="refresh-circle" slot="icon-only"></ion-icon>
          </ion-button>
          <ion-button
            color="warning"
            style="flex: 1;"
            onclick="resetZoom()"
              title={<Locale en="Reset" zh_hk="重設" zh_cn="重置" />}
          >
            <ion-icon name="refresh" slot="icon-only"></ion-icon>
          </ion-button>
          </div>
          <div style="display: flex; justify-content: space-between; gap: 1rem;">
            <ion-button
              color="primary"
              style="flex: 1;"
              onclick="addBoundingBox()"
              title={
                <Locale
                  en="Add Bounding Box"
                  zh_hk="新增標註框"
                  zh_cn="新增标注框"
                />
              }
            >
              <ion-icon name="add" slot="icon-only"></ion-icon>
            </ion-button>
          <ion-button color="success" style="flex: 1;">
            <Locale
              en="Submit bounding box"
              zh_hk="提交標註"
              zh_cn="提交标注"
            />
          </ion-button>
          </div>
        </div>
      </div>
    </>
  )
}

let showImageParser = object({
  label_id: id(),
})

let addBoundingBoxParser = object({
  image_id: id(),
  label_id: id(),
  x: number(),
  y: number(),
  width: number(),
  height: number(),
  rotate: number(),
})

// Displays the next image for annotation based on the selected label
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
    console.log('label_id lol', label_id)
    console.log(
      `ShowImage: Processing label_id=${label_id}, user_id=${user_id}`,
    )

    // check if label exists
    let next_image = select_next_image.get({ label_id })
    console.log(`ShowImage: next_image for label_id=${label_id}:`, next_image)

    if (next_image) {
      // Update image attributes and trigger setupEditorUI after load
      context.ws.send([
        'update-attrs',
        '#label_image',
        {
          'src': `/uploads/${next_image.filename}`,
          'data-image-id': next_image.id,
          'data-rotation': next_image.rotation || 0,
          // 'hidden': false,
          // 'onload': 'setupEditorUI()',
        },
      ])

      // NOTE: Do not trigger setupEditorUI here; the <img onLoad> already calls it
      // to avoid double-registration of touch listeners
    } else {
      // Hide image if no image found
      context.ws.send([
        'update-attrs',
        '#label_image',
        {
          'src': '',
          'data-image-id': '',
          'data-rotation': 0,
          'hidden': true,
        },
      ])
    }

    // Terminate execution to prevent further processing
    throw EarlyTerminate
  } catch (error) {
    // Handle non-termination errors by logging and sending error message to client
    if (error !== EarlyTerminate) {
      console.error(error)
      context.ws.send(showError(error))
    }
    // Ensure termination of the function
    throw EarlyTerminate
  }
}

function AddBoundingBox(attrs: {}, context: WsContext) {
  try {
    let throws = makeThrows(context)
    let user_id = getAuthUserId(context)!
    if (!user_id)
      throws({
        en: 'You must be logged in to add bounding box',
        zh_hk: '您必須登入才能添加邊界框',
        zh_cn: '您必须登录才能添加边界框',
      })

    let body = getContextFormBody(context)
    let input = addBoundingBoxParser.parse(body)

    console.log('AddBoundingBox: Processing input:', input)
    console.log(`AddBoundingBox: user_id=${user_id}`)

    // Debug: Check database state
    console.log('AddBoundingBox: Database state check:')
    console.log('- Total labels:', proxy.label.length)
    console.log('- Total images:', proxy.image.length)
    console.log('- Total users:', proxy.user.length)
    console.log('- Total image_labels:', proxy.image_label.length)

    // Debug: Check for undefined entries
    console.log('AddBoundingBox: Checking for undefined entries:')
    console.log(
      '- Labels with undefined id:',
      proxy.label.filter(l => !l || l.id === undefined).length,
    )
    console.log(
      '- Images with undefined id:',
      proxy.image.filter(i => !i || i.id === undefined).length,
    )
    console.log(
      '- Users with undefined id:',
      proxy.user.filter(u => !u || u.id === undefined).length,
    )

    // Check if image_label record exists, create if not
    let existing_image_label = check_image_label.get({
      image_id: input.image_id,
      user_id: user_id,
      label_id: input.label_id,
    })

    if (!existing_image_label) {
      // Create new image_label record
      let image_label_result = ensure_image_label.get({
        image_id: input.image_id,
        user_id: user_id,
        label_id: input.label_id,
      })

      if (!image_label_result) {
        throws({
          en: 'Failed to create image label record',
          zh_hk: '創建圖片標籤記錄失敗',
          zh_cn: '创建图片标签记录失败',
        })
      }
    }

    // Verify that the label exists
    let label = proxy.label[input.label_id]
    if (!label) {
      console.log(
        'AddBoundingBox: Available labels:',
        proxy.label
          .filter(l => l && l.id !== undefined)
          .map(l => ({ id: l.id, title: l.title })),
      )
      throws({
        en: 'Label not found',
        zh_hk: '找不到標籤',
        zh_cn: '找不到标签',
      })
    }

    // Verify that the image exists
    let image = proxy.image[input.image_id]
    if (!image) {
      console.log(
        'AddBoundingBox: Available images:',
        proxy.image
          .filter(i => i && i.id !== undefined)
          .map(i => ({ id: i.id, filename: i.filename })),
      )
      throws({
        en: 'Image not found',
        zh_hk: '找不到圖片',
        zh_cn: '找不到图片',
      })
    }

    // Verify that the user exists
    let user_record = proxy.user.find(u => u && u.id === user_id)
    if (!user_record) {
      console.log(
        'AddBoundingBox: Available users:',
        proxy.user
          .filter(u => u && u.id !== undefined)
          .map(u => ({ id: u.id, username: u.username })),
      )
      throws({
        en: 'User not found',
        zh_hk: '找不到用戶',
        zh_cn: '找不到用户',
      })
    }
    // Insert bounding box into database
    let result = insert_bounding_box.get({
      image_id: input.image_id,
      user_id: user_id,
      label_id: input.label_id,
      x: input.x,
      y: input.y,
      width: input.width,
      height: input.height,
      rotate: input.rotate,
    })

    if (!result) {
      throws({
        en: 'Failed to insert bounding box',
        zh_hk: '插入邊界框失敗',
        zh_cn: '插入边界框失败',
      })
    }

    // Send success message to client
    context.ws.send([
      'update-text',
      '#debugMessage',
      `Bounding box added successfully! ID: ${result!.id}`,
    ])

    // Terminate execution to prevent further processing
    throw EarlyTerminate
  } catch (error) {
    // Handle non-termination errors by logging and sending error message to client
    if (error !== EarlyTerminate) {
      console.error(error)
      context.ws.send(showError(error))
    }
    // Ensure termination of the function
    throw EarlyTerminate
  }
}

let routes = {
  '/annotate-bounding-box': {
    title: <Title t={pageTitle} />,
    description: 'Annotate bounding boxes on images',
    node: page,
  },
  '/annotate-bounding-box/showImage': {
    title: <Title t={pageTitle} />,
    description: 'Annotate bounding boxes on images',
    node: <ShowImage />,
  },
  '/annotate-bounding-box/addBoundingBox': {
    title: <Title t={pageTitle} />,
    description: 'Annotate bounding boxes on images',
    node: <AddBoundingBox />,
  },
  // '/annotate-bounding-box/submitBoundingBox': {
  //   title: <Title t={pageTitle} />,
  //   description: 'Annotate bounding boxes on images',
  //   node: <SubmitBoundingBox />,
  // },
} satisfies Routes

export default { routes }
