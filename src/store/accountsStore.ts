/**
 * User-defined brokerage accounts — a completely blank slate, entirely
 * user-named (no imposed Personal/Business or broker categorization). Add
 * an account, name it whatever you want, upload a statement. Each account
 * is populated purely by statement upload (no live API sync), and
 * persisted to localStorage scoped to the signed-in user so different
 * logins never see each other's accounts.
 */
import { useCallback, useEffect, useState } from 'react'
import type { RawPosition, RawTrade } from '../types'
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
  /** Live snapshot from the most recent XML/Flex sync — a generic .csv/
   * .xlsx/.pdf statement only has trade history, not a positions/cash
   * snapshot, so these stay whatever they were from the last XML/Flex sync
   * (or unset if there's never been one). */
  positions?: RawPosition[]
  cashBalance?: number
  netLiquidation?: number
}

interface SyncResult {
  trades: RawTrade[]
  positions?: RawPosition[]
  cashBalance?: number
  netLiquidation?: number
}

function unionTrades(existing: RawTrade[], incoming: RawTrade[]): RawTrade[] {
  // Union, not replace — a re-sync or a new statement shouldn't wipe out
  // older history. Deduped on the same composite fields the rest of the
  // app treats as identity when no IBKR execId is present.
  //
  // Incoming (freshly re-parsed) wins on a key collision, not existing — a
  // trade already cached from an earlier sync can be missing a field a
  // later parser fix started populating (verified: tradeTime went from
  // always-undefined to correctly populated, but every resync kept the old
  // undefined-tradeTime copy forever because it matched on the same
  // date/symbol/quantity/price key, silently pinning the stale data in
  // place no matter how many times the user re-synced).
  const byKey = new Map<string, RawTrade>()
  for (const t of existing) byKey.set(`${t.tradeDate}|${t.symbol}|${t.quantity}|${t.tradePrice}`, t)
  for (const t of incoming) byKey.set(`${t.tradeDate}|${t.symbol}|${t.quantity}|${t.tradePrice}`, t)
  return [...byKey.values()]
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
 * it's a known schema — and unlike the others, it carries a real positions/
 * cash snapshot alongside trade history. .xlsx/.xls and .pdf go through
 * their own best-effort importers; anything else is treated as CSV text via
 * the generic importer — none of those three know positions/cash, trades
 * only. */
async function parseStatementFile(file: File): Promise<SyncResult> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.xml')) {
    return await syncFromXML(file)
  }
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    const { trades, skippedRows } = await parseXlsxTrades(file)
    if (skippedRows > 0) console.warn(`[accountsStore] Skipped ${skippedRows} unparseable row(s) in ${file.name}`)
    return { trades }
  }
  if (name.endsWith('.pdf')) {
    const { trades, skippedRows } = await parsePdfTrades(file)
    if (skippedRows > 0) console.warn(`[accountsStore] Skipped ${skippedRows} unparseable row(s) in ${file.name}`)
    return { trades }
  }
  const text = await file.text()
  const { trades, skippedRows } = parseGenericCsvTrades(text)
  if (skippedRows > 0) console.warn(`[accountsStore] Skipped ${skippedRows} unparseable row(s) in ${file.name}`)
  return { trades }
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
      const next = prev.map(a => a.id === id
        ? { ...a, trades: [], positions: undefined, cashBalance: undefined, netLiquidation: undefined, fileName: undefined, uploadedAt: undefined }
        : a)
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
      const result = await parseStatementFile(file)
      setAccounts(prev => {
        const next = prev.map(a => a.id === id
          ? {
              ...a,
              trades: unionTrades(a.trades, result.trades),
              // Positions/cash are a point-in-time snapshot, not history —
              // replace rather than merge, and only touch them when this
              // source actually provided one (CSV/XLSX/PDF don't).
              positions: result.positions ?? a.positions,
              cashBalance: result.cashBalance ?? a.cashBalance,
              netLiquidation: result.netLiquidation ?? a.netLiquidation,
              fileName: file.name,
              uploadedAt: Date.now(),
            }
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
      const result = await syncFromFlexAPI(token, queryId)
      setAccounts(prev => {
        const next = prev.map(a => a.id === id
          ? {
              ...a,
              trades: unionTrades(a.trades, result.trades),
              positions: result.positions ?? a.positions,
              cashBalance: result.cashBalance ?? a.cashBalance,
              netLiquidation: result.netLiquidation ?? a.netLiquidation,
              flexToken: token, flexQueryId: queryId, fileName: 'IBKR Flex sync', uploadedAt: Date.now(),
            }
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
