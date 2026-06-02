import type { Action, Strategy, RawPosition, StrategyType, OptionLeg } from '../types'
import { nanoid } from '../utils/nanoid'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function fmtExpiry(expiry: string): string {
  const m = parseInt(expiry.slice(4, 6), 10)
  const d = parseInt(expiry.slice(6, 8), 10)
  const y = expiry.slice(2, 4)
  return `${d}${MONTHS[m - 1]}${y}`
}

function expiryDate(expiry: string): Date {
  return new Date(`${expiry.slice(0,4)}-${expiry.slice(4,6)}-${expiry.slice(6,8)}T12:00:00Z`)
}

function addDays(d: Date, daysOut: number): string {
  const r = new Date(d)
  r.setUTCDate(r.getUTCDate() + daysOut)
  const m = String(r.getUTCMonth() + 1).padStart(2, '0')
  const day = String(r.getUTCDate()).padStart(2, '0')
  return `${r.getUTCFullYear()}${m}${day}`
}

function suggestRollExpiry(currentExpiry: string, targetDte = 35): string {
  return addDays(expiryDate(currentExpiry), targetDte)
}

/** "$340P 21Jun25 (14d)" — short legs only */
function legSummary(legs: OptionLeg[]): string {
  const shorts = legs.filter(l => l.quantity < 0)
  if (!shorts.length) return ''
  const minDte = Math.min(...shorts.map(l => l.dte))
  return shorts.map(l => `$${l.strike}${l.putCall} ${fmtExpiry(l.expiry)}`).join(' / ') + ` (${minDte}d)`
}

function action(
  strategyType: StrategyType,
  underlying: string,
  urgency: Action['urgency'],
  actionType: Action['actionType'],
  reason: string,
  details: string,
  extra: Partial<Action> = {},
): Action {
  return { id: nanoid(), strategyType, underlying, urgency, actionType, reason, details, ...extra }
}

// ─── Stock price lookup ───────────────────────────────────────────────────────

/** Get current stock price — positions first, then fetched prices fallback. */
function stockPrice(
  underlying: string,
  positions: RawPosition[],
  extraPrices: Record<string, number>,
): number | null {
  const p = positions.find(p => p.assetClass === 'STK' && (p.symbol === underlying || p.underlyingSymbol === underlying))
  if (p?.markPrice) return p.markPrice
  return extraPrices[underlying] ?? null
}

// ─── Main engine ──────────────────────────────────────────────────────────────

