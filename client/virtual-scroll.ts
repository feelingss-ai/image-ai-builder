// client/virtual-scroll.ts
// True virtual scroll for the upload-image page.
// Only visible items (plus a small buffer) are rendered in the DOM.
// Inspired by beenotung/stencil-virtual-scroll grid algorithm.

let ITEM_WIDTH = 260
let ITEM_HEIGHT = 310
let BUFFER_ROWS = 1
let BATCH_SIZE = 50

type VSImage = {
  id: number
  filename: string
  original_filename: string | null
}

function initVirtualScroll() {
  let listEl = document.getElementById('imageList')
  if (!listEl) return
  // const alias so TypeScript can narrow to non-null inside closures
  const list = listEl
  // Guard against double-init (e.g. SPA navigation + setTimeout both firing)
  if ((list as any).__vsInit) return
  ;(list as any).__vsInit = true
  let projectId = list.dataset.projectId || ''
  if (!projectId) return

  let total = parseInt(list.dataset.total || '0', 10)
  let layout = list.dataset.layout || 'multi'

  // State
  let fetched: (VSImage | null)[] = new Array(total).fill(null)
  let fetchedRanges: { start: number; end: number }[] = []
  let visibleItems = new Map<number, HTMLElement>()
  let loading = false
  let nCol = 1
  let scrollTop = 0
  let viewportH = 0
  let containerW = 0
  let renderRAF: number | undefined

  // Create spacer div for scrollbar height
  let spacer = document.createElement('div')
  spacer.className = 'vs-spacer'
  spacer.style.pointerEvents = 'none'
  list.appendChild(spacer)

  let content = list.closest('ion-content') as HTMLElement | null
  let innerEl = content?.shadowRoot?.querySelector('.inner-scroll') as HTMLElement | null

  // Cache the offset of #imageList within .inner-scroll content.
  // This avoids calling getBoundingClientRect() on every render (which causes
  // reflow feedback loops and flickering). Recalculate only on resize.
  let cachedListOffsetTop: number | null = null

  function recalcOffset() {
    if (!innerEl) {
      innerEl = content?.shadowRoot?.querySelector('.inner-scroll') as HTMLElement | null
    }
    if (innerEl) {
      let innerRect = innerEl.getBoundingClientRect()
      let listRect = list.getBoundingClientRect()
      cachedListOffsetTop = listRect.top - innerRect.top + innerEl.scrollTop
    }
  }

  function getScrollInfo() {
    if (innerEl && cachedListOffsetTop !== null) {
      let vsScrollTop = innerEl.scrollTop - cachedListOffsetTop
      return {
        scrollTop: vsScrollTop,
        scrollHeight: innerEl.scrollHeight,
        clientHeight: innerEl.clientHeight,
      }
    }
    // Fallback: window scroll — #imageList's top relative to viewport
    let listRect = list.getBoundingClientRect()
    return {
      scrollTop: -listRect.top,
      scrollHeight: document.documentElement.scrollHeight,
      clientHeight: window.innerHeight,
    }
  }

  function computeCols() {
    containerW = list.clientWidth
    if (layout === 'single') {
      nCol = 1
      ITEM_WIDTH = containerW
    } else {
      nCol = Math.max(1, Math.floor(containerW / ITEM_WIDTH))
    }
  }

  let lastSpacerHeight = -1
  function updateSpacer() {
    let totalRows = Math.ceil(total / nCol)
    let h = totalRows * ITEM_HEIGHT
    if (h === lastSpacerHeight) return
    lastSpacerHeight = h
    spacer.style.height = h + 'px'
    spacer.style.width = '100%'
    // Set container height directly — absolutely-positioned children don't contribute to parent height
    list.style.height = h + 'px'
  }

  function isFetched(idx: number): boolean {
    return fetchedRanges.some(r => idx >= r.start && idx < r.end)
  }

  async function fetchRange(startIdx: number, endIdx: number) {
    // Clamp to valid range
    startIdx = Math.max(0, startIdx)
    endIdx = Math.min(total, endIdx)
    if (startIdx >= endIdx) return

    // Find unfetched sub-ranges within [startIdx, endIdx)
    let toFetch: { start: number; end: number }[] = []
    for (let i = startIdx; i < endIdx; i++) {
      if (!isFetched(i)) {
        let s = i
        while (i < endIdx && !isFetched(i)) i++
        toFetch.push({ start: s, end: i })
      }
    }
    if (toFetch.length === 0) return

    loading = true
    for (let range of toFetch) {
      let offset = range.start
      while (offset < range.end) {
        let chunkLimit = Math.min(BATCH_SIZE, range.end - offset)
        let params = new URLSearchParams({
          project: projectId,
          offset: String(offset),
          limit: String(chunkLimit),
        })
        let res = await fetch('/upload-image/list?' + params)
        let json = await res.json().catch(() => ({ error: res.statusText || `Status: ${res.status}` }))
        if (json.error) {
          loading = false
          return
        }
        let images: VSImage[] = json.images || []
        for (let j = 0; j < images.length; j++) {
          fetched[offset + j] = images[j]
        }
        fetchedRanges.push({ start: offset, end: offset + images.length })
        if (json.total !== undefined) {
          total = json.total
          fetched.length = total
          let countEl = document.getElementById('imageCount')
          if (countEl) countEl.textContent = total.toLocaleString()
        }
        offset += images.length
        if (images.length < chunkLimit) break
      }
    }
    loading = false
    render()
  }

  function createItemElement(idx: number): HTMLElement | undefined {
    let template = list.querySelector('.image-item--template') as HTMLElement | null
    if (!template) {
 console.log('[VS] createItem: TEMPLATE NOT FOUND for idx', idx)
 return undefined
    }
    let item = template.cloneNode(true) as HTMLElement
    item.classList.remove('image-item--template')
    item.classList.add('image-item--vs')
    item.style.position = 'absolute'
    item.style.top = '0'
    item.style.left = '0'
    item.style.width = (layout === 'single' ? containerW : ITEM_WIDTH) + 'px'
    item.style.height = ITEM_HEIGHT + 'px'
    item.style.boxSizing = 'border-box'

    let data = fetched[idx]
    let img = item.querySelector('img')
    if (img) {
      if (data) {
 let src = '/uploads/' + data.filename
 img.src = src
      } else {
 img.removeAttribute('src')
      }
    }
    let nameEl = item.querySelector('.image-item--filename')
    if (nameEl) {
      nameEl.textContent = data ? (data.original_filename || data.filename) : '...'
    }
    return item
  }

  function positionItem(item: HTMLElement, idx: number) {
    let col = idx % nCol
    let row = Math.floor(idx / nCol)
    // Number of items actually in this row (last row may be partial)
    let itemsInRow = Math.min(nCol, total - row * nCol)
    // Total width of this row
    let rowWidth = itemsInRow * ITEM_WIDTH
    // Centering offset: push the row right so it is centered in the container
    let offsetX = Math.max(0, (containerW - rowWidth) / 2)
    let x = offsetX + col * ITEM_WIDTH
    let y = row * ITEM_HEIGHT
    item.style.transform = `translate(${x}px, ${y}px)`
  }

  function render() {
    if (total === 0) {
      // Remove all visible items
      visibleItems.forEach(el => el.remove())
      visibleItems.clear()
      updateSpacer()
      return
    }

    computeCols()
    updateSpacer()

    let info = getScrollInfo()
    scrollTop = info.scrollTop
    viewportH = info.clientHeight

    // scrollTop (vsScrollTop) = how far into #imageList we've scrolled.
    // Positive = list top is above viewport (scrolled into view).
    // Negative = list top is below viewport (not yet scrolled to).
    // Visible window in #imageList coordinates: [scrollTop, scrollTop + viewportH]
    let viewTop = Math.max(0, scrollTop)
    let viewBottom = scrollTop + viewportH

    let totalRows = Math.ceil(total / nCol)
    let listHeight = totalRows * ITEM_HEIGHT

    // If the visible window doesn't overlap with the list content at all, render nothing
    if (viewTop >= listHeight || viewBottom <= 0) {
      visibleItems.forEach(el => el.remove())
      visibleItems.clear()
      return
    }

    let firstRow = Math.max(0, Math.floor(viewTop / ITEM_HEIGHT) - BUFFER_ROWS)
    let lastRow = Math.min(
      totalRows - 1,
      Math.floor(viewBottom / ITEM_HEIGHT) + BUFFER_ROWS,
    )
    let firstIdx = firstRow * nCol
    let lastIdx = Math.min(total - 1, (lastRow + 1) * nCol - 1)

    // Remove items no longer in range
    visibleItems.forEach((el, idx) => {
      if (idx < firstIdx || idx > lastIdx) {
        el.remove()
        visibleItems.delete(idx)
      }
    })

    // Add or update items in range
    let needsFetch = false
    let fetchStart = -1
    let fetchEnd = -1
    for (let idx = firstIdx; idx <= lastIdx; idx++) {
      let el = visibleItems.get(idx)
      if (!el) {
        el = createItemElement(idx)
        if (el) {
          positionItem(el, idx)
          list.appendChild(el)
          visibleItems.set(idx, el)
        }
        if (!fetched[idx]) {
          if (fetchStart === -1) fetchStart = idx
          fetchEnd = idx + 1
          needsFetch = true
        }
      } else {
        // Update position (in case nCol changed on resize)
        positionItem(el, idx)
        // Update content if data became available
        let data = fetched[idx]
        if (data) {
          let img = el.querySelector('img')
          if (img && img.getAttribute('src') !== '/uploads/' + data.filename) {
            img.src = '/uploads/' + data.filename
          }
          let nameEl = el.querySelector('.image-item--filename')
          if (nameEl && nameEl.textContent === '...') {
            nameEl.textContent = data.original_filename || data.filename
          }
        }
      }
    }

    // Fetch missing data
    if (needsFetch && !loading && fetchStart !== -1) {
      // Expand fetch range to BATCH_SIZE for prefetching
      let expandedStart = Math.max(0, fetchStart - Math.floor(BATCH_SIZE / 4))
      let expandedEnd = Math.min(total, fetchEnd + Math.floor(BATCH_SIZE / 4))
      fetchRange(expandedStart, expandedEnd)
    }

  }

  function scheduleRender() {
    if (renderRAF !== undefined) cancelAnimationFrame(renderRAF)
    renderRAF = requestAnimationFrame(() => {
      renderRAF = undefined
      render()
    })
  }

  // Scroll listener
  function onScroll() {
    scheduleRender()
  }

  if (content) {
    content.addEventListener('ionScroll', onScroll)
    if (innerEl) {
      innerEl.addEventListener('scroll', onScroll, { passive: true })
    } else {
      // Retry after ion-content upgrades
      setTimeout(() => {
        innerEl = content!.shadowRoot?.querySelector('.inner-scroll') as HTMLElement | null
        if (innerEl) innerEl.addEventListener('scroll', onScroll, { passive: true })
      }, 500)
    }
  } else {
    window.addEventListener('scroll', onScroll, { passive: true })
  }

  // Resize handler (debounced)
  let resizeTimer: ReturnType<typeof setTimeout> | undefined
  function onResize() {
    if (resizeTimer !== undefined) clearTimeout(resizeTimer)
    resizeTimer = setTimeout(() => {
      recalcOffset()
      computeCols()
      // Reposition all visible items
      visibleItems.forEach((el, idx) => {
        el.style.width = (layout === 'single' ? list.clientWidth : ITEM_WIDTH) + 'px'
        positionItem(el, idx)
      })
      updateSpacer()
      render()
    }, 150)
  }
  window.addEventListener('resize', onResize)

  // Initial render — calculate offset first, then render
  recalcOffset()
  computeCols()
  updateSpacer()
  render()

  // Recalculate offset after a delay — content above #imageList (Ionic components,
  // images, etc.) may still be loading and change the layout
  setTimeout(recalcOffset, 300)
  setTimeout(recalcOffset, 1000)

  // Keep trying to fill viewport until we have enough data
  function initialFill() {
    let info = getScrollInfo()
    let fetchedCount = fetchedRanges.reduce((s, r) => s + (r.end - r.start), 0)
    if (info.scrollHeight - info.clientHeight < 50 && total > fetchedCount) {
      fetchRange(0, Math.min(total, BATCH_SIZE * 2)).then(() => {
        setTimeout(initialFill, 100)
      })
    }
  }
  setTimeout(initialFill, 200)
}

Object.assign(window, { initVirtualScroll })

// Auto-init: wait for ion-content to be upgraded before initializing
if (typeof customElements !== 'undefined' && customElements.whenDefined) {
  customElements.whenDefined('ion-content').then(() => {
    // Small delay to let ion-content fully render its shadow DOM
    setTimeout(() => {
      let list = document.getElementById('imageList')
      if (list && list.dataset.projectId) {
        initVirtualScroll()
      }
    }, 100)
  })
} else {
  // Fallback for very old browsers
  setTimeout(() => {
    let list = document.getElementById('imageList')
    if (list && list.dataset.projectId) {
      initVirtualScroll()
    }
  }, 500)
}