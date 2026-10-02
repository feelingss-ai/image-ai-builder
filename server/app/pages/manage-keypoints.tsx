import { count } from 'better-sqlite3-proxy'
import { o } from '../jsx/jsx.js'
import { Routes } from '../routes.js'
import { apiEndpointTitle, LayoutType } from '../../config.js'
import Style from '../components/style.js'
import { DynamicContext, getContextFormBody, WsContext } from '../context.js'
import { mapArray } from '../components/fragment.js'
import { IonBackButton } from '../components/ion-back-button.js'
import {
  canEditProject,
  canViewProject,
  getContextProject,
} from '../context/project-context.js'
import { ProjectPageBackButton } from '../components/project-page-back-button.js'
import { object, string, int, array, id } from 'cast.ts'
import { nodeToVNode } from '../jsx/vnode.js'
import { Link, Redirect } from '../components/router.js'
import { getAuthUser } from '../auth/user.js'
import { Locale, ProjectPageTitle } from '../components/locale.js'
import { filter, find } from 'better-sqlite3-proxy'
import { proxy } from '../../../db/proxy.js'
import { Script } from '../components/script.js'
import { showError } from '../components/error.js'
import { EarlyTerminate } from '../../exception.js'
import { NoProjectMessage } from '../components/no-project-message.js'
import { NoAccessMessage } from '../components/no-access-message.js'
import { loadClientPlugin } from '../../client-plugin.js'

let pageTitle = (
  <Locale en="Manage Keypoints" zh_hk="管理關鍵點" zh_cn="管理关键点" />
)
let addPageTitle = (
  <Locale
    en="Add Keypoint Template"
    zh_hk="添加關鍵點範本"
    zh_cn="添加关键点模板"
  />
)
let editPageTitle = (
  <Locale
    en="Edit Keypoint Template"
    zh_hk="編輯關鍵點範本"
    zh_cn="编辑关键点模板"
  />
)

let sweetAlertPlugin = loadClientPlugin({
  entryFile: 'dist/client/sweetalert.js',
})

let style = Style(/* css */ `
#ManageKeypoints .kp-template-count {
  font-size: 0.8rem;
  color: var(--ion-color-medium);
}
#ManageKeypoints .kp-point-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}
#ManageKeypoints .kp-point-row ion-input {
  flex: 1;
  --padding-start: 0.5rem;
  border: 1px solid var(--ion-border-color, #dedede);
  border-radius: 0.25rem;
}
#ManageKeypoints .kp-edge-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}
#ManageKeypoints .kp-edge-row ion-select {
  flex: 1;
  border: 1px solid var(--ion-border-color, #dedede);
  border-radius: 0.25rem;
  min-height: 2.2rem;
}
#ManageKeypoints .kp-section-title {
  font-weight: 600;
  margin: 1rem 0 0.5rem;
}
#ManageKeypoints .kp-warning {
  font-size: 0.85rem;
  color: #856404;
  background: rgba(255, 193, 7, 0.15);
  border: 1px solid rgba(255, 193, 7, 0.5);
  border-radius: 0.5rem;
  padding: 0.5rem 0.75rem;
  margin-bottom: 1rem;
}
#ManageKeypoints .kp-assign-panel {
  display: none;
  margin: 0.5rem 0 0.25rem;
  padding: 0.5rem;
  border: 1px solid var(--ion-border-color, #dedede);
  border-radius: 0.5rem;
  background: #fafafa;
}
#ManageKeypoints .kp-assign-panel.open {
  display: block;
}
#ManageKeypoints .kp-assign-panel label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.9rem;
  padding: 0.25rem 0;
}
#ManageKeypoints .kp-assign-actions {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.5rem;
}
`)

