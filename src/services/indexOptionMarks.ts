/**
 * Live marks for index option legs. Flex markPrice is only as new as the
 * last sync, and a short-dated SPX spread moves far enough between syncs
 * that the journal's unrealised % is the old print (a 7575/7550 that was
 * about +82% of its credit was still showing the synced −22%).
 */
import { isIndexOptionRoot } from './symbolAliases'

const PROXY = 'https://options-jade.vercel.app'

export interface OptionQuote {
  bid: number | null
  ask: number | null
  mid: number
}

export function contractKey(underlying: string, expiry: string, strike: number, putCall: string): string {
  const exp = expiry.replace(/\D/g, '')
  const ymd = exp.length === 6 ? `20${exp}` : exp
  return `${underlying.toUpperCase()}|${ymd}|${strike}|${putCall.toUpperCase()}`
}

export async function fetchIndexOptionMarks(keys: string[]): Promise<Record<string, OptionQuote>> {
  const unique = [...new Set(keys.filter(Boolean))]
  if (unique.length === 0) return {}
  try {
    const res = await fetch(
      `${PROXY}/api/option-marks?contracts=${encodeURIComponent(unique.join(','))}`,
      { signal: AbortSignal.timeout(20000) },
    )
    if (!res.ok) return {}
    const data = await res.json() as Record<string, OptionQuote>
    return data && typeof data === 'object' ? data : {}
  } catch {
    return {}
  }
}

/**
 * Signed mark-to-market value of an index option position.
 * Short legs are negative (a credit spread still open is a liability).
 * Returns null unless every strike has a live mid and a sign, so a
 * half-matched spread is left on the Flex mark instead of being priced
 * as a naked short.
 */
export function indexOptionMarketValue(args: {
  underlying: string
  expiry: string
  strikes: number[]
  putCall: string
  strategy?: string
  netPremium: number
  contracts: number
  multiplier: number
  /** Strike -> +1 long / -1 short, from the Flex position when it matched. */
  liveSigns: Record<string, number>
  quotes: Record<string, OptionQuote>
}): number | null {
  const { underlying, expiry, strikes, putCall, strategy, netPremium, contracts, multiplier, liveSigns, quotes } = args
  if (!isIndexOptionRoot(underlying)) return null
  if (!Number.isFinite(contracts) || contracts === 0) return null
  if (!Number.isFinite(multiplier) || multiplier <= 0) return null
  if (strikes.length === 0 || (putCall !== 'P' && putCall !== 'C')) return null

  const signs = legSigns(strikes, putCall, strategy, underlying, netPremium, liveSigns)
  if (!signs) return null

  let value = 0
  for (const strike of strikes) {
    const quote = quotes[contractKey(underlying, expiry, strike, putCall)]
    if (!quote || !Number.isFinite(quote.mid) || quote.mid < 0) return null
    const sign = signs[strike]
    if (sign !== 1 && sign !== -1) return null
    value += sign * Math.abs(contracts) * quote.mid * multiplier
  }
  return value
}

function legSigns(
  strikes: number[],
  putCall: string,
  strategy: string | undefined,
  underlying: string,
  netPremium: number,
  liveSigns: Record<string, number>,
): Record<number, number> | null {
  const fromLive: Record<number, number> = {}
  let complete = true
  for (const strike of strikes) {
    const sign = liveSigns[String(strike)]
    if (sign === 1 || sign === -1) fromLive[strike] = sign
    else complete = false
  }
  if (complete) return fromLive

  // Bull put: the app classifies SPX/SPXW verticals this way, short the
  // higher strike. Used when Flex didn't match every leg (SPX vs SPXW).
  if (strikes.length === 2 && putCall === 'P' && (strategy === 'put_spread' || isIndexOptionRoot(underlying))) {
    const hi = Math.max(...strikes)
    return Object.fromEntries(strikes.map(strike => [strike, strike === hi ? -1 : 1]))
  }
  if (strikes.length === 1) {
    const sign = liveSigns[String(strikes[0])]
    if (sign === 1 || sign === -1) return { [strikes[0]]: sign }
    if (netPremium !== 0) return { [strikes[0]]: netPremium > 0 ? -1 : 1 }
  }
  return null
}
