import { o } from '../jsx/jsx.js'
import { ajaxRoute, Routes } from '../routes.js'
import { apiEndpointTitle } from '../../config.js'
import Style from '../components/style.js'
import { seedRow } from 'better-sqlite3-proxy'
import {
  DynamicContext,
  ExpressContext,
  getContextFormBody,
  WsContext,
} from '../context.js'
import { mapArray } from '../components/fragment.js'
import { IonBackButton } from '../components/ion-back-button.js'
import { id, number, object, values, optional } from 'cast.ts'
import { showError } from '../components/error.js'
import { getAuthUser, getAuthUserId } from '../auth/user.js'
import { Locale, makeThrows, Title } from '../components/locale.js'
import { proxy } from '../../../db/proxy.js'
import { db } from '../../../db/db.js'
import { Script } from '../components/script.js'
import { loadClientPlugin } from '../../client-plugin.js'
import { EarlyTerminate } from '../../exception.js'
import { IonButton } from '../components/ion-button.js'

let sweetAlertPlugin = loadClientPlugin({
  entryFile: 'dist/client/sweetalert.js',
})
let imagePlugin = loadClientPlugin({
  entryFile: 'dist/client/image.js',
})

let pageTitle = <Locale en="Annotate Image" zh_hk="標註圖片" zh_cn="注释图像" />

let style = Style(/* css */ `
#AnnotateImage .control-buttons ion-button {
  flex-grow: 1;
  margin: 0;
  height: 4rem;
}
`)

