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

function rotateAnnotationImage(image) {
  let degree = image.dataset.rotation || 0
  degree = (degree + 90) % 360
  image.dataset.rotation = degree
  rotateImageInline(image)
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
function setupEditorUI() {
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
  })
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

window.setupEditorUI = setupEditorUI

// window.onServerMessage = window.onServerMessage || function(message) {
//   console.log('Received server message:', message);
//   if (message[0] === 'update-attrs' && message[1] === '#label_image') {
//     console.log('Updating label_image:', message[2]);
//     let img = document.getElementById('label_image');
//     if (img && message[2].onload) {
//       // Set up the onload handler for the new image
//       img.onload = function() {
//         console.log('Image loaded, calling setupEditorUI');
//         setupEditorUI();
//       };
//     }
//   }
// }

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
  select image_label.id, image.filename
  from image_label
  inner join image on image.id = image_label.image_id
  where answer = 1
    and image_label.label_id = :label_id
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
              { en: 'Class Label', zh_hk: '類別標籤', zh_cn: '类別标签' },
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
            onLoad="setupEditorUI()"
          />
          <div
            id="no-image-message"
            style="display: flex; align-items: center; justify-content: center; height: 100%; text-align: center; padding: 2rem;"
            hidden={!!image}
          ></div>
        </div>
        <ion-button color="success" style="margin-top: 1rem;">
          <Locale en="Submit Annotation" zh_hk="提交標註" zh_cn="提交标注" />
        </ion-button>
      </div>
    </>
  )
}

let showImageParser = object({
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
} satisfies Routes

export default { routes }
