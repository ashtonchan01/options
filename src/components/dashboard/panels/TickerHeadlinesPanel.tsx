import { useEffect, useState } from 'react'
import { fetchTickerHeadlines, type TickerHeadline } from '../../../services/tickerNews'
import { getFollowedTickers } from '../../../utils/followedTickers'

const REFRESH_MS = 3 * 60 * 1000

function relativeTime(ms: number): string {
  const diff = Date.now() - ms
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  return `${Math.floor(diff / 3_600_000)}h ago`
}

export default function TickerHeadlinesPanel() {
  const [headlines, setHeadlines] = useState<TickerHeadline[]>([])

  useEffect(() => {
    let cancelled = false
    async function load() {
      const tickers = getFollowedTickers()
      if (tickers.length === 0) return
      const data = await fetchTickerHeadlines(tickers)
      if (!cancelled && data.length > 0) setHeadlines(data)
    }
    load()
    const id = setInterval(load, REFRESH_MS)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  return (
    <div className="dash-panel" style={{ flex: 1 }}>
      <div className="dash-panel-header"><span>Ticker Headlines</span></div>
      <div style={{ flex: 1, overflowY: 'auto', columnCount: 2, columnGap: 16 }}>
        {headlines.length === 0 && (
          <div style={{ padding: '12px 4px', fontSize: 12, color: 'var(--text-4)' }}>
            Loading headlines for your followed tickers…
          </div>
        )}
        {headlines.map((h, i) => (
          <a key={h.link + i} href={h.link} target="_blank" rel="noreferrer" style={{
            display: 'block', padding: '8px 4px', textDecoration: 'none',
            borderTop: '1px solid var(--border-light)',
            breakInside: 'avoid',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
              <span style={{
                fontSize: 9.5, fontWeight: 700, color: 'var(--accent)', background: 'var(--accent-dim)',
                border: '1px solid var(--accent-border)', padding: '1px 5px', flexShrink: 0,
              }}>
                {h.ticker}
              </span>
              <span style={{ fontSize: 10, color: 'var(--text-4)' }}>{h.source} · {relativeTime(h.time)}</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-1)', lineHeight: 1.4 }}>{h.title}</div>
          </a>
        ))}
      </div>
    </div>
  )
}
