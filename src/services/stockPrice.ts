/**
 * Fetch current stock prices for underlyings not found in IBKR positions.
 * Reuses the existing /api/yahoo proxy (edge function, no crumb issues).
 * Results cached in-memory for 5 minutes.
 */

const PROXY = 'https://options-jade.vercel.app'
const cache = new Map<string, { price: number; fetchedAt: number }>()
const TTL = 5 * 60 * 1000 // 5 minutes

/** Fetch a single stock's current price via the Yahoo options chain endpoint. */
export async function fetchStockPrice(symbol: string): Promise<number | null> {
  const hit = cache.get(symbol)
  if (hit && Date.now() - hit.fetchedAt < TTL) return hit.price

  try {
    const res = await fetch(
      `${PROXY}/api/yahoo?symbol=${encodeURIComponent(symbol)}`,
      { signal: AbortSignal.timeout(8000) },
    )
    if (!res.ok) return null
    const json = await res.json()
    const price: unknown = json?.optionChain?.result?.[0]?.quote?.regularMarketPrice
    if (typeof price === 'number' && price > 0) {
      cache.set(symbol, { price, fetchedAt: Date.now() })
      return price
    }
    return null
  } catch {
    return null
  }
}

/** Fetch prices for all symbols in parallel. Returns only successfully fetched ones. */
export async function fetchStockPrices(symbols: string[]): Promise<Record<string, number>> {
  const entries = await Promise.all(
    symbols.map(async sym => ({ sym, price: await fetchStockPrice(sym) }))
  )
  const out: Record<string, number> = {}
  for (const { sym, price } of entries) {
    if (price !== null) out[sym] = price
  }
  return out
}
