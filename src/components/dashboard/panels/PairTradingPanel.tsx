/**
 * Compact RSI(14) pair-trading panel for the Dashboard — sits next to Ticker
 * Headlines. Full reasoning: you can't afford to hold every watchlist ticker
 * at once, so rotate out of whatever's most overbought into whatever's most
 * oversold rather than picking directionally.
 */
import { useEffect, useMemo, useState } from 'react'
import { RefreshCw, ArrowRightLeft } from 'lucide-react'
import type { AppState } from '../../../types'
import { WATCHLIST } from '../../../data/watchlist'
import { fetchRSI, type RsiData } from '../../../services/rsi'
import { fetchQuotes, type Quote } from '../../../services/quotes'

const OVERBOUGHT = 70
const OVERSOLD = 30
const EXTRA_TICKERS = ['BTC-USD']

/** Display-only — the RSI fetch still uses the real ticker (BTC-USD), just
 * dropping the "-USD" suffix in the UI since "BTC" reads cleaner. */
function displaySymbol(symbol: string): string {
  return symbol.replace(/-USD$/, '')
}

function rsiColor(rsi: number): string {
  if (rsi >= OVERBOUGHT) return '#ef4444'
  if (rsi <= OVERSOLD) return '#10b981'
  return 'var(--text-3)'
}

interface RsiRow { symbol: string; rsi: number; series: number[]; quote?: Quote }

const SPARK_W = 140
const SPARK_H = 40

/** How many consecutive most-recent days the series has stayed past the
 * given threshold — a reading of "72" reads very differently after 1 day
 * past overbought vs. 8 days past it, and the plain RSI number alone can't
 * tell you which. */
function streakDays(series: number[], threshold: number, direction: 'above' | 'below'): number {
  let n = 0
  for (let i = series.length - 1; i >= 0; i--) {
    const past = direction === 'above' ? series[i] >= threshold : series[i] <= threshold
    if (!past) break
    n++
  }
  return n
}

/** Small line chart of the ticker's own recent rolling RSI (not price) — the
 * 70/30 overbought/oversold reference lines give it context a plain price
 * sparkline wouldn't have. */
function RsiSparkline({ series, color }: { series: number[]; color: string }) {
  if (series.length < 2) return <svg style={{ width: '100%', height: '100%' }} />
  const points = series.map((v, i) => {
    const x = (i / (series.length - 1)) * SPARK_W
    const y = SPARK_H - (Math.min(Math.max(v, 0), 100) / 100) * SPARK_H
    return [x, y] as const
  })
  const linePath = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const yFor = (v: number) => SPARK_H - (v / 100) * SPARK_H
  const [lastX, lastY] = points[points.length - 1]
  return (
    <svg viewBox={`0 0 ${SPARK_W} ${SPARK_H}`} preserveAspectRatio="none" style={{ width: '100%', height: '100%', display: 'block', overflow: 'visible' }}>
      <line x1={0} x2={SPARK_W} y1={yFor(OVERBOUGHT)} y2={yFor(OVERBOUGHT)} stroke="var(--border-light)" strokeWidth={1} strokeDasharray="2,2" />
      <line x1={0} x2={SPARK_W} y1={yFor(OVERSOLD)} y2={yFor(OVERSOLD)} stroke="var(--border-light)" strokeWidth={1} strokeDasharray="2,2" />
      <path d={linePath} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      {/* Marks today's reading against its own recent trend — without this
          the line alone doesn't say whether "now" is the peak, the trough,
          or partway through a move. */}
      <circle cx={lastX} cy={lastY} r={2.4} fill={color} vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

/** Rectangular box per ticker: symbol + current RSI, with its recent rolling
 * RSI plotted as a live chart instead of the old single-bar gauge. Tinted
 * background + left accent bar in the same red/green as the RSI reading
 * give the grid some colour instead of a flat monochrome list, and flex:1
 * lets each card stretch to fill the column's full height instead of
 * stopping at a fixed size with dead space below the last row. */
function RsiCard({ row }: { row: RsiRow }) {
  const color = rsiColor(row.rsi)
  const changePct = row.quote?.prevClose ? ((row.quote.price - row.quote.prevClose) / row.quote.prevClose) * 100 : null
  const streak = row.rsi >= OVERBOUGHT ? streakDays(row.series, OVERBOUGHT, 'above')
    : row.rsi <= OVERSOLD ? streakDays(row.series, OVERSOLD, 'below') : 0
  return (
    <div style={{
      flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 4, fontFamily: 'Inter, sans-serif',
      padding: '7px 9px', borderLeft: `3px solid ${color}`, borderRadius: 6, background: `${color}14`,
    }}
      title={`${displaySymbol(row.symbol)} — RSI(14) ${row.rsi.toFixed(1)}${streak > 0 ? `, ${streak}d past ${row.rsi >= OVERBOUGHT ? 'overbought' : 'oversold'}` : ''}${row.quote ? ` · $${row.quote.price.toFixed(2)}` : ''}`}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 6 }}>
        <span style={{ fontSize: 11, color: 'var(--text-2)', fontWeight: 700 }}>{displaySymbol(row.symbol)}</span>
        <span style={{ fontSize: 12.5, color, fontWeight: 800 }}>{row.rsi.toFixed(0)}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, fontSize: 9.5 }}>
        <span style={{ color: 'var(--text-4)' }}>
          {row.quote ? `$${row.quote.price.toFixed(2)}` : '—'}
          {changePct != null && (
            <span style={{ color: changePct >= 0 ? '#10b981' : '#ef4444', marginLeft: 4, fontWeight: 600 }}>
              {changePct >= 0 ? '+' : ''}{changePct.toFixed(1)}%
            </span>
          )}
        </span>
        {streak > 0 && (
          <span style={{ color, fontWeight: 700 }}>{streak}d</span>
        )}
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <RsiSparkline series={row.series} color={color} />
      </div>
    </div>
  )
}

