import type { RawPosition, Strategy, OptionLeg, StockPosition, StrategyType } from '../types'
import { nanoid } from '../utils/nanoid'

// Normalize compact IBKR date "20260508" → "2026-05-08"
function normalizeDate(raw: string): string {
  return raw.length === 8 ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : raw
}

function dte(expiry: string): number {
  const exp = new Date(normalizeDate(expiry) + 'T23:59:59')
  return Math.max(0, Math.ceil((exp.getTime() - Date.now()) / 86_400_000))
}

function toOptionLeg(p: RawPosition): OptionLeg {
  return {
    symbol:       p.symbol,
    underlying:   p.underlyingSymbol ?? p.symbol,
    putCall:      p.putCall!,
    strike:       p.strike!,
    expiry:       p.expiry!,
    dte:          dte(p.expiry!),
    quantity:     p.quantity,
    markPrice:    p.markPrice,
    costBasis:    p.costBasisMoney,
    unrealizedPnL: p.unrealizedPnL,
  }
}

function toStockPosition(p: RawPosition): StockPosition {
  return {
    symbol:       p.symbol,
    quantity:     p.quantity,
    avgCost:      p.costBasisPrice,
    markPrice:    p.markPrice,
    unrealizedPnL: p.unrealizedPnL,
  }
}

function strategyPnL(legs: OptionLeg[], shares?: StockPosition): number {
  const legPnL = legs.reduce((s, l) => s + l.unrealizedPnL, 0)
  return legPnL + (shares?.unrealizedPnL ?? 0)
}

function netPremium(legs: OptionLeg[]): number {
  // negative costBasis on short legs = credit received
  return -legs.reduce((s, l) => s + l.costBasis, 0)
}

// ─── Classifier ───────────────────────────────────────────────────────────────
// Priority: spreads → covered calls → PMCC → risk reversals → CSPs → LEAPs → other

