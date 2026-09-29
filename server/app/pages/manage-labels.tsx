import { count } from 'better-sqlite3-proxy'
import { o } from '../jsx/jsx.js'
import { Routes } from '../routes.js'
import { apiEndpointTitle, LayoutType } from '../../config.js'
import Style from '../components/style.js'
import {
  Context,
  DynamicContext,
  getContextFormBody,
  throwIfInAPI,
  WsContext,
} from '../context.js'
import { mapArray } from '../components/fragment.js'
import { IonBackButton } from '../components/ion-back-button.js'
import {
  getContextProject,
  getProjectConflictMap,
} from '../context/project-context.js'
import { ProjectPageBackButton } from '../components/project-page-back-button.js'
import { object, string, int, boolean, optional } from 'cast.ts'
import { Link, Redirect } from '../components/router.js'
import { renderError } from '../components/error.js'
import { getAuthUser, getAuthUserId } from '../auth/user.js'
import { Locale, ProjectPageTitle } from '../components/locale.js'
import { filter, find } from 'better-sqlite3-proxy'
import { proxy } from '../../../db/proxy.js'
import { db } from '../../../db/db.js'
import { Script } from '../components/script.js'
import { EarlyTerminate } from '../../exception.js'
import { nodeToVNode } from '../jsx/vnode.js'
import { NoProjectMessage } from '../components/no-project-message.js'
import { loadClientPlugin } from '../../client-plugin.js'

let pageTitle = <Locale en="Manage Labels" zh_hk="管理標籤" zh_cn="管理标签" />
let addPageTitle = <Locale en="Add Label" zh_hk="添加標籤" zh_cn="添加标签" />

// ---------------------------------------------------------------------------
// label conflict helpers
//
// Conflict rules (enforced on both read and write):
//   - a parent label (no dependency_id) may only conflict with other parents
//   - a child label may only conflict with children of the SAME parent
//   - a label can never conflict with itself
// Conflicts are stored as an unordered pair (label_id_a < label_id_b).
// ---------------------------------------------------------------------------

// labels that may be set as conflicting with `label` (excludes itself)
function getConflictCandidates(
  label: { id?: null | number; dependency_id: null | number },
  project_id: number,
) {
  let allLabels = filter(proxy.label, { project_id })
  let isParent = !label.dependency_id
  return allLabels.filter(other => {
    if (other.id === label.id) return false
    if (isParent) return !other.dependency_id
    return other.dependency_id === label.dependency_id
  })
}

// ids of labels currently conflicting with `label_id` (both directions)
function getConflictIds(label_id: number): number[] {
  let asA = filter(proxy.label_conflict, { label_a_id: label_id })
  let asB = filter(proxy.label_conflict, { label_b_id: label_id })
  return [...asA.map(row => row.label_b_id), ...asB.map(row => row.label_a_id)]
}

// validate that two labels may conflict, throws a message when not
function assertConflictAllowed(
  label: { id?: null | number; dependency_id: null | number },
  other: {
    id?: null | number
    dependency_id: null | number
    project_id?: null | number
  },
  project_id: number,
) {
  if (label.id === other.id) throw 'A label cannot conflict with itself'
  if (other.project_id !== project_id) throw 'Invalid conflicting label'
  let labelIsParent = !label.dependency_id
  let otherIsParent = !other.dependency_id
  if (labelIsParent !== otherIsParent) {
    throw 'A parent label can only conflict with another parent label'
  }
  if (!labelIsParent && label.dependency_id !== other.dependency_id) {
    throw 'A child label can only conflict with children of the same parent'
  }
}

let sweetAlertPlugin = loadClientPlugin({
  entryFile: 'dist/client/sweetalert.js',
})

let style = Style(/* css */ `
#ManageLabels {

}
.label-image-count {
  font-size: 0.8rem;
  color: var(--ion-color-medium);
}
.label-conflict-text {
  font-size: 0.8rem;
  color: var(--ion-color-warning-shade);
  display: flex;
  align-items: center;
  gap: 0.25rem;
}
.label-child-count {
  font-size: 0.75rem;
  color: var(--ion-color-medium);
  margin-left: 0.15rem;
}
`)

