/**
 * Crypto + stock Fear & Greed gauges, World-Monitor-style. Crypto is
 * alternative.me's public Fear & Greed Index; stocks is CNN's own Fear &
 * Greed Index data (same source cnn.com/markets/fear-and-greed reads).
 */
import { useEffect, useState } from 'react'
import { Gauge } from 'lucide-react'
import { fetchFearGreed, type FearGreedData, type FearGreedReading } from '../../../services/fearGreed'

const REFRESH_MS = 15 * 60_000

/** Red (extreme fear) → amber (neutral) → green (extreme greed), same
 * three-stop scale CNN's own gauge uses. */
function gaugeColor(value: number): string {
  if (value <= 25) return '#ef4444'
  if (value <= 45) return '#f59e0b'
  if (value <= 55) return '#eab308'
  if (value <= 75) return '#84cc16'
  return '#10b981'
}

function GaugeRow({ label, reading }: { label: string; reading: FearGreedReading | null }) {
  const text = reading?.classification ?? reading?.rating
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
        <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{label}</span>
        {reading ? (
          <span style={{ fontSize: 13, fontWeight: 800, fontFamily: 'Inter, sans-serif', color: gaugeColor(reading.value) }}>
            {reading.value} {text && <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'capitalize' }}>· {text}</span>}
          </span>
        ) : (
          <span style={{ fontSize: 11, color: 'var(--text-4)' }}>—</span>
        )}
      </div>
      <div style={{
        position: 'relative', height: 8, borderRadius: 4, overflow: 'hidden',
        background: 'linear-gradient(90deg, #ef4444, #f59e0b, #eab308, #84cc16, #10b981)',
        opacity: reading ? 1 : 0.25,
      }}>
        {reading && (
          <div style={{
            position: 'absolute', left: `calc(${Math.min(Math.max(reading.value, 0), 100)}% - 1.5px)`,
            top: -2, bottom: -2, width: 3, borderRadius: 2, background: 'var(--text-1)',
            boxShadow: '0 0 0 1px rgba(0,0,0,0.4)',
          }} />
        )}
      </div>
    </div>
  )
}

export default function FearGreedPanel() {
  const [data, setData] = useState<FearGreedData>({ crypto: null, stocks: null })
  const [loading, setLoading] = useState(false)

  async function load() {
    setLoading(true)
    const d = await fetchFearGreed()
    setData(d)
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
        <Gauge size={13} style={{ color: 'var(--accent)' }} />
        <span>Fear &amp; Greed</span>
        {loading && <span className="dash-panel-sub" style={{ marginLeft: 'auto' }}>Refreshing…</span>}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 16, padding: '6px 2px' }}>
        <GaugeRow label="STOCKS" reading={data.stocks} />
        <GaugeRow label="CRYPTO" reading={data.crypto} />
      </div>
    </div>
  )
}
