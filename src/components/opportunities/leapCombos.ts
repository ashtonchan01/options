import type { ScanResult } from '../../types'
import { LEAP_ANY_MIN_DTE } from '../../services/cboe'

/** LEAP call bought alone vs the same call financed by selling a put at the
 * same expiry (a "risk reversal" / synthetic long) — every call×put pair at
 * a shared expiry is a candidate, ranked against each other so the user can
 * compare structures (e.g. an ATM call + a further-out short put vs their
 * usual strikes) instead of the tool silently picking just one. */
export interface TermNeighbor {
  expiry: string
  dte: number
  /** Cost of time per day at that expiry, same units as SyntheticLongCombo.debitPerDay. */
  debitPerDay: number
}

export interface SyntheticLongCombo {
  call: ScanResult
  put: ScanResult
  dte: number
  straightCost: number      // call.mid * 100 — cash outlay buying the LEAP alone
  straightBreakeven: number // call.strike + call.mid
  comboNetCost: number      // (call.mid - put.mid) * 100 — put credit offsets the call debit
  comboBreakeven: number    // solved across the two strikes, see comboBreakevenPrice
  costReduction: number     // % less cash outlay the combo needs vs the straight LEAP
  comboDelta: number        // call.delta + |put.delta| — combined position delta (more stock-like)
  assignmentRisk: number    // |put.delta| — rough probability the short put gets assigned
  putCollateral: number     // Reg-T margin for the short put per contract (not full cash-secured
                            // collateral — see regTPutMargin)
  totalCapital: number      // comboNetCost + putCollateral — cash needed for the debit AND cash
                            // set aside for the put, held simultaneously (not offsetting)
  moneyness: number         // |call.strike - spot| + |put.strike - spot| — how far both legs sit
                            // from the current stock price, combined; lower = closer to the money
  compositeScore: number    // 0-100, ranks this ticker's own combos against each other
  /** ANY 1Y+ only. Cost of time per day: net debit minus intrinsic, divided by DTE.
   * Intrinsic is identical at every expiry for these strikes, so this is the
   * part of the price that is actually about time. */
  debitPerDay?: number
  /** ANY 1Y+ only. The same strikes on the neighbouring expiries, so the row
   * can show why this one was flagged. */
  termNeighbors?: TermNeighbor[]
  /** ANY 1Y+ only. How many dollars per day this combo's cost of time sits
   * under the line drawn through the same strikes at the other expiries.
   * Larger = cheaper versus the rest of the chain. */
  termGap?: number
}

/** `call.strike + netCost` (the naive "long call" breakeven formula) is only
 * correct when the short put shares the SAME strike as the call — a true
 * synthetic long. Once the strikes differ (as they will for most of these
 * combos — e.g. a put struck ABOVE the current stock price for extra
 * credit), the position has a kink at each strike and that formula is
 * wrong: it ignores the assignment loss on the put entirely below its own
 * strike. The real payoff at expiry, per share, is
 *   P(S) = max(S - callStrike, 0) - max(putStrike - S, 0) - netCostPerShare
 * which is non-decreasing in S (long call delta + short put delta is always
 * ≥ 0), so it crosses zero exactly once — found here by sampling the three
 * linear segments the two strikes split the price axis into and
 * interpolating within whichever segment brackets the sign change, rather
 * than assuming a single-strike shape. */
export function comboBreakevenPrice(callStrike: number, putStrike: number, netCostPerShare: number): number {
  const lo = Math.min(callStrike, putStrike)
  const hi = Math.max(callStrike, putStrike)
  // Solved directly per segment instead of sampling fixed points and
  // interpolating — a prior version picked sample points only `hi - lo`
  // past the strikes, which isn't far enough to reach the actual root
  // whenever netCostPerShare is large relative to the strike spread (e.g.
  // callStrike=350, putStrike=360, net=26.37/share — the true breakeven is
  // 376.37, well past the old 371 sample ceiling), so the loop found no
  // sign change and silently fell back to `hi` (the put strike) as a wrong
  // answer instead of the real breakeven.
  //
  // Below both strikes: payoff = (putStrike - S) is owed, so
  // payoff(S) = S - putStrike - netCostPerShare → root at putStrike + net.
  const belowRoot = putStrike + netCostPerShare
  if (belowRoot <= lo) return belowRoot
  // Between the strikes: payoff(S) = 2S - callStrike - putStrike - net →
  // root at (callStrike + putStrike + net) / 2.
  const betweenRoot = (callStrike + putStrike + netCostPerShare) / 2
  if (betweenRoot >= lo && betweenRoot <= hi) return betweenRoot
  // Above both strikes: payoff(S) = S - callStrike - net → root at
  // callStrike + net.
  return callStrike + netCostPerShare
}

