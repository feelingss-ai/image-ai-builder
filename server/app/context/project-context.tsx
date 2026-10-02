import { count, filter } from 'better-sqlite3-proxy'
import { db } from '../../../db/db.js'
import { Label, Project, User, proxy } from '../../../db/proxy.js'
import { getAuthUser } from '../auth/user.js'
import { DynamicContext } from '../context.js'

// whether the viewer can SEE the project:
// public -> anyone (including logged-out); private -> admin / creator / member
export function canViewProject(user: User | null, project: Project): boolean {
  if (project.is_public) return true
  if (!user?.id) return false
  if (user.is_admin) return true
  if (project.creator_id === user.id) return true
  return (
    count(proxy.project_member, {
      project_id: project.id!,
      user_id: user.id,
    }) > 0
  )
}

// whether the viewer can MODIFY the project (annotate/upload/manage):
// admin / creator / member only — public visibility never grants write access
export function canEditProject(user: User | null, project: Project): boolean {
  if (!user?.id) return false
  if (user.is_admin) return true
  if (project.creator_id === user.id) return true
  return (
    count(proxy.project_member, {
      project_id: project.id!,
      user_id: user.id,
    }) > 0
  )
}

// guard for ws/ajax endpoints whose project_id comes from the form body or
// query (not the url ?project= param) — throws when access is denied
export function requireViewProjectById(
  user: User | null,
  project_id: number,
): Project {
  let project = proxy.project[project_id]
  if (!project) throw 'Project not found'
  if (!canViewProject(user, project))
    throw 'You do not have access to this project'
  return project
}

// guard for ws/ajax endpoints that modify project data — throws when the
// viewer is not admin/creator/member
export function requireEditProjectById(
  user: User | null,
  project_id: number,
): Project {
  let project = proxy.project[project_id]
  if (!project) throw 'Project not found'
  if (!canEditProject(user, project))
    throw 'You do not have permission to modify this project'
  return project
}

export function getContextProject(context: DynamicContext): Project | null {
  let params = new URLSearchParams(context.routerMatch?.search)

  let project_id = +params.get('project')!
  if (!project_id) return null

  let project = proxy.project[project_id]
  return project || null
}

export let select_project_label = db.prepare<
  { project_id: number },
  { id: number; title: string; dependency_id: null | number }
>(/* sql */ `
select
  id
, title
, dependency_id
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

// Build a symmetric conflict map for a project: { label_id: [conflicting ids] }.
// Two sources are merged:
//   1. explicit pairs from label_conflict (unordered pair, both directions)
//   2. group semantics: a parent with mutually_exclusive set makes ALL its
//      children pairwise exclusive (only one child may be yes per image)
// Injected into annotation pages so the client can disable conflicting
// options, and used server-side for the yes→no cascade.
export function getProjectConflictMap(
  project_id: number,
): Record<number, number[]> {
  let map: Record<number, number[]> = {}
  let add = (a: number, b: number) => {
    if (!map[a]) map[a] = []
    if (!map[a].includes(b)) map[a].push(b)
  }
  for (let row of filter(proxy.label_conflict, { project_id })) {
    add(row.label_a_id, row.label_b_id)
    add(row.label_b_id, row.label_a_id)
  }
  // expand mutually-exclusive groups: every pair of children under a flagged
  // parent conflicts with each other
  let labels = filter(proxy.label, { project_id })
  for (let label of labels) {
    if (!label.dependency_id) continue
    let parent = labels.find(l => l.id === label.dependency_id)
    if (!parent?.mutually_exclusive) continue
    for (let sibling of labels) {
      if (sibling.id === label.id) continue
      if (sibling.dependency_id !== parent.id) continue
      add(label.id!, sibling.id!)
    }
  }
  return map
}
