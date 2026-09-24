import { count, filter } from 'better-sqlite3-proxy'
import { o } from '../jsx/jsx.js'
import { Routes } from '../routes.js'
import { apiEndpointTitle } from '../../config.js'
import Style from '../components/style.js'
import {
  Context,
  DynamicContext,
  getContextFormBody,
  throwIfInAPI,
} from '../context.js'
import { mapArray } from '../components/fragment.js'
import { IonBackButton } from '../components/ion-back-button.js'
import { ProjectPageBackButton } from '../components/project-page-back-button.js'
import { object, string } from 'cast.ts'
import { Link, Redirect } from '../components/router.js'
import { renderError } from '../components/error.js'
import { getAuthUser } from '../auth/user.js'
import { Locale, ProjectPageTitle } from '../components/locale.js'
import { proxy, Label } from '../../../db/proxy.js'
import { db } from '../../../db/db.js'
import { getContextProject } from '../context/project-context.js'
import { NoProjectMessage } from '../components/no-project-message.js'
import Script from '../components/script.js'
import { loadClientPlugin } from '../../client-plugin.js'

let pageTitle = <Locale en="Stats Data" zh_hk="統計數據" zh_cn="统计数据" />

let style = Style(/* css */ `
#Stats {
}
.stats-label-count {
  color: var(--ion-color-primary);
}
.stats-item {
  margin-bottom: 1.5rem;
}
.stats-label {
  font-size: 1.5rem;
  margin-bottom: 0.5rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}
.stats-ai-button {
  --padding-start: 0.5rem;
  --padding-end: 0.5rem;
  --padding-top: 0;
  --padding-bottom: 0;
  margin: 0;
  font-size: 0.9rem;
}
.stats-chart {
  display: flex;
  flex-direction: row;
  border-radius: 0.5rem;
  overflow: hidden;
}
.stats-chart--bar {
  padding: 0.5rem;
  text-align: center;
}
.stats-chart--bar[data-label="yes"] {
  background-color: green;
  color: white;
  border-top-left-radius: 0.5rem;
  border-bottom-left-radius: 0.5rem;
}
.stats-chart--bar[data-label="unknown"] {
  background-color: lightgray;
  color: black;
}
.stats-chart--bar[data-label="no"] {
  background-color: red;
  color: white;
  border-top-right-radius: 0.5rem;
  border-bottom-right-radius: 0.5rem;
}
.stats-box-table-scroll {
  overflow-x: auto;
}
.stats-box-table {
  border-collapse: collapse;
  min-width: 100%;
}
.stats-box-table th,
.stats-box-table td {
  border: 1px solid var(--ion-border-color, #dedede);
  padding: 0.375rem 0.75rem;
  text-align: center;
  white-space: nowrap;
}
.stats-box-table th {
  background-color: var(--ion-color-light, #f4f5f8);
  font-weight: 600;
}
.stats-box-table th.stats-box-table--label,
.stats-box-table td.stats-box-table--label {
  text-align: left;
}
.stats-box-table tbody tr:nth-child(even) {
  background-color: var(--ion-color-light-shade, #eff0f2);
}
.stats-box-table--total {
  font-weight: 600;
}
`)

let sweetAlertPlugin = loadClientPlugin({
  entryFile: 'dist/client/sweetalert.js',
})

let script = Script(/* js */ `
function getProjectId() {
  const params = new URLSearchParams(window.location.search);
  return parseInt(params.get('project') || '0');
}

// One-click AI auto label for a label (from the stats page).
// unknown_count is rendered server-side into the onclick attribute.
function startAutoLabel(label_id, unknown_count) {
  var texts = window.autoLabelTexts || {};
  if (!unknown_count) {
    // heightAuto: false — required on ionic pages: ionic sets
    // body { position: fixed }, and swal2's default height-auto
    // class collapses the body to 0px (white screen)
    Swal.fire({ title: texts.all_annotated, icon: 'info', heightAuto: false });
    return;
  }
  var body = (texts.confirm_body || '{unknown} images').replace('{unknown}', unknown_count);
  Swal.fire({
    title: texts.confirm_title || 'Start AI auto label?',
    html: body,
    icon: 'question',
    showCancelButton: true,
    confirmButtonText: texts.confirm_ok || 'Start',
    cancelButtonText: texts.cancel || 'Cancel',
    heightAuto: false,
  }).then(function (result) {
    if (!result.isConfirmed) return;
    // the socket may still be CONNECTING when the user clicks fast
    if (!window.__ws || window.__ws.readyState !== 1) {
      Swal.fire({ title: 'Not connected', icon: 'error', heightAuto: false });
      return;
    }
    emit('/auto-label/start', {
      label_id: label_id,
      project_id: getProjectId(),
    });
  });
}
`)

