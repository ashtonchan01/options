/**
 * Wealth Timeline — projects a compounding target (default: $462,000 AUD
 * growing at 30%/yr) forward from TODAY, alongside the actual live net
 * worth summed across every account (IBKR netLiquidation, falling back to
 * cash + position values for a query that never enabled "Equity Summary in
 * Base"). Both the target curve and the Actual marker share the exact same
 * starting point — today, at t=0 — rather than one starting from a
 * financial-year boundary and the other from a live snapshot at some
 * offset into it. Reporting periods still run 1 Jul–30 Jun (the Australian
 * financial year), not calendar years or a rolling 12 months from today —
 * only the very first row is partial (today → the next 30 June), every row
 * after that is a full FY. Tax is paid once a year at each FY boundary —
 * only the after-tax remainder (start + net P&L) compounds into the next
 * year, not the full pre-tax gain — but the chart itself is drawn as one
 * smooth pre-tax reference curve (a visible sawtooth read as broken, not
 * informative). Every time the portfolio's Actual total changes
 * (a fresh IBKR sync), that day's figure is recorded to localStorage so the
 * Actual side grows into a real history line over time rather than staying
 * a single live point. A second curve, "your pace", compounds the start
 * capital at the annualised growth the synced accounts have actually
 * produced (IBKR's own net-liquidation history when a Flex sync stored it,
 * otherwise today's balance with each closed trade's profit and loss
 * stepped back through time) and is drawn next to that target. When there
 * isn't enough history for a meaningful rate, the pace curve uses the
 * target % and the page says so. Highlights the year each of A$1M/A$5M/A$10M
 * is first crossed on both curves, breaks each row down into the monthly
 * dollar return the target
 * implies, and shows the row's tax bill + after-tax profit at a flat
 * configurable rate.
 *
 * The target is modelled entirely in AUD (the config's own currency) since
 * that's the number the user actually typed in; the "Actual" figure is
 * summed straight off IBKR accounts, which are USD-denominated here. The
 * AUD/USD toggle only changes DISPLAY currency — it converts whichever of
 * the two isn't already in that currency, via a live AUDUSD=X quote, it
 * does not change what's stored.
 */
import { Fragment, useEffect, useMemo, useState } from 'react'
import type { Account } from '../../store/accountsStore'
import { fetchQuotes } from '../../services/quotes'
import { accountNetWorth, describePace, fmtPct, milestoneChartMarks, projectMilestone, resolvePace, type MilestoneChartMark } from './milestonePace'
import {
  addMonths,
  buildYears,
  loadMilestoneConfig,
  monthlyRate,
  MILESTONE_CONFIG_KEY,
  MILESTONE_START_MIGRATION_KEY,
  MILESTONES,
  ONE_YEAR_MS,
  type MilestoneConfig,
  type YearRow,
} from './milestoneYears'

const TARGET_COLOR = '#10b981'
const PACE_COLOR = '#f59e0b'
const ACTUAL_COLOR = '#38bdf8'

type Config = MilestoneConfig

const EXCLUDED_ACCOUNTS_KEY = 'options:milestone-excluded-accounts'

/** Which accounts are excluded from "Actual", from localStorage — or, on a
 * fresh load with no saved preference yet, any account that looks like a
 * non-IBKR broker (e.g. "Moomoo"), since the target/tax framework here is
 * built around the IBKR-denominated figure and a differently-currencied
 * account would silently skew the combined total. Purely a one-time
 * default — the chips let it be changed either way afterward. */
function loadExcludedAccounts(accounts: Account[]): Set<string> {
  try {
    const raw = localStorage.getItem(EXCLUDED_ACCOUNTS_KEY)
    if (raw) return new Set(JSON.parse(raw))
  } catch { /* fall through to the name-based default below */ }
  return new Set(accounts.filter(a => /moomoo/i.test(a.name)).map(a => a.id))
}

const HISTORY_KEY = 'options:milestone-actual-history'

/** One recorded "Actual" total (USD, across whichever accounts are
 * currently included) per calendar day — a real history to plot on the
 * chart, not just today's single snapshot, so the actual line grows every
 * time the portfolio is synced/updated instead of only ever showing one
 * point. Keyed by date so re-syncing the same day updates that day's
 * figure in place rather than piling up duplicate points. */
interface HistoryPoint { date: string; valueUsd: number }

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function loadHistory(): HistoryPoint[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function fmtMonthYear(d: Date): string {
  return `${MONTH_ABBR[d.getMonth()]} ${d.getFullYear()}`
}

function fmt$(n: number): string {
  const sign = n < 0 ? '-' : ''
  return `${sign}$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}

function fmtCompact(n: number): string {
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(0)}K`
  return `${sign}$${abs.toFixed(0)}`
}

// Chart viewBox/padding constants, shared with the Timeline strip below the
// chart so its cards line up under the chart's own x-axis instead of being
// an independently-spaced row that just happens to sit underneath it.
const CHART_W = 1800, CHART_PAD_L = 60, CHART_PAD_R = 24
const CHART_PAD_L_PCT = (CHART_PAD_L / CHART_W) * 100
const CHART_PAD_R_PCT = (CHART_PAD_R / CHART_W) * 100

/** Catmull-Rom-through-cubic-Bezier smoothing — turns a polyline of many
 * short straight segments (one per month, plus a sharp corner at every FY
 * boundary where tax drags the curve down) into one continuously smooth
 * curve. Segments with an identical x (the vertical tax-drop itself) are
 * left as straight lines — smoothing a vertical drop just softens it into
 * a diagonal, which reads as a mistake, not a curve. */
function smoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length < 2) return ''
  if (pts.length === 2) return `M${pts[0].x},${pts[0].y} L${pts[1].x},${pts[1].y}`
  let d = `M${pts[0].x},${pts[0].y}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2] ?? p2
    if (p1.x === p2.x) { d += ` L${p2.x},${p2.y}`; continue }
    const c1x = p1.x + (p2.x - p0.x) / 6
    const c1y = p1.y + (p2.y - p0.y) / 6
    const c2x = p2.x - (p3.x - p1.x) / 6
    const c2y = p2.y - (p3.y - p1.y) / 6
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`
  }
  return d
}

