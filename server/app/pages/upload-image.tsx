import { count, filter } from 'better-sqlite3-proxy'
import { o } from '../jsx/jsx.js'
import { ajaxRoute, Routes } from '../routes.js'
import { apiEndpointTitle, title } from '../../config.js'
import Style from '../components/style.js'
import {
  Context,
  DynamicContext,
  ExpressContext,
  getContextFormBody,
  throwIfInAPI,
} from '../context.js'
import { mapArray } from '../components/fragment.js'
import { IonBackButton } from '../components/ion-back-button.js'
import { IonButton } from '../components/ion-button.js'
import { object, string } from 'cast.ts'
import { Link, Redirect } from '../components/router.js'
import { renderError } from '../components/error.js'
import { getAuthUser, getAuthUserId } from '../auth/user.js'
import { Locale, ProjectPageTitle } from '../components/locale.js'
import { proxy, User } from '../../../db/proxy.js'
import { loadClientPlugin } from '../../client-plugin.js'
import { Script } from '../components/script.js'
import { createUploadForm } from '../upload.js'
import { del, find } from 'better-sqlite3-proxy'
import { createHash } from 'crypto'
import { readFileSync } from 'fs'
import { rm } from 'fs/promises'
import { join } from 'path'
import { env } from '../../env.js'
import { KB } from '@beenotung/tslib/size.js'
import { dataURItoFile } from '@beenotung/tslib/image.js'
import { writeFileSync } from 'fs'
import { randomUUID } from 'crypto'
import { getContextProject } from '../context/project-context.js'
import { NoProjectMessage } from '../components/no-project-message.js'
import { ProjectPageBackButton } from '../components/project-page-back-button.js'
import { render } from '@ionic/core/dist/types/stencil-public-runtime.js'

let ITEMS_PER_PAGE = 10
let PAGE_SIZE_OPTIONS = [10, 20, 50, 100]

let pageTitle = <Locale en="Upload Image" zh_hk="上傳圖片" zh_cn="上传图片" />
let addPageTitle = (
  <Locale
    en="Add Upload Image"
    zh_hk="添加Upload Image"
    zh_cn="添加Upload Image"
  />
)

let style = Style(/* css */ `
#UploadImage #imageList {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 1rem;
}
#UploadImage #imageList.single-column {
  grid-template-columns: 1fr;
}
#UploadImage #imageList .image-item {
  text-align: center;
  position: relative;
  background-color: white;
  padding: 0.5rem;
  border-radius: 0.5rem;
  max-width: 100%;
}
#UploadImage #imageList .image-item img {
  max-width: 250px;
  max-height: 250px;
  width: 250px;
  height: 250px;
  object-fit: contain;
}
#UploadImage #imageList .image-item--buttons {
  position: absolute;
  top: 0;
  right: 0
}
#UploadImage #imageList .image-item--filename {
}
#UploadImage #pagination {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  justify-content: center;
  margin-block: 1rem;
}
#UploadImage #pagination .page-btn {
  min-width: 2.5rem;
}
#UploadImage #pagination .page-btn.active {
  font-weight: bold;
}
#UploadImage #pagination .page-ellipsis {
  align-self: center;
  padding-inline: 0.25rem;
}
#UploadImage #pagination .page-jump {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  margin-inline-start: 0.5rem;
}
#UploadImage #pagination .page-jump input {
  width: 4.5rem;
  padding: 0.25rem 0.5rem;
  border: 1px solid #ccc;
  border-radius: 0.25rem;
  font-size: 0.9rem;
}
`)

let imagePlugin = loadClientPlugin({
  entryFile: 'dist/client/image.js',
})
let sweetAlertPlugin = loadClientPlugin({
  entryFile: 'dist/client/sweetalert.js',
})

