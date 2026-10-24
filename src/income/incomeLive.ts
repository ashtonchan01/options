/**
 * Live income figures from an already-synced Flex book.
 * Returned objects never include an IBKR account id.
 */
import type { RawPosition, RawTrade } from '../types'
import type { IncomeSettings, SeedPut } from './incomeSeed'
import { SEED_MARK_DATE } from './incomeSeed'

export interface IncomeSource {
  name: string
  positions: RawPosition[]
  trades: RawTrade[]
  cashBalance?: number
  netLiquidation?: number
  excessLiquidity?: number
}

export type AccountRole = 'personal' | 'business' | 'other'

export function accountRole(name: string): AccountRole {
  const n = name.toLowerCase()
  if (n.includes('personal')) return 'personal'
  if (n.includes('business')) return 'business'
  return 'other'
}

/** IBKR ids look like U21440275. The page shows a display name only. */
export function displayAccountName(name: string): string {
  return /^U\d{4,}$/i.test(name.trim()) ? 'Other account' : name.trim()
}

export interface LiveOption {
  underlying: string
  putCall: 'P' | 'C'
  strike: number
  expiry: string
  quantity: number
  mark: number
  multiplier: number
  /** Cost to buy this short back at the statement mark. Not the original credit. */
  closeCost: number
  notional: number
}

export interface LiveBook {
  name: string
  role: AccountRole
  netLiquidation?: number
  cash?: number
  excessLiquidity?: number
  shares: { symbol: string; quantity: number }[]
  shortOptions: LiveOption[]
  shortPutNotional: number
  shortPutCount: number
  openShortCloseCost: number
  realisedThisMonth: number
}

export function nyYearMonth(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now)
  const year = parts.find(p => p.type === 'year')?.value ?? '0000'
  const month = parts.find(p => p.type === 'month')?.value ?? '00'
  return `${year}${month}`
}

export function realisedInMonth(trades: RawTrade[], yearMonth: string): number {
  let sum = 0
  for (const trade of trades) {
    if (trade.isTransfer) continue
    if (!trade.tradeDate?.startsWith(yearMonth)) continue
    if (trade.openClose === 'O') continue
    if (typeof trade.fifoPnlRealized !== 'number' || !Number.isFinite(trade.fifoPnlRealized)) continue
    sum += trade.fifoPnlRealized
  }
  return sum
}

