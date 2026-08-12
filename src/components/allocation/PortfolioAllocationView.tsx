/**
 * Portfolio Allocation — target $1M portfolio (per the user's stated bucket
 * percentages) vs what's actually held in IBKR (stock shares + LEAP call
 * notional shares), with side-by-side pie charts, a per-ticker gap table,
 * and a "next buy" recommendation based on which underweight ticker is
 * trading the furthest below its 52-week high.
 */
import { useEffect, useMemo, useState } from 'react'
import { RefreshCw, TrendingDown, AlertTriangle } from 'lucide-react'
import type { AppState } from '../../types'
import { fetchQuotes, type Quote } from '../../services/quotes'
import {
  TARGETS, CASH_PCT, TARGET_PORTFOLIO_VALUE, SPCX_STATIC_PRICE, CATEGORY_COLOR, type Category,
} from '../../data/portfolioTargets'

function fmt$(n: number): string {
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`
  return `${sign}$${abs.toFixed(0)}`
}

// Distinct hue per row so a 17-slice pie stays legible instead of just 4
// repeated category colors.
function tickerColor(i: number, category: Category | 'cash'): string {
  if (category === 'cash') return CATEGORY_COLOR.cash
  const hue = (i * 47) % 360
  return `hsl(${hue}, 62%, 55%)`
}

interface Row {
  symbol: string
  category: Category | 'cash'
  price: number
  high52: number | null
  targetPct: number
  targetValue: number
  targetShares: number
  actualShares: number
  actualLeapShares: number
  actualValue: number
  color: string
}

interface Slice { label: string; value: number; color: string }

function PortfolioPie({ slices, centerLabel, centerValue }: { slices: Slice[]; centerLabel: string; centerValue: string }) {
  const total = slices.reduce((s, x) => s + x.value, 0)
  const SIZE = 200, CX = 100, CY = 100, R = 92
  if (total <= 0) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: SIZE, color: 'var(--text-4)', fontSize: 12 }}>No data</div>
  }
  let angle = -90
  const wedges = slices.filter(s => s.value > 0).map(s => {
    const frac = s.value / total
    const start = angle
    const end = angle + frac * 360
    angle = end
    const p0 = { x: CX + R * Math.cos(start * Math.PI / 180), y: CY + R * Math.sin(start * Math.PI / 180) }
    const p1 = { x: CX + R * Math.cos(end * Math.PI / 180), y: CY + R * Math.sin(end * Math.PI / 180) }
    const largeArc = end - start > 180 ? 1 : 0
    return { ...s, frac, path: `M${CX},${CY} L${p0.x},${p0.y} A${R},${R} 0 ${largeArc} 1 ${p1.x},${p1.y} Z` }
  })
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
      <div style={{ position: 'relative', width: SIZE, flexShrink: 0 }}>
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} style={{ width: '100%', display: 'block' }}>
          {wedges.map((w, i) => <path key={i} d={w.path} fill={w.color} stroke="var(--bg-card)" strokeWidth={1.5} />)}
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <span style={{ fontSize: 9, color: 'var(--text-4)', letterSpacing: '1px', textTransform: 'uppercase' }}>{centerLabel}</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-1)', fontFamily: 'Inter, sans-serif' }}>{centerValue}</span>
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px 10px', justifyContent: 'center', maxWidth: 320 }}>
        {wedges.filter(w => w.frac >= 0.008).map((w, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontFamily: 'Inter, sans-serif' }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: w.color, flexShrink: 0 }} />
            <span style={{ color: 'var(--text-2)', fontWeight: 600 }}>{w.label}</span>
            <span style={{ color: 'var(--text-4)' }}>{(w.frac * 100).toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function PortfolioAllocationView({ state }: { state: AppState }) {
  const [quotes, setQuotes] = useState<Record<string, Quote>>({})
  const [loading, setLoading] = useState(false)

  const liveSymbols = useMemo(() => TARGETS.map(t => t.symbol).filter(s => s !== 'SPCX'), [])

  async function load() {
    setLoading(true)
    setQuotes(await fetchQuotes(liveSymbols))
    setLoading(false)
  }
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // TSLA vs SPCX "value buy" swing: SPCX is private with no live quote to
  // compare, so the only real signal available is TSLA's own distance from
  // its 52-week high. A meaningful discount (>20%) tips the extra 10% to
  // TSLA; otherwise the base 20/20 stays even.
  const tslaQuote = quotes['TSLA']
  const tslaDiscount = tslaQuote?.high52 ? (tslaQuote.high52 - tslaQuote.price) / tslaQuote.high52 * 100 : null
  const tslaGetsSwing = tslaDiscount != null && tslaDiscount > 20
  const swingPct: Record<string, number> = { TSLA: tslaGetsSwing ? 10 : 5, SPCX: tslaGetsSwing ? 0 : 5 }

  const rows: Row[] = useMemo(() => {
    return TARGETS.map((t, i) => {
      const price = t.symbol === 'SPCX' ? SPCX_STATIC_PRICE : (quotes[t.symbol]?.price ?? 0)
      const high52 = t.symbol === 'SPCX' ? null : (quotes[t.symbol]?.high52 ?? null)
      const targetPct = t.basePct + (swingPct[t.symbol] ?? 0)
      const targetDollar = targetPct / 100 * TARGET_PORTFOLIO_VALUE
      const targetShares = price > 0 ? Math.max(t.lotSize, Math.round(targetDollar / price / t.lotSize) * t.lotSize) : 0

      const stockShares = state.sync.positions
        .filter(p => p.assetClass === 'STK' && p.symbol === t.symbol)
        .reduce((s, p) => s + p.quantity, 0)
      const leapShares = state.sync.positions
        .filter(p => p.assetClass === 'OPT' && p.putCall === 'C' && p.quantity > 0 && (p.underlyingSymbol ?? p.symbol) === t.symbol)
        .reduce((s, p) => s + p.quantity * (p.multiplier ?? 100), 0)

      return {
        symbol: t.symbol,
        category: t.category,
        price, high52,
        targetPct,
        targetValue: targetShares * price,
        targetShares,
        actualShares: stockShares,
        actualLeapShares: leapShares,
        actualValue: (stockShares + leapShares) * price,
        color: tickerColor(i, t.category),
      }
    })
  }, [quotes, state.sync.positions, tslaGetsSwing]) // eslint-disable-line react-hooks/exhaustive-deps

  const actualCash = state.sync.cashBalance ?? 0
  const targetCash = CASH_PCT / 100 * TARGET_PORTFOLIO_VALUE

  const targetTotal = rows.reduce((s, r) => s + r.targetValue, 0) + targetCash
  const actualTotal = rows.reduce((s, r) => s + r.actualValue, 0) + actualCash

  const targetSlices: Slice[] = [
    { label: 'CASH', value: targetCash, color: CATEGORY_COLOR.cash },
    ...rows.map(r => ({ label: r.symbol, value: r.targetValue, color: r.color })),
  ]
  const actualSlices: Slice[] = [
    { label: 'CASH', value: actualCash, color: CATEGORY_COLOR.cash },
    ...rows.map(r => ({ label: r.symbol, value: r.actualValue, color: r.color })),
  ]

  // Recommendation: among tickers with a real underweight gap (target well
  // above actual), the best "value buy" right now is whichever is trading
  // furthest below its own 52-week high — cheap relative to its own recent
  // range, not just cheap in absolute terms.
  const recommendation = useMemo(() => {
    const underweight = rows.filter(r => r.high52 != null && r.price > 0 && r.targetValue - r.actualValue > r.targetValue * 0.15)
    if (underweight.length === 0) return null
    return [...underweight].sort((a, b) => {
      const da = (a.high52! - a.price) / a.high52!
      const db = (b.high52! - b.price) / b.high52!
      return db - da
    })[0]
  }, [rows])

  const gaps = [...rows]
    .map(r => ({ ...r, gap: r.targetValue - r.actualValue }))
    .sort((a, b) => b.gap - a.gap)

  return (
    <div className="jr-root">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span className="cc-section-title" style={{ padding: 0 }}>Portfolio Allocation</span>
        <span style={{ fontSize: 11, color: 'var(--text-4)' }}>Target $1M · vs actual IBKR holdings (shares + LEAP calls)</span>
        <button onClick={load} disabled={loading} style={{
          marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px',
          fontSize: 11, fontWeight: 600, background: 'var(--accent-dim)', border: '1px solid var(--accent-border)',
          color: 'var(--accent)', cursor: loading ? 'not-allowed' : 'pointer', borderRadius: 4, fontFamily: 'Inter, sans-serif',
        }}>
          <RefreshCw size={12} style={{ animation: loading ? 'spin 1.5s linear infinite' : 'none' }} />
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {/* ── Target vs Actual pies ────────────────────────────────────────── */}
      <div className="jr-2col">
        <div className="panel" style={{ padding: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-4)', letterSpacing: '0.08em', marginBottom: 10 }}>
            TARGET $1M PORTFOLIO
          </div>
          <PortfolioPie slices={targetSlices} centerLabel="Target" centerValue={fmt$(targetTotal)} />
        </div>
        <div className="panel" style={{ padding: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-4)', letterSpacing: '0.08em', marginBottom: 10 }}>
            ACTUAL HOLDINGS
          </div>
          <PortfolioPie slices={actualSlices} centerLabel="Actual" centerValue={fmt$(actualTotal)} />
        </div>
      </div>

      {/* ── Recommendation ───────────────────────────────────────────────── */}
      <div className="panel" style={{ padding: '14px 18px' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-4)', letterSpacing: '0.08em', marginBottom: 8 }}>
          NEXT BUY RECOMMENDATION
        </div>
        {!recommendation ? (
          <div style={{ fontSize: 12, color: 'var(--text-4)' }}>
            {loading ? 'Loading quotes…' : 'No ticker is both meaningfully underweight and has 52-week-high data to compare — nothing stands out right now.'}
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <TrendingDown size={22} style={{ color: '#10b981', flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-1)', fontFamily: 'Inter, sans-serif' }}>{recommendation.symbol}</div>
              <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
                {((recommendation.high52! - recommendation.price) / recommendation.high52! * 100).toFixed(0)}% below its 52-week high
                (${recommendation.price.toFixed(2)} vs ${recommendation.high52!.toFixed(2)}) — and {fmt$(recommendation.targetValue - recommendation.actualValue)} under target.
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Gap table ─────────────────────────────────────────────────────── */}
      <div className="panel" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '12px 18px 8px', fontSize: 11, fontWeight: 700, color: 'var(--text-4)', letterSpacing: '0.08em' }}>
          GAP TO TARGET
        </div>
        <div style={{ flex: 1, overflow: 'auto' }}>
          <table className="trade-table" style={{ width: '100%', fontSize: 12 }}>
            <thead>
              <tr>
                <th>Ticker</th>
                <th style={{ textAlign: 'right' }}>Price</th>
                <th style={{ textAlign: 'right' }}>Target %</th>
                <th style={{ textAlign: 'right' }}>Target Shares</th>
                <th style={{ textAlign: 'right' }}>Target $</th>
                <th style={{ textAlign: 'right' }}>Actual Shares</th>
                <th style={{ textAlign: 'right' }}>Actual $</th>
                <th style={{ textAlign: 'right' }}>Gap $</th>
                <th style={{ textAlign: 'right' }}>Shares to Buy/Sell</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="mono" style={{ fontWeight: 700 }}>CASH</td>
                <td className="mono" style={{ textAlign: 'right' }}>—</td>
                <td className="mono" style={{ textAlign: 'right' }}>{CASH_PCT.toFixed(1)}%</td>
                <td className="mono" style={{ textAlign: 'right' }}>—</td>
                <td className="mono" style={{ textAlign: 'right' }}>{fmt$(targetCash)}</td>
                <td className="mono" style={{ textAlign: 'right' }}>—</td>
                <td className="mono" style={{ textAlign: 'right' }}>{fmt$(actualCash)}</td>
                <td className={`mono ${targetCash - actualCash > 0 ? 'pos' : targetCash - actualCash < 0 ? 'neg' : 'neu'}`} style={{ textAlign: 'right', fontWeight: 700 }}>
                  {fmt$(targetCash - actualCash)}
                </td>
                <td className="mono" style={{ textAlign: 'right' }}>—</td>
              </tr>
              {gaps.map(r => {
                const sharesDelta = r.price > 0 ? Math.round(r.gap / r.price) : 0
                return (
                  <tr key={r.symbol}>
                    <td className="mono" style={{ fontWeight: 700, color: 'var(--text-1)' }}>
                      <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: r.color, marginRight: 6 }} />
                      {r.symbol}
                    </td>
                    <td className="mono" style={{ textAlign: 'right' }}>{r.price > 0 ? `$${r.price.toFixed(2)}` : (loading ? '…' : '—')}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{r.targetPct.toFixed(1)}%</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{r.targetShares.toLocaleString()}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{fmt$(r.targetValue)}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>
                      {r.actualShares.toLocaleString()}
                      {r.actualLeapShares > 0 && <span style={{ color: 'var(--text-4)' }}> (+{r.actualLeapShares.toLocaleString()} LEAP)</span>}
                    </td>
                    <td className="mono" style={{ textAlign: 'right' }}>{fmt$(r.actualValue)}</td>
                    <td className={`mono ${r.gap > 0 ? 'pos' : r.gap < 0 ? 'neg' : 'neu'}`} style={{ textAlign: 'right', fontWeight: 700 }}>{fmt$(r.gap)}</td>
                    <td className="mono" style={{ textAlign: 'right', color: sharesDelta > 0 ? '#10b981' : sharesDelta < 0 ? '#ef4444' : 'var(--text-4)' }}>
                      {sharesDelta > 0 ? `Buy ${sharesDelta}` : sharesDelta < 0 ? `Sell ${-sharesDelta}` : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 18px', borderTop: '1px solid var(--border-light)', fontSize: 10.5, color: 'var(--text-4)' }}>
          <AlertTriangle size={11} style={{ flexShrink: 0 }} />
          SPCX has no live market feed (private company) — price is a manually-tracked estimate. Target shares round to whole 100-share lots (10 for MU/ASML), so totals won't land exactly on $1M or exactly on each %.
        </div>
      </div>
    </div>
  )
}
