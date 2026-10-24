/**
 * Live income figures from an already-synced Flex book.
 * Returned objects never include an IBKR account id.
 */
import type { RawPosition, RawTrade } from '../types'
import { buildYears, monthsBetween, type MilestoneConfig } from '../components/dashboard/milestoneYears'
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

function symbolSet(symbols: string[]): Set<string> {
  return new Set(symbols.map(symbol => symbol.trim().toUpperCase()).filter(Boolean))
}

function emptyBook(book: LiveBook): boolean {
  return book.shortPutCount === 0 && book.shares.length === 0 && book.shortOptions.length === 0 && book.cash == null && book.netLiquidation == null
}

/** Rules that can be judged from this account's own book. */
export function accountRules(book: LiveBook, settings: IncomeSettings): LiveRule[] {
  const excluded = symbolSet(settings.excludeSymbols)
  const etfs = symbolSet(settings.etfSymbols)
  const rules: LiveRule[] = []
  const floorLabel = Math.round(settings.elFloor).toLocaleString('en-US')
  const state = elState(book.excessLiquidity, settings.elFloor)
  rules.push({
    id: 'el',
    rule: `Excess liquidity above ${floorLabel}`,
    status: state === 'unknown' ? 'unknown' : state === 'ok' ? 'yes' : 'no',
    detail: state === 'unknown' ? 'Not in the Flex snapshot' : Math.round(book.excessLiquidity ?? 0).toLocaleString('en-US'),
  })

  if (book.role === 'personal') {
    if (emptyBook(book)) {
      rules.push({ id: 'personal-cash', rule: 'Every short put fully cash-covered', status: 'unknown', detail: 'No open book in this snapshot' })
      rules.push({ id: 'personal-count', rule: 'At most three short puts', status: 'unknown', detail: 'No open book in this snapshot' })
    } else {
      const covered = book.cash != null && book.cash >= book.shortPutNotional
      rules.push({
        id: 'personal-cash',
        rule: 'Every short put fully cash-covered',
        status: book.cash == null ? 'unknown' : covered || book.shortPutCount === 0 ? 'yes' : 'no',
        detail: book.cash == null
          ? 'Cash is not in this snapshot'
          : `${Math.round(book.shortPutNotional).toLocaleString('en-US')} notional vs ${Math.round(book.cash).toLocaleString('en-US')} cash`,
      })
      rules.push({
        id: 'personal-count',
        rule: 'At most three short puts',
        status: book.shortPutCount <= 3 ? 'yes' : 'no',
        detail: `${book.shortPutCount} short put${book.shortPutCount === 1 ? '' : 's'} open`,
      })
    }
  }

  const mstrPuts = book.shortOptions.filter(option => option.underlying === 'MSTR' && option.putCall === 'P')
  rules.push({
    id: 'mstr-puts',
    rule: 'No new MSTR puts on this account',
    status: !settings.noNewMstrPuts ? 'unknown' : mstrPuts.length === 0 ? 'yes' : 'no',
    detail: !settings.noNewMstrPuts ? 'Rule turned off' : mstrPuts.length === 0 ? 'None open' : `${mstrPuts.reduce((sum, option) => sum + Math.abs(option.quantity), 0)} contracts`,
  })

  const etfShorts = book.shortOptions.filter(option => etfs.has(option.underlying))
  const etfShares = book.shares.filter(row => etfs.has(row.symbol) && row.quantity !== 0)
  rules.push({
    id: 'etf',
    rule: 'No ETF holdings or ETF short options',
    status: etfShorts.length === 0 && etfShares.length === 0 ? 'yes' : 'no',
    detail: etfShorts.length === 0 && etfShares.length === 0
      ? 'None in this account'
      : [...new Set([...etfShorts.map(option => option.underlying), ...etfShares.map(row => row.symbol)])].join(', '),
  })

  const excludedPuts = book.shortOptions.filter(option => option.putCall === 'P' && excluded.has(option.underlying))
  const amznPuts = book.shortOptions.filter(option => option.underlying === 'AMZN' && option.putCall === 'P')
  rules.push({
    id: 'excluded-puts',
    rule: 'No short puts in the exclude list',
    status: excludedPuts.length === 0 ? 'yes' : 'no',
    detail: excludedPuts.length === 0 ? 'None open' : [...new Set(excludedPuts.map(option => option.underlying))].join(', '),
  })
  rules.push({
    id: 'amzn',
    rule: 'No AMZN short puts',
    status: amznPuts.length === 0 ? 'yes' : 'no',
    detail: amznPuts.length === 0 ? 'None open' : `${amznPuts.length} open`,
  })

  if (settings.tslaCallsCoveredOnly) {
    const contracts = book.shortOptions.filter(option => option.underlying === 'TSLA' && option.putCall === 'C').reduce((sum, option) => sum + Math.abs(option.quantity), 0)
    const cover = contracts === 0 ? 'covered' : callCover(book, 'TSLA', contracts)
    rules.push({
      id: 'tsla-calls',
      rule: 'TSLA calls only covered by held shares',
      status: cover === 'unknown' ? 'unknown' : cover === 'covered' ? 'yes' : 'no',
      detail: contracts === 0 ? 'No TSLA calls' : cover === 'covered' ? `${contracts} contract${contracts === 1 ? '' : 's'} covered` : `${contracts} contracts are not covered`,
    })
  }

  for (const blackout of settings.earningsBlackouts) {
    const symbol = blackout.symbol.toUpperCase()
    const open = book.shortOptions.filter(option => option.underlying === symbol && option.putCall === 'P' && (!option.expiry || option.expiry >= blackout.date))
    rules.push({
      id: `earn-${symbol}`,
      rule: `No short ${symbol} puts through ${blackout.label}`,
      status: open.length === 0 ? 'yes' : 'no',
      detail: open.length === 0 ? 'None open' : open.map(option => `${option.quantity} ${option.strike}P ${option.expiry}`).join('; '),
    })
  }
  return rules
}

