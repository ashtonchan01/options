import { useState, useMemo, useEffect } from 'react'
import { Scan, AlertCircle, Activity, ChevronDown, ChevronUp } from 'lucide-react'
import type { AppState, ScanResult, ScanFlag } from '../../types'
import { scanAllTickersCboe, LEAP_MAX_DTE, LEAP_MIN_DTE } from '../../services/cboe'
import { fetchEarningsDates } from '../../services/earnings'
import { fetchFomcDates } from '../../services/fomc'

interface Props {
  state: AppState
  tickers: string[]
  onAddTicker: (symbol: string) => void
  onRemoveTicker: (symbol: string) => void
}

// ─── Scan filter params (user-adjusted, no preset modes) ─────────────────────

interface ModeConfig {
  deltaMin: number; deltaMax: number
  dteMin: number;   dteMax: number
  minBid: number
}

// Two independent scanners, not one shared param set with a shared DTE
// range — Short Term (0-60 DTE, weekly/monthly premium-selling territory)
// and Long Term (60-365 DTE, LEAP-style) want genuinely different delta/DTE
// defaults, and switching between them shouldn't clobber whichever one you
// were tuning. Each term keeps its own params, persisted separately.
export type ScanTerm = 'short' | 'long'
const TERM_BOUNDS: Record<ScanTerm, { dteFloor: number; dteCeil: number }> = {
  short: { dteFloor: 1,  dteCeil: 60 },
  long:  { dteFloor: 60, dteCeil: 365 },
}
const CUSTOM_CFG_KEY: Record<ScanTerm, string> = {
  short: 'options:custom_cfg_short',
  long:  'options:custom_cfg_long',
}
const DEFAULT_CUSTOM: Record<ScanTerm, ModeConfig> = {
  short: { deltaMin: 0.10, deltaMax: 0.25, dteMin: 7,  dteMax: 60,  minBid: 0.05 },
  long:  { deltaMin: 0.10, deltaMax: 0.30, dteMin: 60, dteMax: 365, minBid: 0.05 },
}
const TERM_LABEL: Record<ScanTerm, string> = { short: 'Short Term (≤60d)', long: 'Long Term (60-365d)' }
const SCAN_TERM_KEY = 'options:scan_term'

function loadCustomCfg(term: ScanTerm): ModeConfig {
  try { return JSON.parse(localStorage.getItem(CUSTOM_CFG_KEY[term]) || 'null') ?? DEFAULT_CUSTOM[term] } catch { return DEFAULT_CUSTOM[term] }
}
function loadScanTerm(): ScanTerm {
  const v = localStorage.getItem(SCAN_TERM_KEY)
  return v === 'long' ? 'long' : 'short'
}

function filterByMode(results: ScanResult[], cfg: ModeConfig): ScanResult[] {
  return results.filter(r => {
    // LEAP candidates are selected entirely by cboe.ts's own delta/DTE/
    // liquidity rules (deep-ITM-to-ATM, 180+ DTE) and the combo-ranking
    // formula — none of the user-tunable PARAMS below (tuned for CSP/CC
    // credit-selling) apply to them, so a LEAP result is never excluded here.
    if (r.strategyType === 'leap') return true
    // A long-dated put (dte >= LEAP_MIN_DTE) only ever exists in the scan to
    // be a Synthetic Long combo's short leg — this app's cboe.ts already
    // widened what candidates get fetched for exactly that reason. But this
    // filter runs on the SAME shared `results` list the CSP tab reads from,
    // and Long Term's own dteMax defaults to 365 — well short of a LEAP's
    // 800+ DTE — so those puts were being silently clamped out here even
    // after cboe.ts stopped excluding them, leaving the combo builder with
    // no puts at all to pair against the furthest-dated LEAP calls. Exempt
    // them from the CSP dte/delta/bid bounds the same way LEAP itself is.
    if (r.strategyType === 'csp' && r.dte >= LEAP_MIN_DTE) return true
    const d = Math.abs(r.delta)
    return d >= cfg.deltaMin && d <= cfg.deltaMax && r.dte >= cfg.dteMin && r.dte <= cfg.dteMax && r.bid >= cfg.minBid
  })
}

// ─── Flags ────────────────────────────────────────────────────────────────────

