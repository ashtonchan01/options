/**
 * "Your pace" — the growth rate the synced accounts have actually produced,
 * used to draw a second forecast next to the fixed target %.
 *
 * Two sources, in order:
 * 1. IBKR net-liquidation history, when a Flex sync stored one
 *    (EquitySummaryByReportDateInBase). That is the account's own value
 *    on each report date.
 * 2. Otherwise today's balance, with each closed trade's profit and loss
 *    stepped back through time — the same idea Annual ROI uses to recover
 *    a past balance when only the current one was saved. Cash deposited or
 *    withdrawn is inside today's balance and is not separated out, so it
 *    counts as part of the change.
 *
 * The rate is the annualised change between the first and last point
 * (a compound annual growth rate). It is only used when the span is at
 * least 90 days, both ends are meaningfully positive, and the rate itself
 * is inside a range that can be a trading result rather than a broken
 * base or a large deposit. Otherwise the forecast falls back to the
 * target % the page already uses.
 */
import type { RawPosition, RawTrade } from '../../types'
import { buildJournalPositions, buildStockPositions } from '../../engine/journal'

export interface EquityPoint {
  /** YYYY-MM-DD */
  date: string
  netLiquidation: number
}

export interface PaceAccount {
  trades: RawTrade[]
  positions?: RawPosition[]
  netLiquidation?: number
  cashBalance?: number
  equityHistory?: EquityPoint[]
}

export interface ValuePoint {
  date: string
  valueUsd: number
}

export type PaceSource = 'equity-history' | 'reconstructed' | 'target'
export type FallbackReason = 'none' | 'short' | 'nonpositive' | 'unstable'

export interface PaceResult {
  /** Percent a year actually drawn. The target % when `usingTarget` is set. */
  pacePct: number
  /** Percent a year measured from the account, or null when it wasn't usable. */
  achievedPct: number | null
  usingTarget: boolean
  source: PaceSource
  fallbackReason: FallbackReason | null
  /** How many days the measured span covered, even when it was too short. */
  spanDays: number | null
  fromDate: string | null
  toDate: string | null
  /** Sampled path for the chart, USD. Empty when there is nothing to draw. */
  actualPath: ValuePoint[]
}

const MIN_SPAN_DAYS = 90
const MIN_START_USD = 1000
/** Outside this band the figure is much more likely a deposit, a withdrawal,
 * or a reconstructed base near zero than a rate worth compounding for years. */
const MIN_RATE = -0.8
const MAX_RATE = 3

export function accountNetWorth(a: { netLiquidation?: number; cashBalance?: number; positions?: RawPosition[] }): number {
  if (a.netLiquidation != null) return a.netLiquidation
  const positionsValue = (a.positions ?? []).reduce((s, p) => s + (p.positionValue ?? 0), 0)
  return (a.cashBalance ?? 0) + positionsValue
}

export function toIsoDate(s: string): string | null {
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  return null
}

function isoFromDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  const ms = Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)
  return Math.round(ms / 86_400_000)
}

function sampleMonthly(path: ValuePoint[]): ValuePoint[] {
  if (path.length <= 2) return path
  const byMonth = new Map<string, ValuePoint>()
  for (const p of path) byMonth.set(p.date.slice(0, 7), p)
  const sampled = [...byMonth.values()]
  // The opening reading can share a month (even a day) with the first
  // close and would otherwise be replaced by that later point.
  if (sampled[0].date !== path[0].date || sampled[0].valueUsd !== path[0].valueUsd) sampled.unshift(path[0])
  const last = path[path.length - 1]
  if (sampled[sampled.length - 1].date !== last.date) sampled.push(last)
  return sampled
}

/** Sum each account's stored net-liquidation series onto one book. An
 * account only contributes once its own history has started, so a book is
 * returned only when every account that holds a balance or trades has a
 * series — otherwise the total would silently drop an account. */
