/**
 * Journal engine — Edgewonk-style analytics over Flex-synced option trades.
 * Reuses the open/close position-matching semantics from StrategyTradeLog:
 * groups trades by (tradeDate, expiry, underlying); groups with sell legs open
 * a position, later buy-only groups on the same expiry+underlying close it.
 */
import type { RawTrade } from '../types'
import type { TradeLabel } from '../store/tradeLabelsStore'
import { tradeId } from '../store/tradeLabelsStore'

// ─── Position model ───────────────────────────────────────────────────────────

export type PositionStatus = 'Active' | 'Closed' | 'Expired'

export interface JournalPosition {
  id: string                  // `${tradeDate}|${expiry}|${underlying}` — stable across syncs
  underlying: string
  contracts: number
  strikeDisplay: string
  /** Distinct opening strikes, sorted descending — feeds the yield calc
   * (highest-lowest = spread width for defined-risk strategies, single value
   * = full strike for a naked CSP/CC) without re-parsing strikeDisplay. */
  strikes: number[]
  putCall: string
  expiry: string
  dateOpen: string
  initialDTE: number
  openFees: number
  netPremium: number
  status: PositionStatus
  strategy?: TradeLabel | 'put_spread' | 'shares'   // resolved from trade labels, or auto-classified
  tradeIds: string[]
  // Closed/Expired only
  dateClosed?: string         // close date, or expiry for expired positions
  closeFees?: number
  pnl?: number
  holdDays?: number
}

function parseExpiry(s: string): Date | null {
  if (!s) return null
  if (/^\d{8}$/.test(s)) s = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d
}

/** Normalizes IBKR's raw "YYYYMMDD" trade-date strings (which `new Date()` can't
 * parse — it silently returns Invalid Date, poisoning every downstream sum with
 * NaN) into a format the Date constructor actually understands. */
function normalizeDateStr(s: string): string {
  return /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : s
}

function daysBetween(a: Date | string, b: Date | string): number {
  const da = typeof a === 'string' ? new Date(normalizeDateStr(a)) : a
  const db = typeof b === 'string' ? new Date(normalizeDateStr(b)) : b
  return Math.round((db.getTime() - da.getTime()) / 86_400_000)
}

/** Best-guess strategy label from the opening legs alone, used only when the
 * trade has no manual label yet. Every SPX/SPXW position is always a bull put
 * spread here (that's the only structure ever traded on it), regardless of
 * how the legs look. For every other ticker: a genuine vertical (2+ distinct
 * strikes AND at least one long leg opposing a short one — two independent
 * same-direction opens sharing a day, like two unrelated CSPs on different
 * strikes, aren't a spread) is always "LEAP" here — put or call, debit or
 * credit, this trader treats any single-ticker vertical as a directional
 * LEAP-style play, not an income spread. Legs that share the same strike (a
 * same-day roll/adjustment of one position, not a real spread) collapse to
 * their net quantity instead: a net-short put is a cash-secured put, a
 * net-short call is a covered call. */
function autoClassify(underlying: string, openLegs: RawTrade[]): TradeLabel | 'put_spread' | undefined {
  if (/^SPXW?/.test(underlying)) return 'put_spread'
  if (openLegs.length === 0) return undefined

  const distinctStrikes = new Set(openLegs.map(l => l.strike)).size
  const hasOpposingLegs = openLegs.some(l => l.quantity > 0) && openLegs.some(l => l.quantity < 0)
  if (distinctStrikes > 1 && hasOpposingLegs) return 'leap'

  const netQty = openLegs.reduce((s, l) => s + l.quantity, 0)
  if (netQty >= 0) return undefined
  if (openLegs[0].putCall === 'P') return 'csp'
  if (openLegs[0].putCall === 'C') return 'covered_calls'
  return undefined
}

const TODAY = new Date(); TODAY.setHours(0, 0, 0, 0)

