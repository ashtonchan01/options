/**
 * User-entered extra cash lines for the Trade Journal's CASH card — for
 * anything not covered by the IBKR-synced per-currency balances (a bank
 * account held elsewhere, cash on a different broker, etc.). Each row is a
 * free-form ticker/label plus a market value, already assumed to be in USD
 * (no currency picker — same "just the amount" pattern the Allocation
 * page's own CASH target row uses). One localStorage blob keyed by
 * accountId, same shape/persistence pattern as targetAllocations in
 * PortfolioAllocationView.tsx: instant local read, best-effort server mirror
 * when signed in so the rows follow the user across devices.
 */
import { useCallback, useEffect, useState } from 'react'
import { loadUserData, saveUserData } from '../services/userData'

export interface ManualCashRow {
  id: string
  ticker: string
  value: number
}

const LS_KEY = 'options:manualCashRows'

function loadAll(): Record<string, ManualCashRow[]> {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, ManualCashRow[]>
    return typeof parsed === 'object' && parsed !== null ? parsed : {}
  } catch {
    return {}
  }
}

function saveAll(map: Record<string, ManualCashRow[]>) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(map)) } catch { /* ignore */ }
}

export function useManualCashRows(accountId: string, sessionKey?: string | null) {
  const [allRows, setAllRows] = useState<Record<string, ManualCashRow[]>>(loadAll)
  const rows = allRows[accountId] ?? []

  useEffect(() => {
    if (!sessionKey) return
    let cancelled = false
    loadUserData<Record<string, ManualCashRow[]>>('manualCashRows').then(remote => {
      if (cancelled || !remote) return
      setAllRows(remote)
      saveAll(remote)
    })
    return () => { cancelled = true }
  }, [sessionKey])

  const persist = useCallback((next: Record<string, ManualCashRow[]>) => {
    setAllRows(next)
    saveAll(next)
    if (sessionKey) saveUserData('manualCashRows', next)
  }, [sessionKey])

  const addRow = useCallback((ticker: string, value: number) => {
    const row: ManualCashRow = { id: `mc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, ticker, value }
    persist({ ...allRows, [accountId]: [...(allRows[accountId] ?? []), row] })
  }, [allRows, accountId, persist])

  const removeRow = useCallback((id: string) => {
    persist({ ...allRows, [accountId]: (allRows[accountId] ?? []).filter(r => r.id !== id) })
  }, [allRows, accountId, persist])

  return { rows, addRow, removeRow }
}
