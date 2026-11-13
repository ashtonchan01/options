/**
 * Covered-call and cash-secured-put credits on Overview.
 * Premium is the live option bid times 100 times contracts.
 * Strikes are chosen off the live underlying, and a strike with no bid is
 * dropped. Nothing here places a trade.
 */
import type { IncomeSettings, SeedPut } from './incomeSeed'
import { WATCHLIST } from '../data/watchlist'
import { EXCHANGES } from '../data/exchanges'
import { isExchangeOpen } from '../utils/marketHours'
import { fetchQuotes } from '../services/quotes'

/** A delayed quote older than this during the cash session is stale. */
export const BID_STALE_MS = 30 * 60 * 1000

const NYSE = EXCHANGES.find(ex => ex.symbol === '^GSPC')!

export function usMarketOpen(now: Date): boolean {
  return NYSE ? isExchangeOpen(NYSE, now) : false
}

export interface ChainLeg {
  strike: number
  putCall: 'P' | 'C'
  /** YYYY-MM-DD */
  expiry: string
  bid: number | null
  ask: number | null
  delta: number | null
  iv: number | null
}

export interface SymbolChain {
  /** When the option bid was quoted, unix ms. */
  quotedAt: number | null
  legs: ChainLeg[]
}

/** bid × 100 × contracts. Null when the bid is missing, zero, or not a number. */
export function bidPremium(bid: number | null | undefined, contracts: number): number | null {
  if (typeof bid !== 'number' || !Number.isFinite(bid) || bid <= 0) return null
  if (typeof contracts !== 'number' || !Number.isFinite(contracts) || contracts <= 0) return null
  return bid * 100 * contracts
}

export function quoteIsStale(quotedAt: number | null, now: number, marketOpen: boolean): boolean {
  if (!marketOpen) return true
  if (quotedAt == null || !Number.isFinite(quotedAt)) return true
  return now - quotedAt > BID_STALE_MS
}

/** "bid · Nov 9, 4:00 PM EST" — the credit is the bid, not a mid or a model. */
export function bidQuoteLabel(quotedAt: number | null): string {
  if (quotedAt == null || !Number.isFinite(quotedAt)) return 'bid · time unavailable'
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(quotedAt))
  return `bid · ${formatted}`
}

function expiryIso(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 8) return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
  if (digits.length === 6) return `20${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4, 6)}`
  return raw.slice(0, 10)
}

function realBid(bid: number | null | undefined): bid is number {
  return typeof bid === 'number' && Number.isFinite(bid) && bid > 0
}

/**
 * One strike for the screen expiry.
 * The live spot decides which side of the market is OTM. Delta is the chain's
 * own greek. Strikes with no bid, or no delta, are not priced from a model.
 */
export function pickLeg(
  legs: ChainLeg[],
  args: { putCall: 'P' | 'C'; expiry: string; spot: number; deltaMin: number; deltaMax: number },
): ChainLeg | null {
  const expiry = expiryIso(args.expiry)
  const spot = args.spot
  if (!(spot > 0) || !(args.deltaMax >= args.deltaMin)) return null
  const target = (args.deltaMin + args.deltaMax) / 2
  let best: ChainLeg | null = null
  let bestDistance = Infinity
  for (const leg of legs) {
    if (leg.putCall !== args.putCall) continue
    if (expiryIso(leg.expiry) !== expiry) continue
    if (!realBid(leg.bid)) continue
    if (args.putCall === 'C' ? leg.strike <= spot : leg.strike >= spot) continue
    if (leg.delta == null || !Number.isFinite(leg.delta)) continue
    const abs = Math.abs(leg.delta)
    if (abs < args.deltaMin || abs > args.deltaMax) continue
    const distance = Math.abs(abs - target)
    if (
      distance < bestDistance - 1e-9
      || (Math.abs(distance - bestDistance) <= 1e-9 && best != null && realBid(best.bid) && leg.bid > best.bid)
    ) {
      best = leg
      bestDistance = distance
    }
  }
  return best
}

export interface LiveCallRec {
  symbol: string
  strike: number
  contracts: number
  spot: number
  bid: number
  premium: number
  delta: number | null
  quotedAt: number | null
  stale: boolean
}

