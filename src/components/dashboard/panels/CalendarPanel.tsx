/**
 * Calendar column for the Dashboard overview — wraps the existing
 * CalendarView (month grid + activity list) forced into a stacked
 * layout (grid on top, list below) regardless of viewport width, since
 * CalendarView's own side-by-side layout only stacks at mobile widths.
 */
import type { AppState } from '../../../types'
import CalendarView from '../../calendar/CalendarView'

export default function CalendarPanel({ state }: { state: AppState }) {
  return (
    <div className="dash-panel dash-calendar-embed" style={{ padding: 0, overflow: 'hidden' }}>
      <CalendarView state={state} />
    </div>
  )
}
