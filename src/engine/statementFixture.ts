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
    /** Long-term loss when the statement prints one. Absent on FY2025-26 stocks, which had long-term profit only. */
    stocksLtLoss?: number
    /** Market value of position transfers in the Change in NAV. Realised P&L on those rows is zero. */
    positionTransfers?: number
  }
  symbols: StatementSymbol[]
  trades: StatementTrade[]
  forexSummary: ForexSummaryTrade[]
  /** Incoming transfers. Market value is not a tax cost and realised is 0. */
  transfers?: StatementTransfer[]
}

export interface StatementTransfer {
  symbol: string
  date: string
  quantity: number
  marketValue: number
  realized: number
  direction?: 'IN' | 'OUT'
}

function openCloseFromCode(code: string | undefined): OpenClose | undefined {
  if (!code) return undefined
  const parts = new Set(code.split(';').filter(Boolean))
  if (parts.has('C') || parts.has('Ep') || parts.has('Ex')) return 'C'
  if (parts.has('O')) return 'O'
  return undefined
}

function assignmentClose(t: StatementTrade): boolean {
  if (t.section !== 'stocks' || t.quantity >= 0) return false
  const tokens = new Set((t.code ?? '').split(';').map(s => s.trim().toUpperCase()).filter(Boolean))
  // A = assignment, Ex = exercise. The stock was delivered. C;HC on an
  // ordinary sale (the 16 Oct 2026 MSTR fill) is not one of these.
  return tokens.has('A') || tokens.has('EX')
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
    ...(assignmentClose(t) ? { isAssignment: true } : {}),
  }))
  for (const tr of fixture.transfers ?? []) {
    const inbound = tr.direction !== 'OUT'
    const qty = inbound ? Math.abs(tr.quantity) : -Math.abs(tr.quantity)
    const price = tr.quantity !== 0 ? tr.marketValue / Math.abs(tr.quantity) : 0
    trades.push({
      accountId: fixture.accountId,
      tradeDate: tr.date,
      symbol: tr.symbol,
      assetClass: 'STK',
      quantity: qty,
      tradePrice: price,
      proceeds: inbound ? -tr.marketValue : tr.marketValue,
      commissions: 0,
      netCash: inbound ? -tr.marketValue : tr.marketValue,
      isTransfer: true,
      fifoPnlRealized: tr.realized,
    })
  }
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
