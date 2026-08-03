/**
 * World-Monitor-style overview — a flat, responsive wrapping grid of
 * fixed-size cells (see .dash-wrap in index.css). Cells flow to the next
 * row as the screen narrows; wide/tall cells span 2 tracks where space
 * allows. Order: map, live charts, TV, world headlines, ticker headlines,
 * portfolio analytics, calendar.
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
import { ActualPortfolio, ActionsSidebar } from '../analytics/AnalyticsView'

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
    <div className="dash-wrap">
      <div className="dash-cell dash-cell-w2">
        <WorldMapPanel quotes={quotes} now={now} />
      </div>
      <div className="dash-cell">
        <LiveChartsStrip quotes={quotes} layout="column" />
      </div>
      <div className="dash-cell dash-cell-w2">
        <LiveTVPanel />
      </div>
      <div className="dash-cell">
        <HeadlinesPanel />
      </div>
      <div className="dash-cell">
        <TickerHeadlinesPanel />
      </div>
      <div className="dash-cell dash-cell-w2 dash-cell-h2">
        <div className="dash-panel" style={{ padding: 0, overflow: 'hidden' }}>
          <ActualPortfolio state={state} labels={tradeLabels?.labels ?? {}} />
        </div>
      </div>
      <div className="dash-cell dash-cell-h2 dash-actions-cell">
        <ActionsSidebar state={state} />
      </div>
      <div className="dash-cell dash-cell-w2 dash-cell-h2">
        <CalendarPanel state={state} />
      </div>
    </div>
  )
}
