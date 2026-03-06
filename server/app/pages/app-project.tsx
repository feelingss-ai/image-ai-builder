import { o } from '../jsx/jsx.js'
import { PageRoute, Routes } from '../routes.js'
import { apiEndpointTitle, LayoutType, title } from '../../config.js'
import Style from '../components/style.js'
import {
  Context,
  WsContext,
  getContextFormBody,
  DynamicContext,
} from '../context.js'
import { mapArray } from '../components/fragment.js'
import { appIonTabBar } from '../components/app-tab-bar.js'
import { fitIonFooter, selectIonTab } from '../styles/mobile-style.js'
import { Locale, Title } from '../components/locale.js'
import { IonBackButton } from '../components/ion-back-button.js'
import { IonButton } from '../components/ion-button.js'
import { Script } from '../components/script.js'
import { getAuthUser, getAuthUserId } from '../auth/user.js'
import { int, object, string } from 'cast.ts'
import { EarlyTerminate } from '../../exception.js'
import { proxy } from '../../../db/proxy.js'
import { nodeToVNode } from '../jsx/vnode.js'
import { db } from '../../../db/db.js'
import { ServerMessage } from '../../../client/types.js'
import { sessions } from '../session.js'
import { Link, Redirect } from '../components/router.js'
import { pick, del, filter, find, count } from 'better-sqlite3-proxy'
import { mkdirSync, rmSync } from 'fs'
import { IonItem } from '../components/ion-item.js'

let pageTitle = <Locale en="Project List" zh_hk="項目列表" zh_cn="项目列表" />
let manageMemberTitle = (
  <Locale en="Manage Member" zh_hk="管理成員" zh_cn="管理成员" />
)

let style = Style(/* css */ `
#Project {

}

ion-item {
  cursor: pointer;
  border-radius: 10px;
  transition: all 0.3s ease;
  margin: 10px;
  overflow: visible;
  &:hover {
    transform: scale(1.02);
    box-shadow: 0 6px 20px rgba(0,0,0,0.15);
    z-index: 10;
  }
}

.project-title--stats {
  font-size: 0.9rem;
}
`)

let script = Script(/* js */ `

alert = document.querySelector('#please-enter-new-project-name-alert')

// get new project name by alert input
function create_modify_project_alert(event) {
  event.stopPropagation()
  let project_id = event.target.id
  let new_project_name = ''

  alert.buttons = [{text:'OK', handler: (event) => {
    new_project_name = event[0]
    emit('/project/modify-project', {project_id: project_id, project_name: new_project_name})

  }}, {text:'Cancel', role: 'cancel'}];

  alert.inputs = [
    {
    },
  ];

    alert.present()
  }

  //send new project name to server
function create_project() {
  let new_project_name = document.querySelector('#new-project-name').value
  if (new_project_name.trim() === '') {
    document.querySelector('#project-name-empty-alert').present()
  } else {
    emit('/project/add-project', {project_name: new_project_name})
    document.querySelector('#new-project-name').value = ''
  }
}

  //send delete project id to server
function delete_project(event) {
  event.stopPropagation()
  let project_id = event.target.id
  emit('/project/delete-project', {project_id: project_id})
}

function manage_member(event) {
  event.stopPropagation()
  event.preventDefault()
  let project_id = event.target.id
  const url = new URL(window.location)
  url.searchParams.set('project', project_id)
  window.history.pushState({}, '', url)
  emit('/app/project/manage-member', { project_id: project_id })
}

// TODO use alert to confirm the deletion
function delete_member(event) {
  event.stopPropagation()
  event.preventDefault()
  let member_id = event.target.id
  let project_id = +event.target.dataset.project_id
  emit('/project/delete-member', {
    user_id: member_id,
    project_id: project_id,
  })
}

function add_member(event) {
  event.stopPropagation()
  event.preventDefault()
  let new_member_name = document.querySelector('#new-member-name').value
  let project_id = +event.target.dataset.project_id
  emit('/project/add-member', {
    project_id: project_id,
    member_name: new_member_name,
  })
}
`)

let page = (
  <>
    {style}
    <ion-header>
      <ion-toolbar color="primary">
        <ion-title role="heading" aria-level="1">
          {pageTitle}
        </ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content id="Project" class="ion-padding">
      <Main />
    </ion-content>
    {script}
    <ion-footer>
      {appIonTabBar}
      {selectIonTab('project')}
    </ion-footer>
    {fitIonFooter}
  </>
)