function isoExpiry(raw: string | undefined): string {
  if (!raw) return ''
  if (/^\d{8}$/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
  return raw.slice(0, 10)
}

/** Explicit Flex net liquidation wins. Otherwise the latest equity-history
 * point, then the same stock + option market value + cash Overview uses.
 * No snapshot stays undefined so a missing book does not become a zero gap. */
export function resolvedNetLiquidation(source: {
  netLiquidation?: number
  cashBalance?: number
  positions?: { assetClass?: string; positionValue?: number }[]
  equityHistory?: { netLiquidation?: number }[]
}): number | undefined {
  if (source.netLiquidation != null && Number.isFinite(source.netLiquidation)) return source.netLiquidation
  const history = source.equityHistory ?? []
  for (let i = history.length - 1; i >= 0; i--) {
    const value = history[i]?.netLiquidation
    if (value != null && Number.isFinite(value)) return value
  }
  const positions = source.positions ?? []
  if (positions.length === 0 && source.cashBalance == null) return undefined
  let marketValue = 0
  for (const position of positions) {
    if (position.assetClass !== 'STK' && position.assetClass !== 'OPT') continue
    if (typeof position.positionValue === 'number' && Number.isFinite(position.positionValue)) marketValue += position.positionValue
  }
  return marketValue + (source.cashBalance ?? 0)
}

export function toLiveBook(source: IncomeSource, now: Date): LiveBook {
  const shareMap = new Map<string, number>()
  const shortOptions: LiveOption[] = []
  for (const position of source.positions) {
    if (position.assetClass === 'STK') {
      const symbol = (position.underlyingSymbol || position.symbol).toUpperCase()
      shareMap.set(symbol, (shareMap.get(symbol) ?? 0) + position.quantity)
      continue
    }
    if (position.assetClass !== 'OPT' || position.quantity >= 0) continue
    if (position.putCall !== 'P' && position.putCall !== 'C') continue
    if (position.strike == null) continue
    const multiplier = position.multiplier && position.multiplier > 0 ? position.multiplier : 100
    const contracts = Math.abs(position.quantity)
    const underlying = (position.underlyingSymbol || position.symbol).toUpperCase()
    shortOptions.push({
      underlying,
      putCall: position.putCall,
      strike: position.strike,
      expiry: isoExpiry(position.expiry),
      quantity: position.quantity,
      mark: position.markPrice,
      multiplier,
      closeCost: contracts * position.markPrice * multiplier,
      notional: contracts * position.strike * multiplier,
    })
  }
  const puts = shortOptions.filter(o => o.putCall === 'P')
  return {
    name: displayAccountName(source.name),
    role: accountRole(source.name),
    netLiquidation: source.netLiquidation,
    cash: source.cashBalance,
    excessLiquidity: source.excessLiquidity,
    shares: [...shareMap.entries()]
      .filter(([, quantity]) => quantity !== 0)
      .map(([symbol, quantity]) => ({ symbol, quantity }))
      .sort((a, b) => a.symbol.localeCompare(b.symbol)),
    shortOptions,
    shortPutNotional: puts.reduce((sum, o) => sum + o.notional, 0),
    shortPutCount: puts.length,
    openShortCloseCost: shortOptions.reduce((sum, o) => sum + o.closeCost, 0),
    realisedThisMonth: realisedInMonth(source.trades, nyYearMonth(now)),
  }
}

export type ElState = 'below' | 'ok' | 'unknown'

export function elState(excessLiquidity: number | undefined, floor: number): ElState {
  if (excessLiquidity == null || !Number.isFinite(excessLiquidity)) return 'unknown'
  return excessLiquidity < floor ? 'below' : 'ok'
}

export function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso}T00:00:00Z`)
  const to = Date.parse(`${toIso}T00:00:00Z`)
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0
  return Math.round((to - from) / 86_400_000)
}

export function screenDays(expiryIso: string): number {
  return daysBetween(SEED_MARK_DATE, expiryIso)
}

export function premiumOverCash(premium: number, cash: number): number {
  return cash > 0 ? premium / cash : 0
}

export function annualizedReturn(ratio: number, days: number): number {
  return days > 0 ? ratio * (365 / days) : 0
}

export function rankByPremiumOverCash<T extends { premium: number; cash: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => premiumOverCash(b.premium, b.cash) - premiumOverCash(a.premium, a.cash))
}

export type DeltaBand = 'in' | 'out' | 'unknown'

export function deltaInBand(delta: number | null, min: number, max: number): DeltaBand {
  if (delta == null || !Number.isFinite(delta)) return 'unknown'
  const abs = Math.abs(delta)
  return abs >= min && abs <= max ? 'in' : 'out'
}

export function shareQuantity(book: LiveBook | undefined, symbol: string): number | undefined {
  if (!book) return undefined
  if (book.shares.length === 0 && book.shortOptions.length === 0 && book.netLiquidation == null && book.cash == null) return undefined
  return book.shares.find(row => row.symbol === symbol)?.quantity ?? 0
}

/** Contracts of a short call versus shares held. `unknown` when the book has no snapshot. */
export function callCover(book: LiveBook | undefined, symbol: string, contracts: number): 'covered' | 'short' | 'unknown' {
  const shares = shareQuantity(book, symbol)
  if (shares == null) return 'unknown'
  return shares >= contracts * 100 ? 'covered' : 'short'
}

function symbolSet(symbols: string[]): Set<string> {
  return new Set(symbols.map(symbol => symbol.trim().toUpperCase()).filter(Boolean))
}

export interface RankedPut extends SeedPut {
  /** Exclude list or ETF list. Still shown, after the ranked candidates. */
  excluded: boolean
  /** Separate from the exclude list: the screen still ranks the row. */
  blockedMstr: boolean
  band: DeltaBand
  ratio: number
}

export function putScreenRows(rows: SeedPut[], settings: IncomeSettings): RankedPut[] {
  const excluded = symbolSet(settings.excludeSymbols)
  const etfs = symbolSet(settings.etfSymbols)
  const ranked = rankByPremiumOverCash(rows).map(row => ({
    ...row,
    excluded: excluded.has(row.symbol) || etfs.has(row.symbol),
    blockedMstr: settings.rules.some(rule => rule.type === 'noNewPuts' && !rule.date && rule.symbol.trim().toUpperCase() === row.symbol),
    band: deltaInBand(row.delta, settings.deltaMin, settings.deltaMax),
    ratio: premiumOverCash(row.premium, row.cash),
  }))
  return ranked.sort((a, b) => Number(a.excluded) - Number(b.excluded) || b.ratio - a.ratio)
}

export function usd0(n: number): string {
  return Math.round(n).toLocaleString('en-US')
}

export function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`
}
