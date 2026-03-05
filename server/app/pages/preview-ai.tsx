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

let pageTitle = <Locale en="Preview AI" zh_hk="預覽 AI" zh_cn="预览 AI" />
let addPageTitle = (
  <Locale en="Add Preview AI" zh_hk="添加預覽 AI" zh_cn="添加预览 AI" />
)

let style = Style(/* css */ `
#PreviewAI .label-container {
  background-color: #fff9;
  padding: 0.25rem;
  border-radius: 0.25rem;
}
#PreviewAI .label-container progress {
  width: 5rem;
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
    <ion-content id="PreviewAI" class="ion-no-padding">
      <Main />
    </ion-content>
  </>
)

let items = [
  { title: 'Android', slug: 'md' },
  { title: 'iOS', slug: 'ios' },
]

function Main(attrs: {}, context: Context) {
  let user = getAuthUser(context)
  return (
    <>
      <div style="position: relative;">
        <div style="position: absolute; right: 0; top: 0; display: flex; flex-direction: column; gap: 0.25rem;">
          {mapArray(
            [...proxy.label].sort(
              (a, b) => (a.display_order ?? 999999) - (b.display_order ?? 999999)
            ),
            label => (
            <div class="label-container">
              <div class="class-label">{label.title}</div>
              <progress value="10" max="100"></progress>
            </div>
          )
          )}
        </div>
        <img
          src="https://picsum.photos/seed/2/3000/4000"
          style="height: 100%"
        />
      </div>
    </>
  )
}

let addPage = (
  <>
    {Style(/* css */ `
#AddPreviewAI .hint {
  margin-inline-start: 1rem;
  margin-block: 0.25rem;
}
`)}
    <ion-header>
      <ion-toolbar>
        <IonBackButton href="/preview-ai" backText={pageTitle} />
        <ion-title role="heading" aria-level="1">
          {addPageTitle}
        </ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content id="AddPreviewAI" class="ion-padding">
      <form
        method="POST"
        action="/preview-ai/add/submit"
        onsubmit="emitForm(event)"
      >
        <ion-list>
          <ion-item>
            <ion-input
              name="title"
              label="Title*:"
              label-placement="floating"
              required
              minlength="3"
              maxlength="50"
            />
          </ion-item>
          <p class="hint">(3-50 characters)</p>
          <ion-item>
            <ion-input
              name="slug"
              label="Slug*: (unique url)"
              label-placement="floating"
              required
              pattern="(\w|-|\.){1,32}"
            />
          </ion-item>
          <p class="hint">
            (1-32 characters of: <code>a-z A-Z 0-9 - _ .</code>)
          </p>
        </ion-list>
        <div style="margin-inline-start: 1rem">
          <ion-button type="submit">Submit</ion-button>
        </div>
        <p>
          Remark:
          <br />
          *: mandatory fields
        </p>
        <p id="add-message"></p>
      </form>
    </ion-content>
  </>
)

function AddPage(attrs: {}, context: DynamicContext) {
  let user = getAuthUser(context)
  if (!user) return <Redirect href="/login" />
  return addPage
}

let submitParser = object({
  title: string({ minLength: 3, maxLength: 50 }),
  slug: string({ match: /^[\w-]{1,32}$/ }),
})

function Submit(attrs: {}, context: DynamicContext) {
  try {
    let user = getAuthUser(context)
    if (!user) throw 'You must be logged in to submit ' + pageTitle
    let body = getContextFormBody(context)
    let input = submitParser.parse(body)
    let id = items.push({
      title: input.title,
      slug: input.slug,
    })
    return <Redirect href={`/preview-ai/result?id=${id}`} />
  } catch (error) {
    throwIfInAPI(error, '#add-message', context)
    return (
      <Redirect
        href={
          '/preview-ai/result?' + new URLSearchParams({ error: String(error) })
        }
      />
    )
  }
}

function SubmitResult(attrs: {}, context: DynamicContext) {
  let params = new URLSearchParams(context.routerMatch?.search)
  let error = params.get('error')
  let id = params.get('id')
  return (
    <>
      <ion-header>
        <ion-toolbar>
          <IonBackButton href="/preview-ai/add" backText="Form" />
          <ion-title role="heading" aria-level="1">
            Submitted {pageTitle}
          </ion-title>
        </ion-toolbar>
      </ion-header>
      <ion-content id="AddPreviewAI" class="ion-padding">
        {error ? (
          renderError(error, context)
        ) : (
          <>
            <p>Your submission is received (#{id}).</p>
            <Link href="/preview-ai" tagName="ion-button">
              Back to {pageTitle}
            </Link>
          </>
        )}
      </ion-content>
    </>
  )
}

let routes = {
  '/preview-ai': {
    resolve(context) {
      let t = evalLocale(pageTitle, context)
      return {
        title: title(t),
        description: 'TODO',
        node: page,
      }
    },
  },
  '/preview-ai/add': {
    title: title(addPageTitle),
    description: 'TODO',
    node: <AddPage />,
    streaming: false,
  },
  '/preview-ai/add/submit': {
    title: apiEndpointTitle,
    description: 'TODO',
    node: <Submit />,
    streaming: false,
  },
  '/preview-ai/result': {
    title: apiEndpointTitle,
    description: 'TODO',
    node: <SubmitResult />,
    streaming: false,
  },
} satisfies Routes

export default { routes }
