/**
 * World-Monitor-style overview: world markets map + live charts on the
 * left, live TV top-right, headlines + X feed bottom-right.
 */
import { useEffect, useState } from 'react'
import { EXCHANGES } from '../../data/exchanges'
import { fetchMarketQuotes, type MarketQuote } from '../../services/markets'
import WorldMapPanel from './panels/WorldMapPanel'
import LiveChartsStrip from './panels/LiveChartsStrip'
import LiveTVPanel from './panels/LiveTVPanel'
import HeadlinesPanel from './panels/HeadlinesPanel'
import XFeedPanel from './panels/XFeedPanel'

const REFRESH_MS = 60_000

export default function DashboardView() {
  const [quotes, setQuotes] = useState<Record<string, MarketQuote>>({})
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    let cancelled = false
    const symbols = EXCHANGES.map(e => e.symbol)
    async function load() {
      const data = await fetchMarketQuotes(symbols)
      if (!cancelled && Object.keys(data).length > 0) setQuotes(data)
    }
    load()
    const priceTimer = setInterval(load, REFRESH_MS)
    const clockTimer = setInterval(() => setNow(new Date()), 30_000)
    return () => { cancelled = true; clearInterval(priceTimer); clearInterval(clockTimer) }
  }, [])

  return (
    <div className="dash-grid">
      <div className="dash-col">
        <WorldMapPanel now={now} />
        <LiveChartsStrip quotes={quotes} />
      </div>
      <div className="dash-col">
        <LiveTVPanel />
        <div className="dash-row" style={{ flex: 1, minHeight: 0 }}>
          <HeadlinesPanel />
          <XFeedPanel />
        </div>
      </div>
    </div>
  )
}