const FLAG_COLORS: Record<ScanFlag, string> = {
  HIGH_VOL: '#00E5FF', HIGH_V_OI: '#f59e0b', IV_SPIKE: '#a855f7', NEAR_TERM: '#10b981',
}
const FLAG_LABELS: Record<ScanFlag, string> = {
  HIGH_VOL: 'VOL', HIGH_V_OI: 'V/OI', IV_SPIKE: 'IV', NEAR_TERM: 'NEAR',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtExp(s: string): string {
  const m = s.match(/^(\d{4})(\d{2})(\d{2})$/)
  return m ? `${parseInt(m[2])}/${parseInt(m[3])}` : s
}
/** 'YYYYMMDD' -> 'YYYY-MM-DD' so it's directly comparable to earnings dates. */
function normalizeExpiry(s: string): string {
  const m = s.match(/^(\d{4})(\d{2})(\d{2})$/)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : s
}
function todayYMD(): string {
  return new Date().toISOString().slice(0, 10)
}
/** Nearest upcoming earnings date for a ticker, or null if none known. */
function nextEarningsFor(sym: string, earningsMap: Record<string, string[]>): string | null {
  const dates = earningsMap[sym]
  if (!dates?.length) return null
  const today = todayYMD()
  const upcoming = dates.filter(d => d >= today).sort()
  return upcoming[0] ?? null
}
/** Monday–Sunday range (as 'YYYY-MM-DD') containing the given date. */
function weekRange(dateStr: string): { start: string; end: string } {
  const d = new Date(`${dateStr}T12:00:00`)
  const dow = d.getDay() || 7 // Mon=1 … Sun=7
  const monday = new Date(d); monday.setDate(d.getDate() - (dow - 1))
  const sunday = new Date(d); sunday.setDate(d.getDate() + (7 - dow))
  const toYMD = (x: Date) => x.toISOString().slice(0, 10)
  return { start: toYMD(monday), end: toYMD(sunday) }
}
/** True if this option's expiry falls in the same Mon–Sun week as the ticker's next earnings date. */
function expiryInEarningsWeek(expiry: string, nextEarnings: string | null): boolean {
  if (nextEarnings === null) return false
  const exp = normalizeExpiry(expiry)
  const { start, end } = weekRange(nextEarnings)
  return exp >= start && exp <= end
}
/** True if this option's expiry falls in the same Mon–Sun week as any upcoming FOMC
 * rate-decision date — those weeks see outsized index/vol moves regardless of ticker. */
function expiryInFomcWeek(expiry: string, fomcDates: string[]): boolean {
  const exp = normalizeExpiry(expiry)
  return fomcDates.some(d => {
    const { start, end } = weekRange(d)
    return exp >= start && exp <= end
  })
}
const MONTH_ABBR = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC']
/** LEAP expiries are commonly 1-3 years out, where "6/17" (month/day) reads
 * ambiguously without knowing the year — a month + year is what actually
 * distinguishes a Jun-2027 LEAP from a Jun-2028 one. Numeric "12/28" (not
 * "DEC 28") to avoid reading as a day-of-month at a glance. */
function fmtExpMonthYear(s: string): string {
  const m = s.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (!m) return s
  return `${parseInt(m[2])}/${m[1].slice(2)}`
}
function fmtEr(d: string): string {
  const [, m, day] = d.split('-')
  return `${MONTH_ABBR[parseInt(m) - 1]} ${parseInt(day)}`
}
function scoreColor(s: number)  { return s >= 70 ? '#10b981' : s >= 40 ? '#f59e0b' : 'var(--text-4)' }
function deltaColor(d: number)  { const a = Math.abs(d); return a < 0.15 ? 'var(--text-3)' : a > 0.40 ? '#f59e0b' : '#10b981' }
function tradeYield(r: ScanResult) { return r.annualizedYield * r.dte / 365 }
/** Breakeven price after the premium received. CSP: strike minus credit —
 * the effective cost basis if assigned. Covered call: strike plus credit —
 * if called away, the total received per share is the strike plus the
 * premium already collected. */
function breakeven(r: ScanResult) { return r.strategyType === 'csp' ? r.strike - r.mid : r.strike + r.mid }

// ─── Card width ───────────────────────────────────────────────────────────────

// Widened from 400px — the results grid (STRIKE/EXP/DTE/DELTA/CREDIT/BEP/
// YIELD/APY/SCR) no longer fit comfortably at 400px once the APY column was
// added, squeezing the STRIKE column and making header labels crowd each
// other.
const CARD_W = 'min(460px, 100%)'

// ─── Ticker card data ─────────────────────────────────────────────────────────

/** LEAP call bought alone vs the same call financed by selling a put at the
 * same expiry (a "risk reversal" / synthetic long) — every call×put pair at
 * a shared expiry is a candidate, ranked against each other so the user can
 * compare structures (e.g. an ATM call + a further-out short put vs their
 * usual strikes) instead of the tool silently picking just one. */
interface SyntheticLongCombo {
  call: ScanResult
  put: ScanResult
  dte: number
  straightCost: number      // call.mid * 100 — cash outlay buying the LEAP alone
  straightBreakeven: number // call.strike + call.mid
  comboNetCost: number      // (call.mid - put.mid) * 100 — put credit offsets the call debit
  comboBreakeven: number    // call.strike + call.mid - put.mid
  costReduction: number     // % less cash outlay the combo needs vs the straight LEAP
  comboDelta: number        // call.delta + |put.delta| — combined position delta (more stock-like)
  assignmentRisk: number    // |put.delta| — rough probability the short put gets assigned
  putCollateral: number     // Reg-T margin for the short put per contract (not full cash-secured
                            // collateral — see regTPutMargin)
  totalCapital: number      // comboNetCost + putCollateral — cash needed for the debit AND cash
                            // set aside for the put, held simultaneously (not offsetting)
  compositeScore: number    // 0-100, ranks this ticker's own combos against each other
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
function comboBreakevenPrice(callStrike: number, putStrike: number, netCostPerShare: number): number {
  const payoff = (S: number) => Math.max(S - callStrike, 0) - Math.max(putStrike - S, 0) - netCostPerShare
  const lo = Math.min(callStrike, putStrike)
  const hi = Math.max(callStrike, putStrike)
  const span = Math.max(hi - lo, 1)
  const points = [lo - span - 1, lo, hi, hi + span + 1]
  for (let i = 0; i < points.length - 1; i++) {
    const x1 = points[i], x2 = points[i + 1]
    const y1 = payoff(x1), y2 = payoff(x2)
    if ((y1 <= 0 && y2 >= 0) || (y1 >= 0 && y2 <= 0)) {
      if (y1 === y2) return x1
      return x1 + (-y1 / (y2 - y1)) * (x2 - x1)
    }
  }
  return hi // shouldn't happen — payoff is monotonic non-decreasing
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
const MAX_PUT_STRIKE_OVER_SPOT = 1.15
// The user's own stated personal budget for a combo's net cash outlay —
// not total capital including margin (see note above on why those aren't
// folded together).
const MAX_NET_COST_ABSOLUTE = 10_000

function regTPutMargin(stockPrice: number, putStrike: number, putMid: number): number {
  const otmAmount = Math.max(stockPrice - putStrike, 0)
  const byStockValue = 0.20 * stockPrice * 100 - otmAmount * 100
  const byStrike = 0.10 * putStrike * 100
  return Math.max(byStockValue, byStrike) + putMid * 100
}

function buildComboRankings(calls: ScanResult[], puts: ScanResult[]): SyntheticLongCombo[] {
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
      combos.push({
        call, put, dte: call.dte, straightCost, straightBreakeven, comboNetCost, comboBreakeven, costReduction,
        comboDelta: call.delta + Math.abs(put.delta),
        assignmentRisk: Math.abs(put.delta),
        putCollateral, totalCapital,
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
  const costRange = [Math.min(...costs), Math.max(...costs)] as const
  const bepRange = [Math.min(...beps), Math.max(...beps)] as const
  const deltaRange = [Math.min(...deltas), Math.max(...deltas)] as const
  const riskRange = [Math.min(...risks), Math.max(...risks)] as const
  const norm = (v: number, [lo, hi]: readonly [number, number]) => hi > lo ? (v - lo) / (hi - lo) : 0.5

  // Cost dominates; the rest only break ties among similarly-priced combos.
  // A straight weighted blend let a big assignment-risk improvement outscore
  // a real ~$5k cost difference, which didn't match "I'll pay a bit more for
  // a strike I'm comfortable with, but cost comes first." Bucketing net cost
  // into $750 bands before applying the other factors makes cost the primary
  // sort key while still letting risk/delta/breakeven decide among combos
  // that cost roughly the same.
  const COST_BAND = 750
  return combos
    .map(c => ({
      ...c,
      compositeScore: Math.round((
        (1 - norm(c.comboNetCost, costRange)) * 0.40 +    // less cash paid out of pocket → higher score
        (1 - norm(c.assignmentRisk, riskRange)) * 0.25 +   // lower put assignment risk (closer to spot) → higher score
        norm(c.call.delta, deltaRange) * 0.15 +            // higher call delta (more certain to own the stock) → higher score
        (1 - norm(c.comboBreakeven, bepRange)) * 0.20       // lower breakeven → higher score
      ) * 100),
    }))
    .sort((a, b) => {
      const bandA = Math.round(a.comboNetCost / COST_BAND)
      const bandB = Math.round(b.comboNetCost / COST_BAND)
      if (bandA !== bandB) return bandA - bandB
      return b.compositeScore - a.compositeScore
    })
}

interface TickerCard {
  symbol: string; price: number; bestScore: number; avgIv: number
  totalContracts: number; topCsp: ScanResult[]; topCc: ScanResult[]; topLeap: ScanResult[]
  topCombos: SyntheticLongCombo[]
  nextEarnings: string | null
}

function buildCards(results: ScanResult[], tickers: string[], earningsMap: Record<string, string[]>): TickerCard[] {
  const map = new Map<string, { results: ScanResult[]; price: number }>()
  for (const sym of tickers) map.set(sym, { results: [], price: 0 })
  for (const r of results) {
    const e = map.get(r.underlying)
    if (e) { e.results.push(r); if (!e.price) e.price = r.stockPrice }
    else map.set(r.underlying, { results: [r], price: r.stockPrice })
  }
  const cards: TickerCard[] = []
  for (const [symbol, { results: rs, price }] of map) {
    if (!rs.length) continue
    const allLeapCalls = rs.filter(r => r.strategyType === 'leap')
    // Only the ticker's OWN furthest available expiry counts as "the LEAP" —
    // the point of a LEAP is maximum time, so a call expiring in 7 months is
    // not a candidate just because it also clears the 180-day floor. Comparing
    // by dte (not the raw expiry string) picks out every contract sharing
    // that single furthest date, tolerant of the ±1 day rounding that can
    // happen right at a DTE boundary.
    const maxLeapDte = allLeapCalls.length > 0 ? Math.max(...allLeapCalls.map(r => r.dte)) : 0
    const leapCalls = allLeapCalls.filter(r => r.dte >= maxLeapDte - 1)
    const puts = rs.filter(r => r.strategyType === 'csp')

    // The LEAP table above shows the ticker's absolute furthest CALL expiry
    // regardless of puts — but a combo needs a put at that SAME expiry, and
    // some underlyings simply don't have one listed that far out (thin or
    // no put interest at a multi-year date, even though calls exist). Rather
    // than the combo builder silently coming back empty whenever that's the
    // case, walk the call expiries from furthest to nearest and use the
    // first one that actually has a matching long-dated put — the furthest
    // expiry where BOTH legs of a combo are actually available.
    const longDatedPutExpiries = new Set(puts.filter(p => p.dte >= LEAP_MIN_DTE).map(p => p.expiry))
    const callExpiriesByDte = [...new Set(allLeapCalls.map(c => c.expiry))]
      .map(expiry => ({ expiry, dte: allLeapCalls.find(c => c.expiry === expiry)!.dte }))
      .sort((a, b) => b.dte - a.dte)
    const comboExpiry = callExpiriesByDte.find(e => longDatedPutExpiries.has(e.expiry))?.expiry
    const comboCalls = comboExpiry ? allLeapCalls.filter(c => c.expiry === comboExpiry) : []

    cards.push({
      symbol, price,
      bestScore: Math.max(...rs.map(r => r.score)),
      avgIv: rs.reduce((s, r) => s + r.iv, 0) / rs.length,
      totalContracts: rs.length,
      topCsp: puts.slice().sort((a, b) => b.score - a.score).slice(0, 5),
      topCc:  rs.filter(r => r.strategyType === 'covered_call').sort((a, b) => b.score - a.score).slice(0, 5),
      topLeap: leapCalls.slice().sort((a, b) => b.score - a.score).slice(0, 5),
      // Ranks EVERY call×put pair sharing the combo expiry (not just the
      // top-scored LEAP paired with the top-scored put) — the user's actual
      // usage pattern (e.g. an at-the-money call paired with a put struck
      // ABOVE the stock price for a bigger credit) doesn't necessarily
      // involve either leg's individually-top-scored contract.
      topCombos: buildComboRankings(comboCalls, puts).slice(0, 6),
      nextEarnings: nextEarningsFor(symbol, earningsMap),
    })
  }
  return cards.sort((a, b) => b.bestScore - a.bestScore)
}

// ─── Table components ─────────────────────────────────────────────────────────

// Column tracks sized to fit each header label at its own font/letter-spacing —
// previously several (DELTA, CREDIT, YIELD) were narrower than their own header
// text, so the header overflowed left past its column and never lined up with
// the right-aligned numbers below it.
const GRID = '16px minmax(56px,1fr) 46px 28px 40px 46px 46px 40px 40px 28px'

function OptionRow({ r, rank, nextEarnings, fomcDates }: { r: ScanResult; rank: number; nextEarnings: string | null; fomcDates: string[] }) {
  const ty = tradeYield(r)
  const throughEarnings = expiryInEarningsWeek(r.expiry, nextEarnings)
  const throughFomc = !throughEarnings && expiryInFomcWeek(r.expiry, fomcDates)
  const flagColor = throughEarnings ? '#F0B429' : throughFomc ? '#8b5cf6' : undefined
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: GRID, gap: 3, alignItems: 'center', padding: '5px 4px', margin: '0 -4px',
      borderBottom: '1px solid var(--border)', fontSize: 11, fontFamily: 'Inter, sans-serif',
      background: flagColor ? `${flagColor}12` : 'transparent',
      borderLeft: flagColor ? `2px solid ${flagColor}` : '2px solid transparent',
    }}
      title={`Annualized: ${r.annualizedYield.toFixed(0)}% · OI: ${r.openInterest} · V/OI: ${r.volumeOiRatio.toFixed(2)}${throughEarnings ? ` · Expires the week of earnings (${fmtEr(nextEarnings!)})` : throughFomc ? ' · Expires an FOMC decision week' : ''}`}>
      <span style={{ color: 'var(--text-5)', fontSize: 10, textAlign: 'center' }}>{rank}</span>
      <span style={{ color: 'var(--text-1)', fontWeight: 600 }}>${r.strike}</span>
      <span style={{ color: flagColor ?? 'var(--text-3)', textAlign: 'right', fontWeight: flagColor ? 700 : 400, whiteSpace: 'nowrap' }}>
        {fmtExp(r.expiry)}{throughEarnings ? ' ⚡' : throughFomc ? ' 🏛' : ''}
      </span>
      <span style={{ color: 'var(--text-3)', textAlign: 'right' }}>{r.dte}d</span>
      <span style={{ color: deltaColor(r.delta), textAlign: 'right' }}>{r.delta.toFixed(2)}</span>
      <span style={{ color: '#10b981', textAlign: 'right' }}>${r.mid.toFixed(2)}</span>
      <span style={{ color: 'var(--text-2)', textAlign: 'right' }}>${breakeven(r).toFixed(2)}</span>
      <span style={{ color: ty >= 1 ? '#10b981' : 'var(--text-3)', fontWeight: 600, textAlign: 'right' }}>{ty.toFixed(1)}%</span>
      <span style={{ color: r.annualizedYield >= 20 ? '#10b981' : 'var(--text-3)', textAlign: 'right' }}>{r.annualizedYield.toFixed(0)}%</span>
      <span style={{ color: scoreColor(r.score), fontWeight: 700, fontFamily: "'Inter', sans-serif", textAlign: 'right' }}>{r.score}</span>
    </div>
  )
}

// LEAP columns are a debit purchase, not a credit sale — COST (what you pay)
// instead of CREDIT, EXTR/YR (annualized extrinsic cost — lower is better)
// instead of YIELD/APY, plus LEV (leverage: $ of stock exposure per $ spent).
// EXP/DTE are dropped from the row grid — every row in this table (and this
// whole card, when the LEAP toggle is active) shares the ticker's one
// furthest expiry, shown once in the card's own header instead.
// Fixed widths (not a flexible 1fr STRIKE column) so every column lines up
// consistently instead of STRIKE stretching to swallow whatever space the
// fixed columns don't use, which left a lopsided gap before DELTA.
// All fr (not a mix of px + one greedy flexible column) so the columns
// spread out proportionally across the card's full width instead of one
// column swallowing the leftover space and leaving a lopsided gap. STRIKE
// gets a smaller ratio than before — just enough for "$1,234" — so the
// gap before DELTA stays tight.
const LEAP_GRID = '16px 1.1fr 0.8fr 1.1fr 1.1fr 1.1fr 0.8fr 0.7fr'

function LeapRow({ r, rank }: { r: ScanResult; rank: number }) {
  const bep = r.strike + r.mid
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: LEAP_GRID, gap: 3, alignItems: 'center', padding: '5px 4px', margin: '0 -4px',
      borderBottom: '1px solid var(--border)', fontSize: 11, fontFamily: 'Inter, sans-serif',
    }}
      title={`${fmtExpMonthYear(r.expiry)}, ${r.dte}d · Extrinsic: $${(r.extrinsic ?? 0).toFixed(2)} · OI: ${r.openInterest} · Leverage: ${r.leverage?.toFixed(1) ?? '—'}x`}>
      <span style={{ color: 'var(--text-5)', fontSize: 10, textAlign: 'center' }}>{rank}</span>
      <span style={{ color: 'var(--text-1)', fontWeight: 600 }}>${r.strike}</span>
      <span style={{ color: deltaColor(r.delta), textAlign: 'right' }}>{r.delta.toFixed(2)}</span>
      <span style={{ color: '#f43f5e', textAlign: 'right' }}>${r.mid.toFixed(2)}</span>
      <span style={{ color: 'var(--text-2)', textAlign: 'right' }}>${bep.toFixed(2)}</span>
      <span style={{ color: r.annualizedYield <= 8 ? '#10b981' : r.annualizedYield <= 15 ? '#f59e0b' : '#ef4444', fontWeight: 600, textAlign: 'right' }}>{r.annualizedYield.toFixed(1)}%</span>
      <span style={{ color: 'var(--text-3)', textAlign: 'right' }}>{r.leverage?.toFixed(1) ?? '—'}x</span>
      <span style={{ color: scoreColor(r.score), fontWeight: 700, fontFamily: "'Inter', sans-serif", textAlign: 'right' }}>{r.score}</span>
    </div>
  )
}

