/**
 * Wraps an Account's data in a minimal AppState so components that expect a
 * full AppState (CompanyPnlView, MonthlyIncomeView, CalendarView,
 * JournalPageView, PortfolioAllocationView) can be reused for per-user
 * accounts. Accounts
 * synced via XML/Flex carry a real positions/cash snapshot; accounts
 * populated from a generic .csv/.xlsx/.pdf statement only have trades, so
 * those fields stay empty/zero for them.
 */
import type { AppState, RawPosition, RawTrade } from '../../types'
import { classifyPositions } from '../../engine/classifier'
import { generateActions } from '../../engine/actions'

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
  const positions = account.positions ?? []
  // Strategies/actions were only ever computed by the old app-wide sync
  // pipeline (useAppStore) — per-account state built here skipped that
  // step entirely, so every account's Actions & To-Do sidebar showed
  // "no actions" regardless of what its real positions actually needed.
  const strategies = classifyPositions(positions)
  const actions = generateActions(strategies, positions)
  return {
    ...base,
    sync: {
      ...base.sync,
      trades: account.trades,
      positions,
      cashBalance: account.cashBalance ?? 0,
      netLiquidation: account.netLiquidation,
    },
    strategies,
    actions,
  }
}
