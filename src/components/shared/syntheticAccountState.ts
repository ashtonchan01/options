/**
 * Wraps an Account's data in a minimal AppState so components that expect a
 * full AppState (CompaniesView, CalendarView, JournalPageView,
 * PortfolioAllocationView) can be reused for per-user accounts. Accounts
 * synced via XML/Flex carry a real positions/cash snapshot; accounts
 * populated from a generic .csv/.xlsx/.pdf statement only have trades, so
 * those fields stay empty/zero for them.
 */
import type { AppState, RawPosition, RawTrade } from '../../types'

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

export function accountToAppState(account: {
  trades: RawTrade[]
  positions?: RawPosition[]
  cashBalance?: number
  netLiquidation?: number
}): AppState {
  const base = emptyAppState()
  return {
    ...base,
    sync: {
      ...base.sync,
      trades: account.trades,
      positions: account.positions ?? [],
      cashBalance: account.cashBalance ?? 0,
      netLiquidation: account.netLiquidation,
    },
  }
}
