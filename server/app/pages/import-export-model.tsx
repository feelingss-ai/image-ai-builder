import { o } from '../jsx/jsx.js'
import { Locale, ProjectPageTitle } from '../components/locale.js'
import { apiEndpointTitle } from '../../config.js'
import Style from '../components/style.js'
import { Script } from '../components/script.js'
import { Routes } from '../routes.js'
import { ajaxRoute } from '../api-route.js'
import {
  DynamicContext,
  ExpressContext,
  WsContext,
  getContextFormBody,
} from '../context.js'
import { getAuthUser, getAuthUserId } from '../auth/user.js'
import { ProjectPageBackButton } from '../components/project-page-back-button.js'
import { getContextProject } from '../context/project-context.js'
import { NoProjectMessage } from '../components/no-project-message.js'
import { filter } from 'better-sqlite3-proxy'
import { proxy } from '../../../db/proxy.js'
import { classifierModelCache } from '../model.js'
import { EarlyTerminate } from '../../exception.js'
import { showError } from '../components/error.js'
import { id, object } from 'cast.ts'
import { join } from 'path'
import { existsSync, mkdirSync, readdirSync, rmSync } from 'fs'
import AdmZip from 'adm-zip'
import { createUploadForm } from '../upload.js'

let pageTitle = (
  <Locale
    en="Import/Export Model"
    zh_hk="匯入/匯出模型"
    zh_cn="导入/导出模型"
  />
)

let style = Style(/* css */ `
#ImportExportModel .section {
  margin-bottom: 1.5rem;
}
#ImportExportModel .section-title {
  font-size: 1.1rem;
  font-weight: 600;
  margin-bottom: 0.75rem;
}
#ImportExportModel .label-list {
  margin-bottom: 1rem;
}
#ImportExportModel .label-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 0;
  border-bottom: 1px solid var(--ion-color-light, #eee);
}
#ImportExportModel .label-name {
  font-weight: 500;
}
#ImportExportModel .badge {
  display: inline-block;
  padding: 0.15rem 0.5rem;
  border-radius: 1rem;
  font-size: 0.75rem;
  margin-left: 0.4rem;
}
#ImportExportModel .badge--trained {
  background: var(--ion-color-success, #2dd36f);
  color: #fff;
}
#ImportExportModel .badge--untrained {
  background: var(--ion-color-medium, #92949c);
  color: #fff;
}
#ImportExportModel .actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
}
#ImportExportModel .file-input {
  display: none;
}
`)