let script = Script(/* js */ `
var imageItemTemplate = document.querySelector('#imageList .image-item')
imageItemTemplate.remove()

async function pickImage(event) {
  try {
  let form = event.target.closest('form')
  let project_id = form.dataset.projectId
  let files = await selectImage({
    accept: '.jpg,.png,.webp,.heic,.gif',
    multiple: true,
  })
  for (let _file of files) {
    // TODO skip compression, or at least keep the same resolution
    let { dataUrl, file } = await compressImageFile(_file)
    let imageItem = imageItemTemplate.cloneNode(true)
    let image = imageItem.querySelector('img')
    image.src = dataUrl
    image.file = file
    imageItem.querySelector('.image-item--filename').textContent = file.name
    imageList.appendChild(imageItem)
    let uploadButton = imageItem.querySelector('.image-item--upload')
    uploadButton.setAttribute('color', 'primary')
    uploadButton.removeAttribute('disabled')
  }
  let buttons = imageList.querySelectorAll('.image-item--upload[color="primary"]')
  for (let button of buttons) {
    let imageItem = button.closest('.image-item')
    let image = imageItem.querySelector('img')
    let file = image.file
    if (!file) continue
    let formData = new FormData()
    formData.append('image', file)
    let res = await fetch('/upload-image/submit?project=' + project_id, {
      method: 'POST',
      body: formData,
    })
    let json = await res.json()
    if (json.error) {
      showError(json.error)
      return
    }
    if (json.duplicate) {
      if (typeof showToast === 'function') showToast('Duplicate image skipped', 'info')
      imageItem.remove()
    } else {
      let url = json.url
      image.src = url
      button.setAttribute('color', 'success')
    }
    imageCount.textContent = json.count.toLocaleString()
  }
  // Reload to update pagination
  location.reload()
  } catch (error) {
    showError(error)
  }
}

async function removeImage(button) {
  if (button.disabled) return
  button.disabled = true
  let form = button.closest('form')
  let project_id = form.dataset.projectId
  let imageItem = button.closest('.image-item')
  let image = imageItem.querySelector('img')
  let url = image.getAttribute('src')
  if (url.startsWith('/uploads/')) {
    let filename = url.slice('/uploads/'.length)
    let params = new URLSearchParams({ filename, project: project_id })
    let json = await fetch_json('/upload-image/remove?' + params)
    if (json.error) {
      button.disabled = false
      return
    }
    imageCount.textContent = json.count.toLocaleString()
  }
  imageItem.remove()
  // Reload to update pagination
  location.reload()
}

async function removeAllImages(event) {
  if (event.target.disabled) return
  let form = event.target.closest('form')
  let project_id = (form && form.dataset.projectId) || new URLSearchParams(window.location.search).get('project')
  if (!project_id) { showError('Missing project'); return }
  let isConfirmed
  if (typeof showConfirm === 'function') {
    isConfirmed = await showConfirm({
      title: 'Delete all images?',
      text: 'This cannot be undone. All images and their labels will be removed.',
      icon: 'warning',
      confirmButtonText: 'Delete all',
      cancelButtonText: 'Cancel',
    })
  } else {
    isConfirmed = confirm('Delete all images? This cannot be undone. All images and their labels will be removed.')
  }
  if (!isConfirmed) return
  event.target.disabled = true
  let json = await fetch_json('/upload-image/remove-all?project=' + project_id)
  if (json.error) {
    showError(json.error)
    event.target.disabled = false
    return
  }
  let list = document.getElementById('imageList')
  if (list) {
    list.querySelectorAll('.image-item').forEach(el => el.remove())
  }
  let countEl = document.getElementById('imageCount')
  if (countEl) countEl.textContent = '0'
  if (typeof showToast === 'function') showToast('All images deleted', 'success')
  event.target.disabled = false
  location.reload()
}

function changePage(delta) {
  let params = new URLSearchParams(window.location.search)
  let currentPage = parseInt(params.get('page') || '1', 10)
  let newPage = currentPage + delta
  if (newPage < 1) return
  params.set('page', String(newPage))
  let newUrl = window.location.pathname + '?' + params.toString()
  window.location.href = newUrl
}

function changePageTo(page) {
  let params = new URLSearchParams(window.location.search)
  params.set('page', String(page))
  let newUrl = window.location.pathname + '?' + params.toString()
  window.location.href = newUrl
}

function toggleLayout() {
  let params = new URLSearchParams(window.location.search)
  let currentLayout = params.get('layout')
  if (currentLayout === 'single') {
    params.delete('layout')
  } else {
    params.set('layout', 'single')
  }
  let newUrl = window.location.pathname + (params.toString() ? '?' + params.toString() : '')
  window.location.href = newUrl
}

function changePerPage(size) {
  let params = new URLSearchParams(window.location.search)
  params.set('per_page', String(size))
  params.set('page', '1') // reset to first page
  let newUrl = window.location.pathname + '?' + params.toString()
  window.location.href = newUrl
}

function goToPage() {
  let input = document.getElementById('pageJumpInput')
  if (!input) return
  let page = parseInt(input.value, 10)
  if (!page || page < 1) return
  changePageTo(page)
}

`)

