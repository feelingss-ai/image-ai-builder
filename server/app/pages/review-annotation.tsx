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
import { object, string } from 'cast.ts'
import { Link, Redirect } from '../components/router.js'
import { renderError } from '../components/error.js'
import { getAuthUser } from '../auth/user.js'
import { evalLocale, Locale } from '../components/locale.js'
import { proxy } from '../../../db/proxy.js'
import { db } from '../../../db/db.js'

let pageTitle = (
  <Locale en="Review Annotation" zh_hk="審視標註" zh_cn="审阅标注" />
)
let addPageTitle = (
  <Locale
    en="Add Review Annotation"
    zh_hk="添加審視標註"
    zh_cn="添加审阅标注"
  />
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
  // let image = select_next_image.get({ label_id })
  let total_images = proxy.image.length
  // let count = has_previous_annotation.get({ label_id }) as number
  // let has_undo = count > 0

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
      <br />
      <ion-segment>
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
    </>
  )
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
} satisfies Routes

export default { routes }