export function classifyPositions(positions: RawPosition[]): Strategy[] {
  const opts = positions.filter(p => p.assetClass === 'OPT' && p.putCall && p.expiry && p.strike)
  const stks = positions.filter(p => p.assetClass === 'STK')
  const usedIds = new Set<string>()
  const strategies: Strategy[] = []

  const id = (p: RawPosition) => p.symbol

  // 1. Spreads — same underlying, same expiry, same putCall, opposing quantities
  const byKey = new Map<string, RawPosition[]>()
  for (const o of opts) {
    const key = `${o.underlyingSymbol ?? o.symbol}|${o.expiry}|${o.putCall}`
    byKey.set(key, [...(byKey.get(key) ?? []), o])
  }
  for (const [, legs] of byKey) {
    if (legs.length < 2) continue
    const shorts = legs.filter(l => l.quantity < 0)
    const longs  = legs.filter(l => l.quantity > 0)
    if (shorts.length && longs.length && !shorts.some(l => usedIds.has(id(l))) && !longs.some(l => usedIds.has(id(l)))) {
      const all = [...shorts, ...longs]
      all.forEach(l => usedIds.add(id(l)))
      const legObjs = all.map(toOptionLeg)
      const type: StrategyType = shorts[0].putCall === 'P' ? 'put_spread' : 'call_spread'
      strategies.push({
        id: nanoid(),
        type,
        underlying: shorts[0].underlyingSymbol ?? shorts[0].symbol,
        legs: legObjs,
        netPremiumReceived: netPremium(legObjs),
        maxProfit: 0,
        maxLoss: 0,
        unrealizedPnL: strategyPnL(legObjs),
      })
    }
  }

  // 2. Covered Calls — short call + ≥100 shares of same underlying
  const shortCalls = opts.filter(o => o.putCall === 'C' && o.quantity < 0 && !usedIds.has(id(o)))
  for (const sc of shortCalls) {
    const underlying = sc.underlyingSymbol ?? sc.symbol
    const stock = stks.find(s => s.symbol === underlying && s.quantity >= 100)
    if (stock) {
      usedIds.add(id(sc))
      const leg = toOptionLeg(sc)
      const shares = toStockPosition(stock)
      strategies.push({
        id: nanoid(),
        type: 'covered_call',
        underlying,
        legs: [leg],
        shares,
        netPremiumReceived: netPremium([leg]),
        maxProfit: (sc.strike! - stock.costBasisPrice) * stock.quantity + leg.costBasis * -1,
        maxLoss: stock.costBasisPrice * stock.quantity,
        unrealizedPnL: strategyPnL([leg], shares),
      })
    }
  }

  // 3. PMCC — short call + long LEAP call (same underlying, later expiry)
  const remainingShortCalls = opts.filter(o => o.putCall === 'C' && o.quantity < 0 && !usedIds.has(id(o)))
  const longLeapCalls = opts.filter(o => o.putCall === 'C' && o.quantity > 0 && dte(o.expiry!) > 365 && !usedIds.has(id(o)))
  for (const sc of remainingShortCalls) {
    const underlying = sc.underlyingSymbol ?? sc.symbol
    const leap = longLeapCalls.find(l =>
      (l.underlyingSymbol ?? l.symbol) === underlying &&
      l.expiry! > sc.expiry! &&
      !usedIds.has(id(l))
    )
    if (leap) {
      usedIds.add(id(sc))
      usedIds.add(id(leap))
      const legs = [toOptionLeg(sc), toOptionLeg(leap)]
      strategies.push({
        id: nanoid(),
        type: 'pmcc',
        underlying,
        legs,
        netPremiumReceived: netPremium(legs),
        maxProfit: 0,
        maxLoss: legs[1].costBasis, // cost of LEAP
        unrealizedPnL: strategyPnL(legs),
      })
    }
  }

  // 4. Risk Reversals — short put + long call, similar expiry (±30d), different strikes
  const shortPuts = opts.filter(o => o.putCall === 'P' && o.quantity < 0 && !usedIds.has(id(o)))
  const longCalls  = opts.filter(o => o.putCall === 'C' && o.quantity > 0 && !usedIds.has(id(o)))
  for (const sp of shortPuts) {
    const underlying = sp.underlyingSymbol ?? sp.symbol
    const lc = longCalls.find(l => {
      if (usedIds.has(id(l))) return false
      if ((l.underlyingSymbol ?? l.symbol) !== underlying) return false
      const daysDiff = Math.abs(dte(l.expiry!) - dte(sp.expiry!))
      return daysDiff <= 30 && l.strike !== sp.strike
    })
    if (lc) {
      usedIds.add(id(sp))
      usedIds.add(id(lc))
      const legs = [toOptionLeg(sp), toOptionLeg(lc)]
      strategies.push({
        id: nanoid(),
        type: 'risk_reversal',
        underlying,
        legs,
        netPremiumReceived: netPremium(legs),
        maxProfit: Infinity,
        maxLoss: sp.strike! * (Math.abs(sp.quantity) * (sp.multiplier ?? 100)),
        unrealizedPnL: strategyPnL(legs),
      })
    }
  }

  // 5. CSPs — remaining short puts
  for (const sp of opts.filter(o => o.putCall === 'P' && o.quantity < 0 && !usedIds.has(id(o)))) {
    usedIds.add(id(sp))
    const leg = toOptionLeg(sp)
    strategies.push({
      id: nanoid(),
      type: 'csp',
      underlying: sp.underlyingSymbol ?? sp.symbol,
      legs: [leg],
      netPremiumReceived: netPremium([leg]),
      maxProfit: -sp.costBasisMoney,
      maxLoss: sp.strike! * Math.abs(sp.quantity) * (sp.multiplier ?? 100),
      unrealizedPnL: strategyPnL([leg]),
    })
  }

  // 6. LEAPs — long options DTE > 365
  for (const o of opts.filter(o => o.quantity > 0 && dte(o.expiry!) > 365 && !usedIds.has(id(o)))) {
    usedIds.add(id(o))
    const leg = toOptionLeg(o)
    strategies.push({
      id: nanoid(),
      type: 'leap',
      underlying: o.underlyingSymbol ?? o.symbol,
      legs: [leg],
      netPremiumReceived: 0,
      maxProfit: Infinity,
      maxLoss: o.costBasisMoney,
      unrealizedPnL: strategyPnL([leg]),
    })
  }

  // 7. Other — anything remaining
  for (const o of opts.filter(o => !usedIds.has(id(o)))) {
    const leg = toOptionLeg(o)
    strategies.push({
      id: nanoid(),
      type: 'other',
      underlying: o.underlyingSymbol ?? o.symbol,
      legs: [leg],
      netPremiumReceived: netPremium([leg]),
      maxProfit: 0,
      maxLoss: 0,
      unrealizedPnL: strategyPnL([leg]),
    })
  }

  return strategies
}
