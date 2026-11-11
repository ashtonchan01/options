/** NYSE/CBOE holidays. Same rules as src/data/marketHolidays.ts so the cron and the app agree. */

function pad(n) { return String(n).padStart(2, '0') }
function ymd(y, m, d) { return `${y}-${pad(m)}-${pad(d)}` }

function observed(y, m, d) {
  const dow = new Date(y, m - 1, d).getDay()
  if (dow === 6) return ymd(y, m, d - 1)
  if (dow === 0) return ymd(y, m, d + 1)
  return ymd(y, m, d)
}

function nthWeekday(y, m, n, weekday) {
  let count = 0
  for (let d = 1; d <= 31; d++) {
    const dt = new Date(y, m - 1, d)
    if (dt.getMonth() !== m - 1) break
    if (dt.getDay() === weekday) {
      count++
      if (count === n) return ymd(y, m, d)
    }
  }
  return ymd(y, m, 1)
}

function lastWeekday(y, m, weekday) {
  const daysInMonth = new Date(y, m, 0).getDate()
  for (let d = daysInMonth; d >= 1; d--) {
    if (new Date(y, m - 1, d).getDay() === weekday) return ymd(y, m, d)
  }
  return ymd(y, m, 1)
}

function easter(y) {
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

function goodFriday(y) {
  const [em, ed] = easter(y)
  const easterDate = new Date(y, em - 1, ed)
  easterDate.setDate(easterDate.getDate() - 2)
  return ymd(easterDate.getFullYear(), easterDate.getMonth() + 1, easterDate.getDate())
}

export function holidaysForYear(y) {
  return [
    { date: observed(y, 1, 1), name: "New Year's Day" },
    { date: nthWeekday(y, 1, 3, 1), name: 'MLK Jr. Day' },
    { date: nthWeekday(y, 2, 3, 1), name: "Presidents' Day" },
    { date: goodFriday(y), name: 'Good Friday' },
    { date: lastWeekday(y, 5, 1), name: 'Memorial Day' },
    { date: observed(y, 6, 19), name: 'Juneteenth' },
    { date: observed(y, 7, 4), name: 'Independence Day' },
    { date: nthWeekday(y, 9, 1, 1), name: 'Labor Day' },
    { date: nthWeekday(y, 11, 4, 4), name: 'Thanksgiving' },
    { date: observed(y, 12, 25), name: 'Christmas Day' },
  ]
}
