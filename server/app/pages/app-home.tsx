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
    {/* This extra layer of div is only needed when using ion-menu */}
    <div id="main-content">
      <ion-header>
        <ion-toolbar color="primary">
          <ion-buttons slot="start">
            <ion-menu-button></ion-menu-button>
          </ion-buttons>
          <ion-title role="heading" aria-level="1">
            {pageTitle}
          </ion-title>
          <ion-buttons slot="end">
            <Link tagName="ion-button" href="/app/about" color="light">
              About
            </Link>
          </ion-buttons>
        </ion-toolbar>
      </ion-header>
      <ion-content class="ion-padding">
        <ion-list>
          <Link tagName="ion-item" href={'/upload-image'}>
            1. <Locale en="Upload Image" zh_hk="上傳圖片" zh_cn="上传图片" />
          </Link>
          <Link tagName="ion-item" href={'/annotate-image'}>
            2. <Locale en="Annotate Image" zh_hk="標註圖片" zh_cn="注释图像" />
          </Link>
          <Link tagName="ion-item" href={'/train-ai'}>
            3.{' '}
            <Locale
              en="Train AI Model"
              zh_hk="訓練 AI 模型"
              zh_cn="训练 AI 模型"
            />
          </Link>
          <Link tagName="ion-item" href={'/preview-ai'}>
            4. <Locale en="Preview AI" zh_hk="預覽 AI" zh_cn="预览 AI" />
          </Link>
          <Link tagName="ion-item" href={'/stats'}>
            5. <Locale en="Stats" zh_hk="統計" zh_cn="统计" />
          </Link>
        </ion-list>
        {wsStatus.safeArea}
      </ion-content>
    </div>
    <ion-footer>
      {appIonTabBar}
      {selectIonTab('home')}
    </ion-footer>
    {fitIonFooter}
    {script}
  </>
)

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
  ...(config.layout_type === LayoutType.ionic
    ? {
        '/': homeRoute,
      }
    : {}),
  '/app/home': homeRoute,
} satisfies Routes

export default { routes }