function LeapHeader() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: LEAP_GRID, gap: 3, padding: '3px 0 5px', borderBottom: '1px solid var(--border-light)', fontSize: 8, fontWeight: 600, color: 'var(--text-4)', letterSpacing: '0.5px' }}>
      <span style={{ textAlign: 'center' }}>#</span><span>STRIKE</span>
      <span style={{ textAlign: 'right' }}>DELTA</span><span style={{ textAlign: 'right' }}>COST</span>
      <span style={{ textAlign: 'right' }}>BEP</span>
      <span style={{ textAlign: 'right' }}>EXTR/YR</span><span style={{ textAlign: 'right' }}>LEV</span>
      <span style={{ textAlign: 'right' }}>SCR</span>
    </div>
  )
}

function LeapSection({ items }: { items: ScanResult[] }) {
  if (!items.length) return null
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <span style={{ padding: '1px 6px', fontSize: 9, fontWeight: 700, background: '#a855f715', border: '1px solid #a855f740', color: '#a855f7', fontFamily: "'Inter', sans-serif", letterSpacing: '0.5px' }}>LEAP</span>
        <span style={{ fontSize: 9, color: 'var(--text-4)', fontFamily: 'Inter, sans-serif' }}>TOP {items.length}</span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 410 }}>
          <LeapHeader />
          {items.map((r, i) => <LeapRow key={i} r={r} rank={i + 1} />)}
        </div>
      </div>
    </div>
  )
}

