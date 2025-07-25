console.log('Hello World bye bye')

let image = document.getElementById('image') as HTMLImageElement

let mapCanvas = document.getElementById('map') as HTMLCanvasElement
export let cameraCanvas = document.getElementById('camera') as HTMLCanvasElement

let rotateButton = document.getElementById('rotateButton') as HTMLButtonElement
if (rotateButton) {
  rotateButton.onclick = () => {
    camera.rotate += 1 / 8
    render()
  }
}

let debugMessage = document.getElementById('debugMessage') as HTMLElement
let debugStartMessage = document.getElementById(
  'debugStartMessage',
) as HTMLElement
let debugMoveMessage = document.getElementById(
  'debugMoveMessage',
) as HTMLElement
let debugEndMessage = document.getElementById('debugEndMessage') as HTMLElement

let mapContext = mapCanvas.getContext('2d')!
let cameraContext = cameraCanvas.getContext('2d')!

image.src = 'image.jpg'

image.onload = () => {
  mapCanvas.width = image.naturalWidth
  mapCanvas.height = image.naturalHeight
  cameraCanvas.width = image.naturalWidth
  cameraCanvas.height = image.naturalHeight

  render()

  setTimeout(() => {
    camera.x = 0.85
    camera.y = 0.2
    camera.width = 0.3
    camera.height = 0.2
    camera.rotate = 0
    camera.rotate_angle = 0
    render()
  }, 1000)
}

let camera = {
  x: 0.5,
  y: 0.5,
  width: 1,
  height: 1,
  rotate: 0,
  rotate_angle: 0,
}

let lastTouches: Record<number, Touch> = {}

function formatTouches(touches: TouchList) {
  return Array.from(touches, touch => {
    return {
      id: touch.identifier,
      x: touch.clientX,
      y: touch.clientY,
    }
  })
}

cameraCanvas.addEventListener('touchstart', event => {
  event.preventDefault()
  let touchCount = event.touches.length
  // debugStartMessage.textContent =
  //   'touchstart: ' + JSON.stringify(formatTouches(event.touches), null, 2)
  for (let touch of event.touches) {
    lastTouches[touch.identifier] = touch
  }
})

cameraCanvas.addEventListener('touchmove', event => {
  // debugMoveMessage.textContent =
  //   'touchmove: ' + JSON.stringify(formatTouches(event.touches), null, 2)
  let rect = cameraCanvas.getBoundingClientRect()
  let touchCount = event.touches.length

  // detect pan (translation)
  for (let touch of event.touches) {
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

    if (left >= 0 && right <= image.naturalWidth) {
      camera.width = newWidth
    } else if (newWidth <= 1) {
      camera.width = newWidth
      camera.x -= (newWidth - camera.width) / 2
    }

    if (top >= 0 && bottom <= image.naturalHeight) {
      camera.height = newHeight
    } else if (newHeight <= 1) {
      camera.height = newHeight
      camera.y -= (newHeight - camera.height) / 2
    }

    // Detect the rotation
    let currentCenterX = (currentTouch1.clientX + currentTouch2.clientX) / 2
    let currentCenterY = (currentTouch1.clientY + currentTouch2.clientY) / 2
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

    // cameraContext.scale(rotate_scaleX, rotate_scaleY)
    // cameraContext.translate(-rotate_left, -rotate_top)

    // cameraContext.translate(+rotate_left + width / 2, +rotate_top + height / 2)
    // cameraContext.rotate(rotate)
    // cameraContext.translate(-rotate_left - width / 2, -rotate_top - height / 2)

    debugMessage.textContent =
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
  for (let touch of event.touches) {
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

cameraContext.setTransform()
function pan() {}

function pinch() {}

function rotate() {}

function render() {
  renderMap()
  renderCamera()
}

function renderMap() {
  mapContext.drawImage(image, 0, 0)
  drawCameraBorder()
}

function renderCamera() {
  let width = camera.width * image.naturalWidth
  let height = camera.height * image.naturalHeight
  let left = camera.x * image.naturalWidth - width / 2
  let top = camera.y * image.naturalHeight - height / 2
  cameraContext.clearRect(0, 0, cameraCanvas.width, cameraCanvas.height)
  cameraContext.save()

  // console.log(cameraCanvas.width, width)

  cameraContext.scale(cameraCanvas.width / width, cameraCanvas.height / height)
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
