/**
 * Best-effort CSV importer for broker trade-history exports that don't have
 * a dedicated parser (Moomoo chief among them — IBKR-formatted accounts
 * should use the Flex XML upload / syncFromXML instead, which is a real
 * parser against a known schema). This is deliberately loose: it matches a
 * handful of common column-name spellings case-insensitively rather than
 * requiring an exact template, and only produces stock-trade RawTrade rows
 * (no options support — most retail CSV exports don't carry option Greeks/
 * expiry/strike columns anyway). Throws with a specific, actionable message
 * on anything it can't confidently map, rather than silently producing
 * wrong numbers.
 */
import type { RawTrade } from '../types'

const COLUMN_ALIASES: Record<string, string[]> = {
  date:     ['date', 'trade date', 'tradedate', 'transaction date', 'time', 'datetime'],
  symbol:   ['symbol', 'ticker', 'code', 'stock code', 'security'],
  side:     ['side', 'action', 'buy/sell', 'direction', 'type'],
  quantity: ['quantity', 'qty', 'shares', 'filled qty', 'filled quantity'],
  price:    ['price', 'avg price', 'average price', 'filled price', 'trade price'],
  commission: ['commission', 'fee', 'fees', 'commissions'],
}

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/["']/g, '')
}

/** Very small CSV splitter — handles quoted fields with embedded commas,
 * which is the one thing a plain `.split(',')` gets wrong on real exports. */
function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') { inQuotes = !inQuotes; continue }
    if (c === ',' && !inQuotes) { out.push(cur); cur = ''; continue }
    cur += c
  }
  out.push(cur)
  return out.map(s => s.trim())
}

/** IBKR trade dates are compact "YYYYMMDD" — normalize whatever date format
 * the CSV uses (2026-08-14, 08/14/2026, 14-Aug-2026, etc.) to match, so this
 * import lines up with the rest of the app's date handling. */
function normalizeDate(raw: string): string {
  const d = new Date(raw)
  if (isNaN(d.getTime())) throw new Error(`Unrecognized date: "${raw}"`)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}${m}${day}`
}

function parseNumber(raw: string): number {
  const cleaned = raw.replace(/[$,]/g, '').trim()
  const n = parseFloat(cleaned)
  return isNaN(n) ? 0 : n
}

export interface CsvImportResult {
  trades: RawTrade[]
  skippedRows: number
}

export function parseGenericCsvTrades(text: string): CsvImportResult {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0)
  if (lines.length < 2) throw new Error('CSV has no data rows')

  const headers = splitCsvLine(lines[0]).map(normalizeHeader)
  const colIndex: Partial<Record<keyof typeof COLUMN_ALIASES, number>> = {}
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    const idx = headers.findIndex(h => aliases.includes(h))
    if (idx !== -1) colIndex[field as keyof typeof COLUMN_ALIASES] = idx
  }

  const missing = (['date', 'symbol', 'quantity', 'price'] as const).filter(f => colIndex[f] === undefined)
  if (missing.length > 0) {
    throw new Error(
      `Couldn't find column(s) for: ${missing.join(', ')}. ` +
      `Found headers: ${headers.join(', ') || '(none)'}. ` +
      `Expected something like Date, Symbol, Quantity, Price (Side and Commission optional).`,
    )
  }

  const trades: RawTrade[] = []
  let skippedRows = 0

  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i])
    if (cells.length < headers.length - 1) { skippedRows++; continue } // clearly malformed row
    try {
      const symbol = cells[colIndex.symbol!]?.toUpperCase()
      const qtyRaw = parseNumber(cells[colIndex.quantity!])
      const price = parseNumber(cells[colIndex.price!])
      const commission = colIndex.commission !== undefined ? Math.abs(parseNumber(cells[colIndex.commission!])) : 0
      if (!symbol || qtyRaw === 0 || price <= 0) { skippedRows++; continue }

      const sideRaw = colIndex.side !== undefined ? cells[colIndex.side!]?.toLowerCase() : ''
      const isSell = sideRaw.includes('sell') || sideRaw.includes('short')
      const isBuy = sideRaw.includes('buy') || sideRaw.includes('cover') || sideRaw.includes('long')
      // If Side isn't given (or doesn't say buy/sell), trust the quantity's own sign
      // — most exports that omit a side column use negative quantity for sells.
      const signedQty = isSell ? -Math.abs(qtyRaw) : isBuy ? Math.abs(qtyRaw) : qtyRaw

      const proceeds = -signedQty * price
      trades.push({
        tradeDate: normalizeDate(cells[colIndex.date!]),
        symbol,
        assetClass: 'STK',
        quantity: signedQty,
        tradePrice: price,
        proceeds,
        commissions: commission,
        netCash: proceeds - commission,
      })
    } catch {
      skippedRows++
    }
  }

  if (trades.length === 0) throw new Error('No valid trade rows found in this file — check the column headers match the expected format.')
  return { trades, skippedRows }
}
