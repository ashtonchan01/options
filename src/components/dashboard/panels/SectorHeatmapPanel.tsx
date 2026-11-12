/**
 * Sector performance grid — the 11 SPDR sector ETFs colored by today's %
 * change, World-Monitor-style. Free data (Yahoo via the existing
 * /api/markets proxy), no new backend needed.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { RefreshCw, Grid3x3 } from 'lucide-react'
import { fetchMarketQuotes, type MarketQuote } from '../../../services/markets'
import { SECTOR_ETFS } from '../../../data/sectorEtfs'

const REFRESH_MS = 60_000

/** Row lengths that share 11 tiles without a one-tile last row.
 *  The first plan whose narrowest tile is wider than it is tall wins,
 *  so a wide window wraps instead of stretching one row into portrait bars. */
const HEAT_PLANS: number[][] = [
  [11],
  [6, 5],
  [4, 4, 3],
  [3, 3, 3, 2],
]

function heatPlan(width: number, height: number): number[] {
  const gap = 4
  if (width < 40 || height < 40) return [4, 4, 3]
  for (const plan of HEAT_PLANS) {
    const fullest = Math.max(...plan)
    const tileW = (width - gap * (fullest - 1)) / fullest
    const tileH = (height - gap * (plan.length - 1)) / plan.length
    if (tileW > tileH + 4) return plan
  }
  return [3, 3, 3, 2]
}

function samePlan(a: number[], b: number[]) {
  return a.length === b.length && a.every((n, i) => n === b[i])
}

/** Stacked layout: the card's height is its content, so measuring that
 *  height and feeding it back into the row count collapses the grid into
 *  one overflowing row. Pick columns from the width alone, wide enough
 *  for a sector name and a percentage. */
function stackedPlan(width: number, minTile: number, count: number): number[] {
  const gap = 4
  const cols = Math.max(1, Math.min(count, Math.floor((width + gap) / (minTile + gap))))
  const plan: number[] = []
  let left = count
  while (left > 0) {
    const n = Math.min(cols, left)
    plan.push(n)
    left -= n
  }
  return plan
}

function stackedLayout(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(max-width: 650px)').matches
}

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
  const [plan, setPlan] = useState<number[]>([6, 5])
  const rowsRef = useRef<HTMLDivElement>(null)

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

  useLayoutEffect(() => {
    const el = rowsRef.current
    if (!el) return
    const measure = () => {
      const { width, height } = el.getBoundingClientRect()
      const next = stackedLayout() ? stackedPlan(width, 156, SECTOR_ETFS.length) : heatPlan(width, height)
      setPlan(prev => (samePlan(prev, next) ? prev : next))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    const query = window.matchMedia('(max-width: 650px)')
    query.addEventListener('change', measure)
    return () => {
      ro.disconnect()
      query.removeEventListener('change', measure)
    }
  }, [])

  const rows: { symbol: string; name: string }[][] = []
  let cursor = 0
  for (const count of plan) {
    rows.push(SECTOR_ETFS.slice(cursor, cursor + count))
    cursor += count
  }

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
      <div className="dash-heat-rows" ref={rowsRef} style={{ '--heat-cols': Math.max(...plan) } as React.CSSProperties}>
        {rows.map((row, i) => (
          <div className="dash-heat-row" key={i}>
            {row.map(s => {
              const q = quotes[s.symbol]
              return (
                <div className="dash-heat-slot" key={s.symbol}>
                  <div className="dash-heat-tile" style={{ background: heatColor(q?.changePercent) }}>
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-2)' }}>{s.symbol}</div>
                    <div className="dash-heat-name">{s.name}</div>
                    <div style={{
                      fontSize: 12.5, fontWeight: 800, fontFamily: 'Inter, sans-serif', marginTop: 'auto',
                      color: q ? (q.changePercent >= 0 ? '#10b981' : '#f43f5e') : 'var(--text-4)',
                    }}>
                      {q ? `${q.changePercent >= 0 ? '+' : ''}${q.changePercent.toFixed(2)}%` : '—'}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
