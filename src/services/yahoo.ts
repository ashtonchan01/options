import type { ScanResult } from '../types'

const PROXY = 'https://options-jade.vercel.app'

// ─── Yahoo types ──────────────────────────────────────────────────────────────

interface YahooOption {
  strike: number
  bid: number
  ask: number
  impliedVolatility: number
  expiration: number   // unix seconds
  inTheMoney: boolean
  volume?: number
  openInterest?: number
}

interface YahooResult {
  underlyingSymbol: string
  expirationDates: number[]   // unix seconds
  quote: { regularMarketPrice: number }
  options: Array<{
    expirationDate: number
    calls: YahooOption[]
    puts: YahooOption[]
  }>
}

// ─── Black-Scholes delta ──────────────────────────────────────────────────────

function ncdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x))
  const d = 0.3989422820 * Math.exp(-x * x / 2)
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.7814779 + t * (-1.8212560 + t * 1.3302744))))
  return x > 0 ? 1 - p : p
}

function bsDelta(S: number, K: number, dteYears: number, iv: number, isPut: boolean): number {
  if (dteYears <= 0 || iv <= 0 || S <= 0 || K <= 0) return 0
  const d1 = (Math.log(S / K) + (0.05 + iv * iv / 2) * dteYears) / (iv * Math.sqrt(dteYears))
  return isPut ? ncdf(d1) - 1 : ncdf(d1)
}

// ─── Fetch helpers ────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function fetchChain(symbol: string, date?: number): Promise<YahooResult | null> {
  const params = new URLSearchParams({ symbol })
  if (date) params.set('date', String(date))
  try {
    const res = await fetch(`${PROXY}/api/yahoo?${params}`)

    if (res.status === 429) {
      // Rate limited — wait and retry once
      const retryAfter = 5000
      await sleep(retryAfter)
      const retry = await fetch(`${PROXY}/api/yahoo?${params}`)
      if (!retry.ok) return null
      const json = await retry.json() as { optionChain?: { result?: YahooResult[] } }
      return json.optionChain?.result?.[0] ?? null
    }

    if (!res.ok) return null
    const json = await res.json() as { optionChain?: { result?: YahooResult[] } }
    return json.optionChain?.result?.[0] ?? null
  } catch {
    return null
  }
}

// ─── Scanner ──────────────────────────────────────────────────────────────────

const MIN_DTE = 14
const MAX_DTE = 60
const MIN_DELTA = 0.12
const MAX_DELTA = 0.45
const MIN_BID = 0.05

function score(annualizedYield: number, delta: number): number {
  const yieldScore  = Math.min(annualizedYield, 2.0) / 2.0
  const deltaScore  = 1 - Math.abs(Math.abs(delta) - 0.25) * 4
  return Math.max(0, yieldScore * 0.6 + deltaScore * 0.4)
}

function processOptions(
  opts: YahooOption[],
  isPut: boolean,
  stockPrice: number,
  underlying: string,
  strategyType: ScanResult['strategyType'],
): ScanResult[] {
  const now = Date.now() / 1000
  const results: ScanResult[] = []

  for (const o of opts) {
    if (o.bid < MIN_BID) continue
    const dte = Math.round((o.expiration - now) / 86400)
    if (dte < MIN_DTE || dte > MAX_DTE) continue

    const iv = o.impliedVolatility ?? 0
    const mid = (o.bid + o.ask) / 2
    const dteYears = dte / 365
    const delta = bsDelta(stockPrice, o.strike, dteYears, iv, isPut)
    const absDelta = Math.abs(delta)

    if (absDelta < MIN_DELTA || absDelta > MAX_DELTA) continue

    const yieldBase = isPut ? o.strike : stockPrice
    const annualizedYield = (mid / yieldBase) * (365 / dte)

    const expiry = new Date(o.expiration * 1000).toISOString().slice(0, 10).replace(/-/g, '')

    results.push({
      underlying,
      strategyType,
      strike: o.strike,
      expiry,
      dte,
      delta: parseFloat(delta.toFixed(3)),
      iv: parseFloat((iv * 100).toFixed(1)),
      bid: o.bid,
      mid: parseFloat(mid.toFixed(2)),
      annualizedYield: parseFloat((annualizedYield * 100).toFixed(1)),
      score: parseFloat(score(annualizedYield, delta).toFixed(3)),
    })
  }

  return results
}

export async function scanTicker(
  symbol: string,
  sharesHeld = 0,
): Promise<ScanResult[]> {
  // First fetch: gets expirationDates + nearest options + stock price
  const chain = await fetchChain(symbol)
  if (!chain) return []

  const stockPrice = chain.quote.regularMarketPrice
  if (!stockPrice) return []

  const now = Date.now() / 1000
  const hasSufficientShares = sharesHeld >= 100

  // Pick only 1 expiration in the target DTE window to reduce API calls
  const targetDates = chain.expirationDates
    .filter(ts => {
      const dte = (ts - now) / 86400
      return dte >= MIN_DTE && dte <= MAX_DTE
    })
    .slice(0, 1) // Only 1 extra fetch max

  const allResults: ScanResult[] = []

  const processDate = (opts: YahooResult['options'][0]) => {
    if (opts.puts.length > 0) {
      allResults.push(...processOptions(opts.puts, true, stockPrice, symbol, 'csp'))
    }
    if (hasSufficientShares && opts.calls.length > 0) {
      allResults.push(...processOptions(opts.calls, false, stockPrice, symbol, 'covered_call'))
    }
  }

  // Process the first options that came with the initial fetch
  const firstOptions = chain.options[0]
  if (firstOptions) {
    const firstDte = (firstOptions.expirationDate - now) / 86400
    if (firstDte >= MIN_DTE && firstDte <= MAX_DTE) {
      processDate(firstOptions)
      const idx = targetDates.indexOf(firstOptions.expirationDate)
      if (idx > -1) targetDates.splice(idx, 1)
    }
  }

  // Fetch remaining target dates (at most 1) with delay
  for (const ts of targetDates) {
    await sleep(800) // rate limit protection
    const dated = await fetchChain(symbol, ts)
    if (dated?.options[0]) processDate(dated.options[0])
  }

  return allResults
}

/**
 * Scan multiple tickers with delays between each to avoid rate limiting.
 * Use this instead of calling scanTicker in a tight loop.
 */
export async function scanAllTickers(
  tickers: string[],
  stocksHeld: Record<string, number>,
  onProgress?: (ticker: string, i: number, total: number) => void,
): Promise<ScanResult[]> {
  const all: ScanResult[] = []

  for (let i = 0; i < tickers.length; i++) {
    const sym = tickers[i]
    onProgress?.(sym, i, tickers.length)
    try {
      const res = await scanTicker(sym, stocksHeld[sym] ?? 0)
      all.push(...res)
    } catch (e) {
      console.warn(`[Scan] ${sym} failed:`, e)
    }

    // Delay between tickers to avoid Yahoo rate limiting
    if (i < tickers.length - 1) {
      await sleep(1500)
    }
  }

  return all
}

/**
 * Fetch current market prices for a list of tickers.
 * Returns a map of symbol → price. Skips failures silently.
 */
export async function fetchQuotes(tickers: string[]): Promise<Record<string, number>> {
  const prices: Record<string, number> = {}
  for (let i = 0; i < tickers.length; i++) {
    const sym = tickers[i]
    try {
      const chain = await fetchChain(sym)
      if (chain?.quote?.regularMarketPrice) {
        prices[sym] = chain.quote.regularMarketPrice
      }
    } catch { /* skip */ }
    if (i < tickers.length - 1) await sleep(800)
  }
  return prices
}
