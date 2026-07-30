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
}

export async function fetchMarketQuotes(symbols: string[]): Promise<Record<string, MarketQuote>> {
  if (symbols.length === 0) return {}
  try {
    const res = await fetch(
      `${PROXY}/api/markets?symbols=${encodeURIComponent(symbols.join(','))}`,
      { signal: AbortSignal.timeout(15000) },
    )
    if (!res.ok) return {}
    return await res.json() as Record<string, MarketQuote>
  } catch {
    return {}
  }
}
