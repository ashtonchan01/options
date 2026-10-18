/**
 * Journal engine — Edgewonk-style analytics over Flex-synced option trades.
 * Reuses the open/close position-matching semantics from StrategyTradeLog:
 * groups trades by (tradeDate, tradeTime, expiry, underlying); groups with
 * sell legs open a position, and later — or same-day — buybacks on the same
 * expiry+underlying close it, including a partial buyback that leaves a
 * smaller open lot.
 */
import type { RawPosition, RawTrade } from '../types'
import type { TradeLabel } from '../store/tradeLabelsStore'
import { tradeId } from '../store/tradeLabelsStore'

/** Cash impact of one option leg, recomputed directly from quantity/price/
 * commission rather than trusting the trade's own stored `netCash` — IBKR's
 * Flex report has a known quirk where legs of a multi-leg COMBO order (e.g.
 * a risk-reversal: buy a call + sell a put in one order) can carry a netCash
 * sign reflecting the combo's overall order direction rather than that
 * leg's own true economics, silently flipping the sign for exactly the buy
 * leg (or the sell leg) of a mixed put+call position — verified against a
 * real account where a "sell put, buy call" risk-reversal that the user
 * confirmed paying a net debit for showed up with a net CREDIT (flipped
 * sign, same magnitude) using the stored netCash field. Quantity sign
 * (positive=buy, negative=sell) is unaffected by this quirk — confirmed by
 * every position's contracts/strikeDisplay/putCall deriving correctly from
 * it — so recomputing cash flow from quantity + tradePrice directly (the
 * same proceeds formula IBKR itself documents: proceeds = -quantity ×
 * multiplier × price) sidesteps the unreliable field entirely. */
function legNetCash(l: RawTrade): number {
  return -l.quantity * l.tradePrice * 100 - Math.abs(l.commissions ?? 0)
}

// ─── Position model ───────────────────────────────────────────────────────────

export type PositionStatus = 'Active' | 'Closed' | 'Expired'

/** One row of a share position's expanded history. */
export interface ShareFill {
  /** YYYYMMDD. Empty when IBKR didn't report the lot's open date. */
  date: string
  action: string
  quantity: number
  price: number
  fees: number
  /** Gross dollars — basis for an opening lot, price × qty for a sale. */
  total: number
  /** closed-lot = the opening lot a sale consumed; open = still held; sell = the closing fill. */
  role: 'closed-lot' | 'open' | 'sell'
}

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
  /** Share buy/sell rows for the journal expansion. Set for stock lots so a
   * sale shows the lot IBKR closed (its open date and cost) rather than
   * whichever buy the app would have paired on its own. */
  shareFills?: ShareFill[]
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
  const distinctPutCalls = new Set(openLegs.map(l => l.putCall)).size
  const hasOpposingLegs = openLegs.some(l => l.quantity > 0) && openLegs.some(l => l.quantity < 0)
  // A same-strike call+put (long one, short the other) is a synthetic long/
  // short stock position via options — directional just like a real
  // vertical, just without the strike gap, so it gets the same LEAP label
  // rather than falling through to the net-quantity same-strike-roll logic
  // below (which assumes both legs are the same put/call type).
  if (hasOpposingLegs && (distinctStrikes > 1 || distinctPutCalls > 1)) return 'leap'

  const netQty = openLegs.reduce((s, l) => s + l.quantity, 0)
  if (netQty >= 0) return undefined
  if (openLegs[0].putCall === 'P') return 'csp'
  if (openLegs[0].putCall === 'C') return 'covered_calls'
  return undefined
}

const TODAY = new Date(); TODAY.setHours(0, 0, 0, 0)

/** Soonest expiry still ahead of `today`, or the most recent one if every
 * date has already passed. YYYYMMDD sorts chronologically, so a multi-expiry
 * combo (a synthetic whose call and put don't share a date) shows the
 * nearest date rather than whichever leg happened to be read first. */
export function nearestExpiry(expiries: string[], today: Date = TODAY): string {
  const norm = [...new Set(expiries.map(e => (e ?? '').replace(/-/g, '')).filter(e => /^\d{8}$/.test(e)))]
  if (norm.length === 0) return ''
  const y = today.getFullYear()
  const m = String(today.getMonth() + 1).padStart(2, '0')
  const d = String(today.getDate()).padStart(2, '0')
  const todayStr = `${y}${m}${d}`
  const upcoming = norm.filter(e => e >= todayStr).sort()
  if (upcoming.length > 0) return upcoming[0]
  return norm.sort()[norm.length - 1]
}

/** Two unrelated verticals sharing the same short strike, opened the same day
 * (e.g. adding 10 more lots to an existing 7525P/7520P spread, then separately
 * opening a fresh 2-lot 7525P/7500P spread minutes later) land in the same
 * (date, expiry, underlying) bucket and — with no per-order id to tell them
 * apart — get treated as one blob with the short leg's full combined quantity
 * and only one of the long strikes in its display, e.g. a real 20-lot +
 * 2-lot pair showing as a single fake "22-lot" position. Splits `legs` back
 * into one cluster per distinct long (buy) strike, each holding its matching
 * share of the shared short-strike quantity — the one pattern this can
 * resolve unambiguously from strike + quantity data alone. Left as a single
 * cluster for anything more exotic (multiple distinct short strikes, or non-
 * option legs), same as before this existed, rather than guessing. */
function splitByLongStrike(legs: RawTrade[]): RawTrade[][] {
  const buys  = legs.filter(l => l.quantity > 0 && l.strike != null)
  const sells = legs.filter(l => l.quantity < 0 && l.strike != null)
  const buyStrikes  = [...new Set(buys.map(l => l.strike))]
  const sellStrikes = [...new Set(sells.map(l => l.strike))]
  if (buyStrikes.length <= 1 || sellStrikes.length !== 1) return [legs]

  const untouched = legs.filter(l => l.strike == null)
  // Consume sell rows (whole rows first, splitting a row's own quantity only
  // when it straddles two clusters) in original order, in proportion to each
  // buy-strike cluster's own quantity — prorating cash/fees by the fraction
  // of that row's quantity assigned to this cluster, same technique the
  // close-pool matcher above already uses for partial-row attribution.
  const pool = [...sells]
  let rowIdx = 0
  let rowRemaining = pool[0] ? Math.abs(pool[0].quantity) : 0

  const clusters = buyStrikes.map(strike => {
    const buyLegs = buys.filter(l => l.strike === strike)
    let need = buyLegs.reduce((s, l) => s + l.quantity, 0)
    const sellLegs: RawTrade[] = []
    while (need > 0 && rowIdx < pool.length) {
      const row = pool[rowIdx]
      const rowQty = Math.abs(row.quantity)
      const take = Math.min(need, rowRemaining)
      const frac = rowQty > 0 ? take / rowQty : 0
      sellLegs.push({ ...row, quantity: -take, netCash: row.netCash * frac, proceeds: row.proceeds * frac, commissions: (row.commissions ?? 0) * frac })
      rowRemaining -= take
      need -= take
      if (rowRemaining <= 0) { rowIdx++; rowRemaining = pool[rowIdx] ? Math.abs(pool[rowIdx].quantity) : 0 }
    }
    return [...buyLegs, ...sellLegs]
  })
  if (untouched.length > 0) clusters[0].push(...untouched)
  return clusters
}