let script = Script(/* js */ `
function moveLabel(label_id, project_id, direction) {
  var item = document.getElementById('label-item-' + label_id);
  if (!item) return;
  var list = item.parentNode;
  if (!list) return;
  var items = Array.prototype.filter.call(list.querySelectorAll('ion-item'), function(el) {
    return el.id && el.id.indexOf('label-item-') === 0;
  });
  var index = items.indexOf(item);
  if (direction === 'up' && index === 0) {
    showToast('Already at the top', 'info');
    return;
  }
  if (direction === 'down' && index === items.length - 1) {
    showToast('Already at the bottom', 'info');
    return;
  }
  emit('/manage-labels/reorder', { label_id: label_id, project_id: project_id, direction: direction });
}

function toggleChildren(label_id, project_id, collapsed) {
  emit('/manage-labels/toggle-children', { label_id: label_id, project_id: project_id, collapsed: collapsed });
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
    <ion-content id="ManageLabels" class="ion-padding">
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
        You must be <Link href="/login">logged in</Link> to manage labels.
      </p>
    )
  }

  let project = getContextProject(context)
  if (!project) return <NoProjectMessage />
  let project_id = project.id!

  // Get labels for this project (use proxy filter for DB query, not array loop)
  let labels = filter(proxy.label, { project_id })
  let sortedLabels = [...labels].sort(
    (a, b) => (a.display_order ?? 999999) - (b.display_order ?? 999999),
  )

  // Tree view: parents (no dependency_id) in display order, each followed by
  // its own children (also in display order). Children of a collapsed parent
  // are hidden until the parent's toggle is opened.
  let parents = sortedLabels.filter(l => !l.dependency_id)
  let childrenByParent = new Map<number, typeof sortedLabels>()
  for (let label of sortedLabels) {
    if (!label.dependency_id) continue
    let list = childrenByParent.get(label.dependency_id) || []
    list.push(label)
    childrenByParent.set(label.dependency_id, list)
  }
  // pairwise + mutually-exclusive-group conflicts, for the list hints
  let conflictMap = getProjectConflictMap(project_id)

  return (
    <>
      {/* Add new label button - at the top like project list */}
      <div style="margin-bottom: 2rem">
        <Link
          href={`/manage-labels/add?project=${project_id}`}
          tagName="ion-button"
        >
          <ion-icon name="add" slot="start"></ion-icon>
          <Locale en="Add Label" zh_hk="添加標籤" zh_cn="添加标签" />
        </Link>
      </div>

      {/* Labels list (tree: parents with their children nested underneath) */}
      <h3>Labels ({sortedLabels.length})</h3>
      <ion-list class="hover-list">
        {mapArray(parents, parent => (
          <>
            <LabelItem
              label={parent}
              project_id={project_id}
              conflictMap={conflictMap}
              childCount={(childrenByParent.get(parent.id!) || []).length}
            />
            {parent.children_collapsed
              ? null
              : mapArray(childrenByParent.get(parent.id!) || [], child => (
                  <LabelItem
                    label={child}
                    project_id={project_id}
                    conflictMap={conflictMap}
                    isChild
                  />
                ))}
          </>
        ))}
      </ion-list>
      {sortedLabels.length === 0 && (
        <p style="text-align: center; color: var(--ion-color-medium); padding: 2rem;">
          <Locale
            en="No labels created yet. Click 'Add Label' to create your first label."
            zh_hk="尚未創建標籤。點擊「添加標籤」創建第一個標籤。"
            zh_cn="尚未创建标签。点击「添加标签」创建第一个标签。"
          />
        </p>
      )}
    </>
  )
}

function LabelItem(attrs: {
  label: any
  project_id: number
  conflictMap: Record<number, number[]>
  childCount?: number
  isChild?: boolean
}) {
  let label = attrs.label
  let project_id = attrs.project_id
  if (!label) return null
  let dependency = label.dependency
  let dependencyText = dependency ? ` (depends on: ${dependency.title})` : ''
  let template = label.keypoint_template_id
    ? proxy.keypoint_template[label.keypoint_template_id]
    : null
  let templateText = template ? ` (keypoints: ${template.title})` : ''

  let image_count = count(proxy.image_label, { label_id: label.id })

  // conflicting labels (pairwise + mutually-exclusive groups, both
  // directions), shown as a hint under the title
  let conflictTitles = (attrs.conflictMap[label.id!] || [])
    .map(id => proxy.label[id]?.title)
    .filter((title): title is string => !!title)

  // parents with children get a collapse/expand toggle
  let childCount = attrs.childCount ?? 0
  let hasChildren = childCount > 0
  let collapsed = !!label.children_collapsed

  return (
    <ion-item
      id={`label-item-${label.id}`}
      data-is-child={attrs.isChild ? 'true' : 'false'}
      style={attrs.isChild ? '--padding-start: 3rem;' : ''}
    >
      <ion-label>
        <h2 id={`label-title-${label.id}`}>
          {attrs.isChild ? (
            <ion-icon
              name="return-down-forward-outline"
              style="font-size: 0.9rem; vertical-align: middle; margin-right: 0.25rem;"
            ></ion-icon>
          ) : null}
          {label.title}{' '}
          <span class="label-image-count">({image_count || 'no'} images)</span>
        </h2>
        <p>
          {dependencyText}
          {templateText}
        </p>
        {!label.dependency_id && label.mutually_exclusive && (
          <p class="label-conflict-text">
            <ion-icon name="git-compare-outline"></ion-icon> children are
            mutually exclusive
          </p>
        )}
        {conflictTitles.length > 0 && (
          <p class="label-conflict-text">
            <ion-icon name="git-compare-outline"></ion-icon>{' '}
            {`conflicts with: ${conflictTitles.join(', ')}`}
          </p>
        )}
      </ion-label>
      <div style="display: flex; gap: 4px; align-items: center;">
        {hasChildren ? (
          <ion-button
            class="label-toggle-children"
            fill="clear"
            size="small"
            slot="end"
            title={collapsed ? 'Show children' : 'Hide children'}
            onclick={`toggleChildren(${label.id}, ${project_id}, ${collapsed ? 'false' : 'true'})`}
          >
            <ion-icon
              name={
                collapsed ? 'chevron-forward-outline' : 'chevron-down-outline'
              }
            ></ion-icon>
            <span class="label-child-count">{childCount}</span>
          </ion-button>
        ) : null}
        <ion-button
          class="label-move-up"
          fill="clear"
          size="small"
          slot="end"
          title="Move up"
          onclick={`moveLabel(${label.id}, ${project_id}, 'up')`}
        >
          <ion-icon name="chevron-up-outline"></ion-icon>
        </ion-button>
        <ion-button
          class="label-move-down"
          fill="clear"
          size="small"
          slot="end"
          title="Move down"
          onclick={`moveLabel(${label.id}, ${project_id}, 'down')`}
        >
          <ion-icon name="chevron-down-outline"></ion-icon>
        </ion-button>
        <Link
          href={`/manage-labels/edit?project=${project_id}&label_id=${label.id}`}
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
          onclick={`emit('/manage-labels/delete', { label_id: ${label.id}, project_id: ${project_id} })`}
        >
          <ion-icon name="trash-outline"></ion-icon>
        </ion-button>
      </div>
    </ion-item>
  )
}

function AddPage(attrs: {}, context: DynamicContext) {
  let user = getAuthUser(context)
  if (!user) return <Redirect href="/login" />

  let project = getContextProject(context)
  if (!project) return <NoProjectMessage />
  let project_id = project.id!

  // Get existing labels for parent selection (use proxy filter for DB query), sorted by display_order
  let labels = filter(proxy.label, { project_id })
  let sortedLabelsForSelect = [...labels].sort(
    (a, b) => (a.display_order ?? 999999) - (b.display_order ?? 999999),
  )

  // keypoint templates of this project for the template dropdown
  let templates = filter(proxy.keypoint_template, { project_id })

  return (
    <>
      <ion-header>
        <ion-toolbar>
          <IonBackButton
            href={`/manage-labels?project=${project_id}`}
            backText={pageTitle}
          />
          <ion-title role="heading" aria-level="1">
            <ProjectPageTitle t={addPageTitle} short />
          </ion-title>
        </ion-toolbar>
      </ion-header>
      <ion-content class="ion-padding">
        <form
          id="add-label-form"
          method="POST"
          action={`/manage-labels/add/submit?project=${project_id}`}
          onsubmit="emitForm(event)"
        >
          <ion-list>
            <ion-item>
              <ion-input
                name="title"
                label="Label Name*:"
                label-placement="floating"
                required
                minlength="1"
                maxlength="100"
              />
            </ion-item>
            <p style="font-size: 0.8rem; color: var(--ion-color-medium); margin: 0.25rem 1rem;">
              (1-100 characters)
            </p>
            <ion-item>
              <ion-select
                name="dependency_id"
                label="Parent Label (optional):"
                label-placement="floating"
                interface="popover"
              >
                <ion-select-option value="">No parent</ion-select-option>
                {mapArray(sortedLabelsForSelect, label => (
                  <ion-select-option value={label.id}>
                    {label.title}
                  </ion-select-option>
                ))}
              </ion-select>
            </ion-item>
            <p style="font-size: 0.8rem; color: var(--ion-color-medium); margin: 0.25rem 1rem;">
              Select a parent label to create a hierarchy
            </p>
            <ion-item>
              <ion-select
                name="keypoint_template_id"
                label="Keypoint Template (optional):"
                label-placement="floating"
                interface="popover"
              >
                <ion-select-option value="">None</ion-select-option>
                {mapArray(templates, template => (
                  <ion-select-option value={template.id}>
                    {template.title}
                  </ion-select-option>
                ))}
              </ion-select>
            </ion-item>
            <p style="font-size: 0.8rem; color: var(--ion-color-medium); margin: 0.25rem 1rem;">
              <Locale
                en="Assign a keypoint template to mark keypoints on this label (manage templates in Manage Keypoints)."
                zh_hk="指派關鍵點範本以在此標籤上標記關鍵點（在「管理關鍵點」管理範本）。"
                zh_cn="指派关键点模板以在此标签上标记关键点（在「管理关键点」管理模板）。"
              />
            </p>
          </ion-list>
          <div style="margin: 2rem 0">
            <ion-button type="submit" expand="block">
              <ion-icon name="add" slot="start"></ion-icon>
              Create Label
            </ion-button>
          </div>
          <p
            id="add-message"
            style="color: var(--ion-color-success); text-align: center; min-height: 2.5rem;"
          ></p>
          <p style="text-align: center; margin-top: 1rem;">
            <Link
              href={`/manage-labels?project=${project_id}`}
              tagName="ion-button"
              fill="outline"
              size="small"
            >
              <Locale
                en="Back to label list"
                zh_hk="返回標籤列表"
                zh_cn="返回标签列表"
              />
            </Link>
          </p>
        </form>
      </ion-content>
    </>
  )
}

let editPageTitle = <Locale en="Edit Label" zh_hk="編輯標籤" zh_cn="编辑标签" />

function EditPage(attrs: {}, context: DynamicContext) {
  let user = getAuthUser(context)
  if (!user) return <Redirect href="/login" />

  let project = getContextProject(context)
  if (!project) {
    return <NoProjectMessage />
  }
  let project_id = project.id!

  let fallbackUrl = `/manage-labels?project=${project_id}`

  let params = new URLSearchParams(context.routerMatch?.search ?? '')
  let label_id = +params.get('label_id')!
  if (!label_id) {
    return <Redirect href={fallbackUrl} />
  }

  let label = proxy.label[label_id]
  if (!label || label.project_id !== project_id) {
    return <Redirect href={fallbackUrl} />
  }

  if (project.creator_id !== user.id) {
    return <Redirect href={fallbackUrl} />
  }

  // Other labels in project for dependency dropdown, excluding self (proxy filter then exclude current), sorted by display_order
  let allProjectLabels = filter(proxy.label, { project_id })
  let labels = allProjectLabels.filter(l => l.id !== label_id)
  let sortedLabelsForEdit = [...labels].sort(
    (a, b) => (a.display_order ?? 999999) - (b.display_order ?? 999999),
  )

  // keypoint templates of this project for the template dropdown
  let templates = filter(proxy.keypoint_template, { project_id })

  // conflicting labels: candidates depend on whether this label is a parent or
  // a child (see getConflictCandidates), current selection from label_conflict
  let conflictCandidates = getConflictCandidates(label, project_id)
  let conflictIds = getConflictIds(label_id)
  let isParentLabel = !label.dependency_id

  return (
    <>
      <ion-header>
        <ion-toolbar>
          <IonBackButton
            href={`/manage-labels?project=${project_id}`}
            backText={pageTitle}
          />
          <ion-title role="heading" aria-level="1">
            <ProjectPageTitle t={editPageTitle} short />
          </ion-title>
        </ion-toolbar>
      </ion-header>
      <ion-content class="ion-padding">
        <form
          method="POST"
          action={`/manage-labels/modify?project=${project_id}&label_id=${label_id}`}
          onsubmit="emitForm(event)"
        >
          <ion-list>
            <ion-item>
              <ion-input
                name="title"
                label="Label Name*:"
                label-placement="floating"
                required
                minlength="1"
                maxlength="100"
                value={label.title}
              />
            </ion-item>
            <p style="font-size: 0.8rem; color: var(--ion-color-medium); margin: 0.25rem 1rem;">
              (1-100 characters)
            </p>
            <ion-item>
              <ion-select
                name="dependency_id"
                label="Parent Label (optional):"
                label-placement="floating"
                interface="popover"
                value={label.dependency_id ?? ''}
              >
                <ion-select-option value="">No parent</ion-select-option>
                {mapArray(sortedLabelsForEdit, l => (
                  <ion-select-option value={l.id}>{l.title}</ion-select-option>
                ))}
              </ion-select>
            </ion-item>
            <ion-item>
              <ion-select
                name="keypoint_template_id"
                label="Keypoint Template (optional):"
                label-placement="floating"
                interface="popover"
                value={label.keypoint_template_id ?? ''}
              >
                <ion-select-option value="">None</ion-select-option>
                {mapArray(templates, template => (
                  <ion-select-option value={template.id}>
                    {template.title}
                  </ion-select-option>
                ))}
              </ion-select>
            </ion-item>
            {isParentLabel && (
              <>
                <ion-item>
                  <ion-toggle
                    name="mutually_exclusive"
                    checked={!!label.mutually_exclusive}
                  >
                    Children are mutually exclusive
                  </ion-toggle>
                </ion-item>
                <p style="font-size: 0.8rem; color: var(--ion-color-medium); margin: 0.25rem 1rem;">
                  <Locale
                    en="When set, only one child label under this parent can be marked yes per image (selecting one clears the others)."
                    zh_hk="設定後，此父標籤下的子標籤只能有一個為「是」（選擇其中一個會自動清除其他）。"
                    zh_cn="设置后，此父标签下的子标签只能有一个为「是」（选择其中一个会自动清除其他）。"
                  />
                </p>
              </>
            )}
          </ion-list>
          <div style="margin: 2rem 0">
            <ion-button type="submit" expand="block">
              <ion-icon name="save" slot="start"></ion-icon>
              <Locale en="Save Changes" zh_hk="儲存變更" zh_cn="保存更改" />
            </ion-button>
          </div>
          <p
            id="edit-message"
            style="color: var(--ion-color-primary); text-align: center;"
          ></p>
        </form>

        {/* Conflict settings: separate form so saving conflicts does not
            submit the label fields above */}
        <h3 style="margin-top: 2rem">
          <Locale en="Conflicting Labels" zh_hk="衝突標籤" zh_cn="冲突标签" />
        </h3>
        <p style="font-size: 0.8rem; color: var(--ion-color-medium); margin: 0.25rem 0 1rem;">
          {isParentLabel ? (
            <Locale
              en="This is a parent label, so it can only conflict with other parent labels."
              zh_hk="這是父標籤，因此只能與其他父標籤衝突。"
              zh_cn="这是父标签，因此只能与其他父标签冲突。"
            />
          ) : (
            <Locale
              en="This is a child label, so it can only conflict with children of the same parent."
              zh_hk="這是子標籤，因此只能與同一父標籤下的其他子標籤衝突。"
              zh_cn="这是子标签，因此只能与同一父标签下的其他子标签冲突。"
            />
          )}
        </p>
        {conflictCandidates.length === 0 ? (
          <p style="color: var(--ion-color-medium)">
            <Locale
              en="No labels available to set as conflicting."
              zh_hk="沒有可設定衝突的標籤。"
              zh_cn="没有可设置冲突的标签。"
            />
          </p>
        ) : (
          <form
            id="conflict-form"
            method="POST"
            onsubmit="emitForm(event)"
            action={`/manage-labels/set-conflicts?project=${project_id}&label_id=${label_id}`}
          >
            <ion-list>
              {mapArray(conflictCandidates, other => (
                <ion-item>
                  <ion-checkbox
                    name="conflict_ids"
                    value={other.id}
                    checked={conflictIds.includes(other.id!)}
                  >
                    <ion-label>{other.title}</ion-label>
                  </ion-checkbox>
                </ion-item>
              ))}
            </ion-list>
            <div style="margin: 1.5rem 0">
              <ion-button type="submit" expand="block" color="warning">
                <ion-icon name="git-compare-outline" slot="start"></ion-icon>
                <Locale
                  en="Save Conflicts"
                  zh_hk="儲存衝突設定"
                  zh_cn="保存冲突设置"
                />
              </ion-button>
            </div>
            <p
              id="conflict-message"
              style="color: var(--ion-color-success); text-align: center; min-height: 2.5rem;"
            ></p>
          </form>
        )}
      </ion-content>
    </>
  )
}

let submitParser = object({
  title: string({ minLength: 1, maxLength: 100 }),
  dependency_id: string(),
  keypoint_template_id: string(),
})

function Submit(attrs: {}, context: WsContext) {
  try {
    let user = getAuthUser(context)
    if (!user) throw 'You must be logged in'

    let project = getContextProject(context)
    if (!project) throw 'Project not found'
    let project_id = project.id!

    let body = getContextFormBody(context)
    let input = submitParser.parse(body)

    // Check project access
    if (project.creator_id !== user.id)
      throw 'You do not have permission to add labels to this project'

    // Check if label with same title already exists in this project (use proxy find, not array loop)
    let existingLabel = find(proxy.label, {
      project_id,
      title: input.title,
    })
    if (existingLabel)
      throw `Label "${input.title}" already exists in this project`

    let dependency_id =
      input.dependency_id &&
      input.dependency_id.trim() &&
      input.dependency_id !== '0'
        ? +input.dependency_id
        : null
    if (dependency_id && dependency_id > 0) {
      let dependency = proxy.label[dependency_id]
      if (!dependency) {
        throw 'Selected parent label does not exist'
      }
      if (dependency.project_id !== project_id) {
        throw 'Invalid parent label'
      }
    }

    let projectLabels = filter(proxy.label, { project_id })
    let maxOrder = 0
    for (let i = 0; i < projectLabels.length; i++) {
      let o = projectLabels[i].display_order
      if (o != null && o > maxOrder) maxOrder = o
    }

    let keypoint_template_id = resolveTemplateId(
      input.keypoint_template_id,
      project_id,
    )

    let label_id = proxy.label.push({
      title: input.title,
      dependency_id: dependency_id,
      project_id: project_id,
      display_order: maxOrder + 1,
      keypoint_template_id,
      children_collapsed: null,
      mutually_exclusive: null,
    })

    // Stay on page: show hint and clear form so user can add another or go back
    context.ws.send([
      'eval',
      [
        'var msg = document.querySelector("#add-message");',
        'if (msg) msg.textContent = "Label created. Add another below or click Back to label list.";',
        'var form = document.querySelector("#add-label-form");',
        'if (form) { form.reset(); }',
      ].join(' '),
    ])

    throw EarlyTerminate
  } catch (error) {
    if (error === EarlyTerminate) throw EarlyTerminate
    console.error(error)
    context.ws.send([
      'eval',
      `document.querySelector("#add-message").textContent = "${String(error).replace(/"/g, '\\"')}"`,
    ])
    throw EarlyTerminate
  }
}

