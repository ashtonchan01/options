/**
 * World-Monitor-style overview — a flat, responsive wrapping grid of
 * fixed-size cells (see .dash-wrap in index.css). Cells flow to the next
 * row as the screen narrows; wide/tall cells span 2 tracks where space
 * allows. Left side: World Map, a single-row Live Charts strip, then Ticker
 * Headlines (multi-column) filling the rest. Right side: Live TV next to a
 * compact Pair Trading strip (top 5), then an in-dashboard Article reader
 * (filled by clicking a headline, instead of opening a new tab) filling
 * whatever's left below them.
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
import ArticleReaderPanel, { type SelectedHeadline } from './panels/ArticleReaderPanel'

const REFRESH_MS = 60_000
const CHART_ONLY_SYMBOLS = ['ES=F']

export default function DashboardView({ state }: { state: AppState }) {
  const [quotes, setQuotes] = useState<Record<string, MarketQuote>>({})
  const [now, setNow] = useState(() => new Date())
  const [selectedHeadline, setSelectedHeadline] = useState<SelectedHeadline | null>(null)

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
      <div className="dash-cell dash-cell-under-map dash-area-charts">
        <LiveChartsStrip quotes={quotes} layout="row-single" />
      </div>
      <div className="dash-cell dash-cell-under-map dash-cell-h3 dash-area-headlines-left">
        <TickerHeadlinesPanel onSelect={setSelectedHeadline} selectedUrl={selectedHeadline?.url} />
      </div>
      <div className="dash-cell dash-cell-w2 dash-cell-h6 dash-cell-calendar dash-area-rightside">
        <div className="dash-rightside-top-row">
          <div className="dash-cell dash-rightside-livetv">
            <LiveTVPanel />
          </div>
          <div className="dash-cell dash-area-pairs-top">
            <PairTradingPanel state={state} topN={5} />
          </div>
        </div>
        <div className="dash-cell dash-area-article">
          <ArticleReaderPanel selected={selectedHeadline} />
        </div>
      </div>
    </div>
  )
}
