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

let sweetAlertPlugin = loadClientPlugin({
  entryFile: 'dist/client/sweetalert.js',
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
// Helper function to wait for WebSocket to be ready
async function waitForWebSocket(maxAttempts = 50) {
  let attempts = 0
  while (typeof emit !== 'function' && attempts < maxAttempts) {
    await new Promise(resolve => setTimeout(resolve, 100))
    attempts++
  }
  
  if (typeof emit !== 'function') {
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
  console.log('showImage called with label_id:', labelId)
  
  // Wait for WebSocket to be ready
  if (!(await waitForWebSocket())) {
    console.error('showImage: WebSocket not ready')
    return
  }
  
  emit('/annotate-bounding-box/showImage', {
    label_id: labelId,
  })
}

// Function to fetch bounding boxes from server
async function fetchBoundingBoxes(image_id, label_id) {
  try {
    console.log('fetchBoundingBoxes: Fetching for image_id:', image_id, 'label_id:', label_id)
    
    // Clear previous data to ensure fresh fetch
    window.boundingBoxesData = null
    
    // Wait for WebSocket to be ready
    if (!(await waitForWebSocket())) {
      console.error('fetchBoundingBoxes: WebSocket not ready')
      return []
    }
    
    // Send request via WebSocket
    emit('/annotate-bounding-box/getBoundingBoxes', { image_id, label_id })
    
    // Wait for response (poll for data)
    let attempts = 0
    const maxAttempts = 50 // 5 seconds max wait
    while (!window.boundingBoxesData && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 100))
      attempts++
    }
    
    if (window.boundingBoxesData) {
      console.log('fetchBoundingBoxes: Received', window.boundingBoxesData.length, 'boxes')
      return window.boundingBoxesData
    } else {
      console.error('fetchBoundingBoxes: Timeout waiting for response')
      return []
    }
  } catch (error) {
    console.error('fetchBoundingBoxes: Error:', error)
    return []
  }
}

// Submits an image annotation and updates the UI with new count
async function addBoundingBox() {
  let image = document.getElementById('label_image')
  let image_id = image.dataset.imageId
  let label_id = document.getElementById('label_select').value
  
  console.log('addBoundingBox: image_id =', image_id, 'type:', typeof image_id)
  console.log('addBoundingBox: label_id =', label_id, 'type:', typeof label_id)
  console.log('addBoundingBox: camera =', window.camera)
  console.log('addBoundingBox: editMode =', window._editMode)
  
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
    
    // Wait for WebSocket to be ready
    if (!(await waitForWebSocket())) {
      console.error('addBoundingBox: WebSocket not ready')
      return
    }
    
    // Check if we're in edit mode
    if (window._editMode && window._editingBoundingBox) {
      // Update existing bounding box
      data.box_id = window._editingBoundingBox.id
      console.log('addBoundingBox: Updating existing box with ID:', data.box_id)
      emit('/annotate-bounding-box/updateBoundingBox', data)
      
      // Exit edit mode after saving
      exitEditMode()
    } else {
      // Add new bounding box
      console.log('addBoundingBox: Adding new bounding box')
      emit('/annotate-bounding-box/addBoundingBox', data)
    }
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
// Check if last_time is already declared to prevent re-declaration errors
if (typeof window.last_time === 'undefined') {
  window.last_time = 0
}
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
  
  // Clear selected bounding box when re-initializing
  window.selectedBoundingBoxId = undefined
  if (typeof window.updateDeleteButton === 'function') {
    window.updateDeleteButton()
  }
  
  // Initialize cancel edit button visibility
  if (typeof window.updateCancelEditButtonVisibility === 'function') {
    window.updateCancelEditButtonVisibility()
  }
  
  // Get bounding boxes from database
  let image_id = parseInt(label_image.dataset.imageId)
  let label_id = parseInt(document.getElementById('label_select').value)
  let bounding_boxes = []
  
  if (image_id && label_id) {
    console.log('setupEditorUI: Fetching bounding boxes for image_id:', image_id, 'label_id:', label_id)
    // Fetch existing bounding boxes from database using client-side function
    bounding_boxes = await fetchBoundingBoxes(image_id, label_id)
    console.log('setupEditorUI: Found', bounding_boxes.length, 'bounding boxes')
    
    // Check if currently selected bounding box still exists
    if (window.selectedBoundingBoxId != null) {
      const selectedExists = bounding_boxes.find(box => box.id === window.selectedBoundingBoxId)
      if (!selectedExists) {
        console.log('setupEditorUI: Selected bounding box no longer exists, clearing selection')
        window.selectedBoundingBoxId = undefined
        if (typeof window.updateDeleteButton === 'function') {
          window.updateDeleteButton()
        }
      }
    }
  }
  
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
  
  // Set up periodic update of delete button state
  if (!window._deleteButtonUpdateInterval) {
    window._deleteButtonUpdateInterval = setInterval(updateDeleteButton, 500)
  }
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

// Add event listener for ion-select changes
// Only add the event listener once to prevent duplicates
if (!window._ionChangeListenerAdded) {
  document.addEventListener('ionChange', async function(event) {
    if (event.target.id !== 'label_select') {
      return;
    }
    const label_id = parseInt(event.target.value);
    if (!label_id) {
      console.error('No label_id selected');
      return;
    }
    
    // Immediately clear data-image-id when switching labels
    let image = document.getElementById('label_image')
    if (image) {
      image.dataset.imageId = ''
      image.src = ''
      image.hidden = true
    }
    
    // Clear previous bounding box data when switching labels
    window.boundingBoxesData = null
    console.log('Cleared bounding box data for new label')
    
    // Wait for WebSocket to be ready
    if (!(await waitForWebSocket())) {
      console.error('ionChange: WebSocket not ready')
      return
    }
    
    emit('/annotate-bounding-box/showImage', { label_id });
  });
  window._ionChangeListenerAdded = true;
}

// Function to update delete button state based on selection
function updateDeleteButton() {
  const deleteBtn = document.getElementById('delete-bounding-box-btn')
  const hasSelection = window.selectedBoundingBoxId != null

  // Double check: if we have a selected ID, verify it exists in current data
  if (hasSelection && window.boundingBoxesData) {
    const selectedExists = window.boundingBoxesData.find(box => box.id === window.selectedBoundingBoxId)
    if (!selectedExists) {
      console.log('updateDeleteButton: Selected box does not exist in current data, clearing selection')
      window.selectedBoundingBoxId = undefined
      // Re-call this function with corrected state
      updateDeleteButton()
      return
    }
  }
  
  if (deleteBtn) {
    const actualHasSelection = window.selectedBoundingBoxId != null
    deleteBtn.disabled = !actualHasSelection
    if (actualHasSelection) {
      deleteBtn.style.opacity = '1'
      deleteBtn.style.cursor = 'pointer'
    } else {
      deleteBtn.style.opacity = '0.5'
      deleteBtn.style.cursor = 'not-allowed'
    }
  }
}

// Function to delete the selected bounding box
async function deleteBoundingBox() {
  console.log('deleteBoundingBox called, selectedBoundingBoxId =', window.selectedBoundingBoxId)
  
  if (!window.selectedBoundingBoxId) {
    console.error('No bounding box selected for deletion')
    alert('Please select a bounding box first by clicking on it')
    return
  }
  
  let image = document.getElementById('label_image')
  let image_id = image.dataset.imageId
  let label_id = document.getElementById('label_select').value
  
  console.log('deleteBoundingBox: box_id =', window.selectedBoundingBoxId)
  console.log('deleteBoundingBox: image_id =', image_id, 'label_id =', label_id)
  
  // Validate data before sending
  if (!image_id || image_id === 'undefined' || image_id === 'null') {
    console.error('deleteBoundingBox: Invalid image_id:', image_id)
    return
  }
  
  if (!label_id || label_id === 'undefined' || label_id === 'null') {
    console.error('deleteBoundingBox: Invalid label_id:', label_id)
    return
  }
  
  // Convert to numbers
  image_id = parseInt(image_id)
  label_id = parseInt(label_id)
  
  let data = {
    box_id: window.selectedBoundingBoxId,
    image_id: image_id,
    label_id: label_id
  }
  
  console.log('deleteBoundingBox: Sending data:', data)
  
  // Clear selection immediately before sending request
  window.selectedBoundingBoxId = undefined
  if (typeof window.updateDeleteButton === 'function') {
    window.updateDeleteButton()
  }
  
  // Wait for WebSocket to be ready
  if (!(await waitForWebSocket())) {
    console.error('deleteBoundingBox: WebSocket not ready')
    return
  }
  
  emit('/annotate-bounding-box/deleteBoundingBox', data)
}

// Function to submit all bounding boxes for current image
async function submitBoundingBoxes() {
  let image = document.getElementById('label_image')
  let image_id = image.dataset.imageId
  let label_id = document.getElementById('label_select').value
  
  console.log('submitBoundingBoxes: image_id =', image_id, 'label_id =', label_id)
  
  // Validate data
  if (!image_id || image_id === 'undefined' || image_id === 'null') {
    console.error('submitBoundingBoxes: Invalid image_id:', image_id)
    return
  }
  
  if (!label_id || label_id === 'undefined' || label_id === 'null') {
    console.error('submitBoundingBoxes: Invalid label_id:', label_id)
    return
  }
  
  // Get current bounding boxes count
  const currentBoundingBoxes = window.boundingBoxesData || []
  const totalBoxes = currentBoundingBoxes.length
  
  // Show confirmation dialog using showConfirm
  let message = 
    (totalBoxes > 0
      ? 'Are you sure you want to submit {count} bounding box(es) for this image?'
      : 'Are you sure you want to submit this image without any bounding boxes?')
    .replace('{count}', totalBoxes)
  
  let ans = await showConfirm({
    title: message,
    confirmButtonText: 'Yes, Submit',
    cancelButtonText: 'Cancel',
  })
  
  if (!ans) {
    console.log('submitBoundingBoxes: User cancelled submission')
    return
  }
  
  // Wait for WebSocket to be ready
  if (!(await waitForWebSocket())) {
    console.error('submitBoundingBoxes: WebSocket not ready')
    return
  }
  
  const data = {
    image_id: parseInt(image_id),
    label_id: parseInt(label_id)
  }
  
  console.log('submitBoundingBoxes: Submitting data:', data)
  emit('/annotate-bounding-box/submitBoundingBox', data)
}

// Function to enter edit mode for a bounding box
function enterEditMode(boundingBox) {
  console.log('Entering edit mode for bounding box:', boundingBox)
  window._editMode = true
  window._editingBoundingBox = { ...boundingBox } // Copy the bounding box data
  window.selectedBoundingBoxId = boundingBox.id
  
  // Set camera to the bounding box position for editing
  if (window.camera) {
    window.camera.x = boundingBox.x
    window.camera.y = boundingBox.y
    window.camera.width = boundingBox.width
    window.camera.height = boundingBox.height
    window.camera.rotate = boundingBox.rotate
    window.camera.rotate_angle = boundingBox.rotate_angle || (boundingBox.rotate * 2 * Math.PI)
  }
  
  // Update the bounding box select dropdown to match the selected box
  if (typeof window.updateBoundingBoxSelectValue === 'function' && boundingBox.id) {
    window.updateBoundingBoxSelectValue(boundingBox.id)
  }
  
  // Show cancel edit button
  updateCancelEditButtonVisibility()
  
  updateAddButton()
  if (typeof window.render === 'function') {
    window.render()
  }
}

// Function to exit edit mode
function exitEditMode() {
  console.log('Exiting edit mode')
  window._editMode = false
  window._editingBoundingBox = null
  window.selectedBoundingBoxId = undefined
  updateAddButton()
  if (typeof window.updateDeleteButton === 'function') {
    window.updateDeleteButton()
  }
}

// Function to cancel edit mode (same as exitEditMode but for UI clarity)
function cancelEdit() {
  console.log('Canceling edit mode')
  
  // Reset camera to show full image
  if (window.camera) {
    window.camera.x = 0.5
    window.camera.y = 0.5
    window.camera.width = 1.0
    window.camera.height = 1.0
    window.camera.rotate = 0
    window.camera.rotate_angle = 0
    
    console.log('cancelEdit: Reset camera to full view')
    
    // Force render to show the camera change
    if (typeof window.render === 'function') {
      window.render()
    }
  }
  
  // Exit edit mode
  exitEditMode()
  
  // Restore minimap bounding box state by refreshing the UI
  console.log('cancelEdit: Refreshing bounding boxes to restore minimap state')
  if (typeof window.setupEditorUI === 'function') {
    window.setupEditorUI()
  }
}

// Function to update cancel edit button visibility based on edit mode
function updateCancelEditButtonVisibility() {
  const cancelBtn = document.getElementById('cancel-edit-button')
  if (cancelBtn) {
    if (window._editMode) {
      cancelBtn.style.display = 'flex'
      // console.log('Showing cancel edit button')
    } else {
      cancelBtn.style.display = 'none'
      // console.log('Hiding cancel edit button')
    }
  }
}

// Function to update add button text based on mode
function updateAddButton() {
  const addBtn = document.getElementById('add-bounding-box-btn')
  if (addBtn) {
    if (window._editMode) {
      addBtn.querySelector('ion-icon').setAttribute('name', 'save')
      addBtn.setAttribute('title', 'Save Changes')
      addBtn.style.backgroundColor = '#28a745' // Green for save
    } else {
      addBtn.querySelector('ion-icon').setAttribute('name', 'add')
      addBtn.setAttribute('title', 'Add Bounding Box')
      addBtn.style.backgroundColor = '' // Reset to default
    }
  }
}

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
// Check if variables are already declared to prevent re-declaration errors
if (typeof window._isRotating === 'undefined') {
  window._isRotating = false
  window._rotateDir = 0 // -1 (left) or +1 (right)
  window._lastRotateTs = 0
  window._rotationSpeedTurnsPerSecond = 0.25 // 0.25 turn = 90° per second
  window._editMode = false // Track if we're in edit mode
  window._editingBoundingBox = null // Store the bounding box being edited
}

function _rotationLoop(ts) {
  if (!window._isRotating) return
  if (!window._lastRotateTs) window._lastRotateTs = ts
  const dt = (ts - window._lastRotateTs) / 1000
  window._lastRotateTs = ts
  if (window.camera) {
    const cam = window.camera
    cam.rotate = (cam.rotate + _rotateDir * _rotationSpeedTurnsPerSecond * dt + 1) % 1
    cam.rotate_angle = cam.rotate * 2 * Math.PI
    if (typeof window.render === 'function') window.render()
  }
  requestAnimationFrame(_rotationLoop)
}

function startRotation(dir) {
  if (!window._isRotating) {
    window._isRotating = true
    window._rotateDir = dir
    window._lastRotateTs = 0
    requestAnimationFrame(_rotationLoop)
  } else {
    window._rotateDir = dir // allow switching direction while holding different button
  }
}

function stopRotation() {
  window._isRotating = false
  window._rotateDir = 0
  window._lastRotateTs = 0
}

// Safety: stop rotation if pointer released outside button or window loses focus
// Only add event listeners once
if (!window._rotationListenersAdded) {
  window.addEventListener('pointerup', stopRotation)
  window.addEventListener('pointercancel', stopRotation)
  window.addEventListener('blur', stopRotation)
  window.addEventListener('visibilitychange', () => { if (document.hidden) stopRotation() })
  window._rotationListenersAdded = true
}

window.setupEditorUI = setupEditorUI
window.updateDeleteButton = updateDeleteButton
window.updateBoundingBoxSelect = updateBoundingBoxSelect
window.updateBoundingBoxSelectValue = updateBoundingBoxSelectValue
window.selectBoundingBox = selectBoundingBox
window.cancelEdit = cancelEdit
window.updateCancelEditButtonVisibility = updateCancelEditButtonVisibility

// Initialize the page with the default label when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
  console.log('Page loaded, initializing with default label');
  // Small delay to ensure WebSocket is ready
  setTimeout(() => {
    const label_select = document.getElementById('label_select');
    if (label_select && label_select.value) {
      console.log('Calling showImage for initial label:', label_select.value);
      showImage();
    }
  }, 500);
});

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
      {sweetAlertPlugin.node}
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

