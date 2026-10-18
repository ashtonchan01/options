/**
 * Turn the parsed Activity Statement fixture into RawTrades the realised
 * engine can sum. The Forex trades section has no Realized P/L column, so
 * those fills are not trades here; `forexSummary` carries the summary's
 * short-term profit and loss as two fifo figures.
 */
import type { OpenClose, PutCall, RawTrade } from '../types'

export interface StatementTrade {
  section: 'stocks' | 'options'
  symbol: string
  date: string
  time?: string
  code?: string
  quantity: number
  price: number
  proceeds: number
  commissions: number
  basis: number
  realized: number
  underlying?: string
  expiry?: string
  strike?: number
  putCall?: PutCall
}

export interface ForexSummaryTrade {
  symbol: string
  date: string
  time?: string
  fifoPnlRealized: number
  source?: string
}

export interface StatementSymbol {
  category: 'stocks' | 'options' | 'forex'
  symbol: string
  stProfit: number
  stLoss: number
  ltProfit: number
  ltLoss: number
  realized: number
}

export interface StatementFixture {
  accountId: string
  fyStartYear: number
  currency: string
  official: {
    stocks: number
    stocksStProfit: number
    stocksLtProfit: number
    options: number
    optionsStProfit: number
    optionsStLoss: number
    forex: number
    forexStProfit: number
    forexStLoss: number
    total: number
    otherFees: number
    brokerInterest: number
  }
  symbols: StatementSymbol[]
  trades: StatementTrade[]
  forexSummary: ForexSummaryTrade[]
}

function openCloseFromCode(code: string | undefined): OpenClose | undefined {
  if (!code) return undefined
  const parts = new Set(code.split(';').filter(Boolean))
  if (parts.has('C') || parts.has('Ep') || parts.has('Ex')) return 'C'
  if (parts.has('O')) return 'O'
  return undefined
}

export function tradesFromFixture(fixture: StatementFixture): RawTrade[] {
  const trades: RawTrade[] = fixture.trades.map(t => ({
    accountId: fixture.accountId,
    tradeDate: t.date,
    tradeTime: t.time,
    symbol: t.section === 'stocks' ? t.symbol : (t.underlying ?? t.symbol),
    underlyingSymbol: t.underlying ?? t.symbol,
    assetClass: t.section === 'options' ? 'OPT' as const : 'STK' as const,
    putCall: t.putCall,
    strike: t.strike,
    expiry: t.expiry,
    quantity: t.quantity,
    tradePrice: t.price,
    proceeds: t.proceeds,
    commissions: t.commissions,
    cost: t.basis,
    netCash: t.proceeds + t.commissions,
    openClose: openCloseFromCode(t.code),
    fifoPnlRealized: t.realized,
  }))
  for (const fx of fixture.forexSummary) {
    trades.push({
      accountId: fixture.accountId,
      tradeDate: fx.date,
      tradeTime: fx.time,
      symbol: fx.symbol,
      assetClass: 'CASH',
      quantity: 0,
      tradePrice: 0,
      proceeds: 0,
      commissions: 0,
      netCash: 0,
      fifoPnlRealized: fx.fifoPnlRealized,
    })
  }
  return trades
}
