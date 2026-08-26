/**
 * Wealth Timeline — projects a compounding target (default: $500,000 AUD
 * growing at 30%/yr) forward from TODAY, alongside the actual live net
 * worth summed across every account (IBKR netLiquidation, falling back to
 * cash + position values for a query that never enabled "Equity Summary in
 * Base"). Both the target curve and the Actual marker share the exact same
 * starting point — today, at t=0 — rather than one starting from a
 * financial-year boundary and the other from a live snapshot at some
 * offset into it. Reporting periods still run 1 Jul–30 Jun (the Australian
 * financial year), not calendar years or a rolling 12 months from today —
 * only the very first row is partial (today → the next 30 June), every row
 * after that is a full FY. Tax is paid once a year, at each FY boundary —
 * only the after-tax remainder (start + net P&L) compounds into the next
 * year, not the full pre-tax gain, so both the Yearly Breakdown table and
 * the chart itself show that as a real drag: the target curve rises
 * smoothly within a year then visibly steps down at each 30 June before
 * continuing, rather than compounding as one smooth pre-tax exponential
 * across the whole timeline. Every time the portfolio's Actual total changes
 * (a fresh IBKR sync), that day's figure is recorded to localStorage so the
 * Actual side grows into a real history line over time rather than staying
 * a single live point. Highlights the year each of $1M/$5M/$10M is first
 * crossed, breaks each row down into the monthly dollar return the target
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

/** An account's real net worth, not just its cash balance — falling back to
 * cashBalance alone (as this page used to) silently ignores every open
 * stock/option position's value, understating a portfolio holding real
 * positions by however much those positions are worth. Most Flex queries
 * report `netLiquidation` directly (IBKR's own cash + all positions'
 * market value), but a query that never enabled "Equity Summary in Base"
 * leaves it undefined forever — this recomputes the same total from the
 * positions this app already has (cash + each position's own positionValue,
 * IBKR's own per-leg market value) so the number doesn't silently stay
 * cash-only just because the account's Flex config didn't opt into that
 * one column. */
function accountNetWorth(a: Account): number {
  if (a.netLiquidation != null) return a.netLiquidation
  const positionsValue = (a.positions ?? []).reduce((s, p) => s + (p.positionValue ?? 0), 0)
  return (a.cashBalance ?? 0) + positionsValue
}

const MILESTONES = [
  { label: '$1M', value: 1_000_000 },
  { label: '$5M', value: 5_000_000 },
  { label: '$10M', value: 10_000_000 },
]

interface Config {
  startCapital: number
  targetPct: number
  taxRate: number
  numYears: number
}

const DEFAULT_CONFIG: Config = {
  startCapital: 500_000,
  targetPct: 30,
  taxRate: 25,
  numYears: 15,
}

const CONFIG_KEY = 'options:milestone-config'
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

function loadConfig(): Config {
  try {
    const raw = localStorage.getItem(CONFIG_KEY)
    if (!raw) return DEFAULT_CONFIG
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) }
  } catch {
    return DEFAULT_CONFIG
  }
}

const ONE_YEAR_MS = 365.25 * 24 * 3600 * 1000

function monthlyRate(pct: number): number {
  return Math.pow(1 + pct / 100, 1 / 12) - 1
}

function addMonths(base: Date, months: number): Date {
  const d = new Date(base)
  d.setMonth(d.getMonth() + months)
  return d
}

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function fmtMonthYear(d: Date): string {
  return `${MONTH_ABBR[d.getMonth()]} ${d.getFullYear()}`
}

interface YearRow {
  idx: number
  startDate: Date
  endDate: Date
  /** Exact whole months this row spans — 12 for every row except the
   * first, which runs from today to the next 30 June and so is however
   * many months that actually is. */
  months: number
  /** Months-from-today offset of this row's start/end, for placing it on
   * the chart (which is itself t=0-at-today, independent of FY boundaries). */
  tStart: number
  tEnd: number
  start: number
  /** Pre-tax compounded value this row would reach at `targetPct` — used
   * only to work out the milestone-crossing month within the row (the
   * smooth exponential path tax is paid on, before it's deducted). */
  grossEnd: number
  /** The actual carried-forward balance: start + netPnl. This — not
   * grossEnd — is what next year's Start is: paying tax on this year's
   * gain (assumed paid from the account) means only the after-tax amount
   * compounds forward into the next FY, not the full pre-tax gain. */
  end: number
  grossPnl: number
  tax: number
  netPnl: number
  crossed: string[]
}

function monthIndex(d: Date): number {
  return d.getFullYear() * 12 + d.getMonth()
}
function monthIndexToDate(idx: number): Date {
  return new Date(Math.floor(idx / 12), ((idx % 12) + 12) % 12, 1)
}

