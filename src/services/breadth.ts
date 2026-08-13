/**
 * Fetch watchlist market-breadth (% above 20/50/200-day SMA) via the
 * /api/breadth proxy.
 */

const PROXY = 'https://options-jade.vercel.app'

export interface Breadth {
  above20: number | null
  above50: number | null
  above200: number | null
  count: number
}

export async function fetchBreadth(symbols: string[]): Promise<Breadth | null> {
  if (symbols.length === 0) return null
  try {
    const res = await fetch(`${PROXY}/api/breadth?symbols=${encodeURIComponent(symbols.join(','))}`, { signal: AbortSignal.timeout(15000) })
    if (!res.ok) return null
    const data = await res.json()
    if (data.error) return null
    return data as Breadth
  } catch {
    return null
  }
}
