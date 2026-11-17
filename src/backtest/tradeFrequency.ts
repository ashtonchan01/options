import { addCalendarDays, daysInMonth, weekday, ymd } from './calendar'
import type { BacktestParams } from './engine'

export type TradeFrequency = 'daily' | 'alternate' | 'weekly' | 'monthly'
/** 1 = first week … 4 = fourth week; 5 = last week of month. */
export type MonthWeek = 1 | 2 | 3 | 4 | 5

export const TRADE_FREQUENCIES: { id: TradeFrequency; label: string }[] = [
  { id: 'daily', label: 'Every day' },
  { id: 'alternate', label: 'Every other day' },
  { id: 'weekly', label: 'Once a week' },
  { id: 'monthly', label: 'Once a month' },
]

export const MONTH_WEEKS: { id: MonthWeek; label: string }[] = [
  { id: 1, label: '1st' },
  { id: 2, label: '2nd' },
  { id: 3, label: '3rd' },
  { id: 4, label: '4th' },
  { id: 5, label: 'Last' },
]

const WEEKDAY_NAMES = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'] as const

function mondayOfWeek(iso: string): string {
  const w = weekday(iso)
  const offset = w === 0 ? 6 : w - 1
  return addCalendarDays(iso, -offset)
}

/** Calendar date for the Nth weekday in a month (dow 1=Mon … 5=Fri). */
export function nthWeekdayInMonth(year: number, month: number, week: MonthWeek, dow: number): string | null {
  if (week === 5) {
    for (let d = daysInMonth(year, month); d >= 1; d--) {
      const iso = ymd(year, month, d)
      if (weekday(iso) === dow) return iso
    }
    return null
  }
  let count = 0
  for (let d = 1; d <= daysInMonth(year, month); d++) {
    const iso = ymd(year, month, d)
    if (weekday(iso) !== dow) continue
    count++
    if (count === week) return iso
  }
  return null
}

/** Next SPX session on or after `anchor` (holiday roll-forward). */
export function sessionOnOrAfter(anchor: string, sessions: readonly string[]): string | null {
  let lo = 0
  let hi = sessions.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (sessions[mid] >= anchor) {
      ans = mid
      hi = mid - 1
    } else lo = mid + 1
  }
  return ans >= 0 ? sessions[ans] : null
}

export function buildMonthlyEntryDates(
  sessions: readonly string[],
  start: string,
  end: string,
  monthWeek: MonthWeek,
  dow: number,
): Set<string> {
  const out = new Set<string>()
  const [sy, sm] = start.split('-').map(Number)
  const [ey, em] = end.split('-').map(Number)
  let y = sy
  let m = sm
  while (y < ey || (y === ey && m <= em)) {
    const anchor = nthWeekdayInMonth(y, m, monthWeek, dow)
    if (anchor) {
      const trade = sessionOnOrAfter(anchor, sessions)
      if (trade && trade >= start && trade <= end) out.add(trade)
    }
    m++
    if (m > 12) {
      m = 1
      y++
    }
  }
  return out
}

export interface FrequencyGate {
  alternateIndex: number
  lastWeeklyMonday: string | null
  monthlyEntries: Set<string> | null
}

export function createFrequencyGate(
  sessions: readonly string[],
  params: BacktestParams,
  start: string,
  end: string,
): FrequencyGate {
  const freq = params.tradeFrequency ?? 'daily'
  return {
    alternateIndex: -1,
    lastWeeklyMonday: null,
    monthlyEntries: freq === 'monthly'
      ? buildMonthlyEntryDates(sessions, start, end, params.frequencyMonthWeek, params.frequencyWeekday)
      : null,
  }
}

export function frequencyAllowsEntry(
  date: string,
  entryDow: number,
  params: BacktestParams,
  weekdays: Set<number>,
  gate: FrequencyGate,
): boolean {
  const freq = params.tradeFrequency ?? 'daily'

  if (freq === 'weekly') {
    if (entryDow !== params.frequencyWeekday) return false
  } else if (freq === 'monthly') {
    return gate.monthlyEntries?.has(date) ?? false
  } else if (!weekdays.has(entryDow)) {
    return false
  }

  switch (freq) {
    case 'daily':
      return true
    case 'alternate': {
      gate.alternateIndex++
      return gate.alternateIndex % 2 === 0
    }
    case 'weekly': {
      const mon = mondayOfWeek(date)
      if (gate.lastWeeklyMonday === mon) return false
      gate.lastWeeklyMonday = mon
      return true
    }
    default:
      return true
  }
}

export function frequencySummary(p: BacktestParams): string | null {
  const freq = p.tradeFrequency ?? 'daily'
  const wd = WEEKDAY_NAMES[p.frequencyWeekday] ?? 'Mon'
  if (freq === 'daily') return null
  if (freq === 'alternate') return 'every other day'
  if (freq === 'weekly') return `weekly · ${wd}`
  const wk = MONTH_WEEKS.find(w => w.id === p.frequencyMonthWeek)?.label ?? '1st'
  return `monthly · ${wk} ${wd}`
}