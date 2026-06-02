import { useState, useCallback, useEffect, useRef } from 'react'
import type { AppState, RawPosition, RawTrade } from '../types'
import { syncFromXML, syncFromFlexAPI } from '../services/ibkr'
import { classifyPositions } from '../engine/classifier'
import { generateActions } from '../engine/actions'
import { fetchStockPrices } from '../services/stockPrice'

const STORAGE_KEY = 'options_sync_data'
const PRICE_REFRESH_MS = 60 * 1000 // refresh live prices every 60 seconds

interface PersistedData {
  positions: RawPosition[]
  trades: RawTrade[]
  cashBalance: number
  netLiquidation?: number
  lastSync: number
}

function loadPersisted(): PersistedData | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as PersistedData
  } catch {
    return null
  }
}

function savePersisted(data: PersistedData) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch (e) {
    console.warn('[Store] Failed to persist sync data:', e)
  }
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

const persisted = loadPersisted()
const INITIAL: AppState = {
  sync: { mode: 'xml', status: 'idle', positions: [], trades: [], cashBalance: 0 },
  strategies: [],
  quotes: {},
  actions: [],
  scanResults: [],
  livePrices: {},
  ...(persisted ? buildState(persisted) : {}),
}

if (persisted) {
  console.log(`[Store] Restored ${persisted.positions.length} positions from cache`)
}

export function useAppStore() {
  const [state, setState] = useState<AppState>(INITIAL)

  // Keep a ref to current strategies+positions so the interval can read them
  const strategiesRef = useRef(state.strategies)
  const positionsRef  = useRef(state.sync.positions)
  useEffect(() => { strategiesRef.current = state.strategies }, [state.strategies])
  useEffect(() => { positionsRef.current = state.sync.positions }, [state.sync.positions])

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

    savePersisted({ positions, trades, cashBalance, netLiquidation, lastSync })

    setState(s => ({
      ...s,
      sync: { ...s.sync, status: 'success', lastSync, positions, trades, cashBalance, netLiquidation },
      strategies,
      actions,
    }))

    // Fetch live prices immediately after sync
    refreshPrices(strategies, positions)
  }, [refreshPrices])

  // Fetch live prices on startup if we loaded persisted data
  useEffect(() => {
    if (persisted && state.strategies.length > 0) {
      refreshPrices(state.strategies, state.sync.positions)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // run once on mount

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
