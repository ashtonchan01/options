import { useMemo, useState, useEffect } from 'react'
import type { AppState, RawPosition } from '../../types'
import { PORTFOLIO_TARGETS, CASH_TARGET, CASH_TARGET_1M, ALLOCATION_TARGETS, PRE_IPO_WATCHLIST } from './portfolioTargets'
import { fetchQuotes } from '../../services/yahoo'

const YAHOO_SYMBOL: Record<string, string> = { BTC: 'BTC-USD', SOL: 'SOL-USD' }
function toYahoo(t: string) { return YAHOO_SYMBOL[t] ?? t }

function fmt$(n: number, d = 0) {
  const prefix = n < 0 ? '-$' : '$'
  return prefix + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
}

// ─── Pie chart (SVG) ────────────────────────────────────────────────────────

const CHART_COLORS = [
  '#f43f5e', '#3b82f6', '#10b981', '#f59e0b', '#6366F1',
  '#ec4899', '#14b8a6', '#fb923c', '#8b5cf6', '#ef4444',
  '#06b6d4', '#84cc16', '#a855f7', '#22d3ee', '#f97316',
  '#64748b',
]

function PieChart({ slices, title, size = 200 }: {
  slices: { label: string; value: number; color?: string }[]
  title: string
  size?: number
}) {
  const total = slices.reduce((s, sl) => s + sl.value, 0)
  if (total <= 0) return null

  const r = size / 2 - 4
  const cx = size / 2
  const cy = size / 2

  let cumAngle = -Math.PI / 2
  const arcs = slices
    .filter(sl => sl.value > 0)
    .map((sl, i) => {
      const pct = sl.value / total
      const angle = pct * 2 * Math.PI
      const startAngle = cumAngle
      const endAngle = cumAngle + angle
      cumAngle = endAngle

      const x1 = cx + r * Math.cos(startAngle)
      const y1 = cy + r * Math.sin(startAngle)
      const x2 = cx + r * Math.cos(endAngle)
      const y2 = cy + r * Math.sin(endAngle)
      const largeArc = angle > Math.PI ? 1 : 0
      const d = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`

      const midAngle = startAngle + angle / 2
      const labelR = r * 0.65
      const lx = cx + labelR * Math.cos(midAngle)
      const ly = cy + labelR * Math.sin(midAngle)

      return { ...sl, d, pct, lx, ly, color: sl.color ?? CHART_COLORS[i % CHART_COLORS.length] }
    })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.08em' }}>{title}</span>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {arcs.map((a, i) => (
          <path key={i} d={a.d} fill={a.color} stroke="var(--bg-card)" strokeWidth={1.5} />
        ))}
        {arcs.filter(a => a.pct >= 0.04).map((a, i) => (
          <text key={`l-${i}`} x={a.lx} y={a.ly} textAnchor="middle" dominantBaseline="middle"
            fill="#fff" fontSize={9} fontWeight={700} fontFamily="Share Tech Mono, monospace">
            {a.label}
          </text>
        ))}
        {arcs.filter(a => a.pct >= 0.04).map((a, i) => (
          <text key={`p-${i}`} x={a.lx} y={a.ly + 11} textAnchor="middle" dominantBaseline="middle"
            fill="rgba(255,255,255,0.7)" fontSize={8} fontFamily="Share Tech Mono, monospace">
            {(a.pct * 100).toFixed(1)}%
          </text>
        ))}
      </svg>
    </div>
  )
}

// ─── Row data builder ───────────────────────────────────────────────────────

interface PortfolioRow {
  ticker: string
  marketPrice: number
  ath: number
  athPct: number
  priceTarget2026: number
  targetPct: number
  atr1: number
  atr2: number
  cagr: number
  price2026: number
  price2027: number
  price2028: number
  targetShares: number
  targetAmount: number
  targetReqShares: number
  targetReqAmount: number
  sharesOwned: number
  costPrice: number
  currentValue: number
  rrShares: number
  rrCost: number
  rrValue: number
  rrLegs: { putCall: string; strike: number; quantity: number; markPrice: number; costBasis: number }[]
  category: 'stock' | 'crypto' | 'cash'
}

function buildRows(positions: RawPosition[], quotes: Record<string, number>): PortfolioRow[] {
  const stkMap = new Map<string, RawPosition>()
  const optMap = new Map<string, RawPosition[]>()
  for (const p of positions) {
    const under = p.underlyingSymbol ?? p.symbol
    if (p.assetClass === 'STK') stkMap.set(p.symbol, p)
    else if (p.assetClass === 'OPT') (optMap.get(under) ?? (optMap.set(under, []), optMap.get(under)!)).push(p)
  }

  return PORTFOLIO_TARGETS.map(t => {
    const pos = stkMap.get(t.ticker)
    const opts = optMap.get(t.ticker) ?? []
    const marketPrice = pos?.markPrice ?? quotes[t.ticker] ?? 0
    const athPct = t.ath > 0 ? (t.ath - marketPrice) / t.ath : 0
    const targetPct = marketPrice > 0 ? (t.priceTarget2026 - marketPrice) / marketPrice : 0
    const price2026 = t.priceTarget2026
    const price2027 = price2026 * (1 + t.cagr)
    const price2028 = price2027 * (1 + t.cagr)

    const isRR = t.rrContracts > 0
    const rrOpts = isRR ? opts : []

    const rrShares = t.rrContracts * 100
    const rrCost = rrOpts.reduce((s, o) => s + o.costBasisMoney, 0)
    const rrValue = rrOpts.reduce((s, o) => s + o.positionValue, 0)
    const rrLegs = rrOpts.map(o => ({
      putCall: o.putCall ?? '?',
      strike: o.strike ?? 0,
      quantity: o.quantity,
      markPrice: o.markPrice,
      costBasis: o.costBasisMoney,
    }))

    return {
      ticker: t.ticker,
      marketPrice,
      ath: t.ath,
      athPct,
      priceTarget2026: t.priceTarget2026,
      targetPct,
      atr1: t.atr1,
      atr2: t.atr2,
      cagr: t.cagr,
      price2026,
      price2027,
      price2028,
      targetShares: t.targetShares,
      targetAmount: t.targetShares * marketPrice,
      targetReqShares: t.targetReqShares,
      targetReqAmount: t.targetReqShares * marketPrice,
      sharesOwned: pos?.quantity ?? 0,
      costPrice: pos?.costBasisPrice ?? 0,
      currentValue: pos?.positionValue ?? 0,
      rrShares,
      rrCost,
      rrValue,
      rrLegs,
      category: t.category,
    }
  })
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const thStyle: React.CSSProperties = {
  padding: '6px 10px', fontSize: 10, fontWeight: 700,
  color: 'var(--text-3)', letterSpacing: '0.06em',
  whiteSpace: 'nowrap', textAlign: 'right',
  borderBottom: '1px solid var(--border)',
  background: 'var(--bg-elevated)',
  position: 'sticky', top: 23, zIndex: 4,
}

const sectionTh: React.CSSProperties = {
  padding: '4px 10px', fontSize: 10, fontWeight: 700,
  letterSpacing: '0.1em', textAlign: 'center',
  borderBottom: '1px solid var(--border)',
  background: 'var(--bg-card)',
  position: 'sticky', top: 0, zIndex: 5,
  pointerEvents: 'none',
}

const tdStyle: React.CSSProperties = {
  padding: '5px 10px', fontSize: 12,
  fontFamily: 'Share Tech Mono, monospace',
  textAlign: 'right', whiteSpace: 'nowrap',
  borderBottom: '1px solid var(--border-light)',
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function PortfolioView({ state }: { state: AppState }) {
  const { positions, cashBalance, netLiquidation: ibkrNetLiq } = state.sync
  const [quotes, setQuotes] = useState<Record<string, number>>({})

  useEffect(() => {
    const stkSymbols = new Set(positions.filter(p => p.assetClass === 'STK').map(p => p.symbol))
    const missing = PORTFOLIO_TARGETS
      .filter(t => !stkSymbols.has(t.ticker) && t.category !== 'cash')
      .map(t => t.ticker)
    if (missing.length === 0) return
    let cancelled = false
    const yahooSyms = missing.map(toYahoo)
    fetchQuotes(yahooSyms).then(yq => {
      if (cancelled) return
      const mapped: Record<string, number> = {}
      for (let i = 0; i < missing.length; i++) {
        const price = yq[yahooSyms[i]]
        if (price) mapped[missing[i]] = price
      }
      setQuotes(mapped)
    })
    return () => { cancelled = true }
  }, [positions])

  const rows = useMemo(() => buildRows(positions, quotes), [positions, quotes])

  const totalTargetAmt = rows.reduce((s, r) => s + r.targetAmount, 0) + CASH_TARGET
  const totalReqAmt = rows.reduce((s, r) => s + r.targetReqAmount, 0) + CASH_TARGET_1M
  const totalCurrentVal = rows.reduce((s, r) => s + r.currentValue + r.rrValue, 0) + cashBalance
  const netLiq = ibkrNetLiq ?? totalCurrentVal

  // Pie chart data
  const targetSlices = rows.filter(r => r.targetAmount > 0).map(r => ({ label: r.ticker, value: r.targetAmount }))
  targetSlices.push({ label: 'CASH', value: CASH_TARGET })

  const reqSlices = rows.filter(r => r.targetReqAmount > 0).map(r => ({ label: r.ticker, value: r.targetReqAmount }))
  reqSlices.push({ label: 'CASH', value: CASH_TARGET_1M })

  const currentSlices = rows.filter(r => r.currentValue > 0).map(r => ({ label: r.ticker, value: r.currentValue }))
  if (cashBalance > 0) currentSlices.push({ label: 'CASH', value: cashBalance })

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* ── Stats row ────────────────────────────────────────────────── */}
      <div className="portfolio-stats" style={{ display: 'flex', gap: 8, padding: '12px 16px', flexShrink: 0, borderBottom: '1px solid var(--border)' }}>
        {[
          { label: 'NET LIQUIDATION', value: fmt$(netLiq), color: 'var(--text-1)' },
          { label: 'TARGET PORTFOLIO', value: fmt$(totalTargetAmt), color: 'var(--text-2)' },
          { label: '$1M TARGET', value: fmt$(totalReqAmt), color: 'var(--text-2)' },
          { label: 'CURRENT VALUE', value: fmt$(totalCurrentVal), color: totalCurrentVal > 0 ? '#10b981' : 'var(--text-2)' },
          { label: 'CASH', value: fmt$(cashBalance), color: 'var(--text-1)' },
        ].map(({ label, value, color }) => (
          <div key={label} style={{
            flex: 1, background: 'var(--bg-card)', border: '1px solid var(--border)',
            borderRadius: 8, padding: '10px 16px',
          }}>
            <div style={{ fontSize: 10, color: 'var(--text-3)', letterSpacing: '0.1em', fontWeight: 700, marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'Share Tech Mono, monospace', color }}>{value}</div>
          </div>
        ))}
      </div>

      {/* ── Main content ─────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>

          {/* Table */}
          <div>
            <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: 12, minWidth: 1600 }}>
              <thead>
                {/* Section headers */}
                <tr>
                  <th style={{ ...sectionTh, borderRight: '1px solid var(--border)', color: '#3b82f6', textAlign: 'left', width: 60 }}>&nbsp;</th>
                  <th colSpan={10} style={{ ...sectionTh, color: '#3b82f6', borderRight: '2px solid var(--border)' }}>END PORTFOLIO GOAL</th>
                  <th colSpan={2} style={{ ...sectionTh, color: '#f59e0b', borderRight: '2px solid var(--border)' }}>$1M TARGET</th>
                  <th colSpan={6} style={{ ...sectionTh, color: '#10b981' }}>CURRENT PORTFOLIO</th>
                </tr>
                {/* Column headers */}
                <tr>
                  <th style={{ ...thStyle, textAlign: 'left', position: 'sticky', left: 0, zIndex: 6, background: 'var(--bg-elevated)', borderRight: '1px solid var(--border)' }}>TICKER</th>
                  <th style={thStyle}>MKT PRICE</th>
                  <th style={thStyle}>ATH</th>
                  <th style={thStyle}>ATR 1</th>
                  <th style={thStyle}>ATR 2</th>
                  <th style={thStyle}>CAGR</th>
                  <th style={thStyle}>2026</th>
                  <th style={thStyle}>2027</th>
                  <th style={thStyle}>2028</th>
                  <th style={thStyle}>SHARES</th>
                  <th style={{ ...thStyle, borderRight: '2px solid var(--border)' }}>TARGET AMT</th>
                  <th style={thStyle}>SHARES</th>
                  <th style={{ ...thStyle, borderRight: '2px solid var(--border)' }}>AMOUNT</th>
                  <th style={thStyle}>OWNED</th>
                  <th style={thStyle}>COST</th>
                  <th style={thStyle}>VALUE</th>
                  <th style={thStyle}>RR SHARES</th>
                  <th style={thStyle}>RR COST</th>
                  <th style={thStyle}>RR VALUE</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, idx) => {
                  const isCrypto = r.category === 'crypto'

                  return (
                    <tr key={r.ticker} style={{ background: idx % 2 ? 'var(--bg-surface)' : 'transparent' }}>
                      <td style={{
                        ...tdStyle, textAlign: 'left', fontWeight: 700, fontSize: 13,
                        color: isCrypto ? '#f59e0b' : 'var(--text-1)',
                        position: 'sticky', left: 0, zIndex: 3,
                        background: idx % 2 ? 'var(--bg-surface)' : 'var(--bg-card)',
                        borderRight: '1px solid var(--border)',
                      }}>
                        {r.ticker}
                      </td>
                      <td style={{ ...tdStyle, color: r.marketPrice > 0 ? 'var(--text-1)' : 'var(--text-4)' }}>
                        {r.marketPrice > 0 ? fmt$(r.marketPrice, 2) : '—'}
                      </td>
                      <td style={{ ...tdStyle, color: 'var(--text-2)' }}>{fmt$(r.ath, 2)}</td>
                      <td style={{ ...tdStyle, color: r.marketPrice > 0 && r.marketPrice <= r.atr1 ? '#10b981' : 'var(--text-3)' }}>
                        {fmt$(r.atr1, 2)}
                      </td>
                      <td style={{ ...tdStyle, color: r.marketPrice > 0 && r.marketPrice <= r.atr2 ? '#10b981' : 'var(--text-3)' }}>
                        {fmt$(r.atr2, 2)}
                      </td>
                      <td style={{ ...tdStyle, color: r.cagr >= 0 ? '#10b981' : '#f43f5e', fontWeight: 600 }}>
                        {(r.cagr * 100).toFixed(2)}%
                      </td>
                      <td style={{ ...tdStyle, color: 'var(--text-2)' }}>{fmt$(r.price2026, 2)}</td>
                      <td style={{ ...tdStyle, color: 'var(--text-2)' }}>{fmt$(r.price2027, 2)}</td>
                      <td style={{ ...tdStyle, color: 'var(--text-2)' }}>{fmt$(r.price2028, 2)}</td>
                      <td style={{ ...tdStyle, color: 'var(--text-1)' }}>{r.targetShares.toLocaleString()}</td>
                      <td style={{ ...tdStyle, color: 'var(--text-1)', borderRight: '2px solid var(--border)' }}>
                        {r.targetAmount > 0 ? fmt$(r.targetAmount) : '—'}
                      </td>
                      <td style={{ ...tdStyle, color: 'var(--text-1)' }}>
                        {typeof r.targetReqShares === 'number' && r.targetReqShares % 1 !== 0
                          ? r.targetReqShares.toFixed(1)
                          : r.targetReqShares.toLocaleString()}
                      </td>
                      <td style={{ ...tdStyle, color: 'var(--text-1)', borderRight: '2px solid var(--border)' }}>
                        {r.targetReqAmount > 0 ? fmt$(r.targetReqAmount) : '—'}
                      </td>
                      <td style={{ ...tdStyle, color: r.sharesOwned > 0 ? 'var(--text-1)' : 'var(--text-4)' }}>
                        {r.sharesOwned > 0 ? r.sharesOwned.toLocaleString() : '—'}
                      </td>
                      <td style={{ ...tdStyle, color: r.costPrice > 0 ? 'var(--text-2)' : 'var(--text-4)' }}>
                        {r.costPrice > 0 ? fmt$(r.costPrice, 2) : '—'}
                      </td>
                      <td style={{ ...tdStyle, color: r.currentValue > 0 ? '#10b981' : 'var(--text-4)', fontWeight: r.currentValue > 0 ? 600 : 400 }}>
                        {r.currentValue > 0 ? fmt$(r.currentValue) : '$0.00'}
                      </td>
                      <td style={{ ...tdStyle, color: r.rrShares > 0 ? 'var(--text-1)' : 'var(--text-4)' }}>
                        {r.rrShares > 0 ? r.rrShares.toLocaleString() : '—'}
                      </td>
                      <td style={{ ...tdStyle, color: r.rrCost !== 0 ? 'var(--text-2)' : 'var(--text-4)' }}
                        title={r.rrLegs.map(l => `${l.quantity > 0 ? 'Long' : 'Short'} ${l.putCall} ${l.strike}`).join('\n') || undefined}
                      >
                        {r.rrCost !== 0 ? fmt$(r.rrCost) : '—'}
                      </td>
                      <td style={{ ...tdStyle, color: r.rrValue > 0 ? '#10b981' : r.rrValue < 0 ? '#f43f5e' : 'var(--text-4)', fontWeight: r.rrValue !== 0 ? 600 : 400 }}>
                        {r.rrValue !== 0 ? fmt$(r.rrValue) : '—'}
                      </td>
                    </tr>
                  )
                })}
                {/* Cash row */}
                <tr style={{ background: rows.length % 2 ? 'var(--bg-surface)' : 'transparent' }}>
                  <td style={{
                    ...tdStyle, textAlign: 'left', fontWeight: 700, fontSize: 13, color: '#10b981',
                    position: 'sticky', left: 0, zIndex: 3,
                    background: rows.length % 2 ? 'var(--bg-surface)' : 'var(--bg-card)',
                    borderRight: '1px solid var(--border)',
                  }}>CASH</td>
                  {Array.from({ length: 9 }).map((_, i) => (
                    <td key={i} style={{ ...tdStyle, color: 'var(--text-4)' }}>&nbsp;</td>
                  ))}
                  <td style={{ ...tdStyle, color: 'var(--text-1)', borderRight: '2px solid var(--border)' }}>{fmt$(CASH_TARGET)}</td>
                  <td style={{ ...tdStyle, color: 'var(--text-4)' }}>&nbsp;</td>
                  <td style={{ ...tdStyle, color: 'var(--text-1)', borderRight: '2px solid var(--border)' }}>{fmt$(CASH_TARGET_1M)}</td>
                  <td style={{ ...tdStyle, color: 'var(--text-4)' }}>&nbsp;</td>
                  <td style={{ ...tdStyle, color: 'var(--text-4)' }}>&nbsp;</td>
                  <td style={{ ...tdStyle, color: cashBalance > 0 ? '#10b981' : 'var(--text-4)', fontWeight: cashBalance > 0 ? 600 : 400 }}>
                    {fmt$(cashBalance, 2)}
                  </td>
                  <td style={{ ...tdStyle, color: 'var(--text-4)' }}>&nbsp;</td>
                  <td style={{ ...tdStyle, color: 'var(--text-4)' }}>&nbsp;</td>
                  <td style={{ ...tdStyle, color: 'var(--text-4)' }}>&nbsp;</td>
                </tr>
                {/* Totals row */}
                {(() => {
                  const totalRRShares = rows.reduce((s, r) => s + r.rrShares, 0)
                  const totalRRCost = rows.reduce((s, r) => s + r.rrCost, 0)
                  const totalRRValue = rows.reduce((s, r) => s + r.rrValue, 0)
                  const bb = '2px solid var(--border)'
                  return (
                    <tr style={{ background: 'var(--bg-elevated)' }}>
                      <td style={{ ...tdStyle, textAlign: 'left', fontWeight: 700, fontSize: 13, color: 'var(--text-1)', position: 'sticky', left: 0, zIndex: 3, background: 'var(--bg-elevated)', borderRight: '1px solid var(--border)', borderBottom: bb }}>TOTAL</td>
                      {Array.from({ length: 9 }).map((_, i) => (
                        <td key={i} style={{ ...tdStyle, borderBottom: bb }}>&nbsp;</td>
                      ))}
                      <td style={{ ...tdStyle, fontWeight: 700, color: 'var(--text-1)', borderRight: bb, borderBottom: bb }}>{fmt$(totalTargetAmt)}</td>
                      <td style={{ ...tdStyle, borderBottom: bb }}>&nbsp;</td>
                      <td style={{ ...tdStyle, fontWeight: 700, color: 'var(--text-1)', borderRight: bb, borderBottom: bb }}>{fmt$(totalReqAmt)}</td>
                      <td style={{ ...tdStyle, borderBottom: bb }}>&nbsp;</td>
                      <td style={{ ...tdStyle, borderBottom: bb }}>&nbsp;</td>
                      <td style={{ ...tdStyle, fontWeight: 700, color: '#10b981', borderBottom: bb }}>{fmt$(totalCurrentVal)}</td>
                      <td style={{ ...tdStyle, fontWeight: 600, color: totalRRShares > 0 ? 'var(--text-1)' : 'var(--text-4)', borderBottom: bb }}>{totalRRShares > 0 ? totalRRShares.toLocaleString() : '—'}</td>
                      <td style={{ ...tdStyle, fontWeight: 600, color: totalRRCost !== 0 ? 'var(--text-2)' : 'var(--text-4)', borderBottom: bb }}>{totalRRCost !== 0 ? fmt$(totalRRCost) : '—'}</td>
                      <td style={{ ...tdStyle, fontWeight: 700, color: totalRRValue > 0 ? '#10b981' : totalRRValue < 0 ? '#f43f5e' : 'var(--text-4)', borderBottom: bb }}>{totalRRValue !== 0 ? fmt$(totalRRValue) : '—'}</td>
                    </tr>
                  )
                })()}
              </tbody>
            </table>
          </div>

          {/* Allocation + Pre-IPO row */}
          <div className="portfolio-bottom" style={{
            borderTop: '1px solid var(--border)',
            display: 'flex', gap: 32, padding: '16px 20px', background: 'var(--bg-card)',
          }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.08em', marginBottom: 10 }}>
                TARGET ALLOCATION
              </div>
              {ALLOCATION_TARGETS.map(a => (
                <div key={a.label} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <div style={{ width: 8, height: 8, borderRadius: 2, background: a.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)', minWidth: 120 }}>{a.label}</span>
                  <span style={{ fontSize: 12, fontFamily: 'Share Tech Mono, monospace', color: 'var(--text-1)', fontWeight: 700 }}>{a.pct}%</span>
                </div>
              ))}
            </div>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.08em', marginBottom: 10 }}>
                PRE-IPO WATCHLIST
              </div>
              {PRE_IPO_WATCHLIST.map(name => (
                <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--text-4)', flexShrink: 0 }} />
                  <span style={{ fontSize: 13, color: 'var(--text-2)', fontWeight: 500 }}>{name}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Pie charts row */}
          <div className="portfolio-pies" style={{
            borderTop: '1px solid var(--border)',
            display: 'flex', justifyContent: 'space-around', alignItems: 'center',
            padding: '20px 20px', background: 'var(--bg-card)', gap: 16,
          }}>
            <PieChart slices={targetSlices} title="TARGET PORTFOLIO" size={280} />
            <PieChart slices={reqSlices} title="$1M TARGET" size={280} />
            <PieChart slices={currentSlices} title="CURRENT PORTFOLIO" size={280} />
          </div>
      </div>
    </div>
  )
}
