import { useState, useCallback, useEffect, useRef } from 'react'
import type { AppState, RawPosition, RawTrade } from '../types'
import { syncFromXML, syncFromFlexAPI } from '../services/ibkr'
import { classifyPositions } from '../engine/classifier'
import { generateActions } from '../engine/actions'
import { fetchStockPrices } from '../services/stockPrice'
import { tradeId } from './tradeLabelsStore'

const STORAGE_PREFIX = 'options_sync_data'
const PRICE_REFRESH_MS = 60 * 1000 // refresh live prices every 60 seconds

interface PersistedData {
  positions: RawPosition[]
  trades: RawTrade[]
  cashBalance: number
  netLiquidation?: number
  lastSync: number
}

/** Portfolio data is scoped per signed-in account so different logins never see each other's synced data. */
function storageKey(sessionKey: string): string {
  return `${STORAGE_PREFIX}:${sessionKey}`
}

function loadPersisted(sessionKey: string): PersistedData | null {
  try {
    const raw = localStorage.getItem(storageKey(sessionKey))
    if (!raw) return null
    return JSON.parse(raw) as PersistedData
  } catch {
    return null
  }
}

function savePersisted(sessionKey: string, data: PersistedData) {
  try {
    localStorage.setItem(storageKey(sessionKey), JSON.stringify(data))
  } catch (e) {
    console.warn('[Store] Failed to persist sync data:', e)
  }
}

/** IBKR's Flex report only covers a rolling 365-day window, so every sync/upload
 * would otherwise silently drop trade history older than a year. Union new trades
 * into whatever's already stored (deduped by the same composite tradeId used for
 * labels) instead of replacing wholesale — once a trade has been seen in any past
 * sync it stays in the journal permanently, even after IBKR stops reporting it. */
function mergeTrades(existing: RawTrade[], incoming: RawTrade[]): RawTrade[] {
  const map = new Map<string, RawTrade>()
  for (const t of existing) map.set(tradeId(t), t)
  for (const t of incoming) map.set(tradeId(t), t)
  return [...map.values()]
}

/** All underlyings with short option legs — always fetch live, IBKR mark price is stale */
function optionUnderlyings(strategies: ReturnType<typeof classifyPositions>): string[] {
  return [...new Set(
    strategies
      .filter(s => s.legs.some(l => l.quantity < 0))
      .map(s => s.underlying)
  )]
}

function buildState(data: PersistedData): Partial<AppState> {
  const strategies = classifyPositions(data.positions)
  const actions = generateActions(strategies, data.positions)
  return {
    sync: {
      mode: 'xml',
      status: 'success',
      lastSync: data.lastSync,
      positions: data.positions,
      trades: data.trades,
      cashBalance: data.cashBalance,
      netLiquidation: data.netLiquidation,
    },
    strategies,
    actions,
  }
}

const EMPTY_STATE: AppState = {
  sync: { mode: 'xml', status: 'idle', positions: [], trades: [], cashBalance: 0 },
  strategies: [],
  quotes: {},
  actions: [],
  scanResults: [],
  livePrices: {},
}

function initialStateFor(sessionKey: string | null): AppState {
  if (!sessionKey) return EMPTY_STATE
  const persisted = loadPersisted(sessionKey)
  if (!persisted) return EMPTY_STATE
  console.log(`[Store] Restored ${persisted.positions.length} positions from cache`)
  return { ...EMPTY_STATE, ...buildState(persisted) }
}

