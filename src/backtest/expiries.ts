/**
 * Real SPX / SPXW expiration dates.
 *
 * DTE is a count of NYSE sessions (weekends and closed days are not in the
 * session list). The target session is that many sessions after entry
 * (0 = the entry session). If that day is not a real expiry, we take the
 * next real expiry on or after it, and the trade row shows the actual
 * session count.
 *
 * Schedule, from Cboe:
 * - Standard monthly SPX: 3rd Friday (or the previous session when that
 *   Friday is closed). AM-settled until the PM third-Friday pilot.
 * - Friday weeklies: first expiry 2005-11-04 (Cboe IC05-138). Not listed
 *   on the standard expiration Friday; that Friday stays the monthly.
 *   AM-settled at launch. Modeled as PM SPXW from 2016-02-23 — they were
 *   PM sometime before that, so Friday 0DTE before then snaps forward.
 * - Wednesday weeklies: listed beginning 2016-02-23, expiring the Wednesday
 *   of the following week, so the first expiry is 2016-03-02. PM.
 * - Monday weeklies: first expiries 2016-08-22 and 2016-08-29. PM.
 * - Tuesday weeklies: trading began 2022-04-18, first expiry 2022-04-19. PM.
 * - Thursday weeklies: trading began 2022-05-11, first expiry 2022-05-12. PM.
 *   From that day, every session has an SPXW expiry.
 * - Third-Friday PM (SPXPM, renamed SPXW on 2017-05-01) modeled from
 *   2013-03-15, the first third Friday after the February 2013 pilot approval.
 * - Holiday rule (current SPX specifications): a holiday expiry moves to the
 *   previous session, except Monday weeklies, which move to the next session.
 *   End-of-month expiries are not added on their own; month-end counts only
 *   when that weekday already expires.
 */
import { addCalendarDays, calendarDaysBetween, daysInMonth, thirdFriday, weekday, ymd } from './calendar'

export const SPXW_SCHEDULE = {
  fridayWeekly: '2005-11-04',
  fridayWeeklyPm: '2016-02-23',
  wednesday: '2016-03-02',
  monday: '2016-08-22',
  tuesday: '2022-04-19',
  thursday: '2022-05-12',
  thirdFridayPm: '2013-03-15',
} as const

export interface ExpiryInfo {
  date: string
  settle: 'am' | 'pm'
  /** Last session the contract can still be traded. AM settles at the next open. */
  lastTrade: string
  kind: 'monthly' | 'weekly'
}

function weeklyAllowed(dow: number, iso: string): boolean {
  if (dow === 1) return iso >= SPXW_SCHEDULE.monday
  if (dow === 2) return iso >= SPXW_SCHEDULE.tuesday
  if (dow === 3) return iso >= SPXW_SCHEDULE.wednesday
  if (dow === 4) return iso >= SPXW_SCHEDULE.thursday
  if (dow === 5) return iso >= SPXW_SCHEDULE.fridayWeekly
  return false
}

export function buildExpiries(sessions: readonly string[]): ExpiryInfo[] {
  if (sessions.length === 0) return []
  const set = new Set(sessions)
  const chosen = new Map<string, ExpiryInfo>()
  const start = sessions[0]
  const end = sessions[sessions.length - 1]

  function nearby(date: string, step: -1 | 1): string | null {
    let d = addCalendarDays(date, step)
    for (let i = 0; i < 8; i++) {
      if (set.has(d)) {
        const gap = Math.abs(calendarDaysBetween(step === -1 ? d : date, step === -1 ? date : d))
        return gap <= 6 ? d : null
      }
      d = addCalendarDays(d, step)
    }
    return null
  }

  function consider(date: string, settle: 'am' | 'pm', kind: 'monthly' | 'weekly') {
    if (!set.has(date)) return
    const lastTrade = settle === 'pm' ? date : nearby(date, -1)
    if (!lastTrade) return
    const existing = chosen.get(date)
    if (!existing || (existing.settle === 'am' && settle === 'pm')) {
      chosen.set(date, { date, settle, lastTrade, kind })
    }
  }

  let y = Number(start.slice(0, 4))
  let m = Number(start.slice(5, 7))
  const endY = Number(end.slice(0, 4))
  const endM = Number(end.slice(5, 7))

  while (y < endY || (y === endY && m <= endM)) {
    const tf = thirdFriday(y, m)
    let monthly = set.has(tf) ? tf : nearby(tf, -1)
    if (monthly && Math.abs(calendarDaysBetween(monthly, tf)) > 6) monthly = null
    if (monthly) consider(monthly, monthly >= SPXW_SCHEDULE.thirdFridayPm ? 'pm' : 'am', 'monthly')

    const dim = daysInMonth(y, m)
    for (let day = 1; day <= dim; day++) {
      const iso = ymd(y, m, day)
      if (iso < start || iso > end) continue
      const dow = weekday(iso)
      if (!weeklyAllowed(dow, iso)) continue
      if (dow === 5 && iso === tf) continue
      let expiry = iso
      if (!set.has(iso)) {
        expiry = (dow === 1 ? nearby(iso, 1) : nearby(iso, -1)) ?? ''
        if (!expiry) continue
      }
      const settle: 'am' | 'pm' = dow === 5 && iso < SPXW_SCHEDULE.fridayWeeklyPm ? 'am' : 'pm'
      consider(expiry, settle, 'weekly')
    }

    m += 1
    if (m === 13) {
      m = 1
      y += 1
    }
  }

  return [...chosen.values()].sort((a, b) => (a.date < b.date ? -1 : 1))
}

export interface ResolvedExpiry {
  expiry: ExpiryInfo
  targetDate: string
  /** NYSE sessions from the entry date to the expiry date. 0 when they are the same day. */
  actualDte: number
}

/** First real expiry on or after the target session that is still tradable on entry. */
export function resolveExpiry(
  sessions: readonly string[],
  sessionIndex: ReadonlyMap<string, number>,
  expiries: readonly ExpiryInfo[],
  entry: string,
  targetDte: number,
): ResolvedExpiry | null {
  const entryIdx = sessionIndex.get(entry)
  if (entryIdx == null) return null
  const targetIdx = entryIdx + targetDte
  if (targetIdx < 0 || targetIdx >= sessions.length) return null
  const targetDate = sessions[targetIdx]

  let lo = 0
  let hi = expiries.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (expiries[mid].date < targetDate) lo = mid + 1
    else hi = mid
  }
  for (let i = lo; i < expiries.length; i++) {
    const expiry = expiries[i]
    if (expiry.lastTrade < entry) continue
    const expIdx = sessionIndex.get(expiry.date)
    if (expIdx == null) continue
    return { expiry, targetDate, actualDte: expIdx - entryIdx }
  }
  return null
}
