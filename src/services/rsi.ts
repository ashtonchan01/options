/**
 * Fetch RSI(14) values via /api/rsi — computed server-side from Yahoo Finance
 * daily closes so the client just gets a number (plus a short rolling
 * history for a sparkline) per symbol.
 */
import { toYahooSymbols, remapToOriginal } from './symbolAliases'
import { chunk } from './batch'

const PROXY = 'https://options-jade.vercel.app'

export interface RsiData {
  rsi: number
  series: number[]
}

// /api/rsi caps each request at 25 symbols and silently drops the rest —
// same batching fix as fetchQuotes, so a watchlist past 25 tickers still
// gets RSI for every ticker instead of the tail going blank.
const BATCH_SIZE = 25

export async function fetchRSI(symbols: string[]): Promise<Record<string, RsiData>> {
  if (symbols.length === 0) return {}
  const { yahooSymbols, toOriginal } = toYahooSymbols(symbols)

  const batches = await Promise.all(chunk(yahooSymbols, BATCH_SIZE).map(async batch => {
    try {
      const res = await fetch(
        `${PROXY}/api/rsi?symbols=${encodeURIComponent(batch.join(','))}`,
        { signal: AbortSignal.timeout(15000) },
      )
      if (!res.ok) return {}
      return await res.json() as Record<string, RsiData>
    } catch {
      return {}
    }
  }))
  const merged = Object.assign({}, ...batches) as Record<string, RsiData>
  return remapToOriginal(merged, toOriginal)
}