/** Financial-year-aligned rows (1 Jul–30 Jun), not calendar or
 * rolling-from-today rows — the first row is a partial year running from
 * today to the next 30 June (whatever's left of the FY already under way),
 * every row after that is a full Jul–Jun year. The chart itself still
 * measures everything in months-from-today (t=0 = today) regardless of
 * where these FY boundaries fall — tStart/tEnd carry that mapping. */
function buildYears(cfg: Config, today: Date): YearRow[] {
  const r = monthlyRate(cfg.targetPct)
  const todayIdx = monthIndex(today)
  const boundaries = [todayIdx]
  let b = todayIdx + 1
  while (b % 12 !== 6) b++ // next July (month index 6 = July, 0 = January)
  boundaries.push(b)
  for (let i = 1; i < cfg.numYears; i++) boundaries.push(boundaries[boundaries.length - 1] + 12)

  const rows: YearRow[] = []
  let balance = cfg.startCapital
  let prevMilestonesHit = new Set<string>()
  let tCursor = 0
  for (let i = 0; i < cfg.numYears; i++) {
    const months = boundaries[i + 1] - boundaries[i]
    const start = balance
    const grossEnd = start * Math.pow(1 + r, months)
    const grossPnl = grossEnd - start
    const tax = grossPnl > 0 ? grossPnl * (cfg.taxRate / 100) : 0
    const netPnl = grossPnl - tax
    const end = start + netPnl
    const crossed: string[] = []
    for (const m of MILESTONES) {
      if (grossEnd >= m.value && !prevMilestonesHit.has(m.label)) {
        crossed.push(m.label)
        prevMilestonesHit = new Set(prevMilestonesHit).add(m.label)
      }
    }
    rows.push({
      idx: i,
      startDate: i === 0 ? today : monthIndexToDate(boundaries[i]),
      endDate: monthIndexToDate(boundaries[i + 1]),
      months, tStart: tCursor, tEnd: tCursor + months,
      start, grossEnd, end, grossPnl, tax, netPnl, crossed,
    })
    tCursor += months
    balance = end
  }
  return rows
}

/** Which month (1-indexed) within the row a milestone is first reached, or
 * null if it isn't reached in this row at all — used to phrase "reached in
 * month 8" rather than just flagging the whole row. Capped to the row's
 * own length since the first row may run fewer than 12 months. */