export function buildJournalPositions(
  trades: RawTrade[],
  labels: Record<string, TradeLabel>,
): JournalPosition[] {
  const optTrades = trades.filter(t => t.assetClass === 'OPT')

  // tradeTime (now sourced from `dateTime`'s time portion when the report has
  // no standalone tradeTime attribute — see ibkr.ts) disambiguates two
  // unrelated spreads opened minutes apart on the same underlying/expiry/day
  // — without it they'd share a grouping key and get lumped into one blob
  // (verified against a real account: a 10-lot spread opened at 03:29:36 and
  // an unrelated 2-lot spread on different strikes opened 49 seconds later at
  // 03:30:25, same day/expiry, merged into one fake blended position because
  // the parser had never actually been reading a populated tradeTime value).
  // Note: IBKR's own order IDs do NOT work for this — verified the buy leg
  // and sell leg of one real spread carry two different ibOrderIDs, so
  // legs aren't reliably tied together by order id at all here.
  const groups = new Map<string, RawTrade[]>()
  for (const t of optTrades) {
    const key = `${t.tradeDate}|${t.tradeTime ?? ''}|${t.expiry ?? ''}|${t.underlyingSymbol ?? t.symbol}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(t)
  }

  const openGroups:  Array<{ key: string; date: string; time: string; expiry: string; underlying: string; legs: RawTrade[] }> = []
  const closeGroups: Array<{ date: string; time: string; expiry: string; underlying: string; legs: RawTrade[] }> = []
  const legKeyOf = (l: RawTrade) => `${l.strike}${l.putCall}`

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
    // something new) lets that leg do its job of closing the earlier position.
    //
    // A buyback of THIS group's own strikes (sell 50, buy 30 back, same order
    // or same second) is the opposite case: it belongs to the position being
    // opened here, not to an older one. Those legs stay on the open group.
    // A buyback that doesn't cover every leg of the open (only the short leg
    // of a spread, with the long leg filled as its own order) goes to the
    // shared close pool instead, so the two fills can meet.
    const [date, time, expiry, underlying] = key.split('|')
    const closeLegs = legs.filter(l => l.openClose === 'C')
    const otherLegs = legs.filter(l => l.openClose !== 'C')
    const hasSell = otherLegs.some(l => l.quantity < 0)
    if (hasSell) {
      const shortKeys = new Set(otherLegs.filter(l => l.quantity < 0).map(legKeyOf))
      // Same-strike buys that were not flagged closing are still buybacks.
      // Pull them out before the long-strike split so they aren't mistaken
      // for the long leg of a vertical.
      const unmarkedBuybacks = otherLegs.filter(l => l.quantity > 0 && shortKeys.has(legKeyOf(l)))
      const openingLegs = otherLegs.filter(l => !(l.quantity > 0 && shortKeys.has(legKeyOf(l))))
      const openKeys = new Set(openingLegs.map(legKeyOf))
      const reserved = [
        ...closeLegs.filter(l => openKeys.has(legKeyOf(l))),
        ...unmarkedBuybacks,
      ]
      const sharedCloses = closeLegs.filter(l => !openKeys.has(legKeyOf(l)))
      const reservedCoversOpen = openKeys.size > 0 && [...openKeys].every(k => reserved.some(l => legKeyOf(l) === k))
      if (sharedCloses.length > 0) closeGroups.push({ date, time, expiry, underlying, legs: sharedCloses })
      if (reserved.length > 0 && !reservedCoversOpen) closeGroups.push({ date, time, expiry, underlying, legs: reserved })

      const clusters = splitByLongStrike(openingLegs)
      if (reservedCoversOpen && clusters.length > 0) clusters[0].push(...reserved)
      clusters.forEach((clusterLegs, i) => {
        const clusterKey = clusters.length > 1 ? `${key}#s${i}` : key
        openGroups.push({ key: clusterKey, date, time, expiry, underlying, legs: clusterLegs })
      })
    } else {
      if (closeLegs.length > 0) closeGroups.push({ date, time, expiry, underlying, legs: closeLegs })
      // A buy with no sell in the group is normally a close (SPX often marks
      // every fill 'O', so the buy/sell heuristic is the fallback). The
      // exception is an explicit opening long call: a synthetic whose call
      // and put expire on different dates never shares a grouping key with
      // the short put, and used to be filed as a close — the call vanished
      // and only the put remained. Park those here and pair them below.
      // Anything that doesn't find its put goes back to the close pool, so
      // a lone buy-to-close marked 'O' still closes the short call.
      const openingLongCalls = otherLegs.length > 0 && otherLegs.every(l => l.openClose === 'O' && l.putCall === 'C' && l.quantity > 0)
      if (openingLongCalls) openGroups.push({ key, date, time, expiry, underlying, legs: otherLegs })
      else if (otherLegs.some(l => l.quantity > 0)) closeGroups.push({ date, time, expiry, underlying, legs: otherLegs })
    }
  }

  openGroups.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.key.localeCompare(b.key))

  // A synthetic long opened as one order can carry a call and a put on
  // different expiries. Those legs never shared a grouping key, so they
  // used to show up as two rows (or the call was swallowed as a close).
  // Pair a same-timestamp short put with a same-timestamp long call (equal
  // size, nothing else in either group) into one position; the expiry
  // column then shows the nearest of the two.
  {
    const wingOf = (legs: RawTrade[]): 'short-put' | 'long-call' | 'other' => {
      const opens = legs.filter(l => l.openClose !== 'C')
      const shortKeys = new Set(opens.filter(l => l.quantity < 0).map(legKeyOf))
      const kept = opens.filter(l => !(l.quantity > 0 && shortKeys.has(legKeyOf(l))))
      if (kept.length === 0 || new Set(kept.map(l => l.putCall)).size !== 1) return 'other'
      if (kept.every(l => l.putCall === 'P' && l.quantity < 0)) return 'short-put'
      if (kept.every(l => l.putCall === 'C' && l.quantity > 0)) return 'long-call'
      return 'other'
    }
    const qtyOf = (legs: RawTrade[]) => {
      const opens = legs.filter(l => l.openClose !== 'C')
      const shortKeys = new Set(opens.filter(l => l.quantity < 0).map(legKeyOf))
      return opens.filter(l => !(l.quantity > 0 && shortKeys.has(legKeyOf(l)))).reduce((s, l) => s + Math.abs(l.quantity), 0)
    }
    const buckets = new Map<string, number[]>()
    openGroups.forEach((og, i) => {
      const k = `${og.date}|${og.time}|${og.underlying}`
      const list = buckets.get(k) ?? []
      list.push(i)
      buckets.set(k, list)
    })
    const drop = new Set<number>()
    const extras: typeof openGroups = []
    for (const idxs of buckets.values()) {
      if (idxs.length !== 2) continue
      const [a, b] = [openGroups[idxs[0]], openGroups[idxs[1]]]
      const put = wingOf(a.legs) === 'short-put' ? a : wingOf(b.legs) === 'short-put' ? b : null
      const call = wingOf(a.legs) === 'long-call' ? a : wingOf(b.legs) === 'long-call' ? b : null
      if (!put || !call || put.expiry === call.expiry) continue
      if (qtyOf(put.legs) !== qtyOf(call.legs)) continue
      // A buy of a call that matches a short call already open is a
      // buy-to-close (even when IBKR marked it 'O'), not the long wing of
      // a new synthetic. Leave it for the close pool.
      const callKeys = new Set(call.legs.map(legKeyOf))
      const closesExistingShort = openGroups.some(og =>
        og !== call && og.underlying === call.underlying && og.expiry === call.expiry
        && (og.date < call.date || (og.date === call.date && og.time < call.time))
        && og.legs.some(l => l.quantity < 0 && l.putCall === 'C' && callKeys.has(legKeyOf(l))),
      )
      if (closesExistingShort) continue
      drop.add(idxs[0]); drop.add(idxs[1])
      extras.push({
        key: `${put.date}|${put.time}|${put.underlying}|synth`,
        date: put.date,
        time: put.time,
        expiry: nearestExpiry([put.expiry, call.expiry]),
        underlying: put.underlying,
        legs: [...put.legs, ...call.legs],
      })
    }
    if (drop.size > 0) {
      for (const i of [...drop].sort((a, b) => b - a)) openGroups.splice(i, 1)
      openGroups.push(...extras)
      openGroups.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.key.localeCompare(b.key))
    }
  }

  // Long calls that never found a matching short put are buy-to-closes
  // (or a lone debit call this matcher has always treated as a close).
  {
    const stranded: number[] = []
    openGroups.forEach((og, i) => {
      if (og.legs.length > 0 && og.legs.every(l => l.openClose === 'O' && l.putCall === 'C' && l.quantity > 0)) stranded.push(i)
    })
    for (const i of [...stranded].sort((a, b) => b - a)) {
      const og = openGroups[i]
      closeGroups.push({ date: og.date, time: og.time, expiry: og.expiry, underlying: og.underlying, legs: og.legs })
      openGroups.splice(i, 1)
    }
  }

  // Closing executions for one exit can land a few seconds apart (e.g.
  // "234556" and "234557" for the two legs of a 2-lot close) — since
  // closeGroups was built off the same tradeTime-keyed grouping used for
  // opens, that split a single 2-contract close into two separate 1-contract
  // closeGroups. A position needing 2 contracts closed then found neither
  // piece alone big enough, silently fell through to "must have expired
  // worthless," and kept the full opening premium as fake profit — hiding a
  // real (and potentially large) loss on the actual buyback. Unlike opens,
  // where two different tradeTimes on the same day can be genuinely
  // unrelated positions, a close's only job is quantity-by-strike
  // bookkeeping against whatever's already open (the closePools logic below
  // already pools multiple close rows by leg key regardless of which
  // execution they came from) — so merging every closeGroup sharing a
  // (date, expiry, underlying) back into one, before building closePools,
  // is safe and fixes the mismatch. Verified against a real account: an
  // AVGO 425P sold for $1,085 credit and bought back for a $5,642 debit
  // (net ~$4,558 loss) was showing as "Expired" with the full $1,085 credit
  // counted as profit until this fix.
  const mergedCloseGroups = new Map<string, { date: string; expiry: string; underlying: string; maxTime: string; legs: RawTrade[] }>()
  for (const cg of closeGroups) {
    const k = `${cg.date}|${cg.expiry}|${cg.underlying}`
    const cur = mergedCloseGroups.get(k)
    if (!cur) mergedCloseGroups.set(k, { date: cg.date, expiry: cg.expiry, underlying: cg.underlying, maxTime: cg.time, legs: [...cg.legs] })
    else {
      cur.legs.push(...cg.legs)
      if (cg.time > cur.maxTime) cur.maxTime = cg.time
    }
  }
  const closeGroupsMerged = [...mergedCloseGroups.values()]

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
  // putCall) that open positions draw down as they're matched, FIFO by open
  // date, so one closing transaction can satisfy however many open positions
  // it actually covers — including a partial buyback, which used to be
  // ignored unless the close was big enough to flatten the whole position.
  interface LegPool {
    date: string
    maxTime: string
    expiry: string
    underlying: string
    remaining: Map<string, number>
    netCashPerUnit: Map<string, number>
    feesPerUnit: Map<string, number>
    legs: RawTrade[]
  }
  function toPool(date: string, maxTime: string, expiry: string, underlying: string, legs: RawTrade[]): LegPool {
    const remaining = new Map<string, number>()
    const netCashPerUnit = new Map<string, number>()
    const feesPerUnit = new Map<string, number>()
    const byLeg = new Map<string, RawTrade[]>()
    for (const l of legs) {
      const k = legKeyOf(l)
      if (!byLeg.has(k)) byLeg.set(k, [])
      byLeg.get(k)!.push(l)
    }
    for (const [k, ls] of byLeg) {
      const qty = ls.reduce((s, l) => s + Math.abs(l.quantity), 0)
      remaining.set(k, qty)
      netCashPerUnit.set(k, qty > 0 ? ls.reduce((s, l) => s + legNetCash(l), 0) / qty : 0)
      feesPerUnit.set(k, qty > 0 ? ls.reduce((s, l) => s + Math.abs(l.commissions ?? 0), 0) / qty : 0)
    }
    return { date, maxTime, expiry, underlying, remaining, netCashPerUnit, feesPerUnit, legs }
  }
  const closePools = closeGroupsMerged.map(cg => toPool(cg.date, cg.maxTime, cg.expiry, cg.underlying, cg.legs))

  // A same-day buy-to-close is a later execution, so it does not share the
  // opening group's tradeTime and never used to become a settlement leg.
  // The matcher also required the close date to be strictly after the open
  // date, so that fill was dropped and the row kept every opening sell.
  // Same-day closes are eligible when they print at or after the open (or
  // when either side has no timestamp). A close that prints earlier the
  // same day belongs to an older lot, which FIFO already consumed.
  function poolEligible(openDate: string, openTime: string, pool: LegPool): boolean {
    if (pool.date > openDate) return true
    if (pool.date < openDate) return false
    if (!pool.maxTime || !openTime) return true
    return pool.maxTime >= openTime
  }
  function take(pool: LegPool, keys: string[], qty: number): { qty: number; closeNetCash: number; closeFees: number; legIds: string[] } | null {
    if (qty <= 1e-9 || keys.length === 0) return null
    let closable = qty
    for (const k of keys) closable = Math.min(closable, pool.remaining.get(k) ?? 0)
    if (closable <= 1e-9) return null
    let closeNetCash = 0
    let closeFees = 0
    for (const k of keys) {
      pool.remaining.set(k, (pool.remaining.get(k) ?? 0) - closable)
      closeNetCash += (pool.netCashPerUnit.get(k) ?? 0) * closable
      closeFees += (pool.feesPerUnit.get(k) ?? 0) * closable
    }
    const keySet = new Set(keys)
    const legIds = pool.legs.filter(l => keySet.has(legKeyOf(l))).map(tradeId)
    return { qty: closable, closeNetCash, closeFees, legIds }
  }

  return openGroups.flatMap(og => {
    const markedClose = og.legs.filter(l => l.openClose === 'C')
    const rawOpen = og.legs.filter(l => l.openClose !== 'C')
    const sellKeys = new Set(rawOpen.filter(l => l.quantity < 0).map(legKeyOf))
    const unmarkedBuybacks = rawOpen.filter(l => l.quantity > 0 && sellKeys.has(legKeyOf(l)))
    const openLegs = rawOpen.filter(l => !(l.quantity > 0 && sellKeys.has(legKeyOf(l))))
    const reservedLegs = [...markedClose, ...unmarkedBuybacks]
    const sells = openLegs.filter(l => l.quantity < 0)

    // A single order can fill across several separate trade records at the
    // same strike (partial fills, all same day/leg) — reading only sells[0]'s
    // own quantity undercounts to whatever that one execution happened to be
    // (verified: a real 3-lot order, each execution -1, read as 1 contract
    // instead of 3). Sum every execution sharing the anchor leg's strike+
    // putCall instead. Same-strike buybacks are not part of openLegs, so
    // they don't inflate this back up to the original sale.
    const contracts = sells.length > 0
      ? openLegs.filter(l => legKeyOf(l) === legKeyOf(sells[0])).reduce((s, l) => s + Math.abs(l.quantity), 0)
      : 1
    const openFees       = openLegs.reduce((s, l) => s + Math.abs(l.commissions ?? 0), 0)
    const openingNetCash = openLegs.reduce((s, l) => s + legNetCash(l), 0)

    // Each leg gets its own put/call suffix — a risk-reversal/LEAP combo (long
    // call + short put on different strikes) must show as e.g. "120P/110C",
    // not "120/110C", which would wrongly read as if both strikes were calls.
    // Built from openLegs only, not og.legs — a same-day trade that happens to
    // close an unrelated older position (e.g. buying back an old covered call
    // the same day a fresh CSP is sold) shares this group's date/expiry/
    // underlying but isn't part of THIS position; its strike has no business
    // showing up here, only in whatever position it's actually closing out.
    const uniqueLegs = [...new Map(openLegs.filter(l => l.strike != null && l.putCall).map(l => [legKeyOf(l), l])).values()]
      .sort((a, b) => (b.strike ?? 0) - (a.strike ?? 0))
    const strikeDisplay = uniqueLegs.length > 0
      ? uniqueLegs.map(l => `${l.strike! % 1 === 0 ? l.strike!.toFixed(0) : l.strike!.toFixed(2)}${l.putCall}`).join('/')
      : '—'
    const strikes = uniqueLegs.map(l => l.strike!)
    const putCall = sells[0]?.putCall ?? openLegs[0]?.putCall ?? ''
    const legExpiries = [...new Set(openLegs.map(l => l.expiry).filter((e): e is string => !!e))]
    const expiry = nearestExpiry(legExpiries.length > 0 ? legExpiries : [og.expiry])
    const expDate = parseExpiry(expiry)

    // Opening trades carry the strategy label. Close fills are added onto
    // the position that actually consumed them so the Calendar can attribute
    // the buyback without letting it pick the strategy.
    const openTradeIds = openLegs.map(tradeId)
    const strategy = openTradeIds.map(id => labels[id]).find(Boolean) ?? autoClassify(og.underlying, openLegs)

    const base = {
      id: idFor.get(og.key)!,
      underlying: og.underlying,
      contracts, strikeDisplay, strikes, putCall,
      expiry,
      dateOpen: og.date,
      initialDTE: expDate ? daysBetween(og.date, expDate) : 0,
      openFees,
      netPremium: openingNetCash,
      strategy,
      tradeIds: openTradeIds,
    }

    const keys = [...new Set(openLegs.map(legKeyOf))]
    const slices: Array<{ qty: number; date: string; closeNetCash: number; closeFees: number; legIds: string[] }> = []
    const reservedPool = toPool(og.date, og.time, og.expiry, og.underlying, reservedLegs)
    const reservedTake = take(reservedPool, keys, contracts)
    if (reservedTake) slices.push({ ...reservedTake, date: og.date })
    let left = contracts - (reservedTake?.qty ?? 0)

    // Each leg is closed out of the pool for its own expiry, so a
    // multi-expiry synthetic can buy back the put and sell the call on
    // the same day even though those fills no longer share one pool.
    // Same-expiry positions still require every leg to be present that
    // day — a pool that only has one side of a spread closes nothing.
    const legExpiry = new Map(openLegs.map(l => [legKeyOf(l), l.expiry || og.expiry]))
    const pools = closePools.filter(p => p.underlying === og.underlying && poolEligible(og.date, og.time, p) && [...legExpiry.values()].includes(p.expiry))
    const dates = [...new Set(pools.map(p => p.date))].sort()
    for (const date of dates) {
      if (left <= 1e-9) break
      const day = pools.filter(p => p.date === date)
      let closable = left
      for (const k of keys) {
        const avail = day.filter(p => p.expiry === legExpiry.get(k)).reduce((s, p) => s + (p.remaining.get(k) ?? 0), 0)
        closable = Math.min(closable, avail)
      }
      if (closable <= 1e-9) continue
      let closeNetCash = 0
      let closeFees = 0
      const legIds: string[] = []
      for (const k of keys) {
        let need = closable
        for (const pool of day.filter(p => p.expiry === legExpiry.get(k))) {
          if (need <= 1e-9) break
          const got = take(pool, [k], need)
          if (!got) continue
          need -= got.qty
          closeNetCash += got.closeNetCash
          closeFees += got.closeFees
          legIds.push(...got.legIds)
        }
      }
      slices.push({ qty: closable, date, closeNetCash, closeFees, legIds })
      left -= closable
    }

    const closedQty = slices.reduce((s, sl) => s + sl.qty, 0)
    const openQty = contracts - closedQty
    if (slices.length > 0 && openQty <= 1e-6) {
      const closeNetCash = slices.reduce((s, sl) => s + sl.closeNetCash, 0)
      const closeFees = slices.reduce((s, sl) => s + sl.closeFees, 0)
      const dateClosed = slices[slices.length - 1].date
      const closeIds = [...new Set(slices.flatMap(sl => sl.legIds))]
      return [{
        ...base,
        status: 'Closed' as const,
        dateClosed,
        closeFees,
        pnl: openingNetCash + closeNetCash,
        holdDays: Math.max(0, daysBetween(og.date, dateClosed)),
        tradeIds: [...openTradeIds, ...closeIds],
      }]
    }

    const out: JournalPosition[] = []
    slices.forEach((sl, i) => {
      const frac = contracts > 0 ? sl.qty / contracts : 0
      out.push({
        ...base,
        id: `${base.id}#c${i + 1}`,
        contracts: sl.qty,
        openFees: openFees * frac,
        netPremium: openingNetCash * frac,
        status: 'Closed' as const,
        dateClosed: sl.date,
        closeFees: sl.closeFees,
        pnl: openingNetCash * frac + sl.closeNetCash,
        holdDays: Math.max(0, daysBetween(og.date, sl.date)),
        tradeIds: [...openTradeIds, ...sl.legIds],
      })
    })

    const openFrac = contracts > 0 ? openQty / contracts : 1
    const expired = expDate ? expDate < TODAY : false
    if (expired) {
      const closeDate = expDate!.toISOString().slice(0, 10).replace(/-/g, '')
      out.push({
        ...base,
        contracts: openQty,
        openFees: openFees * openFrac,
        netPremium: openingNetCash * openFrac,
        status: 'Expired' as const,
        dateClosed: closeDate,
        pnl: openingNetCash * openFrac,
        holdDays: Math.max(0, daysBetween(og.date, expDate!)),
      })
    } else {
      const closeIds = [...new Set(slices.flatMap(sl => sl.legIds))]
      out.push({
        ...base,
        contracts: openQty,
        openFees: openFees * openFrac,
        netPremium: openingNetCash * openFrac,
        status: 'Active' as const,
        tradeIds: [...openTradeIds, ...closeIds],
      })
    }
    return out
  })
}

