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
import { array, id, int, object, string, url, values } from 'cast.ts'
import { Link, Redirect } from '../components/router.js'
import { renderError } from '../components/error.js'
import { getAuthUser } from '../auth/user.js'
import { evalLocale, Locale } from '../components/locale.js'
import { proxy, User } from '../../../db/proxy.js'
import { db } from '../../../db/db.js'
import { Script } from '../components/script.js'
import { toRouteUrl } from '../../url.js'
import { ServerMessage } from '../../../client/types.js'
import { sessions } from '../session.js'
import { EarlyTerminate } from '../../exception.js'
import { pick } from 'better-sqlite3-proxy'
import { nodeToVNode } from '../jsx/vnode.js'

let pageTitle = (
  <Locale en="Review Annotation" zh_hk="審視標註" zh_cn="审阅标注" />
)

let style = Style(/* css */ `
#ReviewAnnotation {

}
.segment-yes {
  --background: var(--ion-color-success, #28a745);
  --color: #fff;
}
.segment-no {
  --background: var(--ion-color-danger, #dc3545);
  --color: #fff;
}
.segment-unknown {
  --background: var(--ion-color-warning, #ffc107);
  --color: #212529;
}
#answerSegment ion-segment-button {
  border-radius: 1rem;
  margin: 0 0.5rem;
  padding: 0.5rem 0;
  font-size: 1.2rem;
  background: var(--background);
  color: var(--color);
  --indicator-height: 0;
  --ripple-color: transparent;
  --color-checked: var(--color);
  opacity: 0.5;
  transform: scale(0.8);
  transition: opacity 0.2s ease-in-out, transform 0.2s ease-in-out;
}
#answerSegment ion-segment-button.segment-button-checked {
  opacity: 1;
  transform: scale(1);
}

.image-item img {
  width: 100%;
  height: 100px;
  object-fit: contain;
  padding: 0.5rem;
}

/*change background color to red when clash*/
.image-item-container[data-clash='true'] {
  --background: var(--ion-color-danger);
  --color: #fff;
}
.image-item-container {
  --ripple-color: transparent;
}

/* Make buttons larger */
.submit-buttons ion-button {
  min-height: 48px; /* Increased height */
  min-width: 48px;  /* Minimum width for square buttons */
  --padding-start: 1.5em;
  --padding-end: 1.5em;
  font-size: 1.5em; /* Larger icon size */
}

/* Make button container match grid width */
.submit-buttons {
  display: flex;
  justify-content: center;
  gap: 16px; /* Space between buttons */
  width: 100%;
  max-width: 720px; /* Matches default Ionic fixed grid max-width */
  margin: 1rem auto 0;
  padding: 0 16px; /* Match grid's side padding */
  box-sizing: border-box;
}


`)