/** Measures a DOM node's real pixel content-box size via ResizeObserver — used
 * to size the chart's SVG viewBox to the container's actual rendered width
 * rather than a fixed assumption, so 1 viewBox unit is always 1 real pixel
 * on any screen (mobile included), not just whatever width the fixed
 * viewBox happened to be tuned for. */
function useElementSize<T extends HTMLElement>() {
  const ref = useState<T | null>(null)
  const [node, setNode] = ref
  const [size, setSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    if (!node) return
    // clientWidth/clientHeight, not contentBoxSize. Safari reports a 0
    // content-box height for a flex child that actually has a height, which
    // left the Milestone plot unmeasured and blank.
    const measure = () => setSize({ width: node.clientWidth, height: node.clientHeight })
    const ro = new ResizeObserver(measure)
    ro.observe(node)
    measure()
    return () => ro.disconnect()
  }, [node])
  return [setNode, size] as const
}

const ACCOUNT_COLORS = ['#38bdf8', '#f59e0b', '#a78bfa', '#f472b6', '#34d399', '#fb923c']

interface AccountActual { name: string; display: number }

function seriesValueAt(points: { t: number; value: number }[], t: number): number | null {
  if (points.length === 0) return null
  const sorted = [...points].sort((a, b) => a.t - b.t)
  if (t < sorted[0].t - 1e-6 || t > sorted[sorted.length - 1].t + 1e-6) return null
  if (sorted.length === 1) return Math.abs(sorted[0].t - t) <= 0.05 ? sorted[0].value : null
  for (let i = 1; i < sorted.length; i++) {
    const left = sorted[i - 1]
    const right = sorted[i]
    if (t <= right.t + 1e-9) {
      const span = right.t - left.t
      const u = span === 0 ? 0 : (t - left.t) / span
      return left.value + (right.value - left.value) * u
    }
  }
  return sorted[sorted.length - 1].value
}

/** Horizontal timeline: monthly-resolution target curve on a log-value
 * y-axis (compounding growth would otherwise squash the early, still-small
 * years down near zero pixels next to an $11M+ later year on a linear
 * scale) starting at t=0 = today, with the actual net-worth-today figure
 * plotted at that exact same t=0 — both the combined total across every
 * account, and each account's own figure as its own marker so e.g.
 * Personal and Business stay visually distinguishable instead of only ever
 * appearing pre-summed. */
