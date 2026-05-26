/**
 * CBOE / US equity market holidays — computed algorithmically.
 * No hardcoded dates. Works for any year.
 *
 * Rules follow NYSE/CBOE holiday schedule:
 *  - New Year's Day (Jan 1)
 *  - MLK Jr. Day (3rd Monday in January)
 *  - Presidents' Day (3rd Monday in February)
 *  - Good Friday (Friday before Easter)
 *  - Memorial Day (last Monday in May)
 *  - Juneteenth (June 19)
 *  - Independence Day (July 4)
 *  - Labor Day (1st Monday in September)
 *  - Thanksgiving (4th Thursday in November)
 *  - Christmas Day (December 25)
 *
 * When a holiday falls on Saturday → observed Friday.
 * When a holiday falls on Sunday  → observed Monday.
 */

// ─── Date helpers ────────────────────────────────────────────────────────────

function pad(n: number): string { return String(n).padStart(2, '0') }
function ymd(y: number, m: number, d: number): string { return `${y}-${pad(m)}-${pad(d)}` }

/** Adjust fixed-date holidays for weekends */
function observed(y: number, m: number, d: number): string {
  const dow = new Date(y, m - 1, d).getDay() // 0=Sun, 6=Sat
  if (dow === 6) return ymd(y, m, d - 1)     // Sat → Friday
  if (dow === 0) return ymd(y, m, d + 1)     // Sun → Monday
  return ymd(y, m, d)
}

/** Nth weekday of a month (e.g. 3rd Monday). weekday: 0=Sun…6=Sat */
function nthWeekday(y: number, m: number, n: number, weekday: number): string {
  let count = 0
  for (let d = 1; d <= 31; d++) {
    const dt = new Date(y, m - 1, d)
    if (dt.getMonth() !== m - 1) break
    if (dt.getDay() === weekday) {
      count++
      if (count === n) return ymd(y, m, d)
    }
  }
  return ymd(y, m, 1) // fallback
}

/** Last weekday of a month */
function lastWeekday(y: number, m: number, weekday: number): string {
  const daysInMonth = new Date(y, m, 0).getDate() // m is 1-indexed here
  for (let d = daysInMonth; d >= 1; d--) {
    if (new Date(y, m - 1, d).getDay() === weekday) return ymd(y, m, d)
  }
  return ymd(y, m, 1)
}

/**
 * Easter date using the Anonymous Gregorian algorithm (Computus).
 * Returns [month, day] for the given year.
 */
function easter(y: number): [number, number] {
  const a = y % 19
  const b = Math.floor(y / 100)
  const c = y % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return [month, day]
}

/** Good Friday = 2 days before Easter Sunday */
function goodFriday(y: number): string {
  const [em, ed] = easter(y)
  const easterDate = new Date(y, em - 1, ed)
  easterDate.setDate(easterDate.getDate() - 2)
  return ymd(easterDate.getFullYear(), easterDate.getMonth() + 1, easterDate.getDate())
}

// ─── Holiday generator ───────────────────────────────────────────────────────

export interface MarketHoliday {
  date: string // YYYY-MM-DD
  name: string
}

/** Generate all CBOE market holidays for a given year. */
export function holidaysForYear(y: number): MarketHoliday[] {
  return [
    { date: observed(y, 1, 1),             name: "New Year's Day" },
    { date: nthWeekday(y, 1, 3, 1),        name: 'MLK Jr. Day' },
    { date: nthWeekday(y, 2, 3, 1),        name: "Presidents' Day" },
    { date: goodFriday(y),                  name: 'Good Friday' },
    { date: lastWeekday(y, 5, 1),           name: 'Memorial Day' },
    { date: observed(y, 6, 19),             name: 'Juneteenth' },
    { date: observed(y, 7, 4),              name: 'Independence Day' },
    { date: nthWeekday(y, 9, 1, 1),         name: 'Labor Day' },
    { date: nthWeekday(y, 11, 4, 4),        name: 'Thanksgiving' },
    { date: observed(y, 12, 25),             name: 'Christmas Day' },
  ]
}

/**
 * Build a lookup map for a range of years.
 * Default: current year ± 2 (covers 5 years).
 */
export function buildHolidayMap(yearsAround = 2): Record<string, string> {
  const now = new Date().getFullYear()
  const map: Record<string, string> = {}
  for (let y = now - yearsAround; y <= now + yearsAround; y++) {
    for (const h of holidaysForYear(y)) {
      map[h.date] = h.name
    }
  }
  return map
}

/** Quick lookup: date string → holiday name or undefined */
export const HOLIDAY_MAP: Record<string, string> = buildHolidayMap()
