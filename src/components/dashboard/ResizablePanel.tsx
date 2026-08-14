import type { ReactNode } from 'react'
import { useResizablePanel, useColDragHandle, useRowDragHandle } from '../../hooks/useResizablePanel'

/** Drag the bottom edge to resize height, the right edge to expand across
 * both columns — both are JS drag handles (World-Monitor-style, see
 * Panel.ts's resizeHandle/colResizeHandle) with a full-width/full-height
 * 20px hit area rather than relying on the browser's own tiny corner resize
 * nub, which is easy to miss and hard to grab precisely. `onSetWide` (when
 * given) enables the right-edge handle: drag right past the threshold to
 * expand, drag back left to shrink, double-click resets. The Dashboard
 * decides where a "wide" panel actually renders (see useWideMap); this
 * component just draws the handles and the wider box. */
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
  const row = useRowDragHandle(ref)
  const col = useColDragHandle(!!wide, onSetWide ?? (() => {}))
  return (
    <div ref={ref} className="dash-cell dash-resizable" style={style}>
      {axis === 'vertical' && (
        <div
          className={`dash-row-resize-handle${row.dragging ? ' active' : ''}`}
          title="Drag to resize (double-click to reset)"
          onMouseDown={row.onMouseDown}
          onTouchStart={row.onTouchStart}
          onDoubleClick={() => { if (ref.current) ref.current.style.height = `${defaultHeight}px` }}
        />
      )}
      {onSetWide && (
        <div
          className={`dash-col-resize-handle${col.dragging ? ' active' : ''}`}
          title={wide ? 'Drag left to shrink to one column' : 'Drag right to expand across both columns'}
          onMouseDown={col.onMouseDown}
          onTouchStart={col.onTouchStart}
          onDoubleClick={() => onSetWide(!wide)}
        />
      )}
      {children}
    </div>
  )
}
