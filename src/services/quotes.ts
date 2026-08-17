/**
 * Fetch price + 52-week high via /api/quote — used by the Portfolio
 * Allocation page for target-vs-actual comparisons and the "value buy"
 * TSLA/SPCX swing signal (distance from 52-week high).
 */
import { toYahooSymbols, remapToOriginal } from './symbolAliases'
import { chunk } from './batch'

const PROXY = 'https://options-jade.vercel.app'

export interface Quote {
  price: number
  high52: number | null
  low52: number | null
  prevClose: number | null
  volume: number | null
  avgVolume: number | null
}

// /api/quote caps each request at 25 symbols and silently drops the rest —
// a watchlist past 25 tickers had every ticker beyond the cutoff show blank
// price/change/volume forever (verified: a 30-ticker watchlist lost its last
// 5). Splitting into 25-symbol batches here means any number of tickers
// still gets a real quote.
const BATCH_SIZE = 25

export async function fetchQuotes(symbols: string[]): Promise<Record<string, Quote>> {
  if (symbols.length === 0) return {}
  const { yahooSymbols, toOriginal } = toYahooSymbols(symbols)
  const batches = await Promise.all(chunk(yahooSymbols, BATCH_SIZE).map(async batch => {
    try {
      const res = await fetch(
        `${PROXY}/api/quote?symbols=${encodeURIComponent(batch.join(','))}`,
        { signal: AbortSignal.timeout(15000) },
      )
      if (!res.ok) return {}
      return await res.json() as Record<string, Quote>
    } catch {
      return {}
    }
  }))
  const merged = Object.assign({}, ...batches) as Record<string, Quote>
  return remapToOriginal(merged, toOriginal)
}
