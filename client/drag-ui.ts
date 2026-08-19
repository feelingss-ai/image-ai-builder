export interface BoundingBox {
  image_id?: number
  x: number
  y: number
  width: number
  height: number
  rotate: number
  rotate_angle: number
  id?: number
  label_id?: number
}

declare global {
  interface Window {
    camera: BoundingBox
    _dragUICamera: BoundingBox
    render: () => void
    selectedBoundingBoxId?: number
    updateDeleteButton?: () => void
    boundingBoxesData?: BoundingBox[]
    _canvasMode?: 'fitImage' | 'fitBoundingBox'
    resizeCanvas?: () => void
    resizePreviewToCamera?: () => void
    setCanvasMode?: (mode: 'fitImage' | 'fitBoundingBox') => void
  }
}

// Initialize global camera
window.camera = {
  x: 0.5,
  y: 0.5,
  width: 1,
  height: 1,
  rotate: 0,
  rotate_angle: 0,
}

function setupDragUI(options: {
  // input
  image: HTMLImageElement
  minimap_canvas: HTMLCanvasElement
  preview_canvas: HTMLCanvasElement

  debugMessage: HTMLElement
  debugStartMessage: HTMLElement
  debugMoveMessage: HTMLElement
  debugEndMessage: HTMLElement

  bounding_boxes: BoundingBox[]
  resetCamera?: boolean
}) {
  console.log('setupDragUI called, image:', options.image.src, 'naturalWidth:', options.image.naturalWidth, 'resetCamera:', options.resetCamera)
  console.log('  minimapCanvas id:', options.minimap_canvas.id, 'width:', options.minimap_canvas.width, 'height:', options.minimap_canvas.height, 'offsetW:', options.minimap_canvas.offsetWidth, 'clientW:', options.minimap_canvas.clientWidth)
  console.log('  previewCanvas id:', options.preview_canvas.id, 'width:', options.preview_canvas.width, 'height:', options.preview_canvas.height, 'offsetW:', options.preview_canvas.offsetWidth, 'clientW:', options.preview_canvas.clientWidth)
  console.log('  window._canvasMode:', window._canvasMode, 'window.camera:', JSON.stringify(window.camera))

  // Image-load guard: if the image is not fully loaded yet, defer setup
  // until the load event fires. This prevents 0×0 canvas dimensions and
  // broken render transforms (scale = Infinity) when setupDragUI is called
  // before the browser has decoded the image.
  if (!options.image.complete || !options.image.naturalWidth || !options.image.naturalHeight) {
    console.log('setupDragUI: image not loaded yet, deferring until load event')
    options.image.addEventListener('load', () => setupDragUI(options), { once: true })
    return
  }

  let { image, minimap_canvas, preview_canvas } = options
  let mapCanvas = options.minimap_canvas
  let cameraCanvas = options.preview_canvas

  // Always use the global camera object directly
  let camera = window.camera

  // Clamp camera position so the view never goes outside the image.
  // x must be in [width/2, 1 - width/2], y in [height/2, 1 - height/2].
  function clampCamera() {
    camera.x = Math.max(camera.width / 2, Math.min(1 - camera.width / 2, camera.x))
    camera.y = Math.max(camera.height / 2, Math.min(1 - camera.height / 2, camera.y))
  }

  // Initialize touch tracking
  let lastTouches: Record<number, Touch> = {}

  // Check if we should reset camera state
  if (options.resetCamera) {
    console.log('setupDragUI: Resetting camera to bounding box or full image')
    // Try to set camera to the first bounding box
    const boxes = options.bounding_boxes
    const firstBox = boxes && boxes.length > 0 ? boxes[0] : null
    if (firstBox) {
      window.camera = {
        x: firstBox.x,
        y: firstBox.y,
        width: firstBox.width,
        height: firstBox.height,
        rotate: firstBox.rotate,
        rotate_angle: firstBox.rotate_angle || firstBox.rotate * 2 * Math.PI,
      }
      // Set selected bounding box to the first one
      if (firstBox.id != null) {
        window.selectedBoundingBoxId = firstBox.id
      }
    } else {
      // No bounding boxes: fall back to full image view
      window.camera = {
        x: 0.5,
        y: 0.5,
        width: 1,
        height: 1,
        rotate: 0,
        rotate_angle: 0,
      }
    }
    camera = window.camera
    // Clear any cached touch data when resetting
    lastTouches = {}
  } else if (!camera || typeof camera.x === 'undefined') {
    console.log('setupDragUI: Initializing camera object')
    // Try to set camera to the first bounding box
    const boxes = options.bounding_boxes
    const firstBox = boxes && boxes.length > 0 ? boxes[0] : null
    if (firstBox) {
      window.camera = {
        x: firstBox.x,
        y: firstBox.y,
        width: firstBox.width,
        height: firstBox.height,
        rotate: firstBox.rotate,
        rotate_angle: firstBox.rotate_angle || firstBox.rotate * 2 * Math.PI,
      }
      if (firstBox.id != null) {
        window.selectedBoundingBoxId = firstBox.id
      }
    } else {
      window.camera = {
        x: 0.5,
        y: 0.5,
        width: 1,
        height: 1,
        rotate: 0,
        rotate_angle: 0,
      }
    }
    camera = window.camera
  } else {
    console.log('setupDragUI: Using existing camera object:', camera)
  }

  // Only clear selected bounding box if we didn't set it above
  if (!options.resetCamera && !(camera && camera.width !== 1)) {
    console.log('setupDragUI: Clearing selected bounding box for fresh state')
    window.selectedBoundingBoxId = undefined
  }

  // Expose the internal camera object for external access
  // Always point to the current camera object being used
  window._dragUICamera = camera

  // Default to fit-bounding-box mode unless a mode was already chosen
  if (!window._canvasMode) {
    window._canvasMode = 'fitBoundingBox'
  }

  // Resize canvases based on the current mode.
  // The minimap always keeps the full image size (it is the overview of the
  // whole image). Only the preview canvas changes size:
  //   fitImage:       preview = full image size (CSS scales display)
  //   fitBoundingBox: preview = active bounding box size when locking to a
  //                   box, otherwise the current camera view size so the
  //                   canvas aspect ratio keeps following zoom/pan
  function resizeCanvas(resizeOptions?: { lockToBox?: boolean }) {
    const lockToBox = resizeOptions?.lockToBox ?? true
    const boxes: BoundingBox[] =
      window.boundingBoxesData || options.bounding_boxes
    const selectedId = window.selectedBoundingBoxId
    const activeBox =
      selectedId != null
        ? boxes.find(box => box.id === selectedId)
        : boxes[0]

    // Minimap is always full-size
    minimap_canvas.width = image.naturalWidth
    minimap_canvas.height = image.naturalHeight

    // Preview size depends on the mode
    let previewWidth = image.naturalWidth
    let previewHeight = image.naturalHeight

    // Calculate view dimensions from camera (needed for fitBoundingBox)
    let viewWidth = camera.width * image.naturalWidth
    let viewHeight = camera.height * image.naturalHeight

    console.log('resizeCanvas:', 'mode:', window._canvasMode, 'lockToBox:', lockToBox, 'activeBox:', activeBox ? 'id:' + activeBox.id : null, 'boxes.length:', boxes.length, 'minimap.offsetWidth:', minimap_canvas.offsetWidth, 'minimap.width:', minimap_canvas.width, 'image.naturalWidth:', image.naturalWidth, 'preview.set:', previewWidth, 'x', previewHeight, 'camera:', 'x' + Math.round(camera.x*100) + '%', 'y' + Math.round(camera.y*100) + '%', 'w' + Math.round(camera.width*100) + '%', 'h' + Math.round(camera.height*100) + '%')
    if (window._canvasMode === 'fitBoundingBox') {
      // In fitBoundingBox mode, set the canvas pixel size to match the camera
      // view's aspect ratio, so the image is not distorted. The canvas will be
      // displayed with CSS object-fit:contain inside the preview container,
      // preserving the correct proportions.
      const container = preview_canvas.parentElement
      let containerWidth = 800
      let containerHeight = 600
      if (container) {
        const rect = container.getBoundingClientRect()
        containerWidth = rect.width || 800
        containerHeight = rect.height || 600
      }

      // The camera view defines the aspect ratio we want to display
      const viewAspect = viewWidth / viewHeight
      const containerAspect = containerWidth / containerHeight

      // Set canvas pixel dimensions to match the camera view's aspect ratio,
      // fitting within the container size
      if (viewAspect > containerAspect) {
        // View is wider than container: canvas fills container width
        previewWidth = Math.max(1, Math.round(containerWidth))
        previewHeight = Math.max(1, Math.round(containerWidth / viewAspect))
      } else {
        // View is taller than container: canvas fills container height
        previewHeight = Math.max(1, Math.round(containerHeight))
        previewWidth = Math.max(1, Math.round(containerHeight * viewAspect))
      }
      console.log('  fitBoundingBox: container', containerWidth, 'x', containerHeight, 'viewAspect:', viewAspect.toFixed(3), '-> canvas', previewWidth, 'x', previewHeight)
    }

    preview_canvas.width = previewWidth
    preview_canvas.height = previewHeight

    // In fitBoundingBox mode, lock the camera to the active box so the box
    // fills the preview canvas.
    if (window._canvasMode === 'fitBoundingBox' && lockToBox && activeBox) {
      camera.x = activeBox.x
      camera.y = activeBox.y
      camera.width = activeBox.width
      camera.height = activeBox.height
      camera.rotate = activeBox.rotate
      camera.rotate_angle =
        activeBox.rotate_angle || activeBox.rotate * 2 * Math.PI
    }

    render()
  }

  window.resizeCanvas = resizeCanvas

  // Resize the preview canvas to follow the current camera view. Used when
  // zooming in fitBoundingBox mode so the canvas keeps matching the camera
  // view's aspect ratio instead of staying locked to the box size.
  function resizePreviewToCamera() {
    resizeCanvas({ lockToBox: false })
  }

  window.resizePreviewToCamera = resizePreviewToCamera

  // Switch between fitImage and fitBoundingBox modes
  function setCanvasMode(mode: 'fitImage' | 'fitBoundingBox') {
    window._canvasMode = mode
    // When switching to fitBoundingBox, lock camera to the active box first
    // so that resizeCanvas can calculate the correct canvas dimensions based
    // on the box's aspect ratio (not the stale full-image camera values).
    if (mode === 'fitBoundingBox') {
      const boxes: BoundingBox[] =
        window.boundingBoxesData || options.bounding_boxes
      const selectedId = window.selectedBoundingBoxId
      const activeBox =
        selectedId != null
          ? boxes.find(box => box.id === selectedId)
          : boxes[0]
      if (activeBox) {
        camera.x = activeBox.x
        camera.y = activeBox.y
        camera.width = activeBox.width
        camera.height = activeBox.height
        camera.rotate = activeBox.rotate
        camera.rotate_angle =
          activeBox.rotate_angle || activeBox.rotate * 2 * Math.PI
      }
    }
    resizeCanvas()
  }

  window.setCanvasMode = setCanvasMode

  let mapContext = mapCanvas.getContext('2d')!
  let cameraContext = cameraCanvas.getContext('2d')!

  resizeCanvas()
  render()

  function formatTouches(touches: TouchList) {
    return Array.from(touches, touch => {
      return {
        id: touch.identifier,
        x: touch.clientX,
        y: touch.clientY,
      }
    })
  }

  // Avoid attaching duplicate listeners if setupDragUI is called multiple times
  if ((cameraCanvas as any)._dragUiListenersAttached) {
    console.log('setupDragUI: listeners already attached for preview canvas')
  } else {
    ;(cameraCanvas as any)._dragUiListenersAttached = true

    cameraCanvas.addEventListener('touchstart', event => {
      event.preventDefault()
      let touchCount = event.touches.length
      // debugStartMessage.textContent =
      //   'touchstart: ' + JSON.stringify(formatTouches(event.touches), null, 2)
      for (let touch of Array.from(event.touches)) {
        lastTouches[touch.identifier] = touch
      }
    })

    cameraCanvas.addEventListener('touchmove', event => {
      // debugMoveMessage.textContent =
      //   'touchmove: ' + JSON.stringify(formatTouches(event.touches), null, 2)
      let rect = cameraCanvas.getBoundingClientRect()
      let touchCount = event.touches.length

      // detect pan (translation)
      for (let touch of Array.from(event.touches)) {
        let currentX = touch.clientX
        let currentY = touch.clientY
        let deltaX = currentX - lastTouches[touch.identifier].clientX
        let deltaY = currentY - lastTouches[touch.identifier].clientY

        let rotatedDeltaX =
          deltaX * Math.cos(camera.rotate * 2 * Math.PI) +
          deltaY * Math.sin(camera.rotate * 2 * Math.PI)
        let rotatedDeltaY =
          -deltaX * Math.sin(camera.rotate * 2 * Math.PI) +
          deltaY * Math.cos(camera.rotate * 2 * Math.PI)

        camera.x -= ((rotatedDeltaX / rect.width) * camera.width) / touchCount
        camera.y -= ((rotatedDeltaY / rect.height) * camera.height) / touchCount

        clampCamera()
      }
      // Debug: Log camera updates during pan (once per touchmove)
      console.log('Camera pan updated:', {
        x: camera.x,
        y: camera.y,
        width: camera.width,
        height: camera.height,
        rotate: camera.rotate,
      })

      // detect pinch (scale)
      if (touchCount == 2) {
        let currentTouch1 = event.touches[0]
        let currentTouch2 = event.touches[1]

        let lastTouch1 = lastTouches[currentTouch1.identifier]
        let lastTouch2 = lastTouches[currentTouch2.identifier]

        let lastDx = lastTouch1.clientX - lastTouch2.clientX
        let lastDy = lastTouch1.clientY - lastTouch2.clientY
        let currentDx = currentTouch1.clientX - currentTouch2.clientX
        let currentDy = currentTouch1.clientY - currentTouch2.clientY

        let distanceX = Math.abs(currentDx)
        let distanceY = Math.abs(currentDy)
        // let ratio = Math.max(distanceX / distanceY, distanceY / distanceX)

        let scaleX = Math.abs(currentDx) / Math.abs(lastDx)
        let scaleY = Math.abs(currentDy) / Math.abs(lastDy)

        if (distanceX / distanceY > 2) {
          scaleY = 1
        } else if (distanceY / distanceX > 2) {
          scaleX = 1
        }

        let newWidth = camera.width / scaleX
        let newHeight = camera.height / scaleY

        // Prevent zooming out beyond the full image (image must always fill canvas)
        if (newWidth > 1) newWidth = 1
        if (newHeight > 1) newHeight = 1

        let width = newWidth * image.naturalWidth
        let height = newHeight * image.naturalHeight
        if (width < 1) {
          width = 1
          newWidth = 1 / image.naturalWidth
        }
        if (height < 1) {
          height = 1
          newHeight = 1 / image.naturalHeight
        }

        let centerX = camera.x * image.naturalWidth
        let centerY = camera.y * image.naturalHeight

        let left = centerX - width / 2
        let top = centerY - height / 2
        let right = left + width
        let bottom = top + height

        // Allow zooming in (viewport smaller = more magnified)
        // Max zoom is 2.0x (viewport = 50% of image)
        let maxSize = 2.0
        if (newWidth <= maxSize) {
          if (left >= 0 && right <= image.naturalWidth) {
            camera.width = newWidth
          } else if (newWidth <= 1) {
            camera.width = newWidth
            camera.x -= (newWidth - camera.width) / 2
          }
        }

        if (newHeight <= maxSize) {
          if (top >= 0 && bottom <= image.naturalHeight) {
            camera.height = newHeight
          } else if (newHeight <= 1) {
            camera.height = newHeight
            camera.y -= (newHeight - camera.height) / 2
          }
        }

        // Clamp camera position so image always fills the canvas
        clampCamera()

        // Debug: Log camera updates during scale
        console.log('Camera scale updated:', {
          x: camera.x,
          y: camera.y,
          width: camera.width,
          height: camera.height,
          rotate: camera.rotate,
        })

        // Detect the rotation
        // let currentCenterX = (currentTouch1.clientX + currentTouch2.clientX) / 2
        // let currentCenterY = (currentTouch1.clientY + currentTouch2.clientY) / 2
        // let lastCenterX = (lastTouch1.clientX + lastTouch2.clientX) / 2
        // let lastCenterY = (lastTouch1.clientY + lastTouch2.clientY) / 2

        let current_rotate_angle = Math.atan2(
          currentTouch2.clientY - currentTouch1.clientY,
          currentTouch2.clientX - currentTouch1.clientX,
        )
        let last_rotate_angle = Math.atan2(
          lastTouch2.clientY - lastTouch1.clientY,
          lastTouch2.clientX - lastTouch1.clientX,
        )

        let rotate_angle = current_rotate_angle - last_rotate_angle
        // Normalize angle to [-π, π] range
        while (rotate_angle > Math.PI) {
          rotate_angle -= 2 * Math.PI
        }
        while (rotate_angle < -Math.PI) {
          rotate_angle += 2 * Math.PI
        }
        camera.rotate_angle += rotate_angle
        camera.rotate += rotate_angle / (2 * Math.PI)

        // Debug: Log camera updates in real-time
        console.log('Camera updated:', {
          x: camera.x,
          y: camera.y,
          width: camera.width,
          height: camera.height,
          rotate: camera.rotate,
          rotate_angle: camera.rotate_angle,
        })
      }

      // update last touches
      for (let touch of Array.from(event.touches)) {
        lastTouches[touch.identifier] = touch
      }

      render()
    })

    cameraCanvas.addEventListener('touchend', event => {
      // debugEndMessage.textContent =
      //   'touchend: ' + JSON.stringify(formatTouches(event.touches), null, 2)
      let existingTouches = Array.from(event.touches, touch => touch.identifier)
      for (let touch of Object.values(lastTouches)) {
        if (!existingTouches.includes(touch.identifier)) {
          delete lastTouches[touch.identifier]
        }
      }
    })

    // Mouse drag support: pan like touch drag (left-click only, no zoom)
    let isMouseDown = false
    let lastMouseX = 0
    let lastMouseY = 0

    cameraCanvas.addEventListener('mousedown', event => {
      if (event.button !== 0) return // only left click
      isMouseDown = true
      lastMouseX = event.clientX
      lastMouseY = event.clientY
    })

    cameraCanvas.addEventListener('mousemove', event => {
      if (!isMouseDown) return
      let rect = cameraCanvas.getBoundingClientRect()
      let deltaX = event.clientX - lastMouseX
      let deltaY = event.clientY - lastMouseY

      let rotatedDeltaX =
        deltaX * Math.cos(camera.rotate * 2 * Math.PI) +
        deltaY * Math.sin(camera.rotate * 2 * Math.PI)
      let rotatedDeltaY =
        -deltaX * Math.sin(camera.rotate * 2 * Math.PI) +
        deltaY * Math.cos(camera.rotate * 2 * Math.PI)

      camera.x -= ((rotatedDeltaX / rect.width) * camera.width)
      camera.y -= ((rotatedDeltaY / rect.height) * camera.height)

      clampCamera()

      lastMouseX = event.clientX
      lastMouseY = event.clientY
      render()
    })

    cameraCanvas.addEventListener('mouseup', () => { isMouseDown = false })
    cameraCanvas.addEventListener('mouseleave', () => { isMouseDown = false })
  }

  cameraContext.setTransform()
  function pan() {}

  function pinch() {}

  function rotate() {}

  function render() {
    renderMap()
    renderCamera()
  }

  // Expose render function globally for external access
  window.render = render

  function renderMap() {
    // Skip rendering if the image is not loaded yet
    if (!image.complete || !image.naturalWidth) return
    mapContext.drawImage(image, 0, 0)
    drawCameraBorder()
    drawBoundingBoxes()
  }

  function renderCamera() {
    // Skip rendering if the image is not loaded yet (prevents 0×0 view
    // dimensions and Infinity scale values that break the transform)
    if (!image.complete || !image.naturalWidth) return
    let viewWidth = camera.width * image.naturalWidth
    let viewHeight = camera.height * image.naturalHeight
    let viewLeft = camera.x * image.naturalWidth - viewWidth / 2
    let viewTop = camera.y * image.naturalHeight - viewHeight / 2
    cameraContext.clearRect(0, 0, cameraCanvas.width, cameraCanvas.height)
    cameraContext.save()

    if (window._canvasMode === 'fitBoundingBox') {
      // In fitBoundingBox mode, the canvas pixel size matches the camera view's
      // aspect ratio. We draw the full image with transforms so the camera view
      // region fills the canvas at correct proportions (no distortion).
      // CSS object-fit:contain ensures the canvas is displayed without stretching.

      // Scale factors: how many canvas pixels per image pixel
      let scaleX = cameraCanvas.width / viewWidth
      let scaleY = cameraCanvas.height / viewHeight

      // Clip to canvas bounds so overflow is not visible
      cameraContext.beginPath()
      cameraContext.rect(0, 0, cameraCanvas.width, cameraCanvas.height)
      cameraContext.clip()

      // Step 1: Move origin to canvas center
      cameraContext.translate(cameraCanvas.width / 2, cameraCanvas.height / 2)

      // Step 2: Apply rotation around canvas center
      cameraContext.rotate(camera.rotate * 2 * Math.PI)

      // Step 3: Scale so camera view fills canvas exactly
      // Since canvas aspect ratio matches the view, scaleX ≈ scaleY
      // Use Math.min for "contain" mode (no distortion, no cropping)
      let scale = Math.min(scaleX, scaleY)
      cameraContext.scale(scale, scale)

      // Step 4: Translate so camera center (camera.x, camera.y) maps to origin
      cameraContext.translate(-camera.x * image.naturalWidth, -camera.y * image.naturalHeight)

      // Step 5: Draw the full image
      cameraContext.drawImage(image, 0, 0)

      console.log('renderCamera BOUNDING BOX: canvas:', cameraCanvas.width, 'x', cameraCanvas.height, 'view:', viewWidth, 'x', viewHeight, '@', viewLeft, ',', viewTop, 'scale:', scale, 'camera:', camera.x, camera.y, camera.width, camera.height)
    } else {
      // Full image mode: stretch the view to fill the entire canvas
      // (scaleX = canvasWidth/viewWidth, scaleY = canvasHeight/viewHeight).
      // This way zooming in magnifies the content as expected.
      cameraContext.scale(
        cameraCanvas.width / viewWidth,
        cameraCanvas.height / viewHeight,
      )
      cameraContext.translate(-viewLeft, -viewTop)

      cameraContext.translate(+viewLeft + viewWidth / 2, +viewTop + viewHeight / 2)
      cameraContext.rotate(camera.rotate * 2 * Math.PI)
      cameraContext.translate(-viewLeft - viewWidth / 2, -viewTop - viewHeight / 2)

      // 5-argument drawImage: full image is drawn, scaled to fill the canvas
      cameraContext.drawImage(
        image,
        0,
        0,
        cameraCanvas.width,
        cameraCanvas.height,
      )
      console.log('renderCamera FULL IMAGE: canvas:', cameraCanvas.width, 'x', cameraCanvas.height, 'view:', viewWidth, 'x', viewHeight, '@', viewLeft, ',', viewTop, 'scaleX:', cameraCanvas.width / viewWidth, 'scaleY:', cameraCanvas.height / viewHeight)
    }
    cameraContext.restore()
  }

  function drawCameraBorder() {
    let lineWidth = Math.max(mapCanvas.width, mapCanvas.height) * 0.01
    mapContext.strokeStyle = '#0000ff'
    mapContext.lineWidth = lineWidth
    let width = camera.width * mapCanvas.width
    let height = camera.height * mapCanvas.height
    let left = camera.x * mapCanvas.width - width / 2
    let top = camera.y * mapCanvas.height - height / 2

    mapContext.save()
    mapContext.translate(left + width / 2, top + height / 2)
    mapContext.rotate(-camera.rotate * 2 * Math.PI)
    mapContext.strokeRect(-width / 2, -height / 2, width, height)
    // mapContext.strokeRect(left, top, width, height)

    mapContext.restore()
  }

  function drawBoundingBoxes() {
    // Use the most current bounding box data from window.boundingBoxesData if available
    const currentBoundingBoxes: BoundingBox[] =
      window.boundingBoxesData || options.bounding_boxes
    if (!currentBoundingBoxes || currentBoundingBoxes.length === 0) {
      return
    }

    const selectedId = window.selectedBoundingBoxId

    currentBoundingBoxes.forEach((box: BoundingBox, index: number) => {
      // Calculate box position and size on minimap
      let boxWidth = box.width * mapCanvas.width
      let boxHeight = box.height * mapCanvas.height
      let boxLeft = box.x * mapCanvas.width - boxWidth / 2
      let boxTop = box.y * mapCanvas.height - boxHeight / 2

      mapContext.save()

      // Transform to box position and rotation
      mapContext.translate(boxLeft + boxWidth / 2, boxTop + boxHeight / 2)
      mapContext.rotate(-box.rotate * 2 * Math.PI)

      // Default: all boxes are gray until one is clicked
      const isSelected = selectedId != null && box.id === selectedId
      mapContext.lineWidth = Math.max(mapCanvas.width, mapCanvas.height) * 0.008

      if (isSelected) {
        // Rainbow stroke for selected
        let gradient = mapContext.createLinearGradient(
          -boxWidth / 2,
          -boxHeight / 2, // Start at top-left
          boxWidth / 2,
          boxHeight / 2, // End at bottom-right
        )
        gradient.addColorStop(0, '#ff0000') // Red
        gradient.addColorStop(0.17, '#ff8000') // Orange
        gradient.addColorStop(0.33, '#ffff00') // Yellow
        gradient.addColorStop(0.5, '#00ff00') // Green
        gradient.addColorStop(0.67, '#0080ff') // Blue
        gradient.addColorStop(0.83, '#8000ff') // Indigo
        gradient.addColorStop(1, '#ff0080') // Violet
        mapContext.strokeStyle = gradient
        mapContext.strokeRect(
          -boxWidth / 2,
          -boxHeight / 2,
          boxWidth,
          boxHeight,
        )

        if (box.id) {
          mapContext.fillStyle = '#ffffff'
          mapContext.font = `${Math.max(12, mapCanvas.width * 0.02)}px Arial`
          mapContext.textAlign = 'center'
          mapContext.textBaseline = 'middle'
          mapContext.fillText(box.id.toString(), 0, 0)
        }
      } else {
        // Non-selected: gray semi-transparent
        mapContext.fillStyle = 'rgba(128,128,128,0.3)'
        mapContext.strokeStyle = 'rgba(128,128,128,0.8)'
        mapContext.fillRect(-boxWidth / 2, -boxHeight / 2, boxWidth, boxHeight)
        mapContext.strokeRect(
          -boxWidth / 2,
          -boxHeight / 2,
          boxWidth,
          boxHeight,
        )
        if (box.id) {
          mapContext.fillStyle = 'rgba(255,255,255,0.8)'
          mapContext.font = `${Math.max(12, mapCanvas.width * 0.03)}px Arial`
          mapContext.textAlign = 'center'
          mapContext.textBaseline = 'middle'
          mapContext.fillText(box.id.toString(), 0, 0)
        }
      }

      mapContext.restore()
    })
  }

  // Added: minimapCanvas click to jump to bounding box
  minimap_canvas.addEventListener('click', function (event) {
    const rect = minimap_canvas.getBoundingClientRect()

    // Calculate click position relative to displayed canvas
    const displayClickX = event.clientX - rect.left
    const displayClickY = event.clientY - rect.top

    // Get the actual image dimensions
    const imageNaturalWidth = image.naturalWidth
    const imageNaturalHeight = image.naturalHeight
    const imageAspectRatio = imageNaturalWidth / imageNaturalHeight

    // Calculate the displayed canvas size
    const displayWidth = rect.width
    const displayHeight = rect.height
    const displayAspectRatio = displayWidth / displayHeight

    // Calculate the actual displayed image area within the canvas
    // The image is scaled to fit within the canvas while maintaining aspect ratio
    let actualImageWidth, actualImageHeight, imageOffsetX, imageOffsetY

    if (imageAspectRatio > displayAspectRatio) {
      // Image is wider relative to display, so width fills display and height is centered
      actualImageWidth = displayWidth
      actualImageHeight = displayWidth / imageAspectRatio
      imageOffsetX = 0
      imageOffsetY = (displayHeight - actualImageHeight) / 2
    } else {
      // Image is taller relative to display, so height fills display and width is centered
      actualImageHeight = displayHeight
      actualImageWidth = displayHeight * imageAspectRatio
      imageOffsetX = (displayWidth - actualImageWidth) / 2
      imageOffsetY = 0
    }

    console.log('Image area calculation:', {
      imageNatural: {
        width: imageNaturalWidth,
        height: imageNaturalHeight,
        aspectRatio: imageAspectRatio,
      },
      display: {
        width: displayWidth,
        height: displayHeight,
        aspectRatio: displayAspectRatio,
      },
      actualImage: { width: actualImageWidth, height: actualImageHeight },
      offset: { x: imageOffsetX, y: imageOffsetY },
    })

    // Check if click is within the actual image area (with small tolerance for floating point precision)
    const boundaryTolerance = 2 // 2 pixel tolerance for boundary detection
    if (
      displayClickX < imageOffsetX - boundaryTolerance ||
      displayClickX > imageOffsetX + actualImageWidth + boundaryTolerance ||
      displayClickY < imageOffsetY - boundaryTolerance ||
      displayClickY > imageOffsetY + actualImageHeight + boundaryTolerance
    ) {
      console.log('Click outside image area, ignoring', {
        // clickPos: { x: displayClickX, y: displayClickY },
        // imageArea: {
        //   left: imageOffsetX,
        //   right: imageOffsetX + actualImageWidth,
        //   top: imageOffsetY,
        //   bottom: imageOffsetY + actualImageHeight,
        // },
        // boundaryTolerance,
      })
      return
    }

    // Convert from display coordinates to actual canvas coordinates
    const clickX =
      ((displayClickX - imageOffsetX) / actualImageWidth) * minimap_canvas.width
    const clickY =
      ((displayClickY - imageOffsetY) / actualImageHeight) *
      minimap_canvas.height

    console.log('Minimap click:', {
      displayClick: { x: displayClickX, y: displayClickY },
      imageDisplay: {
        width: actualImageWidth,
        height: actualImageHeight,
        offsetX: imageOffsetX,
        offsetY: imageOffsetY,
      },
      canvasClick: { x: clickX, y: clickY },
      canvasSize: {
        width: minimap_canvas.width,
        height: minimap_canvas.height,
      },
      displaySize: { width: rect.width, height: rect.height },
    })

    const { image_id: currentImageId, label_id: currentLabelId } =
      getCurrentImageAndLabelIds()

    // Reverse rotation to determine if the point is inside the box
    function isPointInBox(box: BoundingBox, x: number, y: number) {
      // Translate to the center of the box first
      let boxWidth = box.width * minimap_canvas.width
      let boxHeight = box.height * minimap_canvas.height
      let boxCenterX = box.x * minimap_canvas.width
      let boxCenterY = box.y * minimap_canvas.height

      // Reverse rotation
      let dx = x - boxCenterX
      let dy = y - boxCenterY
      let angle = box.rotate * 2 * Math.PI
      let rx = dx * Math.cos(angle) + dy * Math.sin(angle)
      let ry = -dx * Math.sin(angle) + dy * Math.cos(angle)

      // Add tolerance so clicks near the border still count
      const tolerance = Math.max(
        2,
        Math.max(minimap_canvas.width, minimap_canvas.height) * 0.005,
      )

      // Determine if the point is within the box boundaries (with tolerance)
      const isInside =
        rx >= -boxWidth / 2 - tolerance &&
        rx <= boxWidth / 2 + tolerance &&
        ry >= -boxHeight / 2 - tolerance &&
        ry <= boxHeight / 2 + tolerance

      return isInside
    }

    // Check all bounding boxes and ensure same image/label.
    // Be tolerant of boxes missing image_id/label_id (treat missing as matching).
    // Use the most current bounding box data from window.boundingBoxesData if available
    const currentBoundingBoxes: BoundingBox[] =
      window.boundingBoxesData || options.bounding_boxes
    console.log(
      'Looking for clicked box. Available boxes:',
      currentBoundingBoxes.map((b: BoundingBox) => ({
        id: b.id,
        x: b.x,
        y: b.y,
        width: b.width,
        height: b.height,
      })),
    )
    console.log('Click coordinates:', { clickX, clickY })
    console.log('Current IDs:', { currentImageId, currentLabelId })

    let foundBox = currentBoundingBoxes.find((box: BoundingBox) => {
      const hit = isPointInBox(box, clickX, clickY)
      const labelMatches =
        box.label_id == null ||
        currentLabelId == null ||
        box.label_id === currentLabelId
      const imageMatches =
        box.image_id == null ||
        currentImageId == null ||
        box.image_id === currentImageId
      console.log(
        `Box ${box.id}: hit=${hit}, labelMatches=${labelMatches}, imageMatches=${imageMatches}`,
      )
      return hit && labelMatches && imageMatches
    })

    console.log('Found box:', foundBox)

    if (foundBox) {
      // Jump to the bounding box
      camera.x = foundBox.x
      camera.y = foundBox.y
      camera.width = foundBox.width
      camera.height = foundBox.height
      camera.rotate = foundBox.rotate
      camera.rotate_angle =
        foundBox.rotate_angle || foundBox.rotate * 2 * Math.PI

      // Set selected bounding box id (if available)
      if (foundBox.id != null) {
        window.selectedBoundingBoxId = foundBox.id
        console.log(
          'Set selectedBoundingBoxId to:',
          window.selectedBoundingBoxId,
        )

        // In fitBoundingBox mode, resize canvas to the newly selected box
        if (window._canvasMode === 'fitBoundingBox') {
          resizeCanvas()
        }

        // Update delete button state if function exists
        if (typeof window.updateDeleteButton === 'function') {
          window.updateDeleteButton()
        }

        // Check if enterEditMode function exists and call it to enter edit mode
        if (typeof (window as any).enterEditMode === 'function') {
          console.log(
            'Minimap click: Entering edit mode for box ID:',
            foundBox.id,
          )
          ;(window as any).enterEditMode(foundBox)
        }
      } else {
        console.warn('Found box has no id:', foundBox)
      }
      render()
    } else {
      console.log('No box found at click position')
    }
  })

  // Added: guard to ensure clicked bounding box matches current image/label before jumping
  function getCurrentImageAndLabelIds() {
    const img = document.getElementById(
      'label_image',
    ) as HTMLImageElement | null
    const image_id = img?.dataset?.imageId
      ? parseInt(img.dataset.imageId)
      : undefined
    const select = document.getElementById(
      'label_select',
    ) as HTMLSelectElement | null
    const label_id = select?.value ? parseInt(select.value) : undefined
    return { image_id, label_id }
  }
}

// Camera is already accessible globally via window.camera

// Function to get current camera state
function getCurrentCamera() {
  return window.camera
}

Object.assign(window, { setupDragUI, getCurrentCamera })
