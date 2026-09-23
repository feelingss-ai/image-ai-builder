import { seedRow } from 'better-sqlite3-proxy'
import { proxy } from '../../db/proxy.js'
import { db } from '../../db/db.js'
import { env } from '../env.js'
import { join } from 'path'
import { read_img } from 'img-read'
import { o } from './jsx/jsx.js'
import { Routes } from './routes.js'
import { apiEndpointTitle } from '../config.js'
import { getContextFormBody, WsContext } from './context.js'
import { object, id } from 'cast.ts'
import { showError } from './components/error.js'
import { getAuthUser } from './auth/user.js'
import { EarlyTerminate } from '../exception.js'
import { sessions } from './session.js'
import { ServerMessage } from '../../client/types.js'

/**
 * One-click AI auto label service.
 *
 * Runs a background job that asks a local vision language model (Ollama /
 * LM Studio, OpenAI-compatible) whether each un-annotated image of a project
 * matches a label, and writes the yes/no answers into `image_label`.
 *
 * Design notes:
 * - one global job at a time (the local VLM can only serve one model)
 * - images with a latest answer for the label are skipped, so a cancelled
 *   or failed job can be resumed without overwriting human annotations
 * - the job loop is fire-and-forget: WS handlers return immediately and
 *   receive progress through the onProgress callback
 * - the WS handlers and progress broadcast live here too, so pages that
 *   start the job (stats, manage-dataset) only need to emit the endpoints
 */

export type AutoLabelJobStatus = 'running' | 'done' | 'cancelled' | 'failed'

export type AutoLabelJob = {
  status: AutoLabelJobStatus
  project_id: number
  label_id: number
  user_id: number
  done: number
  total: number
  yes: number
  no: number
  failed: number
  started_at: number
  shouldCancel: boolean
}

let currentJob: AutoLabelJob | null = null

export function getAutoLabelJob(): AutoLabelJob | null {
  return currentJob
}

// latest answer per image+label — same semantics as the review page
// (manage-dataset.tsx get_yes_image_ids / get_no_image_ids)
let select_annotated_image_ids = db
  .prepare<{ label_id: number; project_id: number }, number>(
    /* sql */ `
select distinct il.image_id
from image_label il
inner join image on image.id = il.image_id
where il.label_id = :label_id
  and image.project_id = :project_id
  and il.id = (
    select max(il2.id) from image_label il2
    where il2.image_id = il.image_id and il2.label_id = il.label_id
  )
`,
  )
  .pluck()

export type AutoLabelProgress = {
  status: AutoLabelJobStatus
  done: number
  total: number
  yes: number
  no: number
  failed: number
}

function snapshot(job: AutoLabelJob): AutoLabelProgress {
  return {
    status: job.status,
    done: job.done,
    total: job.total,
    yes: job.yes,
    no: job.no,
    failed: job.failed,
  }
}

function parseAnswer(content: string): 'yes' | 'no' | null {
  let trimmed = content.trim()
  try {
    let parsed = JSON.parse(trimmed)
    let answer = String(parsed.answer ?? '').toLowerCase()
    if (answer === 'yes' || answer === 'no') return answer
  } catch {
    // the model may wrap the JSON in markdown fence or add prose
  }
  let match = trimmed.match(/\{\s*"answer"\s*:\s*"(yes|no)"\s*\}/i)
  return match ? (match[1]!.toLowerCase() as 'yes' | 'no') : null
}

/**
 * Start a background auto label job. Returns false when another job is
 * already running or there is nothing to label.
 */
