import { count } from 'better-sqlite3-proxy'
import { db } from '../../../db/db.js'
import { Label, Project, proxy } from '../../../db/proxy.js'
import { getAuthUser } from '../auth/user.js'
import { DynamicContext } from '../context.js'

// check the access control of the project and viewer
function checkAccessProject(context: DynamicContext): boolean {
  let project = getContextProject(context)
  if (!project) return false
  // TODO support public/private project
  let user = getAuthUser(context)
  if (!user) return false
  if (user.is_admin) return true
  if (project.creator_id == user.id) return true
  let is_member = !!count(proxy.project_member, {
    project_id: project.id!,
    user_id: user.id!,
  })
  if (is_member) return true
  // TODO log the invalid attempts
  return false
}

// TODO call checkAccessProject to check permission
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
