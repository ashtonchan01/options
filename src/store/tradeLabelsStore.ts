/**
 * Persists manual trade labels to localStorage.
 * Key: composite tradeId = `${tradeDate}|${symbol}|${quantity}|${tradePrice}`
 * Value: StrategyPage label, or null to clear.
 */
import { useState } from 'react'
import type { StrategyPage } from '../App'

export type TradeLabel = Exclude<StrategyPage, 'overview'>

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

export function useTradeLabelStore() {
  const [labels, setLabels] = useState<Record<string, TradeLabel>>(load)

  function setLabel(id: string, label: TradeLabel | null) {
    setLabels(prev => {
      const next = { ...prev }
      if (label === null) delete next[id]
      else next[id] = label
      save(next)
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
      save(next)
      return next
    })
  }

  function clearAll() {
    setLabels({})
    localStorage.removeItem(LS_KEY)
  }

  return { labels, setLabel, setMany, clearAll }
}
