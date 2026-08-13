/**
 * Sector performance grid — the 11 SPDR sector ETFs colored by today's %
 * change, World-Monitor-style. Free data (Yahoo via the existing
 * /api/markets proxy), no new backend needed.
 */
import { useEffect, useState } from 'react'
import { RefreshCw, Grid3x3 } from 'lucide-react'
import { fetchMarketQuotes, type MarketQuote } from '../../../services/markets'
import { SECTOR_ETFS } from '../../../data/sectorEtfs'

const REFRESH_MS = 60_000

/** Green/red intensity scales with |%change|, capped at 3% so one outlier
 * sector doesn't wash out the rest of the grid. */
function heatColor(pct: number | undefined): string {
  if (pct == null) return 'var(--bg-elevated)'
  const t = Math.min(Math.abs(pct) / 3, 1)
  return pct >= 0 ? `rgba(16,185,129,${0.08 + t * 0.34})` : `rgba(244,63,94,${0.08 + t * 0.34})`
}

export default function SectorHeatmapPanel() {
  const [quotes, setQuotes] = useState<Record<string, MarketQuote>>({})
  const [loading, setLoading] = useState(false)

  async function load() {
    setLoading(true)
    const data = await fetchMarketQuotes(SECTOR_ETFS.map(s => s.symbol))
    if (Object.keys(data).length > 0) setQuotes(data)
    setLoading(false)
  }

  useEffect(() => {
    load()
    const id = setInterval(load, REFRESH_MS)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="dash-panel">
      <div className="dash-panel-header" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Grid3x3 size={13} style={{ color: 'var(--accent)' }} />
        <span>Sector Heatmap</span>
        <button onClick={load} disabled={loading} title="Refresh" style={{
          background: 'none', border: 'none', color: 'var(--text-4)', cursor: loading ? 'not-allowed' : 'pointer',
          display: 'flex', padding: 0, marginLeft: 'auto',
        }}>
          <RefreshCw size={11} style={{ animation: loading ? 'spin 1.5s linear infinite' : 'none' }} />
        </button>
      </div>
      <div style={{
        flex: 1, minHeight: 0, display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))',
        gridAutoRows: 'minmax(0, 1fr)', gap: 4, overflow: 'auto', padding: '2px 2px 4px',
      }}>
        {SECTOR_ETFS.map(s => {
          const q = quotes[s.symbol]
          return (
            <div key={s.symbol} style={{
              background: heatColor(q?.changePercent), border: '1px solid var(--border-light)', borderRadius: 6,
              padding: '6px 8px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: 54,
            }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-2)' }}>{s.symbol}</div>
              <div style={{ fontSize: 9, color: 'var(--text-4)', lineHeight: 1.3, marginBottom: 2 }}>{s.name}</div>
              <div style={{
                fontSize: 12.5, fontWeight: 800, fontFamily: 'Inter, sans-serif',
                color: q ? (q.changePercent >= 0 ? '#10b981' : '#f43f5e') : 'var(--text-4)',
              }}>
                {q ? `${q.changePercent >= 0 ? '+' : ''}${q.changePercent.toFixed(2)}%` : '—'}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