let manage_member_page = (
  <>
    {style}
    <ion-header>
      <ion-toolbar>
        <IonBackButton href="/app/project" backText="Project" />
        <ion-title role="heading" aria-level="1">
          {manageMemberTitle}
        </ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content id="ManageMember" class="ion-padding">
      <ManageMember />
    </ion-content>
  </>
)

//generate project item with title, id and user_id
function ProjectItem(attrs: { id: number; user_id: number }) {
  let project_id = attrs.id
  let project = proxy.project[project_id]

  // if user is creator, show add member button
  let is_owner = project.creator_id == attrs.user_id

  let title = project.title

  let label_count = count(proxy.label, { project_id })
  let image_count = count(proxy.image, { project_id })

  return (
    <IonItem
      id={`project-item-${project_id}`}
      url={`/app/home?project=${project_id}`}
    >
      <h2 id={`project-title-${attrs.id}`}>
        {title}{' '}
        <span class="project-title--stats">
          ({label_count || 'no'}{' '}
          <Locale en="labels" zh_hk="標籤" zh_cn="标签" />,{' '}
          {image_count || 'no'} <Locale en="images" zh_hk="圖片" zh_cn="图片" />{' '}
          )
        </span>
      </h2>
      {is_owner ? (
        <div style="margin-top: 10px; margin-left: auto; display: flex; gap: 8px;">
          {/* edit member list */}
          <ion-button
            id={attrs.id}
            onclick="manage_member(event)"
            color="warning"
          >
            <ion-icon name="person-outline"></ion-icon>
          </ion-button>

          {/* edit project */}
          <ion-button
            id={attrs.id}
            onclick="create_modify_project_alert(event)"
          >
            <ion-icon name="create-outline"></ion-icon>
          </ion-button>

          {/* delete project */}
          <ion-button
            id={attrs.id}
            color="danger"
            onclick="delete_project(event)"
          >
            <ion-icon name="trash-outline"></ion-icon>
          </ion-button>
        </div>
      ) : null}
    </IonItem>
  )
}

//generate member item with username, id and project_id
function MemberItem(attrs: {
  user_id: number
  username: string
  project_id: number
}) {
  let project = proxy.project[attrs.project_id]
  let is_owner = project.creator_id == attrs.user_id
  return (
    <ion-item id={`member-item-${attrs.user_id}`}>
      <h2 id={`member-title-${attrs.user_id}`}>{attrs.username}</h2>
      {/* if user is not owner, show delete button */}
      {!is_owner ? (
        <div style="margin-top: 10px; margin-left: auto; display: flex; gap: 8px;">
          <ion-button
            id={attrs.user_id}
            data-project_id={attrs.project_id}
            color="danger"
            onclick="delete_member(event)"
          >
            <ion-icon name="trash-outline"></ion-icon>
          </ion-button>
        </div>
      ) : null}
    </ion-item>
  )
}

function Main(attrs: {}, context: Context) {
  let user = getAuthUser(context)
  let user_id = getAuthUserId(context)
  if (!user) {
    return (
      <>
        <div style="margin: auto; width: fit-content; text-align: center;">
          <p class="ion-padding ion-margin error">
            <Locale
              en="You must be logged in to select project"
              zh_hk="您必須登入才能選擇項目"
              zh_cn="您必须登录才能选择项目"
            />
          </p>
          <IonButton url="/login" color="primary">
            <Locale en="Login" zh_hk="登入" zh_cn="登录" />
          </IonButton>
        </div>
      </>
    )
  }
  let projects = filter(proxy.project_member, { user_id: user_id! }).map(
    row => row.project!,
  )
  return (
    <>
      <ion-input
        id="new-project-name"
        label={Locale(
          {
            en: 'New Project Name',
            zh_hk: '新項目名稱',
            zh_cn: '新项目名称',
          },
          context,
        )}
        placeholder="e.g. Horse Pose Detection"
      ></ion-input>
      <ion-alert
        id="project-name-empty-alert"
        header={Locale(
          {
            en: 'Project name cannot be empty',
            zh_hk: '項目名稱不能為空',
            zh_cn: '项目名称不能为空',
          },
          context,
        )}
      ></ion-alert>
      <ion-alert
        id="project-exist-alert"
        header={Locale(
          {
            en: 'Project already exists',
            zh_hk: '項目已存在',
            zh_cn: '项目已存在',
          },
          context,
        )}
      ></ion-alert>
      <ion-button onclick="create_project()">
        <ion-icon name="add"></ion-icon>
        <Locale en="Create New Project" zh_hk="新增項目" zh_cn="新增项目" />
      </ion-button>
      <ion-list id="project-list">
        {mapArray(projects, project => (
          <ProjectItem id={project.id!} user_id={user_id!} />
        ))}
      </ion-list>
      <ion-alert
        id="unauthorized-alert"
        header={Locale(
          {
            en: 'You are not authorized to access this project',
            zh_hk: '您無權限存取此項目',
            zh_cn: '您无权限访问此项目',
          },
          context,
        )}
      ></ion-alert>
      <ion-alert
        id="please-enter-new-project-name-alert"
        header={Locale(
          {
            en: 'Please Enter New Project Name',
            zh_hk: '請輸入新項目名稱',
            zh_cn: '请输入新项目名称',
          },
          context,
        )}
      ></ion-alert>
    </>
  )
}

