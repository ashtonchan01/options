/**
 * Overview tab — the account's landing page. Key summary stats (moved here
 * from Journal Overview), the Flex Web Service sync + statement upload
 * controls (moved here from Reports), and a metrics/charts strip: the old
 * Journal KPI row (win rate, profit factor, avg win/loss, max drawdown,
 * streak, etc.), an equity curve beside monthly realized P&L, and the
 * Ideas, Puts, and Calls cards.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { AppState } from '../../types'
import type { Account } from '../../store/accountsStore'
import { buildJournalPositions, buildStockPositions, closedByDate, computeStats, openPremiumTotal, equityCurve, type EquityPoint } from '../../engine/journal'
import { PortfolioSummaryCard } from '../analytics/AnalyticsView'
import { fyOf } from '../companies/reportsShared'
import { resolvedNetLiquidation } from '../../income/incomeLive'
import AccountUploadBar from '../shared/AccountUploadBar'
import { CHART_THEME } from '../shared/chartTheme'
import FlexSyncBar from '../shared/FlexSyncBar'
import { useIncomePlan } from '../../store/incomePlanStore'
import PlanCards from './PlanCards'

function fmtDollar(n: number): string {
  const sign = n < 0 ? '-' : ''
  return `${sign}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

/** Rounds a positive value up to a "nice" number (1/2/5 x a power of ten) —
 * e.g. 17,798 -> 20,000, 64,104 -> 70,000 — so chart axes read like a human
 * picked the increments instead of whatever the data happened to compute to. */
function niceCeil(v: number): number {
  if (v <= 0) return 0
  const mag = 10 ** Math.floor(Math.log10(v))
  const norm = v / mag
  const niceNorm = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10
  return niceNorm * mag
}

/** Nice evenly-spaced axis ticks spanning at least [rawMin, rawMax] — same
 * "round numbers, not whatever the data computes to" idea as niceCeil, but
 * for a multi-tick axis (min isn't always 0, e.g. a curve that dipped
 * negative). Returns the tick values plus the (possibly widened) domain
 * they span, since the last tick can extend past the raw max. */
function niceAxisTicks(rawMin: number, rawMax: number, count = 5): { min: number; max: number; ticks: number[] } {
  if (rawMin === rawMax) { rawMin -= 1; rawMax += 1 }
  const rawStep = (rawMax - rawMin) / (count - 1)
  const mag = 10 ** Math.floor(Math.log10(rawStep))
  const norm = rawStep / mag
  const niceNorm = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10
  const step = niceNorm * mag
  const min = Math.floor(rawMin / step) * step
  // Round UP to the next step, not just "however many ticks the loop below
  // happens to reach" — the old approach (stop once a tick exceeds
  // rawMax + step/2) could stop one tick short of covering rawMax when the
  // actual max split awkwardly against `count`, leaving `max` SMALLER than
  // the real highest data value. Every y-scale here maps `max` to the very
  // top of the plot, so that undershoot rendered the equity curve's peak
  // above the plot's own top edge (verified: a curve whose last point was
  // $69,856 undershot to max=$60,000 with count=5, visibly overrunning the
  // chart's top border in production). Ceiling guarantees max >= rawMax.
  const max = Math.ceil(rawMax / step) * step
  const ticks: number[] = []
  for (let v = min; v <= max + 1e-9; v += step) ticks.push(v)
  return { min, max, ticks }
}

function useBox() {
  const ref = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const apply = () => {
      const r = el.getBoundingClientRect()
      const w = Math.round(r.width)
      const h = Math.round(r.height)
      setBox(prev => (prev.w === w && prev.h === h ? prev : { w, h }))
    }
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, box] as const
}

const textCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null

function textWidth(text: string, font: string): number {
  const ctx = textCanvas?.getContext('2d')
  if (!ctx) return text.length * 6.4
  ctx.font = font
  return ctx.measureText(text).width
}

