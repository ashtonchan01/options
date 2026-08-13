/**
 * World-Monitor-style overview — a column-wrapping masonry of panels (see
 * .dash-wrap in index.css): each panel stacks top-to-bottom in a column
 * until the column is full, then the next panel starts a new column to the
 * right, same visual language as World Monitor's card grid. Every panel is
 * independently resizable (drag its bottom-right corner) and remembers its
 * size across reloads (see ResizablePanel / useResizablePanel).
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
      <ResizablePanel id="map" defaultWidth={1100} defaultHeight={480}>
        <WorldMapPanel quotes={quotes} now={now} />
      </ResizablePanel>

      <ResizablePanel id="charts" defaultWidth={1100} defaultHeight={128}>
        <LiveChartsStrip quotes={quotes} layout="row-single" />
      </ResizablePanel>

      <ResizablePanel id="headlines" defaultWidth={1100} defaultHeight={320}>
        <TickerHeadlinesPanel onSelect={setSelectedHeadline} selectedUrl={selectedHeadline?.url} />
      </ResizablePanel>

      <div className="dash-rightside-top-row">
        <ResizablePanel id="livetv" defaultWidth={560} defaultHeight={420}>
          <LiveTVPanel />
        </ResizablePanel>
        <ResizablePanel id="pairs" defaultWidth={340} defaultHeight={420}>
          <PairTradingPanel state={state} topN={5} />
        </ResizablePanel>
      </div>

      <ResizablePanel id="article" defaultWidth={900} defaultHeight={300}>
        <ArticleReaderPanel selected={selectedHeadline} />
      </ResizablePanel>

      <ResizablePanel id="sector-heatmap" defaultWidth={460} defaultHeight={260}>
        <SectorHeatmapPanel />
      </ResizablePanel>

      <ResizablePanel id="market-breadth" defaultWidth={340} defaultHeight={260}>
        <MarketBreadthPanel />
      </ResizablePanel>

      <ResizablePanel id="earnings-calendar" defaultWidth={460} defaultHeight={260}>
        <EarningsCalendarPanel />
      </ResizablePanel>

      <ResizablePanel id="fear-greed" defaultWidth={340} defaultHeight={200}>
        <FearGreedPanel />
      </ResizablePanel>
    </div>
  )
}
