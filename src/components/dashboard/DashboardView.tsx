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
import {
  ActionsSidebar,
  PortfolioSummaryCard,
  AllocationPieCard,
  CashFlowCard,
  IncomeChannelsCard,
  StocksCard,
  OptionsCard,
} from '../analytics/AnalyticsView'

const REFRESH_MS = 60_000
const CHART_ONLY_SYMBOLS = ['ES=F']

export default function DashboardView({ state, tradeLabels }: { state: AppState; tradeLabels?: TradeLabels }) {
  const [quotes, setQuotes] = useState<Record<string, MarketQuote>>({})
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    let cancelled = false
    const symbols = [...EXCHANGES.map(e => e.symbol), ...CHART_ONLY_SYMBOLS]
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
      <div className="dash-cell dash-cell-under-map dash-cell-h3">
        <WorldMapPanel quotes={quotes} now={now} />
      </div>
      <div className="dash-cell dash-cell-under-map">
        <LiveChartsStrip quotes={quotes} layout="row-single" />
      </div>
      <div className="dash-cell dash-cell-w2 dash-cell-h3">
        <LiveTVPanel />
      </div>
      <div className="dash-cell dash-cell-h3">
        <HeadlinesPanel />
      </div>
      <div className="dash-cell dash-cell-h3">
        <TickerHeadlinesPanel />
      </div>
      <div className="dash-cell dash-cell-h2">
        <PortfolioSummaryCard state={state} />
      </div>
      <div className="dash-cell dash-cell-w2 dash-cell-h3" style={{ display: 'flex', gap: 6 }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex' }}>
          <AllocationPieCard state={state} />
        </div>
        <div style={{ flex: 1, minWidth: 0, display: 'flex' }}>
          <CashFlowCard state={state} />
        </div>
      </div>
      <div className="dash-cell dash-cell-w2 dash-cell-h3">
        <IncomeChannelsCard state={state} labels={tradeLabels?.labels ?? {}} />
      </div>
      <div className="dash-cell dash-cell-w2 dash-cell-h6">
        <StocksCard state={state} />
      </div>
      <div className="dash-cell dash-cell-w2 dash-cell-h6">
        <OptionsCard state={state} />
      </div>
      <div className="dash-cell dash-cell-h12 dash-actions-cell">
        <ActionsSidebar state={state} />
      </div>
      <div className="dash-cell dash-cell-w2 dash-cell-h6">
        <CalendarPanel state={state} />
      </div>
    </div>
  )
}
