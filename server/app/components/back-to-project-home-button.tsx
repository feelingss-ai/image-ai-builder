import { DynamicContext } from '../context.js'
import { o } from '../jsx/jsx.js'
import { IonBackButton } from './ion-back-button.js'

export function BackToProjectHomeButton(attrs: {}, context: DynamicContext) {
  let params = new URLSearchParams(context.routerMatch?.search)
  let project_id = +params.get('project')!
  if (!project_id) {
    throw new Error('missing project id in url')
  }
  return (
    <IonBackButton
      href={`/app/home?project=${project_id}`}
      backText="Project Home"
    />
  )
}
