import { o } from '../jsx/jsx.js'
import { Routes } from '../routes.js'
import { apiEndpointTitle } from '../../config.js'
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
import { Locale, Title } from '../components/locale.js'
import { IonButton } from '../components/ion-button.js'
import { proxy } from '../../../db/proxy.js'
import { Script } from '../components/script.js'

let pageTitle = (
  <Locale
    en="Manage Dataset Demo"
    zh_hk="Manage Dataset Demo"
    zh_cn="Manage Dataset Demo"
  />
)
let addPageTitle = (
  <Locale
    en="Add Manage Dataset Demo"
    zh_hk="添加Manage Dataset Demo"
    zh_cn="添加Manage Dataset Demo"
  />
)

let style = Style(/* css */ `
#ManageDataset {

}

.image-list {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
}

.image-item {
  position: relative;
  overflow: hidden;
  border-radius: 0.5rem;
  cursor: pointer;
  background-color: var(--ion-color-primary);
}

.image-item ion-thumbnail {
  --size: 10rem;
  transition: transform 0.1s ease;
}

#ManageDataset[data-display-mode='select']
.image-item.selected ion-thumbnail {
  transform: scale(0.9);
  outline: 0.25rem solid var(--ion-color-light);
  border-radius: 0.25rem;
}

.image-checkbox {
  position: absolute;
  top: 0;
  left: 0;
  margin: 0.5rem;
}

#ManageDataset[data-display-mode='view'] .image-item ion-checkbox {
  display: none;
}

ion-footer {
  border-top: 1px solid var(--ion-color-light);
  display: flex;
  justify-content: space-around;
}

ion-footer ion-button {
}
`)

let script = Script(/* js */ `
function switchDisplayMode(mode) {
  ManageDataset.dataset.displayMode = mode
  selectModeButton.hidden = mode === 'select'
  viewModeButton.hidden = mode === 'view'
  if (mode != 'select') {
    selectAllButton.hidden = true
    deselectAllButton.hidden = true
  } else {
    let selected = hasAnySelected()
    selectAllButton.hidden = selected
    deselectAllButton.hidden = !selected
  }
}

function hasAnySelected() {
  let item = document.querySelector('.image-item.selected')
  return !!item
}

function selectAll() {
  let items = document.querySelectorAll('.image-item')
  for (let item of items) {
    let checkbox = item.querySelector('.image-checkbox')
    checkbox.checked = true
    item.classList.add('selected')
  }
  deselectAllButton.hidden = false
  selectAllButton.hidden = true
}

function deselectAll() {
  let items = document.querySelectorAll('.image-item.selected')
  for (let item of items) {
    let checkbox = item.querySelector('.image-checkbox')
    checkbox.checked = false
    item.classList.remove('selected')
  }
  deselectAllButton.hidden = true
  selectAllButton.hidden = false
}

function toggleImage(image) {
  let mode = ManageDataset.dataset.displayMode
  if (mode != 'select') {
    return
  }
  let item = image.closest('.image-item')
  let checkbox = item.querySelector('.image-checkbox')
  checkbox.checked = !checkbox.checked
  if (checkbox.checked) {
    item.classList.add('selected')
  } else {
    item.classList.remove('selected')
  }

  let selected = hasAnySelected()
  selectAllButton.hidden = selected
  deselectAllButton.hidden = !selected
}
`)

let page = (
  <>
    {style}
    <ion-header>
      <ion-toolbar>
        <IonBackButton href="/app/home" backText="Home" />
        <ion-title role="heading" aria-level="1">
          {pageTitle}
        </ion-title>
      </ion-toolbar>
      <div class="ion-padding-horizontal" style="display: flex">
        <ion-button id="selectModeButton" onclick="switchDisplayMode('select')">
          <Locale en="Select" zh_hk="選擇" zh_cn="选择" />
        </ion-button>
        <ion-button
          id="viewModeButton"
          onclick="switchDisplayMode('view')"
          hidden
        >
          <Locale en="View" zh_hk="查看" zh_cn="查看" />
        </ion-button>
        <ion-button id="selectAllButton" onclick="selectAll()" hidden>
          <Locale en="Select All" zh_hk="全選" zh_cn="全选" />
        </ion-button>
        <ion-button id="deselectAllButton" onclick="deselectAll()" hidden>
          <Locale en="Deselect All" zh_hk="取消全選" zh_cn="取消全选" />
        </ion-button>
        <div style="flex-grow: 1"></div>
        <ion-button>
          <Locale en="Labels" zh_hk="標籤" zh_cn="标签" />
        </ion-button>
      </div>
    </ion-header>
    <ion-content
      id="ManageDataset"
      class="ion-padding"
      data-display-mode="view"
    >
      <Main />
    </ion-content>
    <ion-footer>
      <ion-button size="large" color="warning" fill="clear">
        <ion-icon name="close-circle" slot="start"></ion-icon>
        <Locale en="Unlabel" zh_hk="取消標籤" zh_cn="取消标签" />
      </ion-button>
      <ion-button size="large" color="danger" fill="clear">
        <ion-icon name="trash" slot="start"></ion-icon>
        <Locale en="Delete" zh_hk="刪除" zh_cn="删除" />
      </ion-button>
      <ion-button size="large" color="primary" fill="clear">
        <ion-icon name="download" slot="start"></ion-icon>
        <Locale en="Export" zh_hk="匯出" zh_cn="导出" />
      </ion-button>
    </ion-footer>
    {script}
  </>
)

