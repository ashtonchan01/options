/**
 * Best-effort importer for broker trade-history exports that don't have a
 * dedicated parser (Moomoo chief among them — IBKR-formatted accounts
 * should use the Flex XML upload / syncFromXML instead, which is a real
 * parser against a known schema). This is deliberately loose: it matches a
 * handful of common column-name spellings case-insensitively rather than
 * requiring an exact template, and only produces stock-trade RawTrade rows
 * (no options support — most retail exports don't carry option Greeks/
 * expiry/strike columns anyway). Throws with a specific, actionable message
 * on anything it can't confidently map, rather than silently producing
 * wrong numbers.
 *
 * Shared by three input shapes — CSV text, XLSX sheets (already array-of-
 * arrays via xlsx's sheet_to_json), and best-effort line-tokenized PDF text
 * — all of which funnel into the same `mapRowsToTrades` once reduced to a
 * header row + string[][] data rows.
 */
import type { RawTrade } from '../types'

const COLUMN_ALIASES: Record<string, string[]> = {
  date:     ['date', 'trade date', 'tradedate', 'transaction date', 'time', 'datetime'],
  symbol:   ['symbol', 'ticker', 'code', 'stock code', 'security code', 'security'],
  side:     ['side', 'action', 'buy/sell', 'direction', 'type'],
  quantity: ['quantity', 'qty', 'shares', 'filled qty', 'filled quantity'],
  price:    ['price', 'avg price', 'average price', 'filled price', 'trade price'],
  commission: ['commission', 'fee', 'fees', 'commissions', 'transaction fee(inc.gst)'],
  // Moomoo's "Transaction Overview" export mixes Stock and Option rows in
  // one sheet under a "Security Type" column, with the option rows' Security
  // Code being an OCC-style contract string (e.g. "CLSK250718C7000") rather
  // than an underlying ticker — this importer only produces STK RawTrade
  // rows (see file docstring), so those rows need to be identified and
  // skipped rather than silently imported as a fake stock position.
  assetType: ['security type', 'asset class', 'instrument type'],
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

const SLASH_DATE = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/

/** A "NN/NN/YYYY"-shaped date is genuinely ambiguous (US brokers write
 * MM/DD/YYYY, e.g. IBKR-adjacent exports; AU/UK brokers — Moomoo's AU
 * statements chief among them — write DD/MM/YYYY) and JS's native
 * `new Date(raw)` always assumes the US reading, silently transposing day
 * and month whenever both are <=12 (e.g. AU "02/07/2025" = 2 July becomes
 * "Feb 7"). Scanning the whole date column first resolves this for real:
 * any row where the first component is >12 proves day-first (can't be a
 * month), any row where the second is >12 proves month-first — whichever
 * shows up in the data wins. Falls back to the previous month-first/native
 * assumption only when the column is fully ambiguous (every date has both
 * components <=12), to avoid changing behavior for exports that already
 * worked. */
function detectDayFirst(dateValues: string[]): boolean {
  let dayFirstEvidence = false
  let monthFirstEvidence = false
  for (const raw of dateValues) {
    const m = SLASH_DATE.exec(raw.trim())
    if (!m) continue
    const a = Number(m[1])
    const b = Number(m[2])
    if (a > 12) dayFirstEvidence = true
    if (b > 12) monthFirstEvidence = true
  }
  return dayFirstEvidence && !monthFirstEvidence
}

/** IBKR trade dates are compact "YYYYMMDD" — normalize whatever date format
 * the export uses (2026-08-14, 08/14/2026, 14-Aug-2026, etc.) to match, so
 * this import lines up with the rest of the app's date handling. */
function normalizeDate(raw: string, dayFirst: boolean): string {
  const slash = SLASH_DATE.exec(raw.trim())
  if (slash) {
    const day = dayFirst ? slash[1] : slash[2]
    const month = dayFirst ? slash[2] : slash[1]
    const y = Number(slash[3])
    const mo = Number(month)
    const d = Number(day)
    if (mo < 1 || mo > 12 || d < 1 || d > 31) throw new Error(`Unrecognized date: "${raw}"`)
    return `${y}${String(mo).padStart(2, '0')}${String(d).padStart(2, '0')}`
  }
  const d = new Date(raw)
  if (isNaN(d.getTime())) throw new Error(`Unrecognized date: "${raw}"`)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}${m}${day}`
}

function parseNumber(raw: string): number {
  const cleaned = String(raw).replace(/[$,]/g, '').trim()
  const n = parseFloat(cleaned)
  return isNaN(n) ? 0 : n
}

export interface CsvImportResult {
  trades: RawTrade[]
  skippedRows: number
}

/** Core mapper: given a header row and data rows (already split into
 * cells), find the required columns and build RawTrade rows. Used by the
 * CSV, XLSX, and PDF-table paths alike. */
export function mapRowsToTrades(headerRow: string[], dataRows: string[][]): CsvImportResult {
  const headers = headerRow.map(normalizeHeader)
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

  const dayFirst = detectDayFirst(dataRows.map(cells => cells[colIndex.date!] ?? ''))

  const trades: RawTrade[] = []
  let skippedRows = 0

  for (const cells of dataRows) {
    if (cells.length < headers.length - 1) { skippedRows++; continue } // clearly malformed row
    try {
      // Option rows (e.g. Moomoo's "Transaction Overview" mixes Stock and
      // Option rows in one sheet) have no place in a stock-only importer —
      // their Security Code is an OCC-style contract string, not an
      // underlying ticker, so importing them would create a fake stock
      // position rather than just being silently wrong about the price.
      if (colIndex.assetType !== undefined) {
        const assetType = (cells[colIndex.assetType] ?? '').toLowerCase()
        if (assetType.includes('option')) { skippedRows++; continue }
      }
      const symbol = cells[colIndex.symbol!]?.toUpperCase()
      const qtyRaw = parseNumber(cells[colIndex.quantity!])
      const price = parseNumber(cells[colIndex.price!])
      const commission = colIndex.commission !== undefined ? Math.abs(parseNumber(cells[colIndex.commission!])) : 0
      if (!symbol || qtyRaw === 0 || price <= 0) { skippedRows++; continue }

      const sideRaw = colIndex.side !== undefined ? (cells[colIndex.side!] ?? '').toLowerCase() : ''
      const isSell = sideRaw.includes('sell') || sideRaw.includes('short')
      const isBuy = sideRaw.includes('buy') || sideRaw.includes('cover') || sideRaw.includes('long')
      // If Side isn't given (or doesn't say buy/sell), trust the quantity's own sign
      // — most exports that omit a side column use negative quantity for sells.
      const signedQty = isSell ? -Math.abs(qtyRaw) : isBuy ? Math.abs(qtyRaw) : qtyRaw

      const proceeds = -signedQty * price
      trades.push({
        tradeDate: normalizeDate(cells[colIndex.date!], dayFirst),
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

  if (trades.length === 0) throw new Error('No valid trade rows found — check the column headers match the expected format.')
  return { trades, skippedRows }
}

export function parseGenericCsvTrades(text: string): CsvImportResult {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0)
  if (lines.length < 2) throw new Error('CSV has no data rows')

  const headerRow = splitCsvLine(lines[0])
  const dataRows = lines.slice(1).map(splitCsvLine)
  return mapRowsToTrades(headerRow, dataRows)
}
