/**
 * World-Monitor-style overview. Left side: World Map (expanded to be the
 * dominant element, World-Monitor-style) with a thin Live Charts strip
 * below it, filling the viewport with no scrolling. Right side: two
 * independently vertically-scrolling columns holding the rest of the
 * panels; each has a drag handle on its bottom edge to resize its height
 * (remembered per panel — see ResizablePanel/useResizablePanel) and a
 * corner button to expand across both columns instead of just its own
 * (see useWideMap) — wide panels render in their own full-width row above
 * the two columns.
 */
import { useEffect, useState } from 'react'
import type { AppState } from '../../types'
import { EXCHANGES } from '../../data/exchanges'
import { fetchMarketQuotes, type MarketQuote } from '../../services/markets'
import WorldMapPanel from './panels/WorldMapPanel'
import LiveChartsStrip, { MARKET_BAR_SYMBOLS } from './panels/LiveChartsStrip'
import LiveTVPanel from './panels/LiveTVPanel'
import TickerHeadlinesPanel from './panels/TickerHeadlinesPanel'
import PairTradingPanel from './panels/PairTradingPanel'
import SectorHeatmapPanel from './panels/SectorHeatmapPanel'
import MarketBreadthPanel from './panels/MarketBreadthPanel'
import MarketMoversPanel from './panels/MarketMoversPanel'
import EarningsCalendarPanel from './panels/EarningsCalendarPanel'
import FearGreedPanel from './panels/FearGreedPanel'
import ResizablePanel from './ResizablePanel'
import { useWideMap } from '../../hooks/useResizablePanel'

const REFRESH_MS = 60_000
const CHART_ONLY_SYMBOLS = ['ES=F']

export default function DashboardView({ state }: { state: AppState }) {
  const [quotes, setQuotes] = useState<Record<string, MarketQuote>>({})
  const [now, setNow] = useState(() => new Date())
  const { wideIds, setWide } = useWideMap()

  useEffect(() => {
    let cancelled = false
    const symbols = [...EXCHANGES.map(e => e.symbol), ...CHART_ONLY_SYMBOLS, ...MARKET_BAR_SYMBOLS.map(s => s.symbol)]
    async function load() {
      const data = await fetchMarketQuotes(symbols)
      if (!cancelled && Object.keys(data).length > 0) setQuotes(data)
    }
    load()
    const priceTimer = setInterval(load, REFRESH_MS)
    const clockTimer = setInterval(() => setNow(new Date()), 30_000)
    return () => { cancelled = true; clearInterval(priceTimer); clearInterval(clockTimer) }
  }, [])

  const colA = [
    { id: 'headlines', h: 420, node: <TickerHeadlinesPanel /> },
    { id: 'livetv', h: 340, node: <LiveTVPanel /> },
    { id: 'pairs', h: 340, node: <PairTradingPanel state={state} topN={5} /> },
  ]
  const colB = [
    { id: 'sector-heatmap', h: 260, node: <SectorHeatmapPanel /> },
    { id: 'market-breadth', h: 220, node: <MarketBreadthPanel /> },
    { id: 'earnings-calendar', h: 260, node: <EarningsCalendarPanel /> },
    { id: 'fear-greed', h: 180, node: <FearGreedPanel /> },
  ]
  const wideOnes = [...colA, ...colB].filter(p => wideIds.has(p.id))

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

      <div className="dash-right-cols-wrap">
        <div className="dash-cell" style={{ height: 300, flexShrink: 0 }}>
          <MarketMoversPanel />
        </div>
        {wideOnes.map(p => (
          <ResizablePanel key={p.id} id={p.id} defaultWidth={900} defaultHeight={p.h} axis="vertical"
            wide onSetWide={(w) => setWide(p.id, w)}>
            {p.node}
          </ResizablePanel>
        ))}
        <div className="dash-right-cols">
          <div className="dash-right-col">
            {colA.filter(p => !wideIds.has(p.id)).map(p => (
              <ResizablePanel key={p.id} id={p.id} defaultWidth={900} defaultHeight={p.h} axis="vertical"
                onSetWide={(w) => setWide(p.id, w)}>
                {p.node}
              </ResizablePanel>
            ))}
          </div>
          <div className="dash-right-col">
            {colB.filter(p => !wideIds.has(p.id)).map(p => (
              <ResizablePanel key={p.id} id={p.id} defaultWidth={460} defaultHeight={p.h} axis="vertical"
                onSetWide={(w) => setWide(p.id, w)}>
                {p.node}
              </ResizablePanel>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
