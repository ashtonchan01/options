/**
 * Fetch RSI(14) values via /api/rsi — computed server-side from Yahoo Finance
 * daily closes so the client just gets a number (plus a short rolling
 * history for a sparkline) per symbol.
 */
import { toYahooSymbols, remapToOriginal } from './cryptoSymbols'

const PROXY = 'https://options-jade.vercel.app'

export interface RsiData {
  rsi: number
  series: number[]
}

export async function fetchRSI(symbols: string[]): Promise<Record<string, RsiData>> {
  if (symbols.length === 0) return {}
  const { yahooSymbols, toOriginal } = toYahooSymbols(symbols)

  try {
    const res = await fetch(
      `${PROXY}/api/rsi?symbols=${encodeURIComponent(yahooSymbols.join(','))}`,
      { signal: AbortSignal.timeout(15000) },
    )
    if (!res.ok) return {}
    const data = await res.json() as Record<string, RsiData>
    return remapToOriginal(data, toOriginal)
  } catch {
    return {}
  }
}
