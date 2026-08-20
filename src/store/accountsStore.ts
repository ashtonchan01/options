/**
 * User-defined brokerage accounts — a completely blank slate, entirely
 * user-named (no imposed Personal/Business or broker categorization). Add
 * an account, name it whatever you want, upload a statement.
 *
 * Persisted to localStorage (instant read on load, and a fallback if the
 * network's down) AND to the server via /api/portfolio-data when signed in
 * (best-effort, fire-and-forget) — localStorage alone meant a fresh browser
 * profile or a different device saw a completely empty account list even
 * after a successful login, since auth was server-backed but the actual
 * portfolio data never left the browser it was synced in. Server data wins
 * when both exist, since it's the one copy that's actually shared across
 * logins.
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
  /** The Flex report's own "YYYYMMDD" reporting window, when the source
   * provided one (XML/Flex sync only — CSV/XLSX/PDF imports don't). */
  fromDate?: string
  toDate?: string
}

/** Merges a fresh sync's trades into the existing history.
 *
 * Trades dated BEFORE the incoming report's own window (older than
 * `fromDate`) are preserved untouched — the new report never claimed to
 * cover them, so dropping them would lose real history a re-sync simply
 * didn't fetch.
 *
 * Trades dated INSIDE the window are fully replaced by whatever the fresh
 * sync says belongs there, not unioned — the Flex report is authoritative
 * for its own window, so anything IBKR no longer reports there (a phantom
 * trade from an earlier buggy parse, a broker-side correction/cancellation)
 * must disappear on resync instead of sticking around forever. Verified
 * against a real account: an MSTR covered call and an AVGO CSP that no
 * longer appear anywhere in a fresh 365-day Flex export kept showing up in
 * the journal indefinitely under the old blind-union behavior, because nothing
 * ever removed a trade once cached — only re-syncing with no window bound at
 * all (fromDate missing, e.g. a CSV/XLSX/PDF import) falls back to the old
 * pure-union behavior, since those sources can't say what they do or don't
 * cover.
 */
function mergeTrades(existing: RawTrade[], incoming: RawTrade[], fromDate?: string): RawTrade[] {
  const before = fromDate ? existing.filter(t => t.tradeDate < fromDate) : existing
  if (!fromDate) {
    // No declared window — fall back to a straight union, deduped by key,
    // incoming wins on collision (a trade already cached can be missing a
    // field a later parser fix started populating).
    //
    // The key alone (date|symbol|quantity|price) isn't unique per trade —
    // a systematic accumulation strategy genuinely buying the same 100
    // shares of the same ETF at the same price on the same day more than
    // once (verified against a real multi-year Moomoo export: 13 such
    // trades) would collapse those separate real trades into one, silently
    // understating cost basis. Appending each key's occurrence rank makes
    // the map operate as a multiset: re-uploading the same data still
    // replaces 1:1 by matching rank (so it stays idempotent), but a
    // genuinely repeated trade beyond how many existed before is kept as
    // its own entry instead of overwriting an unrelated one.
    const rank = new Map<string, number>()
    function keyed(t: RawTrade): string {
      const base = `${t.tradeDate}|${t.symbol}|${t.quantity}|${t.tradePrice}`
      const n = (rank.get(base) ?? 0) + 1
      rank.set(base, n)
      return `${base}|${n}`
    }
    const byKey = new Map<string, RawTrade>()
    for (const t of existing) byKey.set(keyed(t), t)
    rank.clear()
    for (const t of incoming) byKey.set(keyed(t), t)
    return [...byKey.values()]
  }
  return [...before, ...incoming]
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

/** Best-effort server mirror — errors (offline, not signed in, transient
 * 5xx) are swallowed since localStorage already has the authoritative write
 * and the next mutation will retry the PUT anyway. */
async function saveRemote(accounts: Account[]) {
  try {
    await fetch('/api/portfolio-data', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accounts }),
    })
  } catch { /* offline or request failed — localStorage still has it */ }
}

async function loadRemote(): Promise<Account[] | null> {
  try {
    const res = await fetch('/api/portfolio-data', { credentials: 'include' })
    if (!res.ok) return null
    const data: unknown = await res.json()
    const accounts = (data as { accounts?: unknown } | null)?.accounts
    return Array.isArray(accounts) ? accounts as Account[] : null
  } catch {
    return null
  }
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

  // localStorage paints instantly on every key change (including right after
  // login, before the network round-trip below resolves) so there's no blank
  // flash; the server fetch then reconciles once it lands, since the server
  // copy is the one that's actually consistent across browsers/devices —
  // whichever this browser's localStorage happens to hold is not.
  useEffect(() => {
    setAccounts(load(key))
    if (!sessionKey) return
    let cancelled = false
    loadRemote().then(remote => {
      if (cancelled || remote === null) return
      setAccounts(remote)
      save(key, remote)
    })
    return () => { cancelled = true }
  }, [key, sessionKey])

  const persist = useCallback((next: Account[]) => {
    save(key, next)
    if (sessionKey) saveRemote(next)
  }, [key, sessionKey])

  const addAccount = useCallback((name: string): string => {
    const account: Account = { id: newId(), name, trades: [] }
    setAccounts(prev => {
      const next = [...prev, account]
      persist(next)
      return next
    })
    return account.id
  }, [persist])

  const clearTrades = useCallback((id: string) => {
    setAccounts(prev => {
      const next = prev.map(a => a.id === id
        ? { ...a, trades: [], positions: undefined, cashBalance: undefined, netLiquidation: undefined, fileName: undefined, uploadedAt: undefined }
        : a)
      persist(next)
      return next
    })
  }, [persist])

  const removeAccount = useCallback((id: string) => {
    setAccounts(prev => {
      const next = prev.filter(a => a.id !== id)
      persist(next)
      return next
    })
  }, [persist])

  const uploadStatement = useCallback(async (id: string, file: File) => {
    setLoadingId(id)
    setError(null)
    try {
      const result = await parseStatementFile(file)
      setAccounts(prev => {
        const next = prev.map(a => a.id === id
          ? {
              ...a,
              trades: mergeTrades(a.trades, result.trades, result.fromDate),
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
        persist(next)
        return next
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to parse file')
    } finally {
      setLoadingId(null)
    }
  }, [persist])

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
              trades: mergeTrades(a.trades, result.trades, result.fromDate),
              positions: result.positions ?? a.positions,
              cashBalance: result.cashBalance ?? a.cashBalance,
              netLiquidation: result.netLiquidation ?? a.netLiquidation,
              flexToken: token, flexQueryId: queryId, fileName: 'IBKR Flex sync', uploadedAt: Date.now(),
            }
          : a)
        persist(next)
        return next
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Flex sync failed')
    } finally {
      setLoadingId(null)
    }
  }, [persist])

  return { accounts, addAccount, removeAccount, clearTrades, uploadStatement, syncFlex, loadingId, error }
}
