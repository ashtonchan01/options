/**
 * Sydney Flex schedule, shared by the open-app hook and /api/flex-sync.
 * Sunday and Monday are skipped. Other days: hourly from 09:00 through 15:00,
 * then every 15 minutes. Account index staggers the minute (0, 1, 2, …).
 */
import { holidaysForYear } from './usHolidays.js'

const SYDNEY = 'Australia/Sydney'
const NEW_YORK = 'America/New_York'
const WEEKDAY = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
const BUILTIN_KEYS = ['PERSONAL', 'BUSINESS']

export function civilClock(now, timeZone) {
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
  const get = type => parts.find(p => p.type === type)?.value ?? ''
  const hour = Number(get('hour'))
  return {
    ymd: `${get('year')}-${get('month')}-${get('day')}`,
    weekday: WEEKDAY[get('weekday')] ?? 0,
    hour: hour === 24 ? 0 : hour,
    minute: Number(get('minute')),
  }
}

export function sydneyClock(now) {
  return civilClock(now, SYDNEY)
}

export function isFlexScheduleDay(clock) {
  return clock.weekday !== 0 && clock.weekday !== 1
}

export function isSlotMinute(clock, staggerMinutes) {
  if (!isFlexScheduleDay(clock) || clock.hour < 9) return false
  const stagger = ((staggerMinutes % 10) + 10) % 10
  if (clock.hour < 15) return clock.minute === stagger
  const delta = clock.minute - stagger
  return delta >= 0 && delta % 15 === 0
}

export function slotId(clock) {
  const hh = String(clock.hour).padStart(2, '0')
  const mm = String(clock.minute).padStart(2, '0')
  return `${clock.ymd}T${hh}:${mm}`
}

export function latestSlotId(now, staggerMinutes) {
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

export function nextSlotTime(now, staggerMinutes) {
  for (let i = 1; i <= 60 * 24 * 4; i++) {
    const next = new Date(now.getTime() + i * 60_000)
    if (isSlotMinute(sydneyClock(next), staggerMinutes)) return next
  }
  return new Date(now.getTime() + 24 * 60 * 60_000)
}

export function formatSydneyHM(now) {
  const clock = sydneyClock(now)
  return `${String(clock.hour).padStart(2, '0')}:${String(clock.minute).padStart(2, '0')}`
}

export function waitingForStatementNote(now, staggerMinutes) {
  return `Waiting for IBKR statement — next check ${formatSydneyHM(nextSlotTime(now, staggerMinutes))}`
}

function addUtcDays(ymd, days) {
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + days))
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(dt.getUTCDate()).padStart(2, '0')
  return `${dt.getUTCFullYear()}-${mm}-${dd}`
}

