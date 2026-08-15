/**
 * Shared watchlist — a plain list of tickers the user adds themselves, one
 * per signed-in user (localStorage, same pattern as accountsStore). Feeds
 * two places: the Scanner's ticker list, and which tickers the Calendar
 * pulls earnings dates for. Add a ticker once here and it shows up in both,
 * instead of each page keeping its own separate ticker list.
 */
import { useCallback, useEffect, useState } from 'react'

function storageKey(sessionKey: string): string {
  return `options:watchlist:${sessionKey}`
}

function load(sessionKey: string): string[] {
  try {
    const raw = localStorage.getItem(storageKey(sessionKey))
    return raw ? JSON.parse(raw) as string[] : []
  } catch {
    return []
  }
}

function save(sessionKey: string, tickers: string[]) {
  try { localStorage.setItem(storageKey(sessionKey), JSON.stringify(tickers)) } catch { /* ignore */ }
}

export function useWatchlist(sessionKey: string | null) {
  const key = sessionKey ?? 'anon'
  const [tickers, setTickers] = useState<string[]>(() => load(key))

  useEffect(() => { setTickers(load(key)) }, [key])

  const addTicker = useCallback((symbol: string) => {
    const sym = symbol.trim().toUpperCase()
    if (!sym) return
    setTickers(prev => {
      if (prev.includes(sym)) return prev
      const next = [...prev, sym].sort()
      save(key, next)
      return next
    })
  }, [key])

  const removeTicker = useCallback((symbol: string) => {
    setTickers(prev => {
      const next = prev.filter(t => t !== symbol)
      save(key, next)
      return next
    })
  }, [key])

  return { tickers, addTicker, removeTicker }
}
