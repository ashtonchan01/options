/**
 * Extra broker accounts for the Reports tab that aren't the live-synced
 * primary IBKR account (Company IBKR, Personal Moomoo) — each is populated
 * by uploading its own statement file rather than a live sync, and persisted
 * to localStorage independently so they survive reloads without touching
 * the main sync data.
 */
import { useCallback, useState } from 'react'
import type { RawTrade } from '../types'
import { syncFromXML } from '../services/ibkr'
import { parseGenericCsvTrades } from '../services/genericCsvImport'

export const REPORT_ACCOUNT_IDS = ['company_ibkr', 'personal_moomoo'] as const
export type ReportAccountId = typeof REPORT_ACCOUNT_IDS[number]

interface StoredAccount {
  trades: RawTrade[]
  fileName: string
  uploadedAt: number
}

function storageKey(id: ReportAccountId): string {
  return `options:reportAccount:${id}`
}

function load(id: ReportAccountId): StoredAccount | null {
  try {
    const raw = localStorage.getItem(storageKey(id))
    return raw ? JSON.parse(raw) as StoredAccount : null
  } catch {
    return null
  }
}

function save(id: ReportAccountId, data: StoredAccount) {
  try { localStorage.setItem(storageKey(id), JSON.stringify(data)) } catch { /* ignore */ }
}

/** IBKR Flex exports as .xml go through the real parser (syncFromXML) since
 * it's a known schema; anything else is treated as a CSV and goes through
 * the best-effort generic importer. */
async function parseStatementFile(file: File): Promise<RawTrade[]> {
  if (file.name.toLowerCase().endsWith('.xml')) {
    const { trades } = await syncFromXML(file)
    return trades
  }
  const text = await file.text()
  const { trades, skippedRows } = parseGenericCsvTrades(text)
  if (skippedRows > 0) {
    console.warn(`[reportAccountsStore] Skipped ${skippedRows} unparseable row(s) in ${file.name}`)
  }
  return trades
}

export function useReportAccount(id: ReportAccountId) {
  const [account, setAccount] = useState<StoredAccount | null>(() => load(id))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const upload = useCallback(async (file: File) => {
    setLoading(true)
    setError(null)
    try {
      const trades = await parseStatementFile(file)
      // Union with whatever's already stored (same "never lose older history"
      // reasoning as the main sync) — a new financial-year statement upload
      // shouldn't wipe out a prior year's already-imported trades. Deduped
      // on the same composite fields the rest of the app treats as identity
      // when no IBKR execId is present.
      const existing = load(id)?.trades ?? []
      const seen = new Set(existing.map(t => `${t.tradeDate}|${t.symbol}|${t.quantity}|${t.tradePrice}`))
      const merged = [...existing]
      for (const t of trades) {
        const key = `${t.tradeDate}|${t.symbol}|${t.quantity}|${t.tradePrice}`
        if (!seen.has(key)) { seen.add(key); merged.push(t) }
      }
      const next: StoredAccount = { trades: merged, fileName: file.name, uploadedAt: Date.now() }
      save(id, next)
      setAccount(next)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to parse file')
    } finally {
      setLoading(false)
    }
  }, [id])

  const clear = useCallback(() => {
    try { localStorage.removeItem(storageKey(id)) } catch { /* ignore */ }
    setAccount(null)
    setError(null)
  }, [id])

  return { trades: account?.trades ?? [], fileName: account?.fileName, uploadedAt: account?.uploadedAt, loading, error, upload, clear }
}
