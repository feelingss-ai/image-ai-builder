import { o } from '../jsx/jsx.js'
import Style from './style.js'

// shared yes/no/unknown bar chart, used by the stats page and the public
// dataset page. The CSS classes (.stats-chart*) are defined in the page
// styles (see statsChartStyle below) — include it once per page.
export function StatsChart(attrs: {
  yes: number
  unknown: number
  no: number
}) {
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

// css for StatsChart + the chart legend row (stats-chart--bar with no flex
// style is the legend in the remark row)
export let statsChartStyle = Style(/* css */ `
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
