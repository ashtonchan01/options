/** UTC calendar helpers. Session dates are the SPX trading days in the saved file. */

export function weekday(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

export function ymd(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

export function addCalendarDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

export function calendarDaysBetween(earlier: string, later: string): number {
  const [y1, m1, d1] = earlier.split('-').map(Number)
  const [y2, m2, d2] = later.split('-').map(Number)
  const a = Date.UTC(y1, m1 - 1, d1)
  const b = Date.UTC(y2, m2 - 1, d2)
  return Math.round((b - a) / 86_400_000)
}

/** Ordinal day count used only to turn two clock times into a year fraction. Ignores DST. */
export function clockMinutes(iso: string, minuteOfDay: number): number {
  const [y, m, d] = iso.split('-').map(Number)
  const utc = Date.UTC(y, m - 1, d)
  const epochDays = Math.round(utc / 86_400_000)
  return epochDays * 1440 + minuteOfDay
}

/** Calendar-year fraction from one ET clock time to another. VIX is quoted on a 365-day year. */
export function yearFraction(fromDate: string, fromMin: number, toDate: string, toMin: number): number {
  const minutes = clockMinutes(toDate, toMin) - clockMinutes(fromDate, fromMin)
  if (minutes <= 0) return 0
  return minutes / (365 * 24 * 60)
}

export function thirdFriday(year: number, month: number): string {
  const firstDow = weekday(ymd(year, month, 1))
  const firstFriday = 1 + ((5 - firstDow + 7) % 7)
  return ymd(year, month, firstFriday + 14)
}

/** Weekdays in [from, to], optionally dropping dates (holidays in tests). */
export function weekdaySessions(from: string, to: string, closed: readonly string[] = []): string[] {
  const skip = new Set(closed)
  const out: string[] = []
  for (let d = from; d <= to; d = addCalendarDays(d, 1)) {
    const w = weekday(d)
    if (w === 0 || w === 6 || skip.has(d)) continue
    out.push(d)
  }
  return out
}