let script = Script(/* js */ `
// NOTE: use var (not let/const) for top-level bindings — the framework
// re-executes page scripts on every ws update (mount / SPA navigation),
// and re-declaring let/const in the global scope throws
// "Identifier ... has already been declared", aborting the whole script.

// Add a keypoint name row to the editor
function addKeypointRow(name) {
  var list = document.getElementById('kp-point-list')
  if (!list) return
  var row = document.createElement('div')
  row.className = 'kp-point-row'
  var input = document.createElement('ion-input')
  input.setAttribute('label-placement', 'floating')
  input.setAttribute('placeholder', 'e.g. eye_left')
  input.className = 'kp-point-input'
  if (name) input.value = name
  var upBtn = document.createElement('ion-button')
  upBtn.type = 'button'
  upBtn.fill = 'clear'
  upBtn.size = 'small'
  upBtn.title = 'Move up'
  upBtn.innerHTML = '<ion-icon name="chevron-up-outline"></ion-icon>'
  upBtn.onclick = function() { moveRow(row, 'up') }
  var downBtn = document.createElement('ion-button')
  downBtn.type = 'button'
  downBtn.fill = 'clear'
  downBtn.size = 'small'
  downBtn.title = 'Move down'
  downBtn.innerHTML = '<ion-icon name="chevron-down-outline"></ion-icon>'
  downBtn.onclick = function() { moveRow(row, 'down') }
  var delBtn = document.createElement('ion-button')
  delBtn.type = 'button'
  delBtn.color = 'danger'
  delBtn.fill = 'clear'
  delBtn.size = 'small'
  delBtn.title = 'Remove'
  delBtn.innerHTML = '<ion-icon name="trash-outline"></ion-icon>'
  delBtn.onclick = function() {
    row.remove()
    refreshEdgeOptions()
  }
  row.appendChild(input)
  row.appendChild(upBtn)
  row.appendChild(downBtn)
  row.appendChild(delBtn)
  list.appendChild(row)
  refreshEdgeOptions()
}

// Move a row up/down within its list
function moveRow(row, direction) {
  if (direction === 'up' && row.previousElementSibling) {
    row.parentNode.insertBefore(row, row.previousElementSibling)
  } else if (direction === 'down' && row.nextElementSibling) {
    row.parentNode.insertBefore(row.nextElementSibling, row)
  }
  refreshEdgeOptions()
}

// Add a skeleton edge row (two selects: from / to)
function addEdgeRow(fromIdx, toIdx) {
  var list = document.getElementById('kp-edge-list')
  if (!list) return
  var row = document.createElement('div')
  row.className = 'kp-edge-row'
  var fromSelect = document.createElement('select')
  fromSelect.className = 'kp-edge-from'
  var toSelect = document.createElement('select')
  toSelect.className = 'kp-edge-to'
  var delBtn = document.createElement('ion-button')
  delBtn.type = 'button'
  delBtn.color = 'danger'
  delBtn.fill = 'clear'
  delBtn.size = 'small'
  delBtn.title = 'Remove edge'
  delBtn.innerHTML = '<ion-icon name="close"></ion-icon>'
  delBtn.onclick = function() { row.remove() }
  row.appendChild(fromSelect)
  row.appendChild(document.createTextNode(' - '))
  row.appendChild(toSelect)
  row.appendChild(delBtn)
  list.appendChild(row)
  refreshEdgeOptions()
  if (fromIdx != null) fromSelect.value = String(fromIdx)
  if (toIdx != null) toSelect.value = String(toIdx)
}

// Rebuild the edge select options from the current point names
function refreshEdgeOptions() {
  var names = getPointNames()
  document.querySelectorAll('#kp-edge-list .kp-edge-row').forEach(function(row) {
    var fromSelect = row.querySelector('.kp-edge-from')
    var toSelect = row.querySelector('.kp-edge-to')
    ;[fromSelect, toSelect].forEach(function(sel, which) {
      var prev = which === 0 ? fromSelect.value : toSelect.value
      fromSelect = fromSelect // noop to keep linters calm
      var target = which === 0 ? fromSelect : toSelect
      target.innerHTML = ''
      names.forEach(function(name, idx) {
        var opt = document.createElement('option')
        opt.value = String(idx0(names, name, which, prev))
        opt.textContent = (idx0(names, name, which, prev) + 1) + '. ' + name
        target.appendChild(opt)
      })
      if (prev !== '' && Number(prev) < names.length) target.value = prev
    })
  })
}

// helper: pick the index for an option (keeps prior selection when possible)
function idx0(names, name, which, prev) {
  return names.indexOf(name) >= 0 ? names.indexOf(name) : 0
}

// Read the point names from the editor rows
function getPointNames() {
  var names = []
  document.querySelectorAll('#kp-point-list .kp-point-row ion-input').forEach(function(input) {
    var value = (input.value || '').trim()
    if (value) names.push(value)
  })
  return names
}

// Read the edges from the editor rows
function getEdges() {
  var edges = []
  document.querySelectorAll('#kp-edge-list .kp-edge-row').forEach(function(row) {
    var from = row.querySelector('.kp-edge-from').value
    var to = row.querySelector('.kp-edge-to').value
    if (from !== '' && to !== '' && from !== to) {
      edges.push([Number(from), Number(to)])
    }
  })
  return edges
}

// Serialize the editor into the hidden form fields before submit
function serializeKeypoints() {
  var names = getPointNames()
  var edges = getEdges()
  var namesInput = document.getElementById('kp-names-input')
  var edgesInput = document.getElementById('kp-edges-input')
  if (namesInput) namesInput.value = JSON.stringify(names)
  if (edgesInput) edgesInput.value = JSON.stringify(edges)
  if (names.length === 0) {
    if (typeof showToast === 'function') showToast('Add at least one keypoint', 'warning')
    return false
  }
  var seen = {}
  for (var i = 0; i < names.length; i++) {
    if (seen[names[i]]) {
      if (typeof showToast === 'function') showToast('Duplicate keypoint name: ' + names[i], 'warning')
      return false
    }
    seen[names[i]] = true
  }
  return true
}

// Toggle the assign-to-labels panel of a template item
function toggleAssignPanel(template_id) {
  var panel = document.getElementById('kp-assign-panel-' + template_id)
  if (!panel) return
  panel.classList.toggle('open')
}

// Save the label assignments of a template: reads the checkboxes and sends
// the full list of label_ids that should use this template
function saveAssignments(template_id, project_id) {
  var panel = document.getElementById('kp-assign-panel-' + template_id)
  if (!panel) return
  var label_ids = []
  panel.querySelectorAll('input.kp-assign-checkbox').forEach(function(cb) {
    if (cb.checked) label_ids.push(Number(cb.dataset.labelId))
  })
  emit('/manage-keypoints/assign-labels', {
    template_id: template_id,
    label_ids: label_ids,
    project_id: project_id,
  })
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
    <ion-content id="ManageKeypoints" class="ion-padding">
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
      <p>
        You must be <Link href="/login">logged in</Link> to manage keypoints.
      </p>
    )
  }

  let project = getContextProject(context)
  if (!project) return <NoProjectMessage />
  if (!canViewProject(user, project)) return <NoAccessMessage />
  let project_id = project.id!

  let templates = filter(proxy.keypoint_template, { project_id })
  let sortedTemplates = [...templates].sort((a, b) => (a.id ?? 0) - (b.id ?? 0))

  // labels of this project for the assign-to-labels checkboxes
  let labels = filter(proxy.label, { project_id })
  let sortedLabels = [...labels].sort(
    (a, b) => (a.display_order ?? 999999) - (b.display_order ?? 999999),
  )

  return (
    <>
      <div style="margin-bottom: 2rem">
        <Link
          href={`/manage-keypoints/add?project=${project_id}`}
          tagName="ion-button"
        >
          <ion-icon name="add" slot="start"></ion-icon>
          <Locale
            en="Add Keypoint Template"
            zh_hk="添加關鍵點範本"
            zh_cn="添加关键点模板"
          />
        </Link>
      </div>

      <h3>
        <Locale en="Keypoint Templates" zh_hk="關鍵點範本" zh_cn="关键点模板" />{' '}
        ({sortedTemplates.length})
      </h3>
      <ion-list class="hover-list">
        {mapArray(sortedTemplates, template => (
          <TemplateItem
            template={template}
            project_id={project_id}
            labels={sortedLabels}
          />
        ))}
      </ion-list>
      {sortedTemplates.length === 0 && (
        <p style="text-align: center; color: var(--ion-color-medium); padding: 2rem;">
          <Locale
            en="No keypoint templates yet. Click 'Add Keypoint Template' to create one, then assign it to a label in Manage Labels."
            zh_hk="尚無關鍵點範本。點擊「添加關鍵點範本」建立一個，然後在「管理標籤」指派給標籤。"
            zh_cn="尚无关键点模板。点击「添加关键点模板」创建一个，然后在「管理标签」指派给标签。"
          />
        </p>
      )}
    </>
  )
}

function TemplateItem(attrs: {
  template: {
    id?: null | number
    title: string
    names: string
    edges: string
  }
  project_id: number
  labels: {
    id?: null | number
    title: string
    keypoint_template_id: null | number
  }[]
}) {
  let template = attrs.template
  let project_id = attrs.project_id
  if (!template) return null

  let names: string[] = []
  let edges: number[][] = []
  try {
    names = JSON.parse(template.names)
    edges = JSON.parse(template.edges)
  } catch {
    // corrupted row: show as-is
  }

  let label_count = count(proxy.label, { keypoint_template_id: template.id! })

  return (
    <ion-item id={`kp-template-item-${template.id!}`}>
      <ion-label>
        <h2 id={`kp-template-title-${template.id!}`}>
          {template.title}{' '}
          <span class="kp-template-count">
            ({names.length} points, {edges.length} edges, {label_count || 'no'}{' '}
            labels)
          </span>
        </h2>
        <p>{names.join(', ')}</p>
        {/* assign-to-labels panel: checkbox per label, saved via WS */}
        <div class="kp-assign-panel" id={`kp-assign-panel-${template.id!}`}>
          {attrs.labels.length === 0 ? (
            <p style="font-size: 0.85rem; color: var(--ion-color-medium); margin: 0.25rem 0;">
              <Locale
                en="No labels in this project yet."
                zh_hk="此專案尚無標籤。"
                zh_cn="此项目尚无标签。"
              />
            </p>
          ) : (
            mapArray(attrs.labels, label => (
              <label>
                <input
                  type="checkbox"
                  class="kp-assign-checkbox"
                  data-label-id={label.id!}
                  checked={label.keypoint_template_id === template.id}
                />
                {label.title}
              </label>
            ))
          )}
          <div class="kp-assign-actions">
            <ion-button
              size="small"
              onclick={`saveAssignments(${template.id!}, ${project_id})`}
            >
              <ion-icon name="save-outline" slot="start"></ion-icon>
              <Locale en="Save" zh_hk="儲存" zh_cn="保存" />
            </ion-button>
          </div>
        </div>
      </ion-label>
      <div style="display: flex; gap: 4px; align-items: center;">
        <ion-button
          color="tertiary"
          size="small"
          slot="end"
          onclick={`toggleAssignPanel(${template.id!})`}
        >
          <ion-icon name="people-outline"></ion-icon>
        </ion-button>
        <Link
          href={`/manage-keypoints/edit?project=${project_id}&template_id=${template.id!}`}
          tagName="ion-button"
          color="primary"
          size="small"
          slot="end"
        >
          <ion-icon name="create-outline"></ion-icon>
        </Link>
        <ion-button
          color="danger"
          size="small"
          slot="end"
          onclick={`emit('/manage-keypoints/delete', { template_id: ${template.id}, project_id: ${project_id} })`}
        >
          <ion-icon name="trash-outline"></ion-icon>
        </ion-button>
      </div>
    </ion-item>
  )
}

// shared template editor form (used by Add and Edit pages)
function TemplateForm(attrs: {
  action: string
  title: string
  template_title?: string
  names: string[]
  edges: number[][]
}) {
  return (
    <form
      method="POST"
      action={attrs.action}
      onsubmit="return serializeKeypoints() && emitForm(event)"
    >
      <input type="hidden" name="names" id="kp-names-input" />
      <input type="hidden" name="edges" id="kp-edges-input" />
      <ion-list>
        <ion-item>
          <ion-input
            name="title"
            label="Template Name*:"
            label-placement="floating"
            required
            minlength="1"
            maxlength="100"
            value={attrs.template_title}
          />
        </ion-item>
        <p style="font-size: 0.8rem; color: var(--ion-color-medium); margin: 0.25rem 1rem;">
          (1-100 characters, e.g. "eyes-2", "horse-4legs")
        </p>

        <div class="kp-section-title">
          <Locale en="Keypoints" zh_hk="關鍵點" zh_cn="关键点" />
        </div>
        <div id="kp-point-list"></div>
        <div style="margin: 0.5rem 0">
          <ion-button
            type="button"
            fill="outline"
            size="small"
            onclick="addKeypointRow()"
          >
            <ion-icon name="add" slot="start"></ion-icon>
            <Locale en="Add Keypoint" zh_hk="添加關鍵點" zh_cn="添加关键点" />
          </ion-button>
        </div>

        <div class="kp-section-title">
          <Locale
            en="Skeleton Edges (optional)"
            zh_hk="骨架線（可選）"
            zh_cn="骨架线（可选）"
          />
        </div>
        <div id="kp-edge-list"></div>
        <div style="margin: 0.5rem 0;">
          <ion-button
            type="button"
            fill="outline"
            size="small"
            onclick="addEdgeRow()"
          >
            <ion-icon name="add" slot="start"></ion-icon>
            <Locale en="Add Edge" zh_hk="添加骨架線" zh_cn="添加骨架线" />
          </ion-button>
        </div>
        <p style="font-size: 0.8rem; color: var(--ion-color-medium); margin: 0.25rem 1rem;">
          <Locale
            en="Edges connect two keypoints with a line on the canvas (optional)."
            zh_hk="骨架線在畫布上連接兩個關鍵點（可選）。"
            zh_cn="骨架线在画布上连接两个关键点（可选）。"
          />
        </p>
      </ion-list>
      <div style="margin: 2rem 0">
        <ion-button type="submit" expand="block">
          <ion-icon name="save" slot="start"></ion-icon>
          {attrs.title}
        </ion-button>
      </div>
      <p
        id="form-message"
        style="color: var(--ion-color-success); text-align: center; min-height: 2.5rem;"
      ></p>
    </form>
  )
}

function AddPage(attrs: {}, context: DynamicContext) {
  let user = getAuthUser(context)
  if (!user) return <Redirect href="/login" />

  let project = getContextProject(context)
  if (!project) return <NoProjectMessage />
  if (!canViewProject(user, project)) return <NoAccessMessage />
  let project_id = project.id!

  return (
    <>
      <ion-header>
        <ion-toolbar>
          <IonBackButton
            href={`/manage-keypoints?project=${project_id}`}
            backText={pageTitle}
          />
          <ion-title role="heading" aria-level="1">
            <ProjectPageTitle t={addPageTitle} short />
          </ion-title>
        </ion-toolbar>
      </ion-header>
      <ion-content class="ion-padding">
        <TemplateForm
          action={`/manage-keypoints/add/submit?project=${project_id}`}
          title={Locale(
            { en: 'Create Template', zh_hk: '建立範本', zh_cn: '创建模板' },
            context,
          )}
          names={[]}
          edges={[]}
        />
      </ion-content>
      {sweetAlertPlugin.node}
      {script}
      <InitScript names={[]} edges={[]} />
    </>
  )
}

function EditPage(attrs: {}, context: DynamicContext) {
  let user = getAuthUser(context)
  if (!user) return <Redirect href="/login" />

  let project = getContextProject(context)
  if (!project) return <NoProjectMessage />
  if (!canViewProject(user, project)) return <NoAccessMessage />
  let project_id = project.id!

  let fallbackUrl = `/manage-keypoints?project=${project_id}`

  let params = new URLSearchParams(context.routerMatch?.search ?? '')
  let template_id = +params.get('template_id')!
  if (!template_id) {
    return <Redirect href={fallbackUrl} />
  }

  let template = proxy.keypoint_template[template_id]
  if (!template || template.project_id !== project_id) {
    return <Redirect href={fallbackUrl} />
  }

  let names: string[] = []
  let edges: number[][] = []
  try {
    names = JSON.parse(template.names)
    edges = JSON.parse(template.edges)
  } catch {
    names = []
    edges = []
  }

  let label_count = count(proxy.label, { keypoint_template_id: template_id })

  return (
    <>
      <ion-header>
        <ion-toolbar>
          <IonBackButton
            href={`/manage-keypoints?project=${project_id}`}
            backText={pageTitle}
          />
          <ion-title role="heading" aria-level="1">
            <ProjectPageTitle t={editPageTitle} short />
          </ion-title>
        </ion-toolbar>
      </ion-header>
      <ion-content class="ion-padding">
        {label_count > 0 && (
          <div class="kp-warning">
            <Locale
              en={`This template is used by ${label_count} label(s). Reordering or removing keypoints will misalign already-marked keypoints. Consider "Save as new" instead.`}
              zh_hk={`此範本已被 ${label_count} 個標籤使用。重新排序或刪除點位會讓已標註的點位錯位，建議改為另存新範本。`}
              zh_cn={`此模板已被 ${label_count} 个标签使用。重新排序或删除点位会让已标注的点位错位，建议另存新模板。`}
            />
          </div>
        )}
        <TemplateForm
          action={`/manage-keypoints/modify?project=${project_id}&template_id=${template_id}`}
          title={Locale(
            { en: 'Save Changes', zh_hk: '儲存變更', zh_cn: '保存更改' },
            context,
          )}
          template_title={template.title}
          names={names}
          edges={edges}
        />
      </ion-content>
      {sweetAlertPlugin.node}
      {script}
      <InitScript names={names} edges={edges} />
    </>
  )
}

// Injects the initial template data and populates the editor rows on load.
// Placed AFTER {script} so addKeypointRow/addEdgeRow are already defined.
function InitScript(attrs: { names: string[]; edges: number[][] }) {
  return (
    <script>
      {'window.kpInitNames = ' +
        JSON.stringify(attrs.names) +
        ';window.kpInitEdges = ' +
        JSON.stringify(attrs.edges) +
        ';(function init(){ if (typeof addKeypointRow !== "function") { return setTimeout(init, 50) } kpInitNames.forEach(function(n){ addKeypointRow(n) }); kpInitEdges.forEach(function(e){ addEdgeRow(e[0], e[1]) }) })();'}
    </script>
  )
}

let submitParser = object({
  title: string({ minLength: 1, maxLength: 100 }),
  names: string(),
  edges: string(),
})

function Submit(attrs: {}, context: WsContext) {
  try {
    let user = getAuthUser(context)
    if (!user) throw 'You must be logged in'

    let project = getContextProject(context)
    if (!project) throw 'Project not found'
    let project_id = project.id!

    if (!canEditProject(user, project))
      throw 'You do not have permission to manage keypoints in this project'

    let body = getContextFormBody(context)
    let input = submitParser.parse(body)

    let names = parseNames(input.names)
    let edges = parseEdges(input.edges, names)

    let existing = find(proxy.keypoint_template, {
      project_id,
      title: input.title,
    })
    if (existing)
      throw `Template "${input.title}" already exists in this project`

    proxy.keypoint_template.push({
      project_id,
      title: input.title,
      names: JSON.stringify(names),
      edges: JSON.stringify(edges),
      flip_idx: null,
    })

    context.ws.send(['redirect', `/manage-keypoints?project=${project_id}`])
    throw EarlyTerminate
  } catch (error) {
    if (error === EarlyTerminate) throw EarlyTerminate
    console.error(error)
    context.ws.send([
      'eval',
      `document.querySelector("#form-message").textContent = "${String(error).replace(/"/g, '\\"')}"`,
    ])
    throw EarlyTerminate
  }
}