export function generateActions(
  strategies: Strategy[],
  positions: RawPosition[],
  extraPrices: Record<string, number> = {},
): Action[] {
  const acts: Action[] = []

  for (const s of strategies) {
    const shortLegs = s.legs.filter(l => l.quantity < 0)
    if (!shortLegs.length) continue

    const minDte    = Math.min(...shortLegs.map(l => l.dte))
    const premium   = s.netPremiumReceived          // credit received (positive)
    const pnl       = s.unrealizedPnL               // positive = winning, negative = losing
    const profitPct = premium > 0 ? pnl / premium : 0
    const summary   = legSummary(s.legs)
    const stkPrice  = stockPrice(s.underlying, positions, extraPrices)

    // ── Covered Calls & CSPs ──────────────────────────────────────────────────
    if (s.type === 'covered_call' || s.type === 'csp') {
      const leg = shortLegs[0]

      // Is this option currently ITM? (stock moved against us)
      // CC: ITM when stock price > call strike  (shares at risk of being called away)
      // CSP: ITM when stock price < put strike  (put at risk of assignment)
      // If we can't find the stock price, default to false — never falsely flag OTM as ITM.
      const itm = stkPrice !== null
        ? (s.type === 'covered_call' ? stkPrice > leg.strike : stkPrice < leg.strike)
        : false

      // 1. Losing badly — option moved deep ITM
      if (pnl < 0 && premium > 0 && Math.abs(pnl) > premium * 0.5) {
        const rollExpiry = suggestRollExpiry(leg.expiry, 35)
        const lossPct = Math.min(Math.abs(pnl / premium) * 100, 999).toFixed(0)
        if (s.type === 'csp') {
          acts.push(action(s.type, s.underlying, 'urgent', 'roll',
            `Down ${lossPct}% — put is ITM, roll down & out`,
            `Stock dropped through your strike. Roll to a lower strike further out to collect more credit and reduce cost basis. Or accept assignment and start selling covered calls.`,
            {
              relatedStrategyId: s.id, legSummary: summary,
              suggestedStrike: Math.round(leg.strike * 0.95 / 5) * 5,
              suggestedExpiry: fmtExpiry(rollExpiry),
              suggestedDelta: 0.25,
            }
          ))
        } else {
          acts.push(action(s.type, s.underlying, 'urgent', 'manage',
            `Up ${Math.min(Math.abs(pnl / premium) * 100, 999).toFixed(0)}% — call is ITM, shares at risk`,
            `Stock rallied above your strike. Decide: roll the call up & out to avoid share call-away, or let shares get called at your strike price and keep the premium.`,
            {
              relatedStrategyId: s.id, legSummary: summary,
              suggestedStrike: stkPrice ? Math.round(stkPrice * 1.03 / 5) * 5 : undefined,
              suggestedExpiry: fmtExpiry(rollExpiry),
              suggestedDelta: 0.25,
            }
          ))
        }

      // 2. Expiring soon AND ITM — assignment decision
      } else if (minDte <= 7 && itm) {
        const rollExpiry = suggestRollExpiry(leg.expiry, 35)
        if (s.type === 'csp') {
          acts.push(action(s.type, s.underlying, 'urgent', 'manage',
            `${minDte}d left, put is ITM — assignment decision`,
            `You will likely be assigned the shares. Options: (1) roll down & out now to avoid assignment, (2) take assignment and immediately sell a covered call to start the wheel, (3) close for a loss if you don't want the shares.`,
            {
              relatedStrategyId: s.id, legSummary: summary,
              suggestedExpiry: fmtExpiry(rollExpiry), suggestedDelta: 0.25,
            }
          ))
        } else {
          acts.push(action(s.type, s.underlying, 'urgent', 'manage',
            `${minDte}d left, call is ITM — shares may be called away`,
            `Stock is above your call strike. Options: (1) roll up & out to keep your shares, (2) let shares get called away at your strike and collect full premium, (3) buy back the call if you want to hold.`,
            {
              relatedStrategyId: s.id, legSummary: summary,
              suggestedExpiry: fmtExpiry(rollExpiry), suggestedDelta: 0.25,
            }
          ))
        }

      // 3. Expiring soon AND OTM — this is the goal, just flag it
      } else if (minDte <= 7 && !itm) {
        acts.push(action(s.type, s.underlying, 'watch', 'manage',
          `${minDte}d left — on track to expire worthless ✓`,
          `Position is OTM. You keep the full premium. No action needed unless you want to close early to free capital. After expiry, look to sell the next cycle.`,
          { relatedStrategyId: s.id, legSummary: summary }
        ))

      // 4. 50%+ profit captured — optional early close
      } else if (profitPct >= 0.5) {
        const rollExpiry = suggestRollExpiry(leg.expiry, 35)
        acts.push(action(s.type, s.underlying, 'manage', 'close',
          `${(profitPct * 100).toFixed(0)}% profit captured — consider closing early`,
          `You've banked over half the max premium with ${minDte} DTE remaining. Closing now frees capital to redeploy into a new position sooner. The remaining premium isn't worth the gamma risk.`,
          {
            relatedStrategyId: s.id, legSummary: summary,
            suggestedExpiry: fmtExpiry(rollExpiry), suggestedDelta: 0.25,
          }
        ))

      // 5. Approaching 21 DTE and ITM — may need to manage
      } else if (minDte <= 21 && itm) {
        const rollExpiry = suggestRollExpiry(leg.expiry, 35)
        acts.push(action(s.type, s.underlying, 'manage', 'roll',
          `${minDte}d left, option is ITM — consider rolling`,
          s.type === 'csp'
            ? `Put is in the money but loss is under 50%. You can roll down & out to collect more credit and lower your cost basis, or hold and see if stock recovers before expiry.`
            : `Call is in the money. Roll up & out to avoid share call-away and collect additional credit, or let shares be called at your strike price.`,
          {
            relatedStrategyId: s.id, legSummary: summary,
            suggestedStrike: leg.strike,
            suggestedExpiry: fmtExpiry(rollExpiry),
            suggestedDelta: 0.25,
          }
        ))

      // 6. 21 DTE OTM — comfortable, note upcoming expiry for redeployment
      } else if (minDte <= 21 && !itm) {
        acts.push(action(s.type, s.underlying, 'watch', 'manage',
          `${minDte}d left — OTM, looking good`,
          `Position is on track. Start planning your next cycle: after expiry, ${s.type === 'csp' ? 'sell another CSP at 0.25–0.30 delta, 30–45 DTE' : 'sell the next covered call at 0.25–0.30 delta, 30–45 DTE'}.`,
          { relatedStrategyId: s.id, legSummary: summary, suggestedDelta: 0.27 }
        ))
      }
    }

    // ── PMCC ─────────────────────────────────────────────────────────────────
    if (s.type === 'pmcc') {
      const shortCall = s.legs.find(l => l.quantity < 0)
      const longCall  = s.legs.find(l => l.quantity > 0)
      if (shortCall) {
        const stkP = stkPrice
        const callItm = stkP != null ? stkP > shortCall.strike : false

        if (callItm && pnl < 0 && premium > 0 && Math.abs(pnl) > premium * 0.5) {
          acts.push(action(s.type, s.underlying, 'urgent', 'roll',
            `Short call ITM, loss exceeds 50%`,
            `Roll short call up and out. New strike MUST stay below the LEAP strike ($${longCall?.strike ?? '?'}) to maintain defined risk.`,
            {
              relatedStrategyId: s.id, legSummary: summary,
              suggestedStrike: longCall ? longCall.strike - 5 : undefined,
              suggestedExpiry: fmtExpiry(suggestRollExpiry(shortCall.expiry, 35)),
              suggestedDelta: 0.25,
            }
          ))
        } else if (shortCall.dte <= 7 && !callItm) {
          acts.push(action(s.type, s.underlying, 'manage', 'open',
            `Short call expiring worthless in ${shortCall.dte}d — sell next cycle`,
            `Short leg will expire. Sell a new short call at ~0.25 delta for the next monthly to keep generating premium from your LEAP.`,
            {
              relatedStrategyId: s.id, legSummary: summary,
              suggestedStrike: longCall ? longCall.strike - 5 : undefined,
              suggestedExpiry: fmtExpiry(suggestRollExpiry(shortCall.expiry, 35)),
              suggestedDelta: 0.27,
            }
          ))
        } else if (shortCall.dte <= 7 && callItm) {
          acts.push(action(s.type, s.underlying, 'urgent', 'roll',
            `Short call ITM with ${shortCall.dte}d — roll before assignment`,
            `Roll short call up and out now. Keep new strike below LEAP strike ($${longCall?.strike ?? '?'}).`,
            {
              relatedStrategyId: s.id, legSummary: summary,
              suggestedExpiry: fmtExpiry(suggestRollExpiry(shortCall.expiry, 35)),
              suggestedDelta: 0.25,
            }
          ))
        } else if (profitPct >= 0.5) {
          acts.push(action(s.type, s.underlying, 'manage', 'roll',
            `${(profitPct * 100).toFixed(0)}% profit — roll short call for more premium`,
            `Short call captured most of its value. Roll to next monthly to collect fresh premium and keep the PMCC working.`,
            {
              relatedStrategyId: s.id, legSummary: summary,
              suggestedExpiry: fmtExpiry(suggestRollExpiry(shortCall.expiry, 35)),
              suggestedDelta: 0.25,
            }
          ))
        }
      }
    }

    // ── Spreads ───────────────────────────────────────────────────────────────
    if (s.type === 'put_spread' || s.type === 'call_spread') {
      if (pnl < 0 && premium > 0 && Math.abs(pnl) > premium * 0.5) {
        acts.push(action(s.type, s.underlying, 'urgent', 'close',
          `Spread at max loss territory`,
          `Close both legs now. Defined risk means your max loss is fixed — take it and redeploy rather than holding through expiry.`,
          { relatedStrategyId: s.id, legSummary: summary }
        ))
      } else if (minDte <= 7) {
        acts.push(action(s.type, s.underlying, 'manage', 'close',
          `${minDte}d — close spread to avoid pin risk`,
          `Close before expiry. At this DTE, gamma risk is extreme — the spread can flip from profit to max loss on a small move.`,
          { relatedStrategyId: s.id, legSummary: summary }
        ))
      } else if (premium > 0 && profitPct >= 0.75) {
        acts.push(action(s.type, s.underlying, 'manage', 'close',
          `${(profitPct * 100).toFixed(0)}% profit — close spread`,
          `The remaining ${(100 - profitPct * 100).toFixed(0)}% of max profit isn't worth the risk. Close and redeploy.`,
          { relatedStrategyId: s.id, legSummary: summary }
        ))
      }
    }

    // ── Risk Reversals ────────────────────────────────────────────────────────
    if (s.type === 'risk_reversal') {
      if (minDte <= 14) {
        acts.push(action(s.type, s.underlying, 'manage', 'close',
          `${minDte}d — close before pin risk`,
          `Close both legs before expiry to avoid assignment on the short put or unlimited upside exposure on any short call.`,
          { relatedStrategyId: s.id, legSummary: summary }
        ))
      } else if (pnl < 0 && premium > 0 && Math.abs(pnl) > premium * 0.5) {
        acts.push(action(s.type, s.underlying, 'urgent', 'manage',
          `Loss exceeds 50% of short put premium`,
          `Close or reduce the short put leg to cap losses. Review whether the long call position still makes sense.`,
          { relatedStrategyId: s.id, legSummary: summary }
        ))
      }
    }

    // ── LEAPs ─────────────────────────────────────────────────────────────────
    if (s.type === 'leap') {
      const longLeg = s.legs.find(l => l.quantity > 0)
      if (longLeg && longLeg.dte <= 90) {
        acts.push(action(s.type, s.underlying, 'watch', 'manage',
          `LEAP inside 90 DTE — theta accelerating`,
          `Plan to roll forward before time decay erodes value. Roll to same or higher strike, 1–2 years out.`,
          { relatedStrategyId: s.id, legSummary: legSummary([longLeg]) }
        ))
      }
    }
  }

  // ── Opportunity: uncovered shares ─────────────────────────────────────────
  const coveredUnderlying = new Set(
    strategies.filter(s => s.type === 'covered_call').map(s => s.underlying)
  )
  for (const p of positions) {
    if (p.assetClass === 'STK' && p.quantity >= 100 && !coveredUnderlying.has(p.symbol)) {
      const lots = Math.floor(p.quantity / 100)
      acts.push(action('covered_call', p.symbol, 'opportunity', 'open',
        `${p.quantity} shares — no covered call written`,
        `Sell ${lots > 1 ? `${lots} contracts` : '1 contract'} at ~0.25 delta, 30–45 DTE to generate income from idle shares.`,
        { suggestedDelta: 0.25 }
      ))
    }
  }

  // Sort: urgent → manage → opportunity → watch
  const urgencyOrder: Record<Action['urgency'], number> = { urgent: 0, manage: 1, opportunity: 2, watch: 3 }
  return acts.sort((a, b) => urgencyOrder[a.urgency] - urgencyOrder[b.urgency])
}
