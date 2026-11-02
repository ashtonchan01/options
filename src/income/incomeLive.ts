/**
 * Live income figures from an already-synced Flex book.
 * Returned objects never include an IBKR account id.
 */
import type { RawPosition, RawTrade } from '../types'
import type { IncomeRule, IncomeSettings, SeedPut } from './incomeSeed'
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

const IDEA_NEAR_DAYS = 21
const IDEA_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Local calendar day, same clock the Overview expiry pills use. */
export function calendarIso(today: Date): string {
  const month = String(today.getMonth() + 1).padStart(2, '0')
  const day = String(today.getDate()).padStart(2, '0')
  return `${today.getFullYear()}-${month}-${day}`
}

function addIsoDays(iso: string, days: number): string {
  const time = Date.parse(`${iso}T00:00:00Z`)
  if (!Number.isFinite(time)) return iso
  return new Date(time + days * 86_400_000).toISOString().slice(0, 10)
}

/** Shorts expiring on or before this date still need a decision.
 * The income screen expiry wins when the user has set it further out than three weeks. */
export function ideaHorizon(todayIso: string, screenExpiry: string): string {
  const near = addIsoDays(todayIso, IDEA_NEAR_DAYS)
  return /^\d{4}-\d{2}-\d{2}$/.test(screenExpiry) && screenExpiry > near ? screenExpiry : near
}

export function formatIdeaDate(iso: string, todayIso: string): string {
  const day = Number(iso.slice(8, 10))
  const month = IDEA_MONTHS[Number(iso.slice(5, 7)) - 1] ?? iso
  const year = iso.slice(0, 4)
  if (!month || !day) return iso
  if (year === todayIso.slice(0, 4)) return `${day} ${month}`
  return `${day} ${month} '${year.slice(2)}`
}