let script = Script(/* js */ `
//for getting URL query parameters
function getQueryParam(name) {
  const urlParams = new URLSearchParams(window.location.search)
  return urlParams.get(name)
}

// Loads the last state
function loadLastState() {
  const urlLabelId = getQueryParam('label')
  const urlImageId = getQueryParam('image')
  let labelId = urlLabelId && !isNaN(Number(urlLabelId)) ? Number(urlLabelId) : 1;
  let imageId = urlImageId && !isNaN(Number(urlImageId)) ? Number(urlImageId) : 1;

  if (!proxy.label[labelId]) {
    labelId = Object.keys(proxy.label)[0] || 1
  }

  const labelSelect = document.getElementById('label_select')
  if (labelSelect) {
    labelSelect.value = labelId
    labelSelect.dispatchEvent(new CustomEvent('ionChange', { detail: { value: labelId } }))
  }
  emit('/annotate-image/showImage', {
    label_id: labelId,
    image_id: imageId,
  })
}

// Displays the next image for annotation based on selected label
function showImage(){
  const labelId = label_select.value;
  const imageId = getQueryParam('image') || '1'
  emit('/annotate-image/showImage', {
    label_id: labelId,
    image_id: imageId && !isNaN(Number(imageId)) ? Number(imageId) : 1,
  })
}

// Submits an image annotation and updates the UI with new count
function submitAnnotation(answer) {
  let image = document.getElementById('label_image')
  let image_id = image.dataset.imageId
  let rotation = image.dataset.rotation || 0
  let label_id = document.getElementById('label_select').value
  emit('/annotate-image/submit', {
    label: label_id,
    image: image_id,
    answer,
    rotation,
  })
}

// Sends undo annotation request
function undoAnnotation() {
  let label_id = document.getElementById('label_select')?.value;
  emit('/annotate-image/undo', { label_id })
}

function rotateAnnotationImage(image) {
  let degree = image.dataset.rotation || 0
  degree = (degree + 90) % 360
  image.dataset.rotation = degree
  rotateImageInline(image)
}

function initAnnotationImage(image) {
  let degree = +image.dataset.rotation || 0
  function check() {
    if (!degree) {
      image.onload = null
      return
    }
    degree -= 90
    rotateImageInline(image)
    image.onload = check
  }
  check()
}

label_select.addEventListener('ionChange', function(event) {
  const labelId = event.detail.value;
  const imageId = getQueryParam('image') || '1';

  emit('/annotate-image/showImage', {
    label_id: labelId,
    image_id: imageId && !isNaN(Number(imageId)) ? Number(imageId) : 1,
  })
})

// Save state before leaving the page
window.addEventListener('beforeunload', function() {
  const labelId = document.getElementById('label_select')?.value;
  const imageId = document.getElementById('label_image')?.dataset.imageId;
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
    <ion-content id="AnnotateImage" class="ion-no-padding">
      <Main />
    </ion-content>
    {imagePlugin.node}
    {sweetAlertPlugin.node}
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

let has_previous_annotation = db
  .prepare<{ label_id: number }, number>(
    /* sql */ `
select count(*) from image_label where label_id = :label_id
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
              en="You must be logged in to annotate images"
              zh_hk="您必須登入才能標註圖片"
              zh_cn="您必须登录才能标注图像"
            />
          </p>
          <IonButton url="/login" color="primary">
            <Locale en="Login" zh_hk="登入" zh_cn="登录" />
          </IonButton>
        </div>
      </>
    )
  }
  let params = new URLSearchParams(context.routerMatch?.search)
  let label_id = +params.get('label')! || 1
  let image_id = +params.get('image')! || undefined
  let fromReview = params.get('from') === 'review'
  let image
  if (image_id) {
    image = db
      .prepare<
        { id: number; label_id: number },
        { id: number; filename: string; rotation: number | null }
      >(
        /* sql */ `
      select id, filename, rotation
      from image
      where id = :id
    `,
      )
      .get({ id: image_id, label_id })
  }

  if (!image) {
    image = select_next_image.get({ label_id })
  }
  let total_images = proxy.image.length
  let count = has_previous_annotation.get({ label_id }) as number
  let has_undo = fromReview ? false : count > 0

  //loadLastState
  const loadScript = Script(/* js */ `
    (function() {
      loadLastState()
    })()
  `)

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
        <div style="flex-grow: 1; overflow: hidden">
          <img
            data-image-id={image?.id}
            data-rotation={image?.rotation || 0}
            id="label_image"
            src={image ? `/Uploads/${image.filename}` : ''}
            alt={
              <Locale
                en="Loading image..."
                zh_hk="載入圖片中..."
                zh_cn="加载图像中..."
              />
            }
            style="height: 100%; object-fit: contain"
            onclick="rotateAnnotationImage(this)"
            onload="initAnnotationImage(this)"
            hidden={!image}
          />
          <div
            id="no-image-message"
            style="display: flex; align-items: center; justify-content: center; height: 100%; text-align: center; padding: 2rem;"
            hidden={!!image}
          >
            <div>
              <ion-icon
                name="checkmark-circle"
                style="font-size: 4rem; color: var(--ion-color-success);"
              ></ion-icon>
              <h2>
                <Locale
                  en="All images annotated!"
                  zh_hk="所有圖片已標註完成！"
                  zh_cn="所有图像已注释完成！"
                />
              </h2>
              <p>
                <Locale
                  en="You have completed annotating all images for this label."
                  zh_hk="您已完成此標籤的所有圖片標註。"
                  zh_cn="您已完成此标签的所有图像注释。"
                />
              </p>
              <p>
                <Locale
                  en="Please select another label to continue."
                  zh_hk="請選擇另一個標籤繼續。"
                  zh_cn="请选择另一个标签继续。"
                />
              </p>
            </div>
          </div>
        </div>
        <div style="display: flex;" class="control-buttons">
          <ion-button
            id="btn_submit_reject"
            size="large"
            color="danger"
            onclick="submitAnnotation(0)"
            title={
              <Locale
                en="Annotate as not having the label"
                zh_hk="標註為沒有標籤"
                zh_cn="标注为没有标签"
              />
            }
            disabled={!image}
          >
            <ion-icon name="close" slot="icon-only"></ion-icon>
          </ion-button>
          <ion-button
            id="btn_undo"
            size="large"
            color="warning"
            onclick="undoAnnotation()"
            title={<Locale en="Undo" zh_hk="還原" zh_cn="还原" />}
            disabled={!has_undo}
          >
            <ion-icon name="arrow-undo" slot="icon-only"></ion-icon>
          </ion-button>
          <ion-button
            id="btn_submit_agree"
            size="large"
            color="success"
            onclick="submitAnnotation(1)"
            title={
              <Locale
                en="Annotate as having the label"
                zh_hk="標註為有標籤"
                zh_cn="标注为有标签"
              />
            }
            disabled={!image}
          >
            <ion-icon name="checkmark" slot="icon-only"></ion-icon>
          </ion-button>
        </div>
      </div>
      {loadScript}
    </>
  )
}

let select_next_image = db.prepare<
  { label_id: number },
  { id: number; filename: string; rotation: number | null }
>(/* sql */ `
select image.id, image.filename, image.rotation
from image
where id not in (
  select image_id from image_label
  where label_id = :label_id
)
`)

// Fetches the next unannotated image for a given label and user
async function getNextImage(context: ExpressContext) {
  let { req } = context
  try {
    let user = getAuthUser(context)
    if (!user) throw 'You must be logged in to annotate image'
    let label_id = +req.query.label!
    if (!label_id) throw 'missing label'
    let image = select_next_image.get({ label_id })
    return { image }
  } catch (error) {
    return { error: String(error) }
  }
}

