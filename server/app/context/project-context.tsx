import { db } from '../../../db/db.js'
import { Label, Project, proxy } from '../../../db/proxy.js'
import { DynamicContext } from '../context.js'

// TODO check the access control of the project and viewer

export function getContextProject(context: DynamicContext): Project | null {
  let params = new URLSearchParams(context.routerMatch?.search)

  let project_id = +params.get('project')!
  if (!project_id) return null

  let project = proxy.project[project_id]
  return project || null
}

export let select_project_label = db.prepare<
  { project_id: number },
  { id: number; title: string }
>(/* sql */ `
select
  id, title
from label
where project_id = :project_id
order by display_order asc
`)

export function getContextLabel(context: DynamicContext): Label | null {
  let params = new URLSearchParams(context.routerMatch?.search)

  let project_id = +params.get('project')!
  if (!project_id) return null

  let label_id =
    +params.get('label')! || select_project_label.get({ project_id })?.id
  if (!label_id) return null

  let label = proxy.label[label_id]
  return label || null
}
