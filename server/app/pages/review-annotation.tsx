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
import { int, object, string, values } from 'cast.ts'
import { Link, Redirect } from '../components/router.js'
import { renderError } from '../components/error.js'
import { getAuthUser } from '../auth/user.js'
import { evalLocale, Locale } from '../components/locale.js'
import { proxy } from '../../../db/proxy.js'
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

  // let image = select_next_image.get({ label_id })
  let total_images = proxy.image.length
  // let count = has_previous_annotation.get({ label_id }) as number
  // let has_undo = count > 0

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
      <ion-input
        name="label_id"
        value={+params.get('label')! || 1}
        style="display: none;"
        id="label_id_input"
      />
      <br />
      <ion-segment value={answer} id="answer">
        <ion-segment-button value="yes" content-id="yes" class="segment-yes">
          <ion-icon name="checkmark"></ion-icon>
        </ion-segment-button>
        <ion-segment-button value="no" content-id="no" class="segment-no">
          <ion-icon name="close"></ion-icon>
        </ion-segment-button>
        <ion-segment-button
          value="unknown"
          content-id="unknown"
          className="segment-unknown"
        >
          <ion-icon name="help"></ion-icon>
        </ion-segment-button>
      </ion-segment>
      <br />
      <ion-segment-view>
        <ion-segment-content id="yes">Yes</ion-segment-content>
        <ion-segment-content id="no">No</ion-segment-content>
        <ion-segment-content id="unknown">Unknown</ion-segment-content>
      </ion-segment-view>
      <ion-input
        name="answer"
        value={params.get('answer')! || 'yes'}
        style="display: none;"
        id="answer_input"
      />
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
    // let code = ''
    // broadcast(['eval', code])
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
