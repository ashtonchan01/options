/**
 * Persisted manual resize for a dashboard panel — wraps the native CSS
 * `resize` handle (drag the bottom-right corner) instead of a JS drag
 * library, and remembers the size per panel (by `id`) in localStorage so it
 * survives reloads. Falls back to `defaultWidth`/`defaultHeight` the first
 * time a panel is seen.
 */
import { useEffect, useRef } from 'react'

const LS_PREFIX = 'options:panelSize:'

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

export function useResizablePanel(id: string, defaultWidth: number, defaultHeight: number) {
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
    style: {
      width: stored?.w ?? defaultWidth,
      height: stored?.h ?? defaultHeight,
      resize: 'both' as const,
      overflow: 'hidden' as const,
      flex: '0 0 auto' as const,
    },
  }
}
