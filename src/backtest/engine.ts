/**
 * Put-credit-spread backtest.
 *
 * Credits are Black-Scholes marks. IV is VIX/100 plus a flat skew slope.
 * They are not historical quotes and not fills.
 *
 * Daily bars settle expiry and, when there is no 5-minute bar, mark stops
 * at the close. 5-minute bars, when the day has them, mark take-profit and
 * stops inside the session. A 0DTE trade with only a daily bar is held to
 * the settlement print — there is no earlier close to stop on.
 */
import { yearFraction } from './calendar'
import { buildExpiries, resolveExpiry, type ExpiryInfo } from './expiries'
import { selectShortStrike, spreadIntrinsic, spreadMark } from './pricing'

export type StrikeMode = 'pct' | 'delta' | 'points'
export type ExitReason = 'expiry' | 'take-profit' | 'stop-multiple' | 'stop-strike'
export type StopBasis = 'intraday' | 'close'

export interface SessionBar {
  date: string
  open: number
  high: number
  low: number
  close: number
  vixOpen: number
  vixClose: number
}

export interface IntradayBar {
  /** Minutes after 09:30 America/New_York. 0 is the opening bar; 385 starts at 15:55. */
  minute: number
  open: number
  high: number
  low: number
  close: number
}

export interface BacktestParams {
  id: string
  dte: number
  /** 1 = Monday … 5 = Friday. */
  entryWeekdays: number[]
  strikeMode: StrikeMode
  /** Percent OTM, absolute put delta, or points below spot, depending on strikeMode. */
  strikeValue: number
  width: number
  sizing: 'contracts' | 'risk'
  contracts: number
  riskBudget: number
  takeProfitOn: boolean
  /** Percent of the net credit to keep. 50 closes the spread at half the credit. */
  takeProfitPct: number
  stopType: 'none' | 'multiple' | 'strike'
  stopMultiple: number
  vixMin: number | null
  vixMax: number | null
  startDate: string
  endDate: string
  /** Volatility points added per 1% OTM. 2 means a 3% OTM put is priced at VIX + 6. */
  skewPerPct: number
  /** Index points taken off the credit, and added again when closing early. */
  slippage: number
  /** Minutes from midnight ET. 600 is 10:00. */
  entryMinute: number
  /** Annualized percent, e.g. 4 for 4%. */
  ratePct: number
  divPct: number
  startingCapital: number
}

export interface Trade {
  entryDate: string
  expiryDate: string
  targetDte: number
  actualDte: number
  snapped: boolean
  settle: 'am' | 'pm'
  entrySpot: number
  exitSpot: number
  shortK: number
  longK: number
  entryVix: number
  modelCredit: number
  netCredit: number
  exitDebit: number
  contracts: number
  pnl: number
  risk: number
  exitDate: string
  exitReason: ExitReason
  stopBasis: StopBasis
  win: boolean
}

export interface BreakdownRow {
  key: string
  trades: number
  winRate: number | null
  avgCredit: number | null
  avgPnl: number | null
  totalPnl: number
}

export interface BacktestResult {
  trades: Trade[]
  skipped: { credit: number; vix: number; expiry: number; size: number }
  meanRejectedCredit: number | null
  summary: {
    trades: number
    wins: number
    losses: number
    winRate: number | null
    avgCredit: number | null
    avgPnl: number | null
    avgWin: number | null
    avgLoss: number | null
    maxDrawdown: number
    maxDrawdownPct: number | null
    profitFactor: number | null
    expectancy: number | null
    cagr: number | null
    totalReturn: number | null
    returnOnRisk: number | null
    totalPnl: number
    worst: Trade | null
    endingEquity: number
    startingCapital: number
  }
  equity: { date: string; equity: number }[]
  byYear: BreakdownRow[]
  byVix: BreakdownRow[]
  path: { intraday: number; close: number }
}

const OPEN_MIN = 9 * 60 + 30
const CLOSE_MIN = 16 * 60
const MULTIPLIER = 100

