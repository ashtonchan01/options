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

/** Server-side copy of the same data, keyed to the signed-in account — survives
 * clearing browser storage or switching devices, which localStorage alone can't.
 * Best-effort: a signed-out session (sessionKey === null, e.g. viewing without an
 * account) simply has nothing to save to, and network errors are swallowed since
 * localStorage remains the source of truth for the running session either way. */
async function fetchServerPersisted(): Promise<PersistedData | null> {
  try {
    const res = await fetch('/api/portfolio-data', { credentials: 'include' })
    if (!res.ok) return null
    const data = await res.json()
    return data && Array.isArray(data.trades) ? data as PersistedData : null
  } catch {
    return null
  }
}

async function saveServerPersisted(data: PersistedData) {
  try {
    await fetch('/api/portfolio-data', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
  } catch (e) {
    console.warn('[Store] Failed to save portfolio data to server:', e)
  }
}

/** IBKR's Flex report only covers a rolling 365-day window, so every sync/upload
 * would otherwise silently drop trade history older than a year. Union new trades
 * into whatever's already stored instead of replacing wholesale — once a trade
 * has been seen in any past sync it stays in the journal permanently, even after
 * IBKR stops reporting it.
 *
 * Deduped by IBKR's own execId when available, NOT the composite tradeId() used
 * for labels — that composite key (date|symbol|quantity|price) collapses two
 * genuinely distinct executions that share the same date/qty/price into one,
 * silently undercounting a multi-lot order that filled at a single uniform
 * price (verified: a real 3-lot CSP sell, each execution -1 @ the same price,
 * merged down to 2 rows, undercounting the position by a contract). Falls back
 * to the composite key only for records with no execId (Transfers). */
function mergeKey(t: RawTrade): string {
  return t.execId ?? tradeId(t)
}
function mergeTrades(existing: RawTrade[], incoming: RawTrade[]): RawTrade[] {
  // Trades persisted before execId was captured have no execId of their own,
  // keyed only by the lossy composite tradeId(). A fresh sync's incoming set
  // (execId-aware) describes those same date/symbol/qty/price buckets with
  // full per-execution granularity now — keeping the old collapsed placeholder
  // around alongside the new distinct rows would double-count them. Drop any
  // execId-less existing row the incoming sync now covers; anything outside
  // the incoming sync's window (older than IBKR's 365-day report) is left
  // untouched since nothing here supersedes it.
  const incomingComposite = new Set(incoming.map(t => tradeId(t)))
  const survivors = existing.filter(t => t.execId || !incomingComposite.has(tradeId(t)))

  const map = new Map<string, RawTrade>()
  for (const t of survivors) map.set(mergeKey(t), t)
  for (const t of incoming) map.set(mergeKey(t), t)
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
    if (!sessionKey) return

    // The local cache loads instantly above; the server copy (which is what
    // actually survives a cleared browser or a different device) arrives a
    // moment later and gets merged in — whichever side has more trade
    // history wins on trades (union), and whichever synced most recently
    // wins on the live snapshot (positions/cash/net liq).
    let cancelled = false
    fetchServerPersisted().then(server => {
      if (cancelled || !server) return
      setState(s => {
        const mergedTrades = mergeTrades(s.sync.trades, server.trades)
        const serverIsNewer = server.lastSync > (s.sync.lastSync ?? 0)
        const positions      = serverIsNewer ? server.positions      : s.sync.positions
        const cashBalance    = serverIsNewer ? server.cashBalance    : s.sync.cashBalance
        const netLiquidation = serverIsNewer ? server.netLiquidation : s.sync.netLiquidation
        const lastSync       = Math.max(server.lastSync, s.sync.lastSync ?? 0)
        if (mergedTrades.length === s.sync.trades.length && !serverIsNewer) return s
        const merged: PersistedData = { positions, trades: mergedTrades, cashBalance, netLiquidation, lastSync }
        savePersisted(sessionKey, merged)
        console.log(`[Store] Merged server copy: ${server.trades.length} server trades → ${mergedTrades.length} total retained`)
        return { ...s, ...buildState(merged) }
      })
    })
    return () => { cancelled = true }
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
      const merged: PersistedData = { positions, trades: mergedTrades, cashBalance, netLiquidation, lastSync }
      if (sessionKey) {
        savePersisted(sessionKey, merged)
        saveServerPersisted(merged)
      }
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
