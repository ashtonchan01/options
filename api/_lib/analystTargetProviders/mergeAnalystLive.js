/** Merge live analyst payloads from Yahoo, Nasdaq, FMP, etc. */

import { ANALYST_TARGET_WINDOW_MS, isWithinAnalystTargetWindow } from '../analystTargetWindow.js'

export function dedupeLiveFirmRows(rows) {
  const byFirm = new Map()
  for (const row of rows ?? []) {
    const firmKey = (row.firm || '').trim().toLowerCase()
    if (!firmKey) continue
    const pt = Number(row.priceTarget)
    if (!Number.isFinite(pt) || pt <= 0) continue
    const prev = byFirm.get(firmKey)
    if (!prev || (row.date ?? '').localeCompare(prev.date ?? '') > 0) {
      byFirm.set(firmKey, row)
    }
  }
  return [...byFirm.values()].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
}

function medianFromPts(pts) {
  if (!pts.length) return null
  const sorted = [...pts].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2
  return sorted[mid]
}

function summaryFromInWindowRows(rows) {
  if (!rows.length) return null
  const pts = rows.map(r => Number(r.priceTarget)).filter(n => Number.isFinite(n) && n > 0)
  if (!pts.length) return null
  return {
    median: medianFromPts(pts),
    high: Math.max(...pts),
    low: Math.min(...pts),
    count: rows.length,
  }
}

/**
 * Combine row lists (dedupe by firm, newest date wins), keep only targets within 90 days,
 * and derive summary stats from those rows (never from upstream consensus alone).
 */
export function mergeLiveAnalystPayloads(payloads, nowMs = Date.now()) {
  const parts = (payloads ?? []).filter(p => p && (p.summary || (p.rows?.length ?? 0) > 0))
  if (!parts.length) return { summary: null, rows: [] }

  const allRows = []
  for (const p of parts) {
    if (p.rows?.length) allRows.push(...p.rows)
  }

  const deduped = dedupeLiveFirmRows(allRows)
  const rows = deduped.filter(r => isWithinAnalystTargetWindow(r.date, nowMs))
  const summary = summaryFromInWindowRows(rows)

  if (!summary && !rows.length) return { summary: null, rows: [] }

  return { summary, rows }
}

export { ANALYST_TARGET_WINDOW_MS }