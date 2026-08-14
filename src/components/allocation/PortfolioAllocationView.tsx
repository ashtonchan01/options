/**
 * Portfolio Allocation — target $1M portfolio (per the user's stated bucket
 * percentages) vs what's actually held in IBKR (stock shares + LEAP call
 * notional shares), with side-by-side pie charts and a per-ticker gap table.
 * The gap table's "Buy Now" column and sort order surface the best mean-
 * reversion buy first — a blend of 52w-high discount and RSI oversold
 * reading for tickers that are meaningfully underweight their target.
 */
import { useEffect, useMemo, useState } from 'react'
import { RefreshCw, AlertTriangle } from 'lucide-react'
import type { AppState } from '../../types'
import { fetchQuotes, type Quote } from '../../services/quotes'
import { fetchRSI } from '../../services/rsi'
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
  actualLeapContracts: number
  actualValue: number
  color: string
  rsi: number | null
}

interface Slice { label: string; value: number; color: string }

/** Google-Sheets-style pie: labels sit outside the circle with a bent leader
 * line back to the wedge, instead of a separate legend list — matching the
 * user's own reference chart. Labels are bucketed to the left/right half by
 * which side their wedge's midpoint angle falls on, then nudged apart
 * vertically (greedy, sorted top-to-bottom) so tightly-packed small slices
 * don't print their labels on top of each other. */
function PortfolioPie({ slices, centerLabel, centerValue }: { slices: Slice[]; centerLabel: string; centerValue: string }) {
  const total = slices.reduce((s, x) => s + x.value, 0)
  // Letting this scale to the panel's full ~900px column width (no cap)
  // blew everything up uniformly — dots, leader lines, and text all ~2x
  // too big, with the actual donut a small island in a sea of empty
  // margin. A capped width, sized tightly around the donut + labels
  // instead of a big arbitrary box, keeps it compact and proportioned
  // regardless of how wide its column is.
  const W = 440, H = 260, CX = 220, CY = 130, R = 68
  const LABEL_ROW_H = 15
  const ELBOW_R = R + 10
  const OUTER_X = R + 42 // horizontal distance from center to the label text column

  if (total <= 0) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: H, color: 'var(--text-4)', fontSize: 12 }}>No data</div>
  }

  let angle = -90
  const wedges = slices.filter(s => s.value > 0).map(s => {
    const frac = s.value / total
    const start = angle
    const end = angle + frac * 360
    const mid = (start + end) / 2
    angle = end
    const p0 = { x: CX + R * Math.cos(start * Math.PI / 180), y: CY + R * Math.sin(start * Math.PI / 180) }
    const p1 = { x: CX + R * Math.cos(end * Math.PI / 180), y: CY + R * Math.sin(end * Math.PI / 180) }
    const largeArc = end - start > 180 ? 1 : 0
    const midRad = mid * Math.PI / 180
    const edge = { x: CX + R * Math.cos(midRad), y: CY + R * Math.sin(midRad) }
    const elbow = { x: CX + ELBOW_R * Math.cos(midRad), y: CY + ELBOW_R * Math.sin(midRad) }
    const side: 'left' | 'right' = Math.cos(midRad) >= 0 ? 'right' : 'left'
    return {
      ...s, frac,
      path: `M${CX},${CY} L${p0.x},${p0.y} A${R},${R} 0 ${largeArc} 1 ${p1.x},${p1.y} Z`,
      edge, elbow, side, idealY: elbow.y,
    }
  })

  // Skip labels for slivers too thin to read (dot+leader line would just
  // overlap neighbors regardless of vertical spacing).
  const labeled = wedges.filter(w => w.frac >= 0.012)
  for (const side of ['left', 'right'] as const) {
    const group = labeled.filter(w => w.side === side).sort((a, b) => a.idealY - b.idealY)
    for (let i = 1; i < group.length; i++) {
      const min = group[i - 1].idealY + LABEL_ROW_H
      if (group[i].idealY < min) group[i].idealY = min
    }
    // Re-run top-down after a bottom-heavy cluster could push labels past H;
    // pull the whole group back up if the last one overflows.
    const overflow = group.length > 0 ? group[group.length - 1].idealY - (H - 12) : 0
    if (overflow > 0) for (const w of group) w.idealY -= overflow
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: 440, display: 'block', margin: '0 auto', overflow: 'visible' }}>
      {wedges.map((w, i) => <path key={i} d={w.path} fill={w.color} stroke="var(--bg-card)" strokeWidth={1.5} />)}
      <circle cx={CX} cy={CY} r={30} fill="var(--bg-card)" />
      <text x={CX} y={CY - 5} textAnchor="middle" fontSize="8" fill="var(--text-4)" fontFamily="Inter, sans-serif" letterSpacing="1px">
        {centerLabel.toUpperCase()}
      </text>
      <text x={CX} y={CY + 9} textAnchor="middle" fontSize="12" fontWeight="700" fill="var(--text-1)" fontFamily="Inter, sans-serif">
        {centerValue}
      </text>
      {labeled.map((w, i) => {
        const outX = w.side === 'right' ? CX + OUTER_X : CX - OUTER_X
        const textX = w.side === 'right' ? outX + 4 : outX - 4
        return (
          <g key={i}>
            <polyline
              points={`${w.edge.x},${w.edge.y} ${w.elbow.x},${w.elbow.y} ${outX},${w.idealY}`}
              fill="none" stroke="var(--text-5)" strokeWidth={0.75}
            />
            <text x={textX} y={w.idealY} dy={3} textAnchor={w.side === 'right' ? 'start' : 'end'}
              fontSize="10" fontFamily="Inter, sans-serif" fontWeight={600} fill="var(--text-2)">
              {w.label}
              <tspan fill="var(--text-4)" fontWeight={400}> {(w.frac * 100).toFixed(1)}%</tspan>
            </text>
          </g>
        )
      })}
    </svg>
  )
}

