/**
 * World-Monitor-style overview. Left side: World Map / Live Charts /
 * Ticker Headlines stacked to exactly fill the viewport, no scrolling —
 * same as the dashboard's original layout. Right side: two independently
 * vertically-scrolling columns holding the rest of the panels; each panel
 * has a drag handle on its bottom edge to resize its height (remembered
 * per panel — see ResizablePanel/useResizablePanel), so you can shrink
 * panels to fit more on screen at once or leave them tall and scroll.
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
import SectorHeatmapPanel from './panels/SectorHeatmapPanel'
import MarketBreadthPanel from './panels/MarketBreadthPanel'
import EarningsCalendarPanel from './panels/EarningsCalendarPanel'
import FearGreedPanel from './panels/FearGreedPanel'
import ResizablePanel from './ResizablePanel'

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
      <div className="dash-left-col">
        <div className="dash-cell dash-left-map">
          <WorldMapPanel quotes={quotes} now={now} />
        </div>
        <div className="dash-cell dash-left-charts">
          <LiveChartsStrip quotes={quotes} layout="row-single" />
        </div>
        <div className="dash-cell dash-left-headlines">
          <TickerHeadlinesPanel onSelect={setSelectedHeadline} selectedUrl={selectedHeadline?.url} />
        </div>
      </div>

      <div className="dash-right-cols">
        <div className="dash-right-col">
          <div className="dash-rightside-top-row">
            <div className="dash-cell dash-rightside-livetv">
              <LiveTVPanel />
            </div>
            <div className="dash-cell dash-area-pairs-top">
              <PairTradingPanel state={state} topN={5} />
            </div>
          </div>
          <ResizablePanel id="article" defaultWidth={900} defaultHeight={340} axis="vertical">
            <ArticleReaderPanel selected={selectedHeadline} />
          </ResizablePanel>
        </div>

        <div className="dash-right-col">
          <ResizablePanel id="sector-heatmap" defaultWidth={460} defaultHeight={260} axis="vertical">
            <SectorHeatmapPanel />
          </ResizablePanel>
          <ResizablePanel id="market-breadth" defaultWidth={340} defaultHeight={220} axis="vertical">
            <MarketBreadthPanel />
          </ResizablePanel>
          <ResizablePanel id="earnings-calendar" defaultWidth={460} defaultHeight={260} axis="vertical">
            <EarningsCalendarPanel />
          </ResizablePanel>
          <ResizablePanel id="fear-greed" defaultWidth={340} defaultHeight={180} axis="vertical">
            <FearGreedPanel />
          </ResizablePanel>
        </div>
      </div>
    </div>
  )
}