/** Every call×put pair sharing an expiry where the CALL strike sits BELOW
 * the PUT strike, ranked chiefly by net cash outlay — the actual premium
 * paid out of pocket, which is what a $10K personal budget refers to.
 *
 * Put margin (still shown, via regTPutMargin) is NOT folded into the hard
 * cap or the ranking weight the way an earlier version of this did. That
 * was a mistake: margin is collateral a broker holds against existing
 * account equity, not cash spent the same way premium is, and Reg-T's own
 * formula has a floor of 20% of the stock's notional value REGARDLESS of
 * how close the strikes are — for a real, reasonable combo the user found
 * by hand (TSLA 330C/360P, ~$3,535 net debit), that floor alone is ~$6,954,
 * pushing a combined "total capital" over $10K and silently excluding a
 * combo that was actually fine. Net cost is what actually needs to fit a
 * cash budget; margin is real but a separate concern, shown for context
 * (and still bounded by MAX_PUT_STRIKE_OVER_SPOT so it can't run wild) but
 * no longer a hard gate on top of it. */
export const MAX_PUT_STRIKE_OVER_SPOT = 1.15
// The user's own stated personal budget for a combo's net cash outlay —
// not total capital including margin (see note above on why those aren't
// folded together).
export const MAX_NET_COST_ABSOLUTE = 10_000

export function regTPutMargin(stockPrice: number, putStrike: number, putMid: number): number {
  const otmAmount = Math.max(stockPrice - putStrike, 0)
  const byStockValue = 0.20 * stockPrice * 100 - otmAmount * 100
  const byStrike = 0.10 * putStrike * 100
  return Math.max(byStockValue, byStrike) + putMid * 100
}

function withRankFields(
  call: ScanResult,
  put: ScanResult,
): Omit<SyntheticLongCombo, 'compositeScore'> {
  const straightCost = call.mid * 100
  const straightBreakeven = call.strike + call.mid
  const comboNetCost = (call.mid - put.mid) * 100
  const putCollateral = regTPutMargin(call.stockPrice, put.strike, put.mid)
  const totalCapital = comboNetCost + putCollateral
  const comboBreakeven = comboBreakevenPrice(call.strike, put.strike, call.mid - put.mid)
  const costReduction = straightCost > 0 ? ((straightCost - comboNetCost) / straightCost) * 100 : 0
  const moneyness = Math.abs(call.strike - call.stockPrice) + Math.abs(put.strike - call.stockPrice)
  return {
    call, put, dte: call.dte, straightCost, straightBreakeven, comboNetCost, comboBreakeven, costReduction,
    comboDelta: call.delta + Math.abs(put.delta),
    assignmentRisk: Math.abs(put.delta),
    putCollateral, totalCapital, moneyness,
  }
}

