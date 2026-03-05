import { o } from '../jsx/jsx.js'
import { filter, find, seedRow } from 'better-sqlite3-proxy'
import { ajaxRoute, Routes } from '../routes.js'
import { title } from '../../config.js'
import Style from '../components/style.js'
import {
  DynamicContext,
  ExpressContext,
  getContextFormBody,
} from '../context.js'
import { mapArray } from '../components/fragment.js'
import { Link } from '../components/router.js'
import { renderError } from '../components/error.js'
import { getAuthUser, getAuthUserId } from '../auth/user.js'
import { evalLocale, Locale } from '../components/locale.js'
import { proxy } from '../../../db/proxy.js'
import { loadClientPlugin } from '../../client-plugin.js'
import { Script } from '../components/script.js'
import { ProjectPageBackButton } from '../components/back-to-project-home-button.js'

let pageTitle = (
  <Locale en="Import Dataset" zh_hk="匯入數據集" zh_cn="导入数据集" />
)

let style = Style(/* css */ `
#ImportDataset .batch-labels {
  margin-top: 1.5rem;
}
#ImportDataset .label-row {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0.5rem;
  margin-bottom: 1rem;
}
#ImportDataset .label-row--title {
  font-weight: 500;
}
#ImportDataset .label-row ion-segment {
  flex: 0 0 auto;
  width: 100%;
  max-width: 20rem;
}
`)

let imagePlugin = loadClientPlugin({
  entryFile: 'dist/client/image.js',
})
let sweetAlertPlugin = loadClientPlugin({
  entryFile: 'dist/client/sweetalert.js',
})

let script = Script(/* js */ `
var importedImageIds = [];

window.batchLabelDeps = window.batchLabelDeps || {};
function getBatchDependentsMap() {
  var deps = window.batchLabelDeps;
  var map = {};
  for (var lid in deps) {
    var dep = deps[lid];
    if (dep != null) {
      var d = typeof dep === 'number' ? dep : parseInt(dep, 10);
      if (!map[d]) map[d] = [];
      map[d].push(typeof lid === 'number' ? lid : parseInt(lid, 10));
    }
  }
  return map;
}
function getAncestors(labelId) {
  var deps = window.batchLabelDeps;
  var out = [];
  var cur = deps[labelId] != null ? (typeof deps[labelId] === 'number' ? deps[labelId] : parseInt(deps[labelId], 10)) : null;
  while (cur) {
    out.push(cur);
    cur = deps[cur] != null ? (typeof deps[cur] === 'number' ? deps[cur] : parseInt(deps[cur], 10)) : null;
  }
  return out;
}
function getDescendants(labelId, map) {
  var children = map[labelId] || [];
  var out = [].concat(children);
  for (var i = 0; i < children.length; i++) {
    out = out.concat(getDescendants(children[i], map));
  }
  return out;
}
function setupBatchLabelDepsCascade() {
  var dependentsMap = getBatchDependentsMap();
  document.addEventListener('ionChange', function(e) {
    var segment = e.target;
    if (!segment || segment.tagName !== 'ION-SEGMENT') return;
    var row = segment.closest('.batch-label-row');
    if (!row) return;
    var labelIdStr = row.dataset.labelId;
    if (!labelIdStr) return;
    var labelId = parseInt(labelIdStr, 10);
    var value = segment.value;
    if (value === 'yes') {
      var ancestors = getAncestors(labelIdStr);
      for (var i = 0; i < ancestors.length; i++) {
        var row2 = document.querySelector('.batch-label-row[data-label-id="' + ancestors[i] + '"]');
        if (row2) {
          var seg2 = row2.querySelector('ion-segment');
          if (seg2) seg2.value = 'yes';
        }
      }
    } else if (value === 'no') {
      var descendants = getDescendants(labelId, dependentsMap);
      for (var j = 0; j < descendants.length; j++) {
        var row3 = document.querySelector('.batch-label-row[data-label-id="' + descendants[j] + '"]');
        if (row3) {
          var seg3 = row3.querySelector('ion-segment');
          if (seg3) seg3.value = 'no';
        }
      }
    }
  });
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupBatchLabelDepsCascade);
} else {
  setupBatchLabelDepsCascade();
}

function reportError(err) {
  var msg = err && (err.message || String(err))
  if (typeof showError === 'function') showError(msg); else alert(msg)
}

async function pickAndUpload(event) {
  var btn = event.target.closest('ion-button')
  var form = event.target.closest('form')
  var project_id = form && form.dataset.projectId
  if (!project_id) {
    reportError('Missing project')
    return
  }
  if (typeof selectImage !== 'function' || typeof compressImageFile !== 'function') {
    reportError('Image upload not ready – please refresh the page')
    return
  }
  try {
    if (btn) btn.disabled = true
    var files = await selectImage({
      accept: '.jpg,.png,.webp,.heic,.gif',
      multiple: true,
    })
    files = Array.from(files || [])
    if (files.length === 0) {
      if (btn) btn.disabled = false
      return
    }
    for (var i = 0; i < files.length; i++) {
      var _file = files[i]
      var obj = await compressImageFile(_file)
      var file = obj && obj.file
      if (!file) { reportError('Compress failed'); break }
      var formData = new FormData()
      formData.append('image', file)
      var res = await fetch('/upload-image/submit?project=' + project_id, {
        method: 'POST',
        body: formData,
      })
      var json = await res.json()
      if (json.error) {
        reportError(json.error)
        break
      }
      if (json.image_id) importedImageIds.push(json.image_id)
    }
    var el = document.getElementById('importedCount')
    if (el) el.textContent = importedImageIds.length
    if (files.length > 0 && typeof showToast === 'function') {
      showToast('Uploaded ' + importedImageIds.length + ' image(s)', 'success')
    }
  } catch (error) {
    reportError(error)
  } finally {
    if (btn) btn.disabled = false
  }
}

function getBatchLabelValues() {
  let labels = []
  document.querySelectorAll('.batch-label-row').forEach(row => {
    let labelId = row.dataset.labelId
    let segment = row.querySelector('ion-segment')
    let value = segment && segment.value !== undefined ? segment.value : ''
    if (value === 'yes' || value === 'no') {
      labels.push({ label_id: parseInt(labelId, 10), answer: value === 'yes' ? 1 : 0 })
    }
  })
  return labels
}

async function applyLabels(event) {
  var form = event.target.closest('form')
  var project_id = form && form.dataset.projectId
  if (!project_id) { reportError('Missing project'); return }
  if (importedImageIds.length === 0) {
    reportError('No images uploaded yet')
    return
  }
  var labels = getBatchLabelValues()
  if (labels.length === 0) {
    reportError('Select at least one label (Yes or No)')
    return
  }
  var res = await fetch('/import-dataset/apply-labels?project=' + project_id, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_ids: importedImageIds, labels }),
  })
  var json = await res.json()
  if (json.error) {
    reportError(json.error)
    return
  }
  if (typeof showToast === 'function') {
    showToast('Labels applied to ' + importedImageIds.length + ' images', 'success')
  }
  importedImageIds = []
  var el = document.getElementById('importedCount')
  if (el) el.textContent = '0'
}
`)

