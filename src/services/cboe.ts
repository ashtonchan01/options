/**
 * CBOE Delayed Quotes scanner — no API key, no signup, no pacing.
 * Full chains with Greeks served from CBOE's CDN.
 * All tickers fetched in parallel via Promise.all.
 */

import type { ScanResult, ScanFlag } from '../types'

const PROXY = 'https://options-jade.vercel.app'

// ─── CBOE response types ─────────────────────────────────────────────────────

interface CboeOption {
  option: string          // OCC symbol: "TSLA260518C00250000"
  bid: number
  ask: number
  iv: number              // decimal (0.45 = 45%)
  volume: number
  open_interest: number
  delta: number
  gamma: number
  theta: number
  vega: number
  rho: number
  theo: number
  last_trade_price: number
}

interface CboeData {
  current_price: number
  iv30?: number
  iv30_change?: number
  options: CboeOption[]
}

interface CboeResponse {
  data: CboeData
}

// ─── OCC symbol parser ───────────────────────────────────────────────────────

function parseOcc(occ: string): { expiry: string; isPut: boolean; strike: number } | null {
  // Format: TSLA260518C00250000
  // Find the date+type+strike portion (last 15 chars for standard, but underlying length varies)
  const m = occ.match(/(\d{6})([CP])(\d{8})$/)
  if (!m) return null
  const expiry = m[1]                          // YYMMDD
  const isPut = m[2] === 'P'
  const strike = parseInt(m[3], 10) / 1000     // strike in dollars
  // Convert YYMMDD → YYYYMMDD
  const fullExpiry = `20${expiry}`
  return { expiry: fullExpiry, isPut, strike }
}

function expiryToMs(expiry: string): number {
  // YYYYMMDD → timestamp
  const y = expiry.slice(0, 4)
  const m = expiry.slice(4, 6)
  const d = expiry.slice(6, 8)
  return new Date(`${y}-${m}-${d}T16:00:00Z`).getTime()
}

// ─── Scanner config ──────────────────────────────────────────────────────────

const MIN_DTE = 7
const MAX_DTE = 60
const MIN_DELTA = 0.08
const MAX_DELTA = 0.55
const MIN_BID = 0.05

// ─── Scoring & flags (same logic as other services) ──────────────────────────

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

// ─── Fetch + process ─────────────────────────────────────────────────────────

async function fetchCboeChain(symbol: string): Promise<CboeData | null> {
  try {
    const res = await fetch(`${PROXY}/api/cboe?symbol=${encodeURIComponent(symbol)}`)
    if (!res.ok) return null
    const json = await res.json() as CboeResponse
    return json.data ?? null
  } catch {
    return null
  }
}

function processChain(
  data: CboeData,
  underlying: string,
  hasSufficientShares: boolean,
): ScanResult[] {
  const now = Date.now()
  const stockPrice = data.current_price
  if (!stockPrice || !data.options?.length) return []

  // Parse all options
  const parsed = data.options
    .map(o => ({ raw: o, parsed: parseOcc(o.option) }))
    .filter((x): x is { raw: CboeOption; parsed: NonNullable<ReturnType<typeof parseOcc>> } =>
      x.parsed !== null
    )

  // Filter by DTE
  const inWindow = parsed.filter(({ parsed: p }) => {
    const dte = Math.round((expiryToMs(p.expiry) - now) / 86400000)
    return dte >= MIN_DTE && dte <= MAX_DTE
  })

  // Split puts and calls
  const puts = inWindow.filter(x => x.parsed.isPut)
  const calls = inWindow.filter(x => !x.parsed.isPut)

  const results: ScanResult[] = []

  const processGroup = (
    group: typeof inWindow,
    isPut: boolean,
    strategyType: ScanResult['strategyType'],
  ) => {
    const allIvs = group.map(x => (x.raw.iv ?? 0) * 100)
    const allVolumes = group.map(x => x.raw.volume ?? 0)
    const avgVolume = allVolumes.length > 0
      ? allVolumes.reduce((s, v) => s + v, 0) / allVolumes.length
      : 0
    const ivRankMap = computeIvRank(allIvs)

    for (const { raw: o, parsed: p } of group) {
      if (o.bid < MIN_BID) continue

      const dte = Math.round((expiryToMs(p.expiry) - now) / 86400000)
      const delta = o.delta ?? 0
      const absDelta = Math.abs(delta)
      if (absDelta < MIN_DELTA || absDelta > MAX_DELTA) continue

      const iv = (o.iv ?? 0) * 100
      const gamma = o.gamma ?? 0
      const theta = o.theta ?? 0
      const mid = (o.bid + o.ask) / 2
      const volume = o.volume ?? 0
      const openInterest = o.open_interest ?? 0
      const volumeOiRatio = openInterest > 0 ? volume / openInterest : 0

      const yieldBase = isPut ? p.strike : stockPrice
      const annualizedYield = (mid / yieldBase) * (365 / dte) * 100

      const ivRank = ivRankMap.get(iv) ?? 50
      const flags = detectFlags(volume, openInterest, ivRank, dte, avgVolume)
      const score = computeScore(annualizedYield, delta, volume, iv, o.bid, o.ask)

      results.push({
        underlying,
        strategyType,
        stockPrice,
        strike: p.strike,
        expiry: p.expiry,
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

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Scan all tickers in parallel via CBOE delayed quotes.
 * One request per ticker, all fired simultaneously.
 * ~1-2s total for 13 tickers.
 */
export async function scanAllTickersCboe(
  tickers: string[],
  stocksHeld: Record<string, number>,
  onProgress?: (ticker: string, i: number, total: number) => void,
): Promise<ScanResult[]> {
  onProgress?.('Fetching all chains...', 0, tickers.length)

  const results = await Promise.all(
    tickers.map(async (sym, i) => {
      try {
        const data = await fetchCboeChain(sym)
        onProgress?.(sym, i + 1, tickers.length)
        if (!data) return []
        const hasSufficientShares = (stocksHeld[sym] ?? 0) >= 100
        return processChain(data, sym, hasSufficientShares)
      } catch (e) {
        console.warn(`[CBOE] ${sym} failed:`, e)
        return []
      }
    })
  )

  return results.flat()
}