/** While a position is still open, show the realised P&L of its partial
 * closes on that open row (the same way a share lot's partial sells roll
 * into the one SHARES row) and keep the closed slices out of the table.
 * The slices themselves stay in `buildJournalPositions` so reports and the
 * calendar, which read that list directly, still book the realised P&L. */
export function foldPartialCloses(positions: JournalPosition[]): JournalPosition[] {
  const kids = new Map<string, JournalPosition[]>()
  for (const p of positions) {
    const m = p.id.match(/^(.*)#c\d+$/)
    if (!m) continue
    const list = kids.get(m[1]) ?? []
    list.push(p)
    kids.set(m[1], list)
  }
  if (kids.size === 0) return positions
  const hidden = new Set<string>()
  const next = positions.map(p => {
    const list = kids.get(p.id)
    if (!list || p.status !== 'Active') return p
    for (const k of list) hidden.add(k.id)
    return { ...p, pnl: (p.pnl ?? 0) + list.reduce((s, k) => s + (k.pnl ?? 0), 0) }
  })
  return next.filter(p => !hidden.has(p.id))
}

/** Stock-leg P&L (assignment outcomes, manual buys/sells) — kept entirely
 * separate from the option-position matcher above and merged in by the
 * caller, since shares have no expiry/strike.
 *
 * IBKR's Tax Optimizer picks the lot a sale closes (FIFO, LIFO, Highest
 * Cost, specific lot, …). Replaying our own order does not. A real MSTR
 * sale on 16 Oct 2026 was matched by IBKR to a $326.7901 lot (basis
 * -$32,679.01, realized P&L -$19,179.53) while this code, taking the
 * newest buy, booked the 20 Aug 2026 $104.25 assignment and showed
 * +$3,074.48. Closing stock trades carry `cost` and `fifoPnlRealized`
 * (the name says FIFO; the number follows the account's method), and
 * Closed Lots name the opening lot. Those win. A statement with neither
 * — a CSV import, or a Flex sync from before those fields were stored —
 * still falls back to newest-lot first, which is what a previous TSLA
 * account needed when IBKR itself wasn't in the file. */
interface MutableLot {
  trade: RawTrade
  remaining: number
  price: number
  date: string
}

interface CloseSlice {
  qty: number
  openDate: string
  openPrice: number
  basis: number
  pnl: number
  openFees: number
  closeFees: number
  lotIndex: number | null
  openTrade?: RawTrade
}

function pricesClose(a: number, b: number): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false
  const diff = Math.abs(a - b)
  return diff <= 0.02 || diff <= Math.max(Math.abs(a), Math.abs(b)) * 0.001
}

