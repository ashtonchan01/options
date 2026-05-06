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

async function fetchChain(symbol: string, date?: number): Promise<YahooResult | null> {
  const params = new URLSearchParams({ symbol })
  if (date) params.set('date', String(date))
  try {
    const res = await fetch(`${PROXY}/api/yahoo?${params}`)
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
  const yieldScore  = Math.min(annualizedYield, 2.0) / 2.0     // cap at 200% APY
  const deltaScore  = 1 - Math.abs(Math.abs(delta) - 0.25) * 4  // peak at delta 0.25
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

    // Yield basis: strike for CSP (cash-secured), stock price for CC (vs cost of shares)
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

  // Pick up to 2 expirations in the target DTE window
  const targetDates = chain.expirationDates
    .filter(ts => {
      const dte = (ts - now) / 86400
      return dte >= MIN_DTE && dte <= MAX_DTE
    })
    .slice(0, 2)

  // If the first call already covers the first date, use it directly
  const firstOptions = chain.options[0]
  const allResults: ScanResult[] = []

  const processDate = (opts: YahooResult['options'][0]) => {
    if (opts.puts.length > 0) {
      allResults.push(...processOptions(opts.puts, true, stockPrice, symbol, 'csp'))
    }
    if (hasSufficientShares && opts.calls.length > 0) {
      allResults.push(...processOptions(opts.calls, false, stockPrice, symbol, 'covered_call'))
    }
  }

  if (firstOptions) {
    const firstDte = (firstOptions.expirationDate - now) / 86400
    if (firstDte >= MIN_DTE && firstDte <= MAX_DTE) {
      processDate(firstOptions)
      // Remove this date from targetDates to avoid double-fetch
      const idx = targetDates.indexOf(firstOptions.expirationDate)
      if (idx > -1) targetDates.splice(idx, 1)
    }
  }

  // Fetch remaining target dates
  for (const ts of targetDates) {
    const dated = await fetchChain(symbol, ts)
    if (dated?.options[0]) processDate(dated.options[0])
  }

  return allResults
}
