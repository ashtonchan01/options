import type { ReactNode } from 'react'
import { useResizablePanel, useColDragHandle } from '../../hooks/useResizablePanel'

/** Drag the resize handle (bottom-right corner) to resize — size is
 * remembered per panel id. `dash-resizable` (on top of `dash-cell`) is what
 * draws the visible grip decoration in CSS — the native browser resize
 * handle alone is a very faint, easy-to-miss corner nub in a dark theme.
 * `onSetWide` (when given) attaches a right-edge drag handle — World-
 * Monitor-style (see Panel.ts's colResizeHandle) — to span the panel across
 * both right-side columns instead of just its own: drag right past the
 * threshold to expand, drag back left to shrink. Double-click resets. The
 * Dashboard decides where a "wide" panel actually renders (see useWideMap);
 * this component just draws the handle and the wider box. */
export default function ResizablePanel({ id, defaultWidth, defaultHeight, axis = 'both', wide, onSetWide, children }: {
  id: string
  defaultWidth: number
  defaultHeight: number
  axis?: 'both' | 'vertical'
  wide?: boolean
  onSetWide?: (wide: boolean) => void
  children: ReactNode
}) {
  const { ref, style } = useResizablePanel(id, defaultWidth, defaultHeight, axis)
  const { dragging, onMouseDown, onTouchStart } = useColDragHandle(!!wide, onSetWide ?? (() => {}))
  return (
    <div ref={ref} className="dash-cell dash-resizable" style={style}>
      {onSetWide && (
        <div
          className={`dash-col-resize-handle${dragging ? ' active' : ''}`}
          title={wide ? 'Drag left to shrink to one column' : 'Drag right to expand across both columns'}
          onMouseDown={onMouseDown}
          onTouchStart={onTouchStart}
          onDoubleClick={() => onSetWide(!wide)}
        />
      )}
      {children}
    </div>
  )
}
