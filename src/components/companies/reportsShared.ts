/**
 * Shared helpers between the two Reports pages — Company P&L
 * (CompanyPnlView) and Monthly Income by Strategy (MonthlyIncomeView).
 * Both used to be one page (CompaniesView); split apart per request, but
 * the financial-year bucketing and formatting logic is identical, so it
 * lives here instead of being duplicated.
 */

/** IBKR dates come as raw "YYYYMMDD" (no dashes) — plain string comparison against
 * another YYYYMMDD string sorts correctly without needing to parse a Date at all. */
export function normalizeDateStr(s: string): string {
  return /^\d{8}$/.test(s) ? s : s.replace(/-/g, '')
}

export function fmtDollar(n: number): string {
  const sign = n < 0 ? '-' : ''
  return `${sign}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
export function pnlColor(n: number) { return n > 0 ? '#10b981' : n < 0 ? '#ef4444' : 'var(--text-4)' }

/** Australian financial year (1 Jul – 30 Jun) that a YYYYMMDD date falls in,
 * keyed by its starting calendar year (e.g. 1 Jul 2025 – 30 Jun 2026 is
 * "fy2526", key "2025"). Computed from the actual dates present in the data
 * rather than a hardcoded pair, so older financial years automatically get
 * their own tab instead of being silently folded into "All Time". */
export function fyOf(dateStr: string): { key: string; label: string; startYear: number } {
  const d = normalizeDateStr(dateStr)
  const year = parseInt(d.slice(0, 4), 10)
  const month = parseInt(d.slice(4, 6), 10)
  const startYear = month >= 7 ? year : year - 1
  const key = String(startYear)
  const label = `FY ${startYear}/${String((startYear + 1) % 100).padStart(2, '0')}`
  return { key, label, startYear }
}

export function currentFyKey(): string {
  const now = new Date()
  return fyOf(`${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`).key
}

export const STRAT_ORDER = [
  'shares', 'leap', 'put_spread', 'spx', 'csp', 'covered_calls',
  'rotation', 'ptos', 'dcas', 'profit_taking', 'lilo', 'arb_cloud', 'tabi', 'forex', 'assignment',
]
export const STRAT_LABEL: Record<string, string> = {
  shares: 'Shares', leap: 'LEAP', put_spread: 'BPS', spx: 'SPX', csp: 'CSP', covered_calls: 'CC',
  rotation: 'Rotation', ptos: 'PTOS', dcas: 'DCAs', profit_taking: 'PT', lilo: 'LILO',
  arb_cloud: 'Arb Cloud', tabi: 'TABI', forex: 'FX', assignment: 'Assignment', unlabelled: 'Unlabelled',
}
export function stratLabel(s: string) { return STRAT_LABEL[s] ?? s }
export function stratRank(s: string) {
  const i = STRAT_ORDER.indexOf(s)
  return i === -1 ? STRAT_ORDER.length : i
}
export function monthKey(dateStr: string): string {
  const d = normalizeDateStr(dateStr)
  return `${d.slice(0, 4)}-${d.slice(4, 6)}`
}
export function fmtMonth(m: string): string {
  const [y, mo] = m.split('-')
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${MONTHS[parseInt(mo, 10) - 1] ?? mo} ${y}`
}