let modifyParser = object({
  title: string({ minLength: 1, maxLength: 100 }),
  names: string(),
  edges: string(),
})

function ModifyTemplate(attrs: {}, context: WsContext) {
  try {
    let user = getAuthUser(context)
    if (!user) throw 'You must be logged in'

    let project = getContextProject(context)
    if (!project) throw 'Project not found'
    let project_id = project.id!

    let params = new URLSearchParams(context.routerMatch?.search ?? '')
    let template_id = +params.get('template_id')!
    if (!template_id) throw 'Invalid template'

    let template = proxy.keypoint_template[template_id]
    if (!template || template.project_id !== project_id) {
      throw 'Template not found'
    }
    if (!canEditProject(user, project)) {
      throw 'You do not have permission to edit keypoints in this project'
    }

    let body = getContextFormBody(context)
    let input = modifyParser.parse(body)

    let names = parseNames(input.names)
    let edges = parseEdges(input.edges, names)

    let duplicate = find(proxy.keypoint_template, {
      project_id,
      title: input.title,
    })
    if (duplicate && duplicate.id !== template_id) {
      throw `Template "${input.title}" already exists in this project`
    }

    template.title = input.title
    template.names = JSON.stringify(names)
    template.edges = JSON.stringify(edges)

    context.ws.send(['redirect', `/manage-keypoints?project=${project_id}`])
    throw EarlyTerminate
  } catch (error) {
    if (error === EarlyTerminate) throw EarlyTerminate
    console.error(error)
    context.ws.send([
      'eval',
      `document.querySelector("#form-message").textContent = "${String(error).replace(/"/g, '\\"')}"`,
    ])
    throw EarlyTerminate
  }
}

