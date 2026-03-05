import { count } from 'better-sqlite3-proxy'
import { o } from '../jsx/jsx.js'
import { Routes } from '../routes.js'
import { apiEndpointTitle, title } from '../../config.js'
import Style from '../components/style.js'
import {
  Context,
  DynamicContext,
  getContextFormBody,
  throwIfInAPI,
} from '../context.js'
import { mapArray } from '../components/fragment.js'
import { IonBackButton } from '../components/ion-back-button.js'
import { ProjectPageBackButton } from '../components/back-to-project-home-button.js'
import { object, string } from 'cast.ts'
import { Link, Redirect } from '../components/router.js'
import { renderError } from '../components/error.js'
import { getAuthUser } from '../auth/user.js'
import { evalLocale, Locale } from '../components/locale.js'
import { proxy } from '../../../db/proxy.js'
import { db } from '../../../db/db.js'

let pageTitle = <Locale en="Stats Data" zh_hk="统计数据" zh_cn="统计数据" />

let style = Style(/* css */ `
#Stats {
}
.stats-label-count {
  color: var(--ion-color-primary);
  text-decoration: underline;
  text-decoration-color: var(--ion-color-primary);
  text-decoration-thickness: 0.125rem;
  text-underline-offset: 0.25rem;
}
.stats-item {
  margin-bottom: 1.5rem;
}
.stats-label {
  font-size: 1.5rem;
  margin-bottom: 0.5rem;
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
`)

let page = (
  <>
    {style}
    <ion-header>
      <ion-toolbar>
        <ProjectPageBackButton />
        <ion-title role="heading" aria-level="1">
          {pageTitle}
        </ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content id="Stats" class="ion-no-padding" color="light">
      <Main />
    </ion-content>
  </>
)

let select_label_count = db.prepare<
  void[],
  { image_id: number; label_id: number; answers: string }
>(/* sql */ `
select
  image.id as image_id
, label.id as label_id
, json_group_array(image_label.answer) as answers
from image
inner join label
left join image_label
  on image.id = image_label.image_id
 and label.id = image_label.label_id
group by label.id, image.id
`)

function Main(attrs: {}, context: Context) {
  let user = getAuthUser(context)
  let totalCount = <span class="stats-label-count">{proxy.label.length}</span>

  // label -> {yes, no, unknown}
  let labels: {
    [label_id: number]: { yes: number; no: number; unknown: number }
  } = {}
  let rows = select_label_count.all()
  console.log({ rows })
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
      {mapArray(
        [...proxy.label].sort(
          (a, b) => (a.display_order ?? 999999) - (b.display_order ?? 999999),
        ),
        label => {
          let label_id = label.id!
          let { yes, no, unknown } = labels[label_id]
          return (
            <ion-card class="stats-item">
              <ion-card-content>
                <div class="stats-label">{label.title}</div>
                <StatsChart yes={yes} unknown={unknown} no={no} />
              </ion-card-content>
            </ion-card>
          )
        },
      )}
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

let routes = {
  '/stats': {
    resolve(context) {
      let t = evalLocale(pageTitle, context)
      return {
        title: title(t),
        description: 'TODO',
        node: page,
      }
    },
  },
} satisfies Routes

export default { routes }
