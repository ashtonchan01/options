import type { ReactNode } from 'react'
import { Maximize2, Minimize2 } from 'lucide-react'
import { useResizablePanel } from '../../hooks/useResizablePanel'

/** Drag the resize handle (bottom-right corner) to resize — size is
 * remembered per panel id. `dash-resizable` (on top of `dash-cell`) is what
 * draws the visible grip decoration in CSS — the native browser resize
 * handle alone is a very faint, easy-to-miss corner nub in a dark theme.
 * `onToggleWide` (when given) renders a corner button to span the panel
 * across both right-side columns instead of just its own — the Dashboard
 * decides where a "wide" panel actually renders (see useWideMap), this
 * component just draws the button and the wider box. */
export default function ResizablePanel({ id, defaultWidth, defaultHeight, axis = 'both', wide, onToggleWide, children }: {
  id: string
  defaultWidth: number
  defaultHeight: number
  axis?: 'both' | 'vertical'
  wide?: boolean
  onToggleWide?: () => void
  children: ReactNode
}) {
  const { ref, style } = useResizablePanel(id, defaultWidth, defaultHeight, axis)
  return (
    <div ref={ref} className="dash-cell dash-resizable" style={style}>
      {onToggleWide && (
        <button onClick={onToggleWide} title={wide ? 'Shrink to one column' : 'Expand to both columns'} style={{
          position: 'absolute', top: 6, right: 6, zIndex: 2,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: 20, height: 20, padding: 0, borderRadius: 4,
          background: 'var(--bg-elevated)', border: '1px solid var(--border-light)',
          color: 'var(--text-4)', cursor: 'pointer',
        }}>
          {wide ? <Minimize2 size={11} /> : <Maximize2 size={11} />}
        </button>
      )}
      {children}
    </div>
  )
}
