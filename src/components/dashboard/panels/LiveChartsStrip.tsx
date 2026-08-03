/**
 * Scrollable strip of wide sparkline cards for major exchanges/indices —
 * sits below WorldMapPanel on the Dashboard overview.
 */
import { EXCHANGES } from '../../../data/exchanges'
import type { MarketQuote } from '../../../services/markets'

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

export default function LiveChartsStrip({ quotes }: { quotes: Record<string, MarketQuote> }) {
  return (
    <div className="dash-panel">
      <div className="dash-panel-header"><span>Live Charts</span></div>
      <div style={{
        flex: 1, display: 'grid', gridTemplateRows: 'repeat(3, 1fr)', gridAutoFlow: 'column',
        gridAutoColumns: '220px', gap: 10, overflowX: 'auto', padding: '2px 2px 6px',
      }}>
        {EXCHANGES.map(ex => {
          const q = quotes[ex.symbol]
          const color = !q ? 'var(--text-3)' : q.change >= 0 ? '#10b981' : '#f43f5e'
          return (
            <div key={ex.symbol} style={{
              background: 'var(--bg-page)', border: '1px solid var(--border-light)',
              borderRadius: 6, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 4,
              minWidth: 0, minHeight: 0,
            }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 6, flexShrink: 0 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {ex.name}
                </span>
                {q ? (
                  <span style={{ fontSize: 10.5, fontWeight: 600, fontFamily: 'Inter, sans-serif', color, flexShrink: 0 }}>
                    {q.change >= 0 ? '+' : ''}{q.changePercent.toFixed(2)}%
                  </span>
                ) : (
                  <span style={{ fontSize: 10, color: 'var(--text-4)' }}>—</span>
                )}
              </div>
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
