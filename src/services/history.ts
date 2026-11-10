/**
 * Daily closes for the Pairs page, via /api/history (Yahoo v8 chart).
 */
import { remapToOriginal, toYahooSymbols } from './symbolAliases'

export interface DailySeries {
  t: number[]
  c: number[]
}

const RANGES = ['3mo', '6mo', '1y', '2y'] as const
export type HistoryRange = typeof RANGES[number]

export async function fetchDailyHistory(
  symbols: string[],
  range: HistoryRange,
): Promise<Record<string, DailySeries>> {
  if (symbols.length === 0) return {}
  const { yahooSymbols, toOriginal } = toYahooSymbols(symbols)
  const params = new URLSearchParams({
    symbols: yahooSymbols.join(','),
    range,
  })
  try {
    const res = await fetch(`/api/history?${params}`, { signal: AbortSignal.timeout(20000) })
    if (!res.ok) return {}
    const data = await res.json() as Record<string, DailySeries>
    return remapToOriginal(data, toOriginal)
  } catch {
    return {}
  }
}
