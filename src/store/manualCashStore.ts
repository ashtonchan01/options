/**
 * User-entered extra cash lines for the Trade Journal's CASH card — for
 * anything not covered by the IBKR-synced per-currency balances (a bank
 * account held elsewhere, cash on a different broker, etc.). Each row has a
 * free-form Name, a Currency code (converted to USD for the card's total the
 * same way a synced currency balance is — see useCashRows in JournalView.tsx),
 * and a market value in that currency. One localStorage blob keyed by
 * accountId, same shape/persistence pattern as targetAllocations in
 * PortfolioAllocationView.tsx: instant local read, best-effort server mirror
 * when signed in so the rows follow the user across devices.
 */
import { useCallback, useEffect, useState } from 'react'
import { loadUserData, saveUserData } from '../services/userData'

export interface ManualCashRow {
  id: string
  name: string
  currency: string
  value: number
}

const LS_KEY = 'options:manualCashRows'

/** Rows saved before Name/Currency existed only had `ticker`/`value` — read
 * that shape as `name: ticker, currency: 'USD'` (the only currency the old
 * version ever assumed) instead of losing the row or crashing on it. */
function normalizeRow(raw: unknown): ManualCashRow | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const id = typeof r.id === 'string' ? r.id : null
  const value = typeof r.value === 'number' ? r.value : null
  if (!id || value === null) return null
  const name = typeof r.name === 'string' ? r.name : typeof r.ticker === 'string' ? r.ticker : ''
  const currency = typeof r.currency === 'string' && r.currency ? r.currency : 'USD'
  return { id, name, currency, value }
}

function loadAll(): Record<string, ManualCashRow[]> {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, unknown[]>
    if (typeof parsed !== 'object' || parsed === null) return {}
    const out: Record<string, ManualCashRow[]> = {}
    for (const [accountId, rows] of Object.entries(parsed)) {
      out[accountId] = Array.isArray(rows) ? rows.map(normalizeRow).filter((r): r is ManualCashRow => r !== null) : []
    }
    return out
  } catch {
    return {}
  }
}

function saveAll(map: Record<string, ManualCashRow[]>) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(map)) } catch { /* ignore */ }
}

/** Plain (non-hook) read for callers that aren't already inside a React
 * component with live state — e.g. the Overview page's Allocation-by-
 * Position pie, which calls the standalone `currentAllocationSlices`
 * function rather than rendering a component of its own. Sums each row's
 * value AS-IS regardless of its currency — a real FX conversion needs a
 * live rate fetch, which this synchronous helper can't do; the reactive
 * `useManualCashRows` + the Journal's own useCashRows/useFxRates below are
 * preferred wherever a component can use them, since those actually convert
 * each currency to USD. This is a known approximation for the Overview pie,
 * only exact when every manual row happens to be in USD. */
export function getManualCashTotal(accountId: string): number {
  const rows = loadAll()[accountId] ?? []
  return rows.reduce((s, r) => s + r.value, 0)
}

export function useManualCashRows(accountId: string, sessionKey?: string | null) {
  const [allRows, setAllRows] = useState<Record<string, ManualCashRow[]>>(loadAll)
  const rows = allRows[accountId] ?? []

  useEffect(() => {
    if (!sessionKey) return
    let cancelled = false
    loadUserData<Record<string, unknown[]>>('manualCashRows').then(remote => {
      if (cancelled || !remote) return
      const normalized: Record<string, ManualCashRow[]> = {}
      for (const [id, rowList] of Object.entries(remote)) {
        normalized[id] = Array.isArray(rowList) ? rowList.map(normalizeRow).filter((r): r is ManualCashRow => r !== null) : []
      }
      setAllRows(normalized)
      saveAll(normalized)
    })
    return () => { cancelled = true }
  }, [sessionKey])

  const persist = useCallback((next: Record<string, ManualCashRow[]>) => {
    setAllRows(next)
    saveAll(next)
    if (sessionKey) saveUserData('manualCashRows', next)
  }, [sessionKey])

  const addRow = useCallback((name: string, currency: string, value: number) => {
    const row: ManualCashRow = { id: `mc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, name, currency, value }
    persist({ ...allRows, [accountId]: [...(allRows[accountId] ?? []), row] })
  }, [allRows, accountId, persist])

  const removeRow = useCallback((id: string) => {
    persist({ ...allRows, [accountId]: (allRows[accountId] ?? []).filter(r => r.id !== id) })
  }, [allRows, accountId, persist])

  const updateRow = useCallback((id: string, name: string, currency: string, value: number) => {
    persist({ ...allRows, [accountId]: (allRows[accountId] ?? []).map(r => r.id === id ? { ...r, name, currency, value } : r) })
  }, [allRows, accountId, persist])

  return { rows, addRow, removeRow, updateRow }
}
