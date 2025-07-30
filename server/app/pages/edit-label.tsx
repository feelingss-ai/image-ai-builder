import { o } from '../jsx/jsx.js'
import { ajaxRoute, Routes } from '../routes.js'
import Style from '../components/style.js'
import { IonBackButton } from '../components/ion-back-button.js'
import { mapArray } from '../components/fragment.js'
import { Label, proxy } from '../../../db/proxy.js'
import { Locale, makeThrows, Title } from '../components/locale.js'
import {
  Context,
  DynamicContext,
  ExpressContext,
  getContextFormBody,
  WsContext,
} from '../context.js'
import { db, dbFile } from '../../../db/db.js'
import { getAuthUser, getAuthUserId } from '../auth/user.js'
import { IonButton } from '../components/ion-button.js'
import { EarlyTerminate, MessageException } from '../../exception.js'
import { showError } from '../components/error.js'
import { id, number, object, string } from 'cast.ts'
import { del, seedRow } from 'better-sqlite3-proxy'
import { Script } from '../components/script.js'
import { loadClientPlugin } from '../../client-plugin.js'
import { toRouteUrl } from '../../url.js'
import { count } from 'better-sqlite3-proxy'
import { ServerMessage } from '../../../client/types.js'
import { nodeToVNode } from '../jsx/vnode.js'
import { apiEndpointTitle } from '../../config.js'

let sweetAlertPlugin = loadClientPlugin({
  entryFile: 'dist/client/sweetalert.js',
})

let pageTitle = (
  <Locale en="Edit Class Label" zh_hk="修改類別標籤" zh_cn="修改类别标签" />
)

let style = Style(/* css */ `
#CreateLabel .field {
  margin-block-end: 1rem;
}
#CreateLabel .field label input {
  display: block;
  margin-block-start: 0.25rem;
}
#CreateLabel .field label .hint {
  display: block;
  margin-block-start: 0.25rem;
  color: #666;
  font-size: 0.875rem;
}

#CreateLabel .success-message {
  color: green;
  margin-block-start: 1rem;
  padding: 0.5rem;
  background: #f0fff0;
  border-radius: 0.25rem;
}
#CreateLabel .error-message {
  color: red;
  margin-block-start: 1rem;
  padding: 0.5rem;
  background: #fff0f0;
  border-radius: 0.25rem;
}
`)

