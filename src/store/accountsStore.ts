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
import { useCallback, useEffect, useRef, useState } from 'react'
import type { RawPosition, RawTrade } from '../types'
import { syncFromXML, syncFromFlexAPI } from '../services/ibkr'
import { replaceTradeWindow } from '../services/flexWindow'
import { addWindow, enqueueToken, isRetryableFlexFailure, runFlexBackfill, type BackfillState, type FlexWindow } from '../services/flexPace'
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
  /** Per-currency breakdown of cashBalance (USD, AUD, etc.) — only XML/Flex
   * syncs provide this (see cashBalance's own comment above). */
  cashBalances?: Record<string, number>
  netLiquidation?: number
  /** Net liquidation on each Flex report date (YYYY-MM-DD), when the query
   * included an equity summary series. Absent for CSV/PDF imports. */
  equityHistory?: { date: string; netLiquidation: number }[]
  /** Flex date windows already stored. Older than the live query these are
   * closed history and are not requested again. */
  flexStoredWindows?: FlexWindow[]
  /** Older windows still to fetch after a round ran out of time or hit IBKR's rate limit. */
  flexBackfillPending?: FlexWindow[]
  flexBackfillCompleted?: number
  flexBackfillTotal?: number
  flexBackfillFailures?: number
}

interface SyncResult {
  trades: RawTrade[]
  positions?: RawPosition[]
  cashBalance?: number
  cashBalances?: Record<string, number>
  netLiquidation?: number
  equityHistory?: { date: string; netLiquidation: number }[]
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
 *
 * Replacing the window is also the backfill for fields the parser learned
 * later (`cost`, `fifoPnlRealized`, `closedLots` on trades; `openLots` on
 * positions). Portfolio data is one JSON document, not a column per field,
 * so there is no SQL migration — the next Flex sync writes them. Trades
 * older than the window keep whatever they were stored with. A backfill
 * also passes `toDate`: trades newer than that date stay, so loading an
 * older stretch does not wipe the primary sync.
 */
function mergeTrades(existing: RawTrade[], incoming: RawTrade[], fromDate?: string, toDate?: string): RawTrade[] {
  const replaced = replaceTradeWindow(existing, incoming, fromDate, toDate)
  if (replaced) return replaced
  {
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
  const [syncError, setSyncError] = useState<string | null>(null)
  const [syncNote, setSyncNote] = useState<string | null>(null)
  const [syncAccountId, setSyncAccountId] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploadAccountId, setUploadAccountId] = useState<string | null>(null)
  const accountsRef = useRef(accounts)
  /** Windows saved during this session, updated before React re-renders so the next queued sync does not refetch them. */
  const flexProgressRef = useRef(new Map<string, BackfillState>())
  const resumeTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const runSyncRef = useRef<(id: string, token: string, queryId: string, mode: 'full' | 'resume') => Promise<void>>(async () => {})

  useEffect(() => {
    accountsRef.current = accounts
  }, [accounts])

  useEffect(() => () => {
    for (const timer of resumeTimers.current.values()) clearTimeout(timer)
    resumeTimers.current.clear()
  }, [])

  // localStorage paints instantly on every key change (including right after
  // login, before the network round-trip below resolves) so there's no blank
  // flash; the server fetch then reconciles once it lands, since the server
  // copy is the one that's actually consistent across browsers/devices —
  // whichever this browser's localStorage happens to hold is not.
  useEffect(() => {
    flexProgressRef.current.clear()
    setAccounts(load(key))
    if (!sessionKey) return
    let cancelled = false
    loadRemote().then(remote => {
      if (cancelled || remote === null) return
      // The server snapshot is the source of truth when it arrives. Drop the
      // in-memory window cache so a sync cannot skip history this response just replaced.
      flexProgressRef.current.clear()
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
    flexProgressRef.current.delete(id)
    setAccounts(prev => {
      const next = prev.map(a => a.id === id
        ? {
            ...a,
            trades: [],
            positions: undefined,
            cashBalance: undefined,
            cashBalances: undefined,
            netLiquidation: undefined,
            equityHistory: undefined,
            fileName: undefined,
            uploadedAt: undefined,
            flexStoredWindows: undefined,
            flexBackfillPending: undefined,
            flexBackfillCompleted: undefined,
            flexBackfillTotal: undefined,
            flexBackfillFailures: undefined,
          }
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
    setUploadAccountId(id)
    setUploadError(null)
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
              cashBalances: result.cashBalances ?? a.cashBalances,
              netLiquidation: result.netLiquidation ?? a.netLiquidation,
              equityHistory: result.equityHistory?.length ? result.equityHistory : a.equityHistory,
              fileName: file.name,
              uploadedAt: Date.now(),
            }
          : a)
        persist(next)
        return next
      })
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : 'Failed to parse file')
    } finally {
      setLoadingId(null)
    }
  }, [persist])

  const rememberBackfill = useCallback((id: string, backfill: BackfillState) => {
    flexProgressRef.current.set(id, {
      stored: backfill.stored,
      pending: backfill.pending,
      completed: backfill.completed,
      total: backfill.total,
      failedRounds: backfill.failedRounds,
    })
    setAccounts(prev => {
      const next = prev.map(a => a.id === id
        ? {
            ...a,
            flexStoredWindows: backfill.stored,
            flexBackfillPending: backfill.pending.length > 0 ? backfill.pending : undefined,
            flexBackfillCompleted: backfill.pending.length > 0 ? backfill.completed : undefined,
            flexBackfillTotal: backfill.pending.length > 0 ? backfill.total : undefined,
            flexBackfillFailures: backfill.pending.length > 0 ? backfill.failedRounds : undefined,
          }
        : a)
      persist(next)
      return next
    })
  }, [persist])

