/**
 * Sydney Flex schedule. The implementation lives in api/_lib so the Vercel
 * cron route and this client import the same functions.
 */
export {
  civilClock,
  sydneyClock,
  isFlexScheduleDay,
  isSlotMinute,
  slotId,
  latestSlotId,
  nextSlotTime,
  formatSydneyHM,
  waitingForStatementNote,
  expectedUsTradingDay,
  windowCoversTradingDay,
  cronDecision,
  pickDueAccount,
  scheduleAfterAttempt,
  flexWindowFromXml,
  configuredFlexAccounts,
} from '../../api/_lib/flexSchedule.js'

export interface CivilClock {
  ymd: string
  weekday: number
  hour: number
  minute: number
}

export interface FlexWindowLike {
  fromDate: string
  toDate: string
}