function TimelineChart({ cfg, r, paceMonthly, toDisplayFromAud, actualDisplay, accountActuals, history, actualPath, years, marks, currency }: {
  cfg: Config; r: number; paceMonthly: number; toDisplayFromAud: (v: number) => number
  currency: 'AUD' | 'USD'
  actualDisplay: number; accountActuals: AccountActual[]
  /** Recorded past "Actual" points, in chart-years-from-today (negative =
   * past) and already display-currency-converted. Used only when the
   * account history didn't produce its own path. */
  history: { t: number; value: number }[]
  /** Real account value over time, same units as `history`. Preferred. */
  actualPath: { t: number; value: number }[]
  years: YearRow[]
  /** A$1M / A$5M / A$10M crossings for the target and pace curves. */
  marks: MilestoneChartMark[]
}) {
  const [setNode, measured] = useElementSize<HTMLDivElement>()
  const [hover, setHover] = useState<{ x: number; tYears: number } | null>(null)
  const past = (actualPath.length > 1 ? actualPath : history).filter(p => p.value > 0)

  // Drawn as one continuous exponential from today at the target rate.
  // Charting the annual tax drag produced a sawtooth that read as jagged
  // rather than informative. This line is the smooth "if nothing were ever taxed"
  // reference curve. The amber pace line is the same shape at the rate the accounts have
  // actually achieved (or the target rate, when that rate isn't knowable).
  const totalMonths = years[years.length - 1]?.tEnd ?? cfg.numYears * 12
  const paceFactor = 1 + paceMonthly
  const paceDrawable = paceFactor > 0 && Number.isFinite(paceFactor)
  const points = useMemo(() => {
    const pts: { t: number; value: number }[] = []
    for (let t = 0; t <= totalMonths; t++) {
      pts.push({ t, value: toDisplayFromAud(cfg.startCapital * Math.pow(1 + r, t)) })
    }
    return pts
  }, [totalMonths, r, cfg.startCapital, toDisplayFromAud])
  const pacePoints = useMemo(() => {
    if (!paceDrawable) return []
    const pts: { t: number; value: number }[] = []
    for (let t = 0; t <= totalMonths; t++) {
      pts.push({ t, value: toDisplayFromAud(cfg.startCapital * Math.pow(paceFactor, t)) })
    }
    return pts
  }, [totalMonths, paceDrawable, paceFactor, cfg.startCapital, toDisplayFromAud])

  // viewBox width is the container's own measured pixel width (not a fixed
  // assumption) — text/dot sizes are defined in user-space units that scale
  // with whatever the browser stretches the viewBox to, so a viewBox tuned
  // for one screen size renders wrong on any other (this is what made
  // "Actual $269K" render nearly 2x its authored size on desktop before,
  // and would make every label unreadably tiny on a phone-width container).
  // Measuring the real box keeps 1 viewBox unit = 1 real pixel everywhere.
  const W = measured.width
  const H = measured.height
  const padL = Math.max(62, W * (CHART_PAD_L_PCT / 100)), padR = W * (CHART_PAD_R_PCT / 100)
  const padT = 28

  // Not measured yet (first render, before the ResizeObserver reports back)
  // — render just the (ref-carrying) box so it can actually be measured,
  // rather than dividing by a zero width below.
  if (W < 20 || H < 40) return <div ref={setNode} className="ms-chart-fill" />

  // The x-axis normally starts at t=0 (today) — a recorded history stretches
  // it a bit to the left so past readings have somewhere to sit instead of
  // being clipped off before the chart even begins.
  const rawMinYears = Math.min(0, ...past.map(h => h.t))
  const domainMinYears = rawMinYears < 0 ? rawMinYears - 0.2 : rawMinYears

  const finiteValues = [
    ...points.map(p => p.value), ...pacePoints.map(p => p.value),
    actualDisplay, ...accountActuals.map(a => a.display),
    ...past.map(h => h.value),
  ].filter(v => Number.isFinite(v) && v > 0)
  const minV = Math.min(toDisplayFromAud(cfg.startCapital * 0.5), ...finiteValues)
  const maxV = Math.max(...finiteValues) * 1.08
  const logMin = Math.log10(Math.max(1, minV))
  const logMax = Math.log10(Math.max(10, maxV))

  const axisToday = years[0]?.startDate ?? new Date()
  const yearTicks: { t: number; label: string }[] = []
  const pastYears = Math.max(0, Math.ceil(-domainMinYears))
  for (let i = -pastYears; i <= cfg.numYears; i++) {
    if (i < domainMinYears - 0.05) continue
    const when = new Date(axisToday.getTime() + i * ONE_YEAR_MS)
    yearTicks.push({ t: i, label: String(when.getFullYear()) })
  }
  const yearSlot = yearTicks.length > 1 ? (W - padL - padR) / (yearTicks.length - 1) : W
  const yearVertical = yearSlot < 36
  const padB = yearVertical ? 56 : 40
  const plotH = Math.max(40, H - padT - padB)
  const plotW = W - padL - padR

  const domainYears = cfg.numYears - domainMinYears
  const x = (tYears: number) => padL + ((tYears - domainMinYears) / domainYears) * plotW
  const y = (v: number) => padT + plotH - ((Math.log10(Math.max(1, v)) - logMin) / (logMax - logMin)) * plotH

  const millionTicks: { value: number; label: string; yy: number; showLabel: boolean }[] = []
  const firstMillion = Math.max(1, Math.ceil(minV / 1_000_000))
  const lastMillion = Math.floor(maxV / 1_000_000)
  let lastLabelY = Infinity
  for (let n = firstMillion; n <= lastMillion; n++) {
    const value = n * 1_000_000
    const yy = y(value)
    if (yy < padT - 1 || yy > padT + plotH + 1) continue
    const showLabel = Math.abs(yy - lastLabelY) >= 9
    if (showLabel) lastLabelY = yy
    millionTicks.push({ value, label: `${n}M`, yy, showLabel })
  }

  const linePath = smoothPath(points.map(p => ({ x: x(p.t / 12), y: y(p.value) })))
  const pacePath = smoothPath(pacePoints.map(p => ({ x: x(p.t / 12), y: y(p.value) })))
  const pastPath = past.length > 1
    ? smoothPath(past.map(h => ({ x: x(h.t), y: y(h.value) })))
    : null
  const pastDots = past.length <= 24 ? past : [past[0], past[past.length - 1]].filter(Boolean)

  const milestoneLines = MILESTONES
    .map(m => ({ ...m, display: toDisplayFromAud(m.value) }))
    .filter(m => m.display >= minV && m.display <= maxV)

  const actualLabelRight = x(0) < W - 200

  // Today's markers (Combined + each account) can land within a few pixels
  // of each other's y whenever their dollar values are close — text at a
  // fixed offset from each dot then overlaps illegibly. Laying every
  // label's y out in one pass, sorted top-to-bottom with a minimum gap
  // enforced between consecutive labels, keeps them readable regardless of
  // how close together the underlying values are; each label still draws a
  // thin leader line back to its own dot so it's still clear which is which
  // once they've been pushed apart.
  const showCombined = accountActuals.length > 1
  const labelDefs = [
    ...(showCombined ? [{ key: 'combined', dotY: y(actualDisplay), text: `Combined ${fmtCompact(actualDisplay)}`, color: 'var(--text-1)', weight: 700 }] : []),
    ...accountActuals.map((a, i) => ({
      key: a.name, dotY: y(a.display), text: `${a.name} ${fmtCompact(a.display)}`,
      color: ACCOUNT_COLORS[i % ACCOUNT_COLORS.length], weight: 600,
    })),
  ].sort((a, b) => a.dotY - b.dotY)
  const MIN_LABEL_GAP = 14
  let prevLabelY = -Infinity
  const labels = labelDefs.map(l => {
    const labelY = Math.max(l.dotY - 6, prevLabelY + MIN_LABEL_GAP)
    prevLabelY = labelY
    return { ...l, labelY }
  })

  // Each mark sits on the curve where that series crosses the AUD level.
  // Labels prefer a spot just above the dot; pace and target on the same
  // level, and any label that would cover another, take the next free slot.
  const markGlyph = 5.2
  const markDots = marks.map(mark => {
    const cx = x(mark.years)
    const cy = y(toDisplayFromAud(mark.aud))
    return { ...mark, cx, cy, w: mark.text.length * markGlyph + 8 }
  }).filter(mark => mark.cx >= padL - 1 && mark.cx <= W - padR + 1 && mark.cy >= padT - 1 && mark.cy <= padT + plotH + 1)
  type MarkBox = { l: number; r: number; t: number; b: number }
  const overlaps = (a: MarkBox, b: MarkBox) => a.l < b.r - 1 && a.r > b.l + 1 && a.t < b.b - 1 && a.b > b.t + 1
  const obstacles: MarkBox[] = [
    ...milestoneLines.map(level => ({
      l: padL + 2,
      r: padL + 6 + level.label.length * markGlyph,
      t: y(level.display) - 13,
      b: y(level.display) + 2,
    })),
    ...labels.map(l => {
      const textW = l.text.length * 5.3 + 6
      const rectX = actualLabelRight ? x(0) + 3 : x(0) - 9 - (l.text.length * 5.3)
      return { l: rectX, r: rectX + textW, t: l.labelY - 9, b: l.labelY + 3 }
    }),
  ]
  const placedMarks: { mark: typeof markDots[number]; lx: number; ly: number; anchor: 'start' | 'middle' | 'end' }[] = []
  const taken: MarkBox[] = [...obstacles]
  for (const mark of [...markDots].sort((a, b) => a.cy - b.cy || a.cx - b.cx)) {
    const slots = [-16, -28, 18, 30, -40, 42]
    let chosen: { lx: number; ly: number; anchor: 'start' | 'middle' | 'end'; box: MarkBox } | null = null
    let fallback: { lx: number; ly: number; anchor: 'start' | 'middle' | 'end'; box: MarkBox } | null = null
    for (const dy of slots) {
      let anchor: 'start' | 'middle' | 'end' = 'middle'
      let lx = mark.cx
      if (mark.cx - mark.w / 2 < padL + 2) { anchor = 'start'; lx = mark.cx + 7 }
      else if (mark.cx + mark.w / 2 > W - padR - 2) { anchor = 'end'; lx = mark.cx - 7 }
      const top = mark.cy + dy - 8
      const box: MarkBox = anchor === 'start'
        ? { l: lx, r: lx + mark.w, t: top, b: top + 12 }
        : anchor === 'end'
          ? { l: lx - mark.w, r: lx, t: top, b: top + 12 }
          : { l: lx - mark.w / 2, r: lx + mark.w / 2, t: top, b: top + 12 }
      if (box.t < 1 || box.b > H - 18 || box.l < 1 || box.r > W - 1) continue
      const slot = { lx, ly: mark.cy + dy, anchor, box }
      fallback ??= slot
      if (taken.some(box2 => overlaps(box, box2))) continue
      chosen = slot
      break
    }
    const used = chosen ?? fallback ?? { lx: mark.cx, ly: Math.max(12, mark.cy - 16), anchor: 'middle' as const, box: { l: mark.cx - mark.w / 2, r: mark.cx + mark.w / 2, t: mark.cy - 24, b: mark.cy - 12 } }
    taken.push(used.box)
    placedMarks.push({ mark, lx: used.lx, ly: used.ly, anchor: used.anchor })
  }

  const forecastEnd = totalMonths / 12
  const inForecast = hover != null && hover.tYears >= 0 && hover.tYears <= forecastEnd + 0.001
  const actualSeries = [...past]
  if (actualDisplay > 0 && !actualSeries.some(point => Math.abs(point.t) < 0.01)) {
    actualSeries.push({ t: 0, value: actualDisplay })
  }
  const hoverRows = hover == null ? [] : [
    inForecast ? { name: 'Target', color: TARGET_COLOR, value: toDisplayFromAud(cfg.startCapital * Math.pow(1 + r, hover.tYears * 12)) } : null,
    inForecast && paceDrawable ? { name: 'Pace', color: PACE_COLOR, value: toDisplayFromAud(cfg.startCapital * Math.pow(paceFactor, hover.tYears * 12)) } : null,
    (() => {
      const actual = seriesValueAt(actualSeries, hover.tYears)
      return actual == null ? null : { name: 'Actual', color: ACTUAL_COLOR, value: actual }
    })(),
  ].flatMap(row => row ? [row] : [])
  const hoverDots = hoverRows
  const hoverWhen = hover == null ? null : new Date(axisToday.getTime() + hover.tYears * ONE_YEAR_MS)
  const hoverTip = hover && hoverWhen && hoverRows.length > 0 ? {
    date: `${MONTH_ABBR[hoverWhen.getMonth()]} ${hoverWhen.getDate()}, ${hoverWhen.getFullYear()}`,
    rows: hoverRows.map(row => ({ ...row, value: fmt$(row.value) })),
    left: hover.x + 14,
    flip: hover.x > W - 180,
  } : null

  return (
    <div ref={setNode} className="ms-chart-fill">
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: '100%', display: 'block' }}>
      {milestoneLines.map(m => (
        <g key={m.label}>
          <line x1={padL} x2={W - padR} y1={y(m.display)} y2={y(m.display)}
            stroke="var(--text-3)" strokeDasharray="3,3" strokeWidth={1} />
          <text x={padL + 4} y={y(m.display) - 4} fontSize={9} fill="var(--text-4)" fontFamily="JetBrains Mono, monospace">
            {m.label}
          </text>
        </g>
      ))}

      <line x1={padL} x2={padL} y1={padT} y2={padT + plotH} stroke="var(--border)" strokeWidth={1} />
      <line x1={padL} x2={W - padR} y1={padT + plotH} y2={padT + plotH} stroke="var(--border)" strokeWidth={1} />
      {millionTicks.map(tick => (
        <g key={tick.label} data-testid="y-million" data-labeled={tick.showLabel ? '1' : '0'}>
          <line x1={padL - 4} x2={padL} y1={tick.yy} y2={tick.yy} stroke="var(--text-4)" strokeWidth={1} />
          {tick.showLabel && (
            <text x={padL - 6} y={tick.yy + 3} fontSize={9} fill="var(--text-4)" textAnchor="end" fontFamily="JetBrains Mono, monospace">{tick.label}</text>
          )}
        </g>
      ))}
      <text
        x={13}
        y={padT + plotH / 2}
        fontSize={11}
        fill="var(--text-3)"
        textAnchor="middle"
        fontFamily="Inter, sans-serif"
        transform={`rotate(-90 13 ${padT + plotH / 2})`}
      >
        {`Net worth (${currency})`}
      </text>
      {markDots.map(mark => {
        const nearOther = markDots.some(other => other.series !== mark.series && Math.abs(other.cx - mark.cx) < 28)
        const color = mark.series === 'target' ? TARGET_COLOR : PACE_COLOR
        return (
          <line
            key={`guide-${mark.id}`}
            data-testid="milestone-guide"
            data-series={mark.series}
            x1={mark.cx}
            x2={mark.cx}
            y1={mark.cy}
            y2={padT + plotH}
            stroke={color}
            strokeOpacity={0.45}
            strokeWidth={1}
            strokeDasharray={mark.series === 'pace' && nearOther ? '2,3' : undefined}
            vectorEffect="non-scaling-stroke"
          />
        )
      })}

      {pastPath && <path d={pastPath} fill="none" stroke={ACTUAL_COLOR} strokeWidth={2.25} vectorEffect="non-scaling-stroke" />}
      {pastDots.map(h => (
        <circle key={`${h.t}-${h.value}`} cx={x(h.t)} cy={y(h.value)} r={1.6} fill={ACTUAL_COLOR} />
      ))}

      <path d={pacePath} fill="none" stroke={PACE_COLOR} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      <path d={linePath} fill="none" stroke={TARGET_COLOR} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />

      {[0, ...years.map(row => row.tEnd)].map(t => (
        <circle key={t} cx={x(t / 12)} cy={y(toDisplayFromAud(cfg.startCapital * Math.pow(1 + r, t)))} r={1.8} fill={TARGET_COLOR} />
      ))}

      {showCombined && <circle cx={x(0)} cy={y(actualDisplay)} r={3.2} fill="#e5e7eb" stroke="var(--bg-card)" strokeWidth={1} />}
      {accountActuals.map((a, i) => (
        <circle key={a.name} cx={x(0)} cy={y(a.display)} r={3} fill={ACCOUNT_COLORS[i % ACCOUNT_COLORS.length]} stroke="var(--bg-card)" strokeWidth={1} />
      ))}

      {[...placedMarks].sort((a, b) => Number(a.mark.series === 'target') - Number(b.mark.series === 'target')).map(({ mark, lx, ly, anchor }) => {
        const stacked = markDots.some(other => other.id !== mark.id && Math.hypot(other.cx - mark.cx, other.cy - mark.cy) < 8)
        const radius = !stacked ? 3.6 : mark.series === 'pace' ? 5.2 : 2.8
        return (
          <g key={mark.id} data-testid="milestone-mark" data-series={mark.series} data-aud={mark.aud}>
            <circle cx={mark.cx} cy={mark.cy} r={radius} fill={mark.series === 'target' ? TARGET_COLOR : PACE_COLOR} stroke="var(--bg-card)" strokeWidth={1.25} />
            <rect
              x={anchor === 'start' ? lx - 2 : anchor === 'end' ? lx - mark.w + 2 : lx - mark.w / 2}
              y={ly - 9}
              width={mark.w}
              height={12}
              rx={2}
              fill="var(--bg-card)"
              fillOpacity={0.92}
            />
            <text x={lx} y={ly} fontSize={10} fontWeight={700} fill={mark.series === 'target' ? TARGET_COLOR : PACE_COLOR}
              textAnchor={anchor} fontFamily="Inter, sans-serif">
              {mark.text}
              <title>{mark.title}</title>
            </text>
          </g>
        )
      })}

      {labels.map(l => {
        // Approximate monospace glyph width to lay down an opaque backing
        // rect behind each label — the target curve and its dots pass
        // directly through this area near x=0, and without a backing the
        // sloped line reads as a strikethrough cutting across the text.
        const textW = l.text.length * 5.3
        const rectX = actualLabelRight ? x(0) + 3 : x(0) - 9 - textW
        return (
          <g key={l.key}>
            <rect x={rectX} y={l.labelY - 8} width={textW + 6} height={10} fill="var(--bg-card)" />
            {Math.abs(l.labelY - (l.dotY - 6)) > 0.5 && (
              <line x1={x(0)} y1={l.dotY} x2={x(0) + (actualLabelRight ? 4 : -4)} y2={l.labelY + 2}
                stroke={l.color} strokeOpacity={0.4} strokeWidth={0.75} />
            )}
            <text x={x(0) + (actualLabelRight ? 6 : -6)} y={l.labelY} fontSize={9} fontWeight={l.weight} fill={l.color}
              textAnchor={actualLabelRight ? 'start' : 'end'} fontFamily="JetBrains Mono, monospace">
              {l.text}
            </text>
          </g>
        )
      })}

      {yearTicks.map(tick => {
        const tx = x(tick.t)
        if (yearVertical) {
          return (
            <text key={tick.t} data-testid="x-year" x={tx} y={padT + plotH + 4} fontSize={9} fill="var(--text-4)" textAnchor="start" fontFamily="Inter, sans-serif" transform={`rotate(90 ${tx} ${padT + plotH + 4})`}>
              {tick.label}
            </text>
          )
        }
        const anchor = tx < padL + 18 ? 'start' : tx > W - padR - 18 ? 'end' : 'middle'
        return (
          <text key={tick.t} data-testid="x-year" x={tx} y={padT + plotH + 14} fontSize={9} fill="var(--text-4)" textAnchor={anchor} fontFamily="Inter, sans-serif">
            {tick.label}
          </text>
        )
      })}
      <text x={(padL + W - padR) / 2} y={H - 6} fontSize={11} fill="var(--text-3)" textAnchor="middle" fontFamily="Inter, sans-serif">
        Year
      </text>
      {hover && (
        <g data-testid="milestone-crosshair" pointerEvents="none">
          <line x1={hover.x} x2={hover.x} y1={padT} y2={padT + plotH} stroke="var(--text-3)" strokeWidth={1} />
          {hoverDots.map(dot => (
            <circle key={dot.name} cx={hover.x} cy={y(dot.value)} r={3.4} fill={dot.color} stroke="var(--bg-card)" strokeWidth={1} />
          ))}
        </g>
      )}
      <rect
        x={padL}
        y={padT}
        width={plotW}
        height={plotH}
        fill="transparent"
        style={{ cursor: 'crosshair' }}
        onMouseMove={e => {
          const svg = e.currentTarget.ownerSVGElement
          if (!svg) return
          const rect = svg.getBoundingClientRect()
          const px = ((e.clientX - rect.left) / rect.width) * W
          if (px < padL || px > W - padR) { setHover(null); return }
          const tYears = domainMinYears + ((px - padL) / plotW) * domainYears
          setHover({ x: px, tYears })
        }}
        onMouseLeave={() => setHover(null)}
      />
    </svg>
    {hoverTip && (
      <div
        className="ms-chart-tip"
        data-testid="milestone-tooltip"
        style={{ left: hoverTip.left, top: 8, transform: hoverTip.flip ? 'translateX(-100%)' : undefined }}
      >
        <div className="ms-chart-tip-date">{hoverTip.date}</div>
        {hoverTip.rows.map(row => (
          <div key={row.name} className="ms-chart-tip-row">
            <span style={{ color: row.color }}>{row.name}</span>
            <b>{row.value}</b>
          </div>
        ))}
      </div>
    )}
    </div>
  )
}

