/**
 * Top 10 latest headlines (across all followed tickers) as a scrolling
 * ticker-tape strip running the full width of the dashboard — replaces the
 * old boxed "Ticker Headlines" grid panel, which took up a whole column
 * slot just to show a handful of recent stories.
 */
import { useEffect, useState } from 'react'
import { fetchTickerHeadlines, type TickerHeadline } from '../../../services/tickerNews'
import { getFollowedTickers } from '../../../utils/followedTickers'

const REFRESH_MS = 3 * 60 * 1000
const TOP_N = 10

export default function HeadlinesTicker() {
  const [headlines, setHeadlines] = useState<TickerHeadline[]>([])

  useEffect(() => {
    let cancelled = false
    async function load() {
      const tickers = getFollowedTickers()
      if (tickers.length === 0) return
      const data = await fetchTickerHeadlines(tickers)
      if (!cancelled && data.length > 0) {
        setHeadlines(data.slice().sort((a, b) => b.time - a.time).slice(0, TOP_N))
      }
    }
    load()
    const id = setInterval(load, REFRESH_MS)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  if (headlines.length === 0) return null

  // Duplicated once so the CSS animation (translateX(-50%)) loops
  // seamlessly — scrolling exactly one copy's width leaves the second copy
  // already in place to continue from, instead of a visible jump/reset.
  const items = [...headlines, ...headlines]

  return (
    <div className="dash-ticker">
      <span className="dash-ticker-label">HEADLINES</span>
      <div className="dash-ticker-track">
        {items.map((h, i) => (
          <a key={i} href={h.link} target="_blank" rel="noreferrer" className="dash-ticker-item">
            <span className="dash-ticker-sym">{h.ticker}</span>
            <span>{h.title}</span>
            <span className="dash-ticker-sep">&middot;</span>
          </a>
        ))}
      </div>
    </div>
  )
}