function basisClose(got: number, want: number, qty: number): boolean {
  return Math.abs(got - want) <= Math.max(0.05, 0.02 * Math.abs(qty))
}

function sameDay(a: string, b: string): boolean {
  if (!a || !b) return false
  return a.replace(/\D/g, '').slice(0, 8) === b.replace(/\D/g, '').slice(0, 8)
}

function signedCommission(raw: number | undefined): number {
  const c = raw ?? 0
  return c > 0 ? -c : c
}

function hasIbkrClose(t: RawTrade): boolean {
  if (t.closedLots && t.closedLots.length > 0) return true
  if (t.fifoPnlRealized != null && Number.isFinite(t.fifoPnlRealized)) return true
  if (t.cost != null && Number.isFinite(t.cost) && t.cost !== 0) return true
  return false
}

/** Positive dollars of basis IBKR removed. Recovered from realized P&L
 * when the row has `fifoPnlRealized` but no `cost` attribute:
 * basis = proceeds + signed commission − realized. */
function closeBasis(t: RawTrade, sellQty: number): number | undefined {
  if (t.cost != null && Number.isFinite(t.cost) && t.cost !== 0) return Math.abs(t.cost)
  if (t.fifoPnlRealized == null || !Number.isFinite(t.fifoPnlRealized)) return undefined
  const proceeds = t.proceeds !== 0 ? t.proceeds : t.tradePrice * sellQty
  const basis = proceeds + signedCommission(t.commissions) - t.fifoPnlRealized
  return Number.isFinite(basis) && basis > 0 ? basis : undefined
}