function crossingMonth(start: number, end: number, target: number, r: number, months: number): number | null {
  if (target < start || target > end) return null
  const t = Math.log(target / start) / Math.log(1 + r)
  return Math.max(1, Math.min(months, Math.ceil(t)))
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
const CHART_PLOT_W_PCT = 100 - CHART_PAD_L_PCT - CHART_PAD_R_PCT

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

const ACCOUNT_COLORS = ['#38bdf8', '#f59e0b', '#a78bfa', '#f472b6', '#34d399', '#fb923c']

interface AccountActual { name: string; display: number }

/** Horizontal timeline: monthly-resolution target curve on a log-value
 * y-axis (compounding growth would otherwise squash the early, still-small
 * years down near zero pixels next to an $11M+ later year on a linear
 * scale) starting at t=0 = today, with the actual net-worth-today figure
 * plotted at that exact same t=0 — both the combined total across every
 * account, and each account's own figure as its own marker so e.g.
 * Personal and Business stay visually distinguishable instead of only ever
 * appearing pre-summed. */
function TimelineChart({ cfg, r, toDisplayFromAud, actualDisplay, accountActuals, history, years }: {
  cfg: Config; r: number; toDisplayFromAud: (v: number) => number
  actualDisplay: number; accountActuals: AccountActual[]
  /** Recorded past "Actual" points, in chart-years-from-today (negative =
   * past) and already display-currency-converted. */
  history: { t: number; value: number }[]
  years: YearRow[]
}) {
  // Smooth exponential rise WITHIN each FY (compounding at the target rate
  // off that row's own post-tax start), then a vertical drop at the FY
  // boundary down to the after-tax carried balance — tax is only actually
  // paid/deducted once a year, so the real trajectory isn't one smooth
  // curve across the whole timeline, it's this sawtooth: each year's gain
  // gets taxed before the after-tax remainder compounds into the next one.
  // Drawn as one continuous exponential from today at the target rate —
  // the annual tax drag (each row's real, lower after-tax start) is still
  // exactly what the Yearly Breakdown table and every dollar figure use,
  // but charting it produced a sawtooth that read as jagged/broken rather
  // than informative. This line is the smooth "if nothing were ever taxed"
  // reference curve; the actual after-tax numbers live in the table below.
  const totalMonths = years[years.length - 1]?.tEnd ?? cfg.numYears * 12
  const points = useMemo(() => {
    const pts: { t: number; value: number }[] = []
    for (let t = 0; t <= totalMonths; t++) {
      pts.push({ t, value: toDisplayFromAud(cfg.startCapital * Math.pow(1 + r, t)) })
    }
    return pts
  }, [totalMonths, r, cfg.startCapital, toDisplayFromAud])

  // viewBox width is picked close to the chart's typical real rendered
  // width (desktop, sidebar expanded) rather than an arbitrary round number
  // — text/dot sizes are defined in user-space units that scale with
  // whatever the browser stretches this viewBox to, so a too-narrow viewBox
  // on a wide container scales everything up (this is what made "Actual
  // $269K" render nearly 2x its authored 10px size before).
  const W = CHART_W, H = 260, padL = CHART_PAD_L, padR = CHART_PAD_R, padT = 20, padB = 26
  const plotW = W - padL - padR, plotH = H - padT - padB

  // The x-axis normally starts at t=0 (today) — a recorded history stretches
  // it a bit to the left so past readings have somewhere to sit instead of
  // being clipped off before the chart even begins.
  const domainMinYears = Math.min(0, ...history.map(h => h.t))

  const allValues = [
    ...points.map(p => p.value), actualDisplay, ...accountActuals.map(a => a.display),
    ...history.map(h => h.value),
  ]
  const minV = Math.min(cfg.startCapital * 0.5, ...allValues)
  const maxV = Math.max(...allValues) * 1.08
  const logMin = Math.log10(Math.max(1, minV))
  const logMax = Math.log10(Math.max(10, maxV))

  const domainYears = cfg.numYears - domainMinYears
  const x = (tYears: number) => padL + ((tYears - domainMinYears) / domainYears) * plotW
  const y = (v: number) => padT + plotH - ((Math.log10(Math.max(1, v)) - logMin) / (logMax - logMin)) * plotH

  const linePath = smoothPath(points.map(p => ({ x: x(p.t / 12), y: y(p.value) })))
  const historyPath = history.length > 1
    ? smoothPath(history.map(h => ({ x: x(h.t), y: y(h.value) })))
    : null

  const milestoneLines = MILESTONES
    .map(m => ({ ...m, display: toDisplayFromAud(m.value) }))
    .filter(m => m.display >= minV && m.display <= maxV)

  // One tick per FY boundary (today, then each row's 30 June end) rather
  // than a generic anniversary-of-today grid — ticks land exactly where
  // the Yearly Breakdown table's own rows do.
  const tickDefs = [{ t: 0, label: 'Today' }, ...years.map(row => ({ t: row.tEnd / 12, label: String(row.endDate.getFullYear()) }))]
  const yearTicks = tickDefs.filter((_, i) => years.length <= 10 || i % 2 === 0)

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
  const MIN_LABEL_GAP = 11
  let prevLabelY = -Infinity
  const labels = labelDefs.map(l => {
    const labelY = Math.max(l.dotY - 6, prevLabelY + MIN_LABEL_GAP)
    prevLabelY = labelY
    return { ...l, labelY }
  })

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      {milestoneLines.map(m => (
        <g key={m.label}>
          <line x1={padL} x2={W - padR} y1={y(m.display)} y2={y(m.display)}
            stroke="var(--text-5)" strokeOpacity={0.4} strokeDasharray="3,3" strokeWidth={1} />
          <text x={padL + 4} y={y(m.display) - 4} fontSize={9} fill="var(--text-4)" fontFamily="JetBrains Mono, monospace">
            {m.label}
          </text>
        </g>
      ))}

      <path d={linePath} fill="none" stroke="#10b981" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />

      {[0, ...years.map(row => row.tEnd)].map(t => (
        <circle key={t} cx={x(t / 12)} cy={y(toDisplayFromAud(cfg.startCapital * Math.pow(1 + r, t)))} r={1.8} fill="#10b981" />
      ))}

      {historyPath && <path d={historyPath} fill="none" stroke="#e5e7eb" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />}
      {history.map(h => (
        <circle key={h.t} cx={x(h.t)} cy={y(h.value)} r={1.6} fill="#e5e7eb" />
      ))}

      {showCombined && <circle cx={x(0)} cy={y(actualDisplay)} r={3.2} fill="#e5e7eb" stroke="var(--bg-card)" strokeWidth={1} />}
      {accountActuals.map((a, i) => (
        <circle key={a.name} cx={x(0)} cy={y(a.display)} r={3} fill={ACCOUNT_COLORS[i % ACCOUNT_COLORS.length]} stroke="var(--bg-card)" strokeWidth={1} />
      ))}

      {labels.map(l => (
        <g key={l.key}>
          {Math.abs(l.labelY - (l.dotY - 6)) > 2 && (
            <line x1={x(0)} y1={l.dotY} x2={x(0) + (actualLabelRight ? 4 : -4)} y2={l.labelY + 2}
              stroke={l.color} strokeOpacity={0.4} strokeWidth={0.75} />
          )}
          <text x={x(0) + (actualLabelRight ? 6 : -6)} y={l.labelY} fontSize={9} fontWeight={l.weight} fill={l.color}
            textAnchor={actualLabelRight ? 'start' : 'end'} fontFamily="JetBrains Mono, monospace">
            {l.text}
          </text>
        </g>
      ))}

      {yearTicks.map(tick => (
        <text key={tick.t} x={x(tick.t)} y={H - 8} fontSize={9} fill="var(--text-4)" textAnchor="middle" fontFamily="Inter, sans-serif">
          {tick.label}
        </text>
      ))}
    </svg>
  )
}

