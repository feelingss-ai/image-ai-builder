import { o } from '../jsx/jsx.js'
import { IonTabBar } from './ion-tab-bar.js'
import { Locale } from './locale.js'

export let appIonTabBar = (
  <IonTabBar
    tabs={[
      // {
      //   icon: 'home',
      //   label: <Locale en="Home" zh_hk="主頁" zh_cn="主页" />,
      //   href: '/app/home',
      // },
      {
        tab: 'project',
        icon: 'folder',
        label: <Locale en="Project" zh_hk="項目" zh_cn="项目" />,
        href: '/app/project',
      },
      {
        tab: 'notice',
        icon: 'notifications',
        label: <Locale en="Notice" zh_hk="通知" zh_cn="通知" />,
        href: '/app/notice',
      },
      {
        tab: 'more',
        icon: 'ellipsis-horizontal',
        label: <Locale en="More" zh_hk="更多" zh_cn="更多" />,
        href: '/app/more',
      },
    ]}
  />
)
