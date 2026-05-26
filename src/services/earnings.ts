/**
 * Fetch next earnings dates for watchlist tickers via Yahoo quoteSummary.
 * Results cached in localStorage for 6 hours to avoid redundant calls.
 */

const PROXY = 'https://options-jade.vercel.app'
const CACHE_KEY = 'options:earnings_cache'
const CACHE_TTL = 6 * 60 * 60 * 1000 // 6 hours

interface EarningsCache {
  /** ticker → array of date strings (YYYY-MM-DD) */
  data: Record<string, string[]>
  timestamp: number
}

/**
 * Returns a map of ticker → earnings date strings.
 * Each ticker may have 1-2 dates (Yahoo returns a range estimate).
 */
export async function fetchEarningsDates(
  tickers: string[],
): Promise<Record<string, string[]>> {
  // Check localStorage cache
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (raw) {
      const cache: EarningsCache = JSON.parse(raw)
      if (Date.now() - cache.timestamp < CACHE_TTL) return cache.data
    }
  } catch { /* ignore corrupt cache */ }

  // Fetch from Vercel proxy
  try {
    const res = await fetch(
      `${PROXY}/api/earnings?symbols=${tickers.join(',')}`,
      { signal: AbortSignal.timeout(15000) },
    )
    if (res.ok) {
      const data = (await res.json()) as Record<string, string[]>
      // Persist to localStorage
      try {
        localStorage.setItem(
          CACHE_KEY,
          JSON.stringify({ data, timestamp: Date.now() } satisfies EarningsCache),
        )
      } catch { /* storage full */ }
      return data
    }
  } catch { /* network error */ }

  return {}
}

/**
 * Invert ticker→dates map into date→tickers map for calendar lookup.
 * Example: { 'TSLA': ['2026-07-22'] } → { '2026-07-22': ['TSLA'] }
 */
export function earningsByDate(
  earningsMap: Record<string, string[]>,
): Record<string, string[]> {
  const byDate: Record<string, string[]> = {}
  for (const [ticker, dates] of Object.entries(earningsMap)) {
    for (const d of dates) {
      if (!byDate[d]) byDate[d] = []
      byDate[d].push(ticker)
    }
  }
  return byDate
}
