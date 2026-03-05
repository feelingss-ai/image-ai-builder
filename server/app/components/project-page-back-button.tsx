import { DynamicContext } from '../context.js'
import { getContextProject } from '../context/project-context.js'
import { o } from '../jsx/jsx.js'
import { IonBackButton } from './ion-back-button.js'

/** Back to project page when project is in URL, otherwise back to home (project list). */
export function ProjectPageBackButton(attrs: {}, context: DynamicContext) {
  let project = getContextProject(context)
  if (project) {
    return (
      <IonBackButton
        href={`/app/home?project=${project.id}`}
        backText="Project"
      />
    )
  }
  return <IonBackButton href="/" backText="Home" />
}
