/**
 * A delayed GitHub start still walks the rest of the Sydney Flex day,
 * both accounts, about a minute apart, and hands off before the 6-hour
 * job limit. Schedule rules themselves are covered in flex-schedule.test.ts.
 * Run with: npm test
 */
import { readFileSync } from 'node:fs'
import { followPlan } from '../api/_lib/flexFollow.js'
import {
  expectedUsTradingDay,
  pickDueAccount,
  scheduleAfterAttempt,
  sydneyClock,
} from '../src/services/flexSchedule'
import {
  ACCOUNT_GAP_MS,
  JOB_BUDGET_MS,
  MAX_HANDOFFS,
  REQUEST_GUARD_MS,
  SLOT_GRACE_MS,
  formatFollowLog,
  handoffDecision,
  nextFollowStep,
  postFlexSync,
  recoveryDispatch,
  runFlexFollow,
} from './flex-cron-run.js'

let failed = 0
function check(name: string, ok: boolean, detail?: string) {
  if (ok) console.log(`ok  ${name}`)
  else {
    failed++
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

function atSydney(ymd: string, hour: number, minute: number): Date {
  const [y, m, d] = ymd.split('-').map(Number)
  const start = Date.UTC(y, m - 1, d - 1, 0, 0, 0)
  for (let i = 0; i < 60 * 72; i++) {
    const t = new Date(start + i * 60_000)
    const c = sydneyClock(t)
    if (c.ymd === ymd && c.hour === hour && c.minute === minute) return t
  }
  throw new Error(`missing Sydney instant ${ymd} ${hour}:${minute}`)
}

interface Row {
  key: string
  index: number
  record: { lastSlotId?: string; doneSydneyDate?: string }
  windows: { fromDate: string; toDate: string }[]
  token?: string
}

function pair(): Row[] {
  return [
    { key: 'personal', index: 0, record: {}, windows: [], token: 'personal-token' },
    { key: 'business', index: 1, record: {}, windows: [], token: 'business-token' },
  ]
}

interface Attempt {
  ok: boolean
  toDate?: string
  code?: string
}

async function runFrom(
  start: Date,
  accounts: Row[],
  policy: (account: Row, decision: { slot: string; expected: string; sydneyDate: string }) => Attempt,
  budgetMs = 20 * 60 * 60_000,
) {
  const clock = { current: new Date(start.getTime()) }
  const trace: { key: string; slot: string; at: number }[] = []
  const logs: string[] = []
  const result = await runFlexFollow({
    request: async () => {
      const now = clock.current
      const picked = pickDueAccount(now, accounts)
      if (!picked) {
        return { status: 200, body: { ran: null, reason: 'none-due', follow: followPlan(now, accounts) } }
      }
      const { account, decision } = picked
      if (trace.length > 40) throw new Error(`too many flex checks, last ${decision.slot}`)
      trace.push({ key: account.key, slot: decision.slot, at: now.getTime() })
      const attempt = policy(account, decision)
      account.record = scheduleAfterAttempt(account.record, decision, {
        ok: Boolean(attempt.ok && attempt.toDate),
        toDate: attempt.toDate,
      })
      if (attempt.ok && attempt.toDate) {
        account.windows = [{ fromDate: '20251112', toDate: attempt.toDate }]
      }
      return {
        status: 200,
        body: {
          ran: account.key,
          status: attempt.ok && attempt.toDate ? 'saved' : 'waiting',
          code: attempt.ok ? null : (attempt.code ?? '1019'),
          toDate: attempt.toDate,
          follow: followPlan(now, accounts),
          token: account.token,
        },
      }
    },
    sleep: async (ms: number) => {
      clock.current = new Date(clock.current.getTime() + ms)
    },
    now: () => clock.current,
    startedAt: new Date(start.getTime()),
    budgetMs,
    log: (line: string) => logs.push(line),
  })
  return { result, trace, logs, clock }
}

async function runChain(
  start: Date,
  accounts: Row[],
  policy: (account: Row, decision: { slot: string; expected: string; sydneyDate: string }) => Attempt,
  budgetMs = JOB_BUDGET_MS,
) {
  let cursor = new Date(start.getTime())
  const trace: { key: string; slot: string; at: number }[] = []
  const logs: string[] = []
  let result: Awaited<ReturnType<typeof runFrom>>['result'] | undefined
  for (let hop = 0; hop <= MAX_HANDOFFS; hop++) {
    const ran = await runFrom(cursor, accounts, policy, budgetMs)
    trace.push(...ran.trace)
    logs.push(...ran.logs)
    result = ran.result
    cursor = ran.clock.current
    if (result.type !== 'handoff') return { result, trace, logs, clock: { current: cursor }, hops: hop }
  }
  throw new Error(`still handing off, last ${result?.reason}`)
}

{
  const late = atSydney('2026-11-12', 13, 28)
  check(
    'Thursday 12 Nov after the US close expects 11 Nov',
    expectedUsTradingDay(late) === '20261111',
    expectedUsTradingDay(late),
  )
  const open = followPlan(late, pair())
  check(
    'a 13:28 start still owes both accounts the missed slot',
    open.action === 'sync' && open.openKeys.join(',') === 'personal,business',
    JSON.stringify(open),
  )
  check('the plan does not carry flex tokens', !JSON.stringify(open).includes('personal-token'))

  const tried = followPlan(late, [
    { key: 'personal', index: 0, record: { lastSlotId: '2026-11-12T13:00' }, windows: [] },
    { key: 'business', index: 1, record: {}, windows: [] },
  ])
  check('the other account is due in that same late minute', tried.action === 'sync' && tried.openKeys.join(',') === 'personal,business')

  const bothTried = followPlan(atSydney('2026-11-12', 13, 29), [
    { key: 'personal', index: 0, record: { lastSlotId: '2026-11-12T13:00' }, windows: [] },
    { key: 'business', index: 1, record: { lastSlotId: '2026-11-12T13:01' }, windows: [] },
  ])
  const nextHour = bothTried.nextCheckAt ? sydneyClock(new Date(bothTried.nextCheckAt)) : null
  check(
    'after the late slot, the next check is 14:00, not the end of the day',
    bothTried.action === 'wait' && nextHour?.hour === 14 && nextHour.minute === 0,
    JSON.stringify(bothTried),
  )

  const leaseEnd = new Date(late.getTime() + 90_000).toISOString()
  const inflight = followPlan(late, [
    {
      key: 'personal',
      index: 0,
      record: { claimSlotId: '2026-11-12T13:00', claimUntil: leaseEnd },
      windows: [],
    },
    { key: 'business', index: 1, record: { lastSlotId: '2026-11-12T13:01' }, windows: [] },
  ])
  check(
    'a claimed slot waits out the lease instead of calling Flex again',
    inflight.action === 'wait' && inflight.nextCheckAt === leaseEnd,
    JSON.stringify(inflight),
  )

  const afterThree = followPlan(atSydney('2026-11-12', 15, 2), [
    { key: 'personal', index: 0, record: { lastSlotId: '2026-11-12T15:00' }, windows: [] },
    { key: 'business', index: 1, record: { lastSlotId: '2026-11-12T15:01' }, windows: [] },
  ])
  const quarter = afterThree.nextCheckAt ? sydneyClock(new Date(afterThree.nextCheckAt)) : null
  check(
    'after 15:00 the next slot is 15 minutes later',
    afterThree.action === 'wait' && quarter?.hour === 15 && quarter.minute === 15,
    JSON.stringify(afterThree),
  )

  const covered = followPlan(late, [
    { key: 'personal', index: 0, record: {}, windows: [{ fromDate: '20251112', toDate: '20261111' }] },
    { key: 'business', index: 1, record: {}, windows: [] },
  ])
  check('a covered account drops out and the other is still due', covered.action === 'sync' && covered.openKeys.join(',') === 'business')

  const sunday = followPlan(atSydney('2026-11-15', 10, 0), pair())
  check('Sunday stops without waiting for Tuesday', sunday.action === 'stop' && sunday.reason === 'off-day')
  const monday = followPlan(atSydney('2026-11-16', 10, 0), pair())
  check('Monday stops too', monday.action === 'stop' && monday.reason === 'off-day')

  const end = followPlan(atSydney('2026-11-12', 23, 50), [
    { key: 'personal', index: 0, record: { lastSlotId: '2026-11-12T23:45' }, windows: [] },
    { key: 'business', index: 1, record: { lastSlotId: '2026-11-12T23:46' }, windows: [] },
  ])
  check('after the last Thursday slot the day is over', end.action === 'stop' && end.reason === 'day-over' && end.nextCheckAt === null)

  const saturday = followPlan(atSydney('2026-11-14', 8, 0), pair())
  const saturdayNext = saturday.nextCheckAt ? sydneyClock(new Date(saturday.nextCheckAt)) : null
  check(
    'Saturday still starts at 09:00',
    saturday.action === 'wait' && saturdayNext?.ymd === '2026-11-14' && saturdayNext.hour === 9 && saturdayNext.minute === 0,
    JSON.stringify(saturday),
  )
}

{
  const now = atSydney('2026-11-12', 13, 28)
  const gap = nextFollowStep({
    now,
    plan: { action: 'sync', reason: null, nextCheckAt: null, openKeys: ['business'] },
    lastAttemptAt: now,
  })
  check('two due accounts wait out the minute gap', gap.type === 'sleep' && gap.ms === ACCOUNT_GAP_MS, JSON.stringify(gap))

  const nine = atSydney('2026-11-12', 9, 0)
  const early = atSydney('2026-11-12', 8, 29)
  const wait = nextFollowStep({
    now: early,
    plan: { action: 'wait', reason: null, nextCheckAt: nine.toISOString(), openKeys: ['personal', 'business'] },
    lastAttemptAt: null,
  })
  check(
    'an early start sleeps until just after 09:00',
    wait.type === 'sleep' && wait.ms === nine.getTime() - early.getTime() + SLOT_GRACE_MS,
    JSON.stringify(wait),
  )
}

{
  const morning = atSydney('2026-11-12', 8, 29)
  const ran = await runFrom(morning, pair(), () => ({ ok: true, toDate: '20261111' }))
  check(
    '08:29 still checks personal at 09:00 and business at 09:01',
    ran.trace.map(t => `${t.key}@${t.slot}`).join(',') === 'personal@2026-11-12T09:00,business@2026-11-12T09:01',
    ran.trace.map(t => `${t.key}@${t.slot}`).join(','),
  )
  const personalAt = sydneyClock(new Date(ran.trace[0]?.at ?? 0))
  const businessAt = sydneyClock(new Date(ran.trace[1]?.at ?? 0))
  check('personal is asked at 09:00', personalAt.hour === 9 && personalAt.minute === 0, JSON.stringify(personalAt))
  check('business is asked at 09:01', businessAt.hour === 9 && businessAt.minute === 1, JSON.stringify(businessAt))
  check('both done, so 10:00 is not checked', ran.result.type === 'stop' && ran.result.reason === 'done')
  check('the run probed once before 09:00', ran.result.calls[0]?.reason === 'none-due' && ran.result.calls[0]?.action === 'wait')
}

{
  const late = atSydney('2026-11-12', 13, 28)
  const ran = await runChain(late, pair(), (account, decision) => {
    if (account.key === 'business') return { ok: true, toDate: '20261111' }
    if (decision.slot >= '2026-11-12T17:00') return { ok: true, toDate: '20261111' }
    return { ok: false, code: '1019' }
  })
  const personal = ran.trace.filter(t => t.key === 'personal').map(t => t.slot)
  const business = ran.trace.filter(t => t.key === 'business').map(t => t.slot)
  check(
    'personal keeps the hourly slots and then every 15 minutes until the statement is in',
    personal.join(',') === [
      '2026-11-12T13:00',
      '2026-11-12T14:00',
      '2026-11-12T15:00',
      '2026-11-12T15:15',
      '2026-11-12T15:30',
      '2026-11-12T15:45',
      '2026-11-12T16:00',
      '2026-11-12T16:15',
      '2026-11-12T16:30',
      '2026-11-12T16:45',
      '2026-11-12T17:00',
    ].join(','),
    personal.join(','),
  )
  check('business is checked from this run, not a later GitHub fire', business.join(',') === '2026-11-12T13:01', business.join(','))
  check('a 1019 does not finish the day', ran.result.reason === 'done' && ran.trace.at(-1)?.slot === '2026-11-12T17:00')
  check('no 17:15 once the statement covers the day', !personal.includes('2026-11-12T17:15'))
  let spaced = true
  for (let i = 1; i < ran.trace.length; i++) {
    if (ran.trace[i].at - ran.trace[i - 1].at < ACCOUNT_GAP_MS) spaced = false
  }
  check('checks stay at least a minute apart', spaced)
  check(
    'the second account is one minute after the first',
    ran.trace[1]?.key === 'business' && ran.trace[1].at - ran.trace[0].at === ACCOUNT_GAP_MS,
  )
  check(
    'logs leave the flex tokens out',
    ran.logs.length > 0 && ran.logs.every(line => !line.includes('personal-token') && !line.includes('business-token')),
  )
}

{
  const accounts = pair()
  accounts[0].windows = [{ fromDate: '20251112', toDate: '20261111' }]
  const ran = await runChain(atSydney('2026-11-12', 15, 10), accounts, (_account, decision) => {
    if (decision.slot >= '2026-11-12T15:16') return { ok: true, toDate: '20261111' }
    return { ok: false, code: '1019' }
  })
  check(
    'once personal is done, business still gets its own quarter-hour slots',
    ran.trace.map(t => `${t.key}@${t.slot}`).join(',') === 'business@2026-11-12T15:01,business@2026-11-12T15:16',
    ran.trace.map(t => `${t.key}@${t.slot}`).join(','),
  )
}

{
  const early = atSydney('2026-11-12', 1, 21)
  const accounts = pair()
  const first = await runFrom(early, accounts, () => ({ ok: true, toDate: '20261111' }), JOB_BUDGET_MS)
  const elapsed = first.clock.current.getTime() - early.getTime()
  check(
    'a 1:21 start hands off on the short budget',
    first.result.type === 'handoff'
      && elapsed <= JOB_BUDGET_MS
      && elapsed >= JOB_BUDGET_MS - REQUEST_GUARD_MS - 30_000
      && first.trace.length === 0,
    `${first.result.reason} ${elapsed}`,
  )
  const woke = sydneyClock(first.clock.current)
  check('the handoff is still before 09:00', woke.ymd === '2026-11-12' && woke.hour < 9, JSON.stringify(woke))

  const second = await runChain(first.clock.current, accounts, () => ({ ok: true, toDate: '20261111' }), JOB_BUDGET_MS)
  check(
    'later jobs reach 09:00 and 09:01',
    second.trace.map(t => `${t.key}@${t.slot}`).join(',') === 'personal@2026-11-12T09:00,business@2026-11-12T09:01',
    second.trace.map(t => `${t.key}@${t.slot}`).join(',') || second.result.reason,
  )
  check('and stop when both statements are in', second.result.type === 'stop' && second.result.reason === 'done')
}

{
  const sunday = await runFrom(atSydney('2026-11-15', 10, 0), pair(), () => ({ ok: true, toDate: '20261113' }))
  check('Sunday does not hold a runner', sunday.result.type === 'stop' && sunday.result.reason === 'off-day' && sunday.trace.length === 0)
}

{
  let calls = 0
  const start = atSydney('2026-11-12', 13, 28)
  const denied = await runFlexFollow({
    request: async () => {
      calls += 1
      return { status: 401, body: { error: 'Unauthorized' } }
    },
    sleep: async () => { throw new Error('slept after 401') },
    now: () => start,
    startedAt: start,
  })
  check('a rejected secret stops immediately', denied.reason === 'http-401' && calls === 1)

  const clock = { current: start }
  let tries = 0
  const recovered = await runFlexFollow({
    request: async () => {
      tries += 1
      if (tries === 1) return { status: 500, body: null }
      return {
        status: 200,
        body: { ran: null, reason: 'none-due', follow: { action: 'stop', reason: 'done', nextCheckAt: null, openKeys: [] } },
      }
    },
    sleep: async (ms: number) => {
      clock.current = new Date(clock.current.getTime() + ms)
    },
    now: () => clock.current,
    startedAt: start,
  })
  check('a 500 is retried and a later done still stops', recovered.reason === 'done' && tries === 2)
  check('the retry waits', clock.current.getTime() - start.getTime() >= 30_000)

  const missing = await runFlexFollow({
    request: async () => ({ status: 200, body: { ran: null, reason: 'none-due' } }),
    sleep: async () => { throw new Error('slept without a plan') },
    now: () => start,
    startedAt: start,
  })
  check('an old API with no follow plan stops instead of spinning', missing.reason === 'no-follow')
}

{
  let auth = ''
  let redirect = ''
  const posted = await postFlexSync({
    url: 'https://example.test/api/flex-sync',
    secret: 'super-secret',
    fetchImpl: async (_url: string, init: { headers: { Authorization: string }; redirect: string }) => {
      auth = init.headers.Authorization
      redirect = init.redirect
      return {
        status: 200,
        text: async () => JSON.stringify({
          ran: null,
          reason: 'none-due',
          follow: { action: 'stop', reason: 'off-day', nextCheckAt: null, openKeys: [] },
        }),
      }
    },
  })
  check('the secret is sent as a bearer header', auth === 'Bearer super-secret' && redirect === 'error')
  const line = formatFollowLog(atSydney('2026-11-12', 13, 28), { ...posted.body, leaked: 'super-secret' })
  check('the log line cannot repeat the secret', !line.includes('super-secret') && line.includes('stop off-day'))
  const injected = handoffDecision({ type: 'stop', reason: 'done\nhandoff=true' }, 0)
  check(
    'a follow reason cannot forge a handoff output',
    injected.handoff === 'false' && injected.reason === 'donehandofftrue' && !injected.reason.includes('='),
  )
}

{
  const late = atSydney('2026-11-12', 13, 28)
  const one = await runFrom(late, pair(), () => ({ ok: false, code: '1019' }))
  check(
    'one job checks this slot and leaves the next hour',
    one.result.type === 'handoff'
      && one.result.reason === 'slot'
      && one.trace.map(t => `${t.key}@${t.slot}`).join(',') === 'personal@2026-11-12T13:00,business@2026-11-12T13:01'
      && sydneyClock(one.clock.current).hour === 13,
    `${one.result.reason} ${one.trace.map(t => t.slot).join(',')}`,
  )
}

{
  const lost = recoveryDispatch({
    started: 'true',
    followResult: 'cancelled',
    handoff: '',
    continueOut: '',
    reason: '',
    hopOut: '',
    hopIn: '2',
  })
  check('a cancelled run that had started dispatches the next hop', lost.dispatch && lost.hop === '3' && lost.reason === 'recovered', JSON.stringify(lost))
  const queued = recoveryDispatch({
    started: '',
    followResult: 'cancelled',
    hopIn: '0',
  })
  check('a run cancelled before it started does not dispatch', !queued.dispatch, JSON.stringify(queued))
  const denied = recoveryDispatch({
    started: 'true',
    followResult: 'failure',
    handoff: 'false',
    continueOut: 'false',
    reason: 'http-401',
    hopOut: '1',
    hopIn: '0',
  })
  check('a rejected secret does not start another job', !denied.dispatch, JSON.stringify(denied))
  const passed = recoveryDispatch({
    started: 'true',
    followResult: 'success',
    handoff: 'true',
    continueOut: 'true',
    reason: 'slot',
    hopOut: '4',
    hopIn: '3',
  })
  check('a clean slot handoff uses the hop the follow step wrote', passed.dispatch && passed.hop === '4', JSON.stringify(passed))
  const capped = recoveryDispatch({
    started: 'true',
    followResult: 'cancelled',
    hopIn: String(MAX_HANDOFFS),
  })
  check('the hop cap stops a recovery loop', !capped.dispatch && capped.reason === 'hop-limit', JSON.stringify(capped))
  const done = recoveryDispatch({
    started: 'true',
    followResult: 'success',
    handoff: 'false',
    continueOut: 'false',
    reason: 'done',
    hopOut: '1',
    hopIn: '0',
  })
  check('a finished day does not dispatch', !done.dispatch, JSON.stringify(done))
}

{
  const yml = readFileSync(new URL('../.github/workflows/flex-cron.yml', import.meta.url), 'utf8')
  const handoff = readFileSync(new URL('./flex-cron-handoff.js', import.meta.url), 'utf8')
  const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')) as {
    crons?: unknown
    schedules?: Record<string, { path?: string; schedule?: string; requestMethod?: string }>
  }
  const cronRoute = readFileSync(new URL('../api/flex-cron.js', import.meta.url), 'utf8')
  const cronLib = readFileSync(new URL('../api/_lib/flexCron.js', import.meta.url), 'utf8')
  const cronBody = cronLib.slice(cronLib.indexOf('export async function runFlexCron'))
  check('overlapping runs do not pile up or cancel the one that is following the day', yml.includes('group: flex-sydney-schedule') && yml.includes('cancel-in-progress: false'))
  check('the job follows one slot instead of posting once', yml.includes('node scripts/flex-cron-run.js') && !yml.includes('curl '))
  check('a cancelled follow still has a handoff job', yml.includes('if: always()') && yml.includes('node scripts/flex-cron-handoff.js') && yml.includes('started=true'))
  check('a budget handoff is a workflow_dispatch hop', yml.includes('workflow_dispatch') && handoff.includes("workflow', 'run'") && handoff.includes('hop=${decision.hop}'))
  check('the cron secret stays in the environment', yml.includes('CRON_SECRET: ${{ secrets.CRON_SECRET }}') && !yml.includes('Bearer') && !handoff.includes('CRON_SECRET'))
  check('one job is shorter than an afternoon', yml.includes('timeout-minutes: 90') && yml.includes('timeout-minutes: 80'))
  check('checkout is the Node 24 action', yml.includes('actions/checkout@v7') && !yml.includes('actions/checkout@v4'))
  check('the starter is every 15 minutes, off the top of the hour', yml.includes("cron: '7,22,37,52 * * * *'"))
  check(
    'the loop budget fits one hourly gap and the step timeout',
    JOB_BUDGET_MS >= 65 * 60_000 && JOB_BUDGET_MS < 80 * 60_000,
  )
  const flexCheck = vercel.schedules?.['flex-check']
  check(
    'the backup schedule is one UTC hour, once a day',
    !vercel.crons
      && flexCheck?.path === '/api/flex-cron'
      && flexCheck?.schedule === '0 6 * * *'
      && flexCheck?.requestMethod === 'GET',
  )
  check('the backup route is the shared check', cronRoute.includes('runFlexCron') && cronRoute.includes("req.method !== 'GET'"))
  check('the shared check claims the slot before it calls Flex', cronBody.indexOf('claimSlot(') !== -1 && cronBody.indexOf('claimSlot(') < cronBody.indexOf('fetchFlexStatement('))
  check('the check does not log', !cronLib.includes('console.') && !cronRoute.includes('console.'))
}

if (failed > 0) {
  console.error(`\n${failed} failed`)
  process.exit(1)
}
console.log('\nflex follow ok')
