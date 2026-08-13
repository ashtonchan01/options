/**
 * This week's earnings dates for followed tickers — reuses the same
 * earnings service the Calendar tab's badges already pull from.
 */
import { useEffect, useState } from 'react'
import { CalendarClock } from 'lucide-react'
import { fetchEarningsDates, earningsByDate } from '../../../services/earnings'
import { getFollowedTickers } from '../../../utils/followedTickers'

function fmtDate(d: string): string {
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

export default function EarningsCalendarPanel() {
  const [rows, setRows] = useState<{ date: string; tickers: string[] }[] | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const tickers = getFollowedTickers()
      if (tickers.length === 0) { setRows([]); return }
      const map = await fetchEarningsDates(tickers)
      if (cancelled) return
      const byDate = earningsByDate(map)
      const today = new Date(); today.setHours(0, 0, 0, 0)
      const horizon = new Date(today); horizon.setDate(horizon.getDate() + 14)
      const upcoming = Object.entries(byDate)
        .filter(([d]) => { const dt = new Date(d + 'T12:00:00'); return dt >= today && dt <= horizon })
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, tickers]) => ({ date, tickers }))
      setRows(upcoming)
    }
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="dash-panel">
      <div className="dash-panel-header" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <CalendarClock size={13} style={{ color: 'var(--accent)' }} />
        <span>Earnings Calendar</span>
        <span className="dash-panel-sub" style={{ marginLeft: 'auto' }}>Next 14 days</span>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 6, padding: '2px' }}>
        {rows == null ? (
          <div style={{ fontSize: 12, color: 'var(--text-4)' }}>Loading…</div>
        ) : rows.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text-4)' }}>No followed tickers reporting in the next 14 days.</div>
        ) : rows.map(r => (
          <div key={r.date} style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '6px 9px',
            background: 'var(--bg-elevated)', border: '1px solid var(--border-light)', borderRadius: 6,
          }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-3)', flexShrink: 0, width: 76 }}>
              {fmtDate(r.date)}
            </span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {r.tickers.map(t => (
                <span key={t} style={{
                  fontSize: 10, fontWeight: 700, color: '#F0B429', background: '#F0B42914',
                  border: '1px solid #F0B42930', borderRadius: 3, padding: '1px 6px',
                }}>
                  {t}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