// parse + validate the names JSON from the client
function parseNames(json: string): string[] {
  let names = JSON.parse(json)
  if (!Array.isArray(names) || names.length === 0) {
    throw 'At least one keypoint is required'
  }
  for (let name of names) {
    if (typeof name !== 'string' || !name.trim()) {
      throw 'Keypoint names cannot be empty'
    }
  }
  let seen = new Set<string>()
  for (let name of names) {
    if (seen.has(name)) throw `Duplicate keypoint name: ${name}`
    seen.add(name)
  }
  return names
}

// parse + validate the edges JSON against the names list
function parseEdges(json: string, names: string[]): number[][] {
  let edges = JSON.parse(json)
  if (!Array.isArray(edges)) return []
  for (let edge of edges) {
    if (
      !Array.isArray(edge) ||
      edge.length !== 2 ||
      !Number.isInteger(edge[0]) ||
      !Number.isInteger(edge[1]) ||
      edge[0] < 0 ||
      edge[1] < 0 ||
      edge[0] >= names.length ||
      edge[1] >= names.length ||
      edge[0] === edge[1]
    ) {
      throw `Invalid skeleton edge: ${JSON.stringify(edge)}`
    }
  }
  return edges
}

function Delete(attrs: {}, context: WsContext) {
  try {
    let parser = object({
      template_id: int(),
      project_id: int(),
    })

    let user = getAuthUser(context)
    if (!user) throw 'You must be logged in'

    let body = getContextFormBody(context)
    let input = parser.parse(body)
    let project_id = input.project_id

    let project = proxy.project[project_id]
    if (!project) throw 'Project not found'
    if (project.creator_id !== user.id)
      throw 'You do not have permission to delete keypoints from this project'

    let template = proxy.keypoint_template[input.template_id]
    if (!template || template.project_id !== project_id) {
      throw 'Template not found'
    }

    // block deletion while labels still reference this template
    let label_count = count(proxy.label, {
      keypoint_template_id: input.template_id,
    })
    if (label_count > 0) {
      throw `This template is used by ${label_count} label(s). Remove it from the labels first.`
    }

    delete proxy.keypoint_template[input.template_id]

    context.ws.send(['eval', 'location.reload()'])
    throw EarlyTerminate
  } catch (error) {
    if (error === EarlyTerminate) throw EarlyTerminate
    console.error(error)
    context.ws.send(['eval', `alert("${String(error).replace(/"/g, '\\"')}")`])
    throw EarlyTerminate
  }
}

