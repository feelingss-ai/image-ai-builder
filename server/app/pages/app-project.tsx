import { o } from '../jsx/jsx.js'
import { Routes } from '../routes.js'
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
import { Locale } from '../components/locale.js'
import { IonBackButton } from '../components/ion-back-button.js'
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
import { pick, del, filter } from 'better-sqlite3-proxy'

let pageTitle = 'Project'
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
`)

let script = Script(/* js */ `

alert = document.querySelector('ion-alert')

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
      placeholder: 'Project Name',
    },
  ];
    alert.present()
  }

  //send new project name to server
function create_project() {
  let new_project_name = document.querySelector('#new-project-name').value
  emit('/project/add-project', {project_name: new_project_name})
  document.querySelector('#new-project-name').value = ''
}

  //send delete project id to server
function delete_project(event) {
  event.stopPropagation()
  let project_id = event.target.id
  emit('/project/delete-project', {project_id: project_id})
}

  //send select project id to server
function select_project(project_id) {
  console.log('select_project', project_id)
  let project_id_num = project_id.split('-')[2]
  console.log('select_project', project_id_num)
  emit('/project/select-project', {project_id: project_id_num})
}

function manage_member(event) {
  event.stopPropagation()
  let project_id = event.target.id
  const url = new URL(window.location)
  url.searchParams.set('project_id', project_id)
  window.history.pushState({}, '', url)
  emit('/app/project/manage-member', { project_id: project_id })
}

function delete_member(event) {
  event.stopPropagation()
  let member_id = event.target.id
  let project_id = +event.target.dataset.project_id
  emit('/project/delete-member', {
    user_id: member_id,
    project_id: project_id,
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

//generate project item with title and id
function ProjectItem(attrs: { title: string; id: number; user_id: number }) {
  let project = proxy.project[attrs.id]

  // if user is creator, show add member button
  let is_owner = project.creator_id == attrs.user_id

  return (
    <ion-item id={`project-item-${attrs.id}`} onclick="select_project(this.id)">
      <h2 id={`project-title-${attrs.id}`}>{attrs.title}</h2>
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
    </ion-item>
  )
  // return (
  //   <ion-item id={`project-item-${attrs.id}`} onclick="select_project(this.id)">
  //     <h2 id={`project-title-${attrs.id}`}>{attrs.title}</h2>
  //     <div style="margin-top: 10px; margin-left: auto; display: flex; gap: 8px;">
  //       <ion-button id={attrs.id} onclick="create_modify_project_alert(event)">
  //         <ion-icon name="create-outline"></ion-icon>
  //       </ion-button>

  //       <ion-button
  //         id={attrs.id}
  //         color="danger"
  //         onclick="delete_project(event)"
  //       >
  //         <ion-icon name="trash-outline"></ion-icon>
  //       </ion-button>
  //     </div>
  //   </ion-item>
  // )
}

function MemberItem(attrs: {
  id: number
  username: string
  project_id: number
}) {
  return (
    <ion-item id={`member-item-${attrs.id}`}>
      <h2 id={`member-title-${attrs.id}`}>{attrs.username}</h2>
      <div style="margin-top: 10px; margin-left: auto; display: flex; gap: 8px;">
        <ion-button
          id={attrs.id}
          data-project_id={attrs.project_id}
          color="danger"
          onclick="delete_member(event)"
        >
          <ion-icon name="trash-outline"></ion-icon>
        </ion-button>
      </div>
    </ion-item>
  )
}

let get_last_id = db
  .prepare<void[], number>(
    /* sql */ `
    select MAX(id) from project
  `,
  )
  .pluck()

//get all project id that user created
let get_created_project_id = db
  .prepare<{ user_id: number }, number>(
    /* sql */ `
    select id from project where creator_id = :user_id
  `,
  )
  .pluck()

console.log(get_created_project_id.all({ user_id: 2 }))

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
          <ion-button color="primary" onclick='goto("/login")'>
            <Locale en="Login" zh_hk="登入" zh_cn="登录" />
          </ion-button>
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
        placeholder="New Project Name"
      ></ion-input>
      <ion-button onclick="create_project()">
        <ion-icon name="add"></ion-icon>
        <Locale en="Create New Project" zh_hk="新增項目" zh_cn="新增项目" />
      </ion-button>
      <ion-list>
        {mapArray(projects, project => (
          <ProjectItem
            title={project.title}
            id={project.id!}
            user_id={user_id!}
          />
        ))}
      </ion-list>
      <ion-alert header="Please Enter New Project Name"></ion-alert>
    </>
  )
}

function AddProject(attrs: {}, context: WsContext) {
  try {
    let parser = object({
      project_name: string(),
    })

    let user_id = getAuthUserId(context)
    let body = getContextFormBody(context)
    let input = parser.parse(body)

    let project_id = proxy.project.push({
      title: input.project_name,
      creator_id: user_id!,
    })

    proxy.project_member.push({
      project_id,
      user_id: user_id!,
    })

    let new_project_item = (
      <ProjectItem
        title={input.project_name}
        id={project_id}
        user_id={user_id!}
      />
    )

    context.ws.send([
      'append',
      'ion-list',
      nodeToVNode(new_project_item, context),
    ])
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
      'ion-list #project-title-' + input.project_id,
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

    delete proxy.project[input.project_id]

    broadcast(['remove', 'ion-list #project-item-' + input.project_id])
  } catch (error) {
    console.error(error)
  }
  throw EarlyTerminate
}

function SelectProject(attrs: {}, context: DynamicContext) {
  try {
    let parser = object({
      project_id: int(),
    })

    let body = getContextFormBody(context)
    let input = parser.parse(body)

    console.log('select_project', input.project_id)

    Redirect({ href: '/app/home?project_id=' + input.project_id }, context)
  } catch (error) {
    console.error(error)
  }
  throw EarlyTerminate
}

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

  let user_id = getAuthUserId(context)
  let body = getContextFormBody(context)
  let input = parser.parse(body)

  let current_project_member = get_current_project_member.all({
    project_id: input.project_id,
  })

  let users = pick(proxy.user, ['id', 'username'])

  let user_list = users.filter(user =>
    current_project_member.includes(user.id!),
  )

  console.log('user_list', user_list)

  return (
    <>
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
            id={user.id!}
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

function DeleteMember(attrs: {}, context: DynamicContext) {
  try {
    let parser = object({
      user_id: int(),
      project_id: int(),
    })

    let body = getContextFormBody(context)
    let input = parser.parse(body)

    console.log('delete_member', input.user_id, input.project_id)

    delete_member.run({
      user_id: input.user_id,
      project_id: input.project_id,
    })

    broadcast(['remove', 'ion-list #member-item-' + input.user_id])
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

let routes = {
  '/app/project': {
    title: title(pageTitle),
    description: 'TODO',
    node: page,
    layout_type: LayoutType.ionic,
  },
  '/app/project/manage-member': {
    title: title(manageMemberTitle),
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
  '/project/select-project': {
    title: apiEndpointTitle,
    description: 'TODO',
    node: <SelectProject />,
    streaming: false,
  },
  '/project/delete-member': {
    title: apiEndpointTitle,
    description: 'TODO',
    node: <DeleteMember />,
    streaming: false,
  },
} satisfies Routes

export default { routes }