let page = (
  <>
    {style}
    <ion-header>
      <ion-toolbar>
        <ProjectPageBackButton />
        <ion-title role="heading" aria-level="1">
          <ProjectPageTitle t={pageTitle} short />
        </ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content id="Stats" class="ion-no-padding">
      <Main />
    </ion-content>
    {sweetAlertPlugin.node}
    <AutoLabelTexts />
    {script}
  </>
)

// Injects localized texts for the AI auto label button (used by the client
// script below, which is a static string and cannot use Locale directly)
function AutoLabelTexts(attrs: {}, context: DynamicContext) {
  let texts = {
    button_title: Locale(
      {
        en: 'AI auto label',
        zh_hk: 'AI 自動標記',
        zh_cn: 'AI 自动标记',
      },
      context,
    ),
    confirm_title: Locale(
      {
        en: 'Start AI auto label?',
        zh_hk: '開始 AI 自動標記？',
        zh_cn: '开始 AI 自动标记？',
      },
      context,
    ),
    confirm_body: Locale(
      {
        en: '{unknown} un-annotated image(s) will be labeled by AI.',
        zh_hk: 'AI 將標記 {unknown} 張未標記圖片。',
        zh_cn: 'AI 将标记 {unknown} 张未标记图片。',
      },
      context,
    ),
    confirm_ok: Locale({ en: 'Start', zh_hk: '開始', zh_cn: '开始' }, context),
    cancel: Locale({ en: 'Cancel', zh_hk: '取消', zh_cn: '取消' }, context),
    all_annotated: Locale(
      {
        en: 'All images are already annotated for this label.',
        zh_hk: '此標籤的所有圖片均已標記。',
        zh_cn: '此标签的所有图片均已标记。',
      },
      context,
    ),
  }
  return <script>autoLabelTexts = {JSON.stringify(texts)}</script>
}

let select_label_count = db.prepare<
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

// get bounding box count distribution by label_id
/* example:
[
  { box_count: 0, image_count: 3 },
  { box_count: 1, image_count: 5 },
  { box_count: 2, image_count: 2 },
]
*/
let select_box_count_distribution = db.prepare<
  { label_id: number; project_id: number },
  { box_count: number; image_count: number }
>(/* sql */ `
with list as (
  select image_label.image_id
  , count(distinct image_bounding_box.id) as box_count
  from image_label
  left join image_bounding_box
    on image_bounding_box.image_id = image_label.image_id
   and image_bounding_box.label_id = image_label.label_id
  where image_label.label_id = :label_id
  and image_label.answer = 1
  and exists (
    select 1 from image
    where image.id = image_label.image_id
    and image.project_id = :project_id
  )
  group by image_label.image_id
)
select box_count, count(*) as image_count
from list
group by box_count
`)

function Main(attrs: {}, context: DynamicContext) {
  let user = getAuthUser(context)
  let project = getContextProject(context)
  if (!project) return <NoProjectMessage />
  let project_id = project.id!

  let projectLabels = filter(proxy.label, { project_id })
  let totalCount = <span class="stats-label-count">{projectLabels.length}</span>

  // label -> {yes, no, unknown}
  let labels: {
    [label_id: number]: { yes: number; no: number; unknown: number }
  } = {}
  let rows = select_label_count.all({ project_id })
  for (let row of rows) {
    let { label_id } = row
    let answers = JSON.parse(row.answers) as (1 | 0 | null)[]
    labels[label_id] ||= { yes: 0, no: 0, unknown: 0 }
    for (let answer of answers) {
      switch (answer) {
        case 1:
          labels[label_id].yes++
          break
        case 0:
          labels[label_id].no++
          break
        case null:
          labels[label_id].unknown++
          break
      }
    }
  }

  // label -> { box_count -> image_count }
  let boxDistribution: {
    [label_id: number]: { [box_count: number]: number }
  } = {}
  let maxBoxCount = 0
  for (let label of projectLabels) {
    let label_id = label.id!
    let counts: { [box_count: number]: number } = {}
    for (let row of select_box_count_distribution.all({
      label_id,
      project_id,
    })) {
      counts[row.box_count] = row.image_count
      if (row.box_count > maxBoxCount) maxBoxCount = row.box_count
    }
    boxDistribution[label_id] = counts
  }
  let sortedLabels = [...projectLabels].sort(
    (a, b) => (a.display_order ?? 999999) - (b.display_order ?? 999999),
  )

  return (
    <>
      <h2 class="ion-padding-horizontal">
        <ion-icon name="stats-chart" />{' '}
        <Locale
          en={<>Total {totalCount} types of labels</>}
          zh_hk={<>總共 {totalCount} 種標籤</>}
          zh_cn={<>总共 {totalCount} 种标签</>}
        />
      </h2>
      <div class="ion-margin-horizontal">
        <span>
          <Locale en="Diagram Remark: " zh_hk="圖解：" zh_cn="图解：" />
        </span>
        <div class="stats-chart" style="display: inline-flex">
          <div class="stats-chart--bar" data-label="yes">
            <Locale en="Yes" zh_hk="是" zh_cn="是" />
          </div>
          <div class="stats-chart--bar" data-label="unknown">
            <Locale en="Unknown" zh_hk="未知" zh_cn="未知" />
          </div>
          <div class="stats-chart--bar" data-label="no">
            <Locale en="No" zh_hk="否" zh_cn="否" />
          </div>
        </div>
      </div>
      {mapArray(sortedLabels, label => {
        let label_id = label.id!
        let { yes, no, unknown } = labels[label_id]
        return (
          <ion-card class="stats-item">
            <ion-card-content>
              <div class="stats-label">
                <span>{label.title}</span>
                <ion-button
                  id={`stats-ai-button-${label_id}`}
                  class="stats-ai-button"
                  size="small"
                  fill="clear"
                  onclick={`startAutoLabel(${label_id}, ${unknown})`}
                >
                  <ion-icon name="sparkles-outline" slot="start"></ion-icon>
                  <Locale
                    en="AI auto label"
                    zh_hk="AI 自動標記"
                    zh_cn="AI 自动标记"
                  />
                </ion-button>
              </div>
              <StatsChart yes={yes} unknown={unknown} no={no} />
            </ion-card-content>
          </ion-card>
        )
      })}
      <ion-card class="stats-item">
        <ion-card-content>
          <h2 class="stats-label">
            <ion-icon name="cube-outline" />{' '}
            <Locale
              en="Bounding Box Stats"
              zh_hk="邊界框統計"
              zh_cn="边界框统计"
            />
          </h2>
          <p>
            <Locale
              en="Number of images by bounding box count (images labeled as Yes only)."
              zh_hk="按邊界框數量統計的圖片數（只計標記為「是」的圖片）。"
              zh_cn="按边界框数量统计的图片数（只计标记为「是」的图片）。"
            />
          </p>
          <BoxStatsTable
            labels={sortedLabels}
            distribution={boxDistribution}
            maxBoxCount={maxBoxCount}
          />
        </ion-card-content>
      </ion-card>
    </>
  )
}

