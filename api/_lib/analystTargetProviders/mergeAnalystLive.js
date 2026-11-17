/** Merge live analyst payloads from Yahoo, Nasdaq, FMP, etc. */

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

function pickSummaryField(summaries, key) {
  for (const s of summaries) {
    const v = s?.[key]
    if (v != null && Number.isFinite(v)) return v
  }
  return null
}

function pickMaxCount(summaries) {
  const counts = summaries.map(s => s?.count).filter(n => n != null && Number.isFinite(n))
  if (!counts.length) return null
  return Math.max(...counts)
}

/**
 * Combine row lists (dedupe by firm, newest date wins) and consensus summary fields
 * (median/high/low from first available source; count = max across sources).
 */
export function mergeLiveAnalystPayloads(payloads) {
  const parts = (payloads ?? []).filter(p => p && (p.summary || (p.rows?.length ?? 0) > 0))
  if (!parts.length) return { summary: null, rows: [] }

  const summaries = parts.map(p => p.summary).filter(Boolean)
  const allRows = []
  for (const p of parts) {
    if (p.rows?.length) allRows.push(...p.rows)
  }

  const rows = dedupeLiveFirmRows(allRows)
  const median = pickSummaryField(summaries, 'median')
  const high = pickSummaryField(summaries, 'high')
  const low = pickSummaryField(summaries, 'low')
  const count = pickMaxCount(summaries) ?? (rows.length > 0 ? rows.length : null)

  if (median == null && high == null && low == null && count == null && !rows.length) {
    return { summary: null, rows: [] }
  }

  return {
    summary: { median, high, low, count },
    rows,
  }
}