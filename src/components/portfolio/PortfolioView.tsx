/**
 * Portfolio tab — combines the Analytics (urgency-ranked actions,
 * allocation pie, cash flow) and Calendar (expiries/earnings/econ events)
 * views behind an internal sub-nav.
 */
import { useState } from 'react'
import type { AppState } from '../../types'
import type { TradeLabels } from '../../App'
import AnalyticsView from '../analytics/AnalyticsView'
import CalendarView from '../calendar/CalendarView'

type SubTab = 'analytics' | 'calendar'

const SUB_TABS: { id: SubTab; label: string }[] = [
  { id: 'analytics', label: 'Analytics' },
  { id: 'calendar',  label: 'Calendar' },
]

export default function PortfolioView({ state, tradeLabels }: { state: AppState; tradeLabels?: TradeLabels }) {
  const [sub, setSub] = useState<SubTab>('analytics')

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', gap: 6, padding: '14px 24px 0', flexShrink: 0 }}>
        {SUB_TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setSub(t.id)}
            style={{
              fontSize: 12.5, fontWeight: 600, padding: '7px 16px', borderRadius: '6px 6px 0 0',
              border: '1px solid var(--border)', borderBottom: sub === t.id ? '1px solid var(--bg-page)' : '1px solid var(--border)',
              background: sub === t.id ? 'var(--bg-page)' : 'var(--bg-card)',
              color: sub === t.id ? 'var(--text-1)' : 'var(--text-3)',
              cursor: 'pointer', fontFamily: 'inherit', marginBottom: -1,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div style={{ flex: 1, minHeight: 0, borderTop: '1px solid var(--border)' }}>
        {sub === 'analytics' && <AnalyticsView state={state} tradeLabels={tradeLabels} />}
        {sub === 'calendar' && <CalendarView state={state} />}
      </div>
    </div>
  )
}