function StatsChart(attrs: { yes: number; unknown: number; no: number }) {
  let { yes, unknown, no } = attrs
  let total = yes + unknown + no
  return (
    <div class="stats-chart">
      <div class="stats-chart--bar" data-label="yes" style={`flex: ${yes};`}>
        <span>{yes}</span>{' '}
        <span hidden={yes === 0}>({Math.round((yes / total) * 100)}%)</span>
      </div>
      <div
        class="stats-chart--bar"
        data-label="unknown"
        style={`flex: ${unknown};`}
        hidden={unknown === 0}
      >
        <span>{unknown}</span>{' '}
        <span hidden={unknown === 0}>
          ({Math.round((unknown / total) * 100)}%)
        </span>
      </div>
      <div class="stats-chart--bar" data-label="no" style={`flex: ${no};`}>
        <span>{no}</span>{' '}
        <span hidden={no === 0}>({Math.round((no / total) * 100)}%)</span>
      </div>
    </div>
  )
}

function BoxStatsTable(attrs: {
  labels: Label[]
  distribution: { [label_id: number]: { [box_count: number]: number } }
  maxBoxCount: number
}) {
  let { labels, distribution, maxBoxCount } = attrs
  let boxCounts = Array.from({ length: maxBoxCount + 1 }, (_, i) => i)
  return (
    <div class="stats-box-table-scroll">
      <table class="stats-box-table">
        <thead>
          <tr>
            <th class="stats-box-table--label">
              <Locale en="Label" zh_hk="標籤" zh_cn="标签" />
            </th>
            {mapArray(boxCounts, boxCount => (
              <th>
                <Locale
                  en={`Boxes: ${boxCount}`}
                  zh_hk={`框數 ${boxCount}`}
                  zh_cn={`框数 ${boxCount}`}
                />
              </th>
            ))}
            <th>
              <Locale en="Total" zh_hk="合計" zh_cn="合计" />
            </th>
          </tr>
        </thead>
        <tbody>
          {mapArray(labels, label => {
            let label_id = label.id!
            let counts = distribution[label_id] || {}
            // total boxes = sum of (box_count * image_count), box_count 0 contributes nothing
            let total = boxCounts.reduce(
              (sum, boxCount) => sum + boxCount * (counts[boxCount] || 0),
              0,
            )
            return (
              <tr>
                <td class="stats-box-table--label">{label.title}</td>
                {mapArray(boxCounts, boxCount => (
                  <td>{counts[boxCount] || 0}</td>
                ))}
                <td class="stats-box-table--total">{total}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

let routes = {
  '/stats': {
    title: <ProjectPageTitle t={pageTitle} />,
    description: 'View annotation and bounding box statistics for the project',
    node: page,
  },
} satisfies Routes

export default { routes }
