import { useState, useCallback } from 'react'
import type { AppState, RawPosition, RawTrade } from '../types'
import { syncFromXML, syncFromFlexAPI } from '../services/ibkr'
import { classifyPositions } from '../engine/classifier'

const INITIAL: AppState = {
  sync: { mode: 'xml', status: 'idle', positions: [], trades: [] },
  strategies: [],
  quotes: {},
  actions: [],
  scanResults: [],
}

export function useAppStore() {
  const [state, setState] = useState<AppState>(INITIAL)

  const applyData = useCallback((positions: RawPosition[], trades: RawTrade[]) => {
    const strategies = classifyPositions(positions)
    setState(s => ({
      ...s,
      sync: { ...s.sync, status: 'success', lastSync: Date.now(), positions, trades },
      strategies,
    }))
  }, [])

  const uploadXML = useCallback(async (file: File) => {
    setState(s => ({ ...s, sync: { ...s.sync, status: 'loading', error: undefined } }))
    try {
      const { positions, trades } = await syncFromXML(file)
      applyData(positions, trades)
    } catch (e) {
      setState(s => ({ ...s, sync: { ...s.sync, status: 'error', error: String(e) } }))
    }
  }, [applyData])

  const syncFlex = useCallback(async (token: string, queryId: string) => {
    setState(s => ({ ...s, sync: { ...s.sync, status: 'loading', error: undefined } }))
    try {
      const { positions, trades } = await syncFromFlexAPI(token, queryId)
      applyData(positions, trades)
    } catch (e) {
      setState(s => ({ ...s, sync: { ...s.sync, status: 'error', error: String(e) } }))
    }
  }, [applyData])

  return { state, uploadXML, syncFlex }
}
