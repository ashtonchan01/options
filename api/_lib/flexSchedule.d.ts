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

export interface ScheduleRecord {
  doneSydneyDate?: string
  lastSlotId?: string
}

export type CronSkip = {
  action: 'skip'
  reason: 'done' | 'off-hours' | 'already-tried' | 'covered'
  doneSydneyDate?: string
}

export type CronSync = {
  action: 'sync'
  slot: string
  expected: string
  sydneyDate: string
  waitingNote: string
}

export function civilClock(now: Date, timeZone: string): CivilClock
export function sydneyClock(now: Date): CivilClock
export function isFlexScheduleDay(clock: CivilClock): boolean
export function isSlotMinute(clock: CivilClock, staggerMinutes: number): boolean
export function slotId(clock: CivilClock): string
export function latestSlotId(now: Date, staggerMinutes: number): string | null
export function nextSlotTime(now: Date, staggerMinutes: number): Date
export function formatSydneyHM(now: Date): string
export function waitingForStatementNote(now: Date, staggerMinutes: number): string
export function expectedUsTradingDay(now: Date, isHoliday?: (ymd: string) => boolean): string
export function windowCoversTradingDay(windows: FlexWindowLike[] | undefined, expectedYyyymmdd: string): boolean
export function cronDecision(
  now: Date,
  index: number,
  record: ScheduleRecord | undefined,
  windows: FlexWindowLike[] | undefined,
): CronSkip | CronSync
export function pickDueAccount<T extends { index: number; record?: ScheduleRecord; windows?: FlexWindowLike[] }>(
  now: Date,
  accounts: T[],
): { account: T; decision: CronSync } | null
export function scheduleAfterAttempt(
  record: ScheduleRecord | undefined,
  decision: CronSync,
  result: { ok?: boolean; toDate?: string } | undefined,
): ScheduleRecord
export function flexWindowFromXml(xml: string | undefined): { fromDate: string; toDate: string } | null
export function configuredFlexAccounts(env?: Record<string, string | undefined>): {
  key: string
  envKey: string
  token: string
  query: string
  index: number
}[]
