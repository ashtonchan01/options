/**
 * XLSX/XLS broker statement importer — reads the first sheet with data via
 * SheetJS, treats row 1 as headers, and hands off to the same column-alias
 * mapping the generic CSV importer uses.
 */
import * as XLSX from 'xlsx'
import { mapRowsToTrades, type CsvImportResult } from './genericCsvImport'

export async function parseXlsxTrades(file: File): Promise<CsvImportResult> {
  const buf = await file.arrayBuffer()
  const workbook = XLSX.read(buf, { type: 'array' })

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false, defval: '' })
      .map(row => row.map(cell => String(cell ?? '').trim()))
      .filter(row => row.some(c => c.length > 0))

    if (rows.length < 2) continue
    try {
      return mapRowsToTrades(rows[0], rows.slice(1))
    } catch {
      // This sheet's first row wasn't a matching header — try the next sheet.
      continue
    }
  }

  throw new Error(`No sheet in "${file.name}" had a recognizable Date/Symbol/Quantity/Price header row.`)
}