let modifyParser = object({
  title: string({ minLength: 1, maxLength: 100 }),
  dependency_id: string(),
  keypoint_template_id: string(),
  // ion-toggle unchecked submits nothing — default to false when absent
  mutually_exclusive: optional(boolean()),
})

// resolve the keypoint_template_id from a form string ('' or '0' -> null)
function resolveTemplateId(value: string, project_id: number): null | number {
  if (!value || !value.trim() || value === '0') return null
  let template_id = +value
  if (!template_id) throw 'Invalid keypoint template'
  let template = proxy.keypoint_template[template_id]
  if (!template || template.project_id !== project_id) {
    throw 'Invalid keypoint template'
  }
  return template_id
}

function ModifyLabel(attrs: {}, context: WsContext) {
  try {
    let user = getAuthUser(context)
    if (!user) throw 'You must be logged in'

    let project = getContextProject(context)
    if (!project) throw 'Project not found'
    let project_id = project.id!

    let params = new URLSearchParams(context.routerMatch?.search ?? '')
    let label_id = +params.get('label_id')!
    if (!label_id) throw 'Invalid label'

    let label = proxy.label[label_id]
    if (!label || label.project_id !== project_id) {
      throw 'Label not found'
    }
    if (project.creator_id !== user.id) {
      throw 'You do not have permission to edit labels in this project'
    }

    let body = getContextFormBody(context)
    let input = modifyParser.parse(body)

    let dependency_id =
      input.dependency_id &&
      input.dependency_id.trim() &&
      input.dependency_id !== '0'
        ? +input.dependency_id
        : null
    if (dependency_id && dependency_id > 0) {
      if (dependency_id === label_id) throw 'A label cannot depend on itself'
      let dependency = proxy.label[dependency_id]
      if (!dependency) {
        throw 'Selected parent label does not exist'
      }
      if (dependency.project_id !== project_id) {
        throw 'Invalid parent label'
      }
    }

    label.title = input.title
    label.dependency_id = dependency_id
    label.keypoint_template_id = resolveTemplateId(
      input.keypoint_template_id,
      project_id,
    )
    // group flag only meaningful on parents; clear it when the label becomes
    // a child so a stale flag never leaks into the conflict map
    label.mutually_exclusive =
      !dependency_id && input.mutually_exclusive === true ? true : null

    context.ws.send(['update-text', `#label-title-${label_id}`, input.title])
    context.ws.send(['redirect', `/manage-labels?project=${project_id}`])
    throw EarlyTerminate
  } catch (error) {
    if (error === EarlyTerminate) throw EarlyTerminate
    console.error(error)
    context.ws.send([
      'eval',
      `document.querySelector("#edit-message").textContent = "${String(error).replace(/"/g, '\\"')}"`,
    ])
    throw EarlyTerminate
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
          <IonBackButton href="/manage-labels/add" backText="Form" />
          <ion-title role="heading" aria-level="1">
            Submitted {pageTitle}
          </ion-title>
        </ion-toolbar>
      </ion-header>
      <ion-content id="AddManageLabels" class="ion-padding">
        {error ? (
          renderError(error, context)
        ) : (
          <>
            <p>Your submission is received (#{id}).</p>
            <Link href="/manage-labels" tagName="ion-button">
              Back to {pageTitle}
            </Link>
          </>
        )}
      </ion-content>
    </>
  )
}

function Delete(attrs: {}, context: WsContext) {
  try {
    let parser = object({
      label_id: int(),
      project_id: int(),
    })

    let user = getAuthUser(context)
    if (!user) throw 'You must be logged in'

    let body = getContextFormBody(context)
    let input = parser.parse(body)
    let project_id = input.project_id

    // Check if project exists and user has access
    let project = proxy.project[project_id]
    if (!project) throw 'Project not found'
    if (project.creator_id !== user.id)
      throw 'You do not have permission to delete labels from this project'

    // Check if label exists and belongs to this project
    let label = proxy.label[input.label_id]
    if (!label || label.project_id !== project_id) throw 'Label not found'

    // Remove conflict rows referencing this label (both directions) so no
    // dangling pairs are left behind
    let conflicts = [
      ...filter(proxy.label_conflict, { label_a_id: input.label_id }),
      ...filter(proxy.label_conflict, { label_b_id: input.label_id }),
    ]
    for (let row of conflicts) {
      delete proxy.label_conflict[row.id!]
    }

    // Delete the label
    delete proxy.label[input.label_id]

    context.ws.send([
      'eval',
      'location.reload()', // Reload the page to show updated list
    ])

    throw EarlyTerminate
  } catch (error) {
    if (error === EarlyTerminate) throw EarlyTerminate
    console.error(error)
    context.ws.send(['eval', `alert("${String(error).replace(/"/g, '\\"')}")`])
    throw EarlyTerminate
  }
}

let reorderParser = object({
  project_id: int(),
  label_id: int(),
  direction: string(),
})

function ReorderLabel(attrs: {}, context: WsContext) {
  try {
    let user = getAuthUser(context)
    if (!user) throw 'You must be logged in'

    let body = getContextFormBody(context)
    let input = reorderParser.parse(body)
    let project_id = input.project_id
    let label_id = input.label_id
    let direction = input.direction
    if (direction !== 'up' && direction !== 'down') throw 'Invalid direction'

    let project = proxy.project[project_id]
    let label = proxy.label[label_id]
    if (!project || !label || label.project_id !== project_id) {
      throw 'Label not found'
    }
    if (project.creator_id !== user.id) {
      throw 'You do not have permission to reorder labels in this project'
    }

    // Tree-aware reorder: parents move among parents (their children follow
    // them), children move among siblings of the same parent.
    // display_order is swapped within the group, then the whole list is
    // re-rendered server-side so children always stay attached to their
    // parent in the correct position (no fragile DOM block swapping).
    let labels = filter(proxy.label, { project_id })
    let isChild = !!label.dependency_id
    let parents = labels.filter(l => !l.dependency_id)
    parents.sort(
      (a, b) => (a.display_order ?? 999999) - (b.display_order ?? 999999),
    )
    let childrenByParent = new Map<number, typeof parents>()
    for (let l of labels) {
      if (!l.dependency_id) continue
      let list = childrenByParent.get(l.dependency_id) || []
      list.push(l)
      childrenByParent.set(l.dependency_id, list)
    }
    for (let list of childrenByParent.values()) {
      list.sort(
        (a, b) => (a.display_order ?? 999999) - (b.display_order ?? 999999),
      )
    }

    if (isChild) {
      // swap within siblings of the same parent
      let siblings = childrenByParent.get(label.dependency_id!) || []
      let idx = siblings.findIndex(l => l.id === label_id)
      if (idx < 0) throw 'Label not in project list'
      let swapIdx = direction === 'up' ? idx - 1 : idx + 1
      if (swapIdx < 0 || swapIdx >= siblings.length) throw 'Cannot move further'
      let other = siblings[swapIdx]!
      let aOrder = label.display_order ?? 999999
      let bOrder = other.display_order ?? 999999
      label.display_order = bOrder
      other.display_order = aOrder
    } else {
      // swap the parent with the adjacent parent; children follow because the
      // list is re-rendered with children attached to their parent
      let idx = parents.findIndex(l => l.id === label_id)
      if (idx < 0) throw 'Label not in project list'
      let swapIdx = direction === 'up' ? idx - 1 : idx + 1
      if (swapIdx < 0 || swapIdx >= parents.length) throw 'Cannot move further'
      let other = parents[swapIdx]!
      let aOrder = label.display_order ?? 999999
      let bOrder = other.display_order ?? 999999
      label.display_order = bOrder
      other.display_order = aOrder
    }

    // Re-render the whole list from the DB (children follow their parent,
    // collapsed states respected)
    let sortedLabels = [...labels].sort(
      (a, b) => (a.display_order ?? 999999) - (b.display_order ?? 999999),
    )
    let parentList = sortedLabels.filter(l => !l.dependency_id)
    let childMap = new Map<number, typeof sortedLabels>()
    for (let l of sortedLabels) {
      if (!l.dependency_id) continue
      let list = childMap.get(l.dependency_id) || []
      list.push(l)
      childMap.set(l.dependency_id, list)
    }
    let conflictMap = getProjectConflictMap(project_id)
    context.ws.send([
      'update-in',
      'ion-list.hover-list',
      nodeToVNode(
        <ion-list class="hover-list">
          {mapArray(parentList, parent => (
            <>
              <LabelItem
                label={parent}
                project_id={project_id}
                conflictMap={conflictMap}
                childCount={(childMap.get(parent.id!) || []).length}
              />
              {parent.children_collapsed
                ? null
                : mapArray(childMap.get(parent.id!) || [], child => (
                    <LabelItem
                      label={child}
                      project_id={project_id}
                      conflictMap={conflictMap}
                      isChild
                    />
                  ))}
            </>
          ))}
        </ion-list>,
        context,
      ),
    ])
    throw EarlyTerminate
  } catch (error) {
    if (error === EarlyTerminate) throw EarlyTerminate
    console.error(error)
    context.ws.send(['eval', `alert("${String(error).replace(/"/g, '\\"')}")`])
    throw EarlyTerminate
  }
}

let toggleChildrenParser = object({
  label_id: int(),
  project_id: int(),
  collapsed: boolean(),
})

// Toggles whether a parent's children are shown in the label list
function ToggleChildren(attrs: {}, context: WsContext) {
  try {
    let user = getAuthUser(context)
    if (!user) throw 'You must be logged in'

    let body = getContextFormBody(context)
    let input = toggleChildrenParser.parse(body)
    let project_id = input.project_id

    let project = proxy.project[project_id]
    let label = proxy.label[input.label_id]
    if (!project || !label || label.project_id !== project_id) {
      throw 'Label not found'
    }
    if (project.creator_id !== user.id) {
      throw 'You do not have permission to edit labels in this project'
    }

    label.children_collapsed = input.collapsed

    // Re-render the whole list server-side (simplest correct way to show/hide
    // the children block and update the toggle icon)
    let labels = filter(proxy.label, { project_id })
    let sortedLabels = [...labels].sort(
      (a, b) => (a.display_order ?? 999999) - (b.display_order ?? 999999),
    )
    let parents = sortedLabels.filter(l => !l.dependency_id)
    let childrenByParent = new Map<number, typeof sortedLabels>()
    for (let l of sortedLabels) {
      if (!l.dependency_id) continue
      let list = childrenByParent.get(l.dependency_id) || []
      list.push(l)
      childrenByParent.set(l.dependency_id, list)
    }
    let conflictMap = getProjectConflictMap(project_id)

    context.ws.send([
      'update-in',
      'ion-list.hover-list',
      nodeToVNode(
        <ion-list class="hover-list">
          {mapArray(parents, parent => (
            <>
              <LabelItem
                label={parent}
                project_id={project_id}
                conflictMap={conflictMap}
                childCount={(childrenByParent.get(parent.id!) || []).length}
              />
              {parent.children_collapsed
                ? null
                : mapArray(childrenByParent.get(parent.id!) || [], child => (
                    <LabelItem
                      label={child}
                      project_id={project_id}
                      conflictMap={conflictMap}
                      isChild
                    />
                  ))}
            </>
          ))}
        </ion-list>,
        context,
      ),
    ])
    throw EarlyTerminate
  } catch (error) {
    if (error === EarlyTerminate) throw EarlyTerminate
    console.error(error)
    context.ws.send(['eval', `alert("${String(error).replace(/"/g, '\\"')}")`])
    throw EarlyTerminate
  }
}

// Replaces the full conflict set of one label. The client sends every checked
// candidate id, so unchecked ones are removed and checked ones added.
function SetConflicts(attrs: {}, context: WsContext) {
  try {
    let user = getAuthUser(context)
    if (!user) throw 'You must be logged in'

    let project = getContextProject(context)
    if (!project) throw 'Project not found'
    let project_id = project.id!

    let params = new URLSearchParams(context.routerMatch?.search ?? '')
    let label_id = +params.get('label_id')!
    if (!label_id) throw 'Invalid label'

    let label = proxy.label[label_id]
    if (!label || label.project_id !== project_id) throw 'Label not found'
    if (project.creator_id !== user.id) {
      throw 'You do not have permission to edit labels in this project'
    }

    // ion-checkbox with the same name submits repeated keys; read them all
    let body = getContextFormBody(context)
    let raw = (body as Record<string, unknown>).conflict_ids
    let values = raw == null ? [] : Array.isArray(raw) ? raw : [raw]
    let wanted = new Set<number>()
    for (let value of values) {
      let id = +String(value)
      if (!id) continue
      let other = proxy.label[id]
      if (!other) throw 'Selected conflicting label does not exist'
      assertConflictAllowed(label, other, project_id)
      wanted.add(id)
    }

    // remove conflicts that are no longer selected (both directions)
    let existing = [
      ...filter(proxy.label_conflict, { label_a_id: label_id }),
      ...filter(proxy.label_conflict, { label_b_id: label_id }),
    ]
    for (let row of existing) {
      let otherId =
        row.label_a_id === label_id ? row.label_b_id : row.label_a_id
      if (!wanted.has(otherId)) delete proxy.label_conflict[row.id!]
    }

    // add newly selected conflicts, normalised so label_a_id < label_b_id
    let current = new Set(getConflictIds(label_id))
    for (let otherId of wanted) {
      if (current.has(otherId)) continue
      let a = Math.min(label_id, otherId)
      let b = Math.max(label_id, otherId)
      proxy.label_conflict.push({
        project_id,
        label_a_id: a,
        label_b_id: b,
      })
    }

    context.ws.send([
      'eval',
      `var msg = document.querySelector("#conflict-message");
       if (msg) msg.textContent = "Conflicts saved.";`,
    ])
    throw EarlyTerminate
  } catch (error) {
    if (error === EarlyTerminate) throw EarlyTerminate
    console.error(error)
    context.ws.send([
      'eval',
      `var msg = document.querySelector("#conflict-message");
       if (msg) { msg.style.color = "var(--ion-color-danger)"; msg.textContent = "${String(error).replace(/"/g, '\\"')}"; }`,
    ])
    throw EarlyTerminate
  }
}

let routes = {
  '/manage-labels': {
    title: <ProjectPageTitle t={pageTitle} />,
    description: 'Manage labels for annotation',
    node: page,
  },
  '/manage-labels/add': {
    title: <ProjectPageTitle t={addPageTitle} />,
    description: 'Add a new label',
    node: <AddPage />,
    layout_type: LayoutType.ionic,
  },
  '/manage-labels/add/submit': {
    title: apiEndpointTitle,
    description: 'Submit new label',
    node: <Submit />,
    streaming: false,
  },
  '/manage-labels/edit': {
    title: <ProjectPageTitle t={editPageTitle} />,
    description: 'Edit label name and parent',
    node: <EditPage />,
    layout_type: LayoutType.ionic,
  },
  '/manage-labels/modify': {
    title: apiEndpointTitle,
    description: 'Update label',
    node: <ModifyLabel />,
    streaming: false,
  },
  '/manage-labels/delete': {
    title: apiEndpointTitle,
    description: 'Delete a label',
    node: <Delete />,
    streaming: false,
  },
  '/manage-labels/reorder': {
    title: apiEndpointTitle,
    description: 'Change label order',
    node: <ReorderLabel />,
    streaming: false,
  },
  '/manage-labels/toggle-children': {
    title: apiEndpointTitle,
    description: 'Show or hide a parent label children',
    node: <ToggleChildren />,
    streaming: false,
  },
  '/manage-labels/set-conflicts': {
    title: apiEndpointTitle,
    description: 'Set conflicting labels',
    node: <SetConflicts />,
    streaming: false,
  },
} satisfies Routes

export default { routes }
