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

/** Get current stock price — live fetched price takes priority over stale IBKR mark price. */
function stockPrice(
  underlying: string,
  positions: RawPosition[],
  extraPrices: Record<string, number>,
): number | null {
  // Live price first — IBKR mark price is from sync time (could be hours old)
  if (extraPrices[underlying]) return extraPrices[underlying]
  // Fall back to IBKR mark price if live fetch didn't return this symbol
  const p = positions.find(p => p.assetClass === 'STK' && (p.symbol === underlying || p.underlyingSymbol === underlying))
  return p?.markPrice ?? null
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
    // Use ONLY the option legs' P&L — strategy.unrealizedPnL includes the
    // stock position which can overwhelm the option premium comparison.
    const pnl       = s.legs.reduce((sum, l) => sum + l.unrealizedPnL, 0)
    const profitPct = premium > 0 ? pnl / premium : 0
    const summary   = legSummary(s.legs)
    const stkPrice  = stockPrice(s.underlying, positions, extraPrices)

    // ── Covered Calls & CSPs ──────────────────────────────────────────────────
    if (s.type === 'covered_call' || s.type === 'csp') {
      const leg = shortLegs[0]
      const priceKnown = stkPrice !== null

      // ITM status — only determined when we have the stock price.
      // CC ITM: stock > call strike.  CSP ITM: stock < put strike.
      const itm: boolean | null = priceKnown
        ? (s.type === 'covered_call' ? stkPrice! > leg.strike : stkPrice! < leg.strike)
        : null   // unknown — do NOT assume either way

      // ── When price is unavailable and expiry is imminent, show neutral warning ──
      if (!priceKnown && minDte <= 7) {
        acts.push(action(s.type, s.underlying, 'manage', 'manage',
          `${minDte}d left — verify OTM/ITM in your broker`,
          `Live price unavailable. Check if the option is OTM (keep premium, let expire) or ITM (assignment risk — roll or close). Do not rely on this app alone for the decision.`,
          { relatedStrategyId: s.id, legSummary: summary }
        ))

      // ── Price known: full ITM/OTM logic ──────────────────────────────────────
      } else if (priceKnown) {
        const rollExpiry = suggestRollExpiry(leg.expiry, 35)

        // 1. ITM + big loss → urgent
        if (itm && pnl < 0 && premium > 0 && Math.abs(pnl) > premium * 0.5) {
          const lossPct = Math.min(Math.abs(pnl / premium) * 100, 300).toFixed(0)
          if (s.type === 'csp') {
            acts.push(action(s.type, s.underlying, 'urgent', 'roll',
              `Down ${lossPct}% — put is ITM, roll down & out`,
              `Stock dropped through your $${leg.strike} strike (now $${stkPrice!.toFixed(0)}). Roll to a lower strike further out to collect credit and reduce cost basis, or accept assignment and sell a covered call.`,
              { relatedStrategyId: s.id, legSummary: summary, suggestedStrike: Math.round(leg.strike * 0.95 / 5) * 5, suggestedExpiry: fmtExpiry(rollExpiry), suggestedDelta: 0.25 }
            ))
          } else {
            acts.push(action(s.type, s.underlying, 'urgent', 'manage',
              `Call ITM — stock $${stkPrice!.toFixed(0)} above $${leg.strike} strike`,
              `Stock rallied above your call strike. Decide: roll up & out to keep your shares, or let shares get called away at $${leg.strike} and keep the full premium.`,
              { relatedStrategyId: s.id, legSummary: summary, suggestedStrike: Math.round(stkPrice! * 1.03 / 5) * 5, suggestedExpiry: fmtExpiry(rollExpiry), suggestedDelta: 0.25 }
            ))
          }

        // 2. ITM + expiring soon → assignment decision
        } else if (itm && minDte <= 7) {
          if (s.type === 'csp') {
            acts.push(action(s.type, s.underlying, 'urgent', 'manage',
              `${minDte}d left, put ITM — assignment decision`,
              `Stock $${stkPrice!.toFixed(0)} is below your $${leg.strike} strike. Options: roll down & out, take assignment + sell a covered call, or close for a loss.`,
              { relatedStrategyId: s.id, legSummary: summary, suggestedExpiry: fmtExpiry(rollExpiry), suggestedDelta: 0.25 }
            ))
          } else {
            acts.push(action(s.type, s.underlying, 'urgent', 'manage',
              `${minDte}d left, call ITM — shares at risk`,
              `Stock $${stkPrice!.toFixed(0)} is above your $${leg.strike} strike. Roll up & out to keep shares, or let them be called away at your strike.`,
              { relatedStrategyId: s.id, legSummary: summary, suggestedExpiry: fmtExpiry(rollExpiry), suggestedDelta: 0.25 }
            ))
          }

        // 3. OTM + expiring soon → goal achieved
        } else if (!itm && minDte <= 7) {
          acts.push(action(s.type, s.underlying, 'watch', 'manage',
            `${minDte}d left — OTM, expiring worthless ✓`,
            `Stock $${stkPrice!.toFixed(0)} is safely ${s.type === 'covered_call' ? 'below' : 'above'} your $${leg.strike} strike. You keep the full premium. After expiry, sell the next cycle.`,
            { relatedStrategyId: s.id, legSummary: summary }
          ))

        // 4. 50%+ profit → optional early close
        } else if (profitPct >= 0.5) {
          acts.push(action(s.type, s.underlying, 'manage', 'close',
            `${(profitPct * 100).toFixed(0)}% profit captured — close early?`,
            `Over half the premium banked with ${minDte} DTE left. Close now to free capital and redeploy sooner, or hold for the remaining ${(100 - profitPct * 100).toFixed(0)}%.`,
            { relatedStrategyId: s.id, legSummary: summary, suggestedExpiry: fmtExpiry(rollExpiry), suggestedDelta: 0.25 }
          ))

        // 4b. OTM but dangerously close to strike (<3%) → manage
        } else if (!itm && premium > 0) {
          const distPct = s.type === 'covered_call'
            ? (leg.strike - stkPrice!) / stkPrice!   // how far below the call strike
            : (stkPrice! - leg.strike) / stkPrice!   // how far above the put strike
          if (distPct < 0.03) {
            acts.push(action(s.type, s.underlying, 'manage', 'manage',
              `Stock within 3% of strike — monitor closely`,
              s.type === 'covered_call'
                ? `Stock $${stkPrice!.toFixed(0)} is only $${(leg.strike - stkPrice!).toFixed(0)} below your $${leg.strike} call. At this distance, small moves can flip to ITM and risk share call-away.`
                : `Stock $${stkPrice!.toFixed(0)} is only $${(stkPrice! - leg.strike).toFixed(0)} above your $${leg.strike} put. One down day could flip to ITM and trigger assignment.`,
              { relatedStrategyId: s.id, legSummary: summary }
            ))
          // 4c. OTM but option has lost >25% of premium → manage (stock drifting toward strike)
          } else if (pnl < 0 && Math.abs(pnl) > premium * 0.25) {
            acts.push(action(s.type, s.underlying, 'manage', 'manage',
              `Option lost ${(Math.abs(pnl / premium) * 100).toFixed(0)}% of premium — monitor`,
              s.type === 'covered_call'
                ? `The short call has gained value — stock moved toward your $${leg.strike} strike. Still OTM with ${minDte} DTE but the position is under pressure.`
                : `The short put has gained value — stock dropped toward your $${leg.strike} strike. Still OTM with ${minDte} DTE but worth watching.`,
              { relatedStrategyId: s.id, legSummary: summary }
            ))
          }

        // 5. ITM + approaching 21 DTE → consider rolling
        } else if (itm && minDte <= 21) {
          acts.push(action(s.type, s.underlying, 'manage', 'roll',
            `${minDte}d left, option is ITM — consider rolling`,
            s.type === 'csp'
              ? `Put ITM (stock $${stkPrice!.toFixed(0)} < $${leg.strike} strike). Loss under 50% — you can hold and wait for recovery, or roll down & out to collect more credit.`
              : `Call ITM (stock $${stkPrice!.toFixed(0)} > $${leg.strike} strike). Roll up & out to avoid share call-away, or let shares be called at your strike.`,
            { relatedStrategyId: s.id, legSummary: summary, suggestedStrike: leg.strike, suggestedExpiry: fmtExpiry(rollExpiry), suggestedDelta: 0.25 }
          ))

        // 6. OTM + 21 DTE → looking good, plan next cycle
        } else if (!itm && minDte <= 21) {
          acts.push(action(s.type, s.underlying, 'watch', 'manage',
            `${minDte}d left — OTM, on track`,
            `Stock $${stkPrice!.toFixed(0)} safely ${s.type === 'covered_call' ? 'below' : 'above'} your $${leg.strike} strike. Start planning your next cycle for after expiry.`,
            { relatedStrategyId: s.id, legSummary: summary, suggestedDelta: 0.27 }
          ))
        }
      }
      // If price unknown and DTE > 7: no action generated (nothing actionable without price)
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