/** Bar values are always vertical so a bar cannot cut through the digits.
 * Month labels stay at 45° while the slot still clears the next date, and
 * drop to 90° on a dense month set. */
function monthLabelLayout(slotPx: number): { angle: 45 | 90; font: number } {
  const diagonalOk = (font: number) => slotPx <= 0 || slotPx * Math.SQRT1_2 >= font + 3
  if (diagonalOk(11)) return { angle: 45, font: 11 }
  if (diagonalOk(10)) return { angle: 45, font: 10 }
  if (slotPx <= 0 || slotPx >= 13) return { angle: 90, font: 10 }
  if (slotPx >= 11) return { angle: 90, font: 9 }
  return { angle: 90, font: 8 }
}

/** IBKR dates come as raw "YYYYMMDD" — plain string slicing is enough, no Date parsing needed. */
function monthKey(dateStr: string): string {
  const d = /^\d{8}$/.test(dateStr) ? dateStr : dateStr.replace(/-/g, '')
  return /^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}` : ''
}
function fmtMonthShort(ym: string) {
  const [y, m] = ym.split('-')
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${MONTHS[parseInt(m, 10) - 1] ?? m} ${y.slice(2)}`
}
function fmtMonthFull(ym: string) {
  const [y, m] = ym.split('-')
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  return `${MONTHS[parseInt(m, 10) - 1] ?? ym} ${y}`
}

// Every label on every chart on this page (Equity Curve, Monthly P&L) is
// plain HTML overlaid on top of a text-free SVG (axis lines/bars/area only),
// positioned by percentage. An SVG <text> node's font-size is just another
// viewBox unit, so it scales up or down with however wide or tall the panel
// happens to render — which is exactly why the same nominal font size read
// as "too big" in one panel and "too small" in another once the charts
// stopped being a fixed size. HTML text ignores the SVG's viewBox entirely,
// so one fixed CSS font size actually looks the same size everywhere,
// regardless of how big any chart's panel grows.
// One single size for every label on every chart on this page — axis
// labels, bar/line values, month labels, all of it — matching the KPI
// strip's bold value spans directly above them, from CHART_THEME. Two different sizes (a smaller
// one for axis text) kept reading as "still too small" next to the KPI
// strip's uniform size, so there's just one constant now.
const AXIS_LABEL_SIZE = CHART_THEME.fontSize
const VALUE_LABEL_SIZE = CHART_THEME.fontSize

/** Realized P&L by close month, most recent 8 months — same bar-chart shape
 * as the old Monthly Cash Flow chart, but driven off actual closed-position
 * P&L (buildJournalPositions/buildStockPositions) rather than raw trade cash
 * flow, so it agrees with the Win Rate/Reports numbers next to it. */
