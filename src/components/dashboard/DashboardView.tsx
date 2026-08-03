/**
 * World-Monitor-style overview, 3 columns:
 *  1. World markets map + live-charts sidebar on top; Live TV, then
 *     headlines + X side by side, underneath
 *  2. (empty for now)
 *  3. Calendar (month grid + activity list directly below it)
 */
import { useEffect, useState } from 'react'
import type { AppState } from '../../types'
import { EXCHANGES } from '../../data/exchanges'
import { fetchMarketQuotes, type MarketQuote } from '../../services/markets'
import WorldMapPanel from './panels/WorldMapPanel'
import LiveChartsStrip from './panels/LiveChartsStrip'
import LiveTVPanel from './panels/LiveTVPanel'
import HeadlinesPanel from './panels/HeadlinesPanel'
import XFeedPanel from './panels/XFeedPanel'
import CalendarPanel from './panels/CalendarPanel'

const REFRESH_MS = 60_000

export default function DashboardView({ state }: { state: AppState }) {
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
    <div className="dash-grid dash-grid-3col">
      <div className="dash-col">
        <div className="dash-row" style={{ flex: 1.3, minHeight: 0 }}>
          <WorldMapPanel quotes={quotes} now={now} />
          <div style={{ flex: '0 0 220px', display: 'flex', minHeight: 0 }}>
            <LiveChartsStrip quotes={quotes} layout="column" />
          </div>
        </div>
        <div style={{ flex: 1.4, minHeight: 0, display: 'flex' }}>
          <LiveTVPanel />
        </div>
        <div className="dash-row" style={{ flex: 1, minHeight: 0 }}>
          <HeadlinesPanel />
          <XFeedPanel />
        </div>
      </div>

      <div className="dash-col" />

      <div className="dash-col">
        <CalendarPanel state={state} />
      </div>
    </div>
  )
}
