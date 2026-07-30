/**
 * Fetch FOMC rate-decision dates from the live Fed calendar (via the
 * /api/fomc proxy, which scrapes federalreserve.gov — the authoritative
 * source) rather than shipping hardcoded dates in the client.
 * Cached in localStorage for a week so we re-check for schedule changes
 * (added/moved meetings) roughly weekly without hammering the proxy.
 */
import { FOMC_FALLBACK_DATES } from '../data/economicEvents'

const PROXY = 'https://options-jade.vercel.app'
const CACHE_KEY = 'options:fomc_cache'
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000 // 1 week

interface FomcCache {
  dates: string[]
  timestamp: number
}

function readCache(): FomcCache | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    return raw ? JSON.parse(raw) as FomcCache : null
  } catch {
    return null
  }
}

function writeCache(dates: string[]) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ dates, timestamp: Date.now() } satisfies FomcCache))
  } catch { /* storage full */ }
}

/**
 * Returns FOMC decision dates (YYYY-MM-DD). Prefers a fresh live fetch,
 * falls back to a week-old cache, then to a stale cache, then to the
 * bundled fallback list if the live source is unreachable.
 */
export async function fetchFomcDates(): Promise<string[]> {
  const cache = readCache()
  if (cache && Date.now() - cache.timestamp < CACHE_TTL) return cache.dates

  try {
    const res = await fetch(`${PROXY}/api/fomc`, { signal: AbortSignal.timeout(10000) })
    if (!res.ok) throw new Error(`fomc proxy ${res.status}`)
    const json = await res.json() as { dates?: string[] }
    if (json.dates && json.dates.length > 0) {
      writeCache(json.dates)
      return json.dates
    }
    throw new Error('empty fomc dates')
  } catch {
    // Live source unavailable — use stale cache if we have one, else the bundled fallback
    return cache?.dates ?? FOMC_FALLBACK_DATES
  }
}
