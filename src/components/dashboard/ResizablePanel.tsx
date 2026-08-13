import type { ReactNode } from 'react'
import { useResizablePanel } from '../../hooks/useResizablePanel'

/** Drag the resize handle (bottom-right corner) to resize — size is
 * remembered per panel id. `dash-resizable` (on top of `dash-cell`) is what
 * draws the visible grip decoration in CSS — the native browser resize
 * handle alone is a very faint, easy-to-miss corner nub in a dark theme. */
export default function ResizablePanel({ id, defaultWidth, defaultHeight, axis = 'both', children }: {
  id: string
  defaultWidth: number
  defaultHeight: number
  axis?: 'both' | 'vertical'
  children: ReactNode
}) {
  const { ref, style } = useResizablePanel(id, defaultWidth, defaultHeight, axis)
  return (
    <div ref={ref} className="dash-cell dash-resizable" style={style}>
      {children}
    </div>
  )
}