function combineEquityHistory(accounts: PaceAccount[]): ValuePoint[] | null {
  const active = accounts.filter(a => accountNetWorth(a) !== 0 || a.trades.length > 0)
  const withHistory = active.filter(a => (a.equityHistory?.length ?? 0) >= 2)
  if (withHistory.length === 0 || withHistory.length < active.length) return null

  const series = withHistory.map(a => {
    const pts = (a.equityHistory ?? [])
      .map(p => ({ date: toIsoDate(p.date), v: p.netLiquidation }))
      .filter((p): p is { date: string; v: number } => p.date != null && Number.isFinite(p.v))
      .sort((x, y) => x.date.localeCompare(y.date))
    return pts
  }).filter(pts => pts.length >= 2)
  if (series.length < active.length) return null

  const dates = [...new Set(series.flatMap(pts => pts.map(p => p.date)))].sort()
  const cursors = series.map(pts => ({ pts, i: 0, last: null as number | null }))
  const out: ValuePoint[] = []
  for (const date of dates) {
    let sum = 0
    let ready = true
    for (const c of cursors) {
      while (c.i < c.pts.length && c.pts[c.i].date <= date) {
        c.last = c.pts[c.i].v
        c.i++
      }
      if (c.last == null) { ready = false; break }
      sum += c.last
    }
    if (ready) out.push({ date, valueUsd: sum })
  }
  return out.length >= 2 ? out : null
}

