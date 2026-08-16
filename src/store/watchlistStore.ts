/**
 * Watchlists — multiple named ticker lists per signed-in user (localStorage,
 * same pattern as accountsStore). Exactly one is "active" at a time; that
 * one's tickers feed the Scanner's ticker list and which tickers the
 * Calendar pulls earnings dates for. Switching the active watchlist changes
 * what both of those see, without touching the other lists.
 */
import { useCallback, useEffect, useState } from 'react'

export interface Watchlist {
  id: string
  name: string
  tickers: string[]
}

interface WatchlistsState {
  lists: Watchlist[]
  activeId: string
}

const OLD_FLAT_KEY_PREFIX = 'options:watchlist:'
function storageKey(sessionKey: string): string {
  return `options:watchlists:${sessionKey}`
}

function newId(): string {
  return `wl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
}

function migrateOldFlatList(sessionKey: string): WatchlistsState | null {
  try {
    const raw = localStorage.getItem(`${OLD_FLAT_KEY_PREFIX}${sessionKey}`)
    if (!raw) return null
    const tickers = JSON.parse(raw) as string[]
    if (!Array.isArray(tickers) || tickers.length === 0) return null
    const list: Watchlist = { id: newId(), name: 'My Watchlist', tickers }
    return { lists: [list], activeId: list.id }
  } catch {
    return null
  }
}

function load(sessionKey: string): WatchlistsState {
  try {
    const raw = localStorage.getItem(storageKey(sessionKey))
    if (raw) {
      const parsed = JSON.parse(raw) as WatchlistsState
      if (parsed.lists?.length) return parsed
    }
  } catch { /* fall through */ }
  return migrateOldFlatList(sessionKey) ?? { lists: [], activeId: '' }
}

function save(sessionKey: string, state: WatchlistsState) {
  try { localStorage.setItem(storageKey(sessionKey), JSON.stringify(state)) } catch { /* ignore */ }
}

export function useWatchlists(sessionKey: string | null) {
  const key = sessionKey ?? 'anon'
  const [state, setState] = useState<WatchlistsState>(() => load(key))

  useEffect(() => { setState(load(key)) }, [key])

  function update(fn: (prev: WatchlistsState) => WatchlistsState) {
    setState(prev => {
      const next = fn(prev)
      save(key, next)
      return next
    })
  }

  const addList = useCallback((name: string): string => {
    const list: Watchlist = { id: newId(), name, tickers: [] }
    update(prev => ({ lists: [...prev.lists, list], activeId: prev.activeId || list.id }))
    return list.id
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps

  const removeList = useCallback((id: string) => {
    update(prev => {
      const lists = prev.lists.filter(l => l.id !== id)
      const activeId = prev.activeId === id ? (lists[0]?.id ?? '') : prev.activeId
      return { lists, activeId }
    })
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps

  const renameList = useCallback((id: string, name: string) => {
    update(prev => ({ ...prev, lists: prev.lists.map(l => l.id === id ? { ...l, name } : l) }))
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps

  const setActive = useCallback((id: string) => {
    update(prev => ({ ...prev, activeId: id }))
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps

  const addTicker = useCallback((listId: string, symbol: string) => {
    const sym = symbol.trim().toUpperCase()
    if (!sym) return
    update(prev => ({
      ...prev,
      lists: prev.lists.map(l => l.id === listId && !l.tickers.includes(sym)
        ? { ...l, tickers: [...l.tickers, sym].sort() }
        : l),
    }))
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps

  const removeTicker = useCallback((listId: string, symbol: string) => {
    update(prev => ({
      ...prev,
      lists: prev.lists.map(l => l.id === listId ? { ...l, tickers: l.tickers.filter(t => t !== symbol) } : l),
    }))
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps

  const activeList = state.lists.find(l => l.id === state.activeId) ?? null

  return {
    lists: state.lists,
    activeId: state.activeId,
    activeTickers: activeList?.tickers ?? [],
    setActive,
    addList,
    removeList,
    renameList,
    addTicker,
    removeTicker,
  }
}
