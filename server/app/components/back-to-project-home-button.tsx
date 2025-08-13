import { DynamicContext } from '../context.js'
import { o } from '../jsx/jsx.js'
import { IonBackButton } from './ion-back-button.js'

export function BackToProjectHomeButton(attrs: {}, context: DynamicContext) {
  let params = new URLSearchParams(context.routerMatch?.search)
  let project_id = params.get('project_id')
  return (
    <IonBackButton
      href={`/app/home?project=${project_id}`}
      backText="Project Home"
    />
  )
}