// Assign a template to a set of labels: the client sends the full list of
// label_ids that should use this template. Labels currently using it but
// unchecked are cleared; newly checked labels are set.
let assignLabelsParser = object({
  template_id: id(),
  label_ids: array(id()),
  project_id: id(),
})

function AssignLabels(attrs: {}, context: WsContext) {
  try {
    let user = getAuthUser(context)
    if (!user) throw 'You must be logged in'

    let body = getContextFormBody(context)
    let input = assignLabelsParser.parse(body)
    let project_id = input.project_id

    let project = proxy.project[project_id]
    if (!project) throw 'Project not found'
    if (project.creator_id !== user.id)
      throw 'You do not have permission to manage keypoints in this project'

    let template = proxy.keypoint_template[input.template_id]
    if (!template || template.project_id !== project_id) {
      throw 'Template not found'
    }

    let wanted = new Set(input.label_ids)
    // validate every wanted label belongs to this project
    for (let label_id of wanted) {
      let label = proxy.label[label_id]
      if (!label || label.project_id !== project_id) {
        throw `Label ${label_id} not found in this project`
      }
    }

    // update all labels of the project: set/clear the template reference
    let labels = filter(proxy.label, { project_id })
    let assigned = 0
    let cleared = 0
    for (let label of labels) {
      let isAssigned = label.keypoint_template_id === input.template_id
      let shouldBeAssigned = wanted.has(label.id!)
      if (shouldBeAssigned && !isAssigned) {
        label.keypoint_template_id = input.template_id
        assigned++
      } else if (!shouldBeAssigned && isAssigned) {
        label.keypoint_template_id = null
        cleared++
      }
    }

    // update the label count badge on the template item
    let label_count = count(proxy.label, {
      keypoint_template_id: input.template_id,
    })
    context.ws.send([
      'batch',
      [
        [
          'update-text',
          `#kp-template-title-${input.template_id}`,
          `${template.title} (${JSON.parse(template.names).length} points, ${JSON.parse(template.edges).length} edges, ${label_count || 'no'} labels)`,
        ],
        [
          'eval',
          `if (typeof showToast === 'function') showToast('Assigned to ${assigned} label(s), removed from ${cleared}', 'success')`,
        ],
      ],
    ])
    throw EarlyTerminate
  } catch (error) {
    if (error === EarlyTerminate) throw EarlyTerminate
    console.error(error)
    context.ws.send(showError(error))
    throw EarlyTerminate
  }
}