// Selects the last image_label for the current user (for undo)
let select_previous_image_label = db.prepare<
  { user_id: number; label_id: number },
  { id: number; image_id: number }
>(/* sql */ `
select id, image_id
from image_label
where user_id = :user_id and label_id = :label_id
order by created_at desc, id desc
limit 1
`)

let showImageParser = object({
  label_id: id(),
  image_id: optional(number()),
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
    let image_id = input.image_id
    console.log(
      `ShowImage: Processing label_id=${label_id}, user_id=${user_id}, image_id=${image_id}`,
    )

    let image
    let annotated_count = count_annotated_images.get({ label_id })
    if (annotated_count === 0 && (!image_id || image_id !== 1)) {
      image_id = 1
    }
    if (image_id != null) {
      image = db
        .prepare<
          { id: number; label_id: number },
          { id: number; filename: string; rotation: number | null }
        >(
          /* sql */ `
        select id, filename, rotation
        from image
        where id = :id
        and id not in (
          select image_id from image_label
          where label_id = :label_id
        )
      `,
        )
        .get({ id: image_id, label_id })
    }

    if (!image) {
      image = select_next_image.get({ label_id })
    }
    console.log(`ShowImage: Selected image for label_id:${label_id}`, image)

    if (!image) {
      context.ws.send([
        'update-attrs',
        '#label_image',
        {
          'src': '',
          'data-image-id': null,
          'data-rotation': 0,
          'hidden': true,
        },
      ])
      context.ws.send(['update-attrs', '#no-image-message', { hidden: false }])
      context.ws.send(['update-attrs', '#btn_submit_agree', { disabled: true }])
      context.ws.send([
        'update-attrs',
        '#btn_submit_reject',
        { disabled: true },
      ])
      context.ws.send(['update-attrs', '#btn_undo', { disabled: true }])
      context.ws.send([
        'update-attrs',
        '#btn_submit_reject',
        { disabled: true },
      ])
    } else {
      context.ws.send([
        'update-attrs',
        '#label_image',
        {
          'src': `/Uploads/${image.filename}`,
          'data-image-id': image.id,
          'data-rotation': image.rotation || 0,
          'hidden': false,
        },
      ])
      context.ws.send(['update-attrs', '#no-image-message', { hidden: true }])
      context.ws.send([
        'update-attrs',
        '#btn_submit_agree',
        { disabled: false },
      ])
      context.ws.send([
        'update-attrs',
        '#btn_submit_reject',
        { disabled: false },
      ])
      context.ws.send([
        'update-attrs',
        '#btn_undo',
        {
          disabled: !select_previous_image_label.get({ user_id, label_id }),
        },
      ])
      context.ws.send([
        'eval',
        `document.getElementById('label_image').onload = () => initAnnotationImage(document.getElementById('label_image'));`,
      ])
    }

    let last_annotation = select_previous_image_label.get({
      user_id,
      label_id,
    })
    context.ws.send([
      'update-attrs',
      '#btn_undo',
      { disabled: !last_annotation },
    ])

    throw EarlyTerminate
  } catch (error) {
    if (error !== EarlyTerminate) {
      console.error(error)
      context.ws.send(showError(error))
    }
    throw EarlyTerminate
  }
}

let undoAnnotationParser = object({
  label_id: id(),
})

function UndoAnnotation(attrs: {}, context: WsContext) {
  try {
    let throws = makeThrows(context)
    let user_id = getAuthUserId(context)!
    if (!user_id)
      throws({
        en: 'You must be logged in to undo annotation',
        zh_hk: '您必須登入才能還原標註',
        zh_cn: '您必须登录才能还原标注',
      })

    let body = getContextFormBody(context)
    let input = undoAnnotationParser.parse(body)
    let label_id = input.label_id

    // Query the database for the most recent annotation for the label and user
    let last_annotation = select_previous_image_label.get({ user_id, label_id })
    if (!last_annotation) {
      // if no previous image > disable undo button
      context.ws.send(['update-attrs', '#btn_undo', { disabled: true }])
      throws({
        en: 'No previous annotation to undo',
        zh_hk: '沒有之前的標註可以還原',
        zh_cn: '没有之前的标注可以还原',
      })
    }

    // Retrieve the image associated with the last annotation
    let image = proxy.image[last_annotation!.image_id]
    delete proxy.image_label[last_annotation!.id]
    console.log(`UndoAnnotation: Deleted image_label id=${last_annotation!.id}`)

    // Calculate the updated count of annotated images
    let new_count = count_annotated_images.get({ label_id })
    console.log(`UndoAnnotation: new_count=${new_count}, label_id=${label_id}`)
    let total_images = proxy.image.length
    let label = proxy.label[label_id]
    if (!label) throw 'Label not found'
    let newText = `${label.title} (${new_count}/${total_images})`
    context.ws.send([
      'update-text',
      `#label_select ion-select-option[value="${label_id}"]`,
      newText,
    ])

    context.ws.send([
      'batch',
      [
        // Update image element attributes to show the previously annotated image
        [
          'update-attrs',
          '#label_image',
          {
            'src': `/uploads/${image.filename}`,
            'data-image-id': image.id,
            'data-rotation': image.rotation || 0,
            'hidden': false,
          },
        ],
        ['update-attrs', '#no-image-message', { hidden: true }],
        ['update-attrs', '#btn_submit_agree', { disabled: false }],
        ['update-attrs', '#btn_submit_reject', { disabled: false }],
      ],
    ])

    let new_last_annotation = select_previous_image_label.get({
      user_id,
      label_id,
    })
    context.ws.send([
      'update-attrs',
      '#btn_undo',
      { disabled: !new_last_annotation },
    ])

    context.ws.send([
      'eval',
      `label_image.onload = () => initAnnotationImage(label_image)`,
    ])

    throw EarlyTerminate
  } catch (error) {
    if (error !== EarlyTerminate) {
      console.error(error)
      context.ws.send(showError(error))
    }
    throw EarlyTerminate
  }
}