let page = (
  <>
    {style}
    <ion-header>
      <ion-toolbar>
        <ProjectPageBackButton />
        <ion-title role="heading" aria-level="1">
          <ProjectPageTitle t={pageTitle} short />
        </ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content id="UploadImage" class="ion-padding">
      <Main />
    </ion-content>
    {imagePlugin.node}
    {sweetAlertPlugin.node}
    {script}
  </>
)

let items = [
  { title: 'Android', slug: 'md' },
  { title: 'iOS', slug: 'ios' },
]

// Returns a list of page numbers to show, with '...' as ellipsis markers.
// e.g. for 10 pages, current=1 -> [1,2,3,4,'...',7,8,9,10]
function getPageNumbers(
  currentPage: number,
  totalPages: number,
): (number | '...')[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1)
  }
  let pages: (number | '...')[] = []
  let start = Math.max(1, currentPage - 1)
  let end = Math.min(totalPages, currentPage + 1)
  if (start > 2) {
    pages.push(1, 2)
    if (start > 3) pages.push('...')
  } else {
    start = 1
  }
  for (let i = start; i <= end; i++) pages.push(i)
  if (end < totalPages - 1) {
    if (end < totalPages - 2) pages.push('...')
    pages.push(totalPages - 1, totalPages)
  }
  return pages
}

function Main(attrs: {}, context: DynamicContext) {
  let user = getAuthUser(context)
  let project = getContextProject(context)
  if (!project) return <NoProjectMessage />
  let project_id = project.id!
  let allImages = filter(proxy.image, { project_id })
  let totalImages = allImages.length

  let params = new URLSearchParams(context.routerMatch?.search || '')
  let itemsPerPage = PAGE_SIZE_OPTIONS.includes(
    parseInt(params.get('per_page') || '10', 10),
  )
    ? parseInt(params.get('per_page') || '10', 10)
    : ITEMS_PER_PAGE
  let totalPages = Math.max(1, Math.ceil(totalImages / itemsPerPage))
  let currentPage = Math.min(
    Math.max(1, parseInt(params.get('page') || '1', 10) || 1),
    totalPages,
  )
  let layout = params.get('layout') === 'single' ? 'single' : 'multi'
  let startIndex = (currentPage - 1) * itemsPerPage
  let pageImages = allImages.slice(startIndex, startIndex + itemsPerPage)

  return (
    <>
      <div style="margin-bottom: 0.5rem; text-align: center">
        Showing <span id="imageCount">{totalImages}</span> images (Page{' '}
        {currentPage} of {totalPages}){' '}
        <span style="margin-inline-start: 0.5rem">
          {mapArray(PAGE_SIZE_OPTIONS, size => (
            <ion-button
              size="small"
              fill={itemsPerPage === size ? 'solid' : 'outline'}
              color={itemsPerPage === size ? 'primary' : 'medium'}
              onclick={`changePerPage(${size})`}
              style="margin-inline-end: 0.25rem"
            >
              {size}
            </ion-button>
          ))}
        </span>
        <ion-button
          onclick="toggleLayout()"
          size="small"
          fill="clear"
          style="margin-inline-start: 0.5rem"
        >
          <ion-icon
            name={layout === 'multi' ? 'grid' : 'list'}
            slot="icon-only"
          ></ion-icon>
        </ion-button>
      </div>
      <form style="text-align: center" data-project-id={project_id}>
        <ion-button onclick="pickImage(event)" disabled={!user}>
          <ion-icon name="cloud-upload" slot="start"></ion-icon> Upload Photos
        </ion-button>
        {!user ? (
          <IonButton url="/login">
            <ion-icon name="log-in-outline" slot="start"></ion-icon> Login
          </IonButton>
        ) : null}
        {totalImages > 0 && user ? (
          <div style="display: block; margin-top: 0.5rem">
            <ion-button
              color="danger"
              fill="outline"
              onclick="removeAllImages(event)"
            >
              <ion-icon name="trash" slot="start"></ion-icon>
              <Locale
                en="Delete all images"
                zh_hk="刪除全部圖片"
                zh_cn="删除全部图片"
              />
            </ion-button>
          </div>
        ) : null}
        <div id="imageList" class={layout === 'single' ? 'single-column' : ''}>
          <ImageItem
            image_url="https://picsum.photos/seed/1/200/300"
            filename="filename.jpg"
            user={user}
          />
          {mapArray(pageImages, image => {
            return (
              <ImageItem
                image_url={`/uploads/${image.filename}`}
                filename={image.original_filename || image.filename}
                user={user}
              />
            )
          })}
        </div>
        {totalPages > 1 ? (
          <div id="pagination">
            <ion-button
              class="page-btn prev-btn"
              onclick="changePage(-1)"
              disabled={currentPage <= 1}
              size="small"
            >
              <ion-icon name="chevron-back" slot="icon-only"></ion-icon>
            </ion-button>
            {mapArray(getPageNumbers(currentPage, totalPages), pageNum =>
              pageNum === '...' ? (
                <span class="page-ellipsis">…</span>
              ) : (
                <ion-button
                  class={
                    'page-btn' + (pageNum === currentPage ? ' active' : '')
                  }
                  onclick={`changePageTo(${pageNum})`}
                  color={pageNum === currentPage ? 'primary' : 'medium'}
                  size="small"
                >
                  {pageNum}
                </ion-button>
              ),
            )}
            <ion-button
              class="page-btn next-btn"
              onclick="changePage(1)"
              disabled={currentPage >= totalPages}
              size="small"
            >
              <ion-icon name="chevron-forward" slot="icon-only"></ion-icon>
            </ion-button>
            <span class="page-jump">
              <input
                id="pageJumpInput"
                type="number"
                min="1"
                max={totalPages}
                placeholder="Go to"
                onkeydown="if(event.key==='Enter')goToPage()"
              />
              <ion-button size="small" onclick="goToPage()">
                Go
              </ion-button>
            </span>
          </div>
        ) : null}
      </form>
    </>
  )
}

