/**
 * World-Monitor-style overview, 3 columns:
 *  1. World markets map + live-charts sidebar on top; Live TV, then
 *     headlines + ticker-headlines side by side, underneath
 *  2. Portfolio Analytics
 *  3. Calendar (month grid + activity list directly below it)
 */
import { useEffect, useState } from 'react'
import type { AppState } from '../../types'
import type { TradeLabels } from '../../App'
import { EXCHANGES } from '../../data/exchanges'
import { fetchMarketQuotes, type MarketQuote } from '../../services/markets'
import WorldMapPanel from './panels/WorldMapPanel'
import LiveChartsStrip from './panels/LiveChartsStrip'
import LiveTVPanel from './panels/LiveTVPanel'
import HeadlinesPanel from './panels/HeadlinesPanel'
import TickerHeadlinesPanel from './panels/TickerHeadlinesPanel'
import CalendarPanel from './panels/CalendarPanel'
import AnalyticsView from '../analytics/AnalyticsView'

const REFRESH_MS = 60_000

export default function DashboardView({ state, tradeLabels }: { state: AppState; tradeLabels?: TradeLabels }) {
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
        {/* Not `.dash-row` on purpose: this split must stay side-by-side even at
           narrow widths, since its flex ratio is an 80/20 width split, not a
           direction the "stack below 700px" rule should ever flip to a height split. */}
        <div className="dashcol-maprow" style={{ flex: 1.3, minHeight: 0, minWidth: 0, display: 'flex', gap: 6 }}>
          <div style={{ flex: '8 1 0%', display: 'flex', minHeight: 0, minWidth: 0 }}>
            <WorldMapPanel quotes={quotes} now={now} />
          </div>
          <div style={{ flex: '2 1 0%', display: 'flex', minHeight: 0, minWidth: 0 }}>
            <LiveChartsStrip quotes={quotes} layout="column" />
          </div>
        </div>
        <div className="dashcol-fillrow" style={{ flex: 1.4, minHeight: 0, display: 'flex' }}>
          <LiveTVPanel />
        </div>
        <div className="dash-row" style={{ flex: 1, minHeight: 0 }}>
          <HeadlinesPanel />
          <TickerHeadlinesPanel />
        </div>
      </div>

      <div className="dash-col">
        <div className="dashcol-fillrow" style={{ flex: 1, minHeight: 0, display: 'flex' }}>
          <AnalyticsView state={state} tradeLabels={tradeLabels} />
        </div>
      </div>

      <div className="dash-col">
        <CalendarPanel state={state} />
      </div>
    </div>
  )
}
