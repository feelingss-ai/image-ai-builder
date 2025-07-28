import { o } from '../jsx/jsx.js'
import { Routes } from '../routes.js'
import { apiEndpointTitle, title } from '../../config.js'
import Style from '../components/style.js'
import {
  Context,
  DynamicContext,
  getContextFormBody,
  throwIfInAPI,
} from '../context.js'
import { mapArray } from '../components/fragment.js'
import { IonBackButton } from '../components/ion-back-button.js'
import { int, object, string, url, values } from 'cast.ts'
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
.segment-yes, .segment-no, .segment-unknown {
  border-radius: 1rem;
  margin: 0 0.5rem;
  padding: 0.5rem 0;
  font-size: 1.2rem;
}

.image-item img {
  width: 100%;
  height: 100px;
  object-fit: contain;
  padding: 0.5rem;
}

`)

let script = Script(/* js */ `

label_select = document.querySelector('#label_select');
answer_segment = document.querySelector('#answer');

// submit form when label_select or answer_segment is changed
label_select.addEventListener('ionChange', (event) => {
  const labelId = event.detail.value;
  document.getElementById('label_id_input').value = labelId;

  // Update URL with new label parameter
  const url = new URL(window.location);
  url.searchParams.set('label', labelId);
  window.history.pushState({}, '', url);

  document.getElementById('submit').click();
})

answer_segment.addEventListener('ionChange', (event) => {
  const answer = event.detail.value;
  document.getElementById('answer_input').value = answer;

  const url = new URL(window.location);
  url.searchParams.set('answer', answer);
  window.history.pushState({}, '', url);

  document.getElementById('submit').click();
})

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

// get image ids by label id and answer it returns an array of image ids like [1,2,3]
let get_image_by_label_id_answer = db
  .prepare<{ label_id: number; answer: number | undefined }, number[]>(
    /* sql */ `
select image_id
from image_label 
where label_id = :label_id and answer = :answer
`,
  )
  .pluck()

let get_total_images = db
  .prepare<{}, number[]>(
    /* sql */ `
select distinct id
from image
`,
  )
  .pluck()

let get_image_filename_by_id = db.prepare<
  { id: number },
  { filename: string; original_filename: string }
>(/* sql */ `
select filename, original_filename
from image
where id = :id
`)

// it receives an array of image ids and returns an array of filenames like
// [{filename: '/uploads/834ee161-74e2-4919-b716-43c1361f6b09.jpeg', original_filename: '1.jpeg'}]
function get_image_filename_by_id_array(
  ids: number[],
): { filename: string; original_filename: string }[] {
  let filenames = []
  for (let id of ids) {
    let filename = get_image_filename_by_id.get({ id })
    if (filename) {
      filenames.push({
        filename: '/uploads/' + filename.filename,
        original_filename: filename.original_filename,
      })
    }
  }
  return filenames
}