function ImageItem(attrs: {
  image_url: string
  filename: string
  user: User | null
}) {
  return (
    <div class="image-item">
      <div class="image-item--buttons">
        <ion-button color="success" disabled class="image-item--upload">
          <ion-icon name="cloud-upload-outline" slot="icon-only"></ion-icon>
        </ion-button>
        {attrs.user ? (
          <ion-button color="danger" onclick="removeImage(this)">
            <ion-icon name="trash" slot="icon-only"></ion-icon>
          </ion-button>
        ) : (
          <IonButton color="danger" url="/login">
            <ion-icon name="trash" slot="icon-only"></ion-icon>
          </IonButton>
        )}
      </div>
      <img src={attrs.image_url} />
      <div class="image-item--filename">{attrs.filename}</div>
    </div>
  )
}

let addPageStyle = Style(/* css */ `
#AddUploadImage .hint {
  margin-inline-start: 1rem;
  margin-block: 0.25rem;
}
`)

function AddPage(attrs: {}, context: DynamicContext) {
  let user = getAuthUser(context)
  if (!user) return <Redirect href="/login" />
  return (
    <>
      {addPageStyle}
      <ion-header>
        <ion-toolbar>
          <IonBackButton href="/upload-image" backText={pageTitle} />
          <ion-title role="heading" aria-level="1">
            {addPageTitle}
          </ion-title>
        </ion-toolbar>
      </ion-header>
      <ion-content id="AddUploadImage" class="ion-padding">
        <form
          method="POST"
          action="/upload-image/add/submit?project=${project_id}"
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
    return <Redirect href={`/upload-image/result?id=${id}`} />
  } catch (error) {
    throwIfInAPI(error, '#add-message', context)
    return (
      <Redirect
        href={
          '/upload-image/result?' +
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
          <IonBackButton href="/upload-image/add" backText="Form" />
          <ion-title role="heading" aria-level="1">
            Submitted {pageTitle}
          </ion-title>
        </ion-toolbar>
      </ion-header>
      <ion-content id="AddUploadImage" class="ion-padding">
        {error ? (
          renderError(error, context)
        ) : (
          <>
            <p>Your submission is received (#{id}).</p>
            <Link href="/upload-image" tagName="ion-button">
              Back to {pageTitle}
            </Link>
          </>
        )}
      </ion-content>
    </>
  )
}

async function UploadImage(context: ExpressContext) {
  let { req, res } = context
  try {
    let user_id = getAuthUserId(context)
    if (!user_id) throw 'not login'

    let params = new URLSearchParams(context.routerMatch?.search)
    let project_id = +params.get('project')!
    if (!project_id) throw 'missing project id in url'

    let form = createUploadForm({ maxFileSize: 500 * KB })
    let [fields, files] = await form.parse(req)
    let uploadDir = env.UPLOAD_DIR
    for (let file of files.image || []) {
      let filePath = join(uploadDir, file.newFilename)
      let contentHash: string
      try {
        let buf = readFileSync(filePath)
        contentHash = createHash('sha256').update(buf).digest('hex')
      } catch {
        contentHash = ''
      }
      let existing =
        contentHash &&
        filter(proxy.image, { project_id, content_hash: contentHash })[0]
      if (existing) {
        await rm(filePath, { force: true })
        let new_count = count(proxy.image, { project_id })
        res.json({
          url: '/uploads/' + existing.filename,
          count: new_count,
          image_id: existing.id,
          duplicate: true,
        })
        return
      }
      let image_id = proxy.image.push({
        original_filename: file.originalFilename || null,
        filename: file.newFilename,
        user_id,
        rotation: null,
        project_id,
        content_hash: contentHash || null,
      }) as number
      let new_count = count(proxy.image, { project_id })
      let url = '/uploads/' + file.newFilename
      res.json({ url, count: new_count, image_id })
      return
    }
    res.json({})
  } catch (error) {
    res.json({ error: String(error) })
  }
}

async function RemoveImage(context: ExpressContext) {
  let { req, res } = context
  try {
    let filename = req.query.filename
    if (typeof filename !== 'string') throw 'filename is required'

    let project_id = +req.query.project!
    if (!project_id) throw 'missing project id in query'

    let image = find(proxy.image, { filename })
    if (image) {
      // Delete related records in the correct order (child tables first)
      // Delete bounding box confirmations
      del(proxy.image_bounding_box_confirmation, { image_id: image.id! })

      // Delete bounding boxes
      del(proxy.image_bounding_box, { image_id: image.id! })

      // Delete image labels
      del(proxy.image_label, { image_id: image.id! })

      // Finally delete the image
      del(proxy.image, { filename })
    }
    let file = join(env.UPLOAD_DIR, filename)
    await rm(file, { force: true })
    let new_count = count(proxy.image, { project_id })
    res.json({ count: new_count })
  } catch (error) {
    console.error(error)
    res.json({ error: String(error) })
  }
}

async function RemoveAllImages(context: ExpressContext) {
  let { req, res } = context
  try {
    let user_id = getAuthUserId(context)
    if (!user_id) throw 'not login'
    let { project } = req.query
    if (typeof project !== 'string') throw 'project is required'
    let project_id = +project
    if (!project_id) throw 'invalid project id'
    let images = filter(proxy.image, { project_id })
    let uploadDir = env.UPLOAD_DIR || ''
    for (let image of images) {
      del(proxy.image_label, { image_id: image.id! })
      del(proxy.image_bounding_box, { image_id: image.id! })
      del(proxy.image_bounding_box_confirmation, { image_id: image.id! })
      del(proxy.image, { filename: image.filename })
      if (uploadDir && image.filename) {
        let file = join(uploadDir, image.filename)
        await rm(file, { force: true })
      }
    }
    res.json({ count: 0 })
  } catch (error) {
    console.error(error)
    res.json({ error: String(error) })
  }
}

let routes = {
  '/upload-image': {
    title: <ProjectPageTitle t={pageTitle} />,
    description: 'TODO',
    node: page,
  },
  '/upload-image/submit': ajaxRoute({
    description: 'upload image',
    api: UploadImage,
  }),
  '/upload-image/remove': ajaxRoute({
    description: 'remove image',
    api: RemoveImage,
  }),
  '/upload-image/remove-all': ajaxRoute({
    description: 'remove all images in project',
    api: RemoveAllImages,
  }),
} satisfies Routes

export default { routes }
