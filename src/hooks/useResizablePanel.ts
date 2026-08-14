/**
 * Persisted manual resize for a dashboard panel — wraps the native CSS
 * `resize` handle (drag the bottom-right corner) instead of a JS drag
 * library, and remembers the size per panel (by `id`) in localStorage so it
 * survives reloads. Falls back to `defaultWidth`/`defaultHeight` the first
 * time a panel is seen.
 */
import { useEffect, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, TouchEvent as ReactTouchEvent } from 'react'

const LS_PREFIX = 'options:panelSize:'
const LS_WIDE_KEY = 'options:panelWide'

function loadSize(id: string): { w: number; h: number } | null {
  try {
    const raw = localStorage.getItem(LS_PREFIX + id)
    if (!raw) return null
    const { w, h } = JSON.parse(raw)
    return typeof w === 'number' && typeof h === 'number' ? { w, h } : null
  } catch { return null }
}

function saveSize(id: string, w: number, h: number) {
  try { localStorage.setItem(LS_PREFIX + id, JSON.stringify({ w, h })) } catch { /* ignore */ }
}

/** `axis: 'vertical'` — for panels stacked in an independently-scrolling
 * column, only height should be user-resizable; width tracking the
 * column's own width (not stored) is what keeps the column a fixed,
 * predictable size instead of individual panels drifting wider than it. */
export function useResizablePanel(id: string, defaultWidth: number, defaultHeight: number, axis: 'both' | 'vertical' = 'both') {
  const ref = useRef<HTMLDivElement>(null)
  const stored = loadSize(id)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      if (width <= 0 || height <= 0) return
      clearTimeout(timer)
      // Debounced — ResizeObserver fires continuously while dragging the
      // native resize handle; only the settled final size is worth writing.
      timer = setTimeout(() => saveSize(id, Math.round(width), Math.round(height)), 300)
    })
    ro.observe(el)
    return () => { ro.disconnect(); clearTimeout(timer) }
  }, [id])

  return {
    ref,
    style: axis === 'vertical'
      ? {
        width: '100%',
        height: stored?.h ?? defaultHeight,
        // JS drag handle (dash-row-resize-handle, below) replaces native
        // `resize` — a full-width 20px bottom bar is a far easier target
        // than the browser's own resize affordance, which only lives in a
        // ~15px corner nub.
        resize: 'none' as const,
        overflow: 'auto' as const,
        flex: '0 0 auto' as const,
      }
      : {
        width: stored?.w ?? defaultWidth,
        height: stored?.h ?? defaultHeight,
        resize: 'both' as const,
        overflow: 'auto' as const,
        flex: '0 0 auto' as const,
      },
  }
}

/** JS drag handle for the bottom edge — the row-height twin of
 * `useColDragHandle`, but continuous rather than threshold-flipped: our
 * panels have a free-form pixel height (persisted via the ResizeObserver in
 * `useResizablePanel` above, which watches the same element), so dragging
 * can just track the cursor directly instead of snapping to discrete steps.
 * Writes straight to the element's inline height — the existing
 * ResizeObserver + debounced localStorage save picks it up for free. */
export function useRowDragHandle(elRef: React.RefObject<HTMLElement | null>) {
  const [dragging, setDragging] = useState(false)

  function startDrag(clientY: number) {
    const el = elRef.current
    if (!el) return
    const startY = clientY
    const startHeight = el.getBoundingClientRect().height
    setDragging(true)

    function handleMove(y: number) {
      const next = Math.max(120, Math.round(startHeight + (y - startY)))
      el!.style.height = `${next}px`
    }
    function onMouseMove(e: MouseEvent) { handleMove(e.clientY) }
    function onTouchMove(e: TouchEvent) { const t = e.touches[0]; if (t) handleMove(t.clientY) }
    function stop() {
      setDragging(false)
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', stop)
      document.removeEventListener('touchmove', onTouchMove)
      document.removeEventListener('touchend', stop)
      document.removeEventListener('touchcancel', stop)
    }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', stop)
    document.addEventListener('touchmove', onTouchMove, { passive: false })
    document.addEventListener('touchend', stop)
    document.addEventListener('touchcancel', stop)
  }

  const onMouseDown = (e: ReactMouseEvent) => { e.preventDefault(); startDrag(e.clientY) }
  const onTouchStart = (e: ReactTouchEvent) => { const t = e.touches[0]; if (t) startDrag(t.clientY) }

  return { dragging, onMouseDown, onTouchStart }
}

