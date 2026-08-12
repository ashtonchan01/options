/**
 * Fetch price + 52-week high via /api/quote — used by the Portfolio
 * Allocation page for target-vs-actual comparisons and the "value buy"
 * TSLA/SPCX swing signal (distance from 52-week high).
 */

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
  try {
    const res = await fetch(
      `${PROXY}/api/quote?symbols=${encodeURIComponent(symbols.join(','))}`,
      { signal: AbortSignal.timeout(15000) },
    )
    if (!res.ok) return {}
    return await res.json() as Record<string, Quote>
  } catch {
    return {}
  }
}