function MonthlyPnlChart({ state, fy, onFyChange }: { state: AppState; fy: string; onFyChange: (fy: string) => void }) {
  const [plotRef, plot] = useBox()
  const closed = [
    ...buildJournalPositions(state.sync.trades, {}),
    ...buildStockPositions(state.sync.trades, {}, state.sync.positions),
  ].filter(p => p.status !== 'Active' && p.pnl != null && p.dateClosed)

  const byMonth = new Map<string, number>()
  for (const p of closed) {
    const key = monthKey(p.dateClosed!)
    if (!key) continue
    byMonth.set(key, (byMonth.get(key) ?? 0) + p.pnl!)
  }
  const fyOptions = [...new Map(closed.map(p => {
    const f = fyOf(p.dateClosed!)
    return [f.key, f] as const
  })).values()].sort((a, b) => a.startYear - b.startYear)

  const allRows = [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  // A specific FY always shows its full 12 months (Jul-Jun), zero-filled
  // where there's no closed trade that month, instead of only the months
  // that happen to have data — so the chart reads as "this FY's shape" at
  // a glance instead of silently compressing quiet months out of existence.
  const fySelected = fy !== 'all' ? fyOptions.find(o => o.key === fy) : undefined
  const rows = fy === 'all'
    ? allRows
    : fySelected
      ? Array.from({ length: 12 }, (_, i) => {
          const y = fySelected.startYear + (i < 6 ? 0 : 1)
          const m = ((i + 6) % 12) + 1
          const key = `${y}-${String(m).padStart(2, '0')}`
          return [key, byMonth.get(key) ?? 0] as const
        })
      : []
  if (rows.length === 0) return (
    <div className="db-empty-msg" style={{ minHeight: 140 }}>
      {closed.length === 0 ? 'No closed trades yet' : 'No closed trades in that financial year'}
    </div>
  )

  const monthLabels = rows.map(([key]) => fmtMonthShort(key))
  const monthTextW = Math.max(...monthLabels.map(label => textWidth(label, `400 11px ${CHART_THEME.fontFamily}`)), 1)
  // Symmetric ticks (-max, half, zero, half, max) so the bars scale against
  // a real axis instead of carrying a number on every bar.
  const maxAbs = niceCeil(Math.max(...rows.map(([, v]) => Math.abs(v)), 1))
  const yTicks = [-maxAbs, -maxAbs / 2, 0, maxAbs / 2, maxAbs]
  const yLabelW = Math.max(...yTicks.map(tick => textWidth(fmtDollar(tick), `400 ${AXIS_LABEL_SIZE}px ${CHART_THEME.fontFamily}`)))
  const leftPad = Math.max(58, Math.ceil(yLabelW + 14))
  const n = rows.length
  const slotBeforeRight = plot.w > 0 ? Math.max(1, (plot.w - leftPad - 8) / n) : 0
  let { angle: monthAngle, font: monthFont } = monthLabelLayout(slotBeforeRight)
  const monthReachFor = (angle: 45 | 90, font: number) => {
    const width = monthTextW * (font / 11)
    return angle === 90 ? font + 4 : width * Math.SQRT1_2 + 6
  }
  const inner = Math.max(0, plot.w - leftPad)
  const denom = 1 - 0.85 / n
  const rightFor = (reach: number) => {
    if (plot.w <= 0) return 8
    const raw = (reach - (0.85 * inner) / n) / denom
    return Math.max(8, Math.min(plot.w * 0.28, Math.ceil(raw)))
  }
  let rightPad = rightFor(monthReachFor(monthAngle, monthFont))
  const slot = plot.w > 0 ? Math.max(1, (plot.w - leftPad - rightPad) / n) : slotBeforeRight
  const tightened = monthLabelLayout(slot)
  if (tightened.angle !== monthAngle || tightened.font !== monthFont) {
    monthAngle = tightened.angle
    monthFont = tightened.font
    rightPad = rightFor(monthReachFor(monthAngle, monthFont))
  }
  const fittedMonthW = monthTextW * (monthFont / 11)
  const monthRoom = monthAngle === 90
    ? fittedMonthW + 8
    : (fittedMonthW + monthFont) * Math.SQRT1_2 + 10
  const topPad = 14
  let monthPad = monthRoom
  if (plot.h > 0 && topPad + monthPad > plot.h * 0.42) {
    monthPad = Math.max(28, plot.h * 0.42 - topPad)
  }

  const W = 100, H = 100
  const PL = plot.w > 0 ? (leftPad / plot.w) * 100 : 16
  const PR = plot.w > 0 ? (rightPad / plot.w) * 100 : 6
  const PT = plot.h > 0 ? (topPad / plot.h) * 100 : 8
  const monthU = plot.h > 0 ? (monthPad / plot.h) * 100 : 16
  const PB = monthU
  const yOf = (v: number) => PT + (1 - (v + maxAbs) / (maxAbs * 2)) * (H - PT - PB)
  const y0 = yOf(0)
  const bw = (W - PL - PR) / rows.length
  const total = rows.reduce((s, [, v]) => s + v, 0)
  const monthStyle: React.CSSProperties = {
    position: 'absolute',
    transform: monthAngle === 90 ? 'rotate(90deg)' : 'rotate(45deg)',
    transformOrigin: 'left top',
    fontSize: monthFont,
    fontWeight: 400,
    lineHeight: 1,
    color: 'var(--text-4)',
    whiteSpace: 'nowrap',
  }

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '0 4px 2px', fontFamily: CHART_THEME.fontFamily, flex: '0 0 auto', gap: 8 }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {[{ key: 'all', label: 'All' }, ...fyOptions.map(o => ({ key: o.key, label: o.label.replace('FY ', '') }))].map(o => (
            <button
              key={o.key}
              onClick={() => onFyChange(o.key)}
              style={{
                fontSize: AXIS_LABEL_SIZE, fontFamily: CHART_THEME.fontFamily, cursor: 'pointer',
                border: 'none', borderRadius: 4, padding: '2px 7px',
                background: fy === o.key ? 'var(--accent, #10b981)' : 'transparent',
                color: fy === o.key ? '#fff' : 'var(--text-4)',
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
        <span style={{ fontSize: VALUE_LABEL_SIZE, fontWeight: 700, color: total >= 0 ? '#10b981' : '#ef4444' }}>
          Net {total >= 0 ? '+' : ''}{fmtDollar(total)}
        </span>
      </div>
      <div ref={plotRef} className="ov-chart-plot" data-month-angle={monthAngle} style={{ position: 'relative', height: 256, flex: '0 0 auto', overflow: 'visible' }}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: '100%', display: 'block' }}>
          {yTicks.map(tick => (
            <line key={tick} x1={PL} x2={W - PR} y1={yOf(tick)} y2={yOf(tick)}
              stroke={tick === 0 ? 'var(--border-light)' : 'var(--border-light)'}
              strokeWidth={tick === 0 ? 0.35 : 0.15}
              strokeDasharray={tick === 0 ? undefined : '0.6,0.6'} />
          ))}
          {rows.map(([key, val], i) => {
            const yv = yOf(val)
            const top = Math.min(yv, y0)
            const bx = PL + i * bw + bw * 0.15
            return (
              <rect key={key} x={bx} y={top} width={bw * 0.7} height={Math.max(Math.abs(yv - y0), 0.3)} rx={0.3}
                fill={val >= 0 ? '#10b981' : '#ef4444'} opacity={0.85} vectorEffect="non-scaling-stroke">
                <title>{fmtMonthFull(key)}: {val >= 0 ? '+' : ''}{fmtDollar(val)}</title>
              </rect>
            )
          })}
        </svg>
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', fontFamily: CHART_THEME.fontFamily }}>
          {yTicks.map(tick => (
            <span key={tick} className="ov-y-tick" style={{ position: 'absolute', left: 4, top: `${(yOf(tick) / H) * 100}%`, transform: 'translateY(-50%)', fontSize: AXIS_LABEL_SIZE, color: 'var(--text-4)' }}>{fmtDollar(tick)}</span>
          ))}
          {rows.map(([key], i) => {
            const bx = PL + i * bw + bw * 0.15
            return (
              <span key={key} className="ov-bar-month" style={{
                ...monthStyle,
                left: `${(bx / W) * 100}%`,
                top: `${((H - monthU) / H) * 100}%`,
              }}>
                {monthLabels[i]}
              </span>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function pnlColor(n: number) { return n > 0 ? '#10b981' : n < 0 ? '#ef4444' : 'var(--text-4)' }

/** The old Journal Overview KPI row — Net P&L, Win Rate, Profit Factor, Avg
 * Win/Loss, Max Drawdown, Open Premium, Closed trade count, and current
 * Streak — restored here since it moved off the Journal tab. */
function KpiStrip({ state }: { state: AppState }) {
  const positions = useMemo(() => [
    ...buildJournalPositions(state.sync.trades, {}),
    ...buildStockPositions(state.sync.trades, {}, state.sync.positions),
  ], [state.sync.trades])
  const closed = useMemo(() => closedByDate(positions), [positions])
  const s = useMemo(() => computeStats(closed), [closed])
  const openPremium = useMemo(() => openPremiumTotal(positions), [positions])
  const pf = s.profitFactor === Infinity ? '∞' : s.profitFactor.toFixed(2)

  const stats = [
    { label: 'Net P&L',       value: fmtDollar(s.netPnl),       color: pnlColor(s.netPnl) },
    { label: 'Win Rate',      value: s.trades ? `${s.winRate.toFixed(0)}%` : '—',
      color: s.winRate >= 65 ? '#10b981' : s.winRate >= 50 ? '#f59e0b' : '#ef4444' },
    { label: 'Profit Factor', value: s.trades ? pf : '—', color: s.profitFactor >= 1.5 ? '#10b981' : s.profitFactor >= 1 ? '#f59e0b' : '#ef4444' },
    { label: 'Avg Win',       value: fmtDollar(s.avgWin),       color: '#10b981' },
    { label: 'Avg Loss',      value: fmtDollar(s.avgLoss),      color: '#ef4444' },
    { label: 'Max DD',        value: fmtDollar(-s.maxDrawdown), color: '#f59e0b' },
    { label: 'Open Premium',  value: fmtDollar(openPremium),    color: 'var(--text-1)' },
    { label: 'Closed',        value: String(s.trades),          color: 'var(--text-1)' },
    { label: 'Streak',        value: s.currentStreak === 0 ? '—' : `${s.currentStreak > 0 ? 'W' : 'L'}${Math.abs(s.currentStreak)}`, color: 'var(--text-1)' },
    { label: 'Total Fees',    value: fmtDollar(s.totalFees),     color: 'var(--text-2)' },
  ]

  return (
    <div className="jr-mini-strip">
      {stats.map(c => (
        <div key={c.label} className="jr-mini">
          <span className="label">{c.label}</span>
          <b style={{ fontSize: CHART_THEME.fontSize, color: c.color }}>{c.value}</b>
        </div>
      ))}
    </div>
  )
}

function fmtDateShort(s: string) {
  const iso = /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : s
  const d = new Date(iso)
  return isNaN(d.getTime()) ? s : d.toLocaleDateString('en-AU', { month: 'short', year: '2-digit' })
}

/** Cumulative realized P&L across every closed position, oldest to newest. */
function EquityChart({ points }: { points: EquityPoint[] }) {
  if (points.length < 2) {
    return <div className="db-empty-msg" style={{ minHeight: 140 }}>Need at least 2 closed trades to draw the curve</div>
  }
  // FY boundary labels get their own dedicated strip above the plot (see
  // FY_STRIP below) instead of sharing the plot's own top margin with the
  // $ axis labels — sharing that corner is what previously put "FY 2025/26"
  // and the top $ value almost exactly on top of each other.
  const FY_STRIP = 10
  const W = 100, H = 100 + FY_STRIP, PL = 8, PR = 1.5, PT = FY_STRIP + 4, PB = 12
  const rawMin = Math.min(0, ...points.map(p => p.equity))
  const rawMax = Math.max(1, ...points.map(p => p.equity))
  const { min, max, ticks: gridVals } = niceAxisTicks(rawMin, rawMax, 5)
  const x = (i: number) => PL + (i / (points.length - 1)) * (W - PL - PR)
  const y = (v: number) => PT + (1 - (v - min) / (max - min)) * (H - PT - PB)
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(2)},${y(p.equity).toFixed(2)}`).join(' ')
  const y0 = y(0)
  const area = `${line} L${x(points.length - 1).toFixed(2)},${y0.toFixed(2)} L${x(0).toFixed(2)},${y0.toFixed(2)} Z`
  const last = points[points.length - 1]
  const mid = points[Math.floor(points.length / 2)]

  // Financial-year boundaries — every point where the FY changes from the
  // previous one starts a new band, so multi-year curves read as distinct
  // FY segments (alternating shading) instead of one undifferentiated slope.
  const fyBoundaries = points.flatMap((p, i) => {
    if (i === 0) return [{ i, label: fyOf(p.date).label }]
    return fyOf(p.date).key !== fyOf(points[i - 1].date).key ? [{ i, label: fyOf(p.date).label }] : []
  })
  const fyBands = fyBoundaries.map((b, bi) => ({
    ...b,
    endI: bi + 1 < fyBoundaries.length ? fyBoundaries[bi + 1].i : points.length - 1,
  }))

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: '100%', display: 'block' }}>
        <defs>
          <linearGradient id="ov-eq-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#10b981" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#10b981" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {fyBands.map((b, bi) => (
          bi % 2 === 0 && (
            <rect key={b.i} x={x(b.i)} y={PT} width={Math.max(0, x(b.endI) - x(b.i))} height={H - PT - PB}
              fill="#f59e0b" opacity={0.05} />
          )
        ))}
        {gridVals.map((v, i) => (
          <line key={i} x1={PL} x2={W - PR} y1={y(v)} y2={y(v)} stroke="rgba(16,185,129,0.08)" strokeWidth="0.15" vectorEffect="non-scaling-stroke" />
        ))}
        {min < 0 && <line x1={PL} x2={W - PR} y1={y0} y2={y0} stroke="rgba(239,68,68,0.35)" strokeWidth="0.15" strokeDasharray="1.2 0.9" vectorEffect="non-scaling-stroke" />}
        {fyBands.filter(b => b.i > 0).map(b => (
          <line key={b.i} x1={x(b.i)} x2={x(b.i)} y1={PT} y2={H - PB} stroke="var(--text-4)" strokeWidth="0.25" strokeDasharray="0.8 0.8" vectorEffect="non-scaling-stroke" />
        ))}
        <path d={area} fill="url(#ov-eq-fill)" />
        <path d={line} fill="none" stroke="#10b981" strokeWidth="1" vectorEffect="non-scaling-stroke" style={{ filter: 'drop-shadow(0 0 6px rgba(16,185,129,0.45))' }} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', fontFamily: CHART_THEME.fontFamily }}>
        {gridVals.map((v, i) => (
          <span key={i} style={{ position: 'absolute', left: 6, top: `${(y(v) / H) * 100}%`, transform: 'translateY(-50%)', fontSize: AXIS_LABEL_SIZE, color: 'var(--text-4)' }}>
            {fmtDollar(v)}
          </span>
        ))}
        {/* Own dedicated strip at the very top (see FY_STRIP) — sharing the
            plot's own top margin with the $ axis labels previously put them
            almost exactly on top of each other in that corner. */}
        {fyBoundaries.map(b => (
          <span key={b.i} style={{
            position: 'absolute', left: `${(x(b.i) / W) * 100}%`, top: 0,
            transform: b.i === 0 ? 'translate(6px, 0)' : 'translate(-50%, 0)',
            fontSize: AXIS_LABEL_SIZE, fontWeight: 600, color: 'var(--text-4)', whiteSpace: 'nowrap',
          }}>
            {b.label}
          </span>
        ))}
        {/* Pinned to a fixed corner instead of tracking the curve's actual
            last point — anchoring it at the point itself clipped off-panel
            whenever the series ended near the very top or right edge. */}
        <span style={{ position: 'absolute', top: 18, right: 8, fontSize: VALUE_LABEL_SIZE, fontWeight: 700, color: '#10b981' }}>
          {fmtDollar(last.equity)}
        </span>
        {/* Dedupe by index — with few points (e.g. only 2-3 closed trades) the
            "middle" and/or first/last indices can coincide, which used to
            render the same date label twice on top of itself at the same x
            position. */}
        {[...new Map([
          [0, points[0]],
          [Math.floor(points.length / 2), mid],
          [points.length - 1, last],
        ]).entries()].map(([idx, p]) => (
          <span key={idx} style={{
            position: 'absolute', top: `${((H - PB + 3) / H) * 100}%`,
            left: idx === points.length - 1 ? undefined : idx === 0 ? undefined : `${(x(idx) / W) * 100}%`,
            right: idx === points.length - 1 ? 6 : undefined,
            transform: idx === points.length - 1 ? undefined : idx === 0 ? undefined : 'translate(-50%, 0)',
            marginLeft: idx === 0 ? 6 : undefined,
            fontSize: AXIS_LABEL_SIZE, color: 'var(--text-4)', whiteSpace: 'nowrap',
          }}>
            {fmtDateShort(p.date)}
          </span>
        ))}
      </div>
    </div>
  )
}

export default function OverviewView({ state, account, loading, error, syncNote, uploadError, onUpload, onClear, onSyncFlex, sessionKey }: {
  state: AppState
  account: Account
  loading: boolean
  error: string | null
  syncNote?: string | null
  uploadError?: string | null
  onUpload: (file: File) => void | Promise<void>
  onClear: () => void
  onSyncFlex: (token: string, queryId: string) => void
  sessionKey: string | null
}) {
  const hasData = state.sync.trades.length > 0
  const [monthlyFy, setMonthlyFy] = useState('all')
  const { settings } = useIncomePlan(sessionKey)

  return (
    <div className="jr-root ov-root" style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 8, padding: 0 }}>
      <div className="ov-top-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(240px, 0.78fr) minmax(0, 1.22fr)', gap: 8, alignItems: 'stretch', flex: '0 0 auto' }}>
        <div className="ov-import-stack">
          <FlexSyncBar
            savedToken={account.flexToken}
            savedQueryId={account.flexQueryId}
            loading={loading}
            error={error}
            note={syncNote}
            onSync={onSyncFlex}
          />
          <AccountUploadBar
            label={account.name}
            fileName={account.fileName}
            uploadedAt={account.uploadedAt}
            loading={loading}
            error={uploadError ?? null}
            onUpload={onUpload}
            onClear={onClear}
          />
        </div>
        {hasData && (
          <PortfolioSummaryCard
            state={state}
            netLiquidation={resolvedNetLiquidation(account)}
            excessLiquidity={account.excessLiquidity}
            elFloor={settings.elFloor}
          />
        )}
      </div>

      {!hasData ? (
        <div className="db-empty-msg" style={{ flex: 1 }}>
          No trade data — sync IBKR Flex or upload a statement to get started
        </div>
      ) : (
        <>
          <div style={{ flex: '0 0 auto' }}><KpiStrip state={state} /></div>
          {/* Plot sits between the old 190px and 260px heights. The Ideas /
              Puts / Calls row keeps whatever viewport is left. */}
          <div className="ov-charts-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, alignItems: 'stretch', flex: '0 0 auto' }}>
            <div className="dash-panel ov-equity-panel">
              <div className="dash-panel-header" style={{ flex: '0 0 auto' }}><span>Equity Curve</span></div>
              <div className="ov-equity-plot" style={{ height: 256, flex: '0 0 auto', display: 'flex', alignItems: 'stretch' }}>
                <EquityChart points={equityCurve(closedByDate([
                  ...buildJournalPositions(state.sync.trades, {}),
                  ...buildStockPositions(state.sync.trades, {}, state.sync.positions),
                ]))} />
              </div>
            </div>
            <div className="dash-panel ov-monthly-panel">
              <div className="dash-panel-header" style={{ flex: '0 0 auto' }}><span>Monthly Realised P&amp;L</span></div>
              <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'stretch' }}>
                <MonthlyPnlChart state={state} fy={monthlyFy} onFyChange={setMonthlyFy} />
              </div>
            </div>
          </div>
          <PlanCards account={account} settings={settings} />
        </>
      )}
    </div>
  )
}