export default function MilestoneView({ accounts }: { accounts: Account[] }) {
  const [cfg, setCfg] = useState<Config>(loadConfig)
  // Defaults to USD, not AUD — the IBKR accounts that feed "Actual" are
  // USD-denominated, so USD is the currency their real numbers need no FX
  // round-trip to display in; AUD is only the currency the target/start
  // capital was configured in.
  const [currency, setCurrency] = useState<'AUD' | 'USD'>('USD')
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
    localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg))
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

      <div className="ms-summary-row">
        <div className="dash-panel ms-summary-tile">
          <div className="dash-panel-sub">Actual Net Worth Today ({currency})</div>
          <div className="ms-summary-value">{fmt$(actualDisplay)}</div>
          <div className="ms-summary-sub" style={{ color: variance >= 0 ? '#10b981' : '#ef4444' }}>
            {variance >= 0 ? '+' : ''}{fmt$(variance)} vs start capital
          </div>
        </div>
        {MILESTONES.map(m => {
          const row = years.find(y => y.crossed.includes(m.label))
          const alreadyActual = actualNetWorthUsd >= m.value * rate
          return (
            <div key={m.label} className={`dash-panel ms-summary-tile ms-milestone-tile${row ? ' hit' : ''}`}>
              <div className="dash-panel-sub">{m.label} Target</div>
              <div className="ms-summary-value">
                {row ? fmtMonthYear(addMonths(row.endDate, -1)) : '—'}
              </div>
              {row && (() => {
                const month = crossingMonth(row.start, row.grossEnd, m.value, r, row.months)
                if (!month) return null
                return <div className="ms-summary-sub">{fmtMonthYear(addMonths(row.startDate, month - 1))}</div>
              })()}
              {alreadyActual && <div className="ms-summary-sub" style={{ color: '#10b981' }}>Already reached (actual)</div>}
            </div>
          )
        })}
      </div>

      <div className="dash-panel ms-timeline-panel">
        <div className="dash-panel-header"><span>Timeline</span></div>
        <TimelineChart cfg={cfg} r={r} toDisplayFromAud={toDisplayFromAud}
          actualDisplay={actualDisplay} accountActuals={accountActuals} history={historyDisplay} years={years} />
        <div className="ms-timeline-scroll" style={{ paddingLeft: `${CHART_PAD_L_PCT}%`, paddingRight: `${CHART_PAD_R_PCT}%` }}>
          {years.map(y => (
            <div key={y.idx} className={`ms-timeline-year${y.crossed.length ? ' hit' : ''}${y.idx === 0 ? ' current' : ''}`}
              style={{ width: `${(y.months / (years[years.length - 1]?.tEnd || 1)) * CHART_PLOT_W_PCT}%` }}>
              <div className="ms-timeline-year-label">{fmtMonthYear(y.startDate)}</div>
              <div className="ms-timeline-year-value">{fmt$(toDisplayFromAud(y.grossEnd))}</div>
              {y.crossed.map(c => <div key={c} className="ms-timeline-badge">{c}</div>)}
            </div>
          ))}
        </div>
      </div>

      <div className="dash-panel ms-table-panel">
        <div className="dash-panel-header"><span>Yearly Breakdown</span></div>
        <div className="ms-table-scroll">
          <table className="trade-table ms-table">
            <thead>
              <tr>
                <th></th>
                <th>Period</th>
                <th style={{ textAlign: 'right' }}>Start</th>
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
                      <td className="mono" style={{ textAlign: 'right', fontWeight: 600 }}>{fmt$(toDisplayFromAud(y.grossEnd))}</td>
                      <td className="mono" style={{ textAlign: 'right', color: '#10b981' }}>{fmt$(toDisplayFromAud(y.grossPnl))}</td>
                      <td className="mono" style={{ textAlign: 'right', color: '#ef4444' }}>{fmt$(toDisplayFromAud(y.tax))}</td>
                      <td className="mono" style={{ textAlign: 'right', fontWeight: 600 }}>{fmt$(toDisplayFromAud(y.netPnl))}</td>
                      <td>{y.crossed.join(', ')}</td>
                    </tr>
                    {open && (
                      <tr>
                        <td colSpan={8} style={{ padding: 0 }}>
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
    </div>
  )
}