  const scheduleResume = useCallback((id: string, token: string, queryId: string, delayMs: number) => {
    const existing = resumeTimers.current.get(id)
    if (existing) clearTimeout(existing)
    const timer = setTimeout(() => {
      resumeTimers.current.delete(id)
      void runSyncRef.current(id, token, queryId, 'resume')
    }, delayMs)
    resumeTimers.current.set(id, timer)
  }, [])

  /** Live sync via the IBKR Flex Web Service (token + query id), scoped to
   * this one account. Credentials are saved on success so a later re-sync is
   * one click. Older windows are fetched one at a time; a window already
   * stored is left alone. A rate limit pauses and resumes instead of failing
   * the sync that just saved the latest window. */
  const runSync = useCallback(async (id: string, token: string, queryId: string, mode: 'full' | 'resume') => {
    const pendingTimer = resumeTimers.current.get(id)
    if (pendingTimer) {
      clearTimeout(pendingTimer)
      resumeTimers.current.delete(id)
    }
    setLoadingId(id)
    setSyncAccountId(id)
    setSyncError(null)
    try {
      await enqueueToken(token, async () => {
        const prior = accountsRef.current.find(a => a.id === id)
        const saved = flexProgressRef.current.get(id)
        let stored = saved?.stored ?? prior?.flexStoredWindows ?? []
        if (mode === 'full') {
          const result = await syncFromFlexAPI(token, queryId)
          if (result.fromDate && result.toDate) stored = addWindow(stored, { fromDate: result.fromDate, toDate: result.toDate })
          setAccounts(prev => {
            const next = prev.map(a => {
              if (a.id !== id) return a
              return {
                ...a,
                trades: mergeTrades(a.trades, result.trades, result.fromDate),
                positions: result.positions ?? a.positions,
                cashBalance: result.cashBalance ?? a.cashBalance,
                cashBalances: result.cashBalances ?? a.cashBalances,
                netLiquidation: result.netLiquidation ?? a.netLiquidation,
                equityHistory: result.equityHistory?.length ? result.equityHistory : a.equityHistory,
                flexStoredWindows: stored,
                flexToken: token,
                flexQueryId: queryId,
                fileName: 'IBKR Flex sync',
                uploadedAt: Date.now(),
              }
            })
            persist(next)
            return next
          })
          const backfill = await runFlexBackfill({
            state: { stored, pending: [], completed: 0, total: 0, failedRounds: 0 },
            primaryFrom: result.fromDate,
            onProgress: setSyncNote,
            fetchWindow: async window => {
              const older = await syncFromFlexAPI(token, queryId, window)
              setAccounts(prev => {
                const next = prev.map(a => a.id === id
                  ? {
                      ...a,
                      trades: mergeTrades(a.trades, older.trades, window.fromDate, window.toDate),
                      flexStoredWindows: addWindow(a.flexStoredWindows, window),
                    }
                  : a)
                persist(next)
                return next
              })
            },
          })
          rememberBackfill(id, backfill)
          setSyncNote(backfill.note)
          setSyncError(backfill.error)
          if (backfill.retryAfterMs != null) scheduleResume(id, token, queryId, backfill.retryAfterMs)
          return
        }

        const backfill = await runFlexBackfill({
          state: {
            stored,
            pending: saved?.pending ?? prior?.flexBackfillPending ?? [],
            completed: saved?.completed ?? prior?.flexBackfillCompleted ?? 0,
            total: saved?.total ?? prior?.flexBackfillTotal ?? 0,
            failedRounds: saved?.failedRounds ?? prior?.flexBackfillFailures ?? 0,
          },
          onProgress: setSyncNote,
          fetchWindow: async window => {
            const older = await syncFromFlexAPI(token, queryId, window)
            setAccounts(prev => {
              const next = prev.map(a => a.id === id
                ? {
                    ...a,
                    trades: mergeTrades(a.trades, older.trades, window.fromDate, window.toDate),
                    flexStoredWindows: addWindow(a.flexStoredWindows, window),
                  }
                : a)
              persist(next)
              return next
            })
          },
        })
        rememberBackfill(id, backfill)
        setSyncNote(backfill.note)
        setSyncError(backfill.error)
        if (backfill.retryAfterMs != null) scheduleResume(id, token, queryId, backfill.retryAfterMs)
      })
    } catch (e) {
      setSyncNote(null)
      setSyncError(isRetryableFlexFailure(e)
        ? 'IBKR is limiting requests for this token. The latest window was not updated. Try again in a minute.'
        : (e instanceof Error ? e.message : 'Flex sync failed'))
    } finally {
      setLoadingId(curr => curr === id ? null : curr)
    }
  }, [persist, rememberBackfill, scheduleResume])

  useEffect(() => {
    runSyncRef.current = runSync
  }, [runSync])

  const syncFlex = useCallback((id: string, token: string, queryId: string) => {
    return runSync(id, token, queryId, 'full')
  }, [runSync])

  return { accounts, addAccount, removeAccount, clearTrades, uploadStatement, syncFlex, loadingId, syncError, syncNote, syncAccountId, uploadError, uploadAccountId }
}
