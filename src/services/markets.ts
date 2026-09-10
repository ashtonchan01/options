/**
 * Fetch live index quotes (price/change/marketState) through the
 * /api/markets proxy for the Markets page.
 */

const PROXY = 'https://options-jade.vercel.app'

export interface MarketQuote {
  price: number
  change: number
  changePercent: number
  marketState: string | null
  exchangeName: string | null
  /** Intraday closes for today's session (15m bars), oldest first — for a sparkline. */
  sparkline: number[]
}

export async function fetchMarketQuotes(symbols: string[]): Promise<Record<string, MarketQuote>> {
  if (symbols.length === 0) return {}
  try {
    // A cold request (no server-side cache hit yet) covering 30+ symbols —
    // the dashboard's own combined exchanges + market-bar list — can still
    // take a while even with the API's own batched-parallel fetch; 15s cut
    // it close enough to occasionally abort before a genuinely slow (not
    // stuck) response landed.
    const res = await fetch(
      `${PROXY}/api/markets?symbols=${encodeURIComponent(symbols.join(','))}`,
      { signal: AbortSignal.timeout(25000) },
    )
    if (!res.ok) return {}
    return await res.json() as Record<string, MarketQuote>
  } catch {
    return {}
  }
}
