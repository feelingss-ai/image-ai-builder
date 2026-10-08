// Keypoint editor client plugin for the annotate-keypoint page.
//
// Simplified variant of client/drag-ui.ts focused on keypoint annotation:
// - no minimap: the preview canvas is the only canvas
// - camera model identical to drag-ui (x/y/width/height/rotate in
//   normalized [0,1] units, center-based) so the "zoom to bounding box"
//   behavior matches the annotate-bounding-box page
// - renders the active bounding box + skeleton edges + keypoints
// - click = place/move the selected keypoint, drag on empty space = pan,
//   wheel / pinch = zoom
//
// The image-load guard below is critical: setupKeypointEditor may be called
// before the browser has decoded the image, which would produce 0x0 canvas
// dimensions and scale = Infinity (blank canvas). See repo memory
// "image display bug in annotate-bounding-box.tsx".

export interface Keypoint {
  idx: number
  x: number
  y: number
  visibility: number
}

export interface KeypointBox {
  id: number
  x: number
  y: number
  width: number
  height: number
  rotate: number
}

declare global {
  interface Window {
    // NOTE: `camera` and `render` are declared by client/drag-ui.ts (global
    // interface merging) — redeclaring them here would conflict, so only the
    // keypoint-specific globals are added below.
    _keypointEditorCamera?: {
      x: number
      y: number
      width: number
      height: number
      rotate: number
      rotate_angle: number
    }
    resizeKeypointCanvas?: () => void
    resizeKeypointPreviewToCamera?: () => void
    setKeypointCameraToBox?: (box: KeypointBox) => void
    keypointBoxesData?: KeypointBox[]
    keypointData?: Keypoint[]
    selectedKeypointIdx?: number
    keypointTemplate?: { names: string[]; edges: number[][] }
    /** id of the bounding box currently being annotated */
    _keypointActiveBoxId?: number | null
    /** global overlay opacity for keypoints/edges/labels: 1 = full, 0.5 = half, 0 = hidden */
    keypointOverlayOpacity?: number
  }
}

// Initialize global camera (full image view)
window.camera = {
  x: 0.5,
  y: 0.5,
  width: 1,
  height: 1,
  rotate: 0,
  rotate_angle: 0,
}

// Global overlay opacity for keypoints/edges/labels (1 = full, 0.5 = half,
// 0 = hidden). Cycled by the opacity button on the annotate-keypoint page.
window.keypointOverlayOpacity = 1

