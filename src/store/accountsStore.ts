/**
 * User-defined brokerage accounts — a completely blank slate, entirely
 * user-named (no imposed Personal/Business or broker categorization). Add
 * an account, name it whatever you want, upload a statement. Each account
 * is populated purely by statement upload (no live API sync), and
 * persisted to localStorage scoped to the signed-in user so different
 * logins never see each other's accounts.
 */
import { useCallback, useEffect, useState } from 'react'
import type { RawTrade } from '../types'
import { syncFromXML, syncFromFlexAPI } from '../services/ibkr'
import { parseGenericCsvTrades } from '../services/genericCsvImport'
import { parseXlsxTrades } from '../services/xlsxImport'
import { parsePdfTrades } from '../services/pdfImport'

export interface Account {
  id: string
  name: string
  trades: RawTrade[]
  fileName?: string
  uploadedAt?: number
  /** IBKR Flex Web Service credentials, saved once a sync succeeds so the
   * account can be re-synced with one click afterward. */
  flexToken?: string
  flexQueryId?: string
}

function unionTrades(existing: RawTrade[], incoming: RawTrade[]): RawTrade[] {
  // Union, not replace — a re-sync or a new statement shouldn't wipe out
  // older history. Deduped on the same composite fields the rest of the
  // app treats as identity when no IBKR execId is present.
  const seen = new Set(existing.map(t => `${t.tradeDate}|${t.symbol}|${t.quantity}|${t.tradePrice}`))
  const merged = [...existing]
  for (const t of incoming) {
    const key = `${t.tradeDate}|${t.symbol}|${t.quantity}|${t.tradePrice}`
    if (!seen.has(key)) { seen.add(key); merged.push(t) }
  }
  return merged
}

function storageKey(sessionKey: string): string {
  return `options:accounts:${sessionKey}`
}

function load(sessionKey: string): Account[] {
  try {
    const raw = localStorage.getItem(storageKey(sessionKey))
    return raw ? JSON.parse(raw) as Account[] : []
  } catch {
    return []
  }
}

function save(sessionKey: string, accounts: Account[]) {
  try { localStorage.setItem(storageKey(sessionKey), JSON.stringify(accounts)) } catch { /* ignore */ }
}

function newId(): string {
  return `acct_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

/** IBKR Flex exports as .xml go through the real parser (syncFromXML) since
 * it's a known schema; .xlsx/.xls and .pdf go through their own best-effort
 * importers; anything else is treated as CSV text via the generic importer. */
async function parseStatementFile(file: File): Promise<RawTrade[]> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.xml')) {
    const { trades } = await syncFromXML(file)
    return trades
  }
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    const { trades, skippedRows } = await parseXlsxTrades(file)
    if (skippedRows > 0) console.warn(`[accountsStore] Skipped ${skippedRows} unparseable row(s) in ${file.name}`)
    return trades
  }
  if (name.endsWith('.pdf')) {
    const { trades, skippedRows } = await parsePdfTrades(file)
    if (skippedRows > 0) console.warn(`[accountsStore] Skipped ${skippedRows} unparseable row(s) in ${file.name}`)
    return trades
  }
  const text = await file.text()
  const { trades, skippedRows } = parseGenericCsvTrades(text)
  if (skippedRows > 0) console.warn(`[accountsStore] Skipped ${skippedRows} unparseable row(s) in ${file.name}`)
  return trades
}

export function useAccounts(sessionKey: string | null) {
  const key = sessionKey ?? 'anon'
  const [accounts, setAccounts] = useState<Account[]>(() => load(key))
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { setAccounts(load(key)) }, [key])

  const addAccount = useCallback((name: string): string => {
    const account: Account = { id: newId(), name, trades: [] }
    setAccounts(prev => {
      const next = [...prev, account]
      save(key, next)
      return next
    })
    return account.id
  }, [key])

  const clearTrades = useCallback((id: string) => {
    setAccounts(prev => {
      const next = prev.map(a => a.id === id ? { ...a, trades: [], fileName: undefined, uploadedAt: undefined } : a)
      save(key, next)
      return next
    })
  }, [key])

  const removeAccount = useCallback((id: string) => {
    setAccounts(prev => {
      const next = prev.filter(a => a.id !== id)
      save(key, next)
      return next
    })
  }, [key])

  const uploadStatement = useCallback(async (id: string, file: File) => {
    setLoadingId(id)
    setError(null)
    try {
      const trades = await parseStatementFile(file)
      setAccounts(prev => {
        const next = prev.map(a => a.id === id
          ? { ...a, trades: unionTrades(a.trades, trades), fileName: file.name, uploadedAt: Date.now() }
          : a)
        save(key, next)
        return next
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to parse file')
    } finally {
      setLoadingId(null)
    }
  }, [key])

  /** Live sync via the IBKR Flex Web Service (token + query id), scoped to
   * this one account instead of a single app-wide primary account — each
   * account can have its own Flex report tied to it. Credentials are saved
   * on the account on success so a later re-sync is a one-click action. */
  const syncFlex = useCallback(async (id: string, token: string, queryId: string) => {
    setLoadingId(id)
    setError(null)
    try {
      const { trades } = await syncFromFlexAPI(token, queryId)
      setAccounts(prev => {
        const next = prev.map(a => a.id === id
          ? { ...a, trades: unionTrades(a.trades, trades), flexToken: token, flexQueryId: queryId, fileName: 'IBKR Flex sync', uploadedAt: Date.now() }
          : a)
        save(key, next)
        return next
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Flex sync failed')
    } finally {
      setLoadingId(null)
    }
  }, [key])

  return { accounts, addAccount, removeAccount, clearTrades, uploadStatement, syncFlex, loadingId, error }
}