function loadWideSet(): Set<string> {
  try {
    const raw = localStorage.getItem(LS_WIDE_KEY)
    return raw ? new Set(JSON.parse(raw)) : new Set()
  } catch { return new Set() }
}

/** Tracks which right-side panels are toggled to span the full width of
 * both columns (instead of just their own column) — the layout decision of
 * *where* a wide panel renders has to happen in the parent (Dashboard),
 * since it changes which column each other panel ends up in, so this is a
 * single shared map rather than each panel managing its own flag. */
export function useWideMap() {
  const [wideIds, setWideIds] = useState<Set<string>>(loadWideSet)

  function setWide(id: string, wide: boolean) {
    setWideIds(prev => {
      if (prev.has(id) === wide) return prev
      const next = new Set(prev)
      if (wide) next.add(id)
      else next.delete(id)
      try { localStorage.setItem(LS_WIDE_KEY, JSON.stringify([...next])) } catch { /* ignore */ }
      return next
    })
  }

  function toggleWide(id: string) {
    setWide(id, !wideIds.has(id))
  }

  return { wideIds, toggleWide, setWide }
}

// Drag past this many horizontal pixels before the span flips — matches
// World Monitor's Panel.ts step-based col-resize handle (COL_RESIZE_STEP_PX),
// adapted to a binary own-column/both-columns span since our layout is a
// fixed 2-column split rather than a 3+ column grid with intermediate spans.
const COL_DRAG_THRESHOLD_PX = 60

/** JS drag handle for the right edge, in the style of World Monitor's
 * Panel.ts `colResizeHandle` (mousedown → track deltaX → mouseup persists),
 * rather than a plain click-to-toggle button. Dragging the handle right past
 * the threshold expands the panel to span both columns; dragging it back
 * left past the threshold while already wide shrinks it back. */
export function useColDragHandle(wide: boolean, onSetWide: (wide: boolean) => void) {
  const [dragging, setDragging] = useState(false)

  function startDrag(clientX: number) {
    const startX = clientX
    let flipped = wide
    setDragging(true)

    function handleMove(x: number) {
      const deltaX = x - startX
      const shouldBeWide = wide ? deltaX > -COL_DRAG_THRESHOLD_PX : deltaX > COL_DRAG_THRESHOLD_PX
      if (shouldBeWide !== flipped) {
        flipped = shouldBeWide
        onSetWide(shouldBeWide)
      }
    }
    function onMouseMove(e: MouseEvent) { handleMove(e.clientX) }
    function onTouchMove(e: TouchEvent) { const t = e.touches[0]; if (t) handleMove(t.clientX) }
    function stop() {
      setDragging(false)
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', stop)
      document.removeEventListener('touchmove', onTouchMove)
      document.removeEventListener('touchend', stop)
      document.removeEventListener('touchcancel', stop)
    }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', stop)
    document.addEventListener('touchmove', onTouchMove, { passive: true })
    document.addEventListener('touchend', stop)
    document.addEventListener('touchcancel', stop)
  }

  const onMouseDown = (e: ReactMouseEvent) => { e.preventDefault(); startDrag(e.clientX) }
  const onTouchStart = (e: ReactTouchEvent) => { const t = e.touches[0]; if (t) startDrag(t.clientX) }

  return { dragging, onMouseDown, onTouchStart }
}