function dow(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

export function vixRegime(vix: number): string {
  if (vix < 15) return '<15'
  if (vix < 20) return '15–20'
  if (vix < 30) return '20–30'
  return '≥30'
}

const VIX_ORDER = ['<15', '15–20', '20–30', '≥30']

function barClock(minuteAfterOpen: number): number {
  return OPEN_MIN + minuteAfterOpen
}

interface Position {
  entry: string
  expiry: ExpiryInfo
  targetDate: string
  actualDte: number
  spot: number
  vix: number
  shortK: number
  longK: number
  modelCredit: number
  netCredit: number
  contracts: number
  risk: number
  r: number
  q: number
  skew: number
  slip: number
  tp: number | null
  stopType: BacktestParams['stopType']
  stopLevel: number
}

interface ExitFill {
  reason: ExitReason
  basis: StopBasis
  debit: number
  spot: number
  date: string
}

function markAt(pos: Position, spot: number, t: number, vix: number): number {
  return spreadMark(spot, pos.shortK, pos.longK, t, pos.r, pos.q, vix, pos.skew)
}

function scanBars(
  pos: Position,
  date: string,
  bars: readonly IntradayBar[],
  fromClock: number,
  settleClock: number,
  vix: number,
  finalSession: boolean,
): ExitFill | null {
  let start = 0
  while (start < bars.length && barClock(bars[start].minute) < fromClock) start++
  for (let i = start; i < bars.length; i++) {
    const bar = bars[i]
    const clock = barClock(bar.minute)
    const endClock = Math.min(settleClock, clock + 5)
    const t = yearFraction(date, endClock, pos.expiry.date, settleClock)
    const finalBar = finalSession && i === bars.length - 1
    if (pos.stopType === 'strike' && bar.low <= pos.shortK) {
      const spot = bar.open <= pos.shortK ? bar.open : pos.shortK
      const debit = markAt(pos, spot, t, vix) + pos.slip
      return { reason: 'stop-strike', basis: 'intraday', debit, spot, date }
    }
    if (pos.stopType === 'multiple') {
      const adverse = markAt(pos, bar.low, t, vix)
      if (adverse >= pos.stopLevel) {
        const openMark = markAt(pos, bar.open, t, vix)
        const debit = (openMark >= pos.stopLevel ? openMark : pos.stopLevel) + pos.slip
        return { reason: 'stop-multiple', basis: 'intraday', debit, spot: bar.low, date }
      }
    }
    if (!finalBar && pos.tp != null) {
      const favorable = markAt(pos, bar.high, t, vix)
      if (favorable <= pos.tp) {
        const openMark = markAt(pos, bar.open, t, vix)
        const debit = (openMark <= pos.tp ? openMark : pos.tp) + pos.slip
        return { reason: 'take-profit', basis: 'intraday', debit, spot: bar.high, date }
      }
    }
  }
  return null
}

function scanClose(
  pos: Position,
  date: string,
  close: number,
  clock: number,
  settleClock: number,
  vix: number,
): ExitFill | null {
  const t = yearFraction(date, clock, pos.expiry.date, settleClock)
  const mark = markAt(pos, close, t, vix)
  if (pos.stopType === 'strike' && close <= pos.shortK) {
    return { reason: 'stop-strike', basis: 'close', debit: mark + pos.slip, spot: close, date }
  }
  if (pos.stopType === 'multiple' && mark >= pos.stopLevel) {
    return { reason: 'stop-multiple', basis: 'close', debit: mark + pos.slip, spot: close, date }
  }
  if (pos.tp != null && mark <= pos.tp) {
    return { reason: 'take-profit', basis: 'close', debit: mark + pos.slip, spot: close, date }
  }
  return null
}

function finish(pos: Position, fill: ExitFill, targetDte: number): Trade {
  const pnl = (pos.netCredit - fill.debit) * MULTIPLIER * pos.contracts
  return {
    entryDate: pos.entry,
    expiryDate: pos.expiry.date,
    exitDate: fill.date,
    targetDte,
    actualDte: pos.actualDte,
    snapped: pos.targetDate !== pos.expiry.date,
    settle: pos.expiry.settle,
    entrySpot: pos.spot,
    exitSpot: fill.spot,
    shortK: pos.shortK,
    longK: pos.longK,
    entryVix: pos.vix,
    modelCredit: pos.modelCredit,
    netCredit: pos.netCredit,
    exitDebit: fill.debit,
    contracts: pos.contracts,
    pnl,
    risk: pos.risk,
    exitReason: fill.reason,
    stopBasis: fill.basis,
    win: pnl > 0,
  }
}

function breakdown(trades: readonly Trade[], keyOf: (t: Trade) => string, order?: readonly string[]): BreakdownRow[] {
  const map = new Map<string, Trade[]>()
  for (const t of trades) {
    const key = keyOf(t)
    const list = map.get(key)
    if (list) list.push(t)
    else map.set(key, [t])
  }
  const keys = order ? order.filter(k => map.has(k)) : [...map.keys()].sort()
  return keys.map(key => {
    const list = map.get(key) ?? []
    const wins = list.filter(t => t.win).length
    const pnl = list.reduce((s, t) => s + t.pnl, 0)
    const credit = list.reduce((s, t) => s + t.netCredit, 0)
    return {
      key,
      trades: list.length,
      winRate: list.length ? wins / list.length : null,
      avgCredit: list.length ? credit / list.length : null,
      avgPnl: list.length ? pnl / list.length : null,
      totalPnl: pnl,
    }
  })
}

export function runBacktest(
  sessions: readonly SessionBar[],
  intraday: ReadonlyMap<string, readonly IntradayBar[]> | null,
  params: BacktestParams,
  expiries?: readonly ExpiryInfo[],
): BacktestResult {
  const empty = emptyResult(params.startingCapital)
  if (sessions.length === 0 || params.width <= 0 || params.entryWeekdays.length === 0) return empty

  const dates = sessions.map(s => s.date)
  const sessionIndex = new Map<string, number>()
  dates.forEach((d, i) => sessionIndex.set(d, i))
  const calendar = expiries ?? buildExpiries(dates)
  const weekdays = new Set(params.entryWeekdays)
  const r = params.ratePct / 100
  const q = params.divPct / 100
  const slip = Math.max(0, params.slippage)
  const skew = Math.max(0, params.skewPerPct)
  const dte = Math.max(0, Math.floor(params.dte))
  const start = params.startDate || dates[0]
  const end = params.endDate || dates[dates.length - 1]
  const tp = params.takeProfitOn ? clamp(params.takeProfitPct, 0, 100) : null

  const trades: Trade[] = []
  const skipped = { credit: 0, vix: 0, expiry: 0, size: 0 }
  let rejectedCredit = 0
  const path = { intraday: 0, close: 0 }

  for (let i = 0; i < sessions.length; i++) {
    const entry = sessions[i]
    if (entry.date < start || entry.date > end) continue
    const entryDow = dow(entry.date)
    if (!weekdays.has(entryDow)) continue

    const resolved = resolveExpiry(dates, sessionIndex, calendar, entry.date, dte)
    if (!resolved || resolved.expiry.date > end) {
      skipped.expiry++
      continue
    }

    const vixEntry = entry.vixOpen > 0 ? entry.vixOpen : entry.vixClose
    if (params.vixMin != null && vixEntry < params.vixMin) { skipped.vix++; continue }
    if (params.vixMax != null && vixEntry > params.vixMax) { skipped.vix++; continue }

    const expIdx = sessionIndex.get(resolved.expiry.date) ?? i
    const lastIdx = sessionIndex.get(resolved.expiry.lastTrade) ?? expIdx
    const settleClock = resolved.expiry.settle === 'am' ? OPEN_MIN : CLOSE_MIN
    const entryClock = clamp(params.entryMinute, OPEN_MIN, CLOSE_MIN - 5)
    // Time from the entry clock to settlement. AM contracts settle the next morning.
    const tEntry = yearFraction(entry.date, entryClock, resolved.expiry.date, settleClock)
    const barsToday = intraday?.get(entry.date)
    let spot = entry.open
    if (barsToday && barsToday.length) {
      const bar = barsToday.find(b => barClock(b.minute) >= entryClock)
      if (!bar) { skipped.expiry++; continue }
      spot = bar.open
    }
    if (!(spot > 0) || !(tEntry > 0)) { skipped.expiry++; continue }

    const shortK = selectShortStrike(spot, params.strikeMode, params.strikeValue, tEntry, r, q, vixEntry, skew)
    const longK = shortK - params.width
    if (!(longK > 0) || !(shortK > longK)) { skipped.size++; continue }

    const modelCredit = spreadMark(spot, shortK, longK, tEntry, r, q, vixEntry, skew)
    const netCredit = modelCredit - slip
    if (!(netCredit > 0)) {
      skipped.credit++
      rejectedCredit += modelCredit
      continue
    }
    const riskPer = (params.width - netCredit) * MULTIPLIER
    if (!(riskPer > 0)) { skipped.size++; continue }
    const contracts = params.sizing === 'risk'
      ? Math.floor(params.riskBudget / riskPer)
      : Math.floor(params.contracts)
    if (!(contracts >= 1)) { skipped.size++; continue }

    const pos: Position = {
      entry: entry.date,
      expiry: resolved.expiry,
      targetDate: resolved.targetDate,
      actualDte: resolved.actualDte,
      spot,
      vix: vixEntry,
      shortK,
      longK,
      modelCredit,
      netCredit,
      contracts,
      risk: riskPer * contracts,
      r,
      q,
      skew,
      slip,
      tp: tp == null ? null : netCredit * (1 - tp / 100),
      stopType: params.stopType,
      stopLevel: netCredit * Math.max(0.1, params.stopMultiple),
    }

    let fill: ExitFill | null = null
    let watchedIntra = false
    for (let s = i; s <= lastIdx; s++) {
      const day = sessions[s]
      const vix = s === i ? vixEntry : (day.vixClose > 0 ? day.vixClose : vixEntry)
      const finalSession = s === lastIdx && resolved.expiry.settle === 'pm'
      const bars = intraday?.get(day.date)
      const fromClock = s === i ? entryClock : OPEN_MIN
      if (bars && bars.length) {
        path.intraday++
        watchedIntra = true
        fill = scanBars(pos, day.date, bars, fromClock, settleClock, vix, finalSession)
      } else if (!finalSession) {
        path.close++
        fill = scanClose(pos, day.date, day.close, CLOSE_MIN, settleClock, vix)
      } else {
        path.close++
      }
      if (fill) break
    }

    if (!fill) {
      const settleDay = sessions[expIdx]
      const settleSpot = resolved.expiry.settle === 'am' ? settleDay.open : settleDay.close
      fill = {
        reason: 'expiry',
        basis: watchedIntra ? 'intraday' : 'close',
        debit: spreadIntrinsic(settleSpot, shortK, longK),
        spot: settleSpot,
        date: settleDay.date,
      }
    }

    trades.push(finish(pos, fill, dte))
  }

  return summarize(trades, skipped, rejectedCredit, path, params.startingCapital, sessions)
}

function emptyResult(capital: number): BacktestResult {
  return summarize([], { credit: 0, vix: 0, expiry: 0, size: 0 }, 0, { intraday: 0, close: 0 }, capital, [])
}

function summarize(
  trades: Trade[],
  skipped: BacktestResult['skipped'],
  rejectedCredit: number,
  path: { intraday: number; close: number },
  startingCapital: number,
  sessions: readonly SessionBar[],
): BacktestResult {
  const wins = trades.filter(t => t.pnl > 0)
  const losses = trades.filter(t => t.pnl < 0)
  const totalPnl = trades.reduce((s, t) => s + t.pnl, 0)
  const grossWin = wins.reduce((s, t) => s + t.pnl, 0)
  const grossLoss = losses.reduce((s, t) => s + t.pnl, 0)
  const avg = (list: Trade[], pick: (t: Trade) => number) => list.length ? list.reduce((s, t) => s + pick(t), 0) / list.length : null

  const pnlByDate = new Map<string, number>()
  for (const t of trades) pnlByDate.set(t.exitDate, (pnlByDate.get(t.exitDate) ?? 0) + t.pnl)

  const equity: { date: string; equity: number }[] = []
  let eq = startingCapital
  let peak = startingCapital
  let maxDd = 0
  let maxDdPct = 0
  if (trades.length && sessions.length) {
    const first = trades.reduce((a, t) => t.entryDate < a ? t.entryDate : a, trades[0].entryDate)
    const last = trades.reduce((a, t) => t.exitDate > a ? t.exitDate : a, trades[0].exitDate)
    for (const s of sessions) {
      if (s.date < first || s.date > last) continue
      eq += pnlByDate.get(s.date) ?? 0
      equity.push({ date: s.date, equity: eq })
      if (eq > peak) peak = eq
      const dd = peak - eq
      if (dd > maxDd) maxDd = dd
      if (peak > 0) maxDdPct = Math.max(maxDdPct, dd / peak)
    }
    if (equity.length === 1) {
      const idx = sessions.findIndex(s => s.date === equity[0].date)
      if (idx > 0) equity.unshift({ date: sessions[idx - 1].date, equity: startingCapital })
    }
  }

  const ending = equity.length ? equity[equity.length - 1].equity : startingCapital
  let cagr: number | null = null
  let totalReturn: number | null = null
  if (trades.length && startingCapital > 0) {
    totalReturn = (ending - startingCapital) / startingCapital
    const first = trades[0].entryDate
    const last = trades.reduce((a, t) => t.exitDate > a ? t.exitDate : a, trades[0].exitDate)
    const span = Math.max(1, Math.round((Date.parse(last + 'T00:00:00Z') - Date.parse(first + 'T00:00:00Z')) / 86_400_000))
    if (ending > 0) cagr = (ending / startingCapital) ** (365 / span) - 1
  }
  const avgRisk = avg(trades, t => t.risk)
  const worst = trades.reduce<Trade | null>((w, t) => (!w || t.pnl < w.pnl ? t : w), null)

  return {
    trades,
    skipped,
    meanRejectedCredit: skipped.credit > 0 ? rejectedCredit / skipped.credit : null,
    summary: {
      trades: trades.length,
      wins: wins.length,
      losses: losses.length,
      winRate: trades.length ? wins.length / trades.length : null,
      avgCredit: avg(trades, t => t.netCredit),
      avgPnl: avg(trades, t => t.pnl),
      avgWin: avg(wins, t => t.pnl),
      avgLoss: avg(losses, t => t.pnl),
      maxDrawdown: maxDd,
      maxDrawdownPct: trades.length ? maxDdPct : null,
      profitFactor: grossLoss < 0 ? grossWin / Math.abs(grossLoss) : (grossWin > 0 ? Number.POSITIVE_INFINITY : null),
      expectancy: avg(trades, t => t.pnl),
      cagr,
      totalReturn,
      returnOnRisk: avgRisk && avgRisk > 0 ? totalPnl / avgRisk : null,
      totalPnl,
      worst,
      endingEquity: ending,
      startingCapital,
    },
    equity,
    byYear: breakdown(trades, t => t.entryDate.slice(0, 4)),
    byVix: breakdown(trades, t => vixRegime(t.entryVix), VIX_ORDER),
    path,
  }
}

export function runBacktests(
  sessions: readonly SessionBar[],
  intraday: ReadonlyMap<string, readonly IntradayBar[]> | null,
  configs: readonly BacktestParams[],
): BacktestResult[] {
  const expiries = buildExpiries(sessions.map(s => s.date))
  return configs.map(cfg => runBacktest(sessions, intraday, cfg, expiries))
}
