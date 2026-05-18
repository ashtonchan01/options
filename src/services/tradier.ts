/**
 * Tradier Sandbox scanner — parallel fetching, no pacing needed.
 * Greeks come directly from Tradier (delta, gamma, theta, vega).
 * 120 req/min rate limit → all 13 tickers in ~2s.
 */

import type { ScanResult, ScanFlag } from '../types'

const PROXY = 'https://options-jade.vercel.app'

// ─── Tradier response types ──────────────────────────────────────────────────

interface TradierGreeks {
  delta: number
  gamma: number
  theta: number
  vega: number
  mid_iv: number // implied volatility as decimal
}

interface TradierOption {
  symbol: string
  option_type: 'call' | 'put'
  strike: number
  bid: number
  ask: number
  last: number
  volume: number
  open_interest: number
  expiration_date: string // "2025-06-20"
  greeks?: TradierGreeks
}

interface TradierQuote {
  symbol: string
  last: number
  change?: number
  change_percentage?: number
}

// ─── API helpers ─────────────────────────────────────────────────────────────

async function tradierFetch<T>(params: Record<string, string>): Promise<T | null> {
  const qs = new URLSearchParams(params)
  try {
    const res = await fetch(`${PROXY}/api/tradier?${qs}`)
    if (!res.ok) return null
    return await res.json() as T
  } catch {
    return null
  }
}

async function fetchExpirations(symbol: string): Promise<string[]> {
  const data = await tradierFetch<{ expirations?: { date?: string[] | string } }>({
    action: 'expirations', symbol,
  })
  const dates = data?.expirations?.date
  if (!dates) return []
  return Array.isArray(dates) ? dates : [dates]
}

async function fetchChain(symbol: string, expiration: string): Promise<TradierOption[]> {
  const data = await tradierFetch<{ options?: { option?: TradierOption[] | TradierOption } }>({
    action: 'chain', symbol, expiration,
  })
  const opts = data?.options?.option
  if (!opts) return []
  return Array.isArray(opts) ? opts : [opts]
}

async function fetchBatchQuotes(symbols: string[]): Promise<Record<string, number>> {
  const data = await tradierFetch<{ quotes?: { quote?: TradierQuote[] | TradierQuote } }>({
    action: 'quotes', symbols: symbols.join(','),
  })
  const quotes = data?.quotes?.quote
  if (!quotes) return {}
  const arr = Array.isArray(quotes) ? quotes : [quotes]
  const map: Record<string, number> = {}
  for (const q of arr) {
    if (q.symbol && q.last) map[q.symbol] = q.last
  }
  return map
}

// ─── Scanner config ──────────────────────────────────────────────────────────

const MIN_DTE = 7
const MAX_DTE = 60
const MIN_DELTA = 0.08
const MAX_DELTA = 0.55
const MIN_BID = 0.05

// ─── Scoring & flags ─────────────────────────────────────────────────────────

function computeScore(
  annualizedYield: number,
  delta: number,
  volume: number,
  iv: number,
  bid: number,
  ask: number,
): number {
  const yieldScore = Math.min(annualizedYield / 200, 1.0)
  const volScore = volume > 0 ? Math.min(Math.log10(volume) / 4, 1.0) : 0
  const deltaScore = Math.max(0, 1 - Math.abs(Math.abs(delta) - 0.25) * 4)
  const ivScore = Math.min(iv / 100, 1.0)
  const spread = ask - bid
  const mid = (ask + bid) / 2
  const spreadPct = mid > 0 ? spread / mid : 1
  const spreadScore = Math.max(0, 1 - spreadPct * 2)

  const raw =
    yieldScore * 30 +
    volScore * 20 +
    deltaScore * 20 +
    ivScore * 20 +
    spreadScore * 10

  return Math.round(Math.max(0, Math.min(100, raw)))
}

function computeIvRank(ivs: number[]): Map<number, number> {
  const sorted = [...ivs].sort((a, b) => a - b)
  const n = sorted.length
  const ranks = new Map<number, number>()
  if (n === 0) return ranks
  for (const iv of ivs) {
    const idx = sorted.findIndex(v => v >= iv)
    ranks.set(iv, Math.round((idx >= 0 ? idx / Math.max(n - 1, 1) : 1) * 100))
  }
  return ranks
}

function detectFlags(
  volume: number,
  openInterest: number,
  ivRank: number,
  dte: number,
  avgVolume: number,
): ScanFlag[] {
  const flags: ScanFlag[] = []
  if (volume > 500 && avgVolume > 0 && volume > avgVolume * 2) flags.push('HIGH_VOL')
  if (openInterest > 0 && volume / openInterest > 1.0) flags.push('HIGH_V_OI')
  if (ivRank >= 75) flags.push('IV_SPIKE')
  if (dte <= 14) flags.push('NEAR_TERM')
  return flags
}

// ─── Process chain into scan results ─────────────────────────────────────────

