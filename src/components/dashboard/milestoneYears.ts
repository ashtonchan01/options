/**
 * Milestone year rows. The Income tab reads these figures; it does not
 * recompute the compound path.
 */
export interface MilestoneConfig {
  startCapital: number
  targetPct: number
  taxRate: number
  numYears: number
}

export const DEFAULT_MILESTONE_CONFIG: MilestoneConfig = {
  startCapital: 462_000,
  targetPct: 30,
  taxRate: 25,
  numYears: 15,
}

export const MILESTONES = [
  { label: 'A$1M', value: 1_000_000 },
  { label: 'A$5M', value: 5_000_000 },
  { label: 'A$10M', value: 10_000_000 },
]

export const MILESTONE_CONFIG_KEY = 'options:milestone-config'
/** Baked-in start capital before it was lowered to 462,000 AUD. */
const PREVIOUS_DEFAULT_START_CAPITAL = 500_000
export const MILESTONE_START_MIGRATION_KEY = 'options:milestone-start-capital-migrated'

export const ONE_YEAR_MS = 365.25 * 24 * 3600 * 1000
/** Same month length the year-end point is placed with. */
export const MONTH_MS = ONE_YEAR_MS / 12

export function monthlyRate(pct: number): number {
  return Math.pow(1 + pct / 100, 1 / 12) - 1
}

export function addMonths(base: Date, months: number): Date {
  const d = new Date(base)
  d.setMonth(d.getMonth() + months)
  return d
}

export function monthsBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / MONTH_MS
}

export interface YearRow {
  idx: number
  startDate: Date
  endDate: Date
  /** Exact whole months this row spans — 12 for every row except the
   * first, which runs from today to the next 30 June. */
  months: number
  /** Months-from-today offset of this row's start/end. */
  tStart: number
  tEnd: number
  start: number
  /** 31 Dec inside this row, when that date falls in the row. */
  decDate: Date | null
  /** Target curve's value at that 31 Dec. AUD, same units as start capital. */
  decEnd: number | null
  /** Pre-tax compounded value at the row's end. The table's End (Target). */
  grossEnd: number
  /** Carried-forward balance: start + net P&L. Next year's start. */
  end: number
  grossPnl: number
  tax: number
  netPnl: number
  crossed: string[]
}

/** The 31 Dec that falls within [start, end). A FY span crosses one
 * calendar year-end; the first partial row may already be past it. */
function findDecEndInRange(start: Date, end: Date): Date | null {
  for (let y = start.getFullYear() - 1; y <= end.getFullYear(); y++) {
    const dec31 = new Date(y, 11, 31)
    if (dec31 >= start && dec31 < end) return dec31
  }
  return null
}

function monthIndex(d: Date): number {
  return d.getFullYear() * 12 + d.getMonth()
}

function monthIndexToDate(idx: number): Date {
  return new Date(Math.floor(idx / 12), ((idx % 12) + 12) % 12, 1)
}

/** Financial-year rows (1 Jul–30 Jun). The first row runs from today to
 * the next 30 June. Values are AUD. */
export function buildYears(cfg: MilestoneConfig, today: Date): YearRow[] {
  const r = monthlyRate(cfg.targetPct)
  const todayIdx = monthIndex(today)
  const boundaries = [todayIdx]
  let b = todayIdx + 1
  while (b % 12 !== 6) b++ // next July (month index 6 = July)
  boundaries.push(b)
  for (let i = 1; i < cfg.numYears; i++) boundaries.push(boundaries[boundaries.length - 1] + 12)

  const rows: YearRow[] = []
  let balance = cfg.startCapital
  let prevMilestonesHit = new Set<string>()
  let tCursor = 0
  for (let i = 0; i < cfg.numYears; i++) {
    const months = boundaries[i + 1] - boundaries[i]
    const start = balance
    const grossEnd = start * Math.pow(1 + r, months)
    const grossPnl = grossEnd - start
    const tax = grossPnl > 0 ? grossPnl * (cfg.taxRate / 100) : 0
    const netPnl = grossPnl - tax
    const end = start + netPnl
    const crossed: string[] = []
    for (const m of MILESTONES) {
      if (grossEnd >= m.value && !prevMilestonesHit.has(m.label)) {
        crossed.push(m.label)
        prevMilestonesHit = new Set(prevMilestonesHit).add(m.label)
      }
    }
    const rowStartDate = i === 0 ? today : monthIndexToDate(boundaries[i])
    const rowEndDate = monthIndexToDate(boundaries[i + 1])
    const decDate = findDecEndInRange(rowStartDate, rowEndDate)
    const decEnd = decDate
      ? start * Math.pow(1 + r, (decDate.getTime() - rowStartDate.getTime()) / MONTH_MS)
      : null
    rows.push({
      idx: i,
      startDate: rowStartDate,
      endDate: rowEndDate,
      months, tStart: tCursor, tEnd: tCursor + months,
      start, decDate, decEnd, grossEnd, end, grossPnl, tax, netPnl, crossed,
    })
    tCursor += months
    balance = end
  }
  return rows
}

/** Same read the Milestone page uses, including the one-time 500,000 → 462,000 start. */
export function loadMilestoneConfig(): MilestoneConfig {
  try {
    const raw = localStorage.getItem(MILESTONE_CONFIG_KEY)
    if (!raw) return { ...DEFAULT_MILESTONE_CONFIG }
    const merged = { ...DEFAULT_MILESTONE_CONFIG, ...JSON.parse(raw) } as MilestoneConfig
    const alreadyMigrated = localStorage.getItem(MILESTONE_START_MIGRATION_KEY) === '1'
    if (!alreadyMigrated && merged.startCapital === PREVIOUS_DEFAULT_START_CAPITAL) {
      return { ...merged, startCapital: DEFAULT_MILESTONE_CONFIG.startCapital }
    }
    return merged
  } catch {
    return { ...DEFAULT_MILESTONE_CONFIG }
  }
}