function fmtMoney(n: number): string {
  return n < 0 ? `-$${Math.abs(n).toFixed(0)}` : `$${n.toFixed(0)}`
}

// Combo columns: legs (call/put strikes), net premium (can be negative — a
// net credit when the put brings in more than the call costs), TOTAL
// capital committed (net premium + put collateral, held simultaneously —
// the number that actually decides whether this beats buying the stock),
// breakeven, and the composite rank score.
// Fixed LEGS width (not a flexible 1fr) — same reasoning as LEAP_GRID above.
// All fr (not fixed px) so columns spread proportionally across the card's
// full width instead of leaving a lopsided gap — same treatment as LEAP_GRID.
// LEGS gets a smaller ratio than before, just enough for "330C/360P", so the
// gap before NET stays tight.
const COMBO_GRID = '16px 1.3fr 0.9fr 1fr 1fr 0.8fr 0.7fr'

function ComboRow({ c, rank }: { c: SyntheticLongCombo; rank: number }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: COMBO_GRID, gap: 3, alignItems: 'center', padding: '5px 4px', margin: '0 -4px',
      borderBottom: '1px solid var(--border)', fontSize: 11, fontFamily: 'Inter, sans-serif',
      background: rank === 1 ? '#10b98110' : 'transparent',
    }}
      title={`${fmtExpMonthYear(c.call.expiry)}, ${c.dte}d · NET (${fmtMoney(c.comboNetCost)}) is the actual cash you pay to open the trade · MARGIN (${fmtMoney(c.putCollateral)}, Reg-T est.) is buying power your broker reserves against the short put — NOT additional cash out of pocket, it's supported by other equity in a margin account · straight LEAP cost ${fmtMoney(c.straightCost)}, breakeven $${c.straightBreakeven.toFixed(2)} · assignment risk ${(c.assignmentRisk * 100).toFixed(0)}% · combined delta ${c.comboDelta.toFixed(2)} · stock (100 shares) costs ${fmtMoney(c.call.stockPrice * 100)} · put strike is above the call strike (by design) — between $${c.call.strike} and $${c.put.strike} you're losing on the put faster than the call gains, not flat`}>
      <span style={{ color: 'var(--text-5)', fontSize: 10, textAlign: 'center' }}>{rank}</span>
      <span style={{ color: 'var(--text-1)', fontWeight: 600, whiteSpace: 'nowrap' }}>${c.call.strike}C/${c.put.strike}P</span>
      <span style={{ color: c.comboNetCost < 0 ? '#10b981' : 'var(--text-1)', fontWeight: 600, textAlign: 'right' }}>{fmtMoney(c.comboNetCost)}</span>
      <span style={{ color: 'var(--text-3)', textAlign: 'right' }}>{fmtMoney(c.putCollateral)}</span>
      <span style={{ color: 'var(--text-2)', textAlign: 'right' }}>${c.comboBreakeven.toFixed(2)}</span>
      <span style={{ color: c.assignmentRisk >= 0.7 ? '#ef4444' : c.assignmentRisk >= 0.5 ? '#f59e0b' : 'var(--text-3)', textAlign: 'right' }}>{(c.assignmentRisk * 100).toFixed(0)}%</span>
      <span style={{ color: scoreColor(c.compositeScore), fontWeight: 700, fontFamily: "'Inter', sans-serif", textAlign: 'right' }}>{c.compositeScore}</span>
    </div>
  )
}

