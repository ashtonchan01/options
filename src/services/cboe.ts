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
export interface DteRange { min: number; max: number }
const MIN_DELTA = 0.05
// Raised from 0.55, then again from 0.80 — a synthetic-long combo (LEAP call
// + short put, same expiry) routinely wants a short put well past 0.55-0.80
// delta (the user's own TSLA example sells a put struck ABOVE the stock
// price, i.e. already ITM, to collect enough credit to meaningfully cut the
// LEAP's net cost). Now that the LEAP/combo pass is restricted to only each
// ticker's OWN furthest expiry, that put candidate also needs to clear
// whatever ceiling is set here — a deep-ITM put on a multi-year LEAP expiry
// can still land above 0.80 delta even though its long remaining time keeps
// it well short of 1.0, so the earlier 0.80 ceiling silently zeroed out the
// Synthetic Long section entirely for exactly the combos this feature exists
// for. Raising the ceiling only ADDS candidates to the raw scan — the CSP/CC
// tabs' own displayed results are still trimmed by each user's own deltaMax
// in the UI's ModeConfig (default ~0.25-0.30), so this doesn't change what
// shows up there by default.
const MAX_DELTA = 0.95
const MIN_BID = 0.05

// A LEAP buy candidate is a deep-ITM-to-ATM, long-dated call. LEAP_MIN_DELTA
// used to be 0.65 (deep-ITM only), but a synthetic-long combo commonly pairs
// an at-the-money call (delta ~0.45-0.55) with a further-out short put — the
// user's own TSLA example (330C when TSLA trades near there) is roughly ATM
// — so the floor is lowered to include that band too. LEAP_MIN_DTE (~6
// months) filters out short-dated deep-ITM calls that happen to fall in the
// same delta band but aren't really "LEAPs".
const LEAP_MIN_DELTA = 0.45
const LEAP_MAX_DELTA = 0.97
export const LEAP_MIN_DTE = 180
// Real LEAPs regularly run 2-3 years out (e.g. a Dec-2028 TSLA chain from
// today is ~850 DTE) — exported so the scanner's own fetch window (which
// otherwise scopes to the much narrower Short/Long Term toggle bounds) can
// be widened to actually include them instead of silently truncating the
// chain before the LEAP pass ever sees the furthest-dated expiries.
export const LEAP_MAX_DTE = 1100

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

