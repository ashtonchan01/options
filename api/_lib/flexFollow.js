/**
 * What a long-running Flex cron should do next.
 * Hours, skip days, stagger, and stop-when-covered stay in flexSchedule.js.
 * This only reports the decision those functions already made.
 */
import { cronDecision, isFlexScheduleDay, nextSlotTime, sydneyClock } from './flexSchedule.js'

function stillOpen(decision) {
  if (decision.action === 'sync') return true
  return decision.reason !== 'done' && decision.reason !== 'covered'
}

/**
 * `sync` — an account is already due (including a slot missed because the
 * caller started late). `wait` — the next slot is still today. `stop` —
 * every account is done, or today has no further slot.
 *
 * @param {Date} now
 * @param {{ key: string, index: number, record?: object, windows?: { fromDate: string, toDate: string }[] }[]} accounts
 */
export function followPlan(now, accounts) {
  const today = sydneyClock(now)
  const rows = (accounts ?? []).map(account => ({
    key: account.key,
    decision: cronDecision(now, account.index, account.record, account.windows),
    index: account.index,
  }))
  const open = rows.filter(row => stillOpen(row.decision))
  const openKeys = open.map(row => row.key)
  if (open.length === 0) {
    return { action: 'stop', reason: 'done', nextCheckAt: null, openKeys }
  }
  if (open.some(row => row.decision.action === 'sync')) {
    return { action: 'sync', reason: null, nextCheckAt: null, openKeys }
  }
  let soonest = null
  for (const row of open) {
    const at = nextSlotTime(now, row.index)
    if (!soonest || at.getTime() < soonest.getTime()) soonest = at
  }
  if (!soonest || sydneyClock(soonest).ymd !== today.ymd) {
    return {
      action: 'stop',
      reason: isFlexScheduleDay(today) ? 'day-over' : 'off-day',
      nextCheckAt: null,
      openKeys,
    }
  }
  return { action: 'wait', reason: null, nextCheckAt: soonest.toISOString(), openKeys }
}
