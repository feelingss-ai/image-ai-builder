import { o } from '../jsx/jsx.js'
import { Locale, ProjectPageTitle } from '../components/locale.js'
import { apiEndpointTitle } from '../../config.js'
import Style from '../components/style.js'
import { Script } from '../components/script.js'
import { IonBackButton } from '../components/ion-back-button.js'
import { Routes } from '../routes.js'
import {
  Context,
  DynamicContext,
  getContextFormBody,
  throwIfInAPI,
  getContextUrl,
} from '../context.js'
import { getAuthUser } from '../auth/user.js'

let pageTitle = (
  <Locale
    en="Import/Export Model"
    zh_hk="匯入/匯出模型"
    zh_cn="导入/导出模型"
  />
)

let style = Style(/* css */ `
/* This explicit height is necessary when using ion-menu */
#main-content {
  height: 100%;
}
`)

let script = Script(/* javascript */ `
function selectMenu(event, flag) {
  let item = event.currentTarget
  showToast('Selected ' + item.textContent)
  if (flag == 'close') {
    let menu = item.closest('ion-menu')
    menu.close()
  }
}
`)

let page = (
  <>
    {style}
    <ion-header>
      <ion-toolbar>
        <IonBackButton href="/" backText="Home" />
        <ion-title role="heading" aria-level="1">
          <ProjectPageTitle t={pageTitle} short />
        </ion-title>
      </ion-toolbar>
    </ion-header>
    <Main />
    {script}
  </>
)

function Main(attrs: {}, context: Context) {
  let user = getAuthUser(context)
  console.log(user)
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
} satisfies Routes

export default { routes }
