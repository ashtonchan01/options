import type { ScanResult, ScanFlag } from '../types'

const PROXY = 'https://options-jade.vercel.app'
const LOCAL_PROXY = 'http://localhost:3457'

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

// ─── Black-Scholes Greeks ────────────────────────────────────────────────────

const RISK_FREE = 0.05

/** Standard normal CDF */
function ncdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x))
  const d = 0.3989422820 * Math.exp(-x * x / 2)
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.7814779 + t * (-1.8212560 + t * 1.3302744))))
  return x > 0 ? 1 - p : p
}

/** Standard normal PDF */
function npdf(x: number): number {
  return Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI)
}

function bsD1(S: number, K: number, T: number, sigma: number): number {
  return (Math.log(S / K) + (RISK_FREE + sigma * sigma / 2) * T) / (sigma * Math.sqrt(T))
}

function bsDelta(S: number, K: number, T: number, sigma: number, isPut: boolean): number {
  if (T <= 0 || sigma <= 0 || S <= 0 || K <= 0) return 0
  const d1 = bsD1(S, K, T, sigma)
  return isPut ? ncdf(d1) - 1 : ncdf(d1)
}

function bsGamma(S: number, K: number, T: number, sigma: number): number {
  if (T <= 0 || sigma <= 0 || S <= 0 || K <= 0) return 0
  const d1 = bsD1(S, K, T, sigma)
  return npdf(d1) / (S * sigma * Math.sqrt(T))
}

function bsTheta(S: number, K: number, T: number, sigma: number, isPut: boolean): number {
  if (T <= 0 || sigma <= 0 || S <= 0 || K <= 0) return 0
  const d1 = bsD1(S, K, T, sigma)
  const d2 = d1 - sigma * Math.sqrt(T)

  const term1 = -(S * npdf(d1) * sigma) / (2 * Math.sqrt(T))

  if (isPut) {
    const term2 = RISK_FREE * K * Math.exp(-RISK_FREE * T) * ncdf(-d2)
    return (term1 + term2) / 365 // per-day
  } else {
    const term2 = RISK_FREE * K * Math.exp(-RISK_FREE * T) * ncdf(d2)
    return (term1 - term2) / 365
  }
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

// ─── IV Rank calculation ─────────────────────────────────────────────────────

/** Compute IV rank for each option relative to all IVs in this chain expiry */
function computeIvRank(ivs: number[]): Map<number, number> {
  const sorted = [...ivs].sort((a, b) => a - b)
  const n = sorted.length
  const ranks = new Map<number, number>()
  if (n === 0) return ranks

  for (const iv of ivs) {
    // Percentile rank: % of IVs that are <= this IV
    const idx = sorted.findIndex(v => v >= iv)
    const rank = idx >= 0 ? (idx / Math.max(n - 1, 1)) * 100 : 100
    ranks.set(iv, Math.round(rank))
  }
  return ranks
}

// ─── Scanner ──────────────────────────────────────────────────────────────────

const MIN_DTE = 7
const MAX_DTE = 60
const MIN_DELTA = 0.08
const MAX_DELTA = 0.55
const MIN_BID = 0.05

/** Composite score: 0–100 */
function computeScore(
  annualizedYield: number,
  delta: number,
  volume: number,
  _openInterest: number,
  iv: number,
  bid: number,
  ask: number,
): number {
  // Yield component (30%) — cap at 200% annualized
  const yieldScore = Math.min(annualizedYield / 200, 1.0)

  // Volume component (20%) — log scale, 100 = baseline, 10000 = max
  const volScore = volume > 0 ? Math.min(Math.log10(volume) / 4, 1.0) : 0

  // Delta sweet spot (20%) — peak at |0.25|, drops off both sides
  const deltaScore = 1 - Math.abs(Math.abs(delta) - 0.25) * 4
  const clampedDelta = Math.max(0, Math.min(1, deltaScore))

  // IV component (20%) — higher IV = more premium, cap at 100%
  const ivScore = Math.min(iv / 100, 1.0)

  // Spread tightness (10%) — tighter = better
  const spread = ask - bid
  const mid = (ask + bid) / 2
  const spreadPct = mid > 0 ? spread / mid : 1
  const spreadScore = Math.max(0, 1 - spreadPct * 2) // 0% spread = 1.0, 50%+ = 0

  const raw =
    yieldScore * 30 +
    volScore * 20 +
    clampedDelta * 20 +
    ivScore * 20 +
    spreadScore * 10

  return Math.round(Math.max(0, Math.min(100, raw)))
}

/** Detect unusual activity flags */
function detectFlags(
  volume: number,
  openInterest: number,
  _iv: number,
  ivRank: number,
  dte: number,
  allVolumes: number[],
): ScanFlag[] {
  const flags: ScanFlag[] = []

  // High volume: > 500 contracts AND > 2× average volume in this expiry
  const avgVol = allVolumes.length > 0
    ? allVolumes.reduce((s, v) => s + v, 0) / allVolumes.length
    : 0
  if (volume > 500 && avgVol > 0 && volume > avgVol * 2) {
    flags.push('HIGH_VOL')
  }

  // High volume/OI ratio: suggests new positioning
  if (openInterest > 0 && volume / openInterest > 1.0) {
    flags.push('HIGH_V_OI')
  }

  // IV spike: top quartile of chain
  if (ivRank >= 75) {
    flags.push('IV_SPIKE')
  }

  // Near-term: ≤14 DTE
  if (dte <= 14) {
    flags.push('NEAR_TERM')
  }

  return flags
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

  // Collect all IVs and volumes for ranking
  const allIvs = opts.map(o => (o.impliedVolatility ?? 0) * 100)
  const allVolumes = opts.map(o => o.volume ?? 0)
  const ivRankMap = computeIvRank(allIvs)

  for (const o of opts) {
    if (o.bid < MIN_BID) continue
    const dte = Math.round((o.expiration - now) / 86400)
    if (dte < MIN_DTE || dte > MAX_DTE) continue

    const iv = (o.impliedVolatility ?? 0) * 100  // as percentage
    const sigma = o.impliedVolatility ?? 0
    const mid = (o.bid + o.ask) / 2
    const T = dte / 365

    const delta = bsDelta(stockPrice, o.strike, T, sigma, isPut)
    const absDelta = Math.abs(delta)
    if (absDelta < MIN_DELTA || absDelta > MAX_DELTA) continue

    const gamma = bsGamma(stockPrice, o.strike, T, sigma)
    const theta = bsTheta(stockPrice, o.strike, T, sigma, isPut)

    const yieldBase = isPut ? o.strike : stockPrice
    const annualizedYield = (mid / yieldBase) * (365 / dte) * 100

    const volume = o.volume ?? 0
    const openInterest = o.openInterest ?? 0
    const volumeOiRatio = openInterest > 0 ? volume / openInterest : 0
    const ivRank = ivRankMap.get(iv) ?? 50

    const expiry = new Date(o.expiration * 1000).toISOString().slice(0, 10).replace(/-/g, '')

    const flags = detectFlags(volume, openInterest, iv, ivRank, dte, allVolumes)

    const scoreVal = computeScore(annualizedYield, delta, volume, openInterest, iv, o.bid, o.ask)

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
      score: scoreVal,
      flags,
    })
  }

  return results
}

