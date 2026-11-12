/**
 * Calendar "today" is the Australia/Sydney calendar date, and multi-year
 * week bounds stay on calendar dates instead of UTC instants.
 * Run with: npm test
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { activityPlacement } from '../src/components/calendar/activityLayout'
import { calendarYMD, sydneyTodayYMD, sydneyYearMonth } from '../src/components/calendar/sydneyDate'

let failed = 0
function check(name: string, ok: boolean, detail?: string) {
  if (ok) console.log(`ok  ${name}`)
  else {
    failed++
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

// Thursday 12 Nov 2026 09:41 Australia/Sydney = Wednesday 11 Nov 2026 22:41 UTC.
// This is the morning the month grid outlined the 11th.
const sydneyMorning = new Date('2026-11-11T22:41:00Z')
check('sydney morning is 12 Nov', sydneyTodayYMD(sydneyMorning) === '2026-11-12', sydneyTodayYMD(sydneyMorning))
check('utc iso of that instant is still the 11th', sydneyMorning.toISOString().slice(0, 10) === '2026-11-11')
check('month cursor is November 2026', (() => {
  const { year, month } = sydneyYearMonth(sydneyMorning)
  return year === 2026 && month === 10
})())

// AEST (UTC+10): 12 Jul 2026 09:41 Sydney = 11 Jul 2026 23:41 UTC.
const winterMorning = new Date('2026-07-11T23:41:00Z')
check('sydney winter morning is 12 Jul', sydneyTodayYMD(winterMorning) === '2026-07-12', sydneyTodayYMD(winterMorning))

// 1 Jan 2027 09:30 Sydney = 31 Dec 2026 22:30 UTC. The open month must be January.
const newYearMorning = new Date('2026-12-31T22:30:00Z')
check('new year morning is 1 Jan 2027', sydneyTodayYMD(newYearMorning) === '2027-01-01', sydneyTodayYMD(newYearMorning))
check('new year month cursor is January 2027', (() => {
  const { year, month } = sydneyYearMonth(newYearMorning)
  return year === 2027 && month === 0
})())

// Later the same Sydney day, UTC has caught up. Do not roll forward an extra day.
const sydneyEvening = new Date('2026-11-12T10:00:00Z')
check('sydney evening is still 12 Nov', sydneyTodayYMD(sydneyEvening) === '2026-11-12', sydneyTodayYMD(sydneyEvening))

// In a zone ahead of UTC, toISOString() dates the local Sunday as Saturday,
// so a Sydney Sunday morning falls outside the shifted week and the next
// week lights up instead. calendarYMD keeps the Sunday inside its own week.
const root = fileURLToPath(new URL('..', import.meta.url))
const tz = spawnSync(process.execPath, [
  '--import', 'tsx',
  '--input-type=module',
  '-e',
  `
    import { calendarYMD, sydneyTodayYMD } from './src/components/calendar/sydneyDate.ts'
    const sundayMorning = new Date('2026-11-14T22:00:00Z')
    const today = sydneyTodayYMD(sundayMorning)
    const monday = new Date(2026, 10, 9)
    const sunday = new Date(monday)
    sunday.setDate(sunday.getDate() + 6)
    const start = calendarYMD(monday)
    const end = calendarYMD(sunday)
    const shiftedStart = monday.toISOString().slice(0, 10)
    const shiftedEnd = sunday.toISOString().slice(0, 10)
    const inFixed = today >= start && today <= end
    const inShifted = today >= shiftedStart && today <= shiftedEnd
    console.log(JSON.stringify({ today, start, end, shiftedStart, shiftedEnd, inFixed, inShifted }))
  `,
], {
  cwd: root,
  env: { ...process.env, TZ: 'Australia/Sydney' },
  encoding: 'utf8',
})
check('sydney tz child ran', tz.status === 0, tz.stderr || tz.stdout)
if (tz.status === 0) {
  const row = JSON.parse(tz.stdout.trim().split('\n').pop() ?? '{}') as {
    today: string
    start: string
    end: string
    shiftedEnd: string
    inFixed: boolean
    inShifted: boolean
  }
  check('sunday morning sydney date', row.today === '2026-11-15', JSON.stringify(row))
  check('week bounds are calendar dates', row.start === '2026-11-09' && row.end === '2026-11-15', JSON.stringify(row))
  check('utc shift drops sunday off the week', row.shiftedEnd === '2026-11-14', JSON.stringify(row))
  check('calendar bounds include sunday', row.inFixed === true, JSON.stringify(row))
  check('shifted bounds miss sunday', row.inShifted === false, JSON.stringify(row))
}

check('calendarYMD reads local fields', calendarYMD(new Date(2026, 10, 12)) === '2026-11-12')

// A window the 16:9 month already fills keeps All Activity in the right column.
// 1100px wide, 640 tall: the month beside a 300px column is 800×450, leaving
// only 190px — not enough to move the list under it.
const typical = activityPlacement(1100, 640, false)
check('typical window keeps the right column', typical.stacked === false, JSON.stringify(typical))

// Taller window: the same width leaves 360px under the 16:9 month. The list
// moves under it, capped so the month can grow past that 16:9 height.
const tall = activityPlacement(1100, 810, false)
check('tall window moves activity under the month', tall.stacked === true, JSON.stringify(tall))
check('stacked list is capped at 300', tall.activityHeight === 300, JSON.stringify(tall))

// Just tall enough to stack: the list takes the band, and the month keeps
// the 16:9 height while gaining the column's width.
const just = activityPlacement(1100, 670, false)
check('220px of leftover stacks', just.stacked === true && just.activityHeight === 220, JSON.stringify(just))

// Shrinking back through the hysteresis band stays stacked, then returns
// to the column once the band is no longer useful.
const hold = activityPlacement(1100, 640, true)
check('hysteresis holds the stacked layout', hold.stacked === true, JSON.stringify(hold))
const back = activityPlacement(1100, 620, true)
check('short band returns activity to the side', back.stacked === false, JSON.stringify(back))

if (failed) {
  console.error(`${failed} failed`)
  process.exit(1)
}
console.log('calendar today ok')
