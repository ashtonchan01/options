/**
 * Live income figures from an already-synced Flex book.
 * Returned objects never include an IBKR account id.
 */
import type { RawPosition, RawTrade } from '../types'
import type { IncomeSettings, SeedPut, SeedSell } from './incomeSeed'
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

export function booksFor(sources: IncomeSource[], now: Date): LiveBook[] {
  const books = sources.map(source => toLiveBook(source, now))
  const order: Record<AccountRole, number> = { personal: 0, business: 1, other: 2 }
  return books.sort((a, b) => order[a.role] - order[b.role] || a.name.localeCompare(b.name))
}

export type ElState = 'below' | 'ok' | 'unknown'

export function elState(excessLiquidity: number | undefined, floor: number): ElState {
  if (excessLiquidity == null || !Number.isFinite(excessLiquidity)) return 'unknown'
  return excessLiquidity < floor ? 'below' : 'ok'
}

export function planPremium(sells: SeedSell[], role: 'personal' | 'business', which: 'now' | 'after'): number {
  return sells
    .filter(sell => sell.account === role && (which === 'after' || sell.phase === 'now'))
    .reduce((sum, sell) => sum + sell.premium, 0)
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

export interface LiveRule {
  id: string
  rule: string
  status: 'yes' | 'no' | 'unknown'
  detail: string
}

function bookByRole(books: LiveBook[], role: AccountRole): LiveBook | undefined {
  return books.find(book => book.role === role)
}

function symbolSet(symbols: string[]): Set<string> {
  return new Set(symbols.map(symbol => symbol.trim().toUpperCase()).filter(Boolean))
}

export function liveRules(books: LiveBook[], settings: IncomeSettings): LiveRule[] {
  const excluded = symbolSet(settings.excludeSymbols)
  const etfs = symbolSet(settings.etfSymbols)
  const rules: LiveRule[] = []
  for (const role of ['personal', 'business'] as const) {
    const book = bookByRole(books, role)
    const label = role === 'personal' ? 'Personal' : 'Business'
    const floorLabel = Math.round(settings.elFloor).toLocaleString('en-US')
    if (!book) {
      rules.push({ id: `${role}-el`, rule: `${label} excess liquidity above ${floorLabel}`, status: 'unknown', detail: 'Account not in this snapshot' })
      continue
    }
    const state = elState(book.excessLiquidity, settings.elFloor)
    rules.push({
      id: `${role}-el`,
      rule: `${label} excess liquidity above ${floorLabel}`,
      status: state === 'unknown' ? 'unknown' : state === 'ok' ? 'yes' : 'no',
      detail: state === 'unknown' ? 'Not in the Flex snapshot' : Math.round(book.excessLiquidity ?? 0).toLocaleString('en-US'),
    })
  }

  const personal = bookByRole(books, 'personal')
  if (!personal) {
    rules.push({ id: 'personal-cash', rule: 'Every personal short put fully cash-covered', status: 'unknown', detail: 'Account not in this snapshot' })
    rules.push({ id: 'personal-count', rule: 'At most three personal short puts', status: 'unknown', detail: 'Account not in this snapshot' })
  } else if (personal.shortPutCount === 0 && personal.shares.length === 0 && personal.cash == null) {
    rules.push({ id: 'personal-cash', rule: 'Every personal short put fully cash-covered', status: 'unknown', detail: 'No open book in this snapshot' })
    rules.push({ id: 'personal-count', rule: 'At most three personal short puts', status: 'unknown', detail: 'No open book in this snapshot' })
  } else {
    const covered = personal.cash != null && personal.cash >= personal.shortPutNotional
    rules.push({
      id: 'personal-cash',
      rule: 'Every personal short put fully cash-covered',
      status: personal.cash == null ? 'unknown' : covered || personal.shortPutCount === 0 ? 'yes' : 'no',
      detail: personal.cash == null
        ? 'Cash is not in this snapshot'
        : `${Math.round(personal.shortPutNotional).toLocaleString('en-US')} notional vs ${Math.round(personal.cash).toLocaleString('en-US')} cash`,
    })
    rules.push({
      id: 'personal-count',
      rule: 'At most three personal short puts',
      status: personal.shortPutCount <= 3 ? 'yes' : 'no',
      detail: `${personal.shortPutCount} short put${personal.shortPutCount === 1 ? '' : 's'} open`,
    })
  }

  const mstrPuts = books.filter(book => book.shortOptions.some(option => option.underlying === 'MSTR' && option.putCall === 'P')).map(book => book.name)
  rules.push({
    id: 'mstr-puts',
    rule: 'No new MSTR puts',
    status: !settings.noNewMstrPuts ? 'unknown' : mstrPuts.length === 0 ? 'yes' : 'no',
    detail: !settings.noNewMstrPuts ? 'Rule turned off' : mstrPuts.length === 0 ? 'None open' : `Open in ${[...new Set(mstrPuts)].join(', ')}`,
  })

  const etfShorts = books.flatMap(book => book.shortOptions.filter(o => etfs.has(o.underlying)))
  const etfShares = books.flatMap(book => book.shares.filter(row => etfs.has(row.symbol) && row.quantity !== 0))
  rules.push({
    id: 'etf',
    rule: 'No ETF holdings or ETF short options',
    status: etfShorts.length === 0 && etfShares.length === 0 ? 'yes' : 'no',
    detail: etfShorts.length === 0 && etfShares.length === 0
      ? 'None in the open book'
      : [...new Set([...etfShorts.map(o => o.underlying), ...etfShares.map(row => row.symbol)])].join(', '),
  })

  const amznPuts = books.flatMap(book => book.shortOptions.filter(o => o.underlying === 'AMZN' && o.putCall === 'P'))
  const excludedPuts = books.flatMap(book => book.shortOptions.filter(o => o.putCall === 'P' && excluded.has(o.underlying)))
  rules.push({
    id: 'excluded-puts',
    rule: 'No short puts in the exclude list',
    status: excludedPuts.length === 0 ? 'yes' : 'no',
    detail: excludedPuts.length === 0 ? 'None open' : [...new Set(excludedPuts.map(o => o.underlying))].join(', '),
  })
  rules.push({
    id: 'amzn',
    rule: 'No AMZN short puts',
    status: amznPuts.length === 0 ? 'yes' : 'no',
    detail: amznPuts.length === 0 ? 'None open' : `${amznPuts.length} open`,
  })

  if (settings.tslaCallsCoveredOnly) {
    const uncovered = books.filter(book => {
      const contracts = book.shortOptions.filter(o => o.underlying === 'TSLA' && o.putCall === 'C').reduce((sum, o) => sum + Math.abs(o.quantity), 0)
      return contracts > 0 && callCover(book, 'TSLA', contracts) === 'short'
    })
    rules.push({
      id: 'tsla-calls',
      rule: 'TSLA calls only covered by held shares',
      status: uncovered.length === 0 ? 'yes' : 'no',
      detail: uncovered.length === 0 ? 'No uncovered TSLA calls' : uncovered.map(book => book.name).join(', '),
    })
  }

  for (const blackout of settings.earningsBlackouts) {
    const symbol = blackout.symbol.toUpperCase()
    const open = books.flatMap(book => book.shortOptions.filter(o => o.underlying === symbol && o.putCall === 'P' && (!o.expiry || o.expiry >= blackout.date)))
    rules.push({
      id: `earn-${symbol}`,
      rule: `No short ${symbol} puts through ${blackout.label}`,
      status: open.length === 0 ? 'yes' : 'no',
      detail: open.length === 0 ? 'None open' : open.map(o => `${o.quantity} ${o.strike}P ${o.expiry}`).join('; '),
    })
  }
  return rules
}

export type UsSession = 'regular' | 'pre' | 'post' | 'closed'

export function usEquitySession(now: Date): UsSession {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const weekday = parts.find(p => p.type === 'weekday')?.value ?? ''
  const hour = Number(parts.find(p => p.type === 'hour')?.value)
  const minute = Number(parts.find(p => p.type === 'minute')?.value)
  if (weekday === 'Sat' || weekday === 'Sun') return 'closed'
  const mins = hour * 60 + minute
  if (mins >= 9 * 60 + 30 && mins < 16 * 60) return 'regular'
  if (mins < 9 * 60 + 30) return 'pre'
  return 'post'
}

export interface QuoteFreshness {
  stale: boolean
  label: string
}

export function quoteFreshness(args: { marketState?: string | null; now: Date }): QuoteFreshness {
  const state = args.marketState?.toUpperCase()
  if (state === 'REGULAR') return { stale: false, label: 'Regular session' }
  if (state === 'PRE' || state === 'PREPRE') return { stale: true, label: 'Pre-market' }
  if (state === 'POST' || state === 'POSTPOST') return { stale: true, label: 'After hours' }
  if (state === 'CLOSED') return { stale: true, label: 'Prior close' }
  const session = usEquitySession(args.now)
  if (session === 'regular') return { stale: false, label: 'Regular session' }
  if (session === 'pre') return { stale: true, label: 'Pre-market' }
  if (session === 'post') return { stale: true, label: 'After hours' }
  return { stale: true, label: 'Prior close' }
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
    blockedMstr: settings.noNewMstrPuts && row.symbol === 'MSTR',
    band: deltaInBand(row.delta, settings.deltaMin, settings.deltaMax),
    ratio: premiumOverCash(row.premium, row.cash),
  }))
  return ranked.sort((a, b) => Number(a.excluded) - Number(b.excluded) || b.ratio - a.ratio)
}

export function callYield(premium: number, spot: number, contracts: number): number {
  const denom = spot * contracts * 100
  return denom > 0 ? premium / denom : 0
}

export function exitUpside(spot: number, exitPrice: number): number {
  return spot > 0 ? exitPrice / spot - 1 : 0
}

export function usd0(n: number): string {
  return Math.round(n).toLocaleString('en-US')
}

export function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`
}
