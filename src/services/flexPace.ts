/**
 * Which older Flex windows still need fetching, and how a sync reports
 * that without turning a rate limit into a red error.
 *
 * A window that has been stored is closed history. Later syncs fetch the
 * live query only, plus whatever older piece was never stored.
 */
import { uncoveredFlexRanges, ymdAdd } from './flexWindow'

export interface FlexWindow {
  fromDate: string
  toDate: string
}

/**
 * Gap between Flex windows, and between two accounts that share a token.
 * Matches the per-call pace in the proxy so a new SendRequest does not
 * follow the previous GetStatement inside the same minute's budget.
 */
export const SEND_GAP_MS = 6_000

/** Follow-up rounds after the server has already retried inside one invocation. */
export const MAX_BACKFILL_ROUNDS = 3

export function mergeWindows(windows: FlexWindow[]): FlexWindow[] {
  const sorted = [...windows]
    .filter(w => /^\d{8}$/.test(w.fromDate) && /^\d{8}$/.test(w.toDate) && w.fromDate <= w.toDate)
    .sort((a, b) => a.fromDate.localeCompare(b.fromDate) || a.toDate.localeCompare(b.toDate))
  const out: FlexWindow[] = []
  for (const w of sorted) {
    const prev = out[out.length - 1]
    if (!prev || w.fromDate > ymdAdd(prev.toDate, 1)) {
      out.push({ ...w })
      continue
    }
    if (w.toDate > prev.toDate) prev.toDate = w.toDate
  }
  return out
}

export function addWindow(stored: FlexWindow[] | undefined, window: FlexWindow): FlexWindow[] {
  return mergeWindows([...(stored ?? []), window])
}

/** Dates in `range` that no stored window already covers. */
export function subtractWindows(range: FlexWindow, stored: FlexWindow[]): FlexWindow[] {
  let gaps: FlexWindow[] = [range]
  for (const s of mergeWindows(stored)) {
    const next: FlexWindow[] = []
    for (const g of gaps) {
      if (s.toDate < g.fromDate || s.fromDate > g.toDate) {
        next.push(g)
        continue
      }
      if (s.fromDate > g.fromDate) next.push({ fromDate: g.fromDate, toDate: ymdAdd(s.fromDate, -1) })
      if (s.toDate < g.toDate) next.push({ fromDate: ymdAdd(s.toDate, 1), toDate: g.toDate })
    }
    gaps = next
  }
  return gaps.filter(g => g.fromDate <= g.toDate)
}

export function rangeCovered(stored: FlexWindow[], fromDate: string, toDate: string): boolean {
  return subtractWindows({ fromDate, toDate }, stored).length === 0
}

/** Older-than-the-live-query pieces that are not already stored. */
export function pendingBackfill(primaryFrom: string | undefined, stored: FlexWindow[] | undefined): FlexWindow[] {
  const have = stored ?? []
  const pieces: FlexWindow[] = []
  for (const range of uncoveredFlexRanges(primaryFrom)) {
    pieces.push(...subtractWindows(range, have))
  }
  return pieces
}

export function backfillStatus(completed: number, total: number): string {
  // The window in progress, so two finished of three reads "2 of 3" while the last one loads.
  const shown = total <= 0 ? 0 : Math.min(total, Math.max(1, completed))
  return `Loading older history (${shown} of ${total} windows)...`
}

export function isRetryableFlexFailure(err: unknown): boolean {
  if (err && typeof err === 'object' && 'retryable' in err && (err as { retryable?: boolean }).retryable === true) return true
  const msg = err instanceof Error ? err.message : String(err ?? '')
  return /\b(1001|1004|1005|1018|1019|1021)\b/.test(msg)
    || /too many requests/i.test(msg)
    || /try again shortly/i.test(msg)
    || /statement not ready/i.test(msg)
}

const FLEX_CODES = /\b(1001|1004|1005|1018|1019|1021)\b/
const LATEST_WINDOW_NOTE = 'The latest window was not updated.'

/** Code from the thrown Flex error, or from the IBKR text when the proxy omitted it. */
export function flexFailureCode(err: unknown): string | undefined {
  if (err && typeof err === 'object' && 'code' in err) {
    const raw = (err as { code?: unknown }).code
    if (raw != null && FLEX_CODES.test(String(raw))) return String(raw).match(FLEX_CODES)?.[1]
  }
  const msg = err instanceof Error ? err.message : String(err ?? '')
  return msg.match(FLEX_CODES)?.[1]
}

/**
 * Copy for a failed primary (latest) window that can be retried.
 * 1018 is the token pace; 1019 means IBKR has not finished the statement.
 */