function formatCount(n: number): string {
  return Number.isInteger(n)
    ? n.toLocaleString('en-US')
    : n.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

/** One Overview Ideas row. Built from the open book and income rules, never from the October narrative. */
export type LiveIdeaKind = 'floor' | 'expired' | 'resolve' | 'repair' | 'blackout' | 'exit'

export interface LiveIdea {
  key: string
  symbol: string
  putCall: 'P' | 'C' | null
  strike: number | null
  contracts: number | null
  /** Option expiry, or the blackout date. */
  date: string | null
  kind: LiveIdeaKind
  closeCost: number | null
  /** EL gap, or an exit price. */
  amount: number | null
  /** EL floor for the floor and repair rows. */
  floor: number | null
}

const IDEA_RANK: Record<LiveIdeaKind, number> = {
  floor: 0,
  expired: 1,
  resolve: 2,
  repair: 3,
  blackout: 4,
  exit: 5,
}

export interface IdeaCopy {
  before: string
  /** "2× " when the short is more than one contract. */
  qty: string
  /** "180P", or empty when the row is not one contract. */
  contract: string
  after: string
  text: string
}

export function ideaCopy(idea: LiveIdea, todayIso: string): IdeaCopy {
  const when = idea.date ? formatIdeaDate(idea.date, todayIso) : ''
  const cost = idea.closeCost != null ? ` (${usd0(idea.closeCost)})` : ''
  const qty = idea.contracts != null && idea.contracts !== 1 ? `${formatCount(idea.contracts)}× ` : ''
  const contract = idea.strike != null && idea.putCall ? `${formatCount(idea.strike)}${idea.putCall}` : ''
  let before = ''
  let after = ''
  switch (idea.kind) {
    case 'floor':
      before = `EL is ${usd0(idea.amount ?? 0)} below ${usd0(idea.floor ?? 0)}`
      break
    case 'blackout':
      before = `No new puts through ${when}`
      break
    case 'exit':
      before = `Exit at ${formatCount(idea.amount ?? 0)}`
      break
    case 'resolve':
      before = 'Resolve '
      after = idea.date === todayIso ? ` today${cost}` : ` before ${when}${cost}`
      break
    case 'expired':
      before = 'Close '
      after = ` — expired ${when}${cost}`
      break
    case 'repair':
      before = 'Close '
      after = `${when ? ` ${when}` : ''} until EL is above ${usd0(idea.floor ?? 0)}${cost}`
      break
  }
  const text = `${before}${qty}${contract}${after}`.replace(/ +/g, ' ').trim()
  return { before, qty: contract ? qty : '', contract, after, text }
}

function ruleSymbol(rule: IncomeRule): string {
  return rule.symbol.trim().toUpperCase()
}

function heldUnderlyings(book: LiveBook, extra: Iterable<string>): Set<string> {
  const held = new Set<string>()
  for (const share of book.shares) if (share.quantity !== 0) held.add(share.symbol.toUpperCase())
  for (const option of book.shortOptions) held.add(option.underlying.toUpperCase())
  for (const symbol of extra) {
    const key = symbol.trim().toUpperCase()
    if (key) held.add(key)
  }
  return held
}

/**
 * Ideas for one account's open book.
 * A row exists only while the live short, the dated rule, or the exit still applies.
 * Closed, rolled-away, and already-expired names that are gone from the book produce nothing.
 * `heldSymbols` adds underlyings the book snapshot does not carry, such as long options.
 */
export function liveIdeas(
  book: LiveBook,
  settings: IncomeSettings,
  today: Date,
  heldSymbols: Iterable<string> = [],
): LiveIdea[] {
  const todayIso = calendarIso(today)
  const horizon = ideaHorizon(todayIso, settings.screenExpiry)
  const blocked = symbolSet([...settings.excludeSymbols, ...settings.etfSymbols])
  const held = heldUnderlyings(book, heldSymbols)
  const belowFloor = elState(book.excessLiquidity, settings.elFloor) === 'below'
  const ideas: LiveIdea[] = []

  if (belowFloor && book.excessLiquidity != null && Number.isFinite(book.excessLiquidity)) {
    ideas.push({
      key: 'floor',
      symbol: '',
      putCall: null,
      strike: null,
      contracts: null,
      date: null,
      kind: 'floor',
      closeCost: null,
      amount: settings.elFloor - book.excessLiquidity,
      floor: settings.elFloor,
    })
  }

  book.shortOptions.forEach((option, index) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(option.expiry)) return
    let kind: LiveIdeaKind | null = null
    if (option.expiry < todayIso) kind = 'expired'
    else if (option.expiry <= horizon) kind = 'resolve'
    else if (belowFloor && blocked.has(option.underlying)) kind = 'repair'
    if (!kind) return
    ideas.push({
      key: `${kind}|${option.underlying}|${option.putCall}|${option.strike}|${option.expiry}|${index}`,
      symbol: option.underlying,
      putCall: option.putCall,
      strike: option.strike,
      contracts: Math.abs(option.quantity),
      date: option.expiry,
      kind,
      closeCost: option.closeCost,
      amount: null,
      floor: kind === 'repair' ? settings.elFloor : null,
    })
  })

  const seenBlackout = new Set<string>()
  for (const rule of settings.rules) {
    if (rule.type !== 'noNewPuts' || !rule.date || rule.date < todayIso) continue
    const symbol = ruleSymbol(rule)
    const key = `${symbol}|${rule.date}`
    if (!symbol || seenBlackout.has(key)) continue
    seenBlackout.add(key)
    ideas.push({
      key: `blackout|${key}`,
      symbol,
      putCall: null,
      strike: null,
      contracts: null,
      date: rule.date,
      kind: 'blackout',
      closeCost: null,
      amount: null,
      floor: null,
    })
  }

  const seenExit = new Set<string>()
  for (const rule of settings.rules) {
    if (rule.type !== 'exit' || rule.value == null) continue
    const symbol = ruleSymbol(rule)
    if (!symbol || seenExit.has(symbol) || !held.has(symbol)) continue
    seenExit.add(symbol)
    ideas.push({
      key: `exit|${symbol}`,
      symbol,
      putCall: null,
      strike: null,
      contracts: null,
      date: null,
      kind: 'exit',
      closeCost: null,
      amount: rule.value,
      floor: null,
    })
  }

  return ideas.sort((a, b) => {
    const rank = IDEA_RANK[a.kind] - IDEA_RANK[b.kind]
    if (rank) return rank
    const date = (a.date ?? '9999-99-99').localeCompare(b.date ?? '9999-99-99')
    if (date) return date
    const symbol = a.symbol.localeCompare(b.symbol)
    if (symbol) return symbol
    return (a.strike ?? 0) - (b.strike ?? 0)
  })
}
