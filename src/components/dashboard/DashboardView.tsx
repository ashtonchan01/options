/**
 * World-Monitor-style overview. Left side: World Map (expanded to be the
 * dominant element, World-Monitor-style) with a thin Live Charts strip
 * below it, filling the viewport with no scrolling. Right side: two
 * independently vertically-scrolling columns holding the rest of the
 * panels; each has a drag handle on its bottom edge to resize its height
 * (remembered per panel — see ResizablePanel/useResizablePanel) and a
 * corner button to expand across both columns instead of just its own
 * (see useWideMap) — wide panels render in their own full-width row above
 * the two columns. A thin scrolling headlines ticker (top 10 latest across
 * followed tickers) runs above everything else, full width — replacing the
 * old boxed "Ticker Headlines" panel and the Market Movers panels (Trending
 * Tickers/Top Gainers/Top Losers/Most Active), both removed. Sector Heatmap
 * sits in the left column, below the Live Charts strip, rather than in the
 * right-side columns. Watchlist Breadth and Earnings Calendar are removed;
 * the second right-side column now holds Watchlist and a Bloomberg
 * headlines widget (Bloomberg's own public RSS feeds — bloomberg.com itself
 * can't be embedded, it refuses framing like virtually every major news
 * site), with Fear & Greed and Pair Trading stacked under Live TV in the
 * first.
 */
import { useEffect, useState } from 'react'
import type { AppState } from '../../types'
import { EXCHANGES } from '../../data/exchanges'
import { fetchMarketQuotes, type MarketQuote } from '../../services/markets'
import WorldMapPanel from './panels/WorldMapPanel'
import LiveChartsStrip, { MARKET_BAR_SYMBOLS } from './panels/LiveChartsStrip'
import LiveTVPanel from './panels/LiveTVPanel'
import HeadlinesTicker from './panels/HeadlinesTicker'
import PairTradingPanel from './panels/PairTradingPanel'
import WatchlistPanel from './panels/WatchlistPanel'
import BloombergNewsPanel from './panels/BloombergNewsPanel'
import SectorHeatmapPanel from './panels/SectorHeatmapPanel'
import FearGreedPanel from './panels/FearGreedPanel'
import ResizablePanel from './ResizablePanel'
import { useWideMap } from '../../hooks/useResizablePanel'

const REFRESH_MS = 60_000
const CHART_ONLY_SYMBOLS = ['ES=F']

export default function DashboardView({ state, watchlistTickers = [] }: { state: AppState; watchlistTickers?: string[] }) {
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
    // Taller now that its column is wider (60/40 map split, up from 70/30) —
    // LiveTVPanel keeps a strict 16:9 video box sized by whichever of
    // width/height is the binding constraint; at the old height a wider
    // column just left empty space beside a video that couldn't grow past
    // the unchanged height ceiling. autoFit is off for it specifically —
    // the video derives its own size FROM the container's height, which
    // fights the auto-fit effect's own "measure at height:auto" step and
    // kept shrinking it back down regardless of defaultHeight.
    { id: 'livetv', h: 520, autoFit: false, node: <LiveTVPanel /> },
    { id: 'fear-greed', h: 180, autoFit: true, node: <FearGreedPanel /> },
    { id: 'pairs', h: 340, autoFit: true, node: <PairTradingPanel state={state} topN={5} /> },
  ]
  const colB = [
    { id: 'watchlist', h: 340, autoFit: true, node: <WatchlistPanel tickers={watchlistTickers} /> },
    { id: 'bloomberg-news', h: 400, autoFit: true, node: <BloombergNewsPanel /> },
  ]
  const wideOnes = [...colA, ...colB].filter(p => wideIds.has(p.id))

  return (
    <div className="dash-page">
      <HeadlinesTicker />
      <div className="dash-wrap">
        <div className="dash-left-col">
          <div className="dash-cell dash-left-map">
            <WorldMapPanel quotes={quotes} now={now} />
          </div>
          <div className="dash-cell dash-left-charts">
            <LiveChartsStrip quotes={quotes} layout="row-single" />
          </div>
          <div className="dash-cell dash-left-heatmap">
            <SectorHeatmapPanel />
          </div>
        </div>

        <div className="dash-right-cols-wrap">
          {wideOnes.map(p => (
            <ResizablePanel key={p.id} id={p.id} defaultWidth={900} defaultHeight={p.h} axis="vertical"
              autoFit={p.autoFit ?? true} wide onSetWide={(w) => setWide(p.id, w)}>
              {p.node}
            </ResizablePanel>
          ))}
          <div className="dash-right-cols">
            <div className="dash-right-col">
              {colA.filter(p => !wideIds.has(p.id)).map(p => (
                <ResizablePanel key={p.id} id={p.id} defaultWidth={900} defaultHeight={p.h} axis="vertical"
                  autoFit={p.autoFit ?? true} onSetWide={(w) => setWide(p.id, w)}>
                  {p.node}
                </ResizablePanel>
              ))}
            </div>
            <div className="dash-right-col">
              {colB.filter(p => !wideIds.has(p.id)).map(p => (
                <ResizablePanel key={p.id} id={p.id} defaultWidth={460} defaultHeight={p.h} axis="vertical"
                  autoFit={p.autoFit ?? true} onSetWide={(w) => setWide(p.id, w)}>
                  {p.node}
                </ResizablePanel>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