function tradeRealized(t: RawTrade, sellQty: number): number | undefined {
  if (t.fifoPnlRealized != null && Number.isFinite(t.fifoPnlRealized)) return t.fifoPnlRealized
  const basis = closeBasis(t, sellQty)
  if (basis == null) return undefined
  const proceeds = t.proceeds !== 0 ? t.proceeds : t.tradePrice * sellQty
  return proceeds + signedCommission(t.commissions) - basis
}

function snapPnl(slices: CloseSlice[], total: number) {
  if (slices.length === 0) return
  const sum = slices.reduce((s, sl) => s + sl.pnl, 0)
  slices[slices.length - 1].pnl += total - sum
}

interface LotTake { index: number; qty: number; basis: number }

/** A sale of one whole lot: the lot whose per-share cost equals IBKR's
 * basis per share. Highest Cost, FIFO, and LIFO all reduce to this when
 * the sale doesn't span lots, and only the lot IBKR actually priced matches. */
function singleLotMatch(lots: MutableLot[], qty: number, basis: number): LotTake[] | null {
  let best: { index: number; diff: number } | null = null
  for (let i = 0; i < lots.length; i++) {
    if (lots[i].remaining + 1e-9 < qty) continue
    const b = lots[i].price * qty
    if (!basisClose(b, basis, qty)) continue
    const diff = Math.abs(b - basis)
    if (!best || diff < best.diff - 1e-9 || (Math.abs(diff - best.diff) <= 1e-9 && i < best.index)) {
      best = { index: i, diff }
    }
  }
  if (!best) return null
  return [{ index: best.index, qty, basis: lots[best.index].price * qty }]
}

