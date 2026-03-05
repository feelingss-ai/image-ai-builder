import { loadClientPlugin } from '../../client-plugin.js'
import { LayoutType, config, title } from '../../config.js'
import { appIonTabBar } from '../components/app-tab-bar.js'
import { mapArray } from '../components/fragment.js'
import { Locale, Title } from '../components/locale.js'
import { Link } from '../components/router.js'
import { Script } from '../components/script.js'
import Style from '../components/style.js'
import { wsStatus } from '../components/ws-status.js'
import { prerender } from '../jsx/html.js'
import { o } from '../jsx/jsx.js'
import { PageRoute, Routes } from '../routes.js'
import { fitIonFooter, selectIonTab } from '../styles/mobile-style.js'
import { characters } from './app-character.js'
import { Context, DynamicContext } from '../context.js'
import { getAuthUserId } from '../auth/user.js'
import { IonBackButton } from '../components/ion-back-button.js'
import { Page } from '../components/page.js'

let pageTitle = <Locale en="Home" zh_hk="主頁" zh_cn="主页" />

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

let sweetAlertPlugin = loadClientPlugin({
  entryFile: 'dist/client/sweetalert.js',
})

let homePage = (
  <>
    {style}
    {/*
    <ion-menu content-id="main-content" id="sideMenu">
      <ion-header>
        <ion-toolbar>
          <ion-title>Side Menu</ion-title>
        </ion-toolbar>
      </ion-header>
      <ion-content>
        <ion-list>
          <ion-item onclick="selectMenu(event)">Show Toast 1</ion-item>
          <ion-item onclick="selectMenu(event)">Show Toast 2</ion-item>
          <ion-item onclick="selectMenu(event, 'close')">
            Show Toast and Close Menu
          </ion-item>
        </ion-list>
      </ion-content>
    </ion-menu>
    */}
    {/* This extra layer of div is only needed when using ion-menu */}
    <div id="main-content">
      <ion-header>
        <ion-toolbar>
          {/* <ion-buttons slot="start">
            <ion-menu-button></ion-menu-button>
          </ion-buttons> */}
          <IonBackButton href={`/app/project`} backText="Projects" />
          <ion-title role="heading" aria-level="1">
            {pageTitle}
          </ion-title>
          {/* <ion-buttons slot="end">
            <Link tagName="ion-button" href="/app/about" color="light">
              About
            </Link>
          </ion-buttons> */}
        </ion-toolbar>
      </ion-header>
      <Main />
    </div>
    {/* <ion-footer>
      {appIonTabBar}
      {selectIonTab('home')}
    </ion-footer> */}
    {/* {fitIonFooter} */}
    {script}
  </>
)

// return <Page/> for custom page title
function Main(attrs: {}, context: DynamicContext) {
  let params = new URLSearchParams(context.routerMatch?.search)
  let project_id = params.get('project')
  if (!project_id) {
    return (
      <>
        <div style="margin: auto; width: fit-content; text-align: center;">
          <p class="ion-padding ion-margin error">
            <Locale
              en="You must select project first"
              zh_hk="您必須先選擇項目"
              zh_cn="您必须先选择项目"
            />
          </p>
          <ion-button color="primary" onclick='goto("/app/project")'>
            <Locale en="Select Project" zh_hk="選擇項目" zh_cn="选择项目" />
          </ion-button>
        </div>
      </>
    )
  }

  // TODO check if the current user is a member of the project
  let is_member = true
  if (!is_member) {
    return (
      <ion-content class="ion-padding">
        <p>You are not a member of this project</p>
      </ion-content>
    )
  }

  let pages: { href: string; title: string }[] = [
    {
      href: '/upload-image?project=' + project_id,
      title: <Locale en="Upload Image" zh_hk="上傳圖片" zh_cn="上传图片" />,
    },
    {
      href: '/annotate-image?project=' + project_id,
      title: <Locale en="Annotate Image" zh_hk="標註圖片" zh_cn="注释图像" />,
    },
    {
      href: '/train-ai?project=' + project_id,
      title: <Locale en="Train AI" zh_hk="訓練 AI" zh_cn="训练 AI" />,
    },
    {
      href: '/preview-ai?project=' + project_id,
      title: <Locale en="Preview AI" zh_hk="預覽 AI" zh_cn="预览 AI" />,
    },
    {
      href: '/stats?project=' + project_id,
      title: <Locale en="Stats" zh_hk="統計" zh_cn="统计" />,
    },
    {
      href: '/import-export-model?project=' + project_id,
      title: (
        <Locale
          en="Import/Export Model"
          zh_hk="匯入/匯出模型"
          zh_cn="导入/导出模型"
        />
      ),
    },
  ]

  return (
    <ion-content class="ion-padding">
      <ion-list>
        {mapArray(pages, (page, index) => (
          <Link tagName="ion-item" href={page.href}>
            {index + 1}. {page.title}
          </Link>
        ))}
      </ion-list>
      {wsStatus.safeArea}
    </ion-content>
  )
}

// pre-render into html to reduce time to first contentful paint (FCP)
// homePage = prerender(homePage)

let homeRoute: PageRoute = {
  title: <Title t={pageTitle} />,
  description:
    'List of fictional characters commonly used as placeholders in discussion about cryptographic systems and protocols.',
  menuText: 'Ionic App',
  menuFullNavigate: true,
  node: homePage,
  layout_type: LayoutType.ionic,
}

let routes = {
  // ...(config.layout_type === LayoutType.ionic
  //   ? {
  //       '/': homeRoute,
  //     }
  //   : {}),
  '/app/home': homeRoute,
} satisfies Routes

export default { routes }
