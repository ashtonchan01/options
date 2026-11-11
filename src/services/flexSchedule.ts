/**
 * When an open app should pull IBKR Flex, in Australia/Sydney.
 * Sunday and Monday are skipped: the US session that would feed a new
 * statement has not closed. Other days start at 09:00, hourly until 15:00,
 * then every 15 minutes. Pure functions so the clock can be tested without
 * a timer.
 */
import { holidaysForYear } from '../data/marketHolidays'

const SYDNEY = 'Australia/Sydney'
const NEW_YORK = 'America/New_York'

export interface CivilClock {
  /** YYYY-MM-DD in that zone. */
  ymd: string
  /** 0 Sunday … 6 Saturday. */
  weekday: number
  hour: number
  minute: number
}

export interface FlexWindowLike {
  fromDate: string
  toDate: string
}

const WEEKDAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

export function civilClock(now: Date, timeZone: string): CivilClock {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  }).formatToParts(now)
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)?.value ?? ''
  const hour = Number(get('hour'))
  return {
    ymd: `${get('year')}-${get('month')}-${get('day')}`,
    weekday: WEEKDAY[get('weekday')] ?? 0,
    // Some engines report midnight as 24.
    hour: hour === 24 ? 0 : hour,
    minute: Number(get('minute')),
  }
}

export function sydneyClock(now: Date): CivilClock {
  return civilClock(now, SYDNEY)
}

/** No Flex check on Sunday or Monday in Sydney. */
export function isFlexScheduleDay(clock: CivilClock): boolean {
  return clock.weekday !== 0 && clock.weekday !== 1
}

/**
 * True when this clock minute is a check for the given stagger.
 * Stagger 0 fires at :00 (and :15/:30/:45 after 15:00). Stagger 1 fires a minute later.
 */
export function isSlotMinute(clock: CivilClock, staggerMinutes: number): boolean {
  if (!isFlexScheduleDay(clock) || clock.hour < 9) return false
  const stagger = ((staggerMinutes % 10) + 10) % 10
  if (clock.hour < 15) return clock.minute === stagger
  const delta = clock.minute - stagger
  return delta >= 0 && delta % 15 === 0
}

export function slotId(clock: CivilClock): string {
  const hh = String(clock.hour).padStart(2, '0')
  const mm = String(clock.minute).padStart(2, '0')
  return `${clock.ymd}T${hh}:${mm}`
}

/** Latest check minute today, at or before `now`. Null on Sunday, Monday, and before 09:00. */
export function latestSlotId(now: Date, staggerMinutes: number): string | null {
  const today = sydneyClock(now)
  if (!isFlexScheduleDay(today)) return null
  for (let i = 0; i <= 60 * 20; i++) {
    const earlier = new Date(now.getTime() - i * 60_000)
    const c = sydneyClock(earlier)
    if (c.ymd !== today.ymd) return null
    if (isSlotMinute(c, staggerMinutes)) return slotId(c)
  }
  return null
}

/** The next check strictly after `now`. */
export function nextSlotTime(now: Date, staggerMinutes: number): Date {
  for (let i = 1; i <= 60 * 24 * 4; i++) {
    const next = new Date(now.getTime() + i * 60_000)
    if (isSlotMinute(sydneyClock(next), staggerMinutes)) return next
  }
  return new Date(now.getTime() + 24 * 60 * 60_000)
}

export function formatSydneyHM(now: Date): string {
  const clock = sydneyClock(now)
  return `${String(clock.hour).padStart(2, '0')}:${String(clock.minute).padStart(2, '0')}`
}

export function waitingForStatementNote(now: Date, staggerMinutes: number): string {
  return `Waiting for IBKR statement — next check ${formatSydneyHM(nextSlotTime(now, staggerMinutes))}`
}

function addUtcDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + days))
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(dt.getUTCDate()).padStart(2, '0')
  return `${dt.getUTCFullYear()}-${mm}-${dd}`
}

function weekdayOfYmd(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

/**
 * Most recent US equity session that has already closed (16:00 New York),
 * skipping weekends and NYSE holidays. Returned as YYYYMMDD.
 */
export function expectedUsTradingDay(now: Date, isHoliday?: (ymd: string) => boolean): string {
  const holiday = isHoliday ?? defaultUsHoliday
  const ny = civilClock(now, NEW_YORK)
  let ymd = ny.hour * 60 + ny.minute < 16 * 60 ? addUtcDays(ny.ymd, -1) : ny.ymd
  while (weekdayOfYmd(ymd) === 0 || weekdayOfYmd(ymd) === 6 || holiday(ymd)) {
    ymd = addUtcDays(ymd, -1)
  }
  return ymd.replace(/-/g, '')
}

function defaultUsHoliday(ymd: string): boolean {
  const year = Number(ymd.slice(0, 4))
  return holidaysForYear(year).some(h => h.date === ymd)
}

/** The stored Flex window already includes that US session. */
export function windowCoversTradingDay(windows: FlexWindowLike[] | undefined, expectedYyyymmdd: string): boolean {
  return (windows ?? []).some(w => w.fromDate <= expectedYyyymmdd && w.toDate >= expectedYyyymmdd)
}