export default function MilestoneView({ accounts }: { accounts: Account[] }) {
  const [cfg, setCfg] = useState<Config>(loadMilestoneConfig)
  // Defaults to USD, not AUD — the IBKR accounts that feed "Actual" are
  // USD-denominated, so USD is the currency their real numbers need no FX
  // round-trip to display in; AUD is only the currency the target/start
  // capital was configured in.
  const [currency, setCurrency] = useState<'AUD' | 'USD'>('USD')
  const [pane, setPane] = useState<'chart' | 'table'>('chart')
  const [expandedYear, setExpandedYear] = useState<number | null>(null)
  const [audUsd, setAudUsd] = useState<number | null>(null)
  // Which accounts to leave OUT of "Actual" — e.g. a broker whose synced
  // balance isn't trustworthy/relevant yet. Defaults to none excluded;
  // toggled per-account via the chips below and remembered across reloads.
  const [excludedAccounts, setExcludedAccounts] = useState<Set<string>>(() => loadExcludedAccounts(accounts))

  // Pinned once per mount — recomputing on every render would slowly drift
  // the chart/table's t=0 forward as the page sits open, misaligning the
  // "today" tick label from the actual data underneath it.
  const [today] = useState(() => new Date())

  const [history, setHistory] = useState<HistoryPoint[]>(loadHistory)

  useEffect(() => {
    localStorage.setItem(MILESTONE_CONFIG_KEY, JSON.stringify(cfg))
    // Record that this browser has loaded the 462,000 default (or kept a
    // custom start). Done here, not in loadMilestoneConfig, so the read stays pure
    // under Strict Mode's double-invoked state initializer.
    localStorage.setItem(MILESTONE_START_MIGRATION_KEY, '1')
  }, [cfg])

  useEffect(() => {
    localStorage.setItem(EXCLUDED_ACCOUNTS_KEY, JSON.stringify([...excludedAccounts]))
  }, [excludedAccounts])

  function toggleAccount(id: string) {
    setExcludedAccounts(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const includedAccounts = accounts.filter(a => !excludedAccounts.has(a.id))

  useEffect(() => {
    let cancelled = false
    fetchQuotes(['AUDUSD=X']).then(quotes => {
      if (!cancelled && quotes['AUDUSD=X']?.price) setAudUsd(quotes['AUDUSD=X'].price)
    })
    return () => { cancelled = true }
  }, [])

  const rate = audUsd ?? 0.65

  // Target is modelled in AUD; Actual is summed straight off USD-denominated
  // IBKR accounts. Convert whichever one isn't already in the selected
  // display currency.
  const toDisplayFromAud = (v: number) => currency === 'AUD' ? v : v * rate
  const toDisplayFromUsd = (v: number) => currency === 'USD' ? v : v / rate

  const years = useMemo(() => buildYears(cfg, today), [cfg, today])
  const r = monthlyRate(cfg.targetPct)
  const pace = useMemo(
    () => resolvePace(accounts.filter(a => !excludedAccounts.has(a.id)), today, cfg.targetPct),
    [accounts, excludedAccounts, today, cfg.targetPct],
  )
  const paceMonthly = pace.usingTarget ? r : Math.pow(1 + pace.pacePct / 100, 1 / 12) - 1
  const chartMarks = useMemo(() => milestoneChartMarks({
    startCapital: cfg.startCapital,
    targetAnnual: cfg.targetPct / 100,
    paceAnnual: (pace.usingTarget ? cfg.targetPct : pace.pacePct) / 100,
    numYears: cfg.numYears,
    today,
    milestones: MILESTONES,
  }), [cfg.startCapital, cfg.targetPct, cfg.numYears, pace.usingTarget, pace.pacePct, today])
  const paceNote = describePace(pace, {
    startCapital: cfg.startCapital,
    startMonthLabel: fmtMonthYear(today),
    targetPct: cfg.targetPct,
  })

  const actualNetWorthUsd = useMemo(
    () => includedAccounts.reduce((s, a) => s + accountNetWorth(a), 0),
    [includedAccounts],
  )
  const actualDisplay = toDisplayFromUsd(actualNetWorthUsd)

  // Records today's "Actual" total once per day it actually changes — a
  // real history to plot, not just a single live point, so the graph shows
  // the portfolio's own past trajectory alongside the target curve. Only
  // fires once accounts have actually loaded (an empty accounts array on
  // first render, before the store hydrates, would otherwise record a
  // bogus $0 day).
  useEffect(() => {
    if (accounts.length === 0) return
    const key = dateKey(new Date())
    setHistory(prev => {
      const idx = prev.findIndex(h => h.date === key)
      if (idx >= 0 && prev[idx].valueUsd === actualNetWorthUsd) return prev
      const next = [...prev]
      if (idx >= 0) next[idx] = { date: key, valueUsd: actualNetWorthUsd }
      else next.push({ date: key, valueUsd: actualNetWorthUsd })
      next.sort((a, b) => a.date.localeCompare(b.date))
      localStorage.setItem(HISTORY_KEY, JSON.stringify(next))
      return next
    })
  }, [actualNetWorthUsd, accounts.length])

  const actualPathDisplay = useMemo(
    () => pace.actualPath.map(p => {
      const [y, m, d] = p.date.split('-').map(Number)
      return {
        t: (new Date(y, m - 1, d).getTime() - today.getTime()) / ONE_YEAR_MS,
        value: toDisplayFromUsd(p.valueUsd),
      }
    }),
    [pace.actualPath, today, currency, rate],
  )

  const historyDisplay = useMemo(
    () => history.map(h => ({
      t: (new Date(h.date).getTime() - today.getTime()) / ONE_YEAR_MS,
      value: toDisplayFromUsd(h.valueUsd),
    })),
    [history, today, currency, rate],
  )

  const accountActuals: AccountActual[] = includedAccounts
    .filter(a => accountNetWorth(a) !== 0)
    .map(a => ({ name: a.name, display: toDisplayFromUsd(accountNetWorth(a)) }))

  // "Expected today" is just the target's own t=0 value — start capital —
  // since the target curve now starts from today too.
  const expectedTodayDisplay = toDisplayFromAud(cfg.startCapital)
  const variance = actualDisplay - expectedTodayDisplay

  return (
    <div className="ms-wrap">
      <div className="ph-underline-tabs ms-subtabs" role="tablist">
        <button type="button" role="tab" aria-selected={pane === 'chart'} className={`ph-underline-tab${pane === 'chart' ? ' active' : ''}`} onClick={() => setPane('chart')}>Chart</button>
        <button type="button" role="tab" aria-selected={pane === 'table'} className={`ph-underline-tab${pane === 'table' ? ' active' : ''}`} onClick={() => setPane('table')}>Table</button>
      </div>

      <div className="ms-pane">
      {pane === 'chart' ? (
      <div className="dash-panel ms-timeline-panel">
        <div className="dash-panel-header">
          <span>Timeline</span>
          <span className="ms-legend">
            <span><i style={{ background: TARGET_COLOR }} />Target</span>
            <span><i style={{ background: PACE_COLOR }} />Your pace</span>
            <span><i style={{ background: ACTUAL_COLOR }} />Actual</span>
          </span>
        </div>
        <TimelineChart cfg={cfg} r={r} paceMonthly={paceMonthly} toDisplayFromAud={toDisplayFromAud}
          actualDisplay={actualDisplay} accountActuals={accountActuals} history={historyDisplay}
          actualPath={actualPathDisplay} years={years} marks={chartMarks} currency={currency} />
      </div>
      ) : (
      <div className="dash-panel ms-table-panel">
        <div className="dash-panel-header"><span>Yearly Breakdown</span></div>
        <div className="ms-table-scroll">
          <table className="trade-table ms-table">
            <thead>
              <tr>
                <th></th>
                <th>Period</th>
                <th style={{ textAlign: 'right' }}>Start</th>
                <th style={{ textAlign: 'right' }}>End of Dec (Target)</th>
                <th style={{ textAlign: 'right' }}>End (Target)</th>
                <th style={{ textAlign: 'right' }}>Gross P&amp;L</th>
                <th style={{ textAlign: 'right' }}>Tax ({cfg.taxRate}%)</th>
                <th style={{ textAlign: 'right' }}>Net P&amp;L (after tax)</th>
                <th>Milestone</th>
              </tr>
            </thead>
            <tbody>
              {years.map(y => {
                const open = expandedYear === y.idx
                return (
                  <Fragment key={y.idx}>
                    <tr onClick={() => setExpandedYear(open ? null : y.idx)} style={{ cursor: 'pointer' }}>
                      <td className="mono" style={{ color: 'var(--text-4)' }}>{open ? '▾' : '▸'}</td>
                      <td className="mono" style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                        {fmtMonthYear(y.startDate)} – {fmtMonthYear(addMonths(y.endDate, -1))}
                      </td>
                      <td className="mono" style={{ textAlign: 'right' }}>{fmt$(toDisplayFromAud(y.start))}</td>
                      <td className="mono" style={{ textAlign: 'right', color: 'var(--text-3)' }}>{y.decEnd != null ? fmt$(toDisplayFromAud(y.decEnd)) : '—'}</td>
                      <td className="mono" style={{ textAlign: 'right', fontWeight: 600 }}>{fmt$(toDisplayFromAud(y.grossEnd))}</td>
                      <td className="mono" style={{ textAlign: 'right', color: '#10b981' }}>{fmt$(toDisplayFromAud(y.grossPnl))}</td>
                      <td className="mono" style={{ textAlign: 'right', color: '#ef4444' }}>{fmt$(toDisplayFromAud(y.tax))}</td>
                      <td className="mono" style={{ textAlign: 'right', fontWeight: 600 }}>{fmt$(toDisplayFromAud(y.netPnl))}</td>
                      <td>{y.crossed.join(', ')}</td>
                    </tr>
                    {open && (
                      <tr>
                        <td colSpan={9} style={{ padding: 0 }}>
                          <div className="ms-month-grid">
                            {Array.from({ length: y.months }, (_, i) => {
                              const monthStart = y.start * Math.pow(1 + r, i)
                              const required = monthStart * r
                              return (
                                <div key={i} className="ms-month-cell">
                                  <div className="ms-month-label">{MONTH_ABBR[addMonths(y.startDate, i).getMonth()]}</div>
                                  <div className="ms-month-value">{fmt$(toDisplayFromAud(required))}</div>
                                </div>
                              )
                            })}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
      )}
      </div>

      <div className="dash-panel" style={{ flex: '0 0 auto' }}>
        <div className="dash-panel-header">
          <span>Wealth Timeline</span>
        </div>
        <div className="ms-config-row">
          <label>Start capital
            <input type="number" value={cfg.startCapital}
              onChange={e => setCfg({ ...cfg, startCapital: Number(e.target.value) || 0 })} />
          </label>
          <label>Target return %/yr
            <input type="number" value={cfg.targetPct}
              onChange={e => setCfg({ ...cfg, targetPct: Number(e.target.value) || 0 })} />
          </label>
          <label>Tax rate %
            <input type="number" value={cfg.taxRate}
              onChange={e => setCfg({ ...cfg, taxRate: Number(e.target.value) || 0 })} />
          </label>
          <label>Years to project
            <input type="number" value={cfg.numYears}
              onChange={e => setCfg({ ...cfg, numYears: Math.max(1, Number(e.target.value) || 1) })} />
          </label>
          {accounts.length > 0 && (
            <label>Include in Actual
              <div className="ms-currency-toggle" style={{ marginTop: 3 }}>
                {accounts.map(a => (
                  <button key={a.id} className={`ms-chip${!excludedAccounts.has(a.id) ? ' active' : ''}`}
                    onClick={() => toggleAccount(a.id)} title={a.name}>
                    {a.name}
                  </button>
                ))}
              </div>
            </label>
          )}
          <label>Currency
            <div className="ms-currency-toggle" style={{ marginTop: 3 }}>
              {(['AUD', 'USD'] as const).map(c => (
                <button key={c} className={`ms-chip${currency === c ? ' active' : ''}`} onClick={() => setCurrency(c)}>{c}</button>
              ))}
            </div>
          </label>
        </div>
      </div>

      <details className="ms-pace-details">
        <summary>How the lines are calculated</summary>
        <p className="ms-pace-note">{paceNote}</p>
      </details>

      <div className="ms-summary-row">
        <div className="dash-panel ms-summary-tile">
          <div className="dash-panel-sub">Actual Net Worth Today ({currency})</div>
          <div className="ms-summary-value">{fmt$(actualDisplay)}</div>
          <div className="ms-summary-sub" style={{ color: variance >= 0 ? '#10b981' : '#ef4444' }}>
            {variance >= 0 ? '+' : ''}{fmt$(variance)} vs start capital
          </div>
        </div>
        {MILESTONES.map(m => {
          const target = projectMilestone(cfg.startCapital, m.value, cfg.targetPct / 100, today)
          const yours = pace.usingTarget
            ? target
            : projectMilestone(cfg.startCapital, m.value, pace.pacePct / 100, today)
          const alreadyActual = actualNetWorthUsd >= m.value * rate
          return (
            <div key={m.label} className="dash-panel ms-summary-tile ms-milestone-tile">
              <div className="dash-panel-sub">{m.label}</div>
              <div className="ms-compare">
                <div className="ms-compare-k" style={{ color: TARGET_COLOR }}>Target · {fmtPct(cfg.targetPct)}</div>
                <div className="ms-compare-date">{target.label}</div>
                <div className="ms-compare-left">{target.remaining}</div>
              </div>
              <div className="ms-compare">
                <div className="ms-compare-k" style={{ color: PACE_COLOR }}>Your pace · {pace.usingTarget ? `target ${fmtPct(cfg.targetPct)}` : fmtPct(pace.pacePct)}</div>
                <div className="ms-compare-date">{yours.label}</div>
                <div className="ms-compare-left">{yours.remaining}</div>
              </div>
              {alreadyActual && <div className="ms-summary-sub" style={{ color: '#10b981' }}>Already reached (actual)</div>}
            </div>
          )
        })}
      </div>
    </div>
  )
}