// TODO add field to mark if the project is public
function AddProject(attrs: {}, context: WsContext) {
  try {
    let parser = object({
      project_name: string(),
    })

    let user_id = getAuthUserId(context)
    let body = getContextFormBody(context)
    let input = parser.parse(body)

    if (find(proxy.project, { title: input.project_name })) {
      context.ws.send([
        'eval',
        'document.querySelector("#project-exist-alert").present()',
      ])
    } else {
      let project_id = proxy.project.push({
        title: input.project_name,
        creator_id: user_id!,
      })

      proxy.project_member.push({
        project_id,
        user_id: user_id!,
      })

      let new_project_item = <ProjectItem id={project_id} user_id={user_id!} />

      mkdirSync(`saved_models/project-${project_id}`, { recursive: true })
      mkdirSync(`saved_models/project-${project_id}/latest`, {
        recursive: true,
      })
      mkdirSync(`saved_models/project-${project_id}/best`, {
        recursive: true,
      })
      context.ws.send([
        'append',
        'ion-list',
        nodeToVNode(new_project_item, context),
      ])
    }
  } catch (error) {
    console.error(error)
  }
  throw EarlyTerminate
}

function ModifyProject(attrs: {}, context: DynamicContext) {
  try {
    let parser = object({
      project_id: int(),
      project_name: string(),
    })

    let body = getContextFormBody(context)
    let input = parser.parse(body)

    proxy.project[input.project_id].title = input.project_name

    broadcast([
      'update-text',
      '#project-title-' + input.project_id,
      input.project_name,
    ])
  } catch (error) {
    console.error(error)
  }
  throw EarlyTerminate
}

function DeleteProject(attrs: {}, context: DynamicContext) {
  try {
    let parser = object({
      project_id: int(),
    })

    let body = getContextFormBody(context)
    let input = parser.parse(body)

    del(proxy.project_member, { project_id: input.project_id })

    delete proxy.project[input.project_id]

    broadcast(['remove', '#project-item-' + input.project_id])

    rmSync(`saved_models/project-${input.project_id}`, {
      recursive: true,
      force: true,
    })
  } catch (error) {
    console.error(error)
  }
  throw EarlyTerminate
}

//get all user_id that is in the project like 1,2,3
let get_current_project_member = db
  .prepare<{ project_id: number }, number>(
    /* sql */ `
    select user_id from project_member where project_id = :project_id
  `,
  )
  .pluck()

function ManageMember(attrs: {}, context: DynamicContext) {
  let parser = object({
    project_id: int(),
  })

  let body = getContextFormBody(context)
  let input = parser.parse(body)

  let current_project_member = get_current_project_member.all({
    project_id: input.project_id,
  })

  let users = pick(proxy.user, ['id', 'username'])

  //example: user_list = [ { id: 1, username: 'ada' }, { id: 2, username: 'ada2' } ]
  let user_list = users.filter(user =>
    current_project_member.includes(user.id!),
  )

  return (
    <>
      <ion-input
        id="new-member-name"
        placeholder={Locale(
          {
            en: 'New Member Name',
            zh_hk: '新成員名稱',
            zh_cn: '新成员名称',
          },
          context,
        )}
      ></ion-input>
      <ion-button
        onclick="add_member(event)"
        data-project_id={input.project_id}
      >
        <ion-icon name="add"></ion-icon>
        <Locale en="Add Member" zh_hk="新增成員" zh_cn="新增成员" />
      </ion-button>
      <ion-alert
        id="user-not-found-alert"
        header={Locale(
          {
            en: 'User not found',
            zh_hk: '用戶不存在',
            zh_cn: '用户不存在',
          },
          context,
        )}
      ></ion-alert>
      <ion-alert
        id="user-exist-alert"
        header={Locale(
          {
            en: 'User already exists',
            zh_hk: '用戶已存在',
            zh_cn: '用户已存在',
          },
          context,
        )}
      ></ion-alert>
      <p>
        <Locale
          en="Current Project Member"
          zh_hk="當前項目成員"
          zh_cn="当前项目成员"
        />
      </p>
      <ion-list>
        {mapArray(user_list, user => (
          <MemberItem
            user_id={user.id!}
            username={user.username!}
            project_id={input.project_id}
          />
        ))}
      </ion-list>
    </>
  )
}