export default function PairTradingPanel({ state, topN = 10 }: { state: AppState; topN?: number }) {
  const [rsiMap, setRsiMap] = useState<Record<string, RsiData>>({})
  const [quoteMap, setQuoteMap] = useState<Record<string, Quote>>({})
  const [loading, setLoading] = useState(false)

  const tickers = useMemo(() => {
    const SKIP = new Set(['SPX', 'SPY', 'QQQ', 'IWM', 'DIA', 'VIX'])
    const set = new Set<string>(WATCHLIST)
    for (const p of state.sync.positions) {
      const sym = p.underlyingSymbol ?? (p.assetClass === 'STK' ? p.symbol : null)
      if (sym && !SKIP.has(sym)) set.add(sym)
    }
    return [...set].sort()
  }, [state.sync.positions])

  const allSymbols = useMemo(() => [...tickers, ...EXTRA_TICKERS], [tickers])

  async function load() {
    setLoading(true)
    const [rsi, quotes] = await Promise.all([fetchRSI(allSymbols), fetchQuotes(allSymbols)])
    setRsiMap(rsi)
    setQuoteMap(quotes)
    setLoading(false)
  }

  useEffect(() => { load() }, [allSymbols.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps

  const rows: RsiRow[] = useMemo(
    () => allSymbols.filter(s => rsiMap[s] != null).map(s => ({ symbol: s, rsi: rsiMap[s].rsi, series: rsiMap[s].series, quote: quoteMap[s] })),
    [allSymbols, rsiMap, quoteMap],
  )

  const overboughtStrict = rows.filter(r => r.rsi >= OVERBOUGHT).sort((a, b) => b.rsi - a.rsi)
  const oversoldStrict   = rows.filter(r => r.rsi <= OVERSOLD).sort((a, b) => a.rsi - b.rsi)
  const overbought = overboughtStrict.length > 0 ? overboughtStrict : [...rows].sort((a, b) => b.rsi - a.rsi).slice(0, 3)
  const oversold   = oversoldStrict.length > 0   ? oversoldStrict   : [...rows].sort((a, b) => a.rsi - b.rsi).slice(0, 3)

  const pairs = useMemo(() => {
    const list: { sell: RsiRow; buy: RsiRow; spread: number }[] = []
    for (const sell of overbought) {
      for (const buy of oversold) {
        if (sell.symbol === buy.symbol) continue
        list.push({ sell, buy, spread: sell.rsi - buy.rsi })
      }
    }
    return list.sort((a, b) => b.spread - a.spread)
  }, [overbought, oversold])

  const top = pairs[0]

  const topOverbought = [...rows].sort((a, b) => b.rsi - a.rsi).slice(0, topN)
  const topOversold   = [...rows].sort((a, b) => a.rsi - b.rsi).slice(0, topN)

  return (
    <div className="dash-panel" style={{ flex: 1 }}>
      <div className="dash-panel-header" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <ArrowRightLeft size={13} style={{ color: 'var(--accent)' }} />
        <span>Pair Trading</span>
        <span className="dash-panel-sub" style={{ marginLeft: 'auto' }}>RSI(14)</span>
        <button onClick={load} disabled={loading} title="Refresh" style={{
          background: 'none', border: 'none', color: 'var(--text-4)', cursor: loading ? 'not-allowed' : 'pointer',
          display: 'flex', padding: 0, marginLeft: 4,
        }}>
          <RefreshCw size={11} style={{ animation: loading ? 'spin 1.5s linear infinite' : 'none' }} />
        </button>
      </div>

      <div className="dash-pairs-scroll" style={{ flex: 1, overflow: 'auto', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {!top ? (
          <div style={{ fontSize: 12, color: 'var(--text-4)' }}>
            {loading ? 'Loading RSI data…' : 'Not enough data yet.'}
          </div>
        ) : (
          <>
            <div style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--text-4)', letterSpacing: '0.06em' }}>
              RECOMMENDED
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-1)', fontFamily: 'Inter, sans-serif' }}>{displaySymbol(top.sell.symbol)}</div>
                <div style={{ fontSize: 10.5, color: '#ef4444', fontWeight: 700 }}>SELL · {top.sell.rsi.toFixed(1)}</div>
                <div style={{ fontSize: 9.5, color: 'var(--text-4)' }}>
                  {top.sell.quote ? `$${top.sell.quote.price.toFixed(2)}` : '—'}
                  {streakDays(top.sell.series, OVERBOUGHT, 'above') > 0 && ` · ${streakDays(top.sell.series, OVERBOUGHT, 'above')}d overbought`}
                </div>
              </div>
              <ArrowRightLeft size={13} style={{ color: 'var(--text-5)', flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-1)', fontFamily: 'Inter, sans-serif' }}>{displaySymbol(top.buy.symbol)}</div>
                <div style={{ fontSize: 10.5, color: '#10b981', fontWeight: 700 }}>BUY · {top.buy.rsi.toFixed(1)}</div>
                <div style={{ fontSize: 9.5, color: 'var(--text-4)' }}>
                  {top.buy.quote ? `$${top.buy.quote.price.toFixed(2)}` : '—'}
                  {streakDays(top.buy.series, OVERSOLD, 'below') > 0 && ` · ${streakDays(top.buy.series, OVERSOLD, 'below')}d oversold`}
                </div>
              </div>
              <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                <div style={{ fontSize: 9, color: 'var(--text-4)' }}>SPREAD</div>
                <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--accent)', fontFamily: 'Inter, sans-serif' }}>{top.spread.toFixed(1)}</div>
              </div>
            </div>
            {/* Plain-language rationale — the numbers above say WHAT the
                reading is, this says WHY it's the top pick: the widest
                overbought/oversold gap on the board is the pair with the
                most room to converge back toward neutral (RSI 50) on both
                legs at once. */}
            <div style={{ fontSize: 10, color: 'var(--text-3)', lineHeight: 1.5 }}>
              Widest RSI gap on the board — {displaySymbol(top.sell.symbol)} is the most overbought watchlist name,
              {' '}{displaySymbol(top.buy.symbol)} the most oversold. Both have room to mean-revert toward RSI 50.
            </div>

            <div className="dash-pairs-columns" style={{ display: 'flex', gap: 16, borderTop: '1px solid var(--border-light)', paddingTop: 8, flex: 1, minHeight: 0 }}>
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: '#ef4444', letterSpacing: '0.06em', marginBottom: 6, flexShrink: 0 }}>
                  TOP {topN} OVERBOUGHT
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minHeight: 0 }}>
                  {topOverbought.map(r => <RsiCard key={r.symbol} row={r} />)}
                </div>
              </div>

              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: '#10b981', letterSpacing: '0.06em', marginBottom: 6, flexShrink: 0 }}>
                  TOP {topN} OVERSOLD
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minHeight: 0 }}>
                  {topOversold.map(r => <RsiCard key={r.symbol} row={r} />)}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