let script = Script(/* js */ `
async function deleteLabel(event) {
  let item = event.target.closest('ion-item')
  let url = item.dataset.url
  let labelId = item.dataset.labelId
  let labelCount = +item.dataset.labelsCount
  console.log('label id', labelId)
  let labelTitle = item.querySelector('ion-label').textContent
  let message = 
    (labelCount > 0
      ? 'Label "{label}" is used by {count} images, are you sure to delete it?'
      : 'Are you sure to delete label "{label}"?')
    .replace("{label}", labelTitle)
    .replace("{count}", labelCount)
  let ans = await showConfirm({
    title: message,
    confirmButtonText: 'Delete',
    cancelButtonText: 'Cancel',
  })
  if (!ans) return
  await fetch_json(url)
}

// lol
async function renameLabel(event) {
  //console.log('renameLabel test')
 // console.log('event', event)
  let item = event.target.closest('ion-item')
  let url = item.dataset.url
  let labelId = item.dataset.labelId
  let labelTitle = item.querySelector('ion-label').textContent
  let newTitle = prompt('Enter new label title', labelTitle)
  console.log('label id ', labelId)
  console.log('label title ', labelTitle)
  console.log('new title ', newTitle)
  console.log('url ', url)
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
    <ion-content id="CreateLabel" class="ion-padding">
      <Main />
    </ion-content>
    {sweetAlertPlugin.node}
    {script}
  </>
)

function Main(attrs: {}, context: DynamicContext) {
  let user = getAuthUser(context)
  if (!user) {
    return (
      <>
        <div style="margin: auto; width: fit-content; text-align: center;">
          <p class="ion-padding ion-margin error">
            <Locale
              en="You must be logged in to create class labels"
              zh_hk="您必須登入才能創建類別標籤"
              zh_cn="您必须登录才能创建类别标签"
            />
          </p>
          <IonButton url="/login" color="primary">
            <Locale en="Login" zh_hk="登入" zh_cn="登录" />
          </IonButton>
        </div>
      </>
    )
  }

  // Debug: Log label data
  console.log('Labels in database:', proxy.label)
  console.log('Labels length:', proxy.label.length)

  return (
    <>
      <div class="ion-padding">
        <h2>
          <Locale
            en="Create New Class Label"
            zh_hk="創建新類別標籤"
            zh_cn="创建新类别标签"
          />
        </h2>

        <form
          method="POST"
          action={toRouteUrl(routes, '/api/label/create')}
          onsubmit="emitForm(event)"
        >
          <div class="field">
            <label>
              <Locale en="Label Title" zh_hk="標籤標題" zh_cn="标签标题" />
              *:
              <input
                name="title"
                required
                minlength="1"
                maxlength="100"
                // placeholder={
                //   <Locale
                //     en="Enter label title (e.g., 🦞, 🍜, Car, Person)"
                //     zh_hk="輸入標籤標題（例如：🦞、🍜、汽車、人物）"
                //     zh_cn="输入标签标题（例如：🦞、🍜、汽车、人物）"
                //   />
                // }
              />
              <p class="hint">
                <Locale
                  en="(1-100 characters, can include emojis)"
                  zh_hk="（1-100個字符，可包含表情符號）"
                  zh_cn="（1-100个字符，可包含表情符号）"
                />
              </p>
            </label>
          </div>

          <div class="ion-padding-top">
            <ion-button type="submit" color="primary" expand="block">
              <Locale en="Create Label" zh_hk="創建標籤" zh_cn="创建标签" />
            </ion-button>
          </div>
        </form>

        <div id="create-message"></div>

        <div class="ion-padding-top">
          <h3>
            <Locale en="Existing Labels" zh_hk="現有標籤" zh_cn="现有标签" />
          </h3>
          <ion-list id="labelList">
            {mapArray(
              proxy.label.filter(label => label && label.title),
              label => (
                <LabelItem label={label} />
              ),
            )}
          </ion-list>
          <div class="ion-padding">
            {proxy.label.length === 0 && (
              <p style="color: #666; text-align: center;">
                <Locale
                  en="No labels created yet"
                  zh_hk="尚未創建任何標籤"
                  zh_cn="尚未创建任何标签"
                />
              </p>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

function LabelItem(attrs: { label: Label }, context: Context) {
  let label = attrs.label
  let labelCount = count(proxy.image_label, {
    label_id: label.id!,
  })
  return (
    <ion-item data-label-id={label.id} data-label-count={labelCount}>
      <ion-input
        value={label.title}
        onchange="renameLabel(event)"
        data-url={toRouteUrl(routes, '/api/label/:id/rename', {
          params: { id: label.id! },
        })}
      />
      <ion-button
        color="danger"
        slot="end"
        onclick="deleteLabel(event)"
        data-url={toRouteUrl(routes, '/api/label/:id/delete', {
          params: { id: label.id! },
        })}
      >
        <ion-icon name="trash" slot="start"></ion-icon>
        <Locale en="Delete" zh_hk="刪除" zh_cn="删除" />
      </ion-button>
    </ion-item>
  )
}

let createLabelParser = object({
  title: string({ trim: true, nonEmpty: true }),
})

// Handles the form submission for creating a new label
function SubmitLabel(attrs: {}, context: WsContext) {
  try {
    let throws = makeThrows(context)
    let user_id = getAuthUserId(context)!
    if (!user_id)
      throws({
        en: 'You must be logged in to create labels',
        zh_hk: '您必須登入才能創建標籤',
        zh_cn: '您必须登录才能创建标签',
      })

    let body = getContextFormBody(context)
    let input = createLabelParser.parse(body)

    // Validate title length
    if (input.title.length > 100) {
      throws({
        en: 'Label title must be 100 characters or less',
        zh_hk: '標籤標題必須在100個字符以內',
        zh_cn: '标签标题必须在100个字符以内',
      })
    }

    // Check if label with same title already exists
    let existingLabel = proxy.label.find(
      label => label && label.title === input.title,
    )
    if (existingLabel) {
      throws({
        en: 'A label with this title already exists',
        zh_hk: '已存在具有此標題的標籤',
        zh_cn: '已存在具有此标题的标签',
      })
    }

    // Create the new label
    let newLabelId = seedRow(proxy.label, {
      title: input.title,
      dependency_id: null,
    })

    context.ws.send([
      'append',
      '#labelList',
      nodeToVNode(<LabelItem label={proxy.label[newLabelId]} />, context),
    ])

    console.log(
      `Created new label with ID: ${newLabelId}, title: ${input.title}`,
    )

    // Send success message to client
    context.ws.send([
      'update-text',
      '#create-message',
      'Label created successfully!',
    ])

    // Clear the form
    context.ws.send(['set-value', 'input[name="title"]', ''])

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

async function renameLabelById(context: ExpressContext) {
  let throws = makeThrows(context)

  let user_id = getAuthUserId(context)!
}

async function deleteLabelById(context: ExpressContext) {
  let throws = makeThrows(context)

  let user_id = getAuthUserId(context)!
  if (!user_id)
    throws({
      en: 'You must be logged in to delete labels',
      zh_hk: '您必須登入才能刪除標籤',
      zh_cn: '您必须登录才能删除标签',
    })

  let label_id = +context.routerMatch?.params.id
  if (!label_id)
    throws({
      en: 'Invalid label ID',
      zh_hk: '無效的標籤 ID',
      zh_cn: '无效的标签 ID',
    })

  let labelTitle = proxy.label[label_id]?.title

  db.transaction(() => {
    del(proxy.image_label, { label_id })
    delete proxy.label[label_id]
  })()

  let message: ServerMessage = [
    'batch',
    [
      ['eval', `showToast('Deleted label "${labelTitle}"', 'success')`],
      ['remove', `ion-item[data-label-id="${label_id}"]`],
    ],
  ]
  return { message }
}

// Handles the deletion of a label
function DeleteLabel(attrs: {}, context: WsContext) {
  try {
    let throws = makeThrows(context)
    let user_id = getAuthUserId(context)!
    if (!user_id)
      throws({
        en: 'You must be logged in to delete labels',
        zh_hk: '您必須登入才能刪除標籤',
        zh_cn: '您必须登录才能删除标签',
      })

    let body = getContextFormBody(context)
    let input = object({
      id: number({ min: 1 }),
    }).parse(body)

    // Find the label to delete
    let labelToDelete = proxy.label.find(
      label => label && label.id === input.id,
    )
    if (!labelToDelete) {
      throws({
        en: 'Label not found',
        zh_hk: '找不到標籤',
        zh_cn: '找不到标签',
      })
    }

    // Check if label is being used in any image labels
    let labelInUse = proxy.image_label?.some(
      imageLabel => imageLabel && imageLabel.label_id === input.id,
    )

    if (labelInUse) {
      throws({
        en: 'Cannot delete label that is being used in image annotations',
        zh_hk: '無法刪除正在圖像註釋中使用的標籤',
        zh_cn: '无法删除正在图像注释中使用的标签',
      })
    }

    // Delete the label
    let deletedLabel = proxy.label.find(label => label && label.id === input.id)
    if (deletedLabel) {
      // Remove from proxy
      let index = proxy.label.indexOf(deletedLabel)
      if (index > -1) {
        proxy.label.splice(index, 1)
      }
    }

    console.log(
      `Deleted label with ID: ${input.id}, title: ${deletedLabel?.title}`,
    )

    // Send success response using add-class and remove-class
    context.ws.send([
      'batch',
      [
        ['add-class', '#create-message', 'success-message'],
        ['remove-class', '#create-message', 'error-message'],
        [
          'update-text',
          '#create-message',
          `Label "${deletedLabel?.title}" deleted successfully!`,
        ],
      ],
    ])

    // Remove success class and reload after 2 seconds
    context.ws.send([
      'eval',
      `setTimeout(() => { 
        window.location.reload(); 
      }, 2000);`,
    ])

    // Terminate execution to prevent further processing
    throw EarlyTerminate
  } catch (error) {
    // Handle non-termination errors by logging and sending error message to client
    if (error !== EarlyTerminate) {
      console.error(error)
      context.ws.send([
        'batch',
        [
          ['add-class', '#create-message', 'error-message'],
          ['remove-class', '#create-message', 'success-message'],
          [
            'update-text',
            '#create-message',
            `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
          ],
        ],
      ])
    }
    // Ensure termination of the function
    throw EarlyTerminate
  }
}

let routes = {
  '/edit-label': {
    title: <Title t={pageTitle} />,
    description: 'Create new class labels for image annotation',
    menuText: <Locale en="Create Label" zh_hk="創建標籤" zh_cn="创建标签" />,
    node: page,
  },
  '/api/label/create': {
    title: apiEndpointTitle,
    description: 'Create new class label',
    node: <SubmitLabel />,
  },
  '/api/label/:id/rename': ajaxRoute({
    description: 'Rename class label by id',
    api: renameLabelById,
  }),
  '/api/label/:id/delete': ajaxRoute({
    description: 'Delete class label by id',
    api: deleteLabelById,
  }),
} satisfies Routes

export default { routes }
