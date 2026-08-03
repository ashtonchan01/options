/**
 * The effective ticker list shown in the Scanner: the base WATCHLIST plus
 * any tickers the user added, minus any they removed. Mirrors the same
 * localStorage keys OpportunitiesView (Scanner) uses.
 */
import { WATCHLIST } from '../data/watchlist'

const CUSTOM_TICKERS_KEY = 'options:custom_tickers'
const REMOVED_TICKERS_KEY = 'options:removed_tickers'

function loadList(key: string): string[] {
  try {
    return JSON.parse(localStorage.getItem(key) || '[]')
  } catch {
    return []
  }
}

export function getFollowedTickers(): string[] {
  const custom = loadList(CUSTOM_TICKERS_KEY)
  const removed = new Set(loadList(REMOVED_TICKERS_KEY))
  const all = new Set<string>([...WATCHLIST, ...custom])
  return [...all].filter(t => !removed.has(t))
}
