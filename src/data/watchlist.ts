/** Shared watchlist used by Scanner and Calendar. */
export const WATCHLIST = [
  'TSLA', 'MSTR', 'AMD', 'ALAB', 'ARM', 'ASML', 'AVGO',
  'GOOGL', 'MRVL', 'MU', 'NVDA', 'PLTR', 'TSM',
] as const

export type WatchlistTicker = typeof WATCHLIST[number]