function relieveInOrder(lots: MutableLot[], order: number[], qty: number): LotTake[] | null {
  let need = qty
  const out: LotTake[] = []
  for (const index of order) {
    if (need <= 1e-9) break
    const lot = lots[index]
    if (lot.remaining <= 1e-9) continue
    const take = Math.min(lot.remaining, need)
    out.push({ index, qty: take, basis: lot.price * take })
    need -= take
  }
  if (need > 1e-6) return null
  return out
}

/** Specific-lot identification that isn't a prefix of FIFO/LIFO/highest/
 * lowest cost: any subset of whole lots, plus at most one partial lot. */
function searchSpecificLots(lots: MutableLot[], qty: number, basis: number): LotTake[] | null {
  const n = lots.length
  if (n === 0 || n > 16) return null
  const tol = Math.max(0.05, 0.02 * qty)
  let found: LotTake[] | null = null
  const acc: LotTake[] = []
  const dfs = (i: number, needQty: number, needBasis: number) => {
    if (found) return
    if (needQty <= 1e-9) {
      if (Math.abs(needBasis) <= tol) found = acc.map(s => ({ ...s }))
      return
    }
    if (i >= n) return
    dfs(i + 1, needQty, needBasis)
    const lot = lots[i]
    if (lot.remaining <= 1e-9) return
    if (lot.remaining <= needQty + 1e-9) {
      const b = lot.price * lot.remaining
      acc.push({ index: i, qty: lot.remaining, basis: b })
      dfs(i + 1, needQty - lot.remaining, needBasis - b)
      acc.pop()
    } else {
      const b = lot.price * needQty
      acc.push({ index: i, qty: needQty, basis: b })
      dfs(n, 0, needBasis - b)
      acc.pop()
    }
  }
  dfs(0, qty, basis)
  return found
}

/** Which open lots' costs add up to the basis IBKR reported. The method
 * isn't chosen up front — FIFO, LIFO, highest cost, and lowest cost are
 * each tried, and the one whose relieved basis equals IBKR's figure is
 * the one the account used. A single lot whose price matches wins before
 * any of those orders. */
function matchLotsToBasis(lots: MutableLot[], qty: number, basis: number): LotTake[] | null {
  const single = singleLotMatch(lots, qty, basis)
  if (single) return single
  const fifo = lots.map((_, i) => i)
  const orders = [
    fifo,
    [...fifo].reverse(),
    [...fifo].sort((a, b) => lots[b].price - lots[a].price || a - b),
    [...fifo].sort((a, b) => lots[a].price - lots[b].price || a - b),
  ]
  for (const order of orders) {
    const slices = relieveInOrder(lots, order, qty)
    if (!slices) continue
    const total = slices.reduce((s, sl) => s + sl.basis, 0)
    if (basisClose(total, basis, qty)) return slices
  }
  return searchSpecificLots(lots, qty, basis)
}

function findConsumable(lots: MutableLot[], date: string, price: number, qty: number, reserved: Map<number, number>): number | null {
  const available = (i: number) => lots[i].remaining - (reserved.get(i) ?? 0)
  const hits: number[] = []
  for (let i = 0; i < lots.length; i++) {
    if (available(i) + 1e-9 < qty) continue
    if (!pricesClose(lots[i].price, price)) continue
    hits.push(i)
  }
  if (hits.length === 0) return null
  const dated = date ? hits.filter(i => sameDay(lots[i].date, date)) : []
  if (dated.length >= 1) return dated[0]
  return hits[0]
}

function dropEmpty(lots: MutableLot[]) {
  for (let i = lots.length - 1; i >= 0; i--) {
    if (lots[i].remaining <= 1e-6) lots.splice(i, 1)
  }
}

function openBuyAction(trade: RawTrade): string {
  const assigned = Math.abs(trade.commissions ?? 0) < 0.005 && !trade.isTransfer
  return assigned ? 'Buy (assigned)' : 'Buy'
}

function slicesFromClosedLots(t: RawTrade, lots: MutableLot[], sellQty: number): CloseSlice[] {
  const closed = t.closedLots ?? []
  const reserved = new Map<number, number>()
  const slices: CloseSlice[] = closed.map(lot => {
    const qty = Math.abs(lot.quantity) > 1e-9 ? Math.abs(lot.quantity) : sellQty
    const fromPrice = (lot.origTradePrice ?? 0) * qty
    const basis = Math.abs(lot.cost) > 1e-9 ? Math.abs(lot.cost) : fromPrice
    const openPrice = lot.origTradePrice && lot.origTradePrice > 0 ? lot.origTradePrice : (qty > 0 ? basis / qty : 0)
    const openDate = lot.origTradeDate ?? ''
    const lotIndex = findConsumable(lots, openDate, openPrice, qty, reserved)
    if (lotIndex != null) reserved.set(lotIndex, (reserved.get(lotIndex) ?? 0) + qty)
    const openTrade = lotIndex != null ? lots[lotIndex].trade : undefined
    return {
      qty,
      openDate: openDate || openTrade?.tradeDate || '',
      openPrice,
      basis,
      pnl: lot.fifoPnlRealized ?? Number.NaN,
      openFees: 0,
      closeFees: 0,
      lotIndex,
      openTrade,
    }
  })
  const qtySum = slices.reduce((s, sl) => s + sl.qty, 0) || sellQty
  const fee = Math.abs(t.commissions ?? 0)
  for (const sl of slices) {
    sl.closeFees = qtySum > 0 ? fee * (sl.qty / qtySum) : 0
    if (sl.openTrade) {
      const buyQty = Math.abs(sl.openTrade.quantity) || sl.qty
      sl.openFees = Math.abs(sl.openTrade.commissions ?? 0) * (sl.qty / buyQty)
    }
    if (!Number.isFinite(sl.pnl)) {
      const proceeds = t.proceeds !== 0 ? Math.abs(t.proceeds) * (sl.qty / qtySum) : t.tradePrice * sl.qty
      sl.pnl = proceeds - sl.basis - sl.closeFees
    }
  }
  const total = tradeRealized(t, sellQty)
  if (total != null) snapPnl(slices, total)
  for (const [index, qty] of reserved) lots[index].remaining -= qty
  return slices
}