let script = Script(/* javascript */ `
var importExportModel = {
  projectId: null,
  init: function (projectId) {
    this.projectId = projectId
    this.loadStatus()
    this.bindEvents()
  },
  bindEvents: function () {
    var exportBtn = document.getElementById('export-model-btn')
    if (exportBtn) exportBtn.addEventListener('click', this.exportModel.bind(this))

    var importInput = document.getElementById('import-model-input')
    if (importInput) importInput.addEventListener('change', this.importModel.bind(this))

    var importBtn = document.getElementById('import-model-btn')
    if (importBtn) importBtn.addEventListener('click', function () {
      var input = document.getElementById('import-model-input')
      if (input) input.click()
    })

    var deleteBtn = document.getElementById('delete-model-btn')
    if (deleteBtn) deleteBtn.addEventListener('click', this.deleteModel.bind(this))
  },
  loadStatus: function () {
    var self = this
    fetch('/import-export-model/model-status?project=' + this.projectId)
      .then(function (res) { return res.json() })
      .then(function (json) {
        if (json.error) { showError(json.error); return }
        self.renderStatus(json.labels)
      })
      .catch(function (err) { showError(String(err)) })
  },
  renderStatus: function (labels) {
    var container = document.getElementById('label-list')
    if (!container) return
    container.innerHTML = ''
    if (!labels || labels.length === 0) {
      container.innerHTML = '<p>No labels in this project.</p>'
      return
    }
    labels.forEach(function (label) {
      var item = document.createElement('div')
      item.className = 'label-item'
      var left = document.createElement('span')
      left.className = 'label-name'
      left.textContent = label.title
      var right = document.createElement('span')
      if (label.has_latest) {
        var b1 = document.createElement('span')
        b1.className = 'badge badge--trained'
        b1.textContent = 'latest'
        right.appendChild(b1)
      }
      if (label.has_best) {
        var b2 = document.createElement('span')
        b2.className = 'badge badge--trained'
        b2.textContent = 'best'
        right.appendChild(b2)
      }
      if (!label.has_latest && !label.has_best) {
        var b3 = document.createElement('span')
        b3.className = 'badge badge--untrained'
        b3.textContent = 'untrained'
        right.appendChild(b3)
      }
      item.appendChild(left)
      item.appendChild(right)
      container.appendChild(item)
    })
  },
  exportModel: function () {
    if (typeof showToast === 'function') showToast('Exporting model...', 'info')
    emit('/import-export-model/export-model', { project_id: this.projectId })
  },
  importModel: function (event) {
    var self = this
    var input = event.target
    var file = input.files && input.files[0]
    if (!file) return
    var formData = new FormData()
    formData.append('file', file)
    var btn = document.getElementById('import-model-btn')
    if (btn) btn.disabled = true
    fetch('/import-export-model/import-model?project=' + this.projectId, {
      method: 'POST',
      body: formData,
    })
      .then(function (res) { return res.json() })
      .then(function (json) {
        if (btn) btn.disabled = false
        if (json.error) { showError(json.error); return }
        var msg = 'Imported ' + (json.imported || 0) + ' label(s)'
        if (json.skipped && json.skipped > 0) msg += ', skipped ' + json.skipped
        if (typeof showToast === 'function') showToast(msg, 'success')
        self.loadStatus()
      })
      .catch(function (err) {
        if (btn) btn.disabled = false
        showError(String(err))
      })
    input.value = ''
  },
  deleteModel: function () {
    var self = this
    if (typeof showToast === 'function') showToast('Deleting models...', 'info')
    fetch('/import-export-model/delete-model?project=' + this.projectId, {
      method: 'POST',
    })
      .then(function (res) { return res.json() })
      .then(function (json) {
        if (json.error) { showError(json.error); return }
        var msg = 'Deleted ' + (json.deleted || 0) + ' model(s)'
        if (typeof showToast === 'function') showToast(msg, 'success')
        self.loadStatus()
      })
      .catch(function (err) { showError(String(err)) })
  },
}

window.importExportModel = importExportModel
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
    <Main />
    {script}
  </>
)

function Main(attrs: {}, context: DynamicContext) {
  let project = getContextProject(context)
  if (!project) return <NoProjectMessage />
  let project_id = project.id!
  let user = getAuthUser(context)
  if (!user) {
    return (
      <ion-content id="ImportExportModel" class="ion-padding">
        <div class="error ion-padding">
          <Locale en="Please login first" zh_hk="請先登入" zh_cn="请先登录" />
        </div>
      </ion-content>
    )
  }

  return (
    <ion-content id="ImportExportModel" class="ion-padding">
      <div class="section">
        <div class="section-title">
          <Locale en="Model Status" zh_hk="模型狀態" zh_cn="模型状态" />
        </div>
        <div id="label-list" class="label-list">
          <p>Loading...</p>
        </div>
      </div>

      <div class="section">
        <div class="section-title">
          <Locale en="Export Model" zh_hk="匯出模型" zh_cn="导出模型" />
        </div>
        <p>
          <Locale
            en="Download all trained models (latest + best) of this project as a zip file."
            zh_hk="將本專案所有已訓練模型（latest + best）下載為 zip 檔。"
            zh_cn="将本项目所有已训练模型（latest + best）下载为 zip 档。"
          />
        </p>
        <div class="actions">
          <ion-button id="export-model-btn" color="primary">
            <Locale en="Export as Zip" zh_hk="匯出為 Zip" zh_cn="导出为 Zip" />
          </ion-button>
        </div>
      </div>

      <div class="section">
        <div class="section-title">
          <Locale en="Import Model" zh_hk="匯入模型" zh_cn="导入模型" />
        </div>
        <p>
          <Locale
            en="Upload a model zip to restore models into this project. Labels are matched by title."
            zh_hk="上傳模型 zip 以還原模型至本專案，依標籤名稱配對。"
            zh_cn="上传模型 zip 以还原模型至本项目，依标签名称配对。"
          />
        </p>
        <input
          type="file"
          id="import-model-input"
          class="file-input"
          accept=".zip,application/zip"
        />
        <div class="actions">
          <ion-button id="import-model-btn" color="secondary">
            <Locale
              en="Upload Model Zip"
              zh_hk="上傳模型 Zip"
              zh_cn="上传模型 Zip"
            />
          </ion-button>
        </div>
      </div>

      <div class="section">
        <div class="section-title">
          <Locale en="Delete Model" zh_hk="刪除模型" zh_cn="删除模型" />
        </div>
        <p>
          <Locale
            en="Delete all imported/trained models (latest + best) of this project. This action cannot be undone."
            zh_hk="刪除本專案所有匯入/訓練的模型（latest + best）。此操作無法復原。"
            zh_cn="删除本项目所有导入/训练的模型（latest + best）。此操作无法复原。"
          />
        </p>
        <div class="actions">
          <ion-button id="delete-model-btn" color="danger">
            <Locale
              en="Delete All Models"
              zh_hk="刪除所有模型"
              zh_cn="删除所有模型"
            />
          </ion-button>
        </div>
      </div>

      {Script(`setTimeout(() => importExportModel.init(${project_id}), 0)`)}
    </ion-content>
  )
}

// ==================== Model Status ====================
function ModelStatus(context: ExpressContext) {
  let user_id = getAuthUserId(context)
  if (!user_id) throw 'Login required'

  let project_id_str = context.req.query.project
  if (typeof project_id_str !== 'string') throw 'project is required'
  let project_id = +project_id_str
  if (!project_id) throw 'invalid project id'

  let project = proxy.project[project_id]
  if (!project) throw 'Project not found'

  let labels = filter(proxy.label, { project_id })
  let result = labels.map(label => {
    let latest_dir = `saved_models/project-${project_id}/latest/label-${label.id}`
    let best_dir = `saved_models/project-${project_id}/best/label-${label.id}`
    return {
      id: label.id,
      title: label.title,
      has_latest: existsSync(latest_dir),
      has_best: existsSync(best_dir),
    }
  })

  return { labels: result }
}

// ==================== Export Model ====================
let exportModelParser = object({
  project_id: id(),
})

function ExportModel(attrs: {}, context: WsContext) {
  try {
    let user_id = getAuthUserId(context)!
    if (!user_id) throw 'Login required'

    let body = getContextFormBody(context)
    let input = exportModelParser.parse(body)
    let project = proxy.project[input.project_id]
    if (!project) throw 'Project not found'

    let project_id = input.project_id
    let labels = filter(proxy.label, { project_id })

    let zip = new AdmZip()
    let exportedCount = 0

    // metadata.json with label info
    let metadata = {
      project_id: project_id,
      labels: labels.map(label => ({
        id: label.id,
        title: label.title,
        dependency_id: label.dependency_id,
        display_order: label.display_order,
      })),
    }
    zip.addFile(
      'metadata.json',
      Buffer.from(JSON.stringify(metadata, null, 2), 'utf-8'),
    )

    // add latest models
    for (let label of labels) {
      if (label.id == null) continue
      let latest_dir = `saved_models/project-${project_id}/latest/label-${label.id}`
      if (existsSync(latest_dir)) {
        addDirToZip(zip, latest_dir, `latest/label-${label.id}`)
        exportedCount++
      }
    }

    // add best models
    for (let label of labels) {
      if (label.id == null) continue
      let best_dir = `saved_models/project-${project_id}/best/label-${label.id}`
      if (existsSync(best_dir)) {
        addDirToZip(zip, best_dir, `best/label-${label.id}`)
        exportedCount++
      }
    }

    if (exportedCount === 0) {
      context.ws.send(showError('No trained models found in this project'))
      throw EarlyTerminate
    }

    let zipBuffer = zip.toBuffer()
    let base64Zip = zipBuffer.toString('base64')

    context.ws.send([
      'eval',
      `
      var byteCharacters = atob('${base64Zip}');
      var byteNumbers = new Array(byteCharacters.length);
      for (var i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      var byteArray = new Uint8Array(byteNumbers);
      var blob = new Blob([byteArray], { type: 'application/zip' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'models_project-${project_id}_${new Date().toISOString()}.zip';
      a.click();
      URL.revokeObjectURL(url);
      var toast = document.createElement('ion-toast');
      toast.message = 'Exported ${exportedCount} model(s).';
      toast.duration = 5000;
      document.body.appendChild(toast);
      toast.present();
      `,
    ])
    throw EarlyTerminate
  } catch (error) {
    if (error !== EarlyTerminate) {
      console.error('ExportModel Error:', error)
      context.ws.send(showError(error))
    }
    throw EarlyTerminate
  }
}

function addDirToZip(zip: AdmZip, dirPath: string, zipPath: string) {
  let entries = readdirSync(dirPath, { withFileTypes: true })
  for (let entry of entries) {
    let fullPath = join(dirPath, entry.name)
    let entryZipPath = zipPath + '/' + entry.name
    if (entry.isDirectory()) {
      addDirToZip(zip, fullPath, entryZipPath)
    } else {
      zip.addLocalFile(fullPath, zipPath)
    }
  }
}

// ==================== Import Model ====================
async function ImportModel(context: ExpressContext) {
  let user_id = getAuthUserId(context)
  if (!user_id) throw 'Login required'

  let project_id_str = context.req.query.project
  if (typeof project_id_str !== 'string') throw 'project is required'
  let project_id = +project_id_str
  if (!project_id) throw 'invalid project id'

  let project = proxy.project[project_id]
  if (!project) throw 'Project not found'

  let form = createUploadForm({
    mimeTypeRegex: /^application\/zip$|^application\/x-zip-compressed$/,
    maxFileSize: 500 * 1024 * 1024,
    maxFiles: 1,
  })

  let [_fields, files] = await form.parse(context.req)
  let uploaded = files.file
  if (!uploaded) throw 'No file uploaded'
  let file = Array.isArray(uploaded) ? uploaded[0] : uploaded
  if (!file) throw 'No file uploaded'

  let zip = new AdmZip(file.filepath)
  let metadataEntry = zip.getEntry('metadata.json')
  if (!metadataEntry) throw 'Invalid model zip: missing metadata.json'

  let metadata = JSON.parse(metadataEntry.getData().toString('utf-8')) as {
    labels: Array<{ title: string; id: number }>
  }
  if (!metadata.labels || !Array.isArray(metadata.labels)) {
    throw 'Invalid metadata.json: labels array missing'
  }

  let projectLabels = filter(proxy.label, { project_id })
  let titleToLabel = new Map(
    projectLabels.map(label => [label.title, label] as const),
  )

  let imported = 0
  let skipped = 0

  for (let metaLabel of metadata.labels) {
    let label = titleToLabel.get(metaLabel.title)
    if (!label || label.id == null) {
      skipped++
      continue
    }

    // use source label id for zip path, target label id for dest dir
    let sourceLabelId = metaLabel.id
    // import latest
    let latestZipPath = `latest/label-${sourceLabelId}`
    let latestDir = `saved_models/project-${project_id}/latest/label-${label.id}`
    if (zip.getEntry(latestZipPath + '/model.json')) {
      if (existsSync(latestDir)) {
        rmSync(latestDir, { recursive: true, force: true })
      }
      mkdirSync(latestDir, { recursive: true })
      extractZipDir(zip, latestZipPath, latestDir)
      delete classifierModelCache[`project-${project_id}-${label.title}`]
      imported++
    }

    // import best
    let bestZipPath = `best/label-${sourceLabelId}`
    let bestDir = `saved_models/project-${project_id}/best/label-${label.id}`
    if (zip.getEntry(bestZipPath + '/model.json')) {
      if (existsSync(bestDir)) {
        rmSync(bestDir, { recursive: true, force: true })
      }
      mkdirSync(bestDir, { recursive: true })
      extractZipDir(zip, bestZipPath, bestDir)
      delete classifierModelCache[`project-${project_id}-${label.title}-best`]
    }
  }

  // cleanup uploaded temp file
  try {
    rmSync(file.filepath, { force: true })
  } catch {}

  return { success: true, imported, skipped }
}

function extractZipDir(zip: AdmZip, zipDir: string, destDir: string) {
  let entries = zip.getEntries()
  let prefix = zipDir + '/'
  for (let entry of entries) {
    if (!entry.entryName.startsWith(prefix)) continue
    if (entry.isDirectory) continue
    // extractEntryTo(entry, targetPath, maintainEntryPath=false, overwrite=true)
    zip.extractEntryTo(entry, destDir, false, true)
  }
}

// ==================== Delete Model ====================
function DeleteModel(context: ExpressContext) {
  let user_id = getAuthUserId(context)
  if (!user_id) throw 'Login required'

  let project_id_str = context.req.query.project
  if (typeof project_id_str !== 'string') throw 'project is required'
  let project_id = +project_id_str
  if (!project_id) throw 'invalid project id'

  let project = proxy.project[project_id]
  if (!project) throw 'Project not found'

  let labels = filter(proxy.label, { project_id })
  let deleted = 0

  for (let label of labels) {
    if (label.id == null) continue
    let latestDir = `saved_models/project-${project_id}/latest/label-${label.id}`
    let bestDir = `saved_models/project-${project_id}/best/label-${label.id}`
    if (existsSync(latestDir)) {
      rmSync(latestDir, { recursive: true, force: true })
      delete classifierModelCache[`project-${project_id}-${label.title}`]
      deleted++
    }
    if (existsSync(bestDir)) {
      rmSync(bestDir, { recursive: true, force: true })
      delete classifierModelCache[`project-${project_id}-${label.title}-best`]
    }
  }

  return { success: true, deleted }
}

let routes = {
  '/import-export-model': {
    title: <ProjectPageTitle t={pageTitle} />,
    description: (
      <Locale
        en="Import/Export model as zip"
        zh_hk="以 zip 格式匯入/匯出模型"
        zh_cn="以 zip 格式导入/导出模型"
      />
    ),
    node: page,
  },
  '/import-export-model/model-status': ajaxRoute({
    description: 'Get model training status for each label in a project',
    api: ModelStatus,
  }),
  '/import-export-model/export-model': {
    title: apiEndpointTitle,
    description: 'Export trained models as zip',
    node: <ExportModel />,
  },
  '/import-export-model/import-model': ajaxRoute({
    description: 'Import models from a zip file',
    api: ImportModel,
  }),
  '/import-export-model/delete-model': ajaxRoute({
    description: 'Delete all trained/imported models of a project',
    api: DeleteModel,
  }),
} satisfies Routes

export default { routes }