let script = Script(/* js */ `

label_select = document.querySelector('#label_select');

// submit form when label_select is changed
label_select.addEventListener('ionChange', (event) => {
  const labelId = event.detail.value;

  // Update URL with new label parameter
  const url = new URL(window.location);
  url.searchParams.set('label', labelId);
  window.history.pushState({}, '', url);

  submitAnswer('change_label');
})

//send selected image ids to server
function submitAnswer(mark_answer) {
  let label_id = +label_select.value
  let view_answer = answerSegment.value;
  let selected_image_ids = [];
  document.querySelectorAll('#content-'+view_answer+' ion-checkbox').forEach(checkbox => {
    if (checkbox.checked) {
      selected_image_ids.push(+checkbox.dataset.imageId);
    }
  })
  emit('/review-annotation/submit-review', {
    label_id,
    mark_answer,
    selected_image_ids,
  })
}

function ImageItemOnClick(event) {
  if (event.target.closest('ion-checkbox')) {
    return;
  }
  const item = event.currentTarget;
  const checkbox = item.querySelector('ion-checkbox');
  checkbox.checked = !checkbox.checked;
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
    <ion-content id="ReviewAnnotation" class="ion-padding">
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

// get image ids by label id and answer it returns an image id like 1,2,3
let get_image_by_label_id_answer = db
  .prepare<{ label_id: number; answer: number | undefined }, number>(
    /* sql */ `
select distinct image_id
from image_label 
where label_id = :label_id and answer = :answer
`,
  )
  .pluck()

// it receives an image url and filename and returns a div with the image and the filename
function ImageItem(attrs: {
  filename: string
  original_filename: string | null
  image_id: number
  is_clash: boolean
}) {
  return (
    <ion-item
      class="image-item-container"
      data-clash={attrs.is_clash ? 'true' : 'false'}
      onclick="ImageItemOnClick(event)"
    >
      <ion-checkbox data-image-id={attrs.image_id}></ion-checkbox>
      <div class="image-item">
        <img src={'/uploads/' + attrs.filename} />
        <div class="image-item--filename" style="text-align: center;">
          {attrs.original_filename}
        </div>
      </div>
    </ion-item>
  )
}

const mapping: { [key: string]: number } = {
  yes: 1,
  no: 0,
}

// it receives a answer string and returns a number like 1 for yes, 0 for no, undefined for unknown
function stringToNumber(s: string): number | undefined {
  return mapping[s]
}

// get all images by label id and classify them into yes, no, unknown and clash
function getImages(args: { label_id: number }) {
  let { label_id } = args

  let yes = get_image_by_label_id_answer.all({
    label_id,
    answer: stringToNumber('yes'),
  })

  let no = get_image_by_label_id_answer.all({
    label_id,
    answer: stringToNumber('no'),
  })

  type Image = (typeof images)[number]
  let images = pick(proxy.image, ['id', 'filename', 'original_filename'])

  let ids = images.map(image => image.id!)

  // unknown images are the images that are not in yes or no
  let unknown = ids.filter(id => !yes.includes(id) && !no.includes(id))

  // clash (conflict) images are the images that are in both yes and no
  let clash = ids.filter(id => yes.includes(id) && no.includes(id))

  let total_images = ids.length
  let annotated_images = ids.length - unknown.length

  function renderImage(image: Image) {
    return (
      <ion-col size="4">
        <ImageItem
          filename={image.filename}
          original_filename={image.original_filename}
          image_id={image.id!}
          is_clash={clash.includes(image.id!)}
        />
      </ion-col>
    )
  }

  let yes_images = mapArray(
    images.filter(image => yes.includes(image.id!)),
    renderImage,
  )

  let no_images = mapArray(
    images.filter(image => no.includes(image.id!)),
    renderImage,
  )

  let unknown_images = mapArray(
    images.filter(image => unknown.includes(image.id!)),
    renderImage,
  )

  return {
    yes_images,
    no_images,
    unknown_images,
    annotated_images,
    total_images,
  }
}

function reclassify(
  label_id: number,
  mark_answer: number,
  selected_image_ids: number[],
  user_id: number,
) {
  if (selected_image_ids.length === 0) return

  const placeholders = selected_image_ids.map(() => '?').join(', ')

  // Start a transaction for atomicity
  const trx = db.transaction(() => {
    // Delete all selected images' answer records in this label
    db.prepare(
      `
      DELETE FROM image_label
      WHERE label_id = ?
      AND image_id IN (${placeholders})
      `,
    ).run(label_id, ...selected_image_ids)

    // Add new images' answer records to this label
    const insertStmt = db.prepare(
      `
      INSERT INTO image_label (label_id, image_id, answer, user_id)
      VALUES (@label_id, @image_id, @answer, @user_id)
      `,
    )
    for (const image_id of selected_image_ids) {
      insertStmt.run({
        label_id,
        image_id,
        answer: mark_answer,
        user_id,
      })
    }
  })

  trx()
}

function Main(attrs: {}, context: DynamicContext) {
  let user = getAuthUser(context)
  if (!user) {
    return (
      <>
        <div style="margin: auto; width: fit-content; text-align: center;">
          <p class="ion-padding ion-margin error">
            <Locale
              en="You must be logged in to review annotations"
              zh_hk="您必須登入才能審視標註"
              zh_cn="您必须登录才能审阅标注"
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
  let answer = params.get('answer')! || 'yes'
  let total_images = proxy.image.length

  let { yes_images, no_images, unknown_images } = getImages({ label_id })

  return (
    <div>
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

      <br />
      <ion-segment value={answer} id="answerSegment">
        <ion-segment-button
          value="yes"
          content-id="content-yes"
          class="segment-yes"
        >
          <ion-icon name="checkmark"></ion-icon>
        </ion-segment-button>
        <ion-segment-button
          value="no"
          content-id="content-no"
          class="segment-no"
        >
          <ion-icon name="close"></ion-icon>
        </ion-segment-button>
        <ion-segment-button
          value="unknown"
          content-id="content-unknown"
          className="segment-unknown"
        >
          <ion-icon name="help"></ion-icon>
        </ion-segment-button>
      </ion-segment>
      <br />
      <ion-segment-view>
        <ion-segment-content id="content-yes">
          {/* this is a grid that contains 3 images per row */}
          <ion-grid fixed>
            <ion-row>{yes_images}</ion-row>
          </ion-grid>
        </ion-segment-content>
        <ion-segment-content id="content-no">
          <ion-grid fixed>
            <ion-row>{no_images}</ion-row>
          </ion-grid>
        </ion-segment-content>
        <ion-segment-content id="content-unknown">
          <ion-grid fixed>
            <ion-row>{unknown_images}</ion-row>
          </ion-grid>
        </ion-segment-content>
      </ion-segment-view>

      <div class="submit-buttons">
        <ion-button type="button" onclick="submitAnswer('yes')" color="success">
          <ion-icon name="checkmark"></ion-icon>
        </ion-button>
        <ion-button type="button" onclick="submitAnswer('no')" color="danger">
          <ion-icon name="close"></ion-icon>
        </ion-button>
      </div>
    </div>
  )
}

let submitReviewParser = object({
  label_id: id(),
  mark_answer: values(['yes' as const, 'no' as const, 'change_label' as const]),
  selected_image_ids: array(id()),
})

function SubmitReview(attrs: {}, context: WsContext) {
  try {
    console.log('SubmitReview')
    let user = getAuthUser(context)
    let body = getContextFormBody(context)
    let input = submitReviewParser.parse(body)
    let { label_id, mark_answer, selected_image_ids } = input

    //update the annotation in the database
    if (
      mark_answer !== 'change_label' &&
      selected_image_ids.length > 0 &&
      user?.id
    ) {
      reclassify(
        label_id,
        stringToNumber(mark_answer)!,
        selected_image_ids,
        user.id,
      )
    }

    let {
      yes_images,
      no_images,
      unknown_images,
      annotated_images,
      total_images,
    } = getImages({ label_id })
    let label = proxy.label[label_id]
    let label_text = `${label.title} (${annotated_images}/${total_images})`

    context.ws.send([
      'batch',
      [
        // update label option text
        [
          'update-text',
          `#label_select ion-select-option[value="${label_id}"]`,
          label_text,
        ],
        // update label preview text
        [
          'eval',
          `label_select.shadowRoot.querySelector('[part="text"]').textContent="${label_text}"`,
        ],
        //update yes images
        ['update-in', '#content-yes ion-row', nodeToVNode(yes_images, context)],
        //update no images
        ['update-in', '#content-no ion-row', nodeToVNode(no_images, context)],
        //update unknown images
        [
          'update-in',
          '#content-unknown ion-row',
          nodeToVNode(unknown_images, context),
        ],
      ],
    ])
  } catch (e) {
    console.error('SubmitReview error', e)
  }
  throw EarlyTerminate
}

let routes = {
  '/review-annotation': {
    resolve(context) {
      let t = evalLocale(pageTitle, context)
      return {
        title: title(t),
        description: 'TODO',
        node: page,
      }
    },
  },
  '/review-annotation/submit-review': {
    title: apiEndpointTitle,
    description: 'TODO',
    node: <SubmitReview />,
    streaming: false,
  },
} satisfies Routes

export default { routes }
