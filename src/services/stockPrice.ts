/**
 * Fetch current stock prices via /api/price — Yahoo v8/finance/chart,
 * no crumb/auth needed. The edge function caches at CDN level for 60s,
 * so we skip client-side caching entirely and always get a fresh price.
 */

const PROXY = 'https://options-jade.vercel.app'

/** Fetch prices for all symbols in one batch. Returns only successful ones. */
export async function fetchStockPrices(symbols: string[]): Promise<Record<string, number>> {
  if (symbols.length === 0) return {}

  try {
    const res = await fetch(
      `${PROXY}/api/price?symbols=${encodeURIComponent(symbols.join(','))}`,
      { signal: AbortSignal.timeout(10000) },
    )
    if (!res.ok) return {}
    const data: Record<string, number> = await res.json()
    return data
  } catch {
    return {}
  }
}