export default function PortfolioAllocationView({ state }: { state: AppState }) {
  const [quotes, setQuotes] = useState<Record<string, Quote>>({})
  const [rsiData, setRsiData] = useState<Record<string, { rsi: number }>>({})
  const [loading, setLoading] = useState(false)

  const liveSymbols = useMemo(() => TARGETS.map(t => t.symbol).filter(s => s !== 'SPCX'), [])

  async function load() {
    setLoading(true)
    const [q, r] = await Promise.all([fetchQuotes(liveSymbols), fetchRSI(liveSymbols)])
    setQuotes(q)
    setRsiData(r)
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

      const stockPositions = state.sync.positions.filter(p => p.assetClass === 'STK' && p.symbol === t.symbol)
      const stockShares = stockPositions.reduce((s, p) => s + p.quantity, 0)
      const stockValue = stockPositions.reduce((s, p) => s + p.positionValue, 0)

      const optPositions = state.sync.positions.filter(p => p.assetClass === 'OPT' && (p.underlyingSymbol ?? p.symbol) === t.symbol)
      // Real mark-to-market option value (can be negative for short puts/
      // spreads) — not a notional "contracts x 100 = shares" guess, which
      // wildly overstated actual dollar exposure for anything not deep ITM.
      const optValue = optPositions.reduce((s, p) => s + p.positionValue, 0)
      const leapContracts = optPositions
        .filter(p => p.putCall === 'C' && p.quantity > 0)
        .reduce((s, p) => s + p.quantity, 0)

      return {
        symbol: t.symbol,
        category: t.category,
        price, high52,
        targetPct,
        targetValue: targetShares * price,
        targetShares,
        actualShares: stockShares,
        actualLeapContracts: leapContracts,
        actualValue: stockValue + optValue,
        color: tickerColor(i, t.category),
        rsi: rsiData[t.symbol]?.rsi ?? null,
      }
    })
  }, [quotes, rsiData, state.sync.positions, tslaGetsSwing]) // eslint-disable-line react-hooks/exhaustive-deps

  const actualCash = state.sync.cashBalance ?? 0
  const targetCash = CASH_PCT / 100 * TARGET_PORTFOLIO_VALUE

  const targetTotal = rows.reduce((s, r) => s + r.targetValue, 0) + targetCash

  // Actual total is the account's real net liquidation (same figure shown
  // everywhere else in the app) — not just the sum of our 16 target tickers,
  // which would silently exclude SPX spreads, other CSPs, and anything else
  // held outside this specific list. Whatever that total doesn't account for
  // (matched tickers + cash) falls into an "Other" slice instead of just
  // vanishing, so the actual pie's total always reconciles to something real.
  const matchedValue = rows.reduce((s, r) => s + r.actualValue, 0) + actualCash
  const actualTotal = state.sync.netLiquidation ?? matchedValue
  const otherValue = Math.max(0, actualTotal - matchedValue)

  const targetSlices: Slice[] = [
    { label: 'CASH', value: targetCash, color: CATEGORY_COLOR.cash },
    ...rows.map(r => ({ label: r.symbol, value: r.targetValue, color: r.color })),
  ]
  const actualSlices: Slice[] = [
    { label: 'CASH', value: actualCash, color: CATEGORY_COLOR.cash },
    ...rows.map(r => ({ label: r.symbol, value: r.actualValue, color: r.color })),
    ...(otherValue > 0 ? [{ label: 'OTHER', value: otherValue, color: 'var(--text-5)' }] : []),
  ]

  // Recommendation is scaled to the CURRENT portfolio, not the fixed $1M
  // target — comparing against $1M would flag "underweight" on nearly
  // everything until the account actually grows to that size. Instead,
  // compare each ticker's share of what's actually held right now against
  // its target share of the $1M plan: whichever is furthest below its own
  // target *proportion* is the one that keeps the portfolio on track to
  // grow into the $1M shape over time, regardless of current total size.
  // Among those meaningfully underweight, rank by a blended mean-reversion
  // score instead of 52w-high discount alone — a ticker can be far below its
  // 52w high but not actually oversold short-term (or vice versa), and the
  // two signals disagreeing (as with BSOL's discount vs PLTR's RSI in Pair
  // Trading) is exactly what this is meant to reconcile into one number.
  // discountScore: % below 52w high, scaled so a 40%+ drawdown maxes out at
  // 100. oversoldScore: RSI's distance below neutral (50), scaled so RSI 0
  // maxes out at 100 and anything >=50 (not oversold) scores 0. Averaged
  // 50/50 so a ticker needs to be both cheap-vs-its-own-history AND
  // short-term oversold to rank highest, rather than either alone winning.
  // Score (and the $/shares to buy toward it) per ticker that's both
  // meaningfully underweight and has 52w-high data — the mean-reversion
  // blend of 52w-high discount and RSI oversold reading described above. Buy
  // size is scaled to the CURRENT portfolio (not the fixed $1M target): the
  // ideal dollar amount for this ticker's target % of what's actually held
  // right now, so it doesn't demand buying up to a $1M-sized position on a
  // much smaller account.
  const buyRecMap = useMemo(() => {
    const map = new Map<string, { score: number; discountPct: number; buyDollar: number; buyShares: number }>()
    if (actualTotal <= 0) return map
    for (const r of rows) {
      if (r.high52 == null || r.price <= 0) continue
      const currentPct = r.actualValue / actualTotal * 100
      if (r.targetPct - currentPct <= 1) continue // not meaningfully underweight
      const discountPct = (r.high52 - r.price) / r.high52 * 100
      const discountScore = Math.min(100, Math.max(0, discountPct / 40 * 100))
      const oversoldScore = r.rsi != null ? Math.min(100, Math.max(0, (50 - r.rsi) * 2)) : 0
      const score = r.rsi != null ? discountScore * 0.5 + oversoldScore * 0.5 : discountScore
      const idealAtCurrentSize = r.targetPct / 100 * actualTotal
      const buyDollar = idealAtCurrentSize - r.actualValue
      const buyShares = r.price > 0 ? Math.round(buyDollar / r.price) : 0
      map.set(r.symbol, { score, discountPct, buyDollar, buyShares })
    }
    return map
  }, [rows, actualTotal])

  // Best buys first (highest mean-reversion score), then everything else by
  // plain target-vs-target-plan gap — so "what to buy first" leads the table
  // instead of being a separate panel above it.
  const gaps = [...rows]
    .map(r => ({ ...r, gap: r.targetValue - r.actualValue, rec: buyRecMap.get(r.symbol) ?? null }))
    .sort((a, b) => {
      if (a.rec && b.rec) return b.rec.score - a.rec.score
      if (a.rec) return -1
      if (b.rec) return 1
      return b.gap - a.gap
    })

  return (
    <div className="jr-root">
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <div className="cc-section-title" style={{ padding: 0 }}>Portfolio Allocation</div>
          <div style={{ fontSize: 11, color: 'var(--text-4)', marginTop: 3 }}>Target $1M · vs actual IBKR holdings (shares + LEAP calls)</div>
        </div>
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

      {/* ── Gap table ─────────────────────────────────────────────────────── */}
      {/* flex:1 (not a fixed height) — fills whatever's left below the pies
          and recommendation panel instead of stopping at a fixed 50vh and
          leaving the rest of the screen blank underneath it. min-height:0
          keeps it from being pushed taller than the viewport by its own
          content; the inner .jr-gap-table-scroll still scrolls internally
          for whatever doesn't fit. */}
      <div className="panel jr-gap-table-panel" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '12px 18px 8px', fontSize: 11, fontWeight: 700, color: 'var(--text-4)', letterSpacing: '0.08em' }}>
          GAP TO TARGET
        </div>
        <div className="jr-gap-table-scroll" style={{ flex: 1, overflow: 'auto' }}>
          <table className="trade-table jr-gap-table" style={{ width: '100%', fontSize: 12 }}>
            <thead>
              <tr>
                <th>Ticker</th>
                <th style={{ textAlign: 'right' }}>Price</th>
                <th style={{ textAlign: 'right' }}>Target %</th>
                <th style={{ textAlign: 'right' }}>Current %</th>
                <th style={{ textAlign: 'right' }}>Target Shares</th>
                <th style={{ textAlign: 'right' }}>Target $</th>
                <th style={{ textAlign: 'right' }}>Actual Shares</th>
                <th style={{ textAlign: 'right' }}>Actual $</th>
                <th style={{ textAlign: 'right' }}>Gap $</th>
                <th style={{ textAlign: 'right' }}>Shares to Buy/Sell</th>
                <th style={{ textAlign: 'right' }} title="Mean-reversion buy size — 52w-high discount blended with RSI oversold reading, scaled to your current portfolio size (not the $1M target). Table is sorted by this: best buy first.">Buy Now</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="mono" style={{ fontWeight: 700 }}>CASH</td>
                <td className="mono" style={{ textAlign: 'right' }}>—</td>
                <td className="mono" style={{ textAlign: 'right' }}>{CASH_PCT.toFixed(1)}%</td>
                <td className="mono" style={{ textAlign: 'right' }}>{actualTotal > 0 ? `${(actualCash / actualTotal * 100).toFixed(1)}%` : '—'}</td>
                <td className="mono" style={{ textAlign: 'right' }}>—</td>
                <td className="mono" style={{ textAlign: 'right' }}>{fmt$(targetCash)}</td>
                <td className="mono" style={{ textAlign: 'right' }}>—</td>
                <td className="mono" style={{ textAlign: 'right' }}>{fmt$(actualCash)}</td>
                <td className={`mono ${targetCash - actualCash > 0 ? 'pos' : targetCash - actualCash < 0 ? 'neg' : 'neu'}`} style={{ textAlign: 'right', fontWeight: 700 }}>
                  {fmt$(targetCash - actualCash)}
                </td>
                <td className="mono" style={{ textAlign: 'right' }}>—</td>
                <td className="mono" style={{ textAlign: 'right' }}>—</td>
              </tr>
              {gaps.map((r, i) => {
                const sharesDelta = r.price > 0 ? Math.round(r.gap / r.price) : 0
                const isTopPick = i === 0 && !!r.rec
                return (
                  <tr key={r.symbol} style={isTopPick ? { background: '#10b98110' } : undefined}>
                    <td className="mono" style={{ fontWeight: 700, color: 'var(--text-1)' }}>
                      <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: r.color, marginRight: 6 }} />
                      {r.symbol}
                    </td>
                    <td className="mono" style={{ textAlign: 'right' }}>{r.price > 0 ? `$${r.price.toFixed(2)}` : (loading ? '…' : '—')}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{r.targetPct.toFixed(1)}%</td>
                    <td className="mono" style={{ textAlign: 'right', color: actualTotal > 0 && r.targetPct - (r.actualValue / actualTotal * 100) > 1 ? '#ef4444' : undefined }}>
                      {actualTotal > 0 ? `${(r.actualValue / actualTotal * 100).toFixed(1)}%` : '—'}
                    </td>
                    <td className="mono" style={{ textAlign: 'right' }}>{r.targetShares.toLocaleString()}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{fmt$(r.targetValue)}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>
                      {r.actualShares.toLocaleString()}
                      {r.actualLeapContracts > 0 && <span style={{ color: 'var(--text-4)' }}> (+{r.actualLeapContracts.toLocaleString()} LEAP ct.)</span>}
                    </td>
                    <td className="mono" style={{ textAlign: 'right' }}>{fmt$(r.actualValue)}</td>
                    <td className={`mono ${r.gap > 0 ? 'pos' : r.gap < 0 ? 'neg' : 'neu'}`} style={{ textAlign: 'right', fontWeight: 700 }}>{fmt$(r.gap)}</td>
                    <td className="mono" style={{ textAlign: 'right', color: sharesDelta > 0 ? '#10b981' : sharesDelta < 0 ? '#ef4444' : 'var(--text-4)' }}>
                      {sharesDelta > 0 ? `Buy ${sharesDelta}` : sharesDelta < 0 ? `Sell ${-sharesDelta}` : '—'}
                    </td>
                    <td className="mono" style={{ textAlign: 'right', fontWeight: isTopPick ? 800 : 600, color: r.rec && r.rec.buyDollar > 0 ? '#10b981' : 'var(--text-4)' }}>
                      {r.rec && r.rec.buyDollar > 0 && r.rec.buyShares > 0
                        ? `${fmt$(r.rec.buyDollar)} (${r.rec.buyShares.toLocaleString()} sh)`
                        : '—'}
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
