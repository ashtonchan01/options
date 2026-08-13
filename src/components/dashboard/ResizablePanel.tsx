import type { ReactNode } from 'react'
import { useResizablePanel } from '../../hooks/useResizablePanel'

/** Drag the bottom-right corner to resize — size is remembered per panel id. */
export default function ResizablePanel({ id, defaultWidth, defaultHeight, children }: {
  id: string
  defaultWidth: number
  defaultHeight: number
  children: ReactNode
}) {
  const { ref, style } = useResizablePanel(id, defaultWidth, defaultHeight)
  return (
    <div ref={ref} className="dash-cell" style={style}>
      {children}
    </div>
  )
}
