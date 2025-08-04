import { o } from '../jsx/jsx.js'
import { Routes } from '../routes.js'
import { apiEndpointTitle, LayoutType, title } from '../../config.js'
import Style from '../components/style.js'
import { Context, WsContext, getContextFormBody } from '../context.js'
import { mapArray } from '../components/fragment.js'
import { appIonTabBar } from '../components/app-tab-bar.js'
import { fitIonFooter, selectIonTab } from '../styles/mobile-style.js'
import { Locale } from '../components/locale.js'
import { IonBackButton } from '../components/ion-back-button.js'
import { Script } from '../components/script.js'
import { getAuthUser, getAuthUserId } from '../auth/user.js'
import { object, string } from 'cast.ts'
import { EarlyTerminate } from '../../exception.js'
import { proxy } from '../../../db/proxy.js'

let pageTitle = 'Project'

let style = Style(/* css */ `
#Project {

}
`)

let script = Script(/* js */ `

alert = document.querySelector('ion-alert')

function create_project_alert(project_id) {
  let new_project_name = ''

  alert.buttons = [{text:'OK', handler: (event) => {
    let project_name = document.querySelector('#project-id-'+ project_id)
    console.log('project_id', project_id)
    console.log('project_name', project_name)
    console.log('OK')
    new_project_name = event[0]
    console.log(new_project_name)
    project_name.textContent = new_project_name

  }}, {text:'Cancel', role: 'cancel'}];

  alert.inputs = [
    {
      placeholder: 'Project Name',
    },
  ];
    alert.present()
  }

function create_project() {
  let new_project_name = document.querySelector('#new-project-name').value
  emit('/project/add-project', {project_name: new_project_name})
  document.querySelector('#new-project-name').value = ''
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

function ProjectItem(attrs: { title: string; id: number }) {
  return (
    <ion-item>
      <h2 id={`project-id-${attrs.id}`}>{attrs.title}</h2>
      <div style="margin-top: 10px; margin-left: auto; display: flex; gap: 8px;">
        <ion-button id={attrs.id} onclick="create_project_alert(this.id)">
          <ion-icon name="create-outline"></ion-icon>
        </ion-button>

        <ion-button color="danger">
          <ion-icon name="trash-outline"></ion-icon>
        </ion-button>
      </div>
    </ion-item>
  )
}

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
    console.log('AddProject')
    let parser = object({
      project_name: string(),
    })
    let user_id = getAuthUserId(context)
    console.log('user', user_id)
    let body = getContextFormBody(context)
    let input = parser.parse(body)
    console.log('project_name', input.project_name)
    proxy.project.push({
      title: input.project_name,
      creator_id: user_id!,
    })
    console.log('project', proxy.project)
  } catch (error) {
    console.error(error)
  }
  throw EarlyTerminate
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
} satisfies Routes

export default { routes }