let routes = {
  '/manage-keypoints': {
    title: <ProjectPageTitle t={pageTitle} />,
    description: 'Manage keypoint templates for annotation',
    node: page,
  },
  '/manage-keypoints/add': {
    title: <ProjectPageTitle t={addPageTitle} />,
    description: 'Add a new keypoint template',
    node: <AddPage />,
    layout_type: LayoutType.ionic,
  },
  '/manage-keypoints/add/submit': {
    title: apiEndpointTitle,
    description: 'Submit new keypoint template',
    node: <Submit />,
    streaming: false,
  },
  '/manage-keypoints/edit': {
    title: <ProjectPageTitle t={editPageTitle} />,
    description: 'Edit a keypoint template',
    node: <EditPage />,
    layout_type: LayoutType.ionic,
  },
  '/manage-keypoints/modify': {
    title: apiEndpointTitle,
    description: 'Update keypoint template',
    node: <ModifyTemplate />,
    streaming: false,
  },
  '/manage-keypoints/delete': {
    title: apiEndpointTitle,
    description: 'Delete a keypoint template',
    node: <Delete />,
    streaming: false,
  },
  '/manage-keypoints/assign-labels': {
    title: apiEndpointTitle,
    description: 'Assign a keypoint template to a set of labels',
    node: <AssignLabels />,
    streaming: false,
  },
} satisfies Routes

export default { routes }