export function buildComboRankings(calls: ScanResult[], puts: ScanResult[]): SyntheticLongCombo[] {
  const combos: Omit<SyntheticLongCombo, 'compositeScore'>[] = []
  for (const call of calls) {
    for (const put of puts) {
      if (put.expiry !== call.expiry) continue
      if (call.strike >= put.strike) continue
      if (put.strike > call.stockPrice * MAX_PUT_STRIKE_OVER_SPOT) continue
      const straightCost = call.mid * 100
      const straightBreakeven = call.strike + call.mid
      const comboNetCost = (call.mid - put.mid) * 100
      if (comboNetCost > MAX_NET_COST_ABSOLUTE) continue
      const putCollateral = regTPutMargin(call.stockPrice, put.strike, put.mid)
      const totalCapital = comboNetCost + putCollateral
      const comboBreakeven = comboBreakevenPrice(call.strike, put.strike, call.mid - put.mid)
      const costReduction = straightCost > 0 ? ((straightCost - comboNetCost) / straightCost) * 100 : 0
      const moneyness = Math.abs(call.strike - call.stockPrice) + Math.abs(put.strike - call.stockPrice)
      combos.push({
        call, put, dte: call.dte, straightCost, straightBreakeven, comboNetCost, comboBreakeven, costReduction,
        comboDelta: call.delta + Math.abs(put.delta),
        assignmentRisk: Math.abs(put.delta),
        putCollateral, totalCapital, moneyness,
      })
    }
  }
  if (combos.length === 0) return []

  // assignmentRisk (the short put's own delta) matters even when net cost and
  // breakeven are close: a $390 put and a $360 put on the same stock can cost
  // about the same and land a similar breakeven, but the $390 put is deeper
  // ITM — higher delta, meaningfully more likely to actually get assigned,
  // and a bigger obligation if it is. The user preferred their own $360 put
  // over this ranking's $390 pick for exactly that reason once cost stopped
  // being the deciding factor, so assignment risk is now a real weight, not
  // just informational.
  const costs = combos.map(c => c.comboNetCost)
  const beps = combos.map(c => c.comboBreakeven)
  const deltas = combos.map(c => c.call.delta)
  const risks = combos.map(c => c.assignmentRisk)
  const moneynessVals = combos.map(c => c.moneyness)
  const costRange = [Math.min(...costs), Math.max(...costs)] as const
  const bepRange = [Math.min(...beps), Math.max(...beps)] as const
  const deltaRange = [Math.min(...deltas), Math.max(...deltas)] as const
  const riskRange = [Math.min(...risks), Math.max(...risks)] as const
  const moneynessRange = [Math.min(...moneynessVals), Math.max(...moneynessVals)] as const
  const norm = (v: number, [lo, hi]: readonly [number, number]) => hi > lo ? (v - lo) / (hi - lo) : 0.5

  // Cost-led three-way balance: net cost, breakeven, and moneyness (both
  // strikes close to the current stock price) — but net cost now leads.
  // A real MRVL example exposed the previous even split as too timid on
  // cost: the top-ranked pick was $175C/$210P at $2,387 net ($204.44 BEP),
  // but the user's own $200C/$210P-area trade cost only $851 for a
  // breakeven just $10 higher ($214) — 2.8x less capital for a trade
  // they're happy to take, and it wasn't even in the top 6. Low capital is
  // the actual goal here; breakeven/moneyness now matter mainly as guard
  // rails against an extreme, low-quality-credit combo winning purely on
  // cost, not as equal partners to cost. Assignment risk and call delta
  // stay as light tiebreakers only.
  return combos
    .map(c => ({
      ...c,
      compositeScore: Math.round((
        (1 - norm(c.comboNetCost, costRange)) * 0.45 +      // less cash paid out of pocket → higher score
        (1 - norm(c.comboBreakeven, bepRange)) * 0.20 +     // lower breakeven → higher score
        (1 - norm(c.moneyness, moneynessRange)) * 0.20 +    // strikes closer to current spot price → higher score
        (1 - norm(c.assignmentRisk, riskRange)) * 0.09 +    // lower put assignment/early-exercise risk
        norm(c.call.delta, deltaRange) * 0.06               // higher call delta (more certain to own the stock)
      ) * 100),
    }))
    .sort((a, b) => b.compositeScore - a.compositeScore)
}

// ─── ANY 1Y+ ────────────────────────────────────────────────────────────────
// The LAST / 2ND LAST / 3RD LAST / ALL 3 buttons keep buildComboRankings
// exactly as it is (call strike below the put, net debit capped at $10k).
// ANY 1Y+ does not use those gates, and it also does not require a net
// credit or a breakeven at or below the stock. Those existed to keep the
// cash outlay down. This mode asks a different question: across every
// expiry at least a year out, which same-strike combo is priced cheap
// relative to the other expiries on this ticker?
//
// Raw debit per day (net / DTE) cannot answer that. The intrinsic value of
// a strike pair is the same at every expiry, so dividing the whole debit
// by DTE makes the furthest expiry look cheapest even when the time value
// is fair. The cost of time is net debit minus that intrinsic. Option time
// value scales with √DTE when vol is flat, so time / √DTE is a straight
// line across a smooth term structure. A combo qualifies when its own
// time / √DTE sits under the chord between the SAME call and put strikes
// on the expiry either side — the price is mismatched, not merely further
// out, and not an extrapolation past the end of the chain. The row shows
// the raw cost-of-time per day next to those neighbouring expiries.

const MIN_SERIES = 3
const MIN_REL_CHEAP = 0.08
const MIN_GAP_PER_DAY = 0.20
// A quote wider than this is mostly spread, not a term-structure kink.
// This is not a budget cap — it keeps a stale wing from looking "cheap".
const MAX_SPREAD_PCT = 0.45
const NORM_SCALE_FLOOR = 20
const MAX_ANY1Y_ROWS = 8

function spreadOk(r: ScanResult): boolean {
  if (!(r.mid > 0)) return false
  return Math.max(r.ask - r.bid, 0) / r.mid <= MAX_SPREAD_PCT
}

/** Dollars of time value in one contract. Intrinsic (call ITM value minus
 * put ITM value) cancels out when the same strikes are compared across
 * expiries, which is the whole point of the comparison. */
function timeValuePerContract(call: ScanResult, put: ScanResult): number {
  const net = (call.mid - put.mid) * 100
  const intrinsic = (
    Math.max(call.stockPrice - call.strike, 0) - Math.max(put.strike - call.stockPrice, 0)
  ) * 100
  return net - intrinsic
}

interface SeriesPoint {
  call: ScanResult
  put: ScanResult
  dte: number
  perDay: number
  norm: number
}