let delete_member = db.prepare<
  { user_id: number; project_id: number },
  void
>(/* sql */ `
    delete from project_member where user_id = :user_id and project_id = :project_id
  `)

function DeleteMember(attrs: {}, context: WsContext) {
  try {
    let parser = object({
      user_id: int(),
      project_id: int(),
    })

    let body = getContextFormBody(context)
    let input = parser.parse(body)

    delete_member.run({
      user_id: input.user_id,
      project_id: input.project_id,
    })

    // remove member from member list
    context.ws.send(['remove', 'ion-list #member-item-' + input.user_id])

    // remove project from project list
    sessions.forEach(session => {
      let user_id = session.ws.request.signedCookies.user_id
      if (user_id == input.user_id) {
        session.ws.send(['remove', '#project-item-' + input.project_id])
      }
    })
  } catch (error) {
    console.error(error)
  }
  throw EarlyTerminate
}

function AddMember(attrs: {}, context: WsContext) {
  try {
    let parser = object({
      project_id: int(),
      member_name: string(),
    })

    let body = getContextFormBody(context)
    let input = parser.parse(body)

    let user = find(proxy.user, { username: input.member_name })
    let user_id = user?.id
    let project_member_id = find(proxy.project_member, {
      user_id: user_id!,
      project_id: input.project_id,
    })

    if (!user_id) {
      context.ws.send([
        'eval',
        'document.querySelector("#user-not-found-alert").present()',
      ])
    } else if (project_member_id) {
      context.ws.send([
        'eval',
        'document.querySelector("#user-exist-alert").present()',
      ])
    } else {
      proxy.project_member.push({
        project_id: input.project_id,
        user_id: user_id!,
      })

      let new_member_item = (
        <MemberItem
          user_id={user_id!}
          username={input.member_name}
          project_id={input.project_id}
        />
      )

      let new_project_item = (
        <ProjectItem id={input.project_id} user_id={user_id!} />
      )
      context.ws.send([
        'append',
        'ion-list',
        nodeToVNode(new_member_item, context),
      ])
      send_to_user(user_id!, [
        'append',
        'ion-list',
        nodeToVNode(new_project_item, context),
      ])
    }
  } catch (error) {
    console.error(error)
  }
  throw EarlyTerminate
}

function broadcast(message: ServerMessage) {
  sessions.forEach(session => {
    if (
      session.url?.startsWith('/app/project') ||
      session.url?.startsWith('/project/') //like '/project/add-project'
    ) {
      session.ws.send(message)
    }
  })
}

function send_to_user(user_id: number, message: ServerMessage) {
  sessions.forEach(session => {
    if (session.ws.request.signedCookies.user_id == user_id) {
      session.ws.send(message)
    }
  })
}

let projectListRoute: PageRoute = {
  title: <Title t={pageTitle} />,
  description: 'TODO',
  node: page,
  layout_type: LayoutType.ionic,
}

let routes = {
  '/': projectListRoute,
  '/app/project': projectListRoute,
  '/app/project/manage-member': {
    title: <Title t={manageMemberTitle} />,
    description: 'TODO',
    node: manage_member_page,
    layout_type: LayoutType.ionic,
  },
  '/project/add-project': {
    title: apiEndpointTitle,
    description: 'TODO',
    node: <AddProject />,
    streaming: false,
  },
  '/project/modify-project': {
    title: apiEndpointTitle,
    description: 'TODO',
    node: <ModifyProject />,
    streaming: false,
  },
  '/project/delete-project': {
    title: apiEndpointTitle,
    description: 'TODO',
    node: <DeleteProject />,
    streaming: false,
  },
  '/project/delete-member': {
    title: apiEndpointTitle,
    description: 'TODO',
    node: <DeleteMember />,
    streaming: false,
  },
  '/project/add-member': {
    title: apiEndpointTitle,
    description: 'TODO',
    node: <AddMember />,
    streaming: false,
  },
} satisfies Routes

export default { routes }