/** Ranked call×put combos (synthetic long / risk reversal) for this ticker —
 * every pair sharing an expiry, ordered chiefly by NET cost — the actual
 * cash paid to open the trade, which is what a personal cash budget refers
 * to. MARGIN is shown alongside for context (a Reg-T estimate of the buying
 * power a broker reserves against the short put) but is NOT additional cash
 * out of pocket the way NET is — it's supported by other equity in a
 * margin account, so folding it into the ranking/cap as if it were more
 * cash to pay (an earlier version of this did) produced misleading results
 * and confused NET with the combined figure. */
function SyntheticLongCombosSection({ combos }: { combos: SyntheticLongCombo[] }) {
  if (!combos.length) return null
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <span style={{ padding: '1px 6px', fontSize: 9, fontWeight: 700, background: '#3b82f615', border: '1px solid #3b82f640', color: '#3b82f6', fontFamily: "'Inter', sans-serif", letterSpacing: '0.5px' }}>SYNTHETIC LONG</span>
        <span style={{ fontSize: 9, color: 'var(--text-4)', fontFamily: 'Inter, sans-serif' }}>
          TOP {combos.length} · call strike below put strike only · ranked by least cash paid (NET)
        </span>
      </div>
      <div style={{ fontSize: 9, color: 'var(--text-4)', fontFamily: 'Inter, sans-serif', marginBottom: 4, lineHeight: 1.5 }}>
        NET is the cash you actually pay. MARGIN is buying power your broker reserves against the short put — not extra cash out of pocket.
      </div>
      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 340 }}>
          <div style={{ display: 'grid', gridTemplateColumns: COMBO_GRID, gap: 3, padding: '3px 0 5px', borderBottom: '1px solid var(--border-light)', fontSize: 8, fontWeight: 600, color: 'var(--text-4)', letterSpacing: '0.5px' }}>
            <span style={{ textAlign: 'center' }}>#</span><span>LEGS</span>
            <span style={{ textAlign: 'right' }}>NET</span><span style={{ textAlign: 'right' }}>MARGIN</span>
            <span style={{ textAlign: 'right' }}>BEP</span><span style={{ textAlign: 'right' }}>RISK</span>
            <span style={{ textAlign: 'right' }}>SCR</span>
          </div>
          {combos.map((c, i) => <ComboRow key={i} c={c} rank={i + 1} />)}
        </div>
      </div>
    </div>
  )
}

function MiniHeader() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: GRID, gap: 3, padding: '3px 0 5px', borderBottom: '1px solid var(--border-light)', fontSize: 8, fontWeight: 600, color: 'var(--text-4)', letterSpacing: '0.5px' }}>
      <span style={{ textAlign: 'center' }}>#</span><span>STRIKE</span>
      <span style={{ textAlign: 'right' }}>EXP</span><span style={{ textAlign: 'right' }}>DTE</span>
      <span style={{ textAlign: 'right' }}>DELTA</span><span style={{ textAlign: 'right' }}>CREDIT</span>
      <span style={{ textAlign: 'right' }}>BEP</span>
      <span style={{ textAlign: 'right' }}>YIELD</span><span style={{ textAlign: 'right' }}>APY</span>
      <span style={{ textAlign: 'right' }}>SCR</span>
    </div>
  )
}

function StrategySection({ label, color, items, nextEarnings, fomcDates }: { label: string; color: string; items: ScanResult[]; nextEarnings: string | null; fomcDates: string[] }) {
  if (!items.length) return null
  const flags = Array.from(new Set(items.flatMap(r => r.flags)))
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <span style={{ padding: '1px 6px', fontSize: 9, fontWeight: 700, background: `${color}15`, border: `1px solid ${color}40`, color, fontFamily: "'Inter', sans-serif", letterSpacing: '0.5px' }}>{label}</span>
        <span style={{ fontSize: 9, color: 'var(--text-4)', fontFamily: 'Inter, sans-serif' }}>TOP {items.length}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 3 }}>
          {flags.map(f => <span key={f} style={{ padding: '0 4px', fontSize: 8, fontWeight: 700, background: `${FLAG_COLORS[f]}12`, color: FLAG_COLORS[f], fontFamily: "'Inter', sans-serif" }}>{FLAG_LABELS[f]}</span>)}
        </div>
      </div>
      {/* The GRID's fixed-px columns need ~410px of real content width —
          wider than the card itself gets on a phone (card width is capped
          at 100% of the viewport there). Without its own scroll container,
          the right-hand columns (YIELD/SCR) just overflowed the card and
          were unreachable; this lets the table scroll horizontally within
          its own bounds instead. */}
      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 410 }}>
          <MiniHeader />
          {items.map((r, i) => <OptionRow key={i} r={r} rank={i + 1} nextEarnings={nextEarnings} fomcDates={fomcDates} />)}
        </div>
      </div>
    </div>
  )
}

// fontSize must be >= 16px — below that, iOS Safari running as an installed
// home-screen app has a known bug where focusing the input never brings up
// the on-screen keyboard at all.
const inputStyle: React.CSSProperties = { width: 52, padding: '3px 6px', fontSize: 16, textAlign: 'right', background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-1)', fontFamily: 'Inter, sans-serif', outline: 'none', borderRadius: 3 }
const inputClassName = 'scanner-param-input'
const labelStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: 'var(--text-3)', fontFamily: 'Inter, sans-serif' }

// ─── Main component ───────────────────────────────────────────────────────────

