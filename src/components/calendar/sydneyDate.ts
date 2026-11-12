import { sydneyClock } from '../../services/flexSchedule'

/** Calendar date in Australia/Sydney, `YYYY-MM-DD`.
 *
 * `Date.toISOString().slice(0, 10)` is the UTC date. Through a Sydney
 * morning (UTC+10/11) that is still the previous day, so the calendar
 * outlined yesterday. Trading day and "today" follow Sydney, same as the
 * Flex schedule and the realised-FY cutoff. */
export function sydneyTodayYMD(now = new Date()): string {
  return sydneyClock(now).ymd
}

/** Year and 0-indexed month of the Sydney calendar date. */
export function sydneyYearMonth(now = new Date()): { year: number; month: number } {
  const ymd = sydneyTodayYMD(now)
  return { year: Number(ymd.slice(0, 4)), month: Number(ymd.slice(5, 7)) - 1 }
}

/** `YYYY-MM-DD` from a Date's own calendar fields.
 *
 * Week rows are built with `new Date(year, month, day)`, which is a local
 * calendar date. `toISOString()` then rewrites that instant as a UTC date,
 * so in Australia/Sydney (and any zone ahead of UTC) Monday midnight becomes
 * the previous Sunday. Weekly P&L, expiry notes, and the current-week
 * marker all key off these strings, so they have to stay calendar dates. */
export function calendarYMD(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
