/**
 * Determines whether an exchange is currently open, purely from its local
 * wall-clock time (Mon–Fri, openMin–closeMin). No holiday calendar beyond
 * the US one we already track elsewhere.
 */
import { HOLIDAY_MAP } from '../data/marketHolidays'
import type { Exchange } from '../data/exchanges'

function localParts(timezone: string, now: Date): { weekday: number; minutes: number; ymd: string } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
  })
  const parts = fmt.formatToParts(now)
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? ''
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  const weekday = weekdayMap[get('weekday')] ?? 0
  let hour = parseInt(get('hour'), 10)
  if (hour === 24) hour = 0
  const minute = parseInt(get('minute'), 10)
  const ymd = `${get('year')}-${get('month')}-${get('day')}`
  return { weekday, minutes: hour * 60 + minute, ymd }
}

export function isExchangeOpen(ex: Exchange, now: Date = new Date()): boolean {
  const { weekday, minutes, ymd } = localParts(ex.timezone, now)
  if (weekday === 0 || weekday === 6) return false
  if (ex.country === 'US' && HOLIDAY_MAP[ymd]) return false
  return minutes >= ex.openMin && minutes < ex.closeMin
}
