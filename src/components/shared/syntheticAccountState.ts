/**
 * Wraps a plain trades array in a minimal AppState so components that
 * expect a full AppState (CompaniesView, CalendarView, JournalPageView,
 * PortfolioAllocationView) can be reused for accounts that only have
 * uploaded trade history, not a live sync (positions/cash/etc. unknown).
 */
import type { AppState, RawTrade } from '../../types'

export function emptyAppState(): AppState {
  return {
    sync: { mode: 'xml', status: 'idle', positions: [], trades: [], cashBalance: 0 },
    strategies: [],
    quotes: {},
    actions: [],
    scanResults: [],
    livePrices: {},
  }
}

export function tradesToAppState(trades: RawTrade[]): AppState {
  const base = emptyAppState()
  return { ...base, sync: { ...base.sync, trades } }
}
