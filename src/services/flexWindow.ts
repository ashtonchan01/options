/**
 * Date windows for Flex backfill.
 *
 * A live Flex query is at most 365 days. From 18 Oct 2026 that window starts
 * around 18 Oct 2025 and misses 20 Aug–17 Oct 2025 of FY2025-26, which is
 * where the early MSTR and NVDA assignments sit. IBKR SendRequest accepts
 * `fd` and `td` together (YYYYMMDD, max 365 days, not combined with period
 * `p`). Each sync therefore fetches the query's own window first, then any
 * older uncovered stretch back to the first reconciled FY, in chunks of at
 * most 365 days.
 *
 * History before 1 Jul 2025 is not requested. Future FYs fall inside the
 * rolling window once they start, and merge keeps trades outside each
 * window, so FY2026-27 onward does not need its own backfill.
 */
export const RECONCILED_FY_START = '20250701'
const CHUNK_DAYS = 365

export function ymdAdd(ymd: string, days: number): string {
  const y = Number(ymd.slice(0, 4))
  const m = Number(ymd.slice(4, 6))
  const d = Number(ymd.slice(6, 8))
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + days)
  const yy = dt.getUTCFullYear()
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(dt.getUTCDate()).padStart(2, '0')
  return `${yy}${mm}${dd}`
}

export function inclusiveDays(fromDate: string, toDate: string): number {
  const start = Date.UTC(Number(fromDate.slice(0, 4)), Number(fromDate.slice(4, 6)) - 1, Number(fromDate.slice(6, 8)))
  const end = Date.UTC(Number(toDate.slice(0, 4)), Number(toDate.slice(4, 6)) - 1, Number(toDate.slice(6, 8)))
  return Math.round((end - start) / 86400000) + 1
}

/**
 * Chunks covering [RECONCILED_FY_START, the day before `fromDate`], newest
 * first. Empty when the primary window already reaches that date, or when
 * `fromDate` is missing. Each chunk is at most 365 days, inclusive.
 */
export function uncoveredFlexRanges(fromDate: string | undefined): { fromDate: string; toDate: string }[] {
  if (!fromDate || !/^\d{8}$/.test(fromDate) || fromDate <= RECONCILED_FY_START) return []
  const out: { fromDate: string; toDate: string }[] = []
  let toDate = ymdAdd(fromDate, -1)
  while (toDate >= RECONCILED_FY_START) {
    let fd = ymdAdd(toDate, -(CHUNK_DAYS - 1))
    if (fd < RECONCILED_FY_START) fd = RECONCILED_FY_START
    out.push({ fromDate: fd, toDate })
    if (fd === RECONCILED_FY_START) break
    toDate = ymdAdd(fd, -1)
  }
  return out
}

/**
 * Replace trades inside [fromDate, toDate] with `incoming`. Trades dated
 * before `fromDate`, and trades dated after `toDate` when a `toDate` is
 * given, stay. Returns null when there is no window — the caller unions
 * instead, because a CSV import cannot say what it covers.
 *
 * `toDate` is what makes a backfill safe. Without it, merging an older
 * window would delete every trade on or after that window's start, including
 * the newer primary sync.
 */
export function replaceTradeWindow<T extends { tradeDate: string }>(
  existing: T[],
  incoming: T[],
  fromDate?: string,
  toDate?: string,
): T[] | null {
  if (!fromDate) return null
  const before = existing.filter(t => t.tradeDate < fromDate)
  const after = toDate ? existing.filter(t => t.tradeDate > toDate) : []
  return [...before, ...incoming, ...after]
}