function toAny1yCombo(point: SeriesPoint, neighbors: SeriesPoint[], termGap: number): SyntheticLongCombo {
  const base = withRankFields(point.call, point.put)
  return {
    ...base,
    compositeScore: Math.round(Math.max(0, Math.min(100, termGap * 20))),
    debitPerDay: point.perDay,
    termGap,
    termNeighbors: neighbors
      .slice()
      .sort((a, b) => a.dte - b.dte)
      .map(n => ({ expiry: n.call.expiry, dte: n.dte, debitPerDay: n.perDay })),
  }
}

export function buildAny1yCombos(calls: ScanResult[], puts: ScanResult[]): SyntheticLongCombo[] {
  const leapCalls = calls.filter(c => c.dte >= LEAP_ANY_MIN_DTE && c.ask > 0 && spreadOk(c))
  const leapPuts = puts.filter(p =>
    p.dte >= LEAP_ANY_MIN_DTE && p.bid > 0 && spreadOk(p),
  )

  const putsByKey = new Map<string, ScanResult>()
  for (const put of leapPuts) putsByKey.set(`${put.underlying}|${put.expiry}|${put.strike}`, put)

  const callsByStructure = new Map<string, ScanResult[]>()
  for (const call of leapCalls) {
    const key = `${call.underlying}|${call.strike}`
    const list = callsByStructure.get(key)
    if (list) list.push(call)
    else callsByStructure.set(key, [call])
  }

  const putStrikesByUnderlying = new Map<string, number[]>()
  for (const put of leapPuts) {
    const list = putStrikesByUnderlying.get(put.underlying)
    if (list) {
      if (!list.includes(put.strike)) list.push(put.strike)
    } else putStrikesByUnderlying.set(put.underlying, [put.strike])
  }

  const candidates: SyntheticLongCombo[] = []

  for (const [key, callSeries] of callsByStructure) {
    const underlying = key.slice(0, key.lastIndexOf('|'))
    const spot = callSeries[0].stockPrice
    const putStrikes = putStrikesByUnderlying.get(underlying) ?? []
    // One quote per expiry. A duplicate strike in the chain shouldn't
    // create two points on the same date and bend the line.
    const byExpiry = new Map<string, ScanResult>()
    for (const call of callSeries) if (!byExpiry.has(call.expiry)) byExpiry.set(call.expiry, call)

    for (const putStrike of putStrikes) {
      if (putStrike > spot * MAX_PUT_STRIKE_OVER_SPOT) continue
      const points: SeriesPoint[] = []
      for (const call of byExpiry.values()) {
        const put = putsByKey.get(`${underlying}|${call.expiry}|${putStrike}`)
        if (!put) continue
        const time = timeValuePerContract(call, put)
        points.push({
          call, put, dte: call.dte,
          perDay: time / call.dte,
          norm: time / Math.sqrt(call.dte),
        })
      }
      if (points.length < MIN_SERIES) continue
      points.sort((a, b) => a.dte - b.dte)

      // Only an expiry that has another one on each side. Fitting a line
      // through every other point and then extrapolating past the end of
      // the chain made the nearest or furthest expiry look "cheap" when
      // the two expiries next to it were ordinary. The comparison the row
      // shows is these two neighbours, so the line is the chord between
      // them — nothing else.
      for (let i = 1; i < points.length - 1; i++) {
        const left = points[i - 1]
        const right = points[i + 1]
        const span = right.dte - left.dte
        if (span <= 0) continue
        const t = (points[i].dte - left.dte) / span
        const predicted = left.norm + (right.norm - left.norm) * t
        const gapNorm = predicted - points[i].norm
        const gapDay = gapNorm / Math.sqrt(points[i].dte)
        const rel = gapNorm / Math.max(Math.abs(predicted), NORM_SCALE_FLOOR)
        // No strike-order gate, no $10k cap, no "must be a credit", no
        // "breakeven at or below the stock". Cheap versus the neighbouring
        // expiries is the only qualifier.
        if (gapDay < MIN_GAP_PER_DAY || rel < MIN_REL_CHEAP) continue
        candidates.push(toAny1yCombo(points[i], [left, right], gapDay))
      }
    }
  }

  candidates.sort((a, b) => (b.termGap ?? 0) - (a.termGap ?? 0) || (a.debitPerDay ?? 0) - (b.debitPerDay ?? 0))

  // Near-duplicate put ladders on the same call and expiry all tell the
  // same story. Keep the cheapest and move on to a different structure.
  const picked: SyntheticLongCombo[] = []
  for (const combo of candidates) {
    const spot = combo.call.stockPrice || 1
    const duplicate = picked.some(other =>
      other.call.expiry === combo.call.expiry &&
      Math.abs(other.call.strike - combo.call.strike) <= Math.max(5, spot * 0.025) &&
      Math.abs(other.put.strike - combo.put.strike) <= Math.max(5, spot * 0.04)
    )
    if (duplicate) continue
    picked.push(combo)
    if (picked.length >= MAX_ANY1Y_ROWS) break
  }
  return picked
}