export function startAutoLabelJob(options: {
  project_id: number
  label_id: number
  user_id: number
  onProgress?: (progress: AutoLabelProgress) => void
  onFinish?: (job: AutoLabelJob) => void
}): { ok: boolean; total?: number; error?: string } {
  let { project_id, label_id, user_id, onProgress, onFinish } = options

  if (currentJob && currentJob.status === 'running') {
    return { ok: false, error: 'another auto label job is already running' }
  }

  let label = proxy.label[label_id]
  if (!label || label.project_id !== project_id) {
    return { ok: false, error: 'label not found in project' }
  }

  // images of the project, excluding inline data uris (same rule as
  // manage-dataset.tsx getProjectImages)
  let images = filter_project_images.all({ project_id })
  let annotated = new Set(
    select_annotated_image_ids.all({ label_id, project_id }),
  )
  let pending = images.filter(image => !annotated.has(image.id))
  if (pending.length === 0) {
    return { ok: false, error: 'all images are already annotated' }
  }

  let job: AutoLabelJob = {
    status: 'running',
    project_id,
    label_id,
    user_id,
    done: 0,
    total: pending.length,
    yes: 0,
    no: 0,
    failed: 0,
    started_at: Math.floor(Date.now() / 1000),
    shouldCancel: false,
  }
  currentJob = job

  let prompt =
    `Look at this image. Does it show ${label.title.replace(/"/g, "'")}? ` +
    `Answer with JSON only: {"answer":"yes"} or {"answer":"no"}. ` +
    `No other text.`

  // fire-and-forget: the caller (WS handler) must not await this — the job
  // can run for hours on CPU inference
  void (async () => {
    // stop early after consecutive failures — the VLM is likely down, and
    // burning through the whole project with errors helps nobody
    let consecutive_failures = 0
    const MAX_CONSECUTIVE_FAILURES = 3
    try {
      for (let image of pending) {
        if (job.shouldCancel) {
          job.status = 'cancelled'
          break
        }
        let input = join(env.UPLOAD_DIR, image.filename)
        let answer: 'yes' | 'no' | null = null
        // one retry on empty/failed response (observed ~1 in 45 in phase 1)
        for (let attempt = 0; attempt < 2 && !answer; attempt++) {
          try {
            let result = await read_img({
              input,
              prompt,
              base_url: env.VLM_BASE_URL,
              model: env.VLM_MODEL,
              api_key: env.VLM_API_KEY,
            })
            answer = parseAnswer(result.content)
          } catch (error) {
            console.error(
              `auto-label: read_img failed for image ${image.id} ` +
                `(attempt ${attempt + 1})`,
              error,
            )
          }
        }
        if (answer) {
          seedRow(
            proxy.image_label,
            {
              label_id,
              image_id: image.id!,
              user_id,
            },
            { answer: answer === 'yes' ? 1 : 0 },
          )
          if (answer === 'yes') job.yes++
          else job.no++
          consecutive_failures = 0
        } else {
          job.failed++
          consecutive_failures++
          if (consecutive_failures >= MAX_CONSECUTIVE_FAILURES) {
            console.error(
              `auto-label: ${MAX_CONSECUTIVE_FAILURES} consecutive failures, ` +
                `aborting job (project ${project_id}, label ${label_id})`,
            )
            job.status = 'failed'
            break
          }
        }
        job.done++
        onProgress?.(snapshot(job))
      }
      // loop finished without early exit → all done
      if (job.status === 'running') job.status = 'done'
    } finally {
      currentJob = null
      onFinish?.(job)
    }
  })()

  return { ok: true, total: pending.length }
}

/** Request cancellation of the running job. Returns false when none. */
export function cancelAutoLabelJob(project_id: number): boolean {
  if (!currentJob || currentJob.status !== 'running') return false
  if (currentJob.project_id !== project_id) return false
  currentJob.shouldCancel = true
  return true
}

// images of a project that have a real filename (not inline data uris)
let filter_project_images = db.prepare<
  { project_id: number },
  { id: number; filename: string }
>(/* sql */ `
select id, filename
from image
where project_id = :project_id
  and filename is not null
  and filename != ''
  and filename not like 'data:%'
`)

// ---------------------------------------------------------------------------
// progress broadcast (to every client on a page that can start the job)
// ---------------------------------------------------------------------------

// broadcast auto label progress to every client currently on the manage
// dataset page or the stats page (both can start the job)
// (same pattern as broadcastProgress in similar-images.tsx)
function broadcastAutoLabelProgress(progress: AutoLabelProgress) {
  let message: ServerMessage = [
    'eval',
    `if (typeof document !== 'undefined' && typeof Swal !== 'undefined' && Swal.isVisible()) {
      Swal.update({
        title: 'AI auto label... ${progress.done}/${progress.total}',
        html: 'yes: ${progress.yes} · no: ${progress.no} · failed: ${progress.failed}',
      })
    }`,
  ]
  sessions.forEach(session => {
    if (
      session.url?.startsWith('/manage-dataset') ||
      session.url?.startsWith('/stats')
    ) {
      session.ws.send(message)
    }
  })
}