export function buildJournalPositions(
  trades: RawTrade[],
  labels: Record<string, TradeLabel>,
): JournalPosition[] {
  const optTrades = trades.filter(t => t.assetClass === 'OPT')

  // tradeTime (when the report includes it) disambiguates two unrelated
  // spreads opened minutes apart on the same underlying/expiry/day — without
  // it they'd share a grouping key and get lumped into one blob (verified: a
  // 10-lot spread opened at 17:29:36 and an unrelated 2-lot spread on
  // different strikes opened at 17:30:25, same day/expiry, merged into a
  // single fake "12-lot" position). Falls back to date-only grouping for
  // records with no tradeTime (OptionEAE/Transfer), same as before.
  const groups = new Map<string, RawTrade[]>()
  for (const t of optTrades) {
    const key = `${t.tradeDate}|${t.tradeTime ?? ''}|${t.expiry ?? ''}|${t.underlyingSymbol ?? t.symbol}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(t)
  }

  const openGroups:  Array<{ key: string; date: string; expiry: string; underlying: string; legs: RawTrade[] }> = []
  const closeGroups: Array<{ date: string; expiry: string; underlying: string; legs: RawTrade[] }> = []

  for (const [key, legs] of groups) {
    // Closing a spread means buying back the short leg AND selling to close the
    // long leg — both a buy and a sell, same as an opening trade would look by
    // quantity sign alone. Trust IBKR's own openCloseIndicator first (a group
    // is a genuine close only if every leg in it is explicitly marked closing);
    // fall back to the buy/sell heuristic only when that field isn't populated,
    // so naked-leg closes (a plain buy, no close flag) still work as before.
    //
    // A same-day roll (buy-to-close an old strike + sell-to-open a new one,
    // same underlying/expiry, filed as one order) used to fall entirely into
    // the "hasSell → openGroups" branch below, discarding the marked-close leg
    // and leaving the OLD position stuck "Active" forever — verified against a
    // real account where an MSTR CC roll and an AVGO CSP roll both left the
    // original leg open. Splitting the marked-close legs out into their own
    // closeGroup entry (regardless of whether the rest of the group opens
    // something new) lets that leg do its job of closing the earlier position,
    // while og.legs below still carries the full leg set unchanged so its own
    // openLegs/settlementLegs filtering (by openClose) works exactly as before.
    const [date, , expiry, underlying] = key.split('|')
    const closeLegs = legs.filter(l => l.openClose === 'C')
    const otherLegs = legs.filter(l => l.openClose !== 'C')
    if (closeLegs.length > 0) closeGroups.push({ date, expiry, underlying, legs: closeLegs })
    if (otherLegs.length > 0) {
      const hasSell = otherLegs.some(l => l.quantity < 0)
      const hasBuy  = otherLegs.some(l => l.quantity > 0)
      if (hasSell) openGroups.push({ key, date, expiry, underlying, legs })
      else if (hasBuy) closeGroups.push({ date, expiry, underlying, legs: otherLegs })
    }
  }

  openGroups.sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key))

  // Position ids feed the JournalEntry review store (ratings/mistakes/setup
  // tags, keyed by id) and must stay stable across syncs. The base id below
  // is the pre-existing date|expiry|underlying — unchanged from before
  // tradeTime-based grouping was added, so the overwhelming majority of
  // positions (one order per day) keep the exact id they always had and
  // don't lose their saved reviews. Only the rare day with more than one
  // distinct order on the same underlying/expiry gets the extras suffixed
  // (`#2`, `#3`, ...), ordered by execution time, since those never had a
  // stable single id to begin with (previously merged into one wrong blob).
  const baseIdSeen = new Map<string, number>()
  const idFor = new Map<string, string>() // og.key -> assigned id
  for (const og of openGroups) {
    const base = `${og.date}|${og.expiry}|${og.underlying}`
    const n = (baseIdSeen.get(base) ?? 0) + 1
    baseIdSeen.set(base, n)
    idFor.set(og.key, n === 1 ? base : `${base}#${n}`)
  }

  // A close group's legs can satisfy more than one open position: the same
  // strikes get opened twice on different dates (e.g. adding to a LEAP a
  // second time at the same strikes months later), then both closed together
  // in a single closing transaction — verified against a real account where
  // exactly this happened (two separate risk-reversal entries, same 130C/140P
  // strikes, closed in one 2-lot-per-leg transaction). Matching whole groups
  // 1:1 let only the earlier position claim that transaction, leaving the
  // second stuck "Active" forever with nothing left to match against. Instead,
  // each close group tracks remaining per-leg quantity (keyed by strike+
  // putCall) that open positions draw down as they're matched, FIFO by close
  // date, so one closing transaction can satisfy however many open positions
  // it actually covers.
  const legKeyOf = (l: RawTrade) => `${l.strike}${l.putCall}`
  const closePools = closeGroups.map(cg => {
    const remaining = new Map<string, number>()
    const netCashPerUnit = new Map<string, number>()
    const feesPerUnit = new Map<string, number>()
    const byLeg = new Map<string, RawTrade[]>()
    for (const l of cg.legs) {
      const k = legKeyOf(l)
      if (!byLeg.has(k)) byLeg.set(k, [])
      byLeg.get(k)!.push(l)
    }
    for (const [k, legs] of byLeg) {
      const qty = legs.reduce((s, l) => s + Math.abs(l.quantity), 0)
      remaining.set(k, qty)
      netCashPerUnit.set(k, qty > 0 ? legs.reduce((s, l) => s + l.netCash, 0) / qty : 0)
      feesPerUnit.set(k, qty > 0 ? legs.reduce((s, l) => s + Math.abs(l.commissions ?? 0), 0) / qty : 0)
    }
    return { cg, remaining, netCashPerUnit, feesPerUnit }
  })

  return openGroups.map(og => {
    const expDate = parseExpiry(og.expiry)
    const openLegs = og.legs.filter(l => l.openClose !== 'C')
    // Same-day (0DTE) settlement legs for THIS position's own contracts only —
    // a 'C'-marked leg sharing this group's date/expiry/underlying can still be
    // closing a completely different strike (e.g. buying back an unrelated
    // older covered call the same day a fresh CSP opens on the same expiry
    // coincidentally); matching strike+putCall against the actual opening legs
    // keeps that unrelated close out of this position's P&L.
    const openContracts = new Set(openLegs.map(l => `${l.strike}${l.putCall}`))
    const settlementLegs = og.legs.filter(l => l.openClose === 'C' && openContracts.has(`${l.strike}${l.putCall}`))
    const sells = openLegs.filter(l => l.quantity < 0)

    // A single order can fill across several separate trade records at the
    // same strike (partial fills, all same day/leg) — reading only sells[0]'s
    // own quantity undercounts to whatever that one execution happened to be
    // (verified: a real 3-lot order, each execution -1, read as 1 contract
    // instead of 3). Sum every execution sharing the anchor leg's strike+
    // putCall instead.
    const contracts = sells.length > 0
      ? openLegs.filter(l => legKeyOf(l) === legKeyOf(sells[0])).reduce((s, l) => s + Math.abs(l.quantity), 0)
      : 1
    const openFees       = openLegs.reduce((s, l) => s + Math.abs(l.commissions ?? 0), 0)
    const openingNetCash = openLegs.reduce((s, l) => s + l.netCash, 0)

    // Each leg gets its own put/call suffix — a risk-reversal/LEAP combo (long
    // call + short put on different strikes) must show as e.g. "120P/110C",
    // not "120/110C", which would wrongly read as if both strikes were calls.
    // Built from openLegs only, not og.legs — a same-day trade that happens to
    // close an unrelated older position (e.g. buying back an old covered call
    // the same day a fresh CSP is sold) shares this group's date/expiry/
    // underlying but isn't part of THIS position; its strike has no business
    // showing up here, only in whatever position it's actually closing out.
    const legKey = (l: RawTrade) => `${l.strike}${l.putCall}`
    const uniqueLegs = [...new Map(openLegs.filter(l => l.strike != null && l.putCall).map(l => [legKey(l), l])).values()]
      .sort((a, b) => (b.strike ?? 0) - (a.strike ?? 0))
    const strikeDisplay = uniqueLegs.length > 0
      ? uniqueLegs.map(l => `${l.strike! % 1 === 0 ? l.strike!.toFixed(0) : l.strike!.toFixed(2)}${l.putCall}`).join('/')
      : '—'
    const strikes = uniqueLegs.map(l => l.strike!)
    const putCall = sells[0]?.putCall ?? openLegs[0]?.putCall ?? ''

    const tradeIds = og.legs.map(tradeId)
    const strategy = tradeIds.map(id => labels[id]).find(Boolean) ?? autoClassify(og.underlying, openLegs)

    const base = {
      id: idFor.get(og.key)!,
      underlying: og.underlying,
      contracts, strikeDisplay, strikes, putCall,
      expiry: og.expiry,
      dateOpen: og.date,
      initialDTE: expDate ? daysBetween(og.date, expDate) : 0,
      openFees,
      netPremium: openingNetCash,
      strategy,
      tradeIds,
    }

    // Earliest-available closing transaction (by date) that still has enough
    // remaining quantity on every one of this position's own leg strikes.
    const pool = closePools
      .filter(p => p.cg.expiry === og.expiry && p.cg.underlying === og.underlying && p.cg.date > og.date)
      .sort((a, b) => a.cg.date.localeCompare(b.cg.date))
      .find(p => openLegs.every(l => (p.remaining.get(legKeyOf(l)) ?? 0) >= contracts))

    if (pool) {
      let closeFees = 0
      let closeNetCash = 0
      // openLegs can hold several partial-fill rows at the same strike/putCall
      // (e.g. a 3-lot order filled as three separate -1 executions) — walking
      // every row here would charge this position's close cost once per row
      // instead of once per distinct leg, tripling it. Consume the pool once
      // per unique leg key instead, by this position's own `contracts` size.
      const uniqueKeys = new Set(openLegs.map(legKeyOf))
      for (const k of uniqueKeys) {
        pool.remaining.set(k, (pool.remaining.get(k) ?? 0) - contracts)
        closeNetCash += (pool.netCashPerUnit.get(k) ?? 0) * contracts
        closeFees    += (pool.feesPerUnit.get(k) ?? 0) * contracts
      }
      const cg = pool.cg
      return {
        ...base,
        status: 'Closed' as const,
        dateClosed: cg.date,
        closeFees,
        pnl: openingNetCash + closeNetCash,
        holdDays: Math.max(0, daysBetween(og.date, cg.date)),
      }
    }

    // Same-day close: the closing leg(s) were marked 'C' but share this group's
    // exact open date, so they never formed a separate closeGroup for the
    // findIndex search above (that search requires cg.date > og.date, strictly
    // later) — this was previously only handled for genuine 0DTE *expiration*
    // (below), leaving any position manually opened and closed within the same
    // calendar day stuck "Active" forever even though it isn't 0DTE at all.
    if (settlementLegs.length > 0) {
      const settlementNetCash = settlementLegs.reduce((s, l) => s + l.netCash, 0)
      const settlementFees    = settlementLegs.reduce((s, l) => s + Math.abs(l.commissions ?? 0), 0)
      return {
        ...base,
        status: 'Closed' as const,
        dateClosed: og.date,
        closeFees: settlementFees,
        pnl: openingNetCash + settlementNetCash,
        holdDays: 0,
      }
    }

    const expired = expDate ? expDate < TODAY : false
    if (expired) {
      const closeDate = expDate!.toISOString().slice(0, 10)
      return {
        ...base,
        status: 'Expired' as const,
        dateClosed: closeDate,
        pnl: openingNetCash,
        holdDays: Math.max(0, daysBetween(og.date, expDate!)),
      }
    }

    return { ...base, status: 'Active' as const }
  })
}

/** Stock-leg P&L (assignment outcomes, manual buys/sells) — kept entirely
 * separate from the option-position matcher above and merged in by the
 * caller, since shares have no expiry/strike and are matched by simple FIFO
 * lot accounting per ticker instead of the open/close-group logic options
 * use. Mirrors the "Stocks Assigned / Bought / Sold" ledger in a manual
 * journal: every sell closes the oldest open buy lot(s) first, splitting a
 * sell across multiple buy lots (and vice versa) when sizes don't line up. */
export function buildStockPositions(
  trades: RawTrade[],
  labels: Record<string, TradeLabel>,
): JournalPosition[] {
  const stockTrades = trades.filter(t => t.assetClass === 'STK')

  const byTicker = new Map<string, RawTrade[]>()
  for (const t of stockTrades) {
    if (!byTicker.has(t.symbol)) byTicker.set(t.symbol, [])
    byTicker.get(t.symbol)!.push(t)
  }

  const positions: JournalPosition[] = []

  for (const [ticker, tsRaw] of byTicker) {
    const ts = [...tsRaw].sort((a, b) => a.tradeDate.localeCompare(b.tradeDate))
    const openLots: Array<{ trade: RawTrade; remaining: number }> = []
    let seq = 0

    for (const t of ts) {
      if (t.quantity > 0) {
        openLots.push({ trade: t, remaining: t.quantity })
        continue
      }
      if (t.quantity >= 0) continue

      let sellRemaining = Math.abs(t.quantity)
      const sellTotalQty = Math.abs(t.quantity)
      const sellFeesTotal = Math.abs(t.commissions ?? 0)

      while (sellRemaining > 0 && openLots.length > 0) {
        const lot = openLots[0]
        const matched = Math.min(lot.remaining, sellRemaining)
        const buyTrade = lot.trade
        const buyFeesShare  = Math.abs(buyTrade.commissions ?? 0) * (matched / Math.abs(buyTrade.quantity))
        const sellFeesShare = sellFeesTotal * (matched / sellTotalQty)
        const buyCost      = buyTrade.tradePrice * matched
        const sellProceeds = t.tradePrice * matched
        seq++
        positions.push({
          id: `stk|${ticker}|${buyTrade.tradeDate}|${seq}`,
          underlying: ticker,
          contracts: matched,
          strikeDisplay: 'SHARES',
        strikes: [],
          putCall: '',
          expiry: '',
          dateOpen: buyTrade.tradeDate,
          initialDTE: 0,
          openFees: buyFeesShare,
          netPremium: -buyCost,
          status: 'Closed',
          strategy: labels[tradeId(buyTrade)] ?? labels[tradeId(t)] ?? 'shares',
          tradeIds: [tradeId(buyTrade), tradeId(t)],
          dateClosed: t.tradeDate,
          closeFees: sellFeesShare,
          pnl: sellProceeds - buyCost - buyFeesShare - sellFeesShare,
          holdDays: Math.max(0, daysBetween(buyTrade.tradeDate, t.tradeDate)),
        })
        lot.remaining -= matched
        sellRemaining -= matched
        if (lot.remaining <= 0) openLots.shift()
      }
      // A sell with no matching buy lot (short sale) isn't modeled — skip.
    }

    for (const lot of openLots) {
      if (lot.remaining <= 0) continue
      seq++
      const buyTrade = lot.trade
      positions.push({
        id: `stk|${ticker}|${buyTrade.tradeDate}|open${seq}`,
        underlying: ticker,
        contracts: lot.remaining,
        strikeDisplay: 'SHARES',
        strikes: [],
        putCall: '',
        expiry: '',
        dateOpen: buyTrade.tradeDate,
        initialDTE: 0,
        openFees: Math.abs(buyTrade.commissions ?? 0) * (lot.remaining / Math.abs(buyTrade.quantity)),
        netPremium: -(buyTrade.tradePrice * lot.remaining),
        status: 'Active',
        strategy: labels[tradeId(buyTrade)] ?? 'shares',
        tradeIds: [tradeId(buyTrade)],
      })
    }
  }

  return positions
}

// ─── KPI stats ────────────────────────────────────────────────────────────────

export interface JournalStats {
  trades: number
  netPnl: number
  winRate: number          // 0-100
  profitFactor: number     // gross win / gross loss; Infinity if no losses
  expectancy: number       // avg P&L per trade
  avgWin: number
  avgLoss: number          // negative
  payoff: number           // avgWin / |avgLoss|
  maxDrawdown: number      // positive $, peak-to-trough on equity curve
  bestTrade: number
  worstTrade: number
  currentStreak: number    // positive = consecutive wins, negative = losses
  longestWinStreak: number
  longestLossStreak: number
  totalFees: number
  avgHoldDays: number
}

/** Closed/expired positions sorted by close date (the analytics timeline). */
export function closedByDate(positions: JournalPosition[]): JournalPosition[] {
  return positions
    .filter(p => p.status !== 'Active' && p.pnl != null && p.dateClosed)
    .sort((a, b) => a.dateClosed!.localeCompare(b.dateClosed!))
}

/** Sum of net premium (credit received, or negative for debit paid) across
 * still-open positions — matches the manual spreadsheet's convention of
 * counting a position's cash flow toward the running total as soon as it's
 * opened, rather than waiting for it to close. Not a mark-to-market
 * unrealized figure (this app doesn't fetch live option quotes for that),
 * just the premium banked or paid at entry. */
export function openPremiumTotal(positions: JournalPosition[]): number {
  return positions.filter(p => p.status === 'Active').reduce((s, p) => s + p.netPremium, 0)
}

export function computeStats(closed: JournalPosition[]): JournalStats {
  const pnls = closed.map(p => p.pnl ?? 0)
  const wins   = pnls.filter(n => n > 0)
  const losses = pnls.filter(n => n < 0)
  const grossWin  = wins.reduce((s, n) => s + n, 0)
  const grossLoss = Math.abs(losses.reduce((s, n) => s + n, 0))

  // Streaks over the chronological sequence
  let cur = 0, maxW = 0, maxL = 0
  for (const n of pnls) {
    if (n > 0)      cur = cur > 0 ? cur + 1 : 1
    else if (n < 0) cur = cur < 0 ? cur - 1 : -1
    if (cur > maxW) maxW = cur
    if (cur < maxL) maxL = cur
  }

  // Max drawdown on cumulative equity
  let equity = 0, peak = 0, maxDD = 0
  for (const n of pnls) {
    equity += n
    if (equity > peak) peak = equity
    if (peak - equity > maxDD) maxDD = peak - equity
  }

  const avgWin  = wins.length   ? grossWin / wins.length : 0
  const avgLoss = losses.length ? -grossLoss / losses.length : 0
  const holdDays = closed.map(p => p.holdDays ?? 0)

  return {
    trades: closed.length,
    netPnl: grossWin - grossLoss,
    winRate: closed.length ? (wins.length / closed.length) * 100 : 0,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? Infinity : 0),
    expectancy: closed.length ? (grossWin - grossLoss) / closed.length : 0,
    avgWin, avgLoss,
    payoff: avgLoss !== 0 ? avgWin / Math.abs(avgLoss) : 0,
    maxDrawdown: maxDD,
    bestTrade: pnls.length ? Math.max(...pnls) : 0,
    worstTrade: pnls.length ? Math.min(...pnls) : 0,
    currentStreak: cur,
    longestWinStreak: maxW,
    longestLossStreak: Math.abs(maxL),
    totalFees: closed.reduce((s, p) => s + p.openFees + (p.closeFees ?? 0), 0),
    avgHoldDays: holdDays.length ? holdDays.reduce((s, n) => s + n, 0) / holdDays.length : 0,
  }
}

