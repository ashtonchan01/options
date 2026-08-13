/**
 * % of followed tickers trading above their own 20/50/200-day SMA —
 * World-Monitor-style breadth bars, but scoped to your watchlist (not the
 * full S&P 500, which needs constituent data this app doesn't have).
 */
import { useEffect, useState } from 'react'
import { Activity } from 'lucide-react'
import { fetchBreadth, type Breadth } from '../../../services/breadth'
import { getFollowedTickers } from '../../../utils/followedTickers'

const REFRESH_MS = 5 * 60_000

const ROWS: { key: keyof Omit<Breadth, 'count'>; label: string }[] = [
  { key: 'above20', label: '% Above 20-day SMA' },
  { key: 'above50', label: '% Above 50-day SMA' },
  { key: 'above200', label: '% Above 200-day SMA' },
]

function barColor(pct: number): string {
  if (pct >= 60) return '#10b981'
  if (pct <= 40) return '#f43f5e'
  return '#f59e0b'
}

export default function MarketBreadthPanel() {
  const [breadth, setBreadth] = useState<Breadth | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const tickers = getFollowedTickers()
      if (tickers.length === 0) return
      const data = await fetchBreadth(tickers)
      if (!cancelled && data) setBreadth(data)
    }
    load()
    const id = setInterval(load, REFRESH_MS)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  return (
    <div className="dash-panel">
      <div className="dash-panel-header" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Activity size={13} style={{ color: 'var(--accent)' }} />
        <span>Watchlist Breadth</span>
        {breadth && <span className="dash-panel-sub" style={{ marginLeft: 'auto' }}>{breadth.count} tickers</span>}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 10, padding: '4px 2px' }}>
        {!breadth ? (
          <div style={{ fontSize: 12, color: 'var(--text-4)' }}>Loading breadth…</div>
        ) : ROWS.map(({ key, label }) => {
          const pct = breadth[key]
          return (
            <div key={key}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-3)', marginBottom: 4 }}>
                <span>{label}</span>
                <span style={{ fontWeight: 700, color: pct != null ? barColor(pct) : 'var(--text-4)', fontFamily: 'Inter, sans-serif' }}>
                  {pct != null ? `${pct.toFixed(1)}%` : '—'}
                </span>
              </div>
              <div style={{ height: 6, background: 'var(--bg-elevated)', borderRadius: 3, overflow: 'hidden' }}>
                {pct != null && (
                  <div style={{ width: `${pct}%`, height: '100%', background: barColor(pct), borderRadius: 3 }} />
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
