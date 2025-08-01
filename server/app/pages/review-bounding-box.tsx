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

let pageTitle = (
  <Locale en="Review Bounding Box" zh_hk="審視邊界框" zh_cn="审阅边界框" />
)

let style = Style(/* css */ `
#ReviewBoundingBox {

}
`)

let script = Script(/* js */ `

  label_select = document.querySelector('#label_select');
  box_count_select = document.querySelector('#box_count_select');

  label_id = +label_select.value
  box_count = +box_count_select.value
  
  // submit form when label_select is changed
  label_select.addEventListener('ionChange', (event) => {
    label_id = event.detail.value;
  
    // Update URL with new label parameter
    const url = new URL(window.location);
    url.searchParams.set('label', label_id);
    window.history.pushState({}, '', url);
    submitBoxCount();
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
  console.log('submitBoxCount')
  emit('/review-bounding-box/submit-box-count', {
    label_id,
    box_count,
  })
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

function ImageItem(attrs: {
  filename: string
  original_filename: string | null
  image_id: number
}) {
  return (
    <ion-col size="12">
      <div class="image-item" style="text-align: center;">
        <img src={'/uploads/' + attrs.filename} />
        <div class="image-item--filename" style="text-align: center;">
          {attrs.original_filename}
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
  let total_images = proxy.image.length

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
          value={0}
          id="box_count_select"
        >
          <ion-select-option value="0">0 (5)</ion-select-option>
          <ion-select-option value="1">1 (6)</ion-select-option>
          <ion-select-option value="2">2 (7)</ion-select-option>
        </ion-select>
      </ion-item>
      <ion-grid>
        <ion-row class="ion-justify-content-center">
          <ImageItem
            filename="834ee161-74e2-4919-b716-43c1361f6b09.jpeg"
            original_filename="cat.jpeg"
            image_id={1}
          />
          <ImageItem
            filename="6651a823-8771-4e98-8235-2424cb225299.jpeg"
            original_filename="dog.jpeg"
            image_id={4}
          />
        </ion-row>
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
} satisfies Routes

export default { routes }