// A LEAP call is a purchase (debit), not a credit sale, so the credit-selling
// score above (rewards high yield/IV) is the wrong shape here: a buyer wants
// LOW extrinsic cost, HIGH delta (closer to owning the stock outright), and
// still wants liquidity/tight spreads. extrinsicPctAnnual is a cost rate —
// lower is better, the reverse of annualizedYield's "higher is better".
function computeLeapScore(
  extrinsicPctAnnual: number,
  delta: number,
  volume: number,
  bid: number,
  ask: number,
): number {
  const costScore = Math.max(0, 1 - extrinsicPctAnnual / 15) // 0%/yr → 1.0, 15%+/yr → 0
  const deltaScore = Math.min(Math.max((Math.abs(delta) - 0.45) / 0.52, 0), 1) // 0.45→0, 0.97+→1
  const volScore = volume > 0 ? Math.min(Math.log10(volume) / 3, 1.0) : 0
  const spread = ask - bid
  const mid = (ask + bid) / 2
  const spreadPct = mid > 0 ? spread / mid : 1
  const spreadScore = Math.max(0, 1 - spreadPct * 2)

  const raw = costScore * 40 + deltaScore * 30 + volScore * 15 + spreadScore * 15
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

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// A big watchlist fires every ticker's request at once — CBOE's CDN (and/or
// our own outbound IP) intermittently 429s/503s under that kind of burst,
// which fetchCboeChain used to treat as a permanent "no data" and silently
// drop, so a scan of e.g. 20 tickers would only ever return real results for
// however many happened to land before the throttling kicked in. One retry
// after a short backoff recovers the transient failures instead of losing
// them outright.
async function fetchCboeChain(symbol: string, attempt = 0): Promise<CboeData | null> {
  try {
    const res = await fetch(`${PROXY}/api/cboe?symbol=${encodeURIComponent(symbol)}`)
    if (!res.ok) {
      if ((res.status === 429 || res.status >= 500) && attempt === 0) {
        await sleep(600 + Math.random() * 400)
        return fetchCboeChain(symbol, attempt + 1)
      }
      return null
    }
    const json = await res.json() as CboeResponse
    return json.data ?? null
  } catch {
    if (attempt === 0) {
      await sleep(600 + Math.random() * 400)
      return fetchCboeChain(symbol, attempt + 1)
    }
    return null
  }
}

function processChain(
  data: CboeData,
  underlying: string,
  dteRange: DteRange,
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
    return dte >= dteRange.min && dte <= dteRange.max
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
      const dte = Math.round((expiryToMs(p.expiry) - now) / 86400000)
      const delta = o.delta ?? 0
      const absDelta = Math.abs(delta)

      // A long-dated (LEAP-eligible) put is only ever going into the scan to
      // be a Synthetic Long combo's short leg, where the whole point is a
      // strike ABOVE the current stock price — deep ITM, often past 0.80-0.90
      // delta even with a year+ of remaining time. The standard MIN_BID/
      // MAX_DELTA gates below exist to keep near-term CSP recommendations
      // liquid and reasonably-OTM; applying them here would silently zero
      // out exactly the combo candidates this exists for (verified: the
      // Synthetic Long section came back empty even after raising MAX_DELTA
      // to 0.95, because plenty of real deep-ITM multi-year puts still sit
      // above that). Long-dated puts only need a real quote (bid > 0) to be
      // usable at all, no delta ceiling.
      if (isPut && dte >= LEAP_MIN_DTE) {
        if (o.bid <= 0) continue
      } else {
        if (o.bid < MIN_BID) continue
        if (absDelta < MIN_DELTA || absDelta > MAX_DELTA) continue
      }

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

  // Scan both puts (CSP) and calls (covered call) for every ticker, regardless
  // of whether shares are actually held — lets you scout CC entries you'd
  // need to buy shares for first.
  if (puts.length > 0) processGroup(puts, true, 'csp')
  if (calls.length > 0) processGroup(calls, false, 'covered_call')

  // LEAP buy candidates draw from the SAME `calls` list, just filtered to
  // the opposite (deep-ITM, long-dated) end — independent of the
  // covered-call pass above rather than a further filter on it, since a
  // delta ≥0.65 call would never have passed MAX_DELTA=0.55 to begin with.
  const leapCalls = calls.filter(({ raw: o, parsed: p }) => {
    const dte = Math.round((expiryToMs(p.expiry) - now) / 86400000)
    const absDelta = Math.abs(o.delta ?? 0)
    return dte >= LEAP_MIN_DTE && dte <= LEAP_MAX_DTE && absDelta >= LEAP_MIN_DELTA && absDelta <= LEAP_MAX_DELTA && o.ask > 0
  })
  for (const { raw: o, parsed: p } of leapCalls) {
    const dte = Math.round((expiryToMs(p.expiry) - now) / 86400000)
    const delta = o.delta ?? 0
    const iv = (o.iv ?? 0) * 100
    const mid = (o.bid + o.ask) / 2
    if (mid < MIN_BID) continue
    const volume = o.volume ?? 0
    const openInterest = o.open_interest ?? 0
    const intrinsic = Math.max(stockPrice - p.strike, 0)
    const extrinsic = Math.max(mid - intrinsic, 0)
    const extrinsicPctAnnual = (extrinsic / stockPrice) * (365 / dte) * 100
    const score = computeLeapScore(extrinsicPctAnnual, delta, volume, o.bid, o.ask)

    results.push({
      underlying,
      strategyType: 'leap',
      stockPrice,
      strike: p.strike,
      expiry: p.expiry,
      dte,
      delta: parseFloat(delta.toFixed(3)),
      gamma: parseFloat((o.gamma ?? 0).toFixed(5)),
      theta: parseFloat((o.theta ?? 0).toFixed(3)),
      iv: parseFloat(iv.toFixed(1)),
      ivRank: 50,
      bid: o.bid,
      ask: o.ask,
      mid: parseFloat(mid.toFixed(2)),
      volume,
      openInterest,
      volumeOiRatio: openInterest > 0 ? parseFloat((volume / openInterest).toFixed(2)) : 0,
      annualizedYield: parseFloat(extrinsicPctAnnual.toFixed(1)),
      score,
      flags: dte <= 14 ? ['NEAR_TERM'] : [],
      extrinsic: parseFloat(extrinsic.toFixed(2)),
      leverage: mid > 0 ? parseFloat((stockPrice / mid).toFixed(2)) : undefined,
    })
  }

  return results
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Scan all tickers in parallel via CBOE delayed quotes.
 * One request per ticker, all fired simultaneously.
 * ~1-2s total for 13 tickers.
 */
// Requests within a batch still fire together (fast), but batches are
// staggered slightly so a large watchlist doesn't dump 20-30 simultaneous
// requests on CBOE's CDN at once — see fetchCboeChain's retry comment for
// why that burst was silently losing results.
const BATCH_SIZE = 8
const BATCH_STAGGER_MS = 250

export async function scanAllTickersCboe(
  tickers: string[],
  onProgress?: (ticker: string, i: number, total: number) => void,
  dteRange: DteRange = { min: MIN_DTE, max: MAX_DTE },
): Promise<ScanResult[]> {
  onProgress?.('Fetching all chains...', 0, tickers.length)

  const all: ScanResult[][] = []
  for (let start = 0; start < tickers.length; start += BATCH_SIZE) {
    if (start > 0) await sleep(BATCH_STAGGER_MS)
    const batch = tickers.slice(start, start + BATCH_SIZE)
    const batchResults = await Promise.all(
      batch.map(async (sym, j) => {
        const i = start + j
        try {
          const data = await fetchCboeChain(sym)
          onProgress?.(sym, i + 1, tickers.length)
          if (!data) return []
          return processChain(data, sym, dteRange)
        } catch (e) {
          console.warn(`[CBOE] ${sym} failed:`, e)
          return []
        }
      })
    )
    all.push(...batchResults)
  }

  return all.flat()
}