let count_confirmed_bounding_box_images = db
  .prepare<{ label_id: number; user_id: number }, number>(
    /* sql */ `
select count(distinct image_id)
from image_bounding_box_confirmation
where label_id = :label_id
and user_id = :user_id
`,
  )
  .pluck()

let select_next_image = db.prepare<
  { label_id: number },
  { id: number; filename: string; rotation: number | null }
>(/* sql */ `
  select image.id, image.filename, image.rotation
  from image_label
  inner join image on image.id = image_label.image_id
  where answer = 1
    and image_label.label_id = :label_id
    and image_id not in (
      select image_id
      from image_bounding_box_confirmation
      where label_id = :label_id
    )
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

let delete_bounding_box = db.prepare<
  {
    box_id: number
    user_id: number
    image_id: number
    label_id: number
  },
  { changes: number }
>(/* sql */ `
  DELETE FROM image_bounding_box 
  WHERE id = :box_id 
    AND user_id = :user_id 
    AND image_id = :image_id 
    AND label_id = :label_id
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

let get_bounding_boxes = db.prepare<
  { image_id: number; label_id: number },
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
  WHERE image_id = :image_id AND label_id = :label_id
  ORDER BY id
`)

let update_bounding_box = db.prepare<
  {
    box_id: number
    user_id: number
    image_id: number
    label_id: number
    x: number
    y: number
    width: number
    height: number
    rotate: number
  },
  { changes: number }
>(/* sql */ `
  UPDATE image_bounding_box
  SET x = :x, y = :y, width = :width, height = :height, rotate = :rotate
  WHERE id = :box_id AND user_id = :user_id AND image_id = :image_id AND label_id = :label_id
`)

let submit_bounding_box_confirmation = db.prepare<
  {
    image_id: number
    user_id: number
    label_id: number
  },
  { id: number }
>(/* sql */ `
  INSERT INTO image_bounding_box_confirmation (image_id, user_id, label_id)
  VALUES (:image_id, :user_id, :label_id)
  RETURNING id
`)

let check_bounding_box_confirmation = db.prepare<
  {
    image_id: number
    user_id: number
    label_id: number
  },
  { id: number } | null
>(/* sql */ `
  SELECT id FROM image_bounding_box_confirmation 
  WHERE image_id = :image_id AND user_id = :user_id AND label_id = :label_id
  LIMIT 1
`)

let select_next_unconfirmed_image = db.prepare<
  { label_id: number; user_id: number },
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
    AND i.id NOT IN (
      SELECT ibc.image_id 
      FROM image_bounding_box_confirmation ibc 
      WHERE ibc.label_id = :label_id AND ibc.user_id = :user_id
    )
  ORDER BY i.id
  LIMIT 1
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
  let image = select_next_unconfirmed_image.get({
    label_id: label_id,
    user_id: user.id!,
  })

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
              let confirmed_images = count_confirmed_bounding_box_images.get({
                label_id: label.id!,
                user_id: user.id!,
              })
              return (
                <ion-select-option value={label.id}>
                  {label.title} ({confirmed_images}/{label_images})
                </ion-select-option>
              )
            })}
          </ion-select>
        </ion-item>
        <div style="flex-grow: 1; overflow: hidden">
          <div id="editorContainer">
            <canvas id="minimapCanvas"></canvas>
            <div id="preview-container">
              <canvas id="previewCanvas"></canvas>
              <button
                id="cancel-edit-button"
                onclick="cancelEdit()"
                title={Locale(
                  { en: 'Cancel Edit', zh_hk: '取消編輯', zh_cn: '取消编辑' },
                  context,
                )}
              >
                <ion-icon name="close"></ion-icon>
              </button>
            </div>
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
            hidden
          >
            <div>
              <ion-icon
                name="checkmark-circle"
                style="font-size: 4rem; color: var(--ion-color-success);"
              ></ion-icon>
              <h2>
                <Locale
                  en="All images annotated!"
                  zh_hk="所有圖片已標註完成！"
                  zh_cn="所有图像已注释完成！"
                />
              </h2>
              <p>
                <Locale
                  en="You have completed annotating all images for this label."
                  zh_hk="您已完成此標籤的所有圖片標註。"
                  zh_cn="您已完成此标签的所有图像注释。"
                />
              </p>
              <p>
                <Locale
                  en="Please select another label to continue."
                  zh_hk="請選擇另一個標籤繼續。"
                  zh_cn="请选择另一个标签继续。"
                />
              </p>
            </div>
          </div>
        </div>
        <div style="display: flex; flex-direction: column; gap: 0.5rem;">
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
              id="add-bounding-box-btn"
              onclick="addBoundingBox()"
              title={
                <Locale
                  en="Add Bounding Box"
                  zh_hk="新增標註框"
                  zh_cn="新增标注框"
                />
              }
            >
              <ion-icon name="camera-outline" slot="icon-only"></ion-icon>
            </ion-button>
            <ion-button
              color="danger"
              style="flex: 1;"
              onclick="deleteBoundingBox()"
              id="delete-bounding-box-btn"
              title={
                <Locale
                  en="Delete Selected Box"
                  zh_hk="刪除選中標註框"
                  zh_cn="删除选中标注框"
                />
              }
            >
              <ion-icon name="trash" slot="icon-only"></ion-icon>
            </ion-button>
            <ion-button
              color="success"
              style="flex: 1;"
              onclick="submitBoundingBoxes()"
              title={
                <Locale
                  en="Submit bounding box"
                  zh_hk="提交標註"
                  zh_cn="提交标注"
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

let deleteBoundingBoxParser = object({
  box_id: id(),
  image_id: id(),
  label_id: id(),
})

let getBoundingBoxesParser = object({
  image_id: id(),
  label_id: id(),
})

let updateBoundingBoxParser = object({
  box_id: id(),
  image_id: id(),
  label_id: id(),
  x: number(),
  y: number(),
  width: number(),
  height: number(),
  rotate: number(),
})

let submitBoundingBoxParser = object({
  image_id: id(),
  label_id: id(),
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
    console.log('label_id', label_id)
    console.log(
      `ShowImage: Processing label_id=${label_id}, user_id=${user_id}`,
    )

    // check if label exists and get next unconfirmed image for current user
    let next_image = select_next_unconfirmed_image.get({
      label_id: label_id,
      user_id: user_id,
    })
    console.log(
      `ShowImage: next_image for label_id=${label_id}, user_id=${user_id}:`,
      next_image,
    )

    if (next_image) {
      // Update image attributes and trigger setupEditorUI after load
      context.ws.send([
        'update-attrs',
        '#label_image',
        {
          'src': `/uploads/${next_image.filename}`,
          'data-image-id': next_image.id,
          'data-rotation': next_image.rotation || 0,
          // Keep image element hidden always; canvases handle rendering
          'hidden': true,
        },
      ])

      // Ensure UI elements are visible when we have an image
      context.ws.send([
        'eval',
        `
        console.log('ShowImage: Found image, ensuring UI elements are visible');
        
        // Show canvases
        document.getElementById('minimapCanvas').style.display = 'block';
        document.getElementById('previewCanvas').style.display = 'block';
        
        // Hide the no-image message
        document.getElementById('no-image-message').hidden = true;
        // Don't clear innerHTML to preserve the content for future use
        
        // Clear any edit mode from previous label
        if (typeof window.exitEditMode === 'function') {
          window.exitEditMode();
        }
        
        // Clear selected bounding box from previous label
        window.selectedBoundingBoxId = undefined;
        
        // Clear cached data to force fresh fetch
        window.boundingBoxesData = null;
        
        // Clear bounding box select options
        if (typeof window.updateBoundingBoxSelect === 'function') {
          window.updateBoundingBoxSelect([]);
        }
        `,
      ])

      // NOTE: Do not trigger setupEditorUI here; the <img onLoad> already calls it
      // to avoid double-registration of touch listeners
    } else {
      // No image found - show empty state and clear all UI elements
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

      // Clear all UI states and show empty page
      context.ws.send([
        'eval',
        `
        console.log('ShowImage: No more images for this label, showing empty state');
        
        // Clear any edit mode
        if (typeof window.exitEditMode === 'function') {
          window.exitEditMode();
        }
        
        // Clear selected bounding box
        window.selectedBoundingBoxId = undefined;
        
        // Clear cached data
        window.boundingBoxesData = null;
        
        // Clear bounding box select options
        if (typeof window.updateBoundingBoxSelect === 'function') {
          window.updateBoundingBoxSelect([]);
        }
        
        // Hide canvases
        document.getElementById('minimapCanvas').style.display = 'none';
        document.getElementById('previewCanvas').style.display = 'none';
        
        // Clear debug messages
        document.getElementById('debugMessage').innerHTML = '';
        
        // Show completion message (already rendered in Main function)
        document.getElementById('no-image-message').hidden = false;
        
        // Update delete button state
        if (typeof window.updateDeleteButton === 'function') {
          window.updateDeleteButton();
        }
        `,
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

    // Trigger re-render to show the new bounding box on minimap
    context.ws.send([
      'eval',
      'if (typeof setupEditorUI === "function") setupEditorUI();',
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

function DeleteBoundingBox(attrs: {}, context: WsContext) {
  try {
    let throws = makeThrows(context)
    let user_id = getAuthUserId(context)!
    if (!user_id)
      throws({
        en: 'You must be logged in to delete bounding box',
        zh_hk: '您必須登入才能刪除邊界框',
        zh_cn: '您必须登录才能删除边界框',
      })

    let body = getContextFormBody(context)
    let input = deleteBoundingBoxParser.parse(body)

    console.log('DeleteBoundingBox: Processing input:', input)
    console.log(`DeleteBoundingBox: user_id=${user_id}`)

    // Delete bounding box from database
    let result = delete_bounding_box.run({
      box_id: input.box_id,
      user_id: user_id,
      image_id: input.image_id,
      label_id: input.label_id,
    })

    if (result.changes === 0) {
      throws({
        en: 'Bounding box not found or permission denied',
        zh_hk: '找不到邊界框或權限不足',
        zh_cn: '找不到边界框或权限不足',
      })
    }

    console.log(`DeleteBoundingBox: Deleted ${result.changes} bounding box(es)`)

    // Send success message first
    context.ws.send([
      'update-text',
      '#debugMessage',
      `Bounding box deleted successfully!`,
    ])

    // Clear selected bounding box immediately and refresh the entire UI
    context.ws.send([
      'eval',
      `
      console.log('Server: Clearing selectedBoundingBoxId, was:', window.selectedBoundingBoxId);
      window.selectedBoundingBoxId = undefined; 
      console.log('Server: selectedBoundingBoxId now:', window.selectedBoundingBoxId);
      
      // Exit edit mode since the bounding box is deleted
      if (typeof window.exitEditMode === 'function') {
        console.log('Server: Exiting edit mode after deletion');
        window.exitEditMode();
      }
      
      // Update delete button immediately
      if (typeof window.updateDeleteButton === 'function') {
        window.updateDeleteButton();
      }
      
      // Clear any cached bounding box data to force fresh fetch
      window.boundingBoxesData = null;
      
      // Force complete refresh of bounding boxes by re-running setupEditorUI
      if (typeof setupEditorUI === 'function') {
        console.log('Server: Calling setupEditorUI to refresh bounding boxes');
        setupEditorUI();
      }
      `,
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

// Get bounding boxes for a specific image and label
function GetBoundingBoxes(attrs: {}, context: WsContext) {
  try {
    let throws = makeThrows(context)
    let user_id = getAuthUserId(context)!
    if (!user_id)
      throws({
        en: 'You must be logged in to get bounding boxes',
        zh_hk: '您必須登入才能獲取邊界框',
        zh_cn: '您必须登录才能获取边界框',
      })

    let body = getContextFormBody(context)
    let input = getBoundingBoxesParser.parse(body)

    console.log('GetBoundingBoxes: Processing input:', input)

    // Get bounding boxes from database
    let boxes = get_bounding_boxes.all({
      image_id: input.image_id,
      label_id: input.label_id,
    })

    console.log('GetBoundingBoxes: Found', boxes.length, 'boxes')

    // Send bounding boxes data to client
    context.ws.send([
      'eval',
      `window.boundingBoxesData = ${JSON.stringify(
        boxes.map(box => ({
          image_id: box.image_id,
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
          rotate: box.rotate,
          rotate_angle: box.rotate * 2 * Math.PI,
          id: box.id,
          label_id: box.label_id,
        })),
      )};`,
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

// Update an existing bounding box
function UpdateBoundingBox(attrs: {}, context: WsContext) {
  try {
    let throws = makeThrows(context)
    let user_id = getAuthUserId(context)!
    if (!user_id)
      throws({
        en: 'You must be logged in to update bounding box',
        zh_hk: '您必須登入才能更新邊界框',
        zh_cn: '您必须登录才能更新边界框',
      })

    let body = getContextFormBody(context)
    let input = updateBoundingBoxParser.parse(body)

    console.log('UpdateBoundingBox: Processing input:', input)
    console.log(`UpdateBoundingBox: user_id=${user_id}`)

    // Verify that the label exists
    let label = proxy.label[input.label_id]
    if (!label) {
      throws({
        en: 'Label not found',
        zh_hk: '找不到標籤',
        zh_cn: '找不到标签',
      })
    }

    // Verify that the image exists
    let image = proxy.image[input.image_id]
    if (!image) {
      throws({
        en: 'Image not found',
        zh_hk: '找不到圖片',
        zh_cn: '找不到图片',
      })
    }

    // Update bounding box in database
    let result = update_bounding_box.run({
      box_id: input.box_id,
      user_id: user_id,
      image_id: input.image_id,
      label_id: input.label_id,
      x: input.x,
      y: input.y,
      width: input.width,
      height: input.height,
      rotate: input.rotate,
    })

    if (result.changes === 0) {
      throws({
        en: 'Bounding box not found or permission denied',
        zh_hk: '找不到邊界框或權限不足',
        zh_cn: '找不到边界框或权限不足',
      })
    }

    console.log(`UpdateBoundingBox: Updated ${result.changes} bounding box(es)`)

    // Send success message
    context.ws.send([
      'update-text',
      '#debugMessage',
      `Bounding box updated successfully!`,
    ])

    // Clear cached bounding box data and refresh UI
    context.ws.send([
      'eval',
      `
      console.log('Server: Bounding box updated, refreshing data');
      
      // Clear cached data to force fresh fetch
      window.boundingBoxesData = null;
      
      // Force complete refresh of bounding boxes
      if (typeof setupEditorUI === 'function') {
        console.log('Server: Calling setupEditorUI to refresh bounding boxes');
        setupEditorUI();
      }
      `,
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

// Submit bounding box confirmation and move to next image
function SubmitBoundingBox(attrs: {}, context: WsContext) {
  try {
    let throws = makeThrows(context)
    let user_id = getAuthUserId(context)!
    if (!user_id)
      throws({
        en: 'You must be logged in to submit bounding box',
        zh_hk: '您必須登入才能提交邊界框',
        zh_cn: '您必须登录才能提交边界框',
      })

    let body = getContextFormBody(context)
    let input = submitBoundingBoxParser.parse(body)

    console.log('SubmitBoundingBox: Processing input:', input)
    console.log(`SubmitBoundingBox: user_id=${user_id}`)

    // Check if already confirmed
    let existing_confirmation = check_bounding_box_confirmation.get({
      image_id: input.image_id,
      user_id: user_id,
      label_id: input.label_id,
    })

    if (existing_confirmation) {
      throws({
        en: 'This image has already been confirmed',
        zh_hk: '此圖片已經確認過了',
        zh_cn: '此图片已经确认过了',
      })
    }

    // Insert confirmation record
    let result = submit_bounding_box_confirmation.get({
      image_id: input.image_id,
      user_id: user_id,
      label_id: input.label_id,
    })

    console.log('SubmitBoundingBox: Created confirmation with ID:', result?.id)

    // Calculate updated counts for the current label
    let updated_confirmed = count_confirmed_bounding_box_images.get({
      label_id: input.label_id,
      user_id: user_id,
    })
    let total_images = count_label_images.get({
      label_id: input.label_id,
    })

    // Send success message and update label count
    context.ws.send([
      'eval',
      `
      console.log('Bounding boxes submitted successfully!');
      // Show brief success message
      document.getElementById('debugMessage').textContent = 'Submitted successfully!';
      setTimeout(() => {
        document.getElementById('debugMessage').textContent = '';
      }, 3000);
      
      // Update the label option text with new count
      const labelOption = document.querySelector('ion-select-option[value="${input.label_id}"]');
      if (labelOption) {
        const labelTitle = labelOption.textContent.split(' (')[0]; // Get title without count
        labelOption.textContent = labelTitle + ' (${updated_confirmed}/${total_images})';
        console.log('Updated label count: ${updated_confirmed}/${total_images}');
      }
      `,
    ])

    // Find next unconfirmed image
    let next_image = select_next_unconfirmed_image.get({
      label_id: input.label_id,
      user_id: user_id,
    })

    if (next_image) {
      // Load next image
      context.ws.send([
        'update-attrs',
        '#label_image',
        {
          'src': `/uploads/${next_image.filename}`,
          'data-image-id': next_image.id,
          'data-rotation': next_image.rotation || 0,
        },
      ])

      // Clear cached bounding box data and refresh UI
      context.ws.send([
        'eval',
        `
        console.log('Server: Loading next image after submission');
        
        // Hide the no-image message when we have a next image
        document.getElementById('no-image-message').hidden = true;
        
        // Show canvases for the next image
        document.getElementById('minimapCanvas').style.display = 'block';
        document.getElementById('previewCanvas').style.display = 'block';
        
        // Clear any edit mode
        if (typeof window.exitEditMode === 'function') {
          window.exitEditMode();
        }
        
        // Clear selected bounding box
        window.selectedBoundingBoxId = undefined;
        
        // Clear cached data to force fresh fetch
        window.boundingBoxesData = null;
        
        // Force complete refresh of editor UI
        if (typeof setupEditorUI === 'function') {
          console.log('Server: Calling setupEditorUI for next image');
          setupEditorUI();
        }
        `,
      ])
    } else {
      // No more images to confirm - show empty page
      context.ws.send([
        'eval',
        `
        console.log('All images completed for this label');
        
        // Hide the image
        document.getElementById('label_image').hidden = true;
        document.getElementById('label_image').src = '';
        document.getElementById('label_image').dataset.imageId = '';
        
        // Hide canvases
        document.getElementById('minimapCanvas').style.display = 'none';
        document.getElementById('previewCanvas').style.display = 'none';
        
        // Clear debug messages
        document.getElementById('debugMessage').innerHTML = '';
        
        // Show completion message (already rendered in Main function)
        document.getElementById('no-image-message').hidden = false;
        
        // Clear any selected bounding box
        window.selectedBoundingBoxId = undefined;
        window.boundingBoxesData = null;
        
        // Update delete button state
        if (typeof window.updateDeleteButton === 'function') {
          window.updateDeleteButton();
        }
        `,
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
  '/annotate-bounding-box/deleteBoundingBox': {
    title: <Title t={pageTitle} />,
    description: 'Delete bounding box',
    node: <DeleteBoundingBox />,
  },
  '/annotate-bounding-box/getBoundingBoxes': {
    title: <Title t={pageTitle} />,
    description: 'Get bounding boxes for image and label',
    node: <GetBoundingBoxes />,
  },
  '/annotate-bounding-box/updateBoundingBox': {
    title: <Title t={pageTitle} />,
    description: 'Update bounding box',
    node: <UpdateBoundingBox />,
  },
  '/annotate-bounding-box/submitBoundingBox': {
    title: <Title t={pageTitle} />,
    description: 'Submit bounding box confirmation',
    node: <SubmitBoundingBox />,
  },
} satisfies Routes

export default { routes }
