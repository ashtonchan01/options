/**
 * World-Monitor-style overview. Left side: World Map (expanded to be the
 * dominant element, World-Monitor-style) with a thin Live Charts strip
 * below it, filling the viewport with no scrolling. Right side: two
 * independently vertically-scrolling columns holding the rest of the
 * panels — Ticker Headlines is one of them now, not pinned under the map —
 * each with a drag handle on its bottom edge to resize its height
 * (remembered per panel — see ResizablePanel/useResizablePanel).
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
      </div>

      <div className="dash-right-cols">
        <div className="dash-right-col">
          <ResizablePanel id="headlines" defaultWidth={900} defaultHeight={420} axis="vertical">
            <TickerHeadlinesPanel />
          </ResizablePanel>
          <ResizablePanel id="livetv" defaultWidth={900} defaultHeight={340} axis="vertical">
            <LiveTVPanel />
          </ResizablePanel>
          <ResizablePanel id="pairs" defaultWidth={900} defaultHeight={340} axis="vertical">
            <PairTradingPanel state={state} topN={5} />
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
