import type { Action, Strategy, RawPosition, StrategyType, OptionLeg } from '../types'
import { nanoid } from '../utils/nanoid'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

/** "20250621" → "21Jun25" */
function fmtExpiry(expiry: string): string {
  const m = parseInt(expiry.slice(4, 6), 10)
  const d = parseInt(expiry.slice(6, 8), 10)
  const y = expiry.slice(2, 4)
  return `${d}${MONTHS[m - 1]}${y}`
}

/** "20250621" → Date object (noon UTC to avoid DST edge) */
function expiryDate(expiry: string): Date {
  return new Date(`${expiry.slice(0,4)}-${expiry.slice(4,6)}-${expiry.slice(6,8)}T12:00:00Z`)
}

/** Add ~`daysOut` calendar days to a date and return YYYYMMDD */
function addDays(d: Date, daysOut: number): string {
  const r = new Date(d)
  r.setUTCDate(r.getUTCDate() + daysOut)
  const m = String(r.getUTCMonth() + 1).padStart(2, '0')
  const day = String(r.getUTCDate()).padStart(2, '0')
  return `${r.getUTCFullYear()}${m}${day}`
}

/**
 * Format short legs as a position identifier.
 * e.g. "$340P 21Jun25 (14d)" or "$340P 21Jun25 / $350C 21Jun25 (14d)"
 */
function legSummary(legs: OptionLeg[]): string {
  const shorts = legs.filter(l => l.quantity < 0)
  if (!shorts.length) return ''
  const minDte = Math.min(...shorts.map(l => l.dte))
  const parts = shorts.map(l => `$${l.strike}${l.putCall} ${fmtExpiry(l.expiry)}`)
  return `${parts.join(' / ')} (${minDte}d)`
}

