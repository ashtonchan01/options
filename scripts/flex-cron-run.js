/**
 * Laptop-closed Flex follow.
 *
 * GitHub's schedule trigger is delayed and often dropped. A run that does
 * start checks the slot that is due, then hands off. The next job waits for
 * the following slot. A lost runner therefore costs that slot, and the
 * handoff job on a fresh runner dispatches the rest of the day.
 *
 * One account per POST. Consecutive checks are at least a minute apart.
 */
import { appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { sydneyClock } from '../api/_lib/flexSchedule.js'

/** Matches the account stagger so two Flex tokens are not requested together. */
export const ACCOUNT_GAP_MS = 60_000
/** Wake just after the slot minute so a fast clock does not post early and miss it. */
export const SLOT_GRACE_MS = 5_000
/**
 * One job waits out at most one hourly gap, then exits so a dead runner
 * cannot hold the rest of the day. The step timeout sits above this.
 */
export const JOB_BUDGET_MS = 75 * 60_000
/** A wait longer than this, after a check, belongs to the next job. */
export const SLOT_HANDOFF_MS = 3 * 60_000
/** Do not start a Flex call that the job timeout would cut off. */
export const REQUEST_GUARD_MS = 90_000
/** Give up starting the day if the API never answers. An open day keeps trying. */
export const FAILURE_BUDGET_MS = 20 * 60_000
/**
 * Hops 0..63 hand off; hop 64 is the last segment.
 * A full Sydney day of one-slot jobs is about 50 (pre-09:00 chunks of this
 * budget, then one job per slot through 23:45). The cap stops a loop.
 */
export const MAX_HANDOFFS = 64
/** These do not get better by starting another job. */
export const PERMANENT_REASONS = Object.freeze([
  'http-401',
  'http-403',
  'http-503',
  'no-flex-env',
  'no-secret',
  'no-follow',
  'bad-plan',
])

const SLEEP_CHUNK_MS = 30_000
const HEARTBEAT_MS = 15 * 60_000
const DEFAULT_URL = 'https://options-jade.vercel.app/api/flex-sync'

export function stamp(now) {
  const clock = sydneyClock(now)
  const hh = String(clock.hour).padStart(2, '0')
  const mm = String(clock.minute).padStart(2, '0')
  return `${clock.ymd} ${hh}:${mm} Sydney`
}

function plain(value) {
  return String(value ?? '').replace(/[\r\n]/g, ' ').slice(0, 80)
}

/** Single token for GITHUB_OUTPUT, so a response cannot add another output line. */
export function outputToken(value) {
  return String(value ?? '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48) || 'unknown'
}

/** Log line. Only the cron outcome fields — never the raw body. */
export function formatFollowLog(now, body) {
  const follow = body?.follow
  const who = body?.ran
    ? `${plain(body.ran)} ${plain(body.status) || 'checked'}${body.code ? ` ${plain(body.code)}` : ''}`
    : plain(body?.reason || 'no-ran')
  let plan = 'no follow plan'
  if (follow?.action === 'stop') plan = `stop ${plain(follow.reason)}`.trim()
  else if (follow?.action === 'wait') plan = `wait ${plain(follow.nextCheckAt)}`
  else if (follow?.action === 'sync') plan = 'sync'
  const open = Array.isArray(follow?.openKeys) && follow.openKeys.length
    ? ` open ${follow.openKeys.map(plain).join(',')}`
    : ''
  return `${stamp(now)} ${who}; ${plan}${open}`.replace(/[\r\n]/g, ' ')
}

export function handoffDecision(result, hop) {
  const allow = result?.type === 'handoff' && hop < MAX_HANDOFFS
  return {
    handoff: allow ? 'true' : 'false',
    hop: String(hop + 1),
    reason: outputToken(result?.reason),
  }
}

export function parseHop(value) {
  const n = Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(n) || n < 0 || n > 1000) return 0
  return n
}

/**
 * Whether the handoff job should dispatch another run.
 * A queued run that never started must not dispatch: concurrency already
 * kept a replacement. A run that started and was then cancelled or failed
 * still dispatches, up to the hop cap.
 */
export function recoveryDispatch({
  started = '',
  followResult = '',
  handoff = '',
  continueOut = '',
  reason = '',
  hopOut = '',
  hopIn = '0',
  maxHandoffs = MAX_HANDOFFS,
} = {}) {
  const reasonToken = outputToken(reason)
  const permanent = PERMANENT_REASONS.includes(reasonToken)
  const inputHop = parseHop(hopIn)
  const statedHop = hopOut === '' || hopOut == null ? null : parseHop(hopOut)
  const nextHop = handoff === 'true' && statedHop != null ? statedHop : inputHop + 1
  if (nextHop < 1 || nextHop > maxHandoffs) {
    return { dispatch: false, hop: String(Math.max(0, nextHop)), reason: 'hop-limit' }
  }
  if ((permanent || continueOut === 'false') && handoff !== 'true') {
    return { dispatch: false, hop: String(nextHop), reason: reasonToken || 'stop' }
  }
  if (handoff === 'true' || continueOut === 'true') {
    return { dispatch: true, hop: String(nextHop), reason: handoff === 'true' ? 'handoff' : 'continue' }
  }
  const result = String(followResult || '').toLowerCase()
  const broken = result === 'cancelled' || result === 'failure'
  if (started === 'true' && broken) {
    return { dispatch: true, hop: String(nextHop), reason: 'recovered' }
  }
  return { dispatch: false, hop: String(nextHop), reason: reasonToken || result || 'idle' }
}

/**
 * Ideal next step, ignoring the job deadline. The caller cuts the sleep
 * short when the deadline is closer than the next slot.
 */
export function nextFollowStep({ now, plan, lastAttemptAt }) {
  if (!plan || plan.action === 'stop') {
    return { type: 'stop', reason: plan?.reason || 'no-plan' }
  }
  const nowMs = now.getTime()
  const since = lastAttemptAt == null ? Infinity : nowMs - lastAttemptAt.getTime()
  const gapLeft = since >= ACCOUNT_GAP_MS ? 0 : ACCOUNT_GAP_MS - since

  if (plan.action === 'sync') {
    if (gapLeft > 0) return { type: 'sleep', ms: gapLeft }
    return { type: 'request' }
  }
  if (plan.action !== 'wait' || typeof plan.nextCheckAt !== 'string') {
    return { type: 'stop', reason: 'bad-plan' }
  }
  const at = Date.parse(plan.nextCheckAt)
  if (!Number.isFinite(at)) return { type: 'stop', reason: 'bad-plan' }
  let sleepMs = Math.max(0, at - nowMs) + SLOT_GRACE_MS
  if (gapLeft > sleepMs) sleepMs = gapLeft
  return { type: 'sleep', ms: sleepMs }
}

function recorded(body) {
  const follow = body?.follow
  return {
    ran: body?.ran ?? null,
    status: body?.status ?? null,
    reason: body?.reason ?? null,
    code: body?.code ?? null,
    action: follow?.action ?? null,
    nextCheckAt: follow?.nextCheckAt ?? null,
    openKeys: Array.isArray(follow?.openKeys) ? follow.openKeys : null,
  }
}

/**
 * @param {{
 *   request: () => Promise<{ status: number, body: object | null }>,
 *   sleep: (ms: number) => Promise<void>,
 *   now: () => Date,
 *   startedAt: Date,
 *   budgetMs?: number,
 *   guardMs?: number,
 *   failureBudgetMs?: number,
 *   log?: (line: string) => void,
 * }} opts
 */
export async function runFlexFollow(opts) {
  const sleep = opts.sleep
  const now = opts.now
  const log = opts.log ?? (() => {})
  const budgetMs = opts.budgetMs ?? JOB_BUDGET_MS
  const guardMs = opts.guardMs ?? REQUEST_GUARD_MS
  const failureBudgetMs = opts.failureBudgetMs ?? FAILURE_BUDGET_MS
  const deadline = opts.startedAt.getTime() + budgetMs
  const calls = []
  let lastAttemptAt = null
  let dayOpen = false
  let checked = false
  let failures = 0
  let firstFailureAt = null
  let immediate = 0
  let nextBeat = opts.startedAt.getTime() + HEARTBEAT_MS

  async function sleepBounded(ms) {
    let left = Math.max(0, ms)
    while (left > 0) {
      if (deadline - now().getTime() <= guardMs) return 'budget'
      const chunk = Math.min(left, SLEEP_CHUNK_MS)
      await sleep(chunk)
      left -= chunk
      if (now().getTime() >= nextBeat) {
        log(`${stamp(now())} still waiting`)
        nextBeat = now().getTime() + HEARTBEAT_MS
      }
    }
    if (deadline - now().getTime() <= guardMs) return 'budget'
    return 'ok'
  }

  function finish(type, reason) {
    return { type, reason, dayOpen, calls }
  }

  async function onFailure(label) {
    failures += 1
    if (firstFailureAt == null) firstFailureAt = now().getTime()
    log(`${stamp(now())} ${label} (${failures})`)
    const failingFor = now().getTime() - firstFailureAt
    if (!dayOpen && failingFor >= failureBudgetMs) return finish('stop', 'unreachable')
    const delay = Math.min(15 * 60_000, 30_000 * 2 ** Math.min(failures - 1, 5))
    const slept = await sleepBounded(delay)
    if (!dayOpen && now().getTime() - firstFailureAt >= failureBudgetMs) return finish('stop', 'unreachable')
    if (slept === 'budget') return finish(dayOpen ? 'handoff' : 'stop', dayOpen ? 'budget' : 'unreachable')
    return null
  }

  while (true) {
    if (deadline - now().getTime() <= guardMs) {
      return finish(dayOpen ? 'handoff' : 'stop', dayOpen ? 'budget' : 'unreachable')
    }

    let res
    try {
      res = await opts.request()
    } catch {
      const stopped = await onFailure('request failed')
      if (stopped) return stopped
      continue
    }

    if (res.status === 401 || res.status === 403 || res.status === 503) {
      log(`${stamp(now())} HTTP ${res.status}`)
      return finish('stop', `http-${res.status}`)
    }
    if (res.status !== 200 || !res.body || typeof res.body !== 'object') {
      const stopped = await onFailure(`HTTP ${res.status}`)
      if (stopped) return stopped
      continue
    }

    failures = 0
    firstFailureAt = null
    const body = res.body
    calls.push(recorded(body))
    log(formatFollowLog(now(), body))

    if (body.reason === 'no-flex-env') return finish('stop', 'no-flex-env')

    const plan = body.follow
    if (!plan || typeof plan !== 'object') return finish('stop', 'no-follow')
    if (plan.action === 'sync' || plan.action === 'wait') dayOpen = true
    if (body.ran) {
      lastAttemptAt = now()
      checked = true
    }

    const step = nextFollowStep({ now: now(), plan, lastAttemptAt })
    if (step.type === 'stop') return finish('stop', step.reason)
    if (step.type === 'request') {
      immediate += 1
      if (immediate > 2) {
        const slept = await sleepBounded(ACCOUNT_GAP_MS)
        if (slept === 'budget') return finish('handoff', 'budget')
      }
      continue
    }
    immediate = 0
    // The minute between accounts stays here. The wait until a later slot
    // is the next job, so this process is not the one a lost runner takes down.
    const bridgingAccounts = plan.action === 'sync'
    if (!bridgingAccounts && checked && step.ms > SLOT_HANDOFF_MS) {
      return finish('handoff', 'slot')
    }
    const slept = await sleepBounded(step.ms)
    if (slept === 'budget') return finish(dayOpen ? 'handoff' : 'stop', dayOpen ? 'budget' : 'unreachable')
  }
}

export async function postFlexSync({ url, secret, fetchImpl, timeoutMs = 75_000 }) {
  const fetchFn = fetchImpl ?? fetch
  const res = await fetchFn(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}` },
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs),
  })
  const text = await res.text()
  let body = null
  if (text) {
    try { body = JSON.parse(text) } catch { body = null }
  }
  return { status: res.status, body }
}

function writeOutput(pairs) {
  const file = process.env.GITHUB_OUTPUT
  if (!file) return
  const lines = Object.entries(pairs).map(([key, value]) => `${key}=${value}`).join('\n') + '\n'
  appendFileSync(file, lines)
}

function continueOutput(result, decision) {
  if (decision.handoff === 'true') return 'true'
  if (result?.reason === 'unreachable') return 'true'
  return 'false'
}

async function main() {
  const secret = process.env.CRON_SECRET
  const hop = parseHop(process.env.FLEX_CRON_HOP || '0')
  const onStop = () => {
    writeOutput({
      handoff: 'false',
      hop: String(hop + 1),
      reason: 'cancelled',
      continue: 'true',
    })
    process.exit(1)
  }
  process.once('SIGTERM', onStop)
  process.once('SIGINT', onStop)
  if (!secret) {
    console.error('CRON_SECRET is not set')
    writeOutput({ handoff: 'false', hop: String(hop), reason: 'no-secret', continue: 'false' })
    process.exit(1)
  }

  const startedAt = new Date()
  const result = await runFlexFollow({
    request: () => postFlexSync({
      url: process.env.FLEX_SYNC_URL || DEFAULT_URL,
      secret,
    }),
    sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
    now: () => new Date(),
    startedAt,
    log: line => console.log(line),
  })

  const decision = handoffDecision(result, hop)
  if (result.type === 'handoff' && decision.handoff !== 'true') {
    console.log(`Sydney day still open at hop ${hop}; not starting another job`)
  } else if (decision.handoff === 'true') {
    console.log(`Handing off the rest of the Sydney day (hop ${decision.hop})`)
  }
  writeOutput({ ...decision, continue: continueOutput(result, decision) })

  const hard = new Set([...PERMANENT_REASONS, 'unreachable'])
  process.exit(hard.has(result.reason) ? 1 : 0)
}

const isDirect = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isDirect) {
  main().catch(() => {
    console.error('Flex follow failed')
    writeOutput({ handoff: 'false', hop: '', reason: 'crashed', continue: 'true' })
    process.exit(1)
  })
}