export default function OpportunitiesView({ state, tickers: watchlistTickers, onAddTicker, onRemoveTicker }: Props) {
  const [results,       setResults]      = useState<ScanResult[]>([])
  const [scanning,      setScanning]     = useState(false)
  const [error,         setError]        = useState<string | null>(null)
  const [scanned,       setScanned]      = useState(false)
  const [scanProgress,  setScanProgress] = useState('')
  const [collapsed,     setCollapsed]    = useState<Set<string>>(new Set())
  const [tickerInput,   setTickerInput]  = useState('')
  const [scanTerm,      setScanTerm]     = useState<ScanTerm>(loadScanTerm)
  const [shortCfg,      setShortCfg]     = useState<ModeConfig>(() => loadCustomCfg('short'))
  const [longCfg,       setLongCfg]      = useState<ModeConfig>(() => loadCustomCfg('long'))
  const customCfg = scanTerm === 'short' ? shortCfg : longCfg
  const [topCollapsed,  setTopCollapsed] = useState(false)
  const [strategyFilter, setStrategyFilter] = useState<'all' | 'csp' | 'cc' | 'leap'>('all')

  function selectTerm(term: ScanTerm) {
    setScanTerm(term)
    localStorage.setItem(SCAN_TERM_KEY, term)
  }

  function handleResultsScroll(e: React.UIEvent<HTMLDivElement>) {
    setTopCollapsed(e.currentTarget.scrollTop > 24)
  }

  function updateCustom(patch: Partial<ModeConfig>) {
    const setCfg = scanTerm === 'short' ? setShortCfg : setLongCfg
    setCfg(prev => { const n = { ...prev, ...patch }; localStorage.setItem(CUSTOM_CFG_KEY[scanTerm], JSON.stringify(n)); return n })
  }

  const stocksHeld = useMemo(() => {
    const map: Record<string, number> = {}
    for (const p of state.sync.positions)
      if (p.assetClass === 'STK') map[p.symbol] = (map[p.symbol] ?? 0) + p.quantity
    return map
  }, [state.sync.positions])

  const tickers = useMemo(() => [...watchlistTickers].sort(), [watchlistTickers])

  const [earningsMap, setEarningsMap] = useState<Record<string, string[]>>({})
  useEffect(() => {
    fetchEarningsDates(tickers).then(setEarningsMap).catch(() => {})
  }, [tickers])

  const [fomcDates, setFomcDates] = useState<string[]>([])
  useEffect(() => {
    fetchFomcDates().then(setFomcDates).catch(() => {})
  }, [])

  const filtered = useMemo(() => filterByMode(results, customCfg), [results, customCfg])
  const cards    = useMemo(() => buildCards(filtered, tickers, earningsMap), [filtered, tickers, earningsMap])

  function toggleCollapse(sym: string) {
    setCollapsed(prev => { const n = new Set(prev); n.has(sym) ? n.delete(sym) : n.add(sym); return n })
  }
  function addTicker() {
    if (tickerInput.trim()) onAddTicker(tickerInput)
    setTickerInput('')
  }
  function removeTicker(sym: string) {
    onRemoveTicker(sym)
  }

  async function handleScan() {
    setScanning(true); setError(null); setResults([]); setScanProgress('')
    try {
      setScanProgress('Fetching chains…')
      // Always fetch/process the FULL union of both terms' DTE windows PLUS
      // LEAP's own much longer horizon (real LEAPs run 2-3 years out — a
      // Dec-2028 TSLA chain is ~850 DTE from today), not just whichever
      // term tab happens to be selected. LEAP candidates are a separate
      // pass inside processChain that draws from this same fetched set —
      // scoping the fetch to the active term's own narrower window (e.g.
      // Short Term's 1-60d, or even Long Term's 365d ceiling) would silently
      // throw away the furthest-dated LEAP expiries before that pass ever
      // saw them. The Short/Long Term buttons still narrow what CSP/CC/All
      // display, via each term's own cfg in filterByMode — this only
      // changes what gets fetched and considered.
      const dteRange = { min: TERM_BOUNDS.short.dteFloor, max: Math.max(TERM_BOUNDS.long.dteCeil, LEAP_MAX_DTE) }
      const all = await scanAllTickersCboe(tickers, (sym, i, total) => setScanProgress(`${sym} (${i}/${total})`), dteRange)
      if (!all.length && tickers.length) setError('No results — try again in 30s.')
      setResults(all); setScanned(true)
    } catch (e) { setError(String(e)) }
    finally { setScanning(false); setScanProgress('') }
  }

  return (
    <div style={{ padding: 16, height: '100%', display: 'flex', flexDirection: 'column', gap: 10, overflow: 'hidden' }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      {/* Always-visible slim title bar — everything else (scan controls,
          term/strategy toggles, ticker chips, params) collapses away while
          scrolling results, leaving just this + the chevron to reclaim
          screen space on a phone. Clicking the chevron also toggles it
          manually regardless of scroll position. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <Activity size={16} style={{ color: 'var(--accent)', flexShrink: 0 }} />
        <span className="chakra" style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-1)', letterSpacing: '1px' }}>SCANNER</span>
        {scanning && <span style={{ fontSize: 11, color: 'var(--accent)', fontFamily: 'Inter, sans-serif', animation: 'pulse 2s infinite' }}>{scanProgress || 'Initializing…'}</span>}
        {scanned && (
          <span style={{ fontSize: 11, color: 'var(--text-4)', marginLeft: 'auto', fontFamily: 'Inter, sans-serif' }}>
            {filtered.length} results · {cards.length} tickers
          </span>
        )}
        <button onClick={() => setTopCollapsed(c => !c)} title={topCollapsed ? 'Expand controls' : 'Collapse controls'} style={{
          background: 'none', border: '1px solid var(--border)', color: 'var(--text-3)', cursor: 'pointer',
          padding: '3px 6px', display: 'flex', borderRadius: 4, marginLeft: scanned ? 0 : 'auto', flexShrink: 0,
        }}>
          {topCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </button>
      </div>

      {/* ── Collapsible: scan controls + params + custom tickers (hides while scrolling results) ── */}
      <div style={{
        display: 'grid',
        gridTemplateRows: topCollapsed ? '0fr' : '1fr',
        transition: 'grid-template-rows 0.22s ease',
        flexShrink: 0,
      }}>
        <div style={{
          overflow: 'hidden',
          opacity: topCollapsed ? 0 : 1,
          transition: 'opacity 0.18s ease',
          display: 'flex', flexDirection: 'column', gap: 10,
          minHeight: 0,
        }}>
        {/* ── Scan controls (button, ticker input, term/strategy toggles) ─────── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', flexShrink: 0 }}>
          <button onClick={handleScan} disabled={scanning || tickers.length === 0} title={tickers.length === 0 ? 'Add a ticker first' : undefined} style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 14px', fontSize: 12, fontWeight: 600,
            background: scanning || tickers.length === 0 ? 'var(--bg-elevated)' : 'var(--accent-dim)',
            border: `1px solid ${scanning || tickers.length === 0 ? 'var(--border)' : 'var(--accent-border)'}`,
            color: scanning || tickers.length === 0 ? 'var(--text-3)' : 'var(--accent)', cursor: scanning || tickers.length === 0 ? 'not-allowed' : 'pointer',
            fontFamily: "'Inter', sans-serif", letterSpacing: '1px', textTransform: 'uppercase',
          }}>
            <Scan size={12} style={{ animation: scanning ? 'spin 1.5s linear infinite' : 'none' }} />
            {scanning ? 'Scanning…' : 'Scan'}
          </button>

          {/* fontSize must be >= 16px — below that, iOS Safari running as an
              installed home-screen app (apple-mobile-web-app-capable) has a
              known bug where focusing the input triggers its auto-zoom-to-16px
              behavior but the on-screen keyboard never actually appears. */}
          <input type="text" value={tickerInput}
            onChange={e => setTickerInput(e.target.value.toUpperCase())}
            onKeyDown={e => e.key === 'Enter' && addTicker()}
            placeholder="+ TICKER"
            autoCapitalize="characters" autoCorrect="off" autoComplete="off" spellCheck={false}
            className="scanner-ticker-input"
            style={{ width: 112, padding: '5px 8px', fontSize: 16, background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-1)', fontFamily: 'Inter, sans-serif', outline: 'none', borderRadius: 3 }}
          />

          {/* Term toggle — Short Term (≤60 DTE) vs Long Term (60-365 DTE), each
              its own independently-tuned param set (see CUSTOM_CFG_KEY above) */}
          <div style={{ display: 'inline-flex', border: '1px solid var(--border)', borderRadius: 4, overflow: 'hidden' }}>
            {(['short', 'long'] as const).map(term => (
              <button key={term} onClick={() => selectTerm(term)} style={{
                padding: '5px 10px', fontSize: 10, fontWeight: 700, letterSpacing: '0.5px',
                background: scanTerm === term ? 'var(--accent-dim)' : 'var(--bg-elevated)',
                color: scanTerm === term ? 'var(--accent)' : 'var(--text-3)',
                border: 'none', borderLeft: term !== 'short' ? '1px solid var(--border)' : 'none',
                cursor: 'pointer', fontFamily: "'Inter', sans-serif", textTransform: 'uppercase',
              }}>
                {TERM_LABEL[term]}
              </button>
            ))}
          </div>

          {/* LEAP is its own function (a buy-scanner + Synthetic Long combo
              finder, not just another credit-selling strategy filter) — kept
              next to the Term toggle rather than lumped in with All/CSP/CC. */}
          <button onClick={() => setStrategyFilter(f => f === 'leap' ? 'all' : 'leap')} style={{
            padding: '5px 10px', fontSize: 10, fontWeight: 700, letterSpacing: '0.5px', borderRadius: 4,
            background: strategyFilter === 'leap' ? '#a855f722' : 'var(--bg-elevated)',
            color: strategyFilter === 'leap' ? '#a855f7' : 'var(--text-3)',
            border: `1px solid ${strategyFilter === 'leap' ? '#a855f760' : 'var(--border)'}`,
            cursor: 'pointer', fontFamily: "'Inter', sans-serif", textTransform: 'uppercase',
          }}>
            LEAP
          </button>

          {/* Strategy toggle — show CSP, CC, or all */}
          <div style={{ display: 'inline-flex', border: '1px solid var(--border)', borderRadius: 4, overflow: 'hidden' }}>
            {(['all', 'csp', 'cc'] as const).map(f => (
              <button key={f} onClick={() => setStrategyFilter(f)} style={{
                padding: '5px 10px', fontSize: 10, fontWeight: 700, letterSpacing: '0.5px',
                background: strategyFilter === f ? 'var(--accent-dim)' : 'var(--bg-elevated)',
                color: strategyFilter === f ? 'var(--accent)' : 'var(--text-3)',
                border: 'none', borderLeft: f !== 'all' ? '1px solid var(--border)' : 'none',
                cursor: 'pointer', fontFamily: "'Inter', sans-serif", textTransform: 'uppercase',
              }}>
                {f === 'all' ? 'All' : f}
              </button>
            ))}
          </div>
        </div>

        {/* ── Scan params (manual) ────────────────────────────────────────────── */}
        {/* Hidden in LEAP mode — those results aren't filtered by these at
            all (see filterByMode), they're selected by cboe.ts's own delta/
            DTE/liquidity rules and the combo-ranking formula, so showing
            live-editable inputs that silently do nothing would be misleading. */}
        {strategyFilter === 'leap' ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 14px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, flexShrink: 0, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 9, fontWeight: 700, color: '#a855f7', letterSpacing: 2, fontFamily: "'Inter', sans-serif" }}>LEAP</span>
            <span style={{ fontSize: 10.5, color: 'var(--text-3)', fontFamily: 'Inter, sans-serif' }}>
              Selected by delta/DTE/liquidity rules and the combo-ranking formula, not the params below — those don't apply here.
            </span>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 14, alignItems: 'center', padding: '8px 14px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, flexShrink: 0, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--signature)', letterSpacing: 2, fontFamily: "'Inter', sans-serif" }}>PARAMS</span>
            <label style={labelStyle}>Δ min <input type="number" value={customCfg.deltaMin} step={0.01} min={0.01} max={0.49} onChange={e => updateCustom({ deltaMin: +e.target.value })} style={inputStyle} className={inputClassName} /></label>
            <label style={labelStyle}>Δ max <input type="number" value={customCfg.deltaMax} step={0.01} min={0.02} max={0.55} onChange={e => updateCustom({ deltaMax: +e.target.value })} style={inputStyle} className={inputClassName} /></label>
            <label style={labelStyle}>DTE min <input type="number" value={customCfg.dteMin} step={1} min={TERM_BOUNDS[scanTerm].dteFloor} max={TERM_BOUNDS[scanTerm].dteCeil} onChange={e => updateCustom({ dteMin: +e.target.value })} style={inputStyle} className={inputClassName} /></label>
            <label style={labelStyle}>DTE max <input type="number" value={customCfg.dteMax} step={1} min={TERM_BOUNDS[scanTerm].dteFloor} max={TERM_BOUNDS[scanTerm].dteCeil} onChange={e => updateCustom({ dteMax: +e.target.value })} style={inputStyle} className={inputClassName} /></label>
            <label style={labelStyle}>Min bid <input type="number" value={customCfg.minBid} step={0.01} min={0.01} max={5} onChange={e => updateCustom({ minBid: +e.target.value })} style={inputStyle} className={inputClassName} /></label>
          </div>
        )}

        {/* ── Tickers (add/remove) ────────────────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, flexShrink: 0, minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center', overflowX: 'auto', flexWrap: 'nowrap', paddingBottom: 2 }}>
            <span style={{ fontSize: 9, color: 'var(--text-5)', letterSpacing: 1.5, fontFamily: "'Inter', sans-serif", flexShrink: 0 }}>
              TICKERS ({tickers.length}):
            </span>
            {tickers.map(sym => (
              <button key={sym} onClick={() => removeTicker(sym)} title="Remove" style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 8px', fontSize: 10, fontWeight: 600, flexShrink: 0, whiteSpace: 'nowrap', background: 'var(--accent-dim)', border: '1px solid var(--accent-border)', color: 'var(--accent)', cursor: 'pointer', borderRadius: 3, fontFamily: 'Inter, sans-serif' }}>
                {sym} <span style={{ color: 'var(--text-4)', fontSize: 8 }}>&times;</span>
              </button>
            ))}
          </div>
        </div>
        </div>
      </div>

      {/* ── Error ───────────────────────────────────────────────────────────── */}
      {error && <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#f43f5e', fontSize: 12, flexShrink: 0 }}><AlertCircle size={13} />{error}</div>}

      {/* ── Empty states ────────────────────────────────────────────────────── */}
      {scanning && !scanned && (
        <div style={{ textAlign: 'center', paddingTop: 60 }}>
          <div className="chakra" style={{ fontSize: 15, color: 'var(--text-2)', letterSpacing: '1px' }}>SCANNING {tickers.length} TICKERS</div>
          <div style={{ fontSize: 11, color: 'var(--text-4)', marginTop: 6, fontFamily: 'Inter, sans-serif' }}>Parallel fetch · CBOE delayed quotes</div>
          <div style={{ width: 160, height: 3, background: 'var(--border)', borderRadius: 2, margin: '14px auto', overflow: 'hidden' }}>
            <div style={{ height: '100%', background: 'var(--accent)', animation: 'pulse 1.5s ease-in-out infinite', width: '60%', borderRadius: 2 }} />
          </div>
        </div>
      )}

      {!scanning && !scanned && !error && tickers.length === 0 && (
        <div style={{ textAlign: 'center', paddingTop: 60 }}>
          <Activity size={28} style={{ color: 'var(--text-5)', marginBottom: 10 }} />
          <div className="chakra" style={{ fontSize: 15, color: 'var(--text-2)', letterSpacing: '1px' }}>OPTIONS SCANNER</div>
          <div style={{ fontSize: 11, color: 'var(--text-4)', marginTop: 6, fontFamily: 'Inter, sans-serif', lineHeight: 1.8 }}>
            Type a ticker above and hit Enter to start building your watchlist
          </div>
        </div>
      )}

      {!scanning && !scanned && !error && tickers.length > 0 && (
        <div style={{ textAlign: 'center', paddingTop: 60 }}>
          <Activity size={28} style={{ color: 'var(--text-5)', marginBottom: 10 }} />
          <div className="chakra" style={{ fontSize: 15, color: 'var(--text-2)', letterSpacing: '1px' }}>OPTIONS SCANNER</div>
          <div style={{ fontSize: 11, color: 'var(--text-4)', marginTop: 6, fontFamily: 'Inter, sans-serif', lineHeight: 1.8 }}>
            {tickers.length} tickers · CSP &amp; CC
          </div>
          <div style={{ fontSize: 11, color: 'var(--signature)', marginTop: 2, fontFamily: 'Inter, sans-serif' }}>
            Δ {customCfg.deltaMin}–{customCfg.deltaMax} · {customCfg.dteMin}–{customCfg.dteMax}d · bid ≥ ${customCfg.minBid}
          </div>
          <button onClick={handleScan} style={{ marginTop: 16, padding: '8px 24px', fontSize: 13, fontWeight: 600, background: 'var(--accent-dim)', border: '1px solid var(--accent-border)', color: 'var(--accent)', cursor: 'pointer', fontFamily: "'Inter', sans-serif", letterSpacing: '1.5px', textTransform: 'uppercase' }}>
            START SCAN
          </button>
        </div>
      )}

      {scanned && !scanning && cards.length === 0 && (
        <div style={{ textAlign: 'center', paddingTop: 40 }}>
          <div className="chakra" style={{ fontSize: 13, color: 'var(--text-3)', letterSpacing: '1px' }}>NO RESULTS FOR CURRENT PARAMS</div>
          <div style={{ fontSize: 11, color: 'var(--text-5)', marginTop: 6, fontFamily: 'Inter, sans-serif' }}>
            Δ {customCfg.deltaMin}–{customCfg.deltaMax} · {customCfg.dteMin}–{customCfg.dteMax}d · bid ≥ ${customCfg.minBid} — widen above to see more
          </div>
        </div>
      )}

      {/* ── Card grid ───────────────────────────────────────────────────────── */}
      {scanned && cards.length > 0 && (
        <div onScroll={handleResultsScroll} style={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', flexWrap: 'wrap', gap: 10, alignContent: 'start', justifyContent: 'center' }}>
          {cards.map((card, idx) => {
            const isCollapsed = collapsed.has(card.symbol)
            const showCsp  = (strategyFilter === 'all' || strategyFilter === 'csp')  && card.topCsp.length > 0
            const showCc   = (strategyFilter === 'all' || strategyFilter === 'cc')   && card.topCc.length > 0
            // LEAP is its own function, not part of "All" — it only shows
            // when its own toggle is explicitly selected.
            const showLeap = strategyFilter === 'leap' && card.topLeap.length > 0
            const showCombo = showLeap && card.topCombos.length > 0
            const hasData = showCsp || showCc || showLeap
            const shares = stocksHeld[card.symbol] ?? 0
            return (
              <div key={card.symbol} style={{ width: CARD_W, minWidth: CARD_W, maxWidth: CARD_W, background: 'var(--bg-card)', border: `1px solid ${idx < 3 && hasData ? 'var(--accent-border)' : 'var(--border)'}`, borderRadius: 8, overflow: 'hidden', flexShrink: 0 }}>

                <div onClick={() => hasData && toggleCollapse(card.symbol)}
                  style={{ padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 8, cursor: hasData ? 'pointer' : 'default', background: 'var(--bg-surface)', borderBottom: isCollapsed || !hasData ? 'none' : '1px solid var(--border)', userSelect: 'none' }}>
                  {hasData && <span style={{ fontSize: 9, fontWeight: 700, color: idx < 3 ? 'var(--accent)' : 'var(--text-5)', fontFamily: "'Inter', sans-serif", minWidth: 16 }}>#{idx + 1}</span>}
                  <span style={{ fontFamily: "'Inter', sans-serif", fontSize: 15, fontWeight: 700, color: idx === 0 && hasData ? 'var(--accent)' : hasData ? 'var(--text-1)' : 'var(--text-4)', letterSpacing: '1px' }}>{card.symbol}</span>
                  {card.price > 0 && <span style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'Inter, sans-serif' }}>${card.price.toFixed(2)}</span>}
                  {shares > 0 && <span style={{ padding: '1px 5px', fontSize: 9, fontWeight: 700, background: '#3b82f615', border: '1px solid #3b82f640', color: '#3b82f6', fontFamily: "'Inter', sans-serif" }}>{shares} SHR</span>}
                  {card.nextEarnings && (
                    <span title={`Next earnings ${card.nextEarnings}`} style={{ padding: '1px 5px', fontSize: 9, fontWeight: 700, background: '#F0B42915', border: '1px solid #F0B42940', color: '#F0B429', fontFamily: "'Inter', sans-serif" }}>
                      ER {fmtEr(card.nextEarnings)}
                    </span>
                  )}
                  {strategyFilter === 'leap' && card.topLeap.length > 0 && (
                    <span title="LEAP expiry / days to expiry" style={{ padding: '1px 5px', fontSize: 9, fontWeight: 700, background: '#a855f715', border: '1px solid #a855f740', color: '#a855f7', fontFamily: "'Inter', sans-serif" }}>
                      {fmtExpMonthYear(card.topLeap[0].expiry)} · {card.topLeap[0].dte}d
                    </span>
                  )}
                  <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
                    {hasData ? (
                      <>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: 7, color: 'var(--text-4)', letterSpacing: '1px', fontWeight: 600 }}>SCORE</div>
                          <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 14, fontWeight: 700, color: scoreColor(card.bestScore) }}>{card.bestScore}</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: 7, color: 'var(--text-4)', letterSpacing: '1px', fontWeight: 600 }}>IV</div>
                          <div style={{ fontSize: 13, color: 'var(--text-2)', fontFamily: 'Inter, sans-serif' }}>{card.avgIv.toFixed(0)}%</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: 7, color: 'var(--text-4)', letterSpacing: '1px', fontWeight: 600 }}>OPTS</div>
                          <div style={{ fontSize: 13, color: 'var(--text-3)', fontFamily: 'Inter, sans-serif' }}>{card.totalContracts}</div>
                        </div>
                        {isCollapsed ? <ChevronDown size={14} style={{ color: 'var(--text-4)' }} /> : <ChevronUp size={14} style={{ color: 'var(--text-4)' }} />}
                      </>
                    ) : (
                      <span style={{ fontSize: 10, color: 'var(--text-5)', fontFamily: 'Inter, sans-serif' }}>NO DATA</span>
                    )}
                  </div>
                </div>

                {hasData && !isCollapsed && (
                  <div style={{ padding: '8px 12px 10px' }}>
                    {showCsp && <StrategySection label="CSP" color="#f43f5e" items={card.topCsp} nextEarnings={card.nextEarnings} fomcDates={fomcDates} />}
                    {showCc  && <StrategySection label="CC"  color="#3b82f6" items={card.topCc} nextEarnings={card.nextEarnings} fomcDates={fomcDates} />}
                    {showLeap && <LeapSection items={card.topLeap} />}
                    {showCombo && <SyntheticLongCombosSection combos={card.topCombos} />}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
