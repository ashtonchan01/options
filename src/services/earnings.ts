/**
 * Fetch next earnings dates for watchlist tickers.
 * Uses the existing /api/yahoo proxy with type=earnings to share
 * the crumb/cookie cache (avoids separate rate-limit issues).
 * Results cached in localStorage for 6 hours.
 */

const PROXY = 'https://options-jade.vercel.app'
const CACHE_KEY = 'options:earnings_cache'
const CACHE_TTL = 6 * 60 * 60 * 1000 // 6 hours

interface EarningsCache {
  data: Record<string, string[]>
  timestamp: number
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

/**
 * Fetch earnings date for a single ticker via the yahoo proxy.
 * Returns array of date strings (YYYY-MM-DD), usually 1-2 dates.
 */
async function fetchOne(symbol: string): Promise<string[]> {
  try {
    const res = await fetch(
      `${PROXY}/api/yahoo?symbol=${encodeURIComponent(symbol)}&type=earnings`,
      { signal: AbortSignal.timeout(10000) },
    )
    if (!res.ok) return []
    const json = await res.json() as {
      quoteSummary?: {
        result?: Array<{
          calendarEvents?: {
            earnings?: {
              earningsDate?: Array<{ fmt?: string }>
            }
          }
        }>
      }
    }
    return json.quoteSummary?.result?.[0]?.calendarEvents?.earnings?.earningsDate
      ?.map(d => d.fmt)
      .filter((d): d is string => !!d) ?? []
  } catch {
    return []
  }
}

/**
 * Fetch earnings dates for all tickers.
 * Sequential with small delays to avoid rate limits.
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

  const data: Record<string, string[]> = {}

  for (let i = 0; i < tickers.length; i++) {
    const sym = tickers[i]
    const dates = await fetchOne(sym)
    if (dates.length > 0) data[sym] = dates
    // Small delay between requests (not needed after last)
    if (i < tickers.length - 1) await sleep(400)
  }

  // Persist to localStorage
  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ data, timestamp: Date.now() } satisfies EarningsCache),
    )
  } catch { /* storage full */ }

  return data
}

/**
 * Invert ticker→dates map into date→tickers map for calendar lookup.
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
