/**
 * Height for a dashboard panel. Width always follows the column. Until the
 * user drags the bottom edge, the card's height is left to CSS (content,
 * or the column rules in index.css) so it grows and shrinks with the
 * window. The drag is the only size written to localStorage — an earlier
 * ResizeObserver persisted every layout pass, which froze the height.
 */
import { useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, TouchEvent as ReactTouchEvent } from 'react'

const LS_MANUAL_PREFIX = 'options:panelManualHeight:'
const LS_WIDE_KEY = 'options:panelWide'

function loadManualHeight(id: string): number | null {
  try {
    const raw = localStorage.getItem(LS_MANUAL_PREFIX + id)
    if (!raw) return null
    const h = JSON.parse(raw)
    return typeof h === 'number' && h > 0 ? h : null
  } catch { return null }
}

function saveManualHeight(id: string, h: number) {
  try { localStorage.setItem(LS_MANUAL_PREFIX + id, JSON.stringify(h)) } catch { /* ignore */ }
}

function clearManualHeight(id: string) {
  try { localStorage.removeItem(LS_MANUAL_PREFIX + id) } catch { /* ignore */ }
}

/** `axis: 'vertical'` — for panels stacked in an independently-scrolling
 * column, only height should be user-resizable; width tracks the column.
 * `autoFit` stays in the signature so existing callers keep compiling;
 * the column CSS does the sizing. */
export function useResizablePanel(id: string, defaultWidth: number, defaultHeight: number, axis: 'both' | 'vertical' = 'both', autoFit = true) {
  void autoFit
  const ref = useRef<HTMLDivElement>(null)
  const [manualHeight, setManualHeight] = useState<number | null>(() => (
    axis === 'vertical' ? loadManualHeight(id) : null
  ))

  function lockHeight(next: number) {
    const h = Math.max(120, Math.round(next))
    saveManualHeight(id, h)
    setManualHeight(h)
  }

  function resetHeight() {
    clearManualHeight(id)
    setManualHeight(null)
  }

  // Until the user drags, leave height and flex off the inline style so the
  // column CSS can size the card (content height, fill the column, or share
  // the leftover space). An inline pixel height — including one written by
  // an old auto-fit pass — froze the card when the window changed size.
  const manual = manualHeight != null
  const verticalStyle = manual
    ? { width: '100%', height: manualHeight, resize: 'none' as const, overflow: 'auto' as const, flex: '0 0 auto' as const }
    : { width: '100%', resize: 'none' as const, overflow: 'auto' as const }

  return {
    ref,
    lockHeight,
    resetHeight,
    manual,
    style: axis === 'vertical'
      ? verticalStyle
      : {
        width: defaultWidth,
        height: defaultHeight,
        resize: 'both' as const,
        overflow: 'auto' as const,
        flex: '0 0 auto' as const,
      },
  }
}

/** JS drag handle for the bottom edge. Writes the height straight onto the
 * element while the pointer moves, and commits it through `onCommit` at
 * the start and end of the drag so the panel locks that height (and
 * remembers it) instead of auto-fitting back to content. */
export function useRowDragHandle(elRef: React.RefObject<HTMLElement | null>, onCommit?: (height: number) => void) {
  const [dragging, setDragging] = useState(false)

  function startDrag(clientY: number) {
    const el = elRef.current
    if (!el) return
    const startY = clientY
    const startHeight = el.getBoundingClientRect().height
    onCommit?.(startHeight)
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
      if (elRef.current) onCommit?.(elRef.current.getBoundingClientRect().height)
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
