/**
 * Best-effort PDF broker statement importer. PDF layout/tables are far less
 * reliable to parse than CSV/XLSX (pdfjs only gives us positioned text runs,
 * not real table structure), so this reconstructs rough table rows by
 * grouping text items into lines by their Y position, then tokenizing each
 * line by big horizontal gaps (a stand-in for column boundaries). The first
 * line that tokenizes into a recognizable Date/Symbol/Quantity/Price header
 * is used as the header row; everything after it is treated as data rows,
 * same as the CSV/XLSX paths.
 */
import * as pdfjsLib from 'pdfjs-dist'
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { mapRowsToTrades, type CsvImportResult } from './genericCsvImport'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc

interface TextRun { str: string; x: number; y: number }

/** Groups text runs into lines (by Y position) and splits each line into
 * cell-like tokens wherever there's a horizontal gap wider than typical
 * inter-word spacing — the closest approximation of table columns we can
 * get without real layout info. */
function linesToRows(runs: TextRun[]): string[][] {
  const byY = new Map<number, TextRun[]>()
  for (const r of runs) {
    // Bucket by rounded Y so runs on the same visual line group together
    // even with tiny sub-pixel differences.
    const key = Math.round(r.y)
    const bucket = byY.get(key) ?? []
    bucket.push(r)
    byY.set(key, bucket)
  }
  const rows: string[][] = []
  for (const y of [...byY.keys()].sort((a, b) => b - a)) {
    const runsInLine = byY.get(y)!.sort((a, b) => a.x - b.x)
    const cells: string[] = []
    let cur = ''
    let lastEndX: number | null = null
    for (const run of runsInLine) {
      if (lastEndX !== null && run.x - lastEndX > 8) {
        if (cur.trim()) cells.push(cur.trim())
        cur = ''
      }
      cur += run.str
      lastEndX = run.x + run.str.length * 4 // rough width estimate
    }
    if (cur.trim()) cells.push(cur.trim())
    if (cells.length > 0) rows.push(cells)
  }
  return rows
}

export async function parsePdfTrades(file: File): Promise<CsvImportResult> {
  const buf = await file.arrayBuffer()
  const doc = await pdfjsLib.getDocument({ data: buf }).promise

  const allRows: string[][] = []
  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum)
    const content = await page.getTextContent()
    const runs: TextRun[] = (content.items as Array<{ str?: string; transform?: number[] }>)
      .filter((item): item is { str: string; transform: number[] } => !!item.str && item.str.trim().length > 0 && !!item.transform)
      .map(item => ({ str: item.str, x: item.transform[4], y: item.transform[5] }))
    allRows.push(...linesToRows(runs))
  }

  if (allRows.length < 2) throw new Error(`Couldn't extract any table-like rows from "${file.name}".`)

  // Find the first row that looks like a header (mapRowsToTrades will throw
  // if it can't map required columns) and treat everything after it as data.
  for (let i = 0; i < allRows.length - 1; i++) {
    try {
      return mapRowsToTrades(allRows[i], allRows.slice(i + 1))
    } catch {
      continue
    }
  }

  throw new Error(
    `Couldn't find a recognizable Date/Symbol/Quantity/Price header row in "${file.name}". ` +
    `PDF table extraction is best-effort — try exporting as CSV or XLSX instead if this keeps failing.`,
  )
}
