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

const HEADLINES_PER_TICKER = 3

/** Groups headlines by ticker (each capped to its 3 most recent) instead of one
 * flat interleaved feed — a mixed list made it hard to tell which headline
 * belonged to which ticker at a glance, especially split across 2 columns. */
function groupByTicker(headlines: TickerHeadline[]): { ticker: string; items: TickerHeadline[] }[] {
  const map = new Map<string, TickerHeadline[]>()
  for (const h of headlines) {
    if (!map.has(h.ticker)) map.set(h.ticker, [])
    const list = map.get(h.ticker)!
    if (list.length < HEADLINES_PER_TICKER) list.push(h)
  }
  return [...map.entries()].map(([ticker, items]) => ({ ticker, items }))
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

  const groups = groupByTicker(headlines)

  return (
    <div className="dash-panel" style={{ flex: 1 }}>
      <div className="dash-panel-header"><span>Ticker Headlines</span></div>
      <div className="dash-headlines-cols" style={{ flex: 1, overflowY: 'auto', columnGap: 10 }}>
        {groups.length === 0 && (
          <div style={{ padding: '12px 4px', fontSize: 12, color: 'var(--text-4)' }}>
            Loading headlines for your followed tickers…
          </div>
        )}
        {groups.map(g => (
          <div key={g.ticker} style={{
            background: 'var(--bg-elevated)', border: '1px solid var(--border-light)', borderRadius: 8,
            marginBottom: 8, breakInside: 'avoid', overflow: 'hidden',
          }}>
            <div style={{
              fontSize: 10, fontWeight: 700, color: 'var(--accent)', background: 'var(--accent-dim)',
              borderBottom: '1px solid var(--accent-border)', padding: '4px 9px',
            }}>
              {g.ticker}
            </div>
            {g.items.map((h, i) => (
              <a key={h.link + i} href={h.link} target="_blank" rel="noreferrer" style={{
                display: 'block', padding: '7px 9px', textDecoration: 'none',
                borderTop: i === 0 ? 'none' : '1px solid var(--border-light)',
              }}>
                <div style={{ fontSize: 10, color: 'var(--text-4)', marginBottom: 2 }}>
                  {h.source} · {relativeTime(h.time)}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-1)', lineHeight: 1.4 }}>{h.title}</div>
              </a>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
