import type { Action, Strategy, RawPosition, StrategyType } from '../types'
import { nanoid } from '../utils/nanoid'

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

export function generateActions(strategies: Strategy[], positions: RawPosition[]): Action[] {
  const actions: Action[] = []

  for (const s of strategies) {
    const shortLegs  = s.legs.filter(l => l.quantity < 0)
    const minDte     = shortLegs.length ? Math.min(...shortLegs.map(l => l.dte)) : Infinity
    const premium    = s.netPremiumReceived
    const pnl        = s.unrealizedPnL
    const profitPct  = premium > 0 ? pnl / premium : 0
    const lossExcessive = pnl < 0 && premium > 0 && Math.abs(pnl) > premium * 0.5

    // ── Covered Calls & CSPs ─────────────────────────────────────────────
    if (s.type === 'covered_call' || s.type === 'csp') {
      if (lossExcessive) {
        actions.push(action(s.type, s.underlying, 'urgent', 'roll',
          `Loss is ${(Math.abs(pnl / premium) * 100).toFixed(0)}% of premium — exceeds 50% threshold`,
          `Roll down and out to a lower strike / later expiry to collect credit and reduce loss.`,
          { relatedStrategyId: s.id }
        ))
      } else if (minDte <= 7) {
        actions.push(action(s.type, s.underlying, 'urgent', 'close',
          `${minDte} DTE — expiration imminent`,
          `Close position now or prepare for ${s.type === 'csp' ? 'assignment / let expire worthless' : 'share call-away or roll'}.`,
          { relatedStrategyId: s.id }
        ))
      } else if (profitPct >= 0.5) {
        actions.push(action(s.type, s.underlying, 'manage', 'close',
          `${(profitPct * 100).toFixed(0)}% of max profit captured`,
          `Close at 50%+ profit to free capital and redeploy. ${minDte} DTE remaining.`,
          { relatedStrategyId: s.id }
        ))
      } else if (minDte <= 21) {
        actions.push(action(s.type, s.underlying, 'manage', 'roll',
          `${minDte} DTE — entering management zone`,
          `Roll out to the next monthly expiry. Collect additional credit to lower cost basis.`,
          { relatedStrategyId: s.id }
        ))
      }
    }

    // ── PMCC — manage the short leg ──────────────────────────────────────
    if (s.type === 'pmcc') {
      const shortCall = s.legs.find(l => l.quantity < 0)
      if (shortCall) {
        if (lossExcessive) {
          actions.push(action(s.type, s.underlying, 'urgent', 'roll',
            `Short call loss exceeds 50% of premium`,
            `Roll short call up and out. Ensure new strike stays below the LEAP strike.`,
            { relatedStrategyId: s.id }
          ))
        } else if (shortCall.dte <= 7) {
          actions.push(action(s.type, s.underlying, 'urgent', 'open',
            `Short call at ${shortCall.dte} DTE — open next cycle`,
            `Short leg expiring. Sell a new short call on the next monthly to keep the PMCC active.`,
            { relatedStrategyId: s.id }
          ))
        } else if (profitPct >= 0.5 || shortCall.dte <= 21) {
          actions.push(action(s.type, s.underlying, 'manage', 'roll',
            shortCall.dte <= 21 ? `Short call at ${shortCall.dte} DTE` : `${(profitPct * 100).toFixed(0)}% profit — roll for more premium`,
            `Roll short call to next monthly. Keep strike below LEAP strike for full upside protection.`,
            { relatedStrategyId: s.id }
          ))
        }
      }
    }

    // ── Risk Reversals ───────────────────────────────────────────────────
    if (s.type === 'risk_reversal') {
      if (minDte <= 14) {
        actions.push(action(s.type, s.underlying, 'manage', 'close',
          `${minDte} DTE — pin risk approaching`,
          `Close both legs to avoid assignment on the short put or undefined upside on the long call.`,
          { relatedStrategyId: s.id }
        ))
      } else if (lossExcessive) {
        actions.push(action(s.type, s.underlying, 'urgent', 'manage',
          `Loss exceeds 50% of short put premium`,
          `Review position. Consider closing the short put leg to cap further losses.`,
          { relatedStrategyId: s.id }
        ))
      }
    }

    // ── Spreads ──────────────────────────────────────────────────────────
    if (s.type === 'put_spread' || s.type === 'call_spread') {
      if (minDte <= 14) {
        actions.push(action(s.type, s.underlying, 'manage', 'close',
          `${minDte} DTE — close to avoid pin risk`,
          `Close spread before expiry. Gamma risk accelerates inside 2 weeks.`,
          { relatedStrategyId: s.id }
        ))
      } else if (premium > 0 && profitPct >= 0.75) {
        actions.push(action(s.type, s.underlying, 'manage', 'close',
          `${(profitPct * 100).toFixed(0)}% of max profit captured`,
          `Close spread at 75%+ profit. Remaining reward/risk ratio is unfavorable.`,
          { relatedStrategyId: s.id }
        ))
      } else if (lossExcessive) {
        actions.push(action(s.type, s.underlying, 'urgent', 'close',
          `Spread approaching max loss`,
          `Close position to stop loss. Max loss on a spread is defined — take it now.`,
          { relatedStrategyId: s.id }
        ))
      }
    }

    // ── LEAPs — watch only ───────────────────────────────────────────────
    if (s.type === 'leap') {
      if (minDte <= 90) {
        actions.push(action(s.type, s.underlying, 'watch',  'manage',
          `LEAP inside 90 DTE — consider rolling`,
          `Long option losing time value rapidly. Plan to roll forward or close before time decay accelerates.`,
          { relatedStrategyId: s.id }
        ))
      }
    }
  }

  // ── Opportunity: uncovered stocks (no CC written) ────────────────────
  const coveredUnderlying = new Set(
    strategies.filter(s => s.type === 'covered_call').map(s => s.underlying)
  )
  for (const p of positions) {
    if (p.assetClass === 'STK' && p.quantity >= 100 && !coveredUnderlying.has(p.symbol)) {
      actions.push(action('covered_call', p.symbol, 'opportunity', 'open',
        `${p.quantity} shares held — no covered call written`,
        `Sell a covered call at the 0.25–0.30 delta strike, 30–45 DTE, to generate premium income.`
      ))
    }
  }

  // Sort: urgent → manage → opportunity → watch
  const urgencyOrder: Record<Action['urgency'], number> = { urgent: 0, manage: 1, opportunity: 2, watch: 3 }
  return actions.sort((a, b) => urgencyOrder[a.urgency] - urgencyOrder[b.urgency])
}
