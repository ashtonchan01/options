import { useState, useCallback } from 'react'
import type { AppState, RawPosition, RawTrade } from '../types'
import { syncFromXML, syncFromFlexAPI } from '../services/ibkr'
import { classifyPositions } from '../engine/classifier'
import { generateActions } from '../engine/actions'

const STORAGE_KEY = 'options_sync_data'

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
  ...(persisted ? buildState(persisted) : {}),
}

if (persisted) {
  console.log(`[Store] Restored ${persisted.positions.length} positions from cache (synced ${new Date(persisted.lastSync).toLocaleString()})`)
}

export function useAppStore() {
  const [state, setState] = useState<AppState>(INITIAL)

  const applyData = useCallback((positions: RawPosition[], trades: RawTrade[], cashBalance: number, netLiquidation?: number) => {
    const strategies = classifyPositions(positions)
    const actions    = generateActions(strategies, positions)
    const lastSync   = Date.now()
    console.log(`[Store] ${positions.length} positions → ${strategies.length} strategies, ${actions.length} actions`)

    // Persist to localStorage
    savePersisted({ positions, trades, cashBalance, netLiquidation, lastSync })

    setState(s => ({
      ...s,
      sync: { ...s.sync, status: 'success', lastSync, positions, trades, cashBalance, netLiquidation },
      strategies,
      actions,
    }))
  }, [])

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
