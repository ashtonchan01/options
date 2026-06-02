/**
 * Fetch current stock prices via /api/price — a dedicated edge function
 * that uses Yahoo v8/finance/chart (no crumb, no cookies, no auth).
 * Completely separate from the options chain proxy so no rate-limit conflicts.
 */

const PROXY = 'https://options-jade.vercel.app'
const cache = new Map<string, { price: number; fetchedAt: number }>()
const TTL = 5 * 60 * 1000 // 5 minutes

/** Fetch prices for all symbols in one batch. Returns only successful ones. */
export async function fetchStockPrices(symbols: string[]): Promise<Record<string, number>> {
  if (symbols.length === 0) return {}

  const now = Date.now()
  const result: Record<string, number> = {}
  const toFetch: string[] = []

  for (const sym of symbols) {
    const hit = cache.get(sym)
    if (hit && now - hit.fetchedAt < TTL) {
      result[sym] = hit.price
    } else {
      toFetch.push(sym)
    }
  }

  if (toFetch.length === 0) return result

  try {
    const res = await fetch(
      `${PROXY}/api/price?symbols=${encodeURIComponent(toFetch.join(','))}`,
      { signal: AbortSignal.timeout(10000) },
    )
    if (!res.ok) return result

    const data: Record<string, number> = await res.json()
    for (const [sym, price] of Object.entries(data)) {
      if (typeof price === 'number' && price > 0) {
        cache.set(sym, { price, fetchedAt: now })
        result[sym] = price
      }
    }
  } catch {
    // Network error — return whatever we have from cache
  }

  return result
}
