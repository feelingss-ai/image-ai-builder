import { o } from '../jsx/jsx.js'
import { DynamicContext } from '../context.js'
import { IonButton } from './ion-button.js'
import { Locale } from './locale.js'

export function NoProjectMessage(attrs: {}, context: DynamicContext) {
  return (
    <div style="margin: auto; width: fit-content; text-align: center;">
      <div class="ion-padding ion-margin error">
        <Locale
          en="Project not specified"
          zh_hk="未指定項目"
          zh_cn="未指定项目"
        />
      </div>
      <IonButton url="/app/project" color="primary">
        <Locale
          en="Select Your Project"
          zh_hk="選擇您的項目"
          zh_cn="选择您的项目"
        />
      </IonButton>
    </div>
  )
}
