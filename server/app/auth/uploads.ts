import { Request, Response, NextFunction } from 'express'
import { db } from '../../../db/db.js'
import { proxy } from '../../../db/proxy.js'
import { canViewProject } from '../context/project-context.js'

// which projects reference this uploaded file (a filename can be shared
// across projects — see RemoveImage's stillUsed check)
let select_image_projects = db.prepare<
  { filename: string },
  { project_id: number }
>(/* sql */ `
  select distinct project_id from image
  where filename = :filename and project_id is not null
`)

// access control for /uploads static files: a file is served when it belongs
// to at least one project the viewer can see (public project -> anyone,
// private project -> admin/creator/member). Files not tracked in the DB are
// not served (prevents probing for random filenames).
export function uploadsAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  let filename = req.path.replace(/^\/+/, '')
  if (!filename || filename.includes('/')) return res.status(404).end()
  let rows = select_image_projects.all({ filename })
  if (rows.length === 0) return res.status(404).end()
  let user_id = +(req.signedCookies?.user_id || 0)
  let user = user_id && proxy.user[user_id] ? proxy.user[user_id] : null
  for (let row of rows) {
    let project = proxy.project[row.project_id]
    if (project && canViewProject(user, project)) return next()
  }
  res.status(403).send('Forbidden')
}