function reconstructedPath(accounts: PaceAccount[], today: Date): ValuePoint[] {
  const todayIso = isoFromDate(today)
  const todayUsd = accounts.reduce((s, a) => s + accountNetWorth(a), 0)
  const events: { date: string; pnl: number }[] = []
  for (const a of accounts) {
    const positions = [
      ...buildJournalPositions(a.trades, {}),
      ...buildStockPositions(a.trades, {}, a.positions),
    ]
    for (const p of positions) {
      if (p.status === 'Active' || p.pnl == null || !p.dateClosed) continue
      const date = toIsoDate(p.dateClosed)
      if (!date || date > todayIso) continue
      events.push({ date, pnl: p.pnl })
    }
  }
  if (events.length === 0) {
    return todayUsd > 0 ? [{ date: todayIso, valueUsd: todayUsd }] : []
  }
  events.sort((a, b) => a.date.localeCompare(b.date))
  const byDay = new Map<string, number>()
  for (const e of events) byDay.set(e.date, (byDay.get(e.date) ?? 0) + e.pnl)
  const totalRealized = events.reduce((s, e) => s + e.pnl, 0)
  let value = todayUsd - totalRealized
  const points: ValuePoint[] = [{ date: events[0].date, valueUsd: value }]
  for (const [date, pnl] of [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    value += pnl
    points.push({ date, valueUsd: value })
  }
  if (points[points.length - 1].date !== todayIso) points.push({ date: todayIso, valueUsd: todayUsd })
  else points[points.length - 1].valueUsd = todayUsd
  return points
}

interface Measured {
  pct: number
  spanDays: number
  fromDate: string
  toDate: string
  reason: FallbackReason | null
}

function measure(path: ValuePoint[]): Measured | null {
  if (path.length < 2) return null
  const first = path[0]
  const last = path[path.length - 1]
  const spanDays = daysBetween(first.date, last.date)
  if (!(first.valueUsd > 0) || !(last.valueUsd > 0)) {
    return { pct: 0, spanDays, fromDate: first.date, toDate: last.date, reason: 'nonpositive' }
  }
  if (spanDays < MIN_SPAN_DAYS) {
    return { pct: 0, spanDays, fromDate: first.date, toDate: last.date, reason: 'short' }
  }
  if (first.valueUsd < MIN_START_USD) {
    return { pct: 0, spanDays, fromDate: first.date, toDate: last.date, reason: 'unstable' }
  }
  const years = spanDays / 365.25
  const rate = Math.pow(last.valueUsd / first.valueUsd, 1 / years) - 1
  if (!Number.isFinite(rate) || rate < MIN_RATE || rate > MAX_RATE) {
    return { pct: rate * 100, spanDays, fromDate: first.date, toDate: last.date, reason: 'unstable' }
  }
  return { pct: rate * 100, spanDays, fromDate: first.date, toDate: last.date, reason: null }
}

function positivePath(path: ValuePoint[]): ValuePoint[] {
  const pts = path.filter(p => p.valueUsd > 0)
  return pts.length >= 2 ? sampleMonthly(pts) : []
}

export function resolvePace(accounts: PaceAccount[], today: Date, targetPct: number): PaceResult {
  const equity = combineEquityHistory(accounts)
  const reconstructed = reconstructedPath(accounts, today)
  const equityMeasure = equity ? measure(equity) : null
  const reconstructedMeasure = measure(reconstructed)

  const chosen = equityMeasure && !equityMeasure.reason
    ? { source: 'equity-history' as const, path: equity!, measured: equityMeasure }
    : reconstructedMeasure && !reconstructedMeasure.reason
      ? { source: 'reconstructed' as const, path: reconstructed, measured: reconstructedMeasure }
      : null

  const displayPath = positivePath(chosen ? chosen.path : (equity ?? reconstructed))
  const failed = equityMeasure?.reason ? equityMeasure : reconstructedMeasure

  if (!chosen) {
    return {
      pacePct: targetPct,
      achievedPct: null,
      usingTarget: true,
      source: 'target',
      fallbackReason: failed?.reason ?? 'none',
      spanDays: failed?.spanDays ?? null,
      fromDate: failed?.fromDate ?? null,
      toDate: failed?.toDate ?? null,
      actualPath: displayPath,
    }
  }

  return {
    pacePct: chosen.measured.pct,
    achievedPct: chosen.measured.pct,
    usingTarget: false,
    source: chosen.source,
    fallbackReason: null,
    spanDays: chosen.measured.spanDays,
    fromDate: chosen.measured.fromDate,
    toDate: chosen.measured.toDate,
    actualPath: displayPath,
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function fmtDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return `${d} ${MONTHS[(m ?? 1) - 1]} ${y}`
}

export function fmtPct(n: number): string {
  const rounded = Math.round(n * 10) / 10
  return Number.isInteger(rounded) ? `${rounded.toFixed(0)}%` : `${rounded.toFixed(1)}%`
}

export function formatSpan(years: number): string {
  const totalMonths = Math.max(0, Math.round(years * 12))
  const y = Math.floor(totalMonths / 12)
  const m = totalMonths % 12
  const parts: string[] = []
  if (y) parts.push(y === 1 ? '1 year' : `${y} years`)
  if (m) parts.push(m === 1 ? '1 month' : `${m} months`)
  return parts.length ? parts.join(' ') : 'Under a month'
}

/** When the smooth compound path from `start` hits `target`. */
export function projectMilestone(start: number, target: number, annualRate: number, today: Date): { label: string; remaining: string } {
  const monthLabel = `${MONTHS[today.getMonth()]} ${today.getFullYear()}`
  if (start >= target) return { label: monthLabel, remaining: 'Already above the start' }
  if (!(annualRate > 0) || !Number.isFinite(annualRate)) return { label: '—', remaining: 'Not at this pace' }
  const years = Math.log(target / start) / Math.log(1 + annualRate)
  if (!Number.isFinite(years) || years < 0) return { label: '—', remaining: 'Not at this pace' }
  const date = new Date(today.getTime() + years * 365.25 * 24 * 3600 * 1000)
  return {
    label: `${MONTHS[date.getMonth()]} ${date.getFullYear()}`,
    remaining: `${formatSpan(years)} left`,
  }
}

function aud(n: number): string {
  return `A$${Math.round(n).toLocaleString('en-US')}`
}

export function describePace(pace: PaceResult, opts: { startCapital: number; startMonthLabel: string; targetPct: number }): string {
  const start = `${aud(opts.startCapital)} in ${opts.startMonthLabel}`
  if (!pace.usingTarget && pace.fromDate && pace.toDate) {
    const how = pace.source === 'equity-history'
      ? 'That is the annualised growth of the net-liquidation history synced from your accounts'
      : 'That is the annualised growth of your account, worked out from today\'s balance with each closed trade\'s profit and loss stepped back through time. Money deposited or withdrawn is included in that change'
    return `Your pace is ${fmtPct(pace.pacePct)} a year. ${how}, from ${fmtDay(pace.fromDate)} to ${fmtDay(pace.toDate)}. The amber line starts at ${start} and compounds at that rate. The green line is your ${fmtPct(opts.targetPct)} a year target. The dates above are when each line reaches A$1M, A$5M and A$10M.`
  }
  const why = pace.fallbackReason === 'short' && pace.spanDays != null
    ? `the figures on file only cover ${pace.spanDays} days, and a rate needs at least ${MIN_SPAN_DAYS}`
    : pace.fallbackReason === 'nonpositive'
      ? 'the earlier balance works out at zero or below, so a growth rate from it would not mean anything'
      : pace.fallbackReason === 'unstable'
        ? 'the change in value is too large or the starting balance too small to treat as a growth rate — that usually means money was deposited or the history is incomplete'
        : 'there is no synced account history to measure yet'
  return `There isn't enough account history to estimate the growth rate you've actually achieved — ${why}. This forecast uses your ${fmtPct(opts.targetPct)} a year target instead, so it matches the green line. It still starts at ${start}. The dates above are when that line reaches A$1M, A$5M and A$10M.`
}
