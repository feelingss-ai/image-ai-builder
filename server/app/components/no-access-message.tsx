import { o } from '../jsx/jsx.js'
import { DynamicContext } from '../context.js'
import { IonButton } from './ion-button.js'
import { Locale } from './locale.js'

export function NoAccessMessage(attrs: {}, context: DynamicContext) {
  return (
    <div style="margin: auto; width: fit-content; text-align: center;">
      <div class="ion-padding ion-margin error">
        <Locale
          en="You do not have access to this project"
          zh_hk="您無權存取此項目"
          zh_cn="您无权访问此项目"
        />
      </div>
      <IonButton url="/app/project" color="primary">
        <Locale en="My Projects" zh_hk="我的項目" zh_cn="我的项目" />
      </IonButton>
    </div>
  )
}
