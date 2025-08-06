import { o } from '../jsx/jsx.js'
import { Routes } from '../routes.js'
import { apiEndpointTitle, title } from '../../config.js'
import Style from '../components/style.js'
import {
  Context,
  DynamicContext,
  getContextFormBody,
  throwIfInAPI,
  WsContext,
} from '../context.js'
import { mapArray } from '../components/fragment.js'
import { IonBackButton } from '../components/ion-back-button.js'
import { id, number, object, string } from 'cast.ts'
import { Link, Redirect } from '../components/router.js'
import { renderError } from '../components/error.js'
import { getAuthUser } from '../auth/user.js'
import { evalLocale, Locale } from '../components/locale.js'
import { proxy } from '../../../db/proxy.js'
import { db } from '../../../db/db.js'
import { Script } from '../components/script.js'
import { EarlyTerminate } from '../../exception.js'
import { nodeToVNode } from '../jsx/vnode.js'
import { pick } from 'better-sqlite3-proxy'

let pageTitle = (
  <Locale en="Review Bounding Box" zh_hk="審視邊界框" zh_cn="审阅边界框" />
)

let style = Style(/* css */ `
#ReviewBoundingBox {

}

ion-col {
  background-color:rgb(218, 215, 215);
  margin: 10px;
  padding: 10px;
  border-radius: 10px;
}
`)

let script = Script(/* js */ `

  label_select = document.querySelector('#label_select');
  box_count_select = document.querySelector('#box_count_select');

  label_id = +label_select.value
  box_count = +box_count_select.value
  
  // submit form when label_select is changed
  label_select.addEventListener('ionChange', (event) => {
    label_id = +event.detail.value;
  
    // Update URL with new label parameter
    const url = new URL(window.location);
    url.searchParams.set('label', label_id);
    window.history.pushState({}, '', url);
    submitBoxCount();
    emit('/review-bounding-box/label-changed', { label_id })
  })

  box_count_select.addEventListener('ionChange', (event) => {
    box_count = event.detail.value;
    // Update URL with new box count parameter
    const url = new URL(window.location);
    url.searchParams.set('box_count', box_count);
    window.history.pushState({}, '', url);
    submitBoxCount();
  })

//send selected image label and box count to server
function submitBoxCount() {
  emit('/review-bounding-box/submit-box-count', {
    label_id,
    box_count,
  })
}

// draw multiple bounding boxes on the single canvas located by image_id
function drawBoundingBoxes(image) {
  // boxes: Array of { x, y, width, height, angle } objects

  const image_id = image.dataset.imageId
  const canvas = image.parentElement.querySelector('canvas')
  const boxes = JSON.parse(image.dataset.boxes);

  if (!canvas || !image) {
    console.error('Canvas or image not found for image_id:', image_id);
    return;
  }

  if(!image.clientWidth || !image.clientHeight) {
    setTimeout(() => {
      drawBoundingBoxes(image)
    }, 33)
    return
  }

  // Resize canvas to match image size
  canvas.width = image.clientWidth;
  canvas.height = image.clientHeight;

  const context = canvas.getContext('2d');
  context.clearRect(0, 0, canvas.width, canvas.height)

  let lineWidth = Math.max(canvas.width, canvas.height) * 0.01
  context.lineWidth = lineWidth;

  boxes.forEach((box) => {
    const width = box.width * canvas.width
    const height = box.height * canvas.height
    const left = box.x * canvas.width - width / 2
    const top = box.y * canvas.height - height / 2

    // Save the current context state
    context.save();

    // Translate to center of rectangle
    context.translate(left + width / 2, top + height / 2);

    // Rotate context
    let degrees = box.rotate * 360
    let radians = degrees / 180 * Math.PI
    context.rotate(radians);

    // Create a rainbow gradient for this box's width
    const gradient = context.createLinearGradient(-width/2, 0, width/2, 0);
    gradient.addColorStop(0, 'red');
    gradient.addColorStop(1/6, 'orange');
    gradient.addColorStop(2/6, 'yellow');
    gradient.addColorStop(3/6, 'green');
    gradient.addColorStop(4/6, 'blue');
    gradient.addColorStop(5/6, 'indigo');
    gradient.addColorStop(1, 'violet');
    context.strokeStyle = gradient;

    // Draw rectangle centered at origin
    context.strokeRect(-width / 2, -height / 2, width, height);

    // Restore the context state
    context.restore();
  });
}
`)