export function buildCallRecs(
  holdings: { symbol: string; shares: number }[],
  chains: Record<string, SymbolChain>,
  spots: Record<string, number>,
  settings: Pick<IncomeSettings, 'screenExpiry' | 'deltaMin' | 'deltaMax'>,
  now: Date,
  marketOpen: boolean,
): LiveCallRec[] {
  const out: LiveCallRec[] = []
  const seen = new Set<string>()
  for (const holding of holdings) {
    const symbol = holding.symbol.trim().toUpperCase()
    if (!symbol || seen.has(symbol)) continue
    seen.add(symbol)
    const contracts = Math.floor(holding.shares / 100)
    if (contracts < 1) continue
    const spot = spots[symbol]
    const chain = chains[symbol]
    if (!chain || !(spot > 0)) continue
    const leg = pickLeg(chain.legs, {
      putCall: 'C',
      expiry: settings.screenExpiry,
      spot,
      deltaMin: settings.deltaMin,
      deltaMax: settings.deltaMax,
    })
    if (!leg) continue
    const premium = bidPremium(leg.bid, contracts)
    if (premium == null) continue
    out.push({
      symbol,
      strike: leg.strike,
      contracts,
      spot,
      bid: leg.bid as number,
      premium,
      delta: leg.delta,
      quotedAt: chain.quotedAt,
      stale: quoteIsStale(chain.quotedAt, now.getTime(), marketOpen),
    })
  }
  return out.sort((a, b) => a.symbol.localeCompare(b.symbol))
}

/** Same bid credit as calls. One contract; cash secured is the strike. */
export function buildPutRows(
  symbols: string[],
  notes: Record<string, string>,
  chains: Record<string, SymbolChain>,
  spots: Record<string, number>,
  settings: Pick<IncomeSettings, 'screenExpiry' | 'deltaMin' | 'deltaMax'>,
): SeedPut[] {
  const rows: SeedPut[] = []
  const seen = new Set<string>()
  for (const raw of symbols) {
    const symbol = raw.trim().toUpperCase()
    if (!symbol || seen.has(symbol)) continue
    seen.add(symbol)
    const spot = spots[symbol]
    const chain = chains[symbol]
    if (!chain || !(spot > 0)) continue
    const leg = pickLeg(chain.legs, {
      putCall: 'P',
      expiry: settings.screenExpiry,
      spot,
      deltaMin: settings.deltaMin,
      deltaMax: settings.deltaMax,
    })
    if (!leg || !realBid(leg.bid)) continue
    const premium = bidPremium(leg.bid, 1)
    if (premium == null) continue
    rows.push({
      symbol,
      strike: leg.strike,
      spot,
      mid: leg.bid,
      bid: leg.bid,
      ask: typeof leg.ask === 'number' && Number.isFinite(leg.ask) ? leg.ask : leg.bid,
      delta: leg.delta,
      iv: leg.iv,
      premium,
      cash: leg.strike * 100,
      note: notes[symbol] ?? '',
    })
  }
  return rows
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * CBOE delayed-quote timestamp. A zone-less "YYYY-MM-DD HH:mm:ss" matches
 * UTC (the feed's clock lines up with UTC, not New York wall time).
 */
export function parseCboeTimestamp(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw > 1e12 ? raw : raw * 1000
  }
  if (typeof raw !== 'string' || !raw.trim()) return null
  const trimmed = raw.trim()
  if (/[zZ]$/.test(trimmed) || /[+-]\d{2}:?\d{2}$/.test(trimmed)) {
    const parsed = Date.parse(trimmed)
    return Number.isFinite(parsed) ? parsed : null
  }
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/)
  if (!match) {
    const parsed = Date.parse(trimmed)
    return Number.isFinite(parsed) ? parsed : null
  }
  const [, year, month, day, hour, minute, second] = match
  const instant = Date.parse(`${year}-${month}-${day}T${hour}:${minute}:${second ?? '00'}Z`)
  return Number.isFinite(instant) ? instant : null
}

export function parseCboeChain(json: unknown): SymbolChain {
  const root = json && typeof json === 'object' ? json as Record<string, unknown> : {}
  const data = root.data && typeof root.data === 'object' ? root.data as Record<string, unknown> : root
  const quotedAt = parseCboeTimestamp(root.timestamp ?? data.timestamp)
  const options = Array.isArray(data.options) ? data.options : []
  const legs: ChainLeg[] = []
  for (const row of options) {
    if (!row || typeof row !== 'object') continue
    const opt = row as Record<string, unknown>
    const symbol = typeof opt.option === 'string' ? opt.option : ''
    const match = symbol.match(/(\d{6})([CP])(\d{8})$/)
    if (!match) continue
    legs.push({
      strike: parseInt(match[3], 10) / 1000,
      putCall: match[2] === 'P' ? 'P' : 'C',
      expiry: expiryIso(match[1]),
      bid: num(opt.bid),
      ask: num(opt.ask),
      delta: num(opt.delta),
      iv: num(opt.iv),
    })
  }
  return { quotedAt, legs }
}