let page = (
  <>
    {style}
    <ion-header>
      <ion-toolbar>
        <ProjectPageBackButton />
        <ion-title role="heading" aria-level="1">
          {pageTitle}
        </ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content id="ImportDataset" class="ion-padding" color="light">
      <Main />
    </ion-content>
    {imagePlugin.node}
    {sweetAlertPlugin.node}
    {script}
  </>
)

function Main(attrs: {}, context: DynamicContext) {
  let user = getAuthUser(context)
  let params = new URLSearchParams(context.routerMatch?.search ?? '')
  let project_id = +params.get('project')!
  if (!project_id) {
    return (
      <>
        {renderError('missing project id in url', context)}
        <p>
          <Link href="/app/home">Select Project</Link>
        </p>
      </>
    )
  }
  if (!user) {
    return (
      <p>
        <Locale en="You must be " zh_hk="您必須" zh_cn="您必须" />
        <Link href="/login">logged in</Link>
        <Locale
          en=" to import dataset."
          zh_hk=" 登入才能匯入數據集。"
          zh_cn=" 登录才能导入数据集。"
        />
      </p>
    )
  }
  let labels = filter(proxy.label, { project_id })
  let sortedLabels = [...labels].sort(
    (a, b) => (a.display_order ?? 999999) - (b.display_order ?? 999999),
  )
  let labelDeps: Record<string, number | null> = {}
  for (let l of sortedLabels) {
    if (l.id != null) labelDeps[String(l.id)] = l.dependency_id ?? null
  }
  return (
    <>
      {sortedLabels.length > 0 && (
        <script>
          {'window.batchLabelDeps = ' + JSON.stringify(labelDeps)}
        </script>
      )}
      <p class="ion-text-secondary">
        <Locale
          en="Upload multiple images, then set Yes/No for each label to apply to all of them at once."
          zh_hk="上傳多張圖片後，為每個標籤設定「是」或「否」，一次套用到全部圖片。"
          zh_cn="上传多张图片后，为每个标签设置「是」或「否」，一次应用到全部图片。"
        />
      </p>
      <form data-project-id={project_id}>
        <ion-button type="button" onclick="pickAndUpload(event)">
          <ion-icon name="cloud-upload" slot="start"></ion-icon>
          <Locale
            en="Select &amp; upload images"
            zh_hk="選擇並上傳圖片"
            zh_cn="选择并上传图片"
          />
        </ion-button>
        <p>
          <Locale
            en="Uploaded this batch: "
            zh_hk="本批已上傳： "
            zh_cn="本批已上传： "
          />
          <strong id="importedCount">0</strong>
          <Locale en=" images" zh_hk=" 張圖片" zh_cn=" 张图片" />
        </p>
        <div class="batch-labels">
          <h3>
            <Locale
              en="For each label, choose Yes or No (applies to all images in this batch)"
              zh_hk="為每個標籤選擇「是」或「否」（套用至本批全部圖片）"
              zh_cn="为每个标签选择「是」或「否」（应用于本批全部图片）"
            />
          </h3>
          {sortedLabels.length === 0 ? (
            <p class="ion-text-secondary">
              <Locale
                en="No labels yet. Add labels in Manage Labels first."
                zh_hk="尚無標籤。請先在「管理標籤」新增標籤。"
                zh_cn="尚无标签。请先在「管理标签」中添加标签。"
              />
            </p>
          ) : (
            mapArray(sortedLabels, label => (
              <div class="label-row batch-label-row" data-label-id={label.id}>
                <span class="label-row--title">{label.title}</span>
                <ion-segment name={'batch-label-' + label.id} value="">
                  <ion-segment-button value="">
                    <ion-label>
                      <Locale en="Skip" zh_hk="略過" zh_cn="跳过" />
                    </ion-label>
                  </ion-segment-button>
                  <ion-segment-button value="yes">
                    <ion-label>
                      <Locale en="Yes" zh_hk="是" zh_cn="是" />
                    </ion-label>
                  </ion-segment-button>
                  <ion-segment-button value="no">
                    <ion-label>
                      <Locale en="No" zh_hk="否" zh_cn="否" />
                    </ion-label>
                  </ion-segment-button>
                </ion-segment>
              </div>
            ))
          )}
        </div>
        <div id="applyLabelsSection" class="batch-labels">
          <ion-button
            type="button"
            color="primary"
            onclick="applyLabels(event)"
          >
            <Locale
              en="Apply labels to uploaded images"
              zh_hk="套用標籤至已上傳圖片"
              zh_cn="应用标签到已上传图片"
            />
          </ion-button>
        </div>
      </form>
    </>
  )
}

