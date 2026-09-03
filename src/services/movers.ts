/**
 * Fetch trending tickers / top gainers / top losers / most active stocks
 * through the /api/movers proxy — the Dashboard's Market Movers panel.
 */

const PROXY = 'https://options-jade.vercel.app'

export interface MoverQuote {
  symbol: string
  name: string
  price: number
  change: number
  changePercent: number
  volume: number | null
}

export interface MoversData {
  gainers: MoverQuote[]
  losers: MoverQuote[]
  actives: MoverQuote[]
  trending: MoverQuote[]
}

const EMPTY: MoversData = { gainers: [], losers: [], actives: [], trending: [] }

export async function fetchMovers(): Promise<MoversData> {
  try {
    const res = await fetch(`${PROXY}/api/movers`, { signal: AbortSignal.timeout(15000) })
    if (!res.ok) return EMPTY
    const data = await res.json() as Partial<MoversData>
    return {
      gainers: data.gainers ?? [],
      losers: data.losers ?? [],
      actives: data.actives ?? [],
      trending: data.trending ?? [],
    }
  } catch {
    return EMPTY
  }
}
