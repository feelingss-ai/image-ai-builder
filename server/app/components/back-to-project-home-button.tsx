import { DynamicContext } from '../context.js'
import { o } from '../jsx/jsx.js'
import { IonBackButton } from './ion-back-button.js'

export function BackToProjectHomeButton(attrs: {}, context: DynamicContext) {
  let params = new URLSearchParams(context.routerMatch?.search)
  // should be using project, not project_id everywhere?
  let project_id = params.get('project_id') || params.get('project')
  return (
    <IonBackButton
      href={`/app/home?project=${project_id}`}
      backText="Project Home"
    />
  )
}