export function useAppStore(sessionKey: string | null) {
  const [state, setState] = useState<AppState>(() => initialStateFor(sessionKey))

  // Keep a ref to current strategies+positions so the interval can read them
  const strategiesRef = useRef(state.strategies)
  const positionsRef  = useRef(state.sync.positions)
  useEffect(() => { strategiesRef.current = state.strategies }, [state.strategies])
  useEffect(() => { positionsRef.current = state.sync.positions }, [state.sync.positions])

  // Reload (or clear) portfolio data whenever the signed-in account changes
  useEffect(() => {
    setState(initialStateFor(sessionKey))
  }, [sessionKey])

  /** Fetch live prices for any underlyings not in IBKR positions, then re-generate actions */
  const refreshPrices = useCallback((
    strategies: ReturnType<typeof classifyPositions>,
    positions: RawPosition[],
  ) => {
    const missing = optionUnderlyings(strategies)
    if (missing.length === 0) return

    fetchStockPrices(missing).then(extraPrices => {
      if (Object.keys(extraPrices).length === 0) return
      console.log(`[Store] Live prices: ${Object.entries(extraPrices).map(([s,p]) => `${s}=$${p}`).join(', ')}`)
      const enrichedActions = generateActions(strategies, positions, extraPrices)
      setState(s => ({ ...s, actions: enrichedActions, livePrices: { ...s.livePrices, ...extraPrices } }))
    })
  }, [])

  /** Periodic price refresh every 2 minutes while app is open */
  useEffect(() => {
    const id = setInterval(() => {
      const strats = strategiesRef.current
      const pos    = positionsRef.current
      if (strats.length > 0) refreshPrices(strats, pos)
    }, PRICE_REFRESH_MS)
    return () => clearInterval(id)
  }, [refreshPrices])

  const applyData = useCallback((
    positions: RawPosition[],
    trades: RawTrade[],
    cashBalance: number,
    netLiquidation?: number,
  ) => {
    const strategies = classifyPositions(positions)
    const actions    = generateActions(strategies, positions)
    const lastSync   = Date.now()
    console.log(`[Store] ${positions.length} positions → ${strategies.length} strategies, ${actions.length} actions`)

    setState(s => {
      // Positions are a live snapshot (current holdings), always taken fresh from
      // this sync — but trades are historical, so they're unioned with whatever's
      // already stored rather than replaced, since IBKR's Flex export only covers
      // the trailing 365 days and would otherwise erase everything older on sync.
      const mergedTrades = mergeTrades(s.sync.trades, trades)
      if (sessionKey) savePersisted(sessionKey, { positions, trades: mergedTrades, cashBalance, netLiquidation, lastSync })
      console.log(`[Store] ${trades.length} trades from this sync → ${mergedTrades.length} total retained`)
      return {
        ...s,
        sync: { ...s.sync, status: 'success', lastSync, positions, trades: mergedTrades, cashBalance, netLiquidation },
        strategies,
        actions,
      }
    })

    // Fetch live prices immediately after sync
    refreshPrices(strategies, positions)
  }, [refreshPrices, sessionKey])

  // Fetch live prices on startup if we loaded persisted data
  useEffect(() => {
    if (state.strategies.length > 0) {
      refreshPrices(state.strategies, state.sync.positions)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey]) // re-run when the signed-in account (and its restored cache) changes

  const uploadXML = useCallback(async (file: File) => {
    setState(s => ({ ...s, sync: { ...s.sync, status: 'loading', error: undefined } }))
    try {
      const { positions, trades, cashBalance, netLiquidation } = await syncFromXML(file)
      applyData(positions, trades, cashBalance, netLiquidation)
    } catch (e) {
      setState(s => ({ ...s, sync: { ...s.sync, status: 'error', error: String(e) } }))
    }
  }, [applyData])

  const syncFlex = useCallback(async (token: string, queryId: string) => {
    setState(s => ({ ...s, sync: { ...s.sync, status: 'loading', error: undefined } }))
    try {
      const { positions, trades, cashBalance, netLiquidation } = await syncFromFlexAPI(token, queryId)
      applyData(positions, trades, cashBalance, netLiquidation)
    } catch (e) {
      setState(s => ({ ...s, sync: { ...s.sync, status: 'error', error: String(e) } }))
    }
  }, [applyData])

  return { state, uploadXML, syncFlex }
}
