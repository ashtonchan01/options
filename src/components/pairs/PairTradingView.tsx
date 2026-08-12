/**
 * Pair Trading — RSI(14)-based overbought/oversold screen across the watchlist
 * plus BTC. The strategy: you can't afford to hold every ticker at once, so
 * rather than picking directionally, rotate out of whatever's most overbought
 * into whatever's most oversold — a mean-reversion pair trade.
 */
import { useEffect, useMemo, useState } from 'react'
import { RefreshCw, ArrowRightLeft, TrendingUp, TrendingDown } from 'lucide-react'
import type { AppState } from '../../types'
import { WATCHLIST } from '../../data/watchlist'
import { fetchRSI } from '../../services/rsi'

const OVERBOUGHT = 70
const OVERSOLD = 30
const EXTRA_TICKERS = ['BTC-USD'] // crypto exposure, alongside the equity watchlist

function rsiColor(rsi: number): string {
  if (rsi >= OVERBOUGHT) return '#ef4444'
  if (rsi <= OVERSOLD) return '#10b981'
  return 'var(--text-3)'
}

interface RsiRow { symbol: string; rsi: number }

function RsiBar({ rsi }: { rsi: number }) {
  return (
    <div style={{ position: 'relative', height: 5, background: 'var(--bg-elevated)', borderRadius: 3, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', left: `${OVERSOLD}%`, width: `${OVERBOUGHT - OVERSOLD}%`, top: 0, bottom: 0, background: 'var(--border-light)' }} />
      <div style={{
        position: 'absolute', left: `calc(${Math.min(Math.max(rsi, 0), 100)}% - 2px)`, top: -1, bottom: -1,
        width: 4, borderRadius: 2, background: rsiColor(rsi),
      }} />
    </div>
  )
}

function RsiList({ title, rows, icon, emptyMsg }: {
  title: string; rows: RsiRow[]; icon: React.ReactNode; emptyMsg: string
}) {
  return (
    <div className="dash-panel" style={{ flex: 1 }}>
      <div className="dash-panel-header" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {icon}<span>{title}</span>
        <span className="dash-panel-sub" style={{ marginLeft: 'auto' }}>{rows.length}</span>
      </div>
      <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
        {rows.length === 0 && (
          <div style={{ padding: '16px 14px', fontSize: 12, color: 'var(--text-4)' }}>{emptyMsg}</div>
        )}
        {rows.map(r => (
          <div key={r.symbol} style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px',
            borderTop: '1px solid var(--border-light)',
          }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)', fontFamily: 'Inter, sans-serif', width: 66, flexShrink: 0 }}>
              {r.symbol}
            </span>
            <div style={{ flex: 1 }}><RsiBar rsi={r.rsi} /></div>
            <span style={{ fontSize: 13, fontWeight: 700, color: rsiColor(r.rsi), fontFamily: 'Inter, sans-serif', width: 40, textAlign: 'right', flexShrink: 0 }}>
              {r.rsi.toFixed(1)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function PairTradingView({ state }: { state: AppState }) {
  const [rsiMap, setRsiMap] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(false)
  const [lastFetched, setLastFetched] = useState<number | null>(null)

  // Same universe the Scanner uses: watchlist + any ticker you actually hold,
  // plus BTC for crypto exposure — everything you'd realistically rotate between.
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
    const data = await fetchRSI(allSymbols)
    setRsiMap(data)
    setLastFetched(Date.now())
    setLoading(false)
  }

  useEffect(() => { load() }, [allSymbols.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps

  const rows: RsiRow[] = useMemo(
    () => allSymbols
      .filter(s => rsiMap[s] != null)
      .map(s => ({ symbol: s, rsi: rsiMap[s] })),
    [allSymbols, rsiMap],
  )

  // Overbought = sell candidates (rotate OUT of), oversold = buy candidates
  // (rotate INTO). If nothing actually crosses the classic 70/30 thresholds,
  // fall back to the most extreme few so the page is never just empty.
  const overboughtStrict = rows.filter(r => r.rsi >= OVERBOUGHT).sort((a, b) => b.rsi - a.rsi)
  const oversoldStrict   = rows.filter(r => r.rsi <= OVERSOLD).sort((a, b) => a.rsi - b.rsi)
  const overbought = overboughtStrict.length > 0 ? overboughtStrict : [...rows].sort((a, b) => b.rsi - a.rsi).slice(0, 3)
  const oversold   = oversoldStrict.length > 0   ? oversoldStrict   : [...rows].sort((a, b) => a.rsi - b.rsi).slice(0, 3)

  // Every overbought×oversold combination, ranked by RSI spread (the widest
  // gap is the strongest mean-reversion signal — most stretched sell funding
  // the most stretched buy).
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
  const alternates = pairs.slice(1, 5)

  return (
    <div className="jr-root">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <ArrowRightLeft size={16} style={{ color: 'var(--accent)' }} />
        <span className="cc-section-title" style={{ padding: 0 }}>Pair Trading</span>
        <span style={{ fontSize: 11, color: 'var(--text-4)' }}>
          RSI(14) · {rows.length} of {allSymbols.length} tickers loaded
          {lastFetched && ` · updated ${new Date(lastFetched).toLocaleTimeString()}`}
        </span>
        <button onClick={load} disabled={loading} style={{
          marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px',
          fontSize: 11, fontWeight: 600, background: 'var(--accent-dim)', border: '1px solid var(--accent-border)',
          color: 'var(--accent)', cursor: loading ? 'not-allowed' : 'pointer', borderRadius: 4,
          fontFamily: 'Inter, sans-serif',
        }}>
          <RefreshCw size={12} style={{ animation: loading ? 'spin 1.5s linear infinite' : 'none' }} />
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {/* ── Recommended pair ─────────────────────────────────────────────── */}
      <div className="panel" style={{ padding: '16px 18px' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-4)', letterSpacing: '0.08em', marginBottom: 10 }}>
          RECOMMENDED PAIR
        </div>
        {!top ? (
          <div style={{ fontSize: 13, color: 'var(--text-4)' }}>
            {loading ? 'Loading RSI data…' : 'Not enough data to recommend a pair yet.'}
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#ef4444', letterSpacing: '0.06em' }}>SELL (OVERBOUGHT)</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-1)', fontFamily: 'Inter, sans-serif' }}>{top.sell.symbol}</div>
                <div style={{ fontSize: 12, color: '#ef4444', fontWeight: 600 }}>RSI {top.sell.rsi.toFixed(1)}</div>
              </div>
              <ArrowRightLeft size={20} style={{ color: 'var(--text-4)' }} />
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#10b981', letterSpacing: '0.06em' }}>BUY (OVERSOLD)</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-1)', fontFamily: 'Inter, sans-serif' }}>{top.buy.symbol}</div>
                <div style={{ fontSize: 12, color: '#10b981', fontWeight: 600 }}>RSI {top.buy.rsi.toFixed(1)}</div>
              </div>
              <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                <div style={{ fontSize: 10, color: 'var(--text-4)', letterSpacing: '0.06em' }}>RSI SPREAD</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--accent)', fontFamily: 'Inter, sans-serif' }}>{top.spread.toFixed(1)}</div>
              </div>
            </div>
            {(!overboughtStrict.length || !oversoldStrict.length) && (
              <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-4)' }}>
                Nothing is strictly past the 70/{OVERSOLD} threshold right now — showing the most stretched pair available instead.
              </div>
            )}
            {alternates.length > 0 && (
              <div style={{ marginTop: 14, borderTop: '1px solid var(--border-light)', paddingTop: 10 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-4)', letterSpacing: '0.06em', marginBottom: 6 }}>
                  ALTERNATE PAIRS
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {alternates.map((p, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontFamily: 'Inter, sans-serif' }}>
                      <span style={{ color: '#ef4444', fontWeight: 600 }}>{p.sell.symbol} {p.sell.rsi.toFixed(1)}</span>
                      <ArrowRightLeft size={11} style={{ color: 'var(--text-5)' }} />
                      <span style={{ color: '#10b981', fontWeight: 600 }}>{p.buy.symbol} {p.buy.rsi.toFixed(1)}</span>
                      <span style={{ color: 'var(--text-4)', marginLeft: 'auto' }}>spread {p.spread.toFixed(1)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Overbought / Oversold lists ──────────────────────────────────── */}
      <div className="jr-2col" style={{ flex: 1, minHeight: 0 }}>
        <RsiList
          title="Overbought — sell candidates"
          rows={overbought}
          icon={<TrendingUp size={14} style={{ color: '#ef4444' }} />}
          emptyMsg="Nothing overbought right now."
        />
        <RsiList
          title="Oversold — buy candidates"
          rows={oversold}
          icon={<TrendingDown size={14} style={{ color: '#10b981' }} />}
          emptyMsg="Nothing oversold right now."
        />
      </div>
    </div>
  )
}
