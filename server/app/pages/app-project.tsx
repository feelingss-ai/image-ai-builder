import { o } from '../jsx/jsx.js'
import { Routes } from '../routes.js'
import { LayoutType, title } from '../../config.js'
import Style from '../components/style.js'
import { Context } from '../context.js'
import { mapArray } from '../components/fragment.js'
import { appIonTabBar } from '../components/app-tab-bar.js'
import { fitIonFooter, selectIonTab } from '../styles/mobile-style.js'
import { Locale } from '../components/locale.js'
import { IonBackButton } from '../components/ion-back-button.js'
import { Script } from '../components/script.js'

let pageTitle = 'Project'

let style = Style(/* css */ `
#Project {

}
`)

let script = Script(/* js */ `

alert = document.querySelector('ion-alert')
new_project_name = ''

alert.buttons = [{text:'OK', handler: (event) => {
  project_name = document.querySelector('#project-id-1')
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

alert.addEventListener('ionAlertDidDismiss', () => {
  console.log('alert dismissed')
})
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
        <ion-button id="present-alert">
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
  return (
    <>
      <ion-list>
        <ProjectItem title="Project 1" id={1} />
        <ProjectItem title="Project 2" id={2} />
        <ProjectItem title="Project 3" id={3} />
      </ion-list>
      <ion-alert
        trigger="present-alert"
        header="Please Enter New Project Name"
      ></ion-alert>
      <ion-button>
        <ion-icon name="add"></ion-icon>
        <Locale en="Create New Project" zh_hk="新增項目" zh_cn="新增项目" />
      </ion-button>
    </>
  )
}

let routes = {
  '/app/project': {
    title: title(pageTitle),
    description: 'TODO',
    node: page,
    layout_type: LayoutType.ionic,
  },
} satisfies Routes

export default { routes }
