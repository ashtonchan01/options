/**
 * Scrollable strip of wide sparkline cards for major indices/commodities —
 * sits below WorldMapPanel on the Dashboard overview. Mirrors the top
 * ticker bar on Yahoo Finance's markets pages (major US indices, crude,
 * gold, bitcoin, the 10-yr yield, VIX) rather than the full global exchange
 * list EXCHANGES holds for the world map — a separate, dedicated list here
 * so changing one doesn't affect the other.
 */
import { useLayoutEffect, useRef, useState } from 'react'
import type { MarketQuote } from '../../../services/markets'

// Shared with the dashboard quote fetch, so this file exports more than the component.
// eslint-disable-next-line react-refresh/only-export-components
export const MARKET_BAR_SYMBOLS = [
  { symbol: '^GSPC', name: 'S&P 500', short: 'S&P' },
  { symbol: '^DJI', name: 'Dow Jones', short: 'Dow' },
  { symbol: '^IXIC', name: 'Nasdaq', short: 'Nasdaq' },
  { symbol: '^RUT', name: 'Russell 2000', short: 'Russell' },
  { symbol: 'CL=F', name: 'Crude Oil', short: 'Crude' },
  { symbol: 'GC=F', name: 'Gold', short: 'Gold' },
  { symbol: 'BTC-USD', name: 'Bitcoin USD', short: 'Bitcoin' },
  { symbol: '^TNX', name: '10-Yr Yield', short: '10Y' },
  { symbol: '^VIX', name: 'VIX', short: 'VIX' },
]
const CHART_CARDS = MARKET_BAR_SYMBOLS

function fmtPrice(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const VB_WIDTH = 140
const VB_HEIGHT = 40

/** Fills its container (preserveAspectRatio="none") instead of a fixed pixel size. */
function Sparkline({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2) return <svg style={{ width: '100%', height: '100%' }} />
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * VB_WIDTH
    const y = VB_HEIGHT - ((v - min) / range) * VB_HEIGHT
    return [x, y] as const
  })
  const linePath = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const areaPath = `${linePath} L${VB_WIDTH},${VB_HEIGHT} L0,${VB_HEIGHT} Z`
  return (
    <svg viewBox={`0 0 ${VB_WIDTH} ${VB_HEIGHT}`} preserveAspectRatio="none" style={{ width: '100%', height: '100%', display: 'block' }}>
      <path d={areaPath} fill={color} opacity={0.12} />
      <path d={linePath} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

function ChartFace({ ex, quote, compact }: { ex: typeof CHART_CARDS[number]; quote: MarketQuote | undefined; compact?: boolean }) {
  const color = !quote ? 'var(--text-3)' : quote.change >= 0 ? '#10b981' : '#f43f5e'
  return (
    <>
      <div style={{ display: 'flex', flexDirection: compact ? 'column' : 'row', alignItems: compact ? 'stretch' : 'baseline', justifyContent: 'space-between', gap: compact ? 1 : 6, flexShrink: 0, minWidth: 0 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {compact ? ex.short : ex.name}
        </span>
        {quote ? (
          <span style={{ fontSize: 10, fontWeight: 600, fontFamily: 'Inter, sans-serif', color, flexShrink: 0 }}>
            {quote.change >= 0 ? '+' : ''}{quote.changePercent.toFixed(2)}%
          </span>
        ) : (
          <span style={{ fontSize: 10, color: 'var(--text-4)' }}>—</span>
        )}
      </div>
      {quote && (
        <span style={{ fontSize: compact ? 12 : 12.5, fontWeight: 700, fontFamily: 'Inter, sans-serif', color: 'var(--text-1)', flexShrink: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {fmtPrice(quote.price)}
        </span>
      )}
      <div style={{ flex: 1, minHeight: 0 }}>
        {quote && quote.sparkline.length > 1 && <Sparkline data={quote.sparkline} color={color} />}
      </div>
    </>
  )
}

/** Wide windows keep five charts over four. A stacked window sizes each
 *  tile from the column width so the name and price fit, and wraps to
 *  more rows instead of clipping them. */
function chartPlan(width: number): number[] {
  const stacked = typeof window !== 'undefined' && window.matchMedia('(max-width: 650px)').matches
  if (!stacked) return [5, 4]
  const gap = 6
  const minTile = 168
  const cols = Math.max(1, Math.min(4, Math.floor((width + gap) / (minTile + gap))))
  const plan: number[] = []
  let left = CHART_CARDS.length
  while (left > 0) {
    const n = Math.min(cols, left)
    plan.push(n)
    left -= n
  }
  return plan
}

function samePlan(a: number[], b: number[]) {
  return a.length === b.length && a.every((n, i) => n === b[i])
}

/** `row`: wide landscape cards flowing in 3 stacked rows, horizontal scroll.
 * `row-single`: two landscape rows under the map on a wide window. A stacked
 * window wraps further so each tile stays readable.
 * `column`: single vertical list of cards, for use as a narrow sidebar next to the map. */
export default function LiveChartsStrip({ quotes, layout = 'row' }: { quotes: Record<string, MarketQuote>; layout?: 'row' | 'row-single' | 'column' }) {
  const rowsRef = useRef<HTMLDivElement>(null)
  const [plan, setPlan] = useState<number[]>([5, 4])

  useLayoutEffect(() => {
    if (layout !== 'row-single') return
    const el = rowsRef.current
    if (!el) return
    const measure = () => {
      const next = chartPlan(el.getBoundingClientRect().width)
      setPlan(prev => (samePlan(prev, next) ? prev : next))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    const onChange = () => measure()
    const query = window.matchMedia('(max-width: 650px)')
    query.addEventListener('change', onChange)
    return () => {
      ro.disconnect()
      query.removeEventListener('change', onChange)
    }
  }, [layout])

  if (layout === 'row-single') {
    const rows: typeof CHART_CARDS[] = []
    let cursor = 0
    for (const count of plan) {
      rows.push(CHART_CARDS.slice(cursor, cursor + count))
      cursor += count
    }
    return (
      <div className="dash-panel">
        <div className="dash-charts-rows" ref={rowsRef} style={{ '--chart-cols': Math.max(...plan) } as React.CSSProperties}>
          {rows.map((row, i) => (
            <div className="dash-charts-row" key={i}>
              {row.map(ex => (
                <div className="dash-chart-slot" key={ex.symbol}>
                  <div className="dash-chart-tile" title={ex.name}>
                    <ChartFace ex={ex} quote={quotes[ex.symbol]} compact />
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    )
  }

  const gridStyle = layout === 'column'
    ? { flex: 1, minWidth: 0, minHeight: 0, display: 'flex' as const, flexDirection: 'column' as const, gap: 8, overflowY: 'auto' as const, padding: '2px 2px 6px' }
    : {
      flex: 1, minWidth: 0, minHeight: 0, display: 'grid' as const, gridTemplateRows: 'repeat(3, 1fr)', gridAutoFlow: 'column' as const,
      gridAutoColumns: '220px', gap: 10, overflowX: 'auto' as const, padding: '2px 2px 6px',
    }

  return (
    <div className="dash-panel">
      <div style={gridStyle}>
        {CHART_CARDS.map(ex => (
          <div key={ex.symbol} title={ex.name} style={{
            background: 'var(--bg-page)', border: '1px solid var(--border-light)',
            borderRadius: 6, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 4,
            minWidth: 0, minHeight: layout === 'column' ? 90 : 0,
            flexShrink: layout === 'column' ? 0 : undefined,
          }}>
            <ChartFace ex={ex} quote={quotes[ex.symbol]} />
          </div>
        ))}
      </div>
    </div>
  )
}
