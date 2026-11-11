/**
 * Sydney Flex schedule: weekdays, hourly then 15-minute slots, DST, and the
 * US session a statement has to cover.
 * Run with: npm test
 */
import { holidaysForYear } from '../src/data/marketHolidays'
import {
  expectedUsTradingDay,
  isSlotMinute,
  latestSlotId,
  nextSlotTime,
  sydneyClock,
  waitingForStatementNote,
  windowCoversTradingDay,
} from '../src/services/flexSchedule'

let failed = 0
function check(name: string, ok: boolean, detail?: string) {
  if (ok) console.log(`ok  ${name}`)
  else {
    failed++
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

// AEDT (UTC+11): Tuesday 13 Jan 2026 09:00 Sydney = Monday 12 Jan 22:00 UTC.
const tue0900Aedt = new Date('2026-01-12T22:00:00Z')
// One minute earlier.
const tue0859Aedt = new Date('2026-01-12T21:59:00Z')
// AEST (UTC+10): Tuesday 14 Jul 2026 09:00 Sydney = Monday 13 Jul 23:00 UTC.
const tue0900Aest = new Date('2026-07-13T23:00:00Z')
// Sunday 15 Nov 2026 10:00 AEDT = Saturday 14 Nov 23:00 UTC.
const sun1000 = new Date('2026-11-14T23:00:00Z')
// Monday 16 Nov 2026 10:00 AEDT = Sunday 15 Nov 23:00 UTC.
const mon1000 = new Date('2026-11-15T23:00:00Z')
// Saturday 14 Nov 2026 10:00 AEDT = Friday 13 Nov 23:00 UTC.
const sat1000 = new Date('2026-11-13T23:00:00Z')
// Tuesday 10 Nov 2026 15:16 AEDT = Tuesday 10 Nov 04:16 UTC. Account stagger 1.
const tue1516 = new Date('2026-11-10T04:16:00Z')

{
  const c = sydneyClock(tue0900Aedt)
  check('January 09:00 Sydney is AEDT Tuesday', c.ymd === '2026-01-13' && c.hour === 9 && c.minute === 0 && c.weekday === 2, JSON.stringify(c))
  check('09:00 is the first hourly slot', isSlotMinute(c, 0))
  check('09:00 is not the second account minute', !isSlotMinute(c, 1))
  check('08:59 is before the schedule', !isSlotMinute(sydneyClock(tue0859Aedt), 0))
  const july = sydneyClock(tue0900Aest)
  check('July 09:00 Sydney is AEST Tuesday', july.ymd === '2026-07-14' && july.hour === 9 && july.minute === 0, JSON.stringify(july))
  check('Sunday has no slot', latestSlotId(sun1000, 0) === null, latestSlotId(sun1000, 0) ?? 'null')
  check('Monday is not a slot', !isSlotMinute(sydneyClock(mon1000), 0))
  check('Saturday is a slot', isSlotMinute(sydneyClock(sat1000), 0))
}

{
  check('15:16 is the second account quarter-hour', isSlotMinute(sydneyClock(tue1516), 1))
  check('15:16 is not the top of the hour for account 0', !isSlotMinute(sydneyClock(tue1516), 0))
  const next = nextSlotTime(tue0900Aedt, 0)
  const nextClock = sydneyClock(next)
  check('the next slot after 09:00 is 10:00', nextClock.ymd === '2026-01-13' && nextClock.hour === 10 && nextClock.minute === 0, JSON.stringify(nextClock))
  const after1516 = sydneyClock(nextSlotTime(tue1516, 1))
  check('the next slot after 15:16 stagger 1 is 15:31', after1516.hour === 15 && after1516.minute === 31, JSON.stringify(after1516))
  check('the waiting note names that next check', waitingForStatementNote(tue1516, 1) === 'Waiting for IBKR statement — next check 15:31')
}

{
  // Tue 10 Nov 2026 09:00 AEDT = Mon 9 Nov 22:00 UTC. New York is EST (UTC-5): Mon 17:00, after the close.
  const tue0900 = new Date('2026-11-09T22:00:00Z')
  check('Tuesday morning Sydney expects the Monday US session', expectedUsTradingDay(tue0900) === '20261109')
  // Same instant but an hour earlier is 16:00 NY exactly? 21:00 UTC = 16:00 EST. Still Monday.
  check('the 16:00 New York close counts', expectedUsTradingDay(new Date('2026-11-09T21:00:00Z')) === '20261109')
  // 15:59 NY is before the close, so the expected day is the previous Friday.
  check('before the close the expected day is still Friday', expectedUsTradingDay(new Date('2026-11-09T20:59:00Z')) === '20261106')
  const thanksgiving = holidaysForYear(2026).find(h => h.name === 'Thanksgiving')?.date
  check('Thanksgiving 2026 is 26 Nov', thanksgiving === '2026-11-26', thanksgiving)
  // Friday 27 Nov 2026 09:00 AEDT = Thu 26 Nov 22:00 UTC = Thu 17:00 EST, but Thursday is Thanksgiving.
  check('Thanksgiving is not the expected session', expectedUsTradingDay(new Date('2026-11-26T22:00:00Z')) === '20261125')
  check('a window through that day covers it', windowCoversTradingDay([{ fromDate: '20250701', toDate: '20261109' }], '20261109'))
  check('a window that ended the day before does not', !windowCoversTradingDay([{ fromDate: '20250701', toDate: '20261106' }], '20261109'))
}

if (failed > 0) {
  console.error(`\n${failed} failed`)
  process.exit(1)
}
console.log('\nflex schedule ok')
