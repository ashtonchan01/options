/**
 * Per-financial-year manual cash input for the Reports "Annual ROI" page —
 * a dollar amount (in a currency of the user's choosing, e.g. AUD) typed
 * directly against a specific FY row (e.g. "I deposited $10K AUD into this
 * account in FY 2024/25, don't count it as a trading gain"), converted to
 * USD and deducted from that row's own P&L only. Distinct from the
 * Journal's CASH card manual rows (manualCashStore.ts), which track a
 * *current* balance held outside the synced brokerage (no year of its own) —
 * this instead needs one figure PER financial year, so it's its own store.
 * Same localStorage + best-effort server mirror pattern as manualCashStore/
 * targetAllocations: instant local read, synced to the server when signed in.
 */
import { useCallback, useEffect, useState } from 'react'
import { loadUserData, saveUserData } from '../services/userData'

export interface AnnualRoiCashEntry {
  value: number
  currency: string
}

type ByFy = Record<string, AnnualRoiCashEntry>
type ByAccount = Record<string, ByFy>

const LS_KEY = 'options:annualRoiManualCash'

/** Older saved rows were a plain number (always USD) — read that shape as
 * `{ value, currency: 'USD' }` instead of losing the entry. */
function normalizeEntry(raw: unknown): AnnualRoiCashEntry | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? { value: raw, currency: 'USD' } : null
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const value = typeof r.value === 'number' && Number.isFinite(r.value) ? r.value : null
  if (value === null) return null
  const currency = typeof r.currency === 'string' && r.currency ? r.currency : 'USD'
  return { value, currency }
}

function loadAll(): ByAccount {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed !== 'object' || parsed === null) return {}
    const out: ByAccount = {}
    for (const [accountId, byFy] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof byFy !== 'object' || byFy === null) continue
      const cleanByFy: ByFy = {}
      for (const [fy, v] of Object.entries(byFy as Record<string, unknown>)) {
        const entry = normalizeEntry(v)
        if (entry) cleanByFy[fy] = entry
      }
      out[accountId] = cleanByFy
    }
    return out
  } catch {
    return {}
  }
}

function saveAll(map: ByAccount) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(map)) } catch { /* ignore */ }
}

export function useAnnualRoiManualCash(accountId: string, sessionKey?: string | null) {
  const [all, setAll] = useState<ByAccount>(loadAll)
  const byFy = all[accountId] ?? {}

  useEffect(() => {
    if (!sessionKey) return
    let cancelled = false
    loadUserData<Record<string, Record<string, unknown>>>('annualRoiManualCash').then(remote => {
      if (cancelled || !remote) return
      const normalized: ByAccount = {}
      for (const [accId, byFyRaw] of Object.entries(remote)) {
        const cleanByFy: ByFy = {}
        for (const [fy, v] of Object.entries(byFyRaw ?? {})) {
          const entry = normalizeEntry(v)
          if (entry) cleanByFy[fy] = entry
        }
        normalized[accId] = cleanByFy
      }
      setAll(normalized)
      saveAll(normalized)
    })
    return () => { cancelled = true }
  }, [sessionKey])

  const setValue = useCallback((fyKey: string, value: number, currency: string) => {
    const nextByFy = { ...byFy, [fyKey]: { value, currency } }
    const next = { ...all, [accountId]: nextByFy }
    setAll(next)
    saveAll(next)
    if (sessionKey) saveUserData('annualRoiManualCash', next)
  }, [all, byFy, accountId, sessionKey])

  return { byFy, setValue }
}