async function ApplyLabels(context: ExpressContext) {
  let { res } = context
  try {
    let user_id = getAuthUserId(context)
    if (!user_id) throw new Error('not login')
    let params = new URLSearchParams(context.routerMatch?.search ?? '')
    let project_id = +params.get('project')!
    if (!project_id) throw new Error('missing project id in url')
    let body = getContextFormBody(context) as {
      image_ids?: number[]
      labels?: { label_id: number; answer: 0 | 1 }[]
    }
    if (
      !body ||
      !Array.isArray(body.image_ids) ||
      !Array.isArray(body.labels)
    ) {
      throw new Error(
        'body must have image_ids (number[]) and labels ({ label_id, answer }[])',
      )
    }
    let image_ids = [...new Set(
      body.image_ids.filter((id): id is number => typeof id === 'number'),
    )]
    let labels = body.labels.filter(
      (l): l is { label_id: number; answer: 0 | 1 } =>
        typeof l?.label_id === 'number' && (l.answer === 0 || l.answer === 1),
    )
    for (let image_id of image_ids) {
      let image = find(proxy.image, { id: image_id })
      if (!image || image.project_id !== project_id) continue
      for (let { label_id, answer } of labels) {
        let label = find(proxy.label, { id: label_id })
        if (!label || label.project_id !== project_id) continue
        seedRow(proxy.image_label, { image_id, label_id, user_id }, { answer })
      }
    }
    res.json({ ok: true })
  } catch (error) {
    res.json({ error: String(error) })
  }
}

let routes = {
  '/import-dataset': {
    resolve(context) {
      let t = evalLocale(pageTitle, context)
      return {
        title: title(t),
        description: 'Upload images and set labels for the batch',
        node: page,
      }
    },
  },
  '/import-dataset/apply-labels': ajaxRoute({
    description: 'apply batch labels to uploaded images',
    api: ApplyLabels,
  }),
} satisfies Routes

export default { routes }