function setupKeypointEditor(options: {
  image: HTMLImageElement
  canvas: HTMLCanvasElement
  resetCamera?: boolean
}) {
  console.log(
    'setupKeypointEditor called, image:',
    options.image.src,
    'naturalWidth:',
    options.image.naturalWidth,
  )

  // Image-load guard: defer setup until the load event fires. Prevents
  // 0x0 canvas dimensions and broken render transforms (scale = Infinity).
  if (
    !options.image.complete ||
    !options.image.naturalWidth ||
    !options.image.naturalHeight
  ) {
    console.log('setupKeypointEditor: image not loaded yet, deferring')
    options.image.addEventListener(
      'load',
      () => setupKeypointEditor(options),
      { once: true },
    )
    return
  }

  let { image, canvas } = options

  // Always use the global camera object directly (same identity trick as
  // drag-ui: event listeners capture this object in their closure, so
  // external code must mutate it in place via Object.assign, not replace it)
  let camera = window.camera

  if (!camera || typeof camera.x === 'undefined') {
    window.camera = {
      x: 0.5,
      y: 0.5,
      width: 1,
      height: 1,
      rotate: 0,
      rotate_angle: 0,
    }
    camera = window.camera
  }

  // Clamp camera position so the view never goes outside the image.
  function clampCamera() {
    camera.x = Math.max(
      camera.width / 2,
      Math.min(1 - camera.width / 2, camera.x),
    )
    camera.y = Math.max(
      camera.height / 2,
      Math.min(1 - camera.height / 2, camera.y),
    )
  }

  // Use the fitted image area, not the full CSS canvas rectangle. This keeps
  // one mouse/touch pixel of movement mapped to the same visible pan distance
  // on portrait, landscape, and letterboxed images.
  function getPanContentSize(rect: DOMRect) {
    if (
      getComputedStyle(canvas).objectFit !== 'contain' ||
      !canvas.width ||
      !canvas.height
    ) {
      return { width: rect.width, height: rect.height }
    }
    let scale = Math.min(rect.width / canvas.width, rect.height / canvas.height)
    return {
      width: Math.max(1, canvas.width * scale),
      height: Math.max(1, canvas.height * scale),
    }
  }

  // Initialize touch tracking
  let lastTouches: Record<number, Touch> = {}

  // Resize the canvas pixel size to match the camera view's aspect ratio,
  // fitting within the container size (same logic as drag-ui fitBoundingBox).
  function resizeCanvas() {
    let viewWidth = camera.width * image.naturalWidth
    let viewHeight = camera.height * image.naturalHeight

    const container = canvas.parentElement
    let containerWidth = 800
    let containerHeight = 600
    if (container) {
      const rect = container.getBoundingClientRect()
      containerWidth = rect.width || 800
      containerHeight = rect.height || 600
    }

    const viewAspect = viewWidth / viewHeight
    const containerAspect = containerWidth / containerHeight

    let canvasWidth: number
    let canvasHeight: number
    if (viewAspect > containerAspect) {
      canvasWidth = Math.max(1, Math.round(containerWidth))
      canvasHeight = Math.max(1, Math.round(containerWidth / viewAspect))
    } else {
      canvasHeight = Math.max(1, Math.round(containerHeight))
      canvasWidth = Math.max(1, Math.round(containerHeight * viewAspect))
    }

    canvas.width = canvasWidth
    canvas.height = canvasHeight

    render()
  }

  window.resizeKeypointCanvas = resizeCanvas

  // Recompute the canvas size from the current camera (after zoom/pan)
  function resizePreviewToCamera() {
    clampCamera()
    resizeCanvas()
  }

  window.resizeKeypointPreviewToCamera = resizePreviewToCamera

  // Move the camera to frame a bounding box (with a little margin so the
  // box edges stay visible)
  function setCameraToBox(box: KeypointBox) {
    camera.x = box.x
    camera.y = box.y
    camera.width = box.width
    camera.height = box.height
    camera.rotate = box.rotate
    camera.rotate_angle = box.rotate * 2 * Math.PI
    resizeCanvas()
  }

  window.setKeypointCameraToBox = setCameraToBox

  let context = canvas.getContext('2d')!

  resizeCanvas()
  render()

  // Expose the internal camera object for external access
  window._keypointEditorCamera = camera

  function render() {
    // Skip rendering if the image is not loaded yet (prevents 0x0 view
    // dimensions and Infinity scale values that break the transform)
    if (!image.complete || !image.naturalWidth) return
    let viewWidth = camera.width * image.naturalWidth
    let viewHeight = camera.height * image.naturalHeight

    context.clearRect(0, 0, canvas.width, canvas.height)
    context.save()

    // Scale factors: how many canvas pixels per image pixel
    let scaleX = canvas.width / viewWidth
    let scaleY = canvas.height / viewHeight

    // Clip to canvas bounds so overflow is not visible
    context.beginPath()
    context.rect(0, 0, canvas.width, canvas.height)
    context.clip()

    // Move origin to canvas center
    context.translate(canvas.width / 2, canvas.height / 2)

    // Apply rotation around canvas center
    context.rotate(camera.rotate * 2 * Math.PI)

    // Scale so camera view fills canvas exactly (contain, no distortion)
    let scale = Math.min(scaleX, scaleY)
    context.scale(scale, scale)

    // Translate so camera center maps to origin
    context.translate(
      -camera.x * image.naturalWidth,
      -camera.y * image.naturalHeight,
    )

    // Draw the full image
    context.drawImage(image, 0, 0)

    // Draw the active bounding box + keypoints on top
    drawBoxAndKeypoints()

    context.restore()
  }

  window.render = render

  // Rainbow linear gradient (top-left -> bottom-right) spanning a single
  // circle of the given radius, centred at (cx, cy). Each keypoint gets its
  // own gradient so every dot is individually rainbow-coloured (not one
  // gradient spread across the whole image).
  function createRainbowGradient(
    cx: number,
    cy: number,
    radius: number,
  ): CanvasGradient {
    let gradient = context.createLinearGradient(
      cx - radius,
      cy - radius,
      cx + radius,
      cy + radius,
    )
    gradient.addColorStop(0, '#ff0000') // Red
    gradient.addColorStop(0.17, '#ff8000') // Orange
    gradient.addColorStop(0.33, '#ffff00') // Yellow
    gradient.addColorStop(0.5, '#00ff00') // Green
    gradient.addColorStop(0.67, '#0080ff') // Blue
    gradient.addColorStop(0.83, '#8000ff') // Indigo
    gradient.addColorStop(1, '#ff0080') // Violet
    return gradient
  }

  function drawBoxAndKeypoints() {
    let boxes = window.keypointBoxesData || []
    let keypoints = window.keypointData || []
    let template = window.keypointTemplate
    let selectedIdx = window.selectedKeypointIdx
    // global overlay opacity: 1 = full, 0.5 = half, 0 = hidden. The bounding
    // box outline stays visible so the user never loses the anchor; only the
    // keypoints/edges/labels fade.
    let overlayAlpha =
      window.keypointOverlayOpacity == null ? 1 : window.keypointOverlayOpacity

    // Draw all boxes: the active one highlighted, others dimmed
    let activeId = activeBoxId()
    for (let box of boxes) {
      let isActive = box.id === activeId
      drawBox(box, isActive)
    }

    if (overlayAlpha <= 0) return

    // Draw skeleton edges of the active box
    let activeBox = boxes.find(box => box.id === activeId)
    if (activeBox && template && template.edges) {
      context.save()
      context.globalAlpha = overlayAlpha
      // single bright colour for the skeleton: a per-edge gradient would be
      // noisy, and the white/dark halo below keeps it readable anywhere
      context.strokeStyle = '#00e5ff'
      context.lineWidth = Math.max(1, canvas.width * 0.004)
      for (let edge of template.edges) {
        let a = keypoints[edge[0]]
        let b = keypoints[edge[1]]
        if (!a || !b) continue
        if (a.visibility === 0 || b.visibility === 0) continue
        context.beginPath()
        context.moveTo(a.x * image.naturalWidth, a.y * image.naturalHeight)
        context.lineTo(b.x * image.naturalWidth, b.y * image.naturalHeight)
        context.stroke()
      }
      context.restore()
    }

    // Draw keypoints
    let radius = Math.max(4, canvas.width * 0.012)
    context.save()
    context.globalAlpha = overlayAlpha
    for (let kp of keypoints) {
      // skip deleted points: null * width would place them at (0,0)
      if (kp.x == null || kp.y == null) continue
      let px = kp.x * image.naturalWidth
      let py = kp.y * image.naturalHeight
      let isSelected = kp.idx === selectedIdx

      context.save()
      if (kp.visibility === 0) {
        // invisible: hollow circle with a dark outline so it stays visible
        // on light backgrounds too
        context.strokeStyle = '#999'
        context.lineWidth = Math.max(1, radius * 0.3)
        context.beginPath()
        context.arc(px, py, radius, 0, 2 * Math.PI)
        context.stroke()
      } else {
        // visible: per-dot rainbow fill (each circle has its own top-left ->
        // bottom-right gradient) + white ring + dark outer ring, so the dot
        // is readable on any background colour
        context.fillStyle = createRainbowGradient(px, py, radius)
        context.beginPath()
        context.arc(px, py, radius, 0, 2 * Math.PI)
        context.fill()
        context.strokeStyle = '#ffffff'
        context.lineWidth = Math.max(1, radius * 0.35)
        context.stroke()
        context.strokeStyle = 'rgba(0,0,0,0.75)'
        context.lineWidth = Math.max(1, radius * 0.15)
        context.beginPath()
        context.arc(px, py, radius * 1.25, 0, 2 * Math.PI)
        context.stroke()
      }
      if (isSelected) {
        // selection ring: white + dark double ring for contrast
        context.strokeStyle = '#ffffff'
        context.lineWidth = Math.max(1, radius * 0.5)
        context.beginPath()
        context.arc(px, py, radius * 1.8, 0, 2 * Math.PI)
        context.stroke()
        context.strokeStyle = 'rgba(0,0,0,0.75)'
        context.lineWidth = Math.max(1, radius * 0.2)
        context.beginPath()
        context.arc(px, py, radius * 2.1, 0, 2 * Math.PI)
        context.stroke()
      }
      // label: white text with a dark outline (readable on any background)
      if (template && template.names[kp.idx]) {
        context.fillStyle = '#fff'
        context.strokeStyle = '#000'
        context.lineWidth = Math.max(1, radius * 0.25)
        context.font = `${Math.max(10, radius * 1.6)}px Arial`
        context.textAlign = 'center'
        context.textBaseline = 'bottom'
        let label = template.names[kp.idx]
        context.strokeText(label, px, py - radius * 1.6)
        context.fillText(label, px, py - radius * 1.6)
      }
      context.restore()
    }
    context.restore()
  }

  function activeBoxId(): number | undefined {
    return (window as any)._keypointActiveBoxId
  }

  function drawBox(box: KeypointBox, isActive: boolean) {
    let imgW = image.naturalWidth
    let imgH = image.naturalHeight
    let boxWidth = box.width * imgW
    let boxHeight = box.height * imgH
    let boxLeft = box.x * imgW - boxWidth / 2
    let boxTop = box.y * imgH - boxHeight / 2

    context.save()
    context.translate(boxLeft + boxWidth / 2, boxTop + boxHeight / 2)
    context.rotate(-box.rotate * 2 * Math.PI)
    context.lineWidth = Math.max(1, Math.max(imgW, imgH) * 0.004)
    if (isActive) {
      context.strokeStyle = '#3880ff'
    } else {
      context.strokeStyle = 'rgba(128,128,128,0.6)'
    }
    context.strokeRect(-boxWidth / 2, -boxHeight / 2, boxWidth, boxHeight)
    context.restore()
  }

  // Convert a canvas display coordinate into normalized image coordinate
  // (accounting for object-fit:contain letterboxing + camera transform +
  // rotation). Returns null when the point is outside the image.
  //
  // The canvas element is stretched by CSS (width/height 100%) while its
  // pixel buffer keeps the camera view's aspect ratio, and object-fit:contain
  // letterboxes the buffer inside the element. Click coordinates are in
  // element space, so they must first be mapped into the letterboxed buffer
  // area (same approach as drag-ui's minimap click handler) before the
  // camera transform can be reversed.
  function canvasToImage(clientX: number, clientY: number) {
    let rect = canvas.getBoundingClientRect()
    let displayX = clientX - rect.left
    let displayY = clientY - rect.top

    // Map element space -> canvas buffer space, accounting for the
    // object-fit:contain letterbox (buffer is centered inside the element).
    let bufferAspect = canvas.width / canvas.height
    let elementAspect = rect.width / rect.height
    let bufferDisplayWidth: number
    let bufferDisplayHeight: number
    let bufferOffsetX: number
    let bufferOffsetY: number
    if (bufferAspect > elementAspect) {
      // buffer is wider: fills element width, letterboxed vertically
      bufferDisplayWidth = rect.width
      bufferDisplayHeight = rect.width / bufferAspect
      bufferOffsetX = 0
      bufferOffsetY = (rect.height - bufferDisplayHeight) / 2
    } else {
      // buffer is taller: fills element height, letterboxed horizontally
      bufferDisplayHeight = rect.height
      bufferDisplayWidth = rect.height * bufferAspect
      bufferOffsetX = (rect.width - bufferDisplayWidth) / 2
      bufferOffsetY = 0
    }

    // clicks in the letterbox area are outside the buffer: ignore them
    const boundaryTolerance = 2
    if (
      displayX < bufferOffsetX - boundaryTolerance ||
      displayX > bufferOffsetX + bufferDisplayWidth + boundaryTolerance ||
      displayY < bufferOffsetY - boundaryTolerance ||
      displayY > bufferOffsetY + bufferDisplayHeight + boundaryTolerance
    ) {
      return null
    }

    // element space -> buffer pixel space
    let canvasX =
      ((displayX - bufferOffsetX) / bufferDisplayWidth) * canvas.width
    let canvasY =
      ((displayY - bufferOffsetY) / bufferDisplayHeight) * canvas.height

    // Reverse the render transform:
    // 1. undo center translate
    let x = canvasX - canvas.width / 2
    let y = canvasY - canvas.height / 2
    // 2. undo rotation
    let angle = camera.rotate * 2 * Math.PI
    let rx = x * Math.cos(angle) - y * Math.sin(angle)
    let ry = x * Math.sin(angle) + y * Math.cos(angle)
    x = rx
    y = ry
    // 3. undo scale
    let viewWidth = camera.width * image.naturalWidth
    let viewHeight = camera.height * image.naturalHeight
    let scale = Math.min(canvas.width / viewWidth, canvas.height / viewHeight)
    x /= scale
    y /= scale
    // 4. undo camera translate
    x += camera.x * image.naturalWidth
    y += camera.y * image.naturalHeight

    // to normalized [0,1]
    let nx = x / image.naturalWidth
    let ny = y / image.naturalHeight
    return { x: nx, y: ny }
  }

  // Hit-test: find a keypoint near the given image position (within radius)
  function findKeypointAt(nx: number, ny: number) {
    let keypoints = window.keypointData || []
    let radius = Math.max(0.005, 8 / image.naturalWidth)
    let best: Keypoint | null = null
    let bestDist = Infinity
    for (let kp of keypoints) {
      if (kp.x == null || kp.y == null) continue
      let dx = kp.x - nx
      let dy = kp.y - ny
      let dist = Math.sqrt(dx * dx + dy * dy)
      if (dist < radius && dist < bestDist) {
        best = kp
        bestDist = dist
      }
    }
    return best
  }

  // --- pointer interaction: click to place/move keypoint, drag to pan ---
  let isPanning = false
  let isDraggingKeypoint = false
  let lastPointerX = 0
  let lastPointerY = 0
  let pointerDownAt = 0
  let pointerDownX = 0
  let pointerDownY = 0

  function onPointerDown(event: PointerEvent) {
    if (event.button !== 0) return
    pointerDownAt = Date.now()
    pointerDownX = event.clientX
    pointerDownY = event.clientY
    lastPointerX = event.clientX
    lastPointerY = event.clientY

    let pt = canvasToImage(event.clientX, event.clientY)
    if (!pt) {
      // pointer is in the letterbox area (outside the image): do nothing —
      // the grey area must not pan the image
      return
    }
    let hit = findKeypointAt(pt.x, pt.y)
    if (hit) {
      // start dragging this keypoint
      isDraggingKeypoint = true
      window.selectedKeypointIdx = hit.idx
      if (typeof (window as any).onKeypointSelected === 'function') {
        ;(window as any).onKeypointSelected(hit.idx)
      }
      render()
    } else {
      isPanning = true
    }
  }

  function onPointerMove(event: PointerEvent) {
    if (isDraggingKeypoint) {
      let pt = canvasToImage(event.clientX, event.clientY)
      // pointer left the image area: keep the last valid position
      if (!pt) return
      let idx = window.selectedKeypointIdx
      let keypoints = window.keypointData || []
      let kp = keypoints.find(k => k.idx === idx)
      if (kp) {
        kp.x = Math.max(0, Math.min(1, pt.x))
        kp.y = Math.max(0, Math.min(1, pt.y))
        if (kp.visibility === 0) kp.visibility = 1
        render()
        if (typeof (window as any).onKeypointMoved === 'function') {
          ;(window as any).onKeypointMoved(kp)
        }
      }
      return
    }
    if (isPanning) {
      let rect = canvas.getBoundingClientRect()
      let contentSize = getPanContentSize(rect)
      let deltaX = event.clientX - lastPointerX
      let deltaY = event.clientY - lastPointerY

      let rotatedDeltaX =
        deltaX * Math.cos(camera.rotate * 2 * Math.PI) +
        deltaY * Math.sin(camera.rotate * 2 * Math.PI)
      let rotatedDeltaY =
        -deltaX * Math.sin(camera.rotate * 2 * Math.PI) +
        deltaY * Math.cos(camera.rotate * 2 * Math.PI)

      camera.x -= (rotatedDeltaX / contentSize.width) * camera.width
      camera.y -= (rotatedDeltaY / contentSize.height) * camera.height

      clampCamera()

      lastPointerX = event.clientX
      lastPointerY = event.clientY
      render()
    }
  }

  function onPointerUp(event: PointerEvent) {
    let wasDrag =
      Date.now() - pointerDownAt > 200 ||
      Math.abs(event.clientX - pointerDownX) > 5 ||
      Math.abs(event.clientY - pointerDownY) > 5

    if (isDraggingKeypoint) {
      isDraggingKeypoint = false
      // persist the final position
      let idx = window.selectedKeypointIdx
      let keypoints = window.keypointData || []
      let kp = keypoints.find(k => k.idx === idx)
      if (kp && typeof (window as any).onKeypointCommitted === 'function') {
        ;(window as any).onKeypointCommitted(kp)
      }
      return
    }

    isPanning = false
    // a quick click (not a drag) on empty space places/moves the selected
    // keypoint at the click position
    if (!wasDrag) {
      let pt = canvasToImage(event.clientX, event.clientY)
      if (!pt) return
      if (pt.x >= 0 && pt.x <= 1 && pt.y >= 0 && pt.y <= 1) {
        if (typeof (window as any).onCanvasClick === 'function') {
          ;(window as any).onCanvasClick(pt.x, pt.y)
        }
      }
    }
  }

  // Register interaction listeners only ONCE per canvas element.
  // setupKeypointEditor runs again on every image load, but the canvas
  // element persists across images (only the hidden <img> src changes), so
  // re-registering would stack duplicate handlers: one click fired
  // onCanvasClick twice, placing keypoint a AND b at the same position.
  // The closures capture image/canvas/window.camera, whose identity does
  // not change across image loads, so the first registration keeps working
  // for every subsequent image.
  if ((canvas as any).__keypointListenersBound) return
  ;(canvas as any).__keypointListenersBound = true
  canvas.addEventListener('pointerdown', event => {
    onPointerDown(event)
  })
  canvas.addEventListener('pointermove', event => {
    onPointerMove(event)
  })
  canvas.addEventListener('pointerup', event => {
    onPointerUp(event)
  })
  canvas.addEventListener('pointerleave', () => {
    isPanning = false
    isDraggingKeypoint = false
  })

  // --- touch: pinch zoom + pan (same logic as drag-ui) ---
  canvas.addEventListener('touchstart', event => {
    event.preventDefault()
    for (let touch of Array.from(event.touches)) {
      lastTouches[touch.identifier] = touch
    }
    // a single touch starting on a keypoint drags the keypoint, not the
    // image: the touchmove handler checks this flag and moves the point
    // instead of panning. Pointer events usually handle this too, but the
    // hit-test here keeps touch-only browsers consistent.
    if (event.touches.length === 1) {
      let touch = event.touches[0]
      let pt = canvasToImage(touch.clientX, touch.clientY)
      if (pt) {
        let hit = findKeypointAt(pt.x, pt.y)
        if (hit) {
          isDraggingKeypoint = true
          window.selectedKeypointIdx = hit.idx
          if (typeof (window as any).onKeypointSelected === 'function') {
            ;(window as any).onKeypointSelected(hit.idx)
          }
          render()
        }
      }
    }
  })

  canvas.addEventListener('touchmove', event => {
    let rect = canvas.getBoundingClientRect()
    let contentSize = getPanContentSize(rect)
    let touchCount = event.touches.length

    // dragging a keypoint with a single finger: move the point, never pan
    if (isDraggingKeypoint && touchCount === 1) {
      let touch = event.touches[0]
      let pt = canvasToImage(touch.clientX, touch.clientY)
      if (pt) {
        let idx = window.selectedKeypointIdx
        let keypoints = window.keypointData || []
        let kp = keypoints.find(k => k.idx === idx)
        if (kp) {
          kp.x = Math.max(0, Math.min(1, pt.x))
          kp.y = Math.max(0, Math.min(1, pt.y))
          if (kp.visibility === 0) kp.visibility = 1
          render()
          if (typeof (window as any).onKeypointMoved === 'function') {
            ;(window as any).onKeypointMoved(kp)
          }
        }
      }
      // keep touch tracking fresh so a later pan starts from here
      for (let touch of Array.from(event.touches)) {
        lastTouches[touch.identifier] = touch
      }
      return
    }
    // a second finger cancels the keypoint drag: switch to pinch/pan
    if (isDraggingKeypoint) {
      isDraggingKeypoint = false
    }

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

      camera.x -=
        ((rotatedDeltaX / contentSize.width) * camera.width) / touchCount
      camera.y -=
        ((rotatedDeltaY / contentSize.height) * camera.height) / touchCount

      clampCamera()
    }

    // detect pinch (scale)
    if (touchCount == 2) {
      let currentTouch1 = event.touches[0]
      let currentTouch2 = event.touches[1]

      let lastTouch1 = lastTouches[currentTouch1.identifier]
      let lastTouch2 = lastTouches[currentTouch2.identifier]
      if (!lastTouch1 || !lastTouch2) return

      let lastDx = lastTouch1.clientX - lastTouch2.clientX
      let lastDy = lastTouch1.clientY - lastTouch2.clientY
      let currentDx = currentTouch1.clientX - currentTouch2.clientX
      let currentDy = currentTouch1.clientY - currentTouch2.clientY

      let distanceX = Math.abs(currentDx)
      let distanceY = Math.abs(currentDy)

      let scaleX = Math.abs(currentDx) / Math.abs(lastDx)
      let scaleY = Math.abs(currentDy) / Math.abs(lastDy)

      if (!isFinite(scaleX) || scaleX <= 0) scaleX = 1
      if (!isFinite(scaleY) || scaleY <= 0) scaleY = 1

      if (distanceX === 0) {
        scaleX = 1
      } else if (distanceY === 0) {
        scaleY = 1
      } else if (distanceX / distanceY > 2) {
        scaleY = 1
      } else if (distanceY / distanceX > 2) {
        scaleX = 1
      }

      let newWidth = camera.width / scaleX
      let newHeight = camera.height / scaleY

      if (newWidth > 1) newWidth = 1
      if (newHeight > 1) newHeight = 1

      let maxSize = 2.0
      if (newWidth < 1 / image.naturalWidth) {
        newWidth = 1 / image.naturalWidth
      }
      if (newHeight < 1 / image.naturalHeight) {
        newHeight = 1 / image.naturalHeight
      }
      if (newWidth > maxSize) newWidth = maxSize
      if (newHeight > maxSize) newHeight = maxSize

      let oldWidth = camera.width
      let oldHeight = camera.height

      camera.width = newWidth
      camera.height = newHeight

      camera.x -= (newWidth - oldWidth) / 2
      camera.y -= (newHeight - oldHeight) / 2

      clampCamera()
    }

    // update last touches
    for (let touch of Array.from(event.touches)) {
      lastTouches[touch.identifier] = touch
    }

    resizePreviewToCamera()
  })

  canvas.addEventListener('touchend', event => {
    // commit a finished keypoint drag (pointer events usually commit first;
    // this covers browsers where pointer events are not fired)
    if (isDraggingKeypoint && event.touches.length === 0) {
      isDraggingKeypoint = false
      let idx = window.selectedKeypointIdx
      let keypoints = window.keypointData || []
      let kp = keypoints.find(k => k.idx === idx)
      if (kp && typeof (window as any).onKeypointCommitted === 'function') {
        ;(window as any).onKeypointCommitted(kp)
      }
    }
    let existingTouches = Array.from(event.touches, touch => touch.identifier)
    for (let touch of Object.values(lastTouches)) {
      if (!existingTouches.includes(touch.identifier)) {
        delete lastTouches[touch.identifier]
      }
    }
  })

  // --- wheel zoom ---
  canvas.addEventListener(
    'wheel',
    event => {
      event.preventDefault()
      let factor = event.deltaY < 0 ? 0.9 : 1.1
      let newWidth = camera.width * factor
      let newHeight = camera.height * factor
      if (newWidth > 1) newWidth = 1
      if (newHeight > 1) newHeight = 1
      let maxSize = 2.0
      if (newWidth < 1 / image.naturalWidth) newWidth = 1 / image.naturalWidth
      if (newHeight < 1 / image.naturalHeight)
        newHeight = 1 / image.naturalHeight
      if (newWidth > maxSize) newWidth = maxSize
      if (newHeight > maxSize) newHeight = maxSize

      camera.width = newWidth
      camera.height = newHeight
      // Keep the current view center fixed: zooming should expand or shrink
      // evenly around the image center instead of drifting toward a corner.
      clampCamera()
      resizePreviewToCamera()
    },
    { passive: false },
  )
}

Object.assign(window, { setupKeypointEditor })
