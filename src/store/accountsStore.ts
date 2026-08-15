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
import { syncFromXML } from '../services/ibkr'
import { parseGenericCsvTrades } from '../services/genericCsvImport'
import { parseXlsxTrades } from '../services/xlsxImport'
import { parsePdfTrades } from '../services/pdfImport'

export interface Account {
  id: string
  name: string
  trades: RawTrade[]
  fileName?: string
  uploadedAt?: number
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
        const next = prev.map(a => {
          if (a.id !== id) return a
          // Union with whatever's already stored — a new financial-year
          // statement upload shouldn't wipe out a prior year's already-
          // imported trades. Deduped on the same composite fields the rest
          // of the app treats as identity when no IBKR execId is present.
          const seen = new Set(a.trades.map(t => `${t.tradeDate}|${t.symbol}|${t.quantity}|${t.tradePrice}`))
          const merged = [...a.trades]
          for (const t of trades) {
            const dupeKey = `${t.tradeDate}|${t.symbol}|${t.quantity}|${t.tradePrice}`
            if (!seen.has(dupeKey)) { seen.add(dupeKey); merged.push(t) }
          }
          return { ...a, trades: merged, fileName: file.name, uploadedAt: Date.now() }
        })
        save(key, next)
        return next
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to parse file')
    } finally {
      setLoadingId(null)
    }
  }, [key])

  return { accounts, addAccount, removeAccount, clearTrades, uploadStatement, loadingId, error }
}
