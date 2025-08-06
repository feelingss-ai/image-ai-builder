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

let pageTitle = 'Project'

let style = Style(/* css */ `
#Project {

}

ion-item {
  cursor: pointer;
  border-radius: 10px;
  transition: all 0.3s ease;
  &:hover {
    transform: scale(1.05);
  }
}
`)

let script = Script(/* js */ `

alert = document.querySelector('ion-alert')

// get new project name by alert input
function create_modify_project_alert(project_id) {
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
function delete_project(project_id) {
  emit('/project/delete-project', {project_id: project_id})
}

  //send select project id to server
function select_project(project_id) {
  console.log('select_project', project_id)
  let project_id_num = project_id.split('-')[2]
  console.log('select_project', project_id_num)
  emit('/project/select-project', {project_id: project_id_num})
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

//generate project item with title and id
function ProjectItem(attrs: { title: string; id: number }) {
  return (
    <ion-item id={`project-item-${attrs.id}`} onclick="select_project(this.id)">
      <h2 id={`project-title-${attrs.id}`}>{attrs.title}</h2>
      <div style="margin-top: 10px; margin-left: auto; display: flex; gap: 8px;">
        <ion-button
          id={attrs.id}
          onclick="create_modify_project_alert(this.id)"
        >
          <ion-icon name="create-outline"></ion-icon>
        </ion-button>

        <ion-button
          id={attrs.id}
          color="danger"
          onclick="delete_project(this.id)"
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

function Main(attrs: {}, context: Context) {
  let user = getAuthUser(context)
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
        {mapArray(proxy.project, project => (
          <ProjectItem title={project.title} id={project.id!} />
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
    let last_id = get_last_id.get()

    proxy.project.push({
      title: input.project_name,
      creator_id: user_id!,
    })

    let new_project_item = (
      <ProjectItem title={input.project_name} id={last_id! + 1} />
    )

    broadcast(['append', 'ion-list', nodeToVNode(new_project_item, context)])
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
} satisfies Routes

export default { routes }