let items = [
  { title: 'Android', slug: 'md' },
  { title: 'iOS', slug: 'ios' },
]

function Main(attrs: {}, context: Context) {
  let user = getAuthUser(context)
  if (!user) {
    return (
      <div style="margin: auto; width: fit-content; text-align: center;">
        <p class="ion-padding ion-margin error">
          <Locale
            en="You must be logged in to manage dataset"
            zh_hk="您必須登入才能管理數據集"
            zh_cn="您必须登录才能管理数据集"
          />
        </p>
        <IonButton url="/login" color="primary">
          <Locale en="Login" zh_hk="登入" zh_cn="登录" />
        </IonButton>
      </div>
    )
  }
  let images = proxy.image
  return (
    <>
      <div className="image-list">
        {mapArray(images, image => (
          <div class="image-item">
            <ion-checkbox class="image-checkbox" />
            <ion-thumbnail onclick="toggleImage(this)">
              <img src={`/uploads/${image.filename}`} alt={image.filename} />
            </ion-thumbnail>
          </div>
        ))}
      </div>
    </>
  )
  return (
    <>
      <ion-list>
        {mapArray(items, item => (
          <ion-item>
            {item.title} ({item.slug})
          </ion-item>
        ))}
      </ion-list>
      {user ? (
        <Link href="/manage-dataset-demo/add" tagName="ion-button">
          {addPageTitle}
        </Link>
      ) : (
        <p>
          You can add manage dataset demo after{' '}
          <Link href="/register">register</Link>.
        </p>
      )}
    </>
  )
}

let addPage = (
  <>
    {Style(/* css */ `
#AddManageDatasetDemo .hint {
  margin-inline-start: 1rem;
  margin-block: 0.25rem;
}
`)}
    <ion-header>
      <ion-toolbar>
        <IonBackButton href="/manage-dataset-demo" backText={pageTitle} />
        <ion-title role="heading" aria-level="1">
          {addPageTitle}
        </ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content id="AddManageDatasetDemo" class="ion-padding">
      <form
        method="POST"
        action="/manage-dataset-demo/add/submit"
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
    return <Redirect href={`/manage-dataset-demo/result?id=${id}`} />
  } catch (error) {
    throwIfInAPI(error, '#add-message', context)
    return (
      <Redirect
        href={
          '/manage-dataset-demo/result?' +
          new URLSearchParams({ error: String(error) })
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
          <IonBackButton href="/manage-dataset-demo/add" backText="Form" />
          <ion-title role="heading" aria-level="1">
            Submitted {pageTitle}
          </ion-title>
        </ion-toolbar>
      </ion-header>
      <ion-content id="AddManageDatasetDemo" class="ion-padding">
        {error ? (
          renderError(error, context)
        ) : (
          <>
            <p>Your submission is received (#{id}).</p>
            <Link href="/manage-dataset-demo" tagName="ion-button">
              Back to {pageTitle}
            </Link>
          </>
        )}
      </ion-content>
    </>
  )
}

let routes = {
  '/manage-dataset-demo': {
    title: <Title t={pageTitle} />,
    description: 'TODO',
    node: page,
  },
  '/manage-dataset-demo/add': {
    title: <Title t={addPageTitle} />,
    description: 'TODO',
    node: <AddPage />,
    streaming: false,
  },
  '/manage-dataset-demo/add/submit': {
    title: apiEndpointTitle,
    description: 'TODO',
    node: <Submit />,
    streaming: false,
  },
  '/manage-dataset-demo/result': {
    title: apiEndpointTitle,
    description: 'TODO',
    node: <SubmitResult />,
    streaming: false,
  },
} satisfies Routes

export default { routes }