// it receives an image url and filename and returns a div with the image and the filename
function ImageItem(attrs: {
  image_url: string
  filename: string
  user: User | null
}) {
  return (
    <ion-item class="image-item-container">
      <ion-checkbox></ion-checkbox>
      <div class="image-item">
        <img src={attrs.image_url} />
        <div class="image-item--filename" style="text-align: center;">
          {attrs.filename}
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

  let yes = get_image_by_label_id_answer.all({
    label_id,
    answer: stringToNumber('yes'),
  })

  let no = get_image_by_label_id_answer.all({
    label_id,
    answer: stringToNumber('no'),
  })

  //unknown images are the images that are not in yes or no
  let total = get_total_images.all({})
  let unknown = total.filter(id => !yes.includes(id) && !no.includes(id))

  return (
    <form
      method="POST"
      action={toRouteUrl(routes, '/review-annotation/submit-review')}
      onsubmit="emitForm(event)"
    >
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
      {/* this is a hidden input that is used to store the label id */}
      <ion-input
        name="label_id"
        value={+params.get('label')! || 1}
        style="display: none;"
        id="label_id_input"
      />
      <br />
      <ion-segment value={answer} id="answer">
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
            <ion-row>
              {mapArray(
                get_image_filename_by_id_array(yes.flat()),
                filename => {
                  return (
                    <ion-col size="4">
                      <ImageItem
                        image_url={filename.filename}
                        filename={filename.original_filename}
                        user={user}
                      />
                    </ion-col>
                  )
                },
              )}
            </ion-row>
          </ion-grid>
        </ion-segment-content>
        <ion-segment-content id="content-no">
          <ion-grid fixed>
            <ion-row>
              {mapArray(get_image_filename_by_id_array(no.flat()), filename => {
                return (
                  <ion-col size="4">
                    <ImageItem
                      image_url={filename.filename}
                      filename={filename.original_filename}
                      user={user}
                    />
                  </ion-col>
                )
              })}
            </ion-row>
          </ion-grid>
        </ion-segment-content>
        <ion-segment-content id="content-unknown">
          <ion-grid fixed>
            <ion-row>
              {mapArray(
                get_image_filename_by_id_array(unknown.flat()),
                filename => {
                  return (
                    <ion-col size="4">
                      <ImageItem
                        image_url={filename.filename}
                        filename={filename.original_filename}
                        user={user}
                      />
                    </ion-col>
                  )
                },
              )}
            </ion-row>
          </ion-grid>
        </ion-segment-content>
      </ion-segment-view>
      {/* this is a hidden input that is used to store the answer */}
      <ion-input
        name="answer"
        value={params.get('answer')! || 'yes'}
        style="display: none;"
        id="answer_input"
      />
      {/* this is a hidden input that is used to submit the form */}
      <ion-button type="submit" id="submit" style="display: none;" />
    </form>
  )
}

let submitReviewParser = object({
  label_id: int(),
  answer: values(['yes' as const, 'no' as const, 'unknown' as const]),
})

function SubmitReview(attrs: {}, context: DynamicContext) {
  try {
    console.log('SubmitReview')
    let user = getAuthUser(context)
    let body = getContextFormBody(context)
    let input = submitReviewParser.parse(body)
    let label_id = input.label_id
    let answer = input.answer
    console.log('label_id', label_id)
    console.log('answer', answer)
    let image_ids = get_image_by_label_id_answer.all({
      label_id,
      answer: stringToNumber(answer),
    })

    let image_filenames = get_image_filename_by_id_array(image_ids.flat())

    let yes = get_image_by_label_id_answer.all({
      label_id,
      answer: stringToNumber('yes'),
    })
    let no = get_image_by_label_id_answer.all({
      label_id,
      answer: stringToNumber('no'),
    })
    let unknown = get_total_images
      .all({})
      .filter(id => !yes.includes(id) && !no.includes(id))

    let unknown_filenames = get_image_filename_by_id_array(unknown.flat())

    let code = /* javascript */ `
      let image_ids = ${JSON.stringify(image_ids)}
      let answer = ${JSON.stringify(answer)}
      let image_filenames = ${JSON.stringify(image_filenames)}

      try {

        // get the content of the answer segment
        const content = document.getElementById('content-${answer}');
        const grid = content.querySelector('ion-grid');
        const row = grid.querySelector('ion-row');
        // clear the row
        row.innerHTML = '';

        if (content.id == 'content-unknown') { 
          image_filenames = ${JSON.stringify(unknown_filenames)}
        }
        
        // it receives an array of filenames and returns a div with the image and the filename (written in javascript)
        image_filenames.forEach(image => {

        const col = document.createElement('ion-col');
        col.size = '4';

        const item = document.createElement('ion-item');
        item.className = 'image-item-container';

        const checkbox = document.createElement('ion-checkbox');
         
        const div = document.createElement('div');
        div.className = 'image-item';
        
        const img = document.createElement('img');
        img.src = image.filename;
        
        const filenameDiv = document.createElement('div');
        filenameDiv.className = 'image-item--filename';
        filenameDiv.textContent = image.original_filename;
        filenameDiv.style.textAlign = 'center';
        
        div.appendChild(img);
        div.appendChild(filenameDiv);
        item.appendChild(checkbox);
        item.appendChild(div);
        col.appendChild(item);
        row.appendChild(col);
        })
      } catch (e) {
          console.error('SubmitReview error', e)
      }
    `

    broadcast(['eval', code])
  } catch (e) {
    console.error('SubmitReview error', e)
  }
  throw EarlyTerminate
}

function broadcast(message: ServerMessage) {
  sessions.forEach(session => {
    if (session.url?.startsWith('/review-annotation')) {
      session.ws.send(message)
    }
  })
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