let submitAnnotationParser = object({
  args: object({
    0: object({
      label: id(),
      image: id(),
      answer: values([0, 1]),
      rotation: number(),
    }),
  }),
})

// Submits an image annotation and updates the UI with the new count
function SubmitAnnotation(attrs: {}, context: WsContext) {
  try {
    let user = getAuthUser(context)
    if (!user) throw 'You must be logged in to annotate image'

    let {
      args: { 0: input },
    } = submitAnnotationParser.parse(context)
    let label = proxy.label[input.label]
    let image = proxy.image[input.image]

    if (!label) throw 'label not found'
    if (!image) throw 'image not found'

    // Update image rotation if changed
    if (image.rotation !== input.rotation) {
      image.rotation = input.rotation
    }

    seedRow(
      proxy.image_label,
      {
        label_id: label.id!,
        image_id: image.id!,
        user_id: user.id!,
      },
      {
        answer: +input.answer,
      },
    )

    // Calculate the updated count of annotated images
    let new_count = count_annotated_images.get({
      label_id: input.label,
    })
    console.log(
      `SubmitAnnotation: new_count=${new_count}, label_id=${input.label}`,
    )
    let total_images = proxy.image.length
    // Construct new text for the label select option
    let newText = `${label.title} (${new_count}/${total_images})`
    context.ws.send([
      'update-text',
      `#label_select ion-select-option[value="${input.label}"]`,
      newText,
    ])

    let next_image = select_next_image.get({
      label_id: input.label,
    })
    context.ws.send([
      'batch',
      [
        [
          'update-attrs',
          '#label_image',
          {
            'src': next_image ? `/Uploads/${next_image.filename}` : '',
            'data-image-id': next_image ? next_image.id : '',
            'data-rotation': next_image ? next_image.rotation || 0 : 0,
            'hidden': !next_image,
          },
        ],
        ['update-attrs', '#no-image-message', { hidden: !!next_image }],
        ['update-attrs', '#btn_submit_agree', { disabled: !next_image }],
        ['update-attrs', '#btn_submit_reject', { disabled: !next_image }],
        ['update-attrs', '#btn_undo', { disabled: false }],
      ],
    ])

    // Set up client-side image rotation on load if an image is available
    if (next_image) {
      context.ws.send([
        'eval',
        `label_image.onload = () => initAnnotationImage(label_image)`,
      ])
    }

    throw EarlyTerminate
  } catch (error) {
    if (error !== EarlyTerminate) {
      console.error(error)
      context.ws.send(showError(error))
    }
    throw EarlyTerminate
  }
}

let routes = {
  '/annotate-image': {
    title: <Title t={pageTitle} />,
    description: 'TODO',
    node: page,
  },
  '/annotate-image/image': ajaxRoute({
    description: 'get next image to be annotated',
    api: getNextImage,
  }),
  '/annotate-image/submit': {
    title: apiEndpointTitle,
    description: 'submit image annotation',
    node: <SubmitAnnotation />,
  },
  '/annotate-image/undo': {
    title: apiEndpointTitle,
    description: 'undo image annotation',
    node: <UndoAnnotation />,
  },
  '/annotate-image/showImage': {
    title: apiEndpointTitle,
    description: 'show image for selected label',
    node: <ShowImage />,
  },
} satisfies Routes

export default { routes }