export interface BtcCap {
  mstrShares: number
  mstrPutContracts: number
  bsolShares: number
  bsolPutContracts: number
  /** No account in the list has a position or balance snapshot. */
  noBooks: boolean
  over: boolean
  /** Aggregate only. No account name and no strike. */
  detail: string
}

/** MSTR and BSOL across every account. The text does not say which account holds what. */
export function btcCap(books: LiveBook[]): BtcCap {
  let mstrShares = 0
  let mstrPutContracts = 0
  let bsolShares = 0
  let bsolPutContracts = 0
  let anySnapshot = false
  for (const book of books) {
    if (!emptyBook(book)) anySnapshot = true
    for (const row of book.shares) {
      if (row.symbol === 'MSTR') mstrShares += row.quantity
      if (row.symbol === 'BSOL') bsolShares += row.quantity
    }
    for (const option of book.shortOptions) {
      if (option.underlying === 'MSTR' && option.putCall === 'P') mstrPutContracts += Math.abs(option.quantity)
      if (option.underlying === 'BSOL' && option.putCall === 'P') bsolPutContracts += Math.abs(option.quantity)
    }
  }
  const over = mstrPutContracts > 0 || bsolPutContracts > 0 || bsolShares !== 0
  const detail = anySnapshot
    ? `Across both accounts: MSTR ${Math.round(mstrShares).toLocaleString('en-US')} sh, MSTR puts ${mstrPutContracts}, BSOL puts ${bsolPutContracts}${bsolShares !== 0 ? `, BSOL ${Math.round(bsolShares).toLocaleString('en-US')} sh` : ''}.`
    : 'No open books in this snapshot, so the combined cap is not known.'
  return { mstrShares, mstrPutContracts, bsolShares, bsolPutContracts, noBooks: !anySnapshot, over, detail }
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

function finiteNumber(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export interface DecIncomeRow {
  year: number
  decDate: Date
  /** Milestone End-of-Dec target, AUD. */
  decEndAud: number
  /** Milestone End (Target) for the financial-year row that holds this 31 Dec, AUD. */
  fyEndAud: number
  decEndUsd: number | null
  months: number
  /** max(0, gap) / months. Null when net liquidation or the FX rate is missing. */
  monthlyBaseUsd: number | null
  personalTarget: number | null
  businessTarget: number | null
}

export interface MilestoneIncome {
  rows: DecIncomeRow[]
  /** The next 31 Dec still ahead. */
  current: DecIncomeRow | null
  combinedNlv: number | null
  personalNlv: number | null
  businessNlv: number | null
  audUsd: number | null
  personalShare: number | null
  businessShare: number | null
  nlvNote: string | null
  fxNote: string | null
  splitNote: string | null
  taxNote: string | null
}

export function milestoneIncome(args: {
  config: MilestoneConfig
  today: Date
  personalNlv: number | undefined
  businessNlv: number | undefined
  otherNlv: number[]
  audUsd: number | null | undefined
  splitMode: 'capital' | 'fixed'
  personalSplitPct: number
  personalTaxRate: number
  businessTaxRate: number
  personalInterestAud: number
  businessInterestAud: number
}): MilestoneIncome {
  const personalNlv = finiteNumber(args.personalNlv)
  const businessNlv = finiteNumber(args.businessNlv)
  const audUsd = finiteNumber(args.audUsd)
  const fx = audUsd != null && audUsd > 0 ? audUsd : null
  let combinedNlv: number | null = null
  let nlvNote: string | null = null
  if (personalNlv == null || businessNlv == null) {
    nlvNote = 'Net liquidation is missing on Personal or Business, so the gap to the milestone can’t be computed.'
  } else {
    const others = args.otherNlv.filter(value => Number.isFinite(value))
    combinedNlv = personalNlv + businessNlv + others.reduce((sum, value) => sum + value, 0)
  }
  const fxNote = fx == null
    ? 'The live AUD/USD rate isn’t available, so the milestone target can’t be turned into US$ and interest can’t be added.'
    : null

  let personalShare: number | null = null
  let splitNote: string | null = null
  if (args.splitMode === 'fixed') {
    if (!(args.personalSplitPct >= 0 && args.personalSplitPct <= 100)) splitNote = 'Personal share must be between 0 and 100.'
    else personalShare = args.personalSplitPct / 100
  } else if (personalNlv == null || businessNlv == null || personalNlv + businessNlv <= 0) {
    splitNote = 'The capital split can’t be computed without both accounts’ net liquidation.'
  } else {
    personalShare = personalNlv / (personalNlv + businessNlv)
  }
  const businessShare = personalShare == null ? null : 1 - personalShare

  let taxNote: string | null = null
  if (!(args.personalTaxRate >= 0 && args.personalTaxRate < 1) || !(args.businessTaxRate >= 0 && args.businessTaxRate < 1)) {
    taxNote = 'Each tax rate has to be under 100% before the gross-up can be computed.'
  }

  const built = buildYears(args.config, args.today)
    .filter((row): row is typeof row & { decDate: Date; decEnd: number } => row.decDate != null && row.decEnd != null)
    .filter(row => row.decDate.getTime() > args.today.getTime())

  const rows: DecIncomeRow[] = built.map((row, index) => {
    const decEndUsd = fx == null ? null : row.decEnd * fx
    const prev = index === 0 ? null : built[index - 1]
    const prevUsd = prev == null || fx == null ? null : prev.decEnd * fx
    let months = index === 0 ? monthsBetween(args.today, row.decDate) : 12
    if (!(months > 0)) months = 1
    let monthlyBaseUsd: number | null = null
    if (decEndUsd != null && (index === 0 ? combinedNlv != null : prevUsd != null)) {
      const gap = index === 0 ? decEndUsd - (combinedNlv as number) : decEndUsd - (prevUsd as number)
      monthlyBaseUsd = Math.max(0, gap) / months
    }
    const leg = (share: number | null, tax: number, interestAud: number): number | null => {
      if (monthlyBaseUsd == null || share == null || fx == null || taxNote) return null
      return (monthlyBaseUsd * share) / (1 - tax) + interestAud * fx
    }
    return {
      year: row.decDate.getFullYear(),
      decDate: row.decDate,
      decEndAud: row.decEnd,
      fyEndAud: row.grossEnd,
      decEndUsd,
      months,
      monthlyBaseUsd,
      personalTarget: leg(personalShare, args.personalTaxRate, args.personalInterestAud),
      businessTarget: leg(businessShare, args.businessTaxRate, args.businessInterestAud),
    }
  })

  return {
    rows,
    current: rows[0] ?? null,
    combinedNlv,
    personalNlv,
    businessNlv,
    audUsd: fx,
    personalShare,
    businessShare,
    nlvNote,
    fxNote,
    splitNote,
    taxNote,
  }
}