function weekdayOfYmd(ymd) {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

function defaultUsHoliday(ymd) {
  const year = Number(ymd.slice(0, 4))
  return holidaysForYear(year).some(h => h.date === ymd)
}

export function expectedUsTradingDay(now, isHoliday) {
  const holiday = isHoliday ?? defaultUsHoliday
  const ny = civilClock(now, NEW_YORK)
  let ymd = ny.hour * 60 + ny.minute < 16 * 60 ? addUtcDays(ny.ymd, -1) : ny.ymd
  while (weekdayOfYmd(ymd) === 0 || weekdayOfYmd(ymd) === 6 || holiday(ymd)) {
    ymd = addUtcDays(ymd, -1)
  }
  return ymd.replace(/-/g, '')
}

export function windowCoversTradingDay(windows, expectedYyyymmdd) {
  return (windows ?? []).some(w => w.fromDate <= expectedYyyymmdd && w.toDate >= expectedYyyymmdd)
}

/**
 * How long a won claim keeps the other caller from sending the same Flex
 * request. Longer than one Vercel invocation, shorter than the next slot.
 */
export const CLAIM_LEASE_MS = 90_000

export function claimIsLive(record, now) {
  const until = Date.parse(record?.claimUntil ?? '')
  return Number.isFinite(until) && until > now.getTime()
}

/**
 * Whether this caller may mark the slot in-flight. The cron UPDATE uses the
 * same three checks: not already finished today, not already tried, and no
 * live claim for this slot.
 */
export function claimAllowed(record, decision, now) {
  const rec = record ?? {}
  if (!decision?.slot || !decision?.sydneyDate) return false
  if (rec.doneSydneyDate === decision.sydneyDate) return false
  if (rec.lastSlotId === decision.slot) return false
  if (rec.claimSlotId === decision.slot && claimIsLive(rec, now)) return false
  return true
}

export function scheduleWithClaim(record, decision, now, leaseMs = CLAIM_LEASE_MS) {
  return {
    ...(record ?? {}),
    claimSlotId: decision.slot,
    claimUntil: new Date(now.getTime() + leaseMs).toISOString(),
  }
}

/**
 * Whether this account should be fetched on this cron tick.
 * `record` is the last slot already tried and the Sydney date already finished.
 */
export function cronDecision(now, index, record, windows) {
  const today = sydneyClock(now).ymd
  const rec = record ?? {}
  if (rec.doneSydneyDate === today) return { action: 'skip', reason: 'done' }
  const expected = expectedUsTradingDay(now)
  if (windowCoversTradingDay(windows, expected)) {
    return { action: 'skip', reason: 'covered', doneSydneyDate: today }
  }
  const slot = latestSlotId(now, index)
  if (!slot) return { action: 'skip', reason: 'off-hours' }
  if (slot === rec.lastSlotId) return { action: 'skip', reason: 'already-tried' }
  if (slot === rec.claimSlotId && claimIsLive(rec, now)) {
    return { action: 'skip', reason: 'in-flight', claimUntil: rec.claimUntil }
  }
  return {
    action: 'sync',
    slot,
    expected,
    sydneyDate: today,
    waitingNote: waitingForStatementNote(now, index),
  }
}

/** First account whose decision is sync. One fetch per invocation. */
export function pickDueAccount(now, accounts) {
  for (const account of accounts) {
    const decision = cronDecision(now, account.index, account.record, account.windows)
    if (decision.action === 'sync') return { account, decision }
  }
  return null
}

/** Slot is consumed either way. The Sydney day is done only when the statement covers it. */
export function scheduleAfterAttempt(record, decision, result) {
  const next = { ...(record ?? {}), lastSlotId: decision.slot }
  delete next.claimSlotId
  delete next.claimUntil
  if (result?.ok && result.toDate && result.toDate >= decision.expected) {
    next.doneSydneyDate = decision.sydneyDate
  }
  return next
}

export function flexWindowFromXml(xml) {
  if (!xml) return null
  const tag = xml.match(/<FlexStatement\b[^>]*>/i)
  if (!tag) return null
  const fromDate = tag[0].match(/\bfromDate="(\d{8})"/i)?.[1]
  const toDate = tag[0].match(/\btoDate="(\d{8})"/i)?.[1]
  if (!fromDate || !toDate) return null
  return { fromDate, toDate }
}

/** PERSONAL and BUSINESS, plus any extra slugs in FLEX_ACCOUNTS. Missing pairs are omitted. */
export function configuredFlexAccounts(env = process.env) {
  const extra = String(env.FLEX_ACCOUNTS ?? '')
    .split(',')
    .map(s => s.trim().toUpperCase())
    .filter(Boolean)
  const keys = [...BUILTIN_KEYS]
  for (const key of extra) {
    if (!keys.includes(key)) keys.push(key)
  }
  const out = []
  keys.forEach((envKey, index) => {
    const token = env[`FLEX_TOKEN_${envKey}`]
    const query = env[`FLEX_QUERY_${envKey}`]
    if (!token || !query) return
    out.push({ key: envKey.toLowerCase(), envKey, token, query, index })
  })
  return out
}