export function primaryWindowRetryMessage(err: unknown): string {
  const msg = (err instanceof Error ? err.message : String(err ?? '')).trim()
  const code = flexFailureCode(err)
  const tooMany = code === '1018' || /too many requests/i.test(msg)
  if (tooMany) {
    return `IBKR is limiting requests for this token. ${LATEST_WINDOW_NOTE} Try again in a minute.`
  }
  const notReady = code === '1019'
    || /statement not ready/i.test(msg)
    || /statement generation/i.test(msg)
  if (notReady) {
    return `The statement is not ready yet. ${LATEST_WINDOW_NOTE} Try again shortly.`
  }
  if (msg) {
    const withCode = code && !msg.includes(code) ? `${msg} (${code})` : msg
    return withCode.includes(LATEST_WINDOW_NOTE) ? withCode : `${withCode} ${LATEST_WINDOW_NOTE}`
  }
  return code
    ? `IBKR ${code}. ${LATEST_WINDOW_NOTE} Try again shortly.`
    : `IBKR could not finish this request. ${LATEST_WINDOW_NOTE} Try again shortly.`
}

const tokenTails = new Map<string, Promise<void>>()
const tokenFreeAt = new Map<string, number>()

/** One Flex token is in flight at a time, across every account that shares it. */
export function enqueueToken<T>(token: string, job: () => Promise<T>): Promise<T> {
  const prev = tokenTails.get(token) ?? Promise.resolve()
  const run = prev.then(start, start)
  tokenTails.set(token, run.then(() => undefined, () => undefined))
  return run

  async function start() {
    const wait = (tokenFreeAt.get(token) ?? 0) - Date.now()
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait))
    try {
      return await job()
    } finally {
      tokenFreeAt.set(token, Date.now() + SEND_GAP_MS)
    }
  }
}

export function followUpDelayMs(failedRounds: number): number | null {
  if (failedRounds >= MAX_BACKFILL_ROUNDS) return null
  return 15_000 * 2 ** Math.max(0, failedRounds - 1)
}

export interface BackfillState {
  stored: FlexWindow[]
  pending: FlexWindow[]
  /** How many of `total` older windows are already stored. */
  completed: number
  total: number
  failedRounds: number
}

export interface BackfillResult extends BackfillState {
  note: string | null
  error: string | null
  retryAfterMs: number | null
}

function outcome(state: BackfillState, hardError?: string): BackfillResult {
  if (hardError) {
    return { ...state, note: null, error: hardError, retryAfterMs: null }
  }
  if (state.pending.length === 0) {
    return { ...state, note: null, error: null, retryAfterMs: null }
  }
  if (state.failedRounds >= MAX_BACKFILL_ROUNDS) {
    return {
      ...state,
      note: null,
      error: 'Older history did not load after several tries. Sync again in a minute.',
      retryAfterMs: null,
    }
  }
  return {
    ...state,
    note: backfillStatus(state.completed, state.total),
    error: null,
    retryAfterMs: followUpDelayMs(state.failedRounds),
  }
}

/**
 * Fetch older windows one at a time. A retryable failure stops this round
 * and leaves the remaining windows pending. A stored window is never requested.
 */
export async function runFlexBackfill(opts: {
  state: BackfillState
  /** Recompute the queue from the live query's start. Omit on a follow-up that only resumes `pending`. */
  primaryFrom?: string
  fetchWindow: (window: FlexWindow) => Promise<void>
  sleep?: (ms: number) => Promise<void>
  gapMs?: number
  isRetryable?: (err: unknown) => boolean
  onProgress?: (note: string) => void
}): Promise<BackfillResult> {
  const sleep = opts.sleep ?? (ms => new Promise(r => setTimeout(r, ms)))
  const gapMs = opts.gapMs ?? SEND_GAP_MS
  const retryable = opts.isRetryable ?? isRetryableFlexFailure
  let stored = mergeWindows(opts.state.stored)
  let pending = opts.primaryFrom !== undefined
    ? pendingBackfill(opts.primaryFrom, stored)
    : opts.state.pending.filter(w => !rangeCovered(stored, w.fromDate, w.toDate))
  const total = opts.primaryFrom !== undefined
    ? pending.length
    : Math.max(opts.state.total, opts.state.completed + pending.length)
  let completed = opts.primaryFrom !== undefined ? 0 : Math.max(0, total - pending.length)
  let failedRounds = opts.primaryFrom !== undefined ? 0 : opts.state.failedRounds

  while (pending.length > 0) {
    const window = pending[0]
    if (rangeCovered(stored, window.fromDate, window.toDate)) {
      pending = pending.slice(1)
      continue
    }
    opts.onProgress?.(backfillStatus(completed, total))
    if (gapMs > 0) await sleep(gapMs)
    try {
      await opts.fetchWindow(window)
    } catch (err) {
      const state: BackfillState = { stored, pending, completed, total, failedRounds: failedRounds + 1 }
      if (retryable(err)) return outcome(state)
      const msg = err instanceof Error ? err.message : 'Flex backfill failed'
      return outcome(state, `Older history did not load: ${msg}`)
    }
    stored = addWindow(stored, window)
    pending = pending.slice(1)
    completed += 1
    failedRounds = 0
  }

  return outcome({ stored, pending, completed, total, failedRounds })
}