function slicesFromCost(t: RawTrade, lots: MutableLot[], sellQty: number): CloseSlice[] {
  const basis = closeBasis(t, sellQty)
  const matched = basis != null ? matchLotsToBasis(lots, sellQty, basis) : null
  const fee = Math.abs(t.commissions ?? 0)
  if (matched && matched.length > 0) {
    const slices: CloseSlice[] = matched.map(m => {
      const lot = lots[m.index]
      const buyQty = Math.abs(lot.trade.quantity) || m.qty
      return {
        qty: m.qty,
        openDate: lot.date,
        openPrice: lot.price,
        basis: m.basis,
        pnl: t.tradePrice * m.qty - m.basis - fee * (m.qty / sellQty),
        openFees: Math.abs(lot.trade.commissions ?? 0) * (m.qty / buyQty),
        closeFees: fee * (m.qty / sellQty),
        lotIndex: m.index,
        openTrade: lot.trade,
      }
    })
    const total = tradeRealized(t, sellQty)
    if (total != null) snapPnl(slices, total)
    for (const sl of slices) {
      if (sl.lotIndex == null) continue
      lots[sl.lotIndex].remaining -= sl.qty
    }
    return slices
  }
  // The lot IBKR closed isn't in this trade list (opened outside the Flex
  // window). Book its basis and P&L, and leave every other lot open —
  // consuming the newest buy here is what paired Ashton's sale with the
  // $104.25 assignment.
  const price = basis != null && sellQty > 0 ? basis / sellQty : 0
  return [{
    qty: sellQty,
    openDate: '',
    openPrice: price,
    basis: basis ?? price * sellQty,
    pnl: tradeRealized(t, sellQty) ?? 0,
    openFees: 0,
    closeFees: fee,
    lotIndex: null,
  }]
}

function closedSharePosition(
  ticker: string,
  sell: RawTrade,
  slice: CloseSlice,
  seq: number,
  labels: Record<string, TradeLabel>,
  ibkr: boolean,
): JournalPosition {
  const buyId = slice.openTrade ? tradeId(slice.openTrade) : null
  const sellId = tradeId(sell)
  const action = ibkr
    ? 'Buy (closed lot)'
    : (slice.openTrade ? openBuyAction(slice.openTrade) : 'Buy')
  return {
    id: `stk|${ticker}|${slice.openDate || sell.tradeDate}|${seq}`,
    underlying: ticker,
    contracts: slice.qty,
    strikeDisplay: 'SHARES',
    strikes: [],
    putCall: '',
    expiry: '',
    dateOpen: slice.openDate,
    initialDTE: 0,
    openFees: slice.openFees,
    netPremium: -slice.basis,
    status: 'Closed',
    strategy: (buyId ? labels[buyId] : undefined) ?? labels[sellId] ?? 'shares',
    tradeIds: buyId ? [buyId, sellId] : [sellId],
    dateClosed: sell.tradeDate,
    closeFees: slice.closeFees,
    pnl: slice.pnl,
    holdDays: slice.openDate ? Math.max(0, daysBetween(slice.openDate, sell.tradeDate)) : 0,
    shareFills: [
      {
        date: slice.openDate,
        action,
        role: 'closed-lot',
        quantity: slice.qty,
        price: slice.openPrice,
        fees: slice.openFees,
        total: slice.basis,
      },
      {
        date: sell.tradeDate,
        action: 'Sell',
        role: 'sell',
        quantity: slice.qty,
        price: sell.tradePrice,
        fees: slice.closeFees,
        total: sell.tradePrice * slice.qty,
      },
    ],
  }
}

function openSharePosition(ticker: string, lot: MutableLot, seq: number, labels: Record<string, TradeLabel>): JournalPosition {
  const buy = lot.trade
  const qty = lot.remaining
  const buyQty = Math.abs(buy.quantity) || qty
  const openFees = Math.abs(buy.commissions ?? 0) * (qty / buyQty)
  const basis = buy.tradePrice * qty
  return {
    id: `stk|${ticker}|${buy.tradeDate}|open${seq}`,
    underlying: ticker,
    contracts: qty,
    strikeDisplay: 'SHARES',
    strikes: [],
    putCall: '',
    expiry: '',
    dateOpen: buy.tradeDate,
    initialDTE: 0,
    openFees,
    netPremium: -basis,
    status: 'Active',
    strategy: labels[tradeId(buy)] ?? 'shares',
    tradeIds: [tradeId(buy)],
    shareFills: [{
      date: buy.tradeDate,
      action: openBuyAction(buy),
      role: 'open',
      quantity: qty,
      price: buy.tradePrice,
      fees: openFees,
      total: basis,
    }],
  }
}

function flexOpenPosition(symbol: string, lot: NonNullable<RawPosition['openLots']>[number], index: number, trades: RawTrade[]): JournalPosition {
  const buy = trades.find(t =>
    t.assetClass === 'STK' && t.symbol === symbol && t.quantity > 0
    && sameDay(t.tradeDate, lot.openDate ?? '')
    && pricesClose(t.tradePrice, lot.costBasisPrice))
  const basis = lot.costBasisMoney !== 0 ? lot.costBasisMoney : lot.costBasisPrice * lot.quantity
  const price = lot.costBasisPrice || (lot.quantity !== 0 ? Math.abs(basis) / Math.abs(lot.quantity) : 0)
  const assigned = !!buy && Math.abs(buy.commissions ?? 0) < 0.005 && !buy.isTransfer
  return {
    id: `stk|${symbol}|flex|${lot.openDate ?? 'x'}|${index}`,
    underlying: symbol,
    contracts: lot.quantity,
    strikeDisplay: 'SHARES',
    strikes: [],
    putCall: '',
    expiry: '',
    dateOpen: lot.openDate ?? buy?.tradeDate ?? '',
    initialDTE: 0,
    openFees: 0,
    netPremium: -basis,
    status: 'Active',
    strategy: 'shares',
    tradeIds: buy ? [tradeId(buy)] : [],
    shareFills: [{
      date: lot.openDate ?? buy?.tradeDate ?? '',
      action: assigned ? 'Buy (assigned)' : 'Buy',
      role: 'open',
      quantity: lot.quantity,
      price,
      fees: 0,
      total: Math.abs(basis),
    }],
  }
}

