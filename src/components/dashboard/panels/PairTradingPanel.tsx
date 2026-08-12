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
import { fetchRSI } from '../../../services/rsi'

const OVERBOUGHT = 70
const OVERSOLD = 30
const EXTRA_TICKERS = ['BTC-USD']

function rsiColor(rsi: number): string {
  if (rsi >= OVERBOUGHT) return '#ef4444'
  if (rsi <= OVERSOLD) return '#10b981'
  return 'var(--text-3)'
}

interface RsiRow { symbol: string; rsi: number }

function RsiRowLine({ row }: { row: RsiRow }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5, fontFamily: 'Inter, sans-serif',
      padding: '4px 7px', border: '1px solid var(--border-light)', borderRadius: 5, background: 'var(--bg-elevated)',
    }}>
      <span style={{ color: 'var(--text-2)', fontWeight: 600, width: 46 }}>{row.symbol}</span>
      <div style={{ flex: 1, position: 'relative', height: 4, background: 'var(--bg-card)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ position: 'absolute', left: `${OVERSOLD}%`, width: `${OVERBOUGHT - OVERSOLD}%`, top: 0, bottom: 0, background: 'var(--border-light)' }} />
        <div style={{ position: 'absolute', left: `calc(${Math.min(Math.max(row.rsi, 0), 100)}% - 1.5px)`, top: -1, bottom: -1, width: 3, borderRadius: 2, background: rsiColor(row.rsi) }} />
      </div>
      <span style={{ color: rsiColor(row.rsi), fontWeight: 700, width: 28, textAlign: 'right' }}>{row.rsi.toFixed(0)}</span>
    </div>
  )
}

export default function PairTradingPanel({ state }: { state: AppState }) {
  const [rsiMap, setRsiMap] = useState<Record<string, number>>({})
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
    const data = await fetchRSI(allSymbols)
    setRsiMap(data)
    setLoading(false)
  }

  useEffect(() => { load() }, [allSymbols.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps

  const rows: RsiRow[] = useMemo(
    () => allSymbols.filter(s => rsiMap[s] != null).map(s => ({ symbol: s, rsi: rsiMap[s] })),
    [allSymbols, rsiMap],
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

  const top10Overbought = [...rows].sort((a, b) => b.rsi - a.rsi).slice(0, 10)
  const top10Oversold   = [...rows].sort((a, b) => a.rsi - b.rsi).slice(0, 10)

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

      <div style={{ flex: 1, overflow: 'auto', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
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
                <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-1)', fontFamily: 'Inter, sans-serif' }}>{top.sell.symbol}</div>
                <div style={{ fontSize: 10.5, color: '#ef4444', fontWeight: 700 }}>SELL · {top.sell.rsi.toFixed(1)}</div>
              </div>
              <ArrowRightLeft size={13} style={{ color: 'var(--text-5)', flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-1)', fontFamily: 'Inter, sans-serif' }}>{top.buy.symbol}</div>
                <div style={{ fontSize: 10.5, color: '#10b981', fontWeight: 700 }}>BUY · {top.buy.rsi.toFixed(1)}</div>
              </div>
              <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                <div style={{ fontSize: 9, color: 'var(--text-4)' }}>SPREAD</div>
                <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--accent)', fontFamily: 'Inter, sans-serif' }}>{top.spread.toFixed(1)}</div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, borderTop: '1px solid var(--border-light)', paddingTop: 7 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: '#ef4444', letterSpacing: '0.06em', marginBottom: 4 }}>
                  TOP 10 OVERBOUGHT
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {top10Overbought.map(r => <RsiRowLine key={r.symbol} row={r} />)}
                </div>
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: '#10b981', letterSpacing: '0.06em', marginBottom: 4 }}>
                  TOP 10 OVERSOLD
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {top10Oversold.map(r => <RsiRowLine key={r.symbol} row={r} />)}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
