/**
 * World-Monitor-style overview. The main area is an even split: the map
 * column and the Live TV column are each half the width. The map fills its
 * half and keeps its own aspect ratio. Live TV fills its half as a 16:9
 * player and stays the top card there. The sector heatmap and the index
 * sparkline strip stay in the map half, under the map — the strip does not
 * run under the video. Fear & Greed and Pair Trading stack under the video;
 * Watchlist is the other column on that side. Each right-side panel has a
 * drag handle on its bottom edge to resize its height (remembered per panel —
 * see ResizablePanel/useResizablePanel) and a right-edge handle to expand
 * across both columns (see useWideMap) — wide panels render in their own
 * full-width row above the two columns. A thin scrolling headlines ticker
 * (top 10 latest across followed tickers) runs above everything else, full
 * width. Watchlist Breadth and Earnings Calendar are removed.
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
    // LiveTVPanel's video box now uses the padding-percentage aspect-ratio
    // technique (height derived from width, no JS measurement) instead of a
    // JS-computed size — so autoFit can stay on: the panel settles to
    // exactly that box's natural height (undistorted 16:9, no gap below it)
    // instead of needing a hand-picked defaultHeight that was always wrong
    // for some column width. The id is bumped ('livetv' -> 'livetv-2')
    // because ResizablePanel persists a manually/auto-saved pixel height per
    // id in localStorage, and autoFit refuses to override an existing stored
    // size (see useResizablePanel's fit()) — a size saved under the OLD
    // sizing model (before this fix) would otherwise permanently block the
    // new one from ever taking effect for anyone who'd already loaded this
    // panel before.
    { id: 'livetv-2', h: 300, autoFit: true, node: <LiveTVPanel /> },
    // ids bumped ('fear-greed'/'pairs'/'watchlist' -> '-2') for the same
    // reason as livetv-2 above: a browser that had ever loaded this panel
    // before the mobile layout fix has a stored pixel height under the old
    // id, which permanently blocks autoFit from ever re-measuring — so the
    // fix (scoping the mobile CSS height override away from these panels)
    // never actually took effect for a returning user, only a fresh one.
    { id: 'fear-greed-2', h: 180, autoFit: true, node: <FearGreedPanel /> },
    { id: 'pairs-2', h: 340, autoFit: true, node: <PairTradingPanel state={state} topN={5} /> },
  ]
  const colB = [
    { id: 'watchlist-2', h: 340, autoFit: true, node: <WatchlistPanel tickers={watchlistTickers} /> },
  ]
  const wideOnes = [...colA, ...colB].filter(p => wideIds.has(p.id))

  return (
    <div className="dash-page">
      <HeadlinesTicker />
      <div className="dash-wrap">
        <div className="dash-top">
          <div className="dash-left-col">
            <div className="dash-cell dash-left-map">
              <WorldMapPanel quotes={quotes} now={now} />
            </div>
            <div className="dash-cell dash-left-heatmap">
              <SectorHeatmapPanel />
            </div>
            <div className="dash-cell dash-left-charts">
              <LiveChartsStrip quotes={quotes} layout="row-single" />
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
    </div>
  )
}
