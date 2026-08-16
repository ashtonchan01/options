/**
 * Fetch price + 52-week high via /api/quote — used by the Portfolio
 * Allocation page for target-vs-actual comparisons and the "value buy"
 * TSLA/SPCX swing signal (distance from 52-week high).
 */
import { toYahooSymbols, remapToOriginal } from './cryptoSymbols'

const PROXY = 'https://options-jade.vercel.app'

export interface Quote {
  price: number
  high52: number | null
  low52: number | null
  prevClose: number | null
  volume: number | null
  avgVolume: number | null
}

export async function fetchQuotes(symbols: string[]): Promise<Record<string, Quote>> {
  if (symbols.length === 0) return {}
  const { yahooSymbols, toOriginal } = toYahooSymbols(symbols)
  try {
    const res = await fetch(
      `${PROXY}/api/quote?symbols=${encodeURIComponent(yahooSymbols.join(','))}`,
      { signal: AbortSignal.timeout(15000) },
    )
    if (!res.ok) return {}
    const data = await res.json() as Record<string, Quote>
    return remapToOriginal(data, toOriginal)
  } catch {
    return {}
  }
}