let page = (
  <>
    {style}
    <ion-header>
      <ion-toolbar>
        <IonBackButton href="/" backText="Home" />
        <ion-title role="heading" aria-level="1">
          {pageTitle}
        </ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content id="ReviewBoundingBox" class="ion-padding">
      <Main />
    </ion-content>
    {script}
  </>
)

let count_annotated_images = db
  .prepare<{ label_id: number }, number>(
    /* sql */ `
select count(distinct image_id)
from image_label
where label_id = :label_id
`,
  )
  .pluck()

// get box count and image count by label_id
/* example:
[
  { box_count: 1, image_count: 1 },
  { box_count: 2, image_count: 2 },
]
*/
let getBoxImageCounts = db.prepare<
  { label_id: number },
  { box_count: number; image_count: number }
>(/* sql */ `
    with list as ( select image_id, label_id, count(*) as count 
    from image_bounding_box 
    where label_id = :label_id 
    group by image_id, label_id ) 
    select count as box_count, count(*) as image_count 
    from list 
    group by count
    `)

// get image_ids by label_id and box_count like 1,2,3
let getImageIdsByLabelAndBoxCount = db
  .prepare<
    {
      label_id: number
      box_count: number
    },
    number
  >(
    /* sql */ `
  select image_id
  from image_bounding_box
  where label_id = :label_id
  group by image_id
  having count(*) = :box_count
`,
  )
  .pluck()

// get image bounding boxes by image_id and label_id
/* example:[
  { x: 0.1, y: 0.2, width: 0.3, height: 0.5, rotate: 0},
  { x: 0.5, y: 0.6, width: 0.2, height: 0.6, rotate: 0.125 },
] */
let getImageBoundingBoxes = db.prepare<
  { image_id: number; label_id: number },
  {
    x: number
    y: number
    width: number
    height: number
    rotate: number
  }
>(/* sql */ `
  select x, y, width, height, rotate
  from image_bounding_box
  where image_id = :image_id and label_id = :label_id
  `)

// return a list of ImageItem by label_id and box_count
function getImageItem(label_id: number, box_count: number) {
  let image_ids = getImageIdsByLabelAndBoxCount.all({
    label_id: label_id,
    box_count: box_count,
  })

  type Image = (typeof images)[number]
  let images = pick(proxy.image, ['id', 'filename', 'original_filename'])
  let items = images.filter(image => image_ids.includes(image.id!))

  function renderImage(
    image: Image,
    boxes: {
      x: number
      y: number
      width: number
      height: number
      rotate: number
    }[],
  ) {
    return (
      <ImageItem
        filename={image.filename}
        original_filename={image.original_filename}
        image_id={image.id!}
        boxes={boxes}
      />
    )
  }

  let images_items = mapArray(items, item => {
    let boxes = getImageBoundingBoxes.all({
      image_id: item.id!,
      label_id: label_id,
    })
    return renderImage(item, boxes)
  })

  return images_items
}

function ImageItem(attrs: {
  filename: string
  original_filename: string | null
  image_id: number
  boxes: {
    /** 0..1: 1 is image width */
    x: number
    /** 0..1: 1 is image height */
    y: number
    /** 0..1: 1 is image width */
    width: number
    /** 0..1: 1 is image height */
    height: number
    /** 0..1: 1 is 360 degree */
    rotate: number
  }[]
}) {
  return (
    <ion-col size="12">
      <div class="image-item" style="text-align: center">
        <div style="position: relative; display: inline-block;">
          <img
            src={'/uploads/' + attrs.filename}
            data-image-id={attrs.image_id}
            data-boxes={JSON.stringify(attrs.boxes)}
            onload="drawBoundingBoxes(this)"
          />
          <canvas
            data-image-id={attrs.image_id}
            style="position: absolute; top: 0; left: 0;"
          ></canvas>
          <div class="image-item--filename" style="text-align: center;">
            {attrs.original_filename}
          </div>
        </div>
      </div>
    </ion-col>
  )
}

