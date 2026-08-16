/**
 * Persists manual trade labels to localStorage, mirrored to the server
 * (/api/user-data) when signed in so labels follow the user across
 * browsers/devices instead of staying pinned to wherever they were set.
 * Key: composite tradeId = `${tradeDate}|${symbol}|${quantity}|${tradePrice}`
 * Value: StrategyPage label, or null to clear.
 */
import { useEffect, useState } from 'react'
import type { StrategyPage } from '../App'
import { loadUserData, saveUserData } from '../services/userData'

export type TradeLabel = Exclude<StrategyPage, 'overview' | 'label_trades'>

const LS_KEY = 'options:tradeLabels'

function load(): Record<string, TradeLabel> {
  try {
    const raw = localStorage.getItem(LS_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}

function save(labels: Record<string, TradeLabel>) {
  localStorage.setItem(LS_KEY, JSON.stringify(labels))
}

export function tradeId(t: { tradeDate: string; symbol: string; quantity: number; tradePrice: number }): string {
  return `${t.tradeDate}|${t.symbol}|${t.quantity}|${t.tradePrice}`
}

export function useTradeLabelStore(sessionKey: string | null) {
  const [labels, setLabels] = useState<Record<string, TradeLabel>>(load)

  useEffect(() => {
    if (!sessionKey) return
    let cancelled = false
    loadUserData<Record<string, TradeLabel>>('tradeLabels').then(remote => {
      if (cancelled || !remote || Object.keys(remote).length === 0) return
      setLabels(remote)
      save(remote)
    })
    return () => { cancelled = true }
  }, [sessionKey])

  function persist(next: Record<string, TradeLabel>) {
    save(next)
    if (sessionKey) saveUserData('tradeLabels', next)
  }

  function setLabel(id: string, label: TradeLabel | null) {
    setLabels(prev => {
      const next = { ...prev }
      if (label === null) delete next[id]
      else next[id] = label
      persist(next)
      return next
    })
  }

  function setMany(ids: string[], label: TradeLabel | null) {
    setLabels(prev => {
      const next = { ...prev }
      for (const id of ids) {
        if (label === null) delete next[id]
        else next[id] = label
      }
      persist(next)
      return next
    })
  }

  function clearAll() {
    setLabels({})
    localStorage.removeItem(LS_KEY)
    if (sessionKey) saveUserData('tradeLabels', {})
  }

  return { labels, setLabel, setMany, clearAll }
}
