/**
 * World-Monitor-style overview — a flat, responsive wrapping grid of
 * fixed-size cells (see .dash-wrap in index.css). Cells flow to the next
 * row as the screen narrows; wide/tall cells span 2 tracks where space
 * allows. Left side is just World Map + Live Charts stacked (covering the
 * left half of the screen); Live TV sits at the top of the right side,
 * above Ticker Headlines + Pair Trading.
 */
import { useEffect, useState } from 'react'
import type { AppState } from '../../types'
import { EXCHANGES } from '../../data/exchanges'
import { fetchMarketQuotes, type MarketQuote } from '../../services/markets'
import WorldMapPanel from './panels/WorldMapPanel'
import LiveChartsStrip from './panels/LiveChartsStrip'
import LiveTVPanel from './panels/LiveTVPanel'
import TickerHeadlinesPanel from './panels/TickerHeadlinesPanel'
import PairTradingPanel from './panels/PairTradingPanel'

const REFRESH_MS = 60_000
const CHART_ONLY_SYMBOLS = ['ES=F']

export default function DashboardView({ state }: { state: AppState }) {
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
      <div className="dash-cell dash-cell-under-map dash-cell-h3 dash-area-map">
        <WorldMapPanel quotes={quotes} now={now} />
      </div>
      <div className="dash-cell dash-cell-under-map dash-cell-h3 dash-area-charts">
        <LiveChartsStrip quotes={quotes} layout="row" />
      </div>
      {/* Calendar moved to the Portfolio tab. Live TV now sits at the top of
          this column, above Headlines + Pairs, instead of at the bottom of
          the map/charts column — leaving that left column just World Map +
          Live Charts stacked to fill the left half of the screen. */}
      <div className="dash-cell dash-cell-w2 dash-cell-h6 dash-cell-calendar dash-area-rightside">
        <div className="dash-cell dash-rightside-livetv">
          <LiveTVPanel />
        </div>
        <div className="dash-rightside-bottom">
          <div className="dash-cell dash-cell-h3 dash-area-headlines">
            <TickerHeadlinesPanel />
          </div>
          <div className="dash-cell dash-cell-h3 dash-area-pairs">
            <PairTradingPanel state={state} />
          </div>
        </div>
      </div>
    </div>
  )
}
