import { useState, useCallback } from 'react'
import type { AppState, RawPosition, RawTrade } from '../types'
import { syncFromXML, syncFromFlexAPI } from '../services/ibkr'
import { classifyPositions } from '../engine/classifier'
import { generateActions } from '../engine/actions'

const INITIAL: AppState = {
  sync: { mode: 'xml', status: 'idle', positions: [], trades: [], cashBalance: 0 },
  strategies: [],
  quotes: {},
  actions: [],
  scanResults: [],
}

export function useAppStore() {
  const [state, setState] = useState<AppState>(INITIAL)

  const applyData = useCallback((positions: RawPosition[], trades: RawTrade[], cashBalance: number) => {
    const strategies = classifyPositions(positions)
    const actions    = generateActions(strategies, positions)
    setState(s => ({
      ...s,
      sync: { ...s.sync, status: 'success', lastSync: Date.now(), positions, trades, cashBalance },
      strategies,
      actions,
    }))
  }, [])

  const uploadXML = useCallback(async (file: File) => {
    setState(s => ({ ...s, sync: { ...s.sync, status: 'loading', error: undefined } }))
    try {
      const { positions, trades, cashBalance } = await syncFromXML(file)
      applyData(positions, trades, cashBalance)
    } catch (e) {
      setState(s => ({ ...s, sync: { ...s.sync, status: 'error', error: String(e) } }))
    }
  }, [applyData])

  const syncFlex = useCallback(async (token: string, queryId: string) => {
    setState(s => ({ ...s, sync: { ...s.sync, status: 'loading', error: undefined } }))
    try {
      const { positions, trades, cashBalance } = await syncFromFlexAPI(token, queryId)
      applyData(positions, trades, cashBalance)
    } catch (e) {
      setState(s => ({ ...s, sync: { ...s.sync, status: 'error', error: String(e) } }))
    }
  }, [applyData])

  return { state, uploadXML, syncFlex }
}