function processChain(
  options: TradierOption[],
  stockPrice: number,
  underlying: string,
  hasSufficientShares: boolean,
): ScanResult[] {
  const now = Date.now()
  const results: ScanResult[] = []

  // Split puts and calls
  const puts = options.filter(o => o.option_type === 'put')
  const calls = options.filter(o => o.option_type === 'call')

  const processGroup = (
    opts: TradierOption[],
    isPut: boolean,
    strategyType: ScanResult['strategyType'],
  ) => {
    const allIvs = opts.map(o => (o.greeks?.mid_iv ?? 0) * 100)
    const allVolumes = opts.map(o => o.volume ?? 0)
    const avgVolume = allVolumes.length > 0
      ? allVolumes.reduce((s, v) => s + v, 0) / allVolumes.length
      : 0
    const ivRankMap = computeIvRank(allIvs)

    for (const o of opts) {
      if (o.bid < MIN_BID) continue

      const expMs = new Date(o.expiration_date).getTime()
      const dte = Math.round((expMs - now) / 86400000)
      if (dte < MIN_DTE || dte > MAX_DTE) continue

      const greeks = o.greeks
      const delta = greeks?.delta ?? 0
      const absDelta = Math.abs(delta)
      if (absDelta < MIN_DELTA || absDelta > MAX_DELTA) continue

      const iv = (greeks?.mid_iv ?? 0) * 100
      const gamma = greeks?.gamma ?? 0
      const theta = greeks?.theta ?? 0
      const mid = (o.bid + o.ask) / 2
      const volume = o.volume ?? 0
      const openInterest = o.open_interest ?? 0
      const volumeOiRatio = openInterest > 0 ? volume / openInterest : 0

      const yieldBase = isPut ? o.strike : stockPrice
      const annualizedYield = (mid / yieldBase) * (365 / dte) * 100

      const ivRank = ivRankMap.get(iv) ?? 50
      const expiry = o.expiration_date.replace(/-/g, '')

      const flags = detectFlags(volume, openInterest, ivRank, dte, avgVolume)
      const score = computeScore(annualizedYield, delta, volume, iv, o.bid, o.ask)

      results.push({
        underlying,
        strategyType,
        stockPrice,
        strike: o.strike,
        expiry,
        dte,
        delta: parseFloat(delta.toFixed(3)),
        gamma: parseFloat(gamma.toFixed(5)),
        theta: parseFloat(theta.toFixed(3)),
        iv: parseFloat(iv.toFixed(1)),
        ivRank,
        bid: o.bid,
        ask: o.ask,
        mid: parseFloat(mid.toFixed(2)),
        volume,
        openInterest,
        volumeOiRatio: parseFloat(volumeOiRatio.toFixed(2)),
        annualizedYield: parseFloat(annualizedYield.toFixed(1)),
        score,
        flags,
      })
    }
  }

  // Always scan puts (CSP)
  if (puts.length > 0) processGroup(puts, true, 'csp')
  // Only scan calls if user holds ≥100 shares
  if (hasSufficientShares && calls.length > 0) processGroup(calls, false, 'covered_call')

  return results
}

// ─── Public scanner API ──────────────────────────────────────────────────────

/**
 * Scan a single ticker using Tradier. Fetches expirations, picks
 * those in the DTE window, fetches chains in parallel.
 */
export async function scanTickerTradier(
  symbol: string,
  stockPrice: number,
  sharesHeld = 0,
): Promise<ScanResult[]> {
  const hasSufficientShares = sharesHeld >= 100
  const now = Date.now()

  // 1. Get available expirations
  const expirations = await fetchExpirations(symbol)
  if (expirations.length === 0) return []

  // 2. Filter to DTE window, take up to 3
  const targetExps = expirations.filter(d => {
    const dte = (new Date(d).getTime() - now) / 86400000
    return dte >= MIN_DTE && dte <= MAX_DTE
  }).slice(0, 3)

  if (targetExps.length === 0) return []

  // 3. Fetch all chains in parallel
  const chains = await Promise.all(
    targetExps.map(exp => fetchChain(symbol, exp))
  )

  // 4. Process all results
  const allOptions = chains.flat()
  return processChain(allOptions, stockPrice, symbol, hasSufficientShares)
}

/**
 * Scan all tickers in parallel using Tradier.
 * ~2s total vs ~26s with Yahoo sequential pacing.
 */
export async function scanAllTickersTradier(
  tickers: string[],
  stocksHeld: Record<string, number>,
  onProgress?: (ticker: string, i: number, total: number) => void,
): Promise<ScanResult[]> {
  // 1. Batch-fetch all stock prices in one call
  onProgress?.('Fetching quotes...', 0, tickers.length)
  const prices = await fetchBatchQuotes(tickers)

  // 2. Scan all tickers in parallel (Tradier handles 120 req/min)
  const results = await Promise.all(
    tickers.map(async (sym, i) => {
      onProgress?.(sym, i, tickers.length)
      const price = prices[sym]
      if (!price) return []
      try {
        return await scanTickerTradier(sym, price, stocksHeld[sym] ?? 0)
      } catch (e) {
        console.warn(`[Tradier] ${sym} failed:`, e)
        return []
      }
    })
  )

  return results.flat()
}

/**
 * Fetch batch quotes via Tradier (for portfolio prices etc.)
 */
export { fetchBatchQuotes as fetchQuotesTradier }