export interface EquityPoint { date: string; equity: number; pnl: number }

export function equityCurve(closed: JournalPosition[]): EquityPoint[] {
  let equity = 0
  return closed.map(p => {
    equity += p.pnl ?? 0
    return { date: p.dateClosed!, equity, pnl: p.pnl ?? 0 }
  })
}

// ─── Breakdowns ───────────────────────────────────────────────────────────────

export interface BreakdownRow {
  key: string
  trades: number
  netPnl: number
  winRate: number
  avgPnl: number
}

export function breakdown(closed: JournalPosition[], keyFn: (p: JournalPosition) => string): BreakdownRow[] {
  const m = new Map<string, JournalPosition[]>()
  for (const p of closed) {
    const k = keyFn(p)
    if (!m.has(k)) m.set(k, [])
    m.get(k)!.push(p)
  }
  return Array.from(m.entries()).map(([key, ps]) => {
    const net = ps.reduce((s, p) => s + (p.pnl ?? 0), 0)
    const wins = ps.filter(p => (p.pnl ?? 0) > 0).length
    return { key, trades: ps.length, netPnl: net, winRate: (wins / ps.length) * 100, avgPnl: net / ps.length }
  }).sort((a, b) => b.netPnl - a.netPnl)
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export const byWeekday   = (p: JournalPosition) => WEEKDAYS[new Date(p.dateOpen).getDay()]
export const byUnderlying = (p: JournalPosition) => p.underlying
export const byStrategy  = (p: JournalPosition) => p.strategy ?? 'unlabelled'
// Bucketed by open date (matches the user's manual spreadsheet convention,
// which tracks each position under the week/month it was opened, not closed —
// a LEAP held for months shows its full realized gain under its entry month).
// dateOpen is IBKR's raw "YYYYMMDD" — must normalize before slicing, or every
// bucket comes out as an invalid 7-digit non-date instead of "YYYY-MM".
export const byMonth      = (p: JournalPosition) => normalizeDateStr(p.dateOpen).slice(0, 7)  // YYYY-MM

export function byDteBucket(p: JournalPosition): string {
  const d = p.initialDTE
  if (d <= 1)  return '0-1 DTE'
  if (d <= 7)  return '2-7 DTE'
  if (d <= 21) return '8-21 DTE'
  if (d <= 45) return '22-45 DTE'
  return '45+ DTE'
}

export function byHoldBucket(p: JournalPosition): string {
  const d = p.holdDays ?? 0
  if (d <= 1)  return '0-1 days'
  if (d <= 7)  return '2-7 days'
  if (d <= 21) return '8-21 days'
  return '21+ days'
}

// ─── Edge Finder — automated insights ────────────────────────────────────────

export interface Insight {
  kind: 'strength' | 'weakness' | 'info'
  title: string
  detail: string
}

export interface JournalEntryLike {
  mistakes?: string[]
  rating?: number
  setup?: string
}

export function edgeInsights(
  closed: JournalPosition[],
  entries: Record<string, JournalEntryLike>,
): Insight[] {
  const out: Insight[] = []
  if (closed.length < 5) {
    out.push({ kind: 'info', title: 'Insufficient data', detail: `Edge Finder needs at least 5 closed positions (have ${closed.length}). Keep syncing.` })
    return out
  }
  const fmt = (n: number) => `${n < 0 ? '-' : '+'}$${Math.abs(n).toFixed(0)}`

  // Best / worst underlying (min 3 trades)
  const und = breakdown(closed, byUnderlying).filter(r => r.trades >= 3)
  if (und.length >= 2) {
    const best = und[0], worst = und[und.length - 1]
    if (best.netPnl > 0)
      out.push({ kind: 'strength', title: `${best.key} is your edge`, detail: `${fmt(best.netPnl)} over ${best.trades} trades · ${best.winRate.toFixed(0)}% win rate` })
    if (worst.netPnl < 0)
      out.push({ kind: 'weakness', title: `${worst.key} is bleeding`, detail: `${fmt(worst.netPnl)} over ${worst.trades} trades · ${worst.winRate.toFixed(0)}% win rate` })
  }

  // DTE sweet spot
  const dte = breakdown(closed, byDteBucket).filter(r => r.trades >= 3)
  if (dte.length >= 2) {
    const best = dte.reduce((a, b) => a.avgPnl > b.avgPnl ? a : b)
    out.push({ kind: 'info', title: `Sweet spot: ${best.key}`, detail: `Best avg P&L per trade (${fmt(best.avgPnl)}) of any entry-DTE bucket` })
  }

  // Weekday effect
  const wd = breakdown(closed, byWeekday).filter(r => r.trades >= 3)
  if (wd.length >= 2) {
    const worst = wd.reduce((a, b) => a.avgPnl < b.avgPnl ? a : b)
    if (worst.netPnl < 0)
      out.push({ kind: 'weakness', title: `${worst.key} entries underperform`, detail: `${fmt(worst.netPnl)} total across ${worst.trades} trades opened on ${worst.key}` })
  }

  // Mistake cost (from journal entries)
  const mistakeCost = new Map<string, { n: number; pnl: number }>()
  for (const p of closed) {
    const e = entries[p.id]
    for (const m of e?.mistakes ?? []) {
      const cur = mistakeCost.get(m) ?? { n: 0, pnl: 0 }
      cur.n += 1; cur.pnl += p.pnl ?? 0
      mistakeCost.set(m, cur)
    }
  }
  const worstMistake = Array.from(mistakeCost.entries()).sort((a, b) => a[1].pnl - b[1].pnl)[0]
  if (worstMistake && worstMistake[1].pnl < 0)
    out.push({ kind: 'weakness', title: `“${worstMistake[0]}” is costing you`, detail: `${fmt(worstMistake[1].pnl)} across ${worstMistake[1].n} tagged trades` })

  // Discipline edge (rated trades)
  const rated = closed.filter(p => entries[p.id]?.rating)
  if (rated.length >= 6) {
    const hi = rated.filter(p => (entries[p.id].rating ?? 0) >= 4)
    const lo = rated.filter(p => (entries[p.id].rating ?? 0) <= 2)
    if (hi.length >= 3 && lo.length >= 3) {
      const hiAvg = hi.reduce((s, p) => s + (p.pnl ?? 0), 0) / hi.length
      const loAvg = lo.reduce((s, p) => s + (p.pnl ?? 0), 0) / lo.length
      if (hiAvg > loAvg)
        out.push({ kind: 'strength', title: 'Discipline pays', detail: `A-rated trades avg ${fmt(hiAvg)} vs ${fmt(loAvg)} for low-rated ones` })
    }
  }

  // Review coverage
  const reviewed = closed.filter(p => entries[p.id]?.rating || entries[p.id]?.setup || (entries[p.id]?.mistakes?.length ?? 0) > 0).length
  const pct = (reviewed / closed.length) * 100
  if (pct < 50)
    out.push({ kind: 'info', title: 'Journal coverage low', detail: `Only ${reviewed}/${closed.length} closed trades reviewed (${pct.toFixed(0)}%). Tag setups & mistakes to unlock psychology insights.` })

  return out
}
