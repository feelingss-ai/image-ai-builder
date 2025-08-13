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
  console.log('setupDragUI called, current camera:', window.camera)

  let { image, minimap_canvas, preview_canvas } = options
  let mapCanvas = options.minimap_canvas
  let cameraCanvas = options.preview_canvas

  // Always use the global camera object directly
  let camera = window.camera

  // Initialize touch tracking
  let lastTouches: Record<number, Touch> = {}

  // Check if we should reset camera state
  if (options.resetCamera) {
    console.log('setupDragUI: Resetting camera to original state')
    window.camera = {
      x: 0.5,
      y: 0.5,
      width: 1,
      height: 1,
      rotate: 0,
      rotate_angle: 0,
    }
    // Clear selected bounding box when resetting
    window.selectedBoundingBoxId = undefined
    camera = window.camera
    // Clear any cached touch data when resetting
    lastTouches = {}
  } else if (!camera || typeof camera.x === 'undefined') {
    console.log('setupDragUI: Initializing camera object')
    window.camera = {
      x: 0.5,
      y: 0.5,
      width: 1,
      height: 1,
      rotate: 0,
      rotate_angle: 0,
    }
    camera = window.camera
  } else {
    console.log('setupDragUI: Using existing camera object:', camera)
  }

  // Always clear selected bounding box when setting up new drag UI
  // This ensures fresh state when switching images or refreshing data
  console.log('setupDragUI: Clearing selected bounding box for fresh state')
  window.selectedBoundingBoxId = undefined

  // Expose the internal camera object for external access
  // Always point to the current camera object being used
  window._dragUICamera = camera
  minimap_canvas.width = image.naturalWidth
  minimap_canvas.height = image.naturalHeight
  preview_canvas.width = image.naturalWidth
  preview_canvas.height = image.naturalHeight

  let mapContext = mapCanvas.getContext('2d')!
  let cameraContext = cameraCanvas.getContext('2d')!

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

        // check if overflow
        {
          let width = camera.width * image.naturalWidth
          let height = camera.height * image.naturalHeight
          let left = camera.x * image.naturalWidth - width / 2
          let top = camera.y * image.naturalHeight - height / 2
          let right = left + width
          let bottom = top + height

          if (left < 0) {
            camera.x = camera.width / 2
          }
          if (top < 0) {
            camera.y = camera.height / 2
          }

          if (right >= image.naturalWidth) {
            camera.x = 1 - camera.width / 2
          }
          if (bottom >= image.naturalHeight) {
            camera.y = 1 - camera.height / 2
          }
        }
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

        // Allow zooming out even when starting from width/height = 1
        // Only prevent if we're already at max size (2.0)
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

        options.debugMessage.textContent =
          'scale: ' +
          JSON.stringify(
            {
              rotate: camera.rotate,
              rotate_angle: camera.rotate_angle,
              scaleX,
              scaleY,
              x: camera.x,
              y: camera.y,
              currentDx,
              currentDy,
              width: camera.width,
              height: camera.height,
            },
            null,
            2,
          )
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
    mapContext.drawImage(image, 0, 0)
    drawCameraBorder()
    drawBoundingBoxes()
  }

  function renderCamera() {
    let width = camera.width * image.naturalWidth
    let height = camera.height * image.naturalHeight
    let left = camera.x * image.naturalWidth - width / 2
    let top = camera.y * image.naturalHeight - height / 2
    cameraContext.clearRect(0, 0, cameraCanvas.width, cameraCanvas.height)
    cameraContext.save()

    // console.log(cameraCanvas.width, width)

    cameraContext.scale(
      cameraCanvas.width / width,
      cameraCanvas.height / height,
    )
    cameraContext.translate(-left, -top)

    cameraContext.translate(+left + width / 2, +top + height / 2)
    cameraContext.rotate(camera.rotate * 2 * Math.PI)
    cameraContext.translate(-left - width / 2, -top - height / 2)

    cameraContext.drawImage(
      image,
      /* source */
      // left,
      // top,
      // width,
      // height,

      /* destination */
      0,
      0,
      cameraCanvas.width,
      cameraCanvas.height,
    )
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
    const clickX =
      ((event.clientX - rect.left) / rect.width) * minimap_canvas.width
    const clickY =
      ((event.clientY - rect.top) / rect.height) * minimap_canvas.height

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
      return (
        rx >= -boxWidth / 2 - tolerance &&
        rx <= boxWidth / 2 + tolerance &&
        ry >= -boxHeight / 2 - tolerance &&
        ry <= boxHeight / 2 + tolerance
      )
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
        // Update delete button state if function exists
        if (typeof window.updateDeleteButton === 'function') {
          window.updateDeleteButton()
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