function Main(attrs: {}, context: DynamicContext) {
  let user = getAuthUser(context)
  if (!user) {
    return (
      <>
        <div style="margin: auto; width: fit-content; text-align: center;">
          <p class="ion-padding ion-margin error">
            <Locale
              en="You must be logged in to review bounding box"
              zh_hk="您必須登入才能審視邊界框"
              zh_cn="您必须登录才能审阅边界框"
            />
          </p>
          <ion-button color="primary" onclick='goto("/login")'>
            <Locale en="Login" zh_hk="登入" zh_cn="登录" />
          </ion-button>
        </div>
      </>
    )
  }

  let params = new URLSearchParams(context.routerMatch?.search)
  let label_id = +params.get('label')! || 1
  let box_count = +params.get('box_count')! || 1
  let total_images = proxy.image.length

  let images_items = getImageItem(label_id, box_count)

  return (
    <>
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
            let annotated_images = count_annotated_images.get({
              label_id: label.id!,
            })
            return (
              <ion-select-option value={label.id}>
                {label.title} ({annotated_images}/{total_images})
              </ion-select-option>
            )
          })}
        </ion-select>
      </ion-item>
      <ion-item>
        <ion-select
          label={Locale(
            {
              en: 'Box Count',
              zh_hk: '框數',
              zh_cn: '框数',
            },
            context,
          )}
          value={1}
          id="box_count_select"
        >
          {mapArray(getBoxImageCounts.all({ label_id: label_id }), item => {
            return (
              <ion-select-option value={item.box_count}>
                {item.box_count} ({item.image_count})
              </ion-select-option>
            )
          })}
        </ion-select>
      </ion-item>
      <ion-grid>
        <ion-row class="ion-justify-content-center">{images_items}</ion-row>
      </ion-grid>
    </>
  )
}

let submitReviewParser = object({
  label_id: id(),
  box_count: number(),
})

function SubmitReviewBoundingBox(attrs: {}, context: WsContext) {
  console.log('submitReviewBoundingBox')
  try {
    let user = getAuthUser(context)
    let body = getContextFormBody(context)
    let input = submitReviewParser.parse(body)
    let { label_id, box_count } = input
    console.log('label_id', label_id)
    console.log('box_count', box_count)

    let images_items = getImageItem(label_id, box_count)

    context.ws.send([
      'update-in',
      'ion-grid ion-row',
      nodeToVNode(images_items, context),
    ])
  } catch (error) {
    console.error(error)
  }
  throw EarlyTerminate
}

function LabelChanged(attrs: {}, context: WsContext) {
  try {
    console.log('LabelChanged')
    let parser = object({
      label_id: id(),
    })
    let body = getContextFormBody(context)
    let input = parser.parse(body)
    let { label_id } = input
    console.log('label_id', label_id)

    let new_box_count_select = (
      <ion-select
        label={Locale(
          {
            en: 'Box Count',
            zh_hk: '框數',
            zh_cn: '框数',
          },
          context,
        )}
        value={1}
        id="box_count_select"
      >
        {mapArray(getBoxImageCounts.all({ label_id: label_id }), item => {
          return (
            <ion-select-option value={item.box_count}>
              {item.box_count} ({item.image_count})
            </ion-select-option>
          )
        })}
      </ion-select>
    )

    context.ws.send([
      'update-in',
      'ion-select#box_count_select',
      nodeToVNode(new_box_count_select, context),
    ])
  } catch (error) {
    console.error(error)
  }
  throw EarlyTerminate
}

let routes = {
  '/review-bounding-box': {
    resolve(context) {
      let t = evalLocale(pageTitle, context)
      return {
        title: title(t),
        description: 'TODO',
        node: page,
      }
    },
  },
  '/review-bounding-box/submit-box-count': {
    title: apiEndpointTitle,
    description: 'TODO',
    node: <SubmitReviewBoundingBox />,
    streaming: false,
  },
  '/review-bounding-box/label-changed': {
    title: apiEndpointTitle,
    description: 'TODO',
    node: <LabelChanged />,
    streaming: false,
  },
} satisfies Routes

export default { routes }