const PROXY = 'https://options-jade.vercel.app'
const CHAIN_BATCH = 8
const CHAIN_STAGGER_MS = 250

/**
 * Names to price for the put card. The active watchlist wins. An empty list
 * falls back to the app's default watchlist. Held shares are added so a name
 * you own is still eligible. No symbol is removed for a ticker rule.
 */
export function incomeScanSymbols(
  symbols: readonly string[] | undefined,
  holdings: { symbol: string; shares: number }[] = [],
): string[] {
  const cleaned = [...new Set((symbols ?? []).map(symbol => symbol.trim().toUpperCase()).filter(Boolean))]
  const base = cleaned.length > 0 ? cleaned : [...WATCHLIST]
  const set = new Set(base)
  for (const holding of holdings) {
    if (!(holding.shares > 0)) continue
    const symbol = holding.symbol.trim().toUpperCase()
    if (symbol) set.add(symbol)
  }
  return [...set]
}

export interface IncomeLiveScreen {
  calls: LiveCallRec[]
  puts: SeedPut[]
  /** Chain timestamp by symbol, for the put rows (calls carry their own). */
  putQuotedAt: Record<string, number | null>
  putStale: Record<string, boolean>
  loaded: boolean
}

export async function loadIncomeScreen(
  holdings: { symbol: string; shares: number }[],
  putSymbols: { symbol: string; note: string }[],
  settings: Pick<IncomeSettings, 'screenExpiry' | 'deltaMin' | 'deltaMax'>,
  now: Date,
): Promise<IncomeLiveScreen> {
  const putNames = putSymbols.map(row => row.symbol.trim().toUpperCase()).filter(Boolean)
  const heldNames = holdings
    .filter(row => Math.floor(row.shares / 100) >= 1)
    .map(row => row.symbol.trim().toUpperCase())
    .filter(Boolean)
  const symbols = [...new Set([...heldNames, ...putNames])]
  const notes: Record<string, string> = {}
  for (const row of putSymbols) notes[row.symbol.trim().toUpperCase()] = row.note

  const [quotes, chains] = await Promise.all([
    fetchQuotes(symbols),
    fetchChains(symbols),
  ])
  const spots: Record<string, number> = {}
  for (const symbol of symbols) {
    const price = quotes[symbol]?.price
    if (typeof price === 'number' && price > 0) spots[symbol] = price
  }
  const marketOpen = usMarketOpen(now)
  const calls = buildCallRecs(holdings, chains, spots, settings, now, marketOpen)
  const puts = buildPutRows(putNames, notes, chains, spots, settings)
  const putQuotedAt: Record<string, number | null> = {}
  const putStale: Record<string, boolean> = {}
  for (const row of puts) {
    const quotedAt = chains[row.symbol]?.quotedAt ?? null
    putQuotedAt[row.symbol] = quotedAt
    putStale[row.symbol] = quoteIsStale(quotedAt, now.getTime(), marketOpen)
  }
  return { calls, puts, putQuotedAt, putStale, loaded: true }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function fetchOneChain(symbol: string, attempt = 0): Promise<SymbolChain | null> {
  try {
    const res = await fetch(`${PROXY}/api/cboe?symbol=${encodeURIComponent(symbol)}`, { signal: AbortSignal.timeout(20000) })
    if (!res.ok) {
      if ((res.status === 429 || res.status >= 500) && attempt === 0) {
        await sleep(600)
        return fetchOneChain(symbol, attempt + 1)
      }
      return null
    }
    const chain = parseCboeChain(await res.json())
    return chain.legs.length > 0 ? chain : null
  } catch {
    if (attempt === 0) {
      await sleep(600)
      return fetchOneChain(symbol, attempt + 1)
    }
    return null
  }
}

/** Batched so a watchlist does not fire every chain request at once. */
async function fetchChains(symbols: string[]): Promise<Record<string, SymbolChain>> {
  const out: Record<string, SymbolChain> = {}
  for (let start = 0; start < symbols.length; start += CHAIN_BATCH) {
    if (start > 0) await sleep(CHAIN_STAGGER_MS)
    const batch = symbols.slice(start, start + CHAIN_BATCH)
    const entries = await Promise.all(batch.map(async symbol => [symbol, await fetchOneChain(symbol)] as const))
    for (const [symbol, chain] of entries) {
      if (chain) out[symbol] = chain
    }
  }
  return out
}
