/**
 * Fetch per-ticker headlines through the /api/ticker-news proxy.
 */

const PROXY = 'https://options-jade.vercel.app'

export interface TickerHeadline {
  ticker: string
  title: string
  link: string
  source: string
  time: number
}

export async function fetchTickerHeadlines(tickers: string[]): Promise<TickerHeadline[]> {
  if (tickers.length === 0) return []
  try {
    const res = await fetch(`${PROXY}/api/ticker-news?tickers=${encodeURIComponent(tickers.join(','))}`, { signal: AbortSignal.timeout(15000) })
    if (!res.ok) return []
    return await res.json() as TickerHeadline[]
  } catch {
    return []
  }
}
