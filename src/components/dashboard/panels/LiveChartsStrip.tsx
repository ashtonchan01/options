/**
 * Scrollable strip of wide sparkline cards for major indices/commodities —
 * sits below WorldMapPanel on the Dashboard overview. Mirrors the top
 * ticker bar on Yahoo Finance's markets pages (major US indices, crude,
 * gold, bitcoin, the 10-yr yield, VIX) rather than the full global exchange
 * list EXCHANGES holds for the world map — a separate, dedicated list here
 * so changing one doesn't affect the other.
 */
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

/** `row`: wide landscape cards flowing in 3 stacked rows, horizontal scroll.
 * `row-single`: one single row of cards, horizontal scroll — for a strip under the map.
 * `column`: single vertical list of cards, for use as a narrow sidebar next to the map. */
export default function LiveChartsStrip({ quotes, layout = 'row' }: { quotes: Record<string, MarketQuote>; layout?: 'row' | 'row-single' | 'column' }) {
  const gridStyle = layout === 'column'
    ? { flex: 1, minWidth: 0, minHeight: 0, display: 'flex' as const, flexDirection: 'column' as const, gap: 8, overflowY: 'auto' as const, padding: '2px 2px 6px' }
    : layout === 'row-single'
    ? {
      // One row under the map, only as wide as that column. The row grows
      // to the same height as the heatmap card beside it in the column.
      flex: '1 1 auto', minWidth: 0, minHeight: 108, display: 'flex' as const, flexDirection: 'row' as const,
      gap: 6, padding: '2px 0 4px',
    }
    : {
      flex: 1, minWidth: 0, minHeight: 0, display: 'grid' as const, gridTemplateRows: 'repeat(3, 1fr)', gridAutoFlow: 'column' as const,
      gridAutoColumns: '220px', gap: 10, overflowX: 'auto' as const, padding: '2px 2px 6px',
    }

  return (
    <div className="dash-panel">
      <div style={gridStyle}>
        {CHART_CARDS.map(ex => {
          const q = quotes[ex.symbol]
          const color = !q ? 'var(--text-3)' : q.change >= 0 ? '#10b981' : '#f43f5e'
          return (
            <div key={ex.symbol} title={ex.name} style={{
              background: 'var(--bg-page)', border: '1px solid var(--border-light)',
              borderRadius: 6, padding: layout === 'row-single' ? '6px 5px' : '8px 10px', display: 'flex', flexDirection: 'column', gap: layout === 'row-single' ? 2 : 4,
              minWidth: 0, minHeight: layout === 'column' ? 90 : 0,
              flexShrink: layout === 'column' ? 0 : undefined,
              flex: layout === 'row-single' ? '1 1 0' : undefined,
            }}>
              <div style={{ display: 'flex', flexDirection: layout === 'row-single' ? 'column' : 'row', alignItems: layout === 'row-single' ? 'stretch' : 'baseline', justifyContent: 'space-between', gap: layout === 'row-single' ? 1 : 6, flexShrink: 0, minWidth: 0 }}>
                <span style={{ fontSize: layout === 'row-single' ? 10 : 11, fontWeight: 700, color: 'var(--text-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {layout === 'row-single' ? ex.short : ex.name}
                </span>
                {q ? (
                  <span style={{ fontSize: 10, fontWeight: 600, fontFamily: 'Inter, sans-serif', color, flexShrink: 0 }}>
                    {q.change >= 0 ? '+' : ''}{q.changePercent.toFixed(2)}%
                  </span>
                ) : (
                  <span style={{ fontSize: 10, color: 'var(--text-4)' }}>—</span>
                )}
              </div>
              {q && (
                <span style={{ fontSize: layout === 'row-single' ? 11 : 12.5, fontWeight: 700, fontFamily: 'Inter, sans-serif', color: 'var(--text-1)', flexShrink: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {fmtPrice(q.price)}
                </span>
              )}
              <div style={{ flex: 1, minHeight: 0 }}>
                {q && q.sparkline.length > 1 && <Sparkline data={q.sparkline} color={color} />}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