function residualOpenPosition(symbol: string, qty: number, basis: number): JournalPosition {
  const price = qty !== 0 ? basis / qty : 0
  return {
    id: `stk|${symbol}|untracked`,
    underlying: symbol,
    contracts: qty,
    strikeDisplay: 'SHARES',
    strikes: [],
    putCall: '',
    expiry: '',
    dateOpen: '',
    initialDTE: 0,
    openFees: 0,
    netPremium: -basis,
    status: 'Active',
    strategy: 'shares',
    tradeIds: [],
    shareFills: [{
      date: '',
      action: 'Buy',
      role: 'open',
      quantity: qty,
      price,
      fees: 0,
      total: Math.abs(basis),
    }],
  }
}

/** Replace reconstructed open lots with Flex Open Positions lots when the
 * snapshot has them, and otherwise top up share count with the part of
 * IBKR's basis the trade list never contained. */
function reconcileOpenShares(positions: JournalPosition[], livePositions: RawPosition[] | undefined, trades: RawTrade[]): JournalPosition[] {
  if (!livePositions || livePositions.length === 0) return positions
  const bySymbol = new Map<string, RawPosition[]>()
  for (const lp of livePositions) {
    if (lp.assetClass !== 'STK') continue
    const list = bySymbol.get(lp.symbol) ?? []
    list.push(lp)
    bySymbol.set(lp.symbol, list)
  }
  let out = positions
  for (const [symbol, rows] of bySymbol) {
    const liveQty = rows.reduce((s, r) => s + r.quantity, 0)
    const lots = rows.flatMap(r => r.openLots ?? [])
    if (Math.abs(liveQty) < 1e-6 && lots.length === 0) {
      out = out.filter(p => !(p.underlying === symbol && p.status === 'Active' && p.strikeDisplay === 'SHARES'))
      continue
    }
    if (lots.length > 0) {
      out = out.filter(p => !(p.underlying === symbol && p.status === 'Active' && p.strikeDisplay === 'SHARES'))
      lots.forEach((lot, i) => {
        if (Math.abs(lot.quantity) < 1e-6) return
        out.push(flexOpenPosition(symbol, lot, i, trades))
      })
      const lotQty = lots.reduce((s, l) => s + l.quantity, 0)
      const lotBasis = lots.reduce((s, l) => s + l.costBasisMoney, 0)
      const liveBasis = rows.reduce((s, r) => s + r.costBasisMoney, 0)
      const residualQty = liveQty - lotQty
      if (residualQty > 1e-4) out.push(residualOpenPosition(symbol, residualQty, liveBasis - lotBasis))
      continue
    }
    const active = out.filter(p => p.underlying === symbol && p.status === 'Active' && p.strikeDisplay === 'SHARES')
    const explainedQty = active.reduce((s, p) => s + p.contracts, 0)
    const explainedBasis = active.reduce((s, p) => s + (-p.netPremium), 0)
    const gap = liveQty - explainedQty
    if (gap <= 1e-4) continue
    const liveBasis = rows.reduce((s, r) => s + r.costBasisMoney, 0)
    const residualBasis = liveBasis - explainedBasis
    // Prefer the residual of IBKR's own basis. If the trades already
    // account for more basis than IBKR reports (a lot we couldn't match),
    // don't invent a negative-cost stub — the snapshot's average still
    // beats a blank.
    const basis = residualBasis > 0 ? residualBasis : (rows[0]?.costBasisPrice ?? 0) * gap
    out.push(residualOpenPosition(symbol, gap, basis))
  }
  return out
}

export function buildStockPositions(
  trades: RawTrade[],
  labels: Record<string, TradeLabel>,
  livePositions?: RawPosition[],
): JournalPosition[] {
  const stockTrades = trades.filter(t => t.assetClass === 'STK')

  const byTicker = new Map<string, RawTrade[]>()
  for (const t of stockTrades) {
    if (!byTicker.has(t.symbol)) byTicker.set(t.symbol, [])
    byTicker.get(t.symbol)!.push(t)
  }

  const positions: JournalPosition[] = []

  for (const [ticker, tsRaw] of byTicker) {
    const ts = [...tsRaw].sort((a, b) => a.tradeDate.localeCompare(b.tradeDate) || (a.tradeTime ?? '').localeCompare(b.tradeTime ?? ''))
    const openLots: MutableLot[] = []
    let seq = 0

    for (const t of ts) {
      if (t.quantity > 0) {
        openLots.push({ trade: t, remaining: t.quantity, price: t.tradePrice, date: t.tradeDate })
        continue
      }
      if (t.quantity >= 0) continue

      const sellQty = Math.abs(t.quantity)
      if (hasIbkrClose(t)) {
        const slices = t.closedLots && t.closedLots.length > 0
          ? slicesFromClosedLots(t, openLots, sellQty)
          : slicesFromCost(t, openLots, sellQty)
        for (const slice of slices) {
          seq++
          positions.push(closedSharePosition(ticker, t, slice, seq, labels, true))
        }
        dropEmpty(openLots)
        continue
      }

      // No IBKR basis on this fill. Newest lot first — the previous
      // fallback — so a same-day partial sale still realises against the
      // lot it came out of when the file can't say which one IBKR used.
      let sellRemaining = sellQty
      const sellFeesTotal = Math.abs(t.commissions ?? 0)
      while (sellRemaining > 0 && openLots.length > 0) {
        const lotIndex = openLots.length - 1
        const lot = openLots[lotIndex]
        const matched = Math.min(lot.remaining, sellRemaining)
        const buyTrade = lot.trade
        const buyFeesShare = Math.abs(buyTrade.commissions ?? 0) * (matched / Math.abs(buyTrade.quantity))
        const sellFeesShare = sellFeesTotal * (matched / sellQty)
        const buyCost = buyTrade.tradePrice * matched
        const sellProceeds = t.tradePrice * matched
        seq++
        positions.push(closedSharePosition(ticker, t, {
          qty: matched,
          openDate: buyTrade.tradeDate,
          openPrice: buyTrade.tradePrice,
          basis: buyCost,
          pnl: sellProceeds - buyCost - buyFeesShare - sellFeesShare,
          openFees: buyFeesShare,
          closeFees: sellFeesShare,
          lotIndex,
          openTrade: buyTrade,
        }, seq, labels, false))
        lot.remaining -= matched
        sellRemaining -= matched
        if (lot.remaining <= 1e-6) openLots.splice(lotIndex, 1)
      }
    }

    for (const lot of openLots) {
      if (lot.remaining <= 1e-6) continue
      seq++
      positions.push(openSharePosition(ticker, lot, seq, labels))
    }
  }

  return reconcileOpenShares(positions, livePositions, stockTrades)
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
