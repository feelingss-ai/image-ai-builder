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
import { ProjectPageBackButton } from '../components/back-to-project-home-button.js'
import { object, string, int } from 'cast.ts'
import { Link, Redirect } from '../components/router.js'
import { renderError } from '../components/error.js'
import { getAuthUser, getAuthUserId } from '../auth/user.js'
import { Locale, Title } from '../components/locale.js'
import { filter, find } from 'better-sqlite3-proxy'
import { proxy } from '../../../db/proxy.js'
import { db } from '../../../db/db.js'
import { Script } from '../components/script.js'
import { EarlyTerminate } from '../../exception.js'
import { nodeToVNode } from '../jsx/vnode.js'

let pageTitle = <Locale en="Manage Labels" zh_hk="管理標籤" zh_cn="管理标签" />
let addPageTitle = <Locale en="Add Label" zh_hk="添加標籤" zh_cn="添加标签" />

let style = Style(/* css */ `
#ManageLabels {

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
    <ion-content id="ManageLabels" class="ion-padding">
      <Main />
    </ion-content>
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

  let params = new URLSearchParams(context.routerMatch?.search)
  let project_id = +params.get('project')!
  if (!project_id) {
    return (
      <p>
        Invalid project. Please{' '}
        <Link href="/app/project">select a project</Link> first.
      </p>
    )
  }

  let project = proxy.project[project_id]
  if (!project) {
    return (
      <p>
        Project not found. Please{' '}
        <Link href="/app/project">select a valid project</Link>.
      </p>
    )
  }

  // Get labels for this project (use proxy filter for DB query, not array loop)
  let labels = filter(proxy.label, { project_id })
  let sortedLabels = [...labels].sort(
    (a, b) => (a.display_order ?? 999999) - (b.display_order ?? 999999)
  )

  return (
    <>
      <h2>Project: {project.title}</h2>

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

      {/* Labels list */}
      <h3>Labels ({sortedLabels.length})</h3>
      <ion-list>
        {mapArray(sortedLabels, (label, index) => (
          <LabelItem
            label={label}
            project_id={project_id}
            index={index}
            totalCount={sortedLabels.length}
          />
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
  index: number
  totalCount: number
}) {
  let label = attrs.label
  let project_id = attrs.project_id
  let index = attrs.index
  let totalCount = attrs.totalCount
  if (!label) return null
  let dependency = label.dependency
  let dependencyText = dependency ? ` (depends on: ${dependency.title})` : ''
  let canMoveUp = index > 0
  let canMoveDown = index < totalCount - 1

  return (
    <ion-item id={`label-item-${label.id}`}>
      <ion-label>
        <h2 id={`label-title-${label.id}`}>{label.title}</h2>
        <p>{dependencyText}</p>
      </ion-label>
      <div style="display: flex; gap: 4px; align-items: center;">
        <ion-button
          class="label-move-up"
          fill="clear"
          size="small"
          slot="end"
          title="Move up"
          disabled={!canMoveUp}
          onclick={canMoveUp ? `emit('/manage-labels/reorder', { label_id: ${label.id}, project_id: ${project_id}, direction: 'up' })` : undefined}
        >
          <ion-icon name="chevron-up-outline"></ion-icon>
        </ion-button>
        <ion-button
          class="label-move-down"
          fill="clear"
          size="small"
          slot="end"
          title="Move down"
          disabled={!canMoveDown}
          onclick={canMoveDown ? `emit('/manage-labels/reorder', { label_id: ${label.id}, project_id: ${project_id}, direction: 'down' })` : undefined}
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

  let params = new URLSearchParams(context.routerMatch?.search)
  let project_id = +params.get('project')!
  if (!project_id) {
    return <Redirect href="/app/project" />
  }

  let project = proxy.project[project_id]
  if (!project) {
    return <Redirect href="/app/project" />
  }

  // Get existing labels for parent selection (use proxy filter for DB query), sorted by display_order
  let labels = filter(proxy.label, { project_id })
  let sortedLabelsForSelect = [...labels].sort(
    (a, b) => (a.display_order ?? 999999) - (b.display_order ?? 999999)
  )

  return (
    <>
      <ion-header>
        <ion-toolbar>
          <IonBackButton
            href={`/manage-labels?project=${project_id}`}
            backText={pageTitle}
          />
          <ion-title role="heading" aria-level="1">
            {addPageTitle}
          </ion-title>
        </ion-toolbar>
      </ion-header>
      <ion-content class="ion-padding">
        <h2>Project: {project.title}</h2>

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
            <Link href={`/manage-labels?project=${project_id}`} tagName="ion-button" fill="outline" size="small">
              <Locale en="Back to label list" zh_hk="返回標籤列表" zh_cn="返回标签列表" />
            </Link>
          </p>
        </form>
      </ion-content>
    </>
  )
}

let editPageTitle = (
  <Locale en="Edit Label" zh_hk="編輯標籤" zh_cn="编辑标签" />
)

function EditPage(attrs: {}, context: DynamicContext) {
  let user = getAuthUser(context)
  if (!user) return <Redirect href="/login" />

  let params = new URLSearchParams(context.routerMatch?.search)
  let project_id = +params.get('project')!
  let label_id = +params.get('label_id')!
  if (!project_id || !label_id) {
    return <Redirect href="/app/project" />
  }

  let project = proxy.project[project_id]
  let label = proxy.label[label_id]
  if (!project || !label || label.project_id !== project_id) {
    return <Redirect href={`/manage-labels?project=${project_id}`} />
  }
  if (project.creator_id !== user.id) {
    return <Redirect href={`/manage-labels?project=${project_id}`} />
  }

  // Other labels in project for dependency dropdown, excluding self (proxy filter then exclude current), sorted by display_order
  let allProjectLabels = filter(proxy.label, { project_id })
  let labels = allProjectLabels.filter(l => l.id !== label_id)
  let sortedLabelsForEdit = [...labels].sort(
    (a, b) => (a.display_order ?? 999999) - (b.display_order ?? 999999)
  )

  return (
    <>
      <ion-header>
        <ion-toolbar>
          <IonBackButton
            href={`/manage-labels?project=${project_id}`}
            backText={pageTitle}
          />
          <ion-title role="heading" aria-level="1">
            {editPageTitle}
          </ion-title>
        </ion-toolbar>
      </ion-header>
      <ion-content class="ion-padding">
        <h2>Project: {project.title}</h2>

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
                  <ion-select-option value={l.id}>
                    {l.title}
                  </ion-select-option>
                ))}
              </ion-select>
            </ion-item>
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
      </ion-content>
    </>
  )
}


let submitParser = object({
  title: string({ minLength: 1, maxLength: 100 }),
  dependency_id: string(),
})

function Submit(attrs: {}, context: WsContext) {
  try {
    let user = getAuthUser(context)
    if (!user) throw 'You must be logged in'

    let params = new URLSearchParams(context.routerMatch?.search)
    let project_id = +params.get('project')!
    if (!project_id) throw 'Invalid project'

    let body = getContextFormBody(context)
    let input = submitParser.parse(body)

    // Check if project exists and user has access
    let project = proxy.project[project_id]
    if (!project) throw 'Project not found'
    if (project.creator_id !== user.id)
      throw 'You do not have permission to add labels to this project'

    // Check if label with same title already exists in this project (use proxy find, not array loop)
    let existingLabel = find(proxy.label, {
      project_id,
      title: input.title,
    })
    if (existingLabel)
      throw `Label "${input.title}" already exists in this project`

    let dependency_id = (input.dependency_id && input.dependency_id.trim() && input.dependency_id !== '0') ? +input.dependency_id : null
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

    let label_id = proxy.label.push({
      title: input.title,
      dependency_id: dependency_id,
      project_id: project_id,
      display_order: maxOrder + 1,
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
})

function ModifyLabel(attrs: {}, context: WsContext) {
  try {
    let user = getAuthUser(context)
    if (!user) throw 'You must be logged in'

    let params = new URLSearchParams(context.routerMatch?.search)
    let project_id = +params.get('project')!
    let label_id = +params.get('label_id')!
    if (!project_id || !label_id) throw 'Invalid project or label'

    let body = getContextFormBody(context)
    let input = modifyParser.parse(body)

    let project = proxy.project[project_id]
    let label = proxy.label[label_id]
    if (!project || !label || label.project_id !== project_id) {
      throw 'Label not found'
    }
    if (project.creator_id !== user.id) {
      throw 'You do not have permission to edit labels in this project'
    }

    let dependency_id = (input.dependency_id && input.dependency_id.trim() && input.dependency_id !== '0') ? +input.dependency_id : null
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

    context.ws.send([
      'update-text',
      `#label-title-${label_id}`,
      input.title,
    ])
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

    let labels = filter(proxy.label, { project_id })
    let sorted = [...labels].sort(
      (a, b) => (a.display_order ?? 999999) - (b.display_order ?? 999999)
    )
    let idx = sorted.findIndex(l => l.id === label_id)
    if (idx < 0) throw 'Label not in project list'
    let swapIdx = direction === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= sorted.length) throw 'Cannot move further'

    let other = sorted[swapIdx]
    let other_id = other!.id!
    let aOrder = label.display_order ?? 999999
    let bOrder = other!.display_order ?? 999999
    label.display_order = bOrder
    other!.display_order = aOrder

    let swapEval = `
(function(){
  var cur = document.getElementById('label-item-${label_id}');
  var other = document.getElementById('label-item-${other_id}');
  if (!cur || !other) return;
  var parent = cur.parentNode;
  if ('${direction}' === 'up') {
    parent.insertBefore(cur, other);
  } else {
    parent.insertBefore(cur, other.nextSibling);
  }
  var list = document.querySelector('#ManageLabels ion-list');
  if (!list) return;
  var items = list.querySelectorAll('ion-item[id^="label-item-"]');
  for (var i = 0; i < items.length; i++) {
    var up = items[i].querySelector('.label-move-up');
    var down = items[i].querySelector('.label-move-down');
    if (up) up.disabled = (i === 0);
    if (down) down.disabled = (i === items.length - 1);
  }
})();
`
    context.ws.send(['eval', swapEval])
    throw EarlyTerminate
  } catch (error) {
    if (error === EarlyTerminate) throw EarlyTerminate
    console.error(error)
    context.ws.send(['eval', `alert("${String(error).replace(/"/g, '\\"')}")`])
    throw EarlyTerminate
  }
}

let routes = {
  '/manage-labels': {
    title: <Title t={pageTitle} />,
    description: 'Manage labels for annotation',
    node: page,
  },
  '/manage-labels/add': {
    title: <Title t={addPageTitle} />,
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
    title: <Title t={editPageTitle} />,
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
} satisfies Routes

export default { routes }