/** Suggest a roll-out expiry: nearest monthly ≥ 30 DTE from the current short leg expiry */
function suggestRollExpiry(currentExpiry: string, targetDte = 35): string {
  const base = expiryDate(currentExpiry)
  return addDays(base, targetDte)
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

// ─── Main engine ──────────────────────────────────────────────────────────────

export function generateActions(strategies: Strategy[], positions: RawPosition[]): Action[] {
  const actions: Action[] = []

  for (const s of strategies) {
    const shortLegs  = s.legs.filter(l => l.quantity < 0)
    const minDte     = shortLegs.length ? Math.min(...shortLegs.map(l => l.dte)) : Infinity
    const premium    = s.netPremiumReceived
    const pnl        = s.unrealizedPnL
    const profitPct  = premium > 0 ? pnl / premium : 0
    const lossExcessive = pnl < 0 && premium > 0 && Math.abs(pnl) > premium * 0.5
    const summary    = legSummary(s.legs)

    // ── Covered Calls & CSPs ────────────────────────────────────────────────
    if (s.type === 'covered_call' || s.type === 'csp') {
      const shortLeg = shortLegs[0]

      if (lossExcessive) {
        const lossRatio = (Math.abs(pnl / premium) * 100).toFixed(0)
        // Suggest rolling to a lower strike (for CC) or higher strike (for CSP)
        const rollStrike = shortLeg
          ? (s.type === 'covered_call'
              ? Math.round(shortLeg.strike * 0.97 / 5) * 5   // ~3% lower, round to $5
              : Math.round(shortLeg.strike * 1.03 / 5) * 5)  // ~3% higher for CSP
          : undefined
        const rollExpiry = shortLeg ? suggestRollExpiry(shortLeg.expiry, 35) : undefined
        actions.push(action(s.type, s.underlying, 'urgent', 'roll',
          `Loss ${lossRatio}% of premium — exceeds 50% stop`,
          s.type === 'covered_call'
            ? `Roll the short call down and out to collect credit and lower your cost basis. New strike should be at or below current stock price.`
            : `Roll the short put down and out to collect credit and give the trade more room to recover.`,
          {
            relatedStrategyId: s.id,
            legSummary: summary,
            suggestedStrike: rollStrike,
            suggestedExpiry: rollExpiry ? fmtExpiry(rollExpiry) : undefined,
            suggestedDelta: 0.25,
          }
        ))
      } else if (minDte <= 7) {
        actions.push(action(s.type, s.underlying, 'urgent', 'close',
          `${minDte} DTE — expiration imminent`,
          s.type === 'csp'
            ? `With ${minDte} DTE, decide now: let expire worthless (if OTM), close for a small debit, or accept assignment and start the CC wheel.`
            : `With ${minDte} DTE, close now or roll out 30–45 DTE to avoid share call-away. If deep ITM, rolling may cost a debit — weigh against assignment.`,
          { relatedStrategyId: s.id, legSummary: summary }
        ))
      } else if (profitPct >= 0.5) {
        const rollExpiry = shortLeg ? suggestRollExpiry(shortLeg.expiry, 35) : undefined
        actions.push(action(s.type, s.underlying, 'manage', 'close',
          `${(profitPct * 100).toFixed(0)}% of max profit captured — 50% rule`,
          `Close at 50%+ profit to free up buying power and redeploy into a fresh position. ${minDte} DTE remaining.`,
          {
            relatedStrategyId: s.id,
            legSummary: summary,
            suggestedExpiry: rollExpiry ? fmtExpiry(rollExpiry) : undefined,
            suggestedDelta: 0.25,
          }
        ))
      } else if (minDte <= 21) {
        const rollStrike = shortLeg?.strike
        const rollExpiry = shortLeg ? suggestRollExpiry(shortLeg.expiry, 35) : undefined
        actions.push(action(s.type, s.underlying, 'manage', 'roll',
          `${minDte} DTE — entering 21-day management zone`,
          `Roll out to the next monthly expiry (30–45 DTE) for additional credit. Keep the same strike unless price has moved significantly.`,
          {
            relatedStrategyId: s.id,
            legSummary: summary,
            suggestedStrike: rollStrike,
            suggestedExpiry: rollExpiry ? fmtExpiry(rollExpiry) : undefined,
            suggestedDelta: 0.25,
          }
        ))
      }
    }

    // ── PMCC — manage the short leg ─────────────────────────────────────────
    if (s.type === 'pmcc') {
      const shortCall = s.legs.find(l => l.quantity < 0)
      const longCall  = s.legs.find(l => l.quantity > 0)
      if (shortCall) {
        if (lossExcessive) {
          const maxStrike = longCall ? longCall.strike - 5 : undefined
          actions.push(action(s.type, s.underlying, 'urgent', 'roll',
            `Short call loss exceeds 50% of premium`,
            `Roll short call up and out. New strike MUST stay below the LEAP strike ($${longCall?.strike ?? '?'}) to preserve defined risk.`,
            {
              relatedStrategyId: s.id,
              legSummary: summary,
              suggestedStrike: maxStrike,
              suggestedExpiry: fmtExpiry(suggestRollExpiry(shortCall.expiry, 35)),
              suggestedDelta: 0.25,
            }
          ))
        } else if (shortCall.dte <= 7) {
          const maxStrike = longCall ? longCall.strike - 5 : undefined
          actions.push(action(s.type, s.underlying, 'urgent', 'open',
            `Short call at ${shortCall.dte} DTE — sell next cycle now`,
            `Short leg expiring. Open a new short call at ~0.25–0.30 delta for the next monthly to keep the PMCC working.`,
            {
              relatedStrategyId: s.id,
              legSummary: summary,
              suggestedStrike: maxStrike,
              suggestedExpiry: fmtExpiry(suggestRollExpiry(shortCall.expiry, 35)),
              suggestedDelta: 0.27,
            }
          ))
        } else if (profitPct >= 0.5 || shortCall.dte <= 21) {
          actions.push(action(s.type, s.underlying, 'manage', 'roll',
            shortCall.dte <= 21 ? `Short call at ${shortCall.dte} DTE` : `${(profitPct * 100).toFixed(0)}% profit — roll for more premium`,
            `Roll short call to next monthly (30–45 DTE). Keep new strike below LEAP strike ($${longCall?.strike ?? '?'}) for full upside capture.`,
            {
              relatedStrategyId: s.id,
              legSummary: summary,
              suggestedExpiry: fmtExpiry(suggestRollExpiry(shortCall.expiry, 35)),
              suggestedDelta: 0.25,
            }
          ))
        }
      }
    }

    // ── Risk Reversals ──────────────────────────────────────────────────────
    if (s.type === 'risk_reversal') {
      if (minDte <= 14) {
        actions.push(action(s.type, s.underlying, 'manage', 'close',
          `${minDte} DTE — pin risk approaching`,
          `Close both legs before expiry to avoid assignment on the short put or unlimited upside risk on the short call.`,
          { relatedStrategyId: s.id, legSummary: summary }
        ))
      } else if (lossExcessive) {
        actions.push(action(s.type, s.underlying, 'urgent', 'manage',
          `Loss exceeds 50% of short put premium`,
          `Review immediately. Consider buying back the short put leg to cap further losses. Evaluate whether to hold the long call.`,
          { relatedStrategyId: s.id, legSummary: summary }
        ))
      }
    }

    // ── Spreads ─────────────────────────────────────────────────────────────
    if (s.type === 'put_spread' || s.type === 'call_spread') {
      if (lossExcessive) {
        actions.push(action(s.type, s.underlying, 'urgent', 'close',
          `Spread approaching max loss`,
          `Close entire spread now. Max loss on a spread is defined — taking it here prevents assignment risk and frees capital.`,
          { relatedStrategyId: s.id, legSummary: summary }
        ))
      } else if (minDte <= 14) {
        actions.push(action(s.type, s.underlying, 'manage', 'close',
          `${minDte} DTE — close to avoid pin risk`,
          `Close spread before expiry. Gamma accelerates sharply inside 2 weeks — the position can flip from profitable to max-loss quickly.`,
          { relatedStrategyId: s.id, legSummary: summary }
        ))
      } else if (premium > 0 && profitPct >= 0.75) {
        actions.push(action(s.type, s.underlying, 'manage', 'close',
          `${(profitPct * 100).toFixed(0)}% of max profit captured`,
          `Close spread at 75%+ profit. The remaining $${(premium * (1 - profitPct)).toFixed(2)} of potential gain isn't worth the residual risk.`,
          { relatedStrategyId: s.id, legSummary: summary }
        ))
      }
    }

    // ── LEAPs — watch only ──────────────────────────────────────────────────
    if (s.type === 'leap') {
      const longLeg = s.legs.find(l => l.quantity > 0)
      if (longLeg && longLeg.dte <= 90) {
        actions.push(action(s.type, s.underlying, 'watch', 'manage',
          `LEAP inside 90 DTE — theta decay accelerating`,
          `Long option losing time value rapidly. Plan to roll forward to a new LEAP (same or higher strike, 1–2 years out) before theta erodes intrinsic value.`,
          {
            relatedStrategyId: s.id,
            legSummary: legSummary([longLeg]),
          }
        ))
      }
    }
  }

  // ── Opportunity: uncovered stocks (no CC written) ──────────────────────────
  const coveredUnderlying = new Set(
    strategies.filter(s => s.type === 'covered_call').map(s => s.underlying)
  )
  for (const p of positions) {
    if (p.assetClass === 'STK' && p.quantity >= 100 && !coveredUnderlying.has(p.symbol)) {
      const lots = Math.floor(p.quantity / 100)
      actions.push(action('covered_call', p.symbol, 'opportunity', 'open',
        `${p.quantity} shares held — no covered call written`,
        `Sell ${lots > 1 ? `${lots} contracts` : '1 contract'} at the ~0.25–0.30 delta strike, 30–45 DTE, to generate premium income on idle shares.`,
        { suggestedDelta: 0.27 }
      ))
    }
  }

  // Sort: urgent → manage → opportunity → watch
  const urgencyOrder: Record<Action['urgency'], number> = { urgent: 0, manage: 1, opportunity: 2, watch: 3 }
  return actions.sort((a, b) => urgencyOrder[a.urgency] - urgencyOrder[b.urgency])
}
