/**
 * Fetch RSI(14) values via /api/rsi — computed server-side from Yahoo Finance
 * daily closes so the client just gets a number (plus a short rolling
 * history for a sparkline) per symbol.
 */

const PROXY = 'https://options-jade.vercel.app'

export interface RsiData {
  rsi: number
  series: number[]
}

export async function fetchRSI(symbols: string[]): Promise<Record<string, RsiData>> {
  if (symbols.length === 0) return {}

  try {
    const res = await fetch(
      `${PROXY}/api/rsi?symbols=${encodeURIComponent(symbols.join(','))}`,
      { signal: AbortSignal.timeout(15000) },
    )
    if (!res.ok) return {}
    return await res.json() as Record<string, RsiData>
  } catch {
    return {}
  }
}