// broadcast the final summary and refresh the label progress UI
function broadcastAutoLabelFinished(job: AutoLabelJob) {
  let title =
    job.status === 'done'
      ? 'AI auto label finished'
      : job.status === 'cancelled'
        ? 'AI auto label cancelled'
        : 'AI auto label failed'
  let summary =
    `yes: ${job.yes} · no: ${job.no} · failed: ${job.failed} ` +
    `(${job.done}/${job.total})`
  let message: ServerMessage = [
    'eval',
    `if (typeof document !== 'undefined' && typeof Swal !== 'undefined' && Swal.isVisible()) {
      Swal.update({ title: '${title}', html: '${summary}' })
      setTimeout(() => Swal.close(), 5000)
    } else {
      showToast('${title}: ${summary}', 'info', 'top-end', 5000)
    }
    // the stats page shows the yes/no/unknown chart — reload it so the
    // updated distribution is visible right away
    if (location.pathname.startsWith('/stats')) {
      setTimeout(() => location.reload(), 3000)
    }`,
  ]
  sessions.forEach(session => {
    if (
      session.url?.startsWith('/manage-dataset') ||
      session.url?.startsWith('/stats')
    ) {
      session.ws.send(message)
    }
  })
}

// ---------------------------------------------------------------------------
// WS handlers
// ---------------------------------------------------------------------------

let autoLabelStartParser = object({
  label_id: id(),
  project_id: id(),
})

function AutoLabelStart(attrs: {}, context: WsContext) {
  try {
    let user = getAuthUser(context)
    if (!user) throw 'You must be logged in'

    let body = getContextFormBody(context)
    let input = autoLabelStartParser.parse(body)
    let project = proxy.project[input.project_id]
    if (!project) throw 'Project not found'
    let label = proxy.label[input.label_id]
    if (!label || label.project_id !== input.project_id) {
      throw 'Label not found'
    }

    let result = startAutoLabelJob({
      project_id: input.project_id,
      label_id: input.label_id,
      user_id: user.id!,
      onProgress: broadcastAutoLabelProgress,
      onFinish: broadcastAutoLabelFinished,
    })
    if (!result.ok) {
      context.ws.send(showError(result.error ?? 'cannot start auto label'))
      throw EarlyTerminate
    }

    context.ws.send([
      'eval',
      `Swal.fire({
        title: 'AI auto label... 0/${result.total}',
        html: 'yes: 0 · no: 0 · failed: 0',
        allowOutsideClick: false,
        allowEscapeKey: false,
        showCancelButton: true,
        confirmButtonText: 'Cancel',
        showConfirmButton: true,
        // heightAuto: false — required on ionic pages: ionic sets
        // body { position: fixed }, and swal2's default height-auto
        // class collapses the body to 0px (white screen)
        heightAuto: false,
        didOpen: () => {},
      }).then(r => {
        if (r.dismiss) emit('/auto-label/cancel', {
          project_id: getProjectId(),
        })
      })`,
    ])
    throw EarlyTerminate
  } catch (error) {
    if (error !== EarlyTerminate) {
      console.error('AutoLabelStart error', error)
      context.ws.send(showError(error))
    }
    throw EarlyTerminate
  }
}

let autoLabelCancelParser = object({
  project_id: id(),
})

function AutoLabelCancel(attrs: {}, context: WsContext) {
  try {
    let user = getAuthUser(context)
    if (!user) throw 'You must be logged in'

    let body = getContextFormBody(context)
    let input = autoLabelCancelParser.parse(body)
    let cancelled = cancelAutoLabelJob(input.project_id)
    if (cancelled) {
      context.ws.send([
        'eval',
        `if (typeof Swal !== 'undefined' && Swal.isVisible()) {
          Swal.update({ title: 'AI auto label... cancelling' })
        }`,
      ])
    }
    throw EarlyTerminate
  } catch (error) {
    if (error !== EarlyTerminate) {
      console.error('AutoLabelCancel error', error)
      context.ws.send(showError(error))
    }
    throw EarlyTerminate
  }
}

// ---------------------------------------------------------------------------
// routes
// ---------------------------------------------------------------------------
let routes = {
  '/auto-label/start': {
    title: apiEndpointTitle,
    description: 'Start one-click AI auto label for a label (local VLM)',
    node: <AutoLabelStart />,
  },
  '/auto-label/cancel': {
    title: apiEndpointTitle,
    description: 'Cancel the running AI auto label job',
    node: <AutoLabelCancel />,
  },
} satisfies Routes

export default { routes }