export async function scanTicker(
  symbol: string,
  sharesHeld = 0,
): Promise<ScanResult[]> {
  const chain = await fetchChain(symbol)
  if (!chain) return []

  const stockPrice = chain.quote.regularMarketPrice
  if (!stockPrice) return []

  const now = Date.now() / 1000
  const hasSufficientShares = sharesHeld >= 100

  // Pick up to 2 expirations in target DTE window
  const targetDates = chain.expirationDates
    .filter(ts => {
      const dte = (ts - now) / 86400
      return dte >= MIN_DTE && dte <= MAX_DTE
    })
    .slice(0, 2)

  const allResults: ScanResult[] = []

  const processDate = (opts: YahooResult['options'][0]) => {
    if (opts.puts.length > 0) {
      allResults.push(...processOptions(opts.puts, true, stockPrice, symbol, 'csp'))
    }
    if (hasSufficientShares && opts.calls.length > 0) {
      allResults.push(...processOptions(opts.calls, false, stockPrice, symbol, 'covered_call'))
    }
  }

  // Process the first options from initial fetch
  const firstOptions = chain.options[0]
  if (firstOptions) {
    const firstDte = (firstOptions.expirationDate - now) / 86400
    if (firstDte >= MIN_DTE && firstDte <= MAX_DTE) {
      processDate(firstOptions)
      const idx = targetDates.indexOf(firstOptions.expirationDate)
      if (idx > -1) targetDates.splice(idx, 1)
    }
  }

  // Fetch remaining target dates with delay
  for (const ts of targetDates) {
    await sleep(800)
    const dated = await fetchChain(symbol, ts)
    if (dated?.options[0]) processDate(dated.options[0])
  }

  return allResults
}

/**
 * Scan multiple tickers with delays between each to avoid rate limiting.
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

    if (i < tickers.length - 1) {
      await sleep(1500)
    }
  }

  return all
}

/**
 * Fetch current market prices for a list of tickers.
 */
export async function fetchQuotes(tickers: string[]): Promise<Record<string, number>> {
  if (tickers.length === 0) return {}
  const syms = tickers.join(',')

  try {
    const res = await fetch(`${LOCAL_PROXY}/quotes?symbols=${syms}`, {
      signal: AbortSignal.timeout(15000),
    })
    if (res.ok) {
      const data = await res.json() as Record<string, number>
      if (Object.keys(data).length > 0) return data
    }
  } catch { /* local proxy not running, fall through */ }

  try {
    const res = await fetch(`${PROXY}/api/quotes?symbols=${syms}`)
    if (res.ok) {
      const data = await res.json() as Record<string, number>
      if (Object.keys(data).length > 0) return data
    }
  } catch { /* fall through */ }

  return {}
}
