import { db } from '../../../db/db.js'

// shared per-label answer stats queries, used by the stats page and the
// public dataset page

// answers per image+label in a project (json_group_array of latest answers)
export let select_label_count = db.prepare<
  { project_id: number },
  { image_id: number; label_id: number; answers: string }
>(/* sql */ `
select
  image.id as image_id
, label.id as label_id
, json_group_array(image_label.answer) as answers
from image
inner join label
  on label.project_id = :project_id
left join image_label
  on image.id = image_label.image_id
 and label.id = image_label.label_id
where image.project_id = :project_id
group by label.id, image.id
`)

// Images eligible for a label: for a child label (dependency_id set), only
// images whose parent label is annotated positive (answer = 1) count —
// same rule as the annotation queue in annotate-image.tsx.
export let select_eligible_image_count = db
  .prepare<
    { label_id: number; dependency_id: null | number; project_id: number },
    number
  >(
    /* sql */ `
select count(*)
from image
where image.project_id = :project_id
and (
  :dependency_id is null
  or id in (
    select image_id from image_label
    where label_id = :dependency_id and answer = 1
  )
)
`,
  )
  .pluck()

// label_id -> { yes, no, unknown } counts for a project.
// For child labels the denominator is only images whose parent is annotated
// yes — unknown is recomputed as eligible - yes - no (never negative), same
// as the stats page.
export function getLabelAnswerStats(
  project_id: number,
  labels: Array<{ id?: null | number; dependency_id?: null | number }>,
): Map<number, { yes: number; no: number; unknown: number }> {
  // label -> {yes, no, unknown}
  let stats = new Map<number, { yes: number; no: number; unknown: number }>()
  let rows = select_label_count.all({ project_id })
  for (let row of rows) {
    let { label_id } = row
    let answers = JSON.parse(row.answers) as (1 | 0 | null)[]
    let item = stats.get(label_id) || { yes: 0, no: 0, unknown: 0 }
    for (let answer of answers) {
      switch (answer) {
        case 1:
          item.yes++
          break
        case 0:
          item.no++
          break
        case null:
          item.unknown++
          break
      }
    }
    stats.set(label_id, item)
  }
  for (let label of labels) {
    let label_id = label.id!
    let item = stats.get(label_id)
    if (!item) continue
    let eligible =
      select_eligible_image_count.get({
        label_id,
        dependency_id: label.dependency_id ?? null,
        project_id,
      }) ?? 0
    let known = item.yes + item.no
    item.unknown = Math.max(0, eligible - known)
  }
  return stats
}