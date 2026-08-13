import type { ReactNode } from 'react'
import { useResizablePanel } from '../../hooks/useResizablePanel'

/** Drag the resize handle to resize — size is remembered per panel id. */
export default function ResizablePanel({ id, defaultWidth, defaultHeight, axis = 'both', children }: {
  id: string
  defaultWidth: number
  defaultHeight: number
  axis?: 'both' | 'vertical'
  children: ReactNode
}) {
  const { ref, style } = useResizablePanel(id, defaultWidth, defaultHeight, axis)
  return (
    <div ref={ref} className="dash-cell" style={style}>
      {children}
    </div>
  )
}
