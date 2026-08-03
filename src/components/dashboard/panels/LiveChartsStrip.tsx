/**
 * Scrollable strip of mini sparkline cards for major exchanges/indices —
 * sits below WorldMapPanel on the Dashboard overview.
 */
import { EXCHANGES } from '../../../data/exchanges'
import type { MarketQuote } from '../../../services/markets'

function Sparkline({ data, color, width = 64, height = 24 }: { data: number[]; color: string; width?: number; height?: number }) {
  if (data.length < 2) return <svg width={width} height={height} />
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width
    const y = height - ((v - min) / range) * height
    return [x, y] as const
  })
  const linePath = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const areaPath = `${linePath} L${width},${height} L0,${height} Z`
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <path d={areaPath} fill={color} opacity={0.12} />
      <path d={linePath} fill="none" stroke={color} strokeWidth={1.3} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

export default function LiveChartsStrip({ quotes }: { quotes: Record<string, MarketQuote> }) {
  return (
    <div className="dash-panel">
      <div className="dash-panel-header"><span>Live Charts</span></div>
      <div style={{
        flex: 1, display: 'grid', gridTemplateRows: 'repeat(2, 1fr)', gridAutoFlow: 'column',
        gridAutoColumns: '108px', gap: 10, overflowX: 'auto', padding: '2px 2px 6px',
      }}>
        {EXCHANGES.map(ex => {
          const q = quotes[ex.symbol]
          const color = !q ? 'var(--text-3)' : q.change >= 0 ? '#10b981' : '#f43f5e'
          return (
            <div key={ex.symbol} style={{
              background: 'var(--bg-page)', border: '1px solid var(--border-light)',
              borderRadius: 6, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 4,
            }}>
              <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {ex.name}
              </span>
              {q ? (
                <>
                  <span style={{ fontSize: 10, fontWeight: 600, fontFamily: 'Inter, sans-serif', color }}>
                    {q.change >= 0 ? '+' : ''}{q.changePercent.toFixed(2)}%
                  </span>
                  {q.sparkline.length > 1 && <Sparkline data={q.sparkline} color={color} />}
                </>
              ) : (
                <span style={{ fontSize: 10, color: 'var(--text-4)' }}>—</span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
