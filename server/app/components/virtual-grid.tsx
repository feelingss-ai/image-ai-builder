import { o } from '../jsx/jsx.js'
import { Node } from '../jsx/types.js'
import { mapArray } from './fragment.js'
import Script from './script.js'
import Style from './style.js'

let VirtualGridStyle = Style(/* css */ `
.virtual-grid {
  display: grid;
  overflow-y: auto;
  position: relative;
  contain: layout;
}
.virtual-grid--item {
  position: absolute;
}
.virtual-grid--item-template {
  display: none !important;
}
`)

let VirtualGridScript = Script(/* js */ `
function renderVirtualGrid(event) {
  let grid = event.target
  if (grid.timer) return
  grid.timer = requestAnimationFrame(() => {
    grid.timer = null
    let data = grid.data
    let item_width = grid.dataset.itemWidth
    let item_height = grid.dataset.itemHeight
    let col_count = +grid.dataset.colCount
    let row_buffer = +grid.dataset.rowBuffer
    let count = +grid.dataset.count
    let item_sample = grid.querySelector('.virtual-grid--item:not(.virtual-grid--item-template)')
    let item_rect = item_sample.getBoundingClientRect()
    let first_row = Math.max(
      0,
      Math.floor(grid.scrollTop / item_rect.height) - row_buffer
    )
    let last_row = Math.min(
      Math.ceil(count / col_count) - 1,
      Math.floor((grid.scrollTop + grid.clientHeight) / item_rect.height) + row_buffer
    )
    let first_index = first_row * col_count
    let last_index = Math.min(
      count - 1,
      (last_row + 1) * col_count - 1
    )
    let renderItem = window[grid.dataset.renderItem]
    if (typeof renderItem !== 'function') {
      console.error('renderVirtualGrid: failed to resolve render item function:', grid.dataset.renderItem)
      return
    }
    let itemTemplate = grid.querySelector('.virtual-grid--item-template')
    if (!itemTemplate) {
      console.error('renderVirtualGrid: item template not found')
      return
    }
    console.log('renderVirtualGrid', grid)

    let rendered = new Set()

    // remove items outside of visible range
    let items = grid.querySelectorAll('.virtual-grid--item')
    for (let item of items) {
      let index = +item.dataset.index
      if (index < 0) continue
      if (index < first_index || index > last_index) {
        item.remove()
      } else {
        rendered.add(index)
      }
    }

    console.log('rendered', {first_index, last_index, rendered})

    // add new items in visible range
    for (let index = first_index; index <= last_index; index++) {
      if (rendered.has(index)) continue
      let col = index % col_count
      let row = Math.floor(index / col_count)
      let item = itemTemplate.cloneNode(true)
      item.classList.remove('virtual-grid--item-template')
      item.dataset.col = col
      item.dataset.row = row
      item.dataset.index = index
      let value = data[index]
      renderItem(item, value, index, data)
      item.style.transform = 'translate(calc('+col+' * '+item_width+'), calc('+row+' * '+item_height+'))'
      grid.appendChild(item)
    }
  })
}
`)

export function VirtualGrid<T>(attrs: {
  'id'?: string
  'style'?: string
  'item-style'?: string
  'class'?: string
  'data': T[]
  /** `value` is null when rendering template item. */
  'server-render-item': (value: T | null, index: number, data: T[]) => Node
  /**
   * Function name in client js, can be async or sync function.
   * Signature: `fn(node, value, index, array)`
   * - `node` is the DOM node to render into, cloned from template item.
   * - `value` is null when rendering template item.
   */
  'client-render-item': string
  'item-width': string
  'item-height': string
  'col-count': number
  'row-count': number
  'row-buffer'?: number
}) {
  let { data } = attrs
  let clientRenderItem = attrs['client-render-item']
  let serverRenderItem = attrs['server-render-item']

  let className = 'virtual-grid'
  if (attrs.class) {
    className += ' ' + attrs.class
  }

  let gridStyle = attrs.style?.trim() || ''
  if (gridStyle && !gridStyle.endsWith(';')) {
    gridStyle += ';'
  }
  gridStyle += `grid-template-columns: repeat(auto-fill, minmax(${attrs['item-width']}, 1fr));`
  gridStyle += `max-height: calc(${attrs['item-height']} * ${attrs['row-count']});`

  let itemStyle = attrs['item-style']?.trim() || ''
  if (itemStyle && !itemStyle.endsWith(';')) {
    itemStyle += ';'
  }
  itemStyle += `width: ${attrs['item-width']}; height: ${attrs['item-height']};`

  let body = []
  let row_count = attrs['row-count']
  let col_count = attrs['col-count']
  let row_buffer = attrs['row-buffer'] ?? 1
  let index = 0
  for (let row = 0; row < row_count + row_buffer; row++) {
    for (let col = 0; col < col_count && index < data.length; col++, index++) {
      let value = data[index]
      let node = (
        <div
          class="virtual-grid--item"
          style={
            itemStyle +
            `transform: translate(calc(${col} * ${attrs['item-width']}), calc(${row} * ${attrs['item-height']}));`
          }
          data-col={col}
          data-row={row}
          data-index={index}
        >
          {serverRenderItem(value, index, data)}
        </div>
      )
      body.push(node)
    }
  }
  let count = data.length
  return (
    <>
      {VirtualGridStyle}
      <div
        id={attrs.id}
        class={className}
        style={gridStyle}
        onscroll="renderVirtualGrid(event)"
        data-item-width={attrs['item-width']}
        data-item-height={attrs['item-height']}
        data-col-count={col_count}
        data-row-count={row_count}
        data-row-buffer={row_buffer}
        data-count={count}
        data-render-item={clientRenderItem}
      >
        <div
          class="virtual-grid--space"
          style={`height: calc(${Math.ceil(count / col_count)} * ${attrs['item-height']})`}
        ></div>
        <div
          class="virtual-grid--item virtual-grid--item-template"
          style={itemStyle}
          data-col={-1}
          data-row={-1}
          data-index={-1}
        >
          {serverRenderItem(null, -1, data)}
        </div>
        {[body]}
      </div>
      {VirtualGridScript}
      {Script(
        /* js */ `
       (()=>{
        let grid = document.getElementById('${attrs.id}')
        grid.data = ${JSON.stringify(data)}
       })();
      `,
        'no-minify',
      )}
    </>
  )
}

export default VirtualGrid
