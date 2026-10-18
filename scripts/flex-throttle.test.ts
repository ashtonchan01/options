/**
 * Flex backfill pacing: IBKR 1018 is retried, stored windows are not
 * fetched again, and a round that runs out of budget resumes instead of
 * failing the sync.
 * Run with: npm test
 */
import { build } from 'esbuild'
import { mkdirSync } from 'fs'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { fetchFlexStatement, flexBackoffMs } from '../api/_lib/flexStatement.js'
import {
  SEND_GAP_MS,
  backfillStatus,
  enqueueToken,
  pendingBackfill,
  runFlexBackfill,
  type FlexWindow,
} from '../src/services/flexPace'

let failed = 0
function check(name: string, ok: boolean, detail?: string) {
  if (ok) console.log(`ok  ${name}`)
  else {
    failed++
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

const fail1018 = `<FlexStatementResponse timestamp='18 October, 2026 05:08 AM EDT'>
  <Status>Fail</Status>
  <ErrorCode>1018</ErrorCode>
  <ErrorMessage>Too many requests have been made from this token. Please try again shortly.</ErrorMessage>
</FlexStatementResponse>`

const reference = `<FlexStatementResponse><Status>Success</Status><ReferenceCode>ABC123</ReferenceCode></FlexStatementResponse>`
const statement = `<?xml version="1.0"?><FlexQueryResponse><FlexStatements><FlexStatement fromDate="20250701" toDate="20251017"></FlexStatement></FlexStatements></FlexQueryResponse>`

{
  const urls: string[] = []
  const delays: number[] = []
  let t = 0
  const result = await fetchFlexStatement({
    token: 'tok',
    query: '1609127',
    fd: '20250701',
    td: '20251017',
    budgetMs: 120_000,
    now: () => t,
    sleep: async (ms: number) => {
      delays.push(ms)
      t += ms
    },
    fetchImpl: async (url: string) => {
      urls.push(url)
      if (urls.length === 1) return fail1018
      if (urls.length === 2) return reference
      if (urls.length === 3) return fail1018
      return statement
    },
  })
  check('1018 then a later statement succeeds', result.ok === true && result.xml?.includes('<FlexQueryResponse'), JSON.stringify(result))
  check('SendRequest was retried before GetStatement', urls.length === 4 && urls[0].includes('SendRequest') && urls[1].includes('SendRequest') && urls[2].includes('GetStatement') && urls[3].includes('GetStatement'), urls.map(u => u.split('/').pop()?.split('?')[0]).join(','))
  check('the dated window is only on SendRequest', urls[0].includes('fd=20250701') && urls[0].includes('td=20251017') && !urls[2].includes('fd='))
  check(
    'backoff waits after 1018 and before the first poll',
    delays[0] === flexBackoffMs('1018', 0) && delays[1] === flexBackoffMs('1019', 0) && delays[2] === flexBackoffMs('1018', 1),
    `delays ${delays.join(',')}`,
  )
  check('1018 backoff is at least a few seconds', delays[0] >= 5_000)
  check('the neutral status counts windows still loading', backfillStatus(2, 3) === 'Loading older history (2 of 3 windows)...')
}

{
  const urls: string[] = []
  let t = 0
  const result = await fetchFlexStatement({
    token: 'tok',
    query: '1609127',
    budgetMs: 5_000,
    now: () => t,
    sleep: async (ms: number) => { t += ms },
    fetchImpl: async (url: string) => {
      urls.push(url)
      return fail1018
    },
  })
  check('a 1018 that does not fit the function budget stays retryable', result.ok === false && result.retryable === true && result.code === '1018', JSON.stringify(result))
  check('the budget stops a second SendRequest', urls.length === 1, `calls ${urls.length}`)
}

{
  const result = await fetchFlexStatement({
    token: 'tok',
    query: '1609127',
    budgetMs: 30_000,
    now: () => 0,
    sleep: async () => {},
    fetchImpl: async () => `<FlexStatementResponse><Status>Fail</Status><ErrorCode>1003</ErrorCode><ErrorMessage>Invalid request</ErrorMessage></FlexStatementResponse>`,
  })
  check('a non-retryable Flex error is not retried', result.ok === false && result.retryable === false && result.code === '1003', JSON.stringify(result))
}

{
  const stored = [
    { fromDate: '20250701', toDate: '20251017' },
    { fromDate: '20251018', toDate: '20261017' },
  ]
  const again = pendingBackfill('20251018', stored)
  check('a stored backfill chunk is not fetched again', again.length === 0, JSON.stringify(again))
  const later = pendingBackfill('20251118', stored)
  check('a later sync does not refetch history the previous windows already covered', later.length === 0, JSON.stringify(later))
  const missing = pendingBackfill('20251118', [{ fromDate: '20251018', toDate: '20261017' }])
  check(
    'only the uncovered older piece is requested',
    missing.length === 1 && missing[0].fromDate === '20250701' && missing[0].toDate === '20251017',
    JSON.stringify(missing),
  )
}

{
  const fetched: FlexWindow[] = []
  const first = await runFlexBackfill({
    state: { stored: [], pending: [], completed: 0, total: 0, failedRounds: 0 },
    primaryFrom: '20251018',
    gapMs: 0,
    fetchWindow: async () => {
      throw Object.assign(new Error('IBKR: Too many requests have been made from this token. Please try again shortly.'), { retryable: true })
    },
  })
  check('a retryable backfill failure is not a red error', first.error === null && first.note === backfillStatus(0, 1), JSON.stringify(first))
  check('the unfinished window stays pending', first.pending.length === 1 && first.pending[0].fromDate === '20250701' && first.retryAfterMs === 15_000, JSON.stringify(first.pending))

  const second = await runFlexBackfill({
    state: first,
    gapMs: 0,
    fetchWindow: async window => { fetched.push(window) },
  })
  check('the follow-up stores the window it could not finish', second.pending.length === 0 && second.error === null && second.note === null && fetched.length === 1 && fetched[0].toDate === '20251017', JSON.stringify(second))

  let refetched = false
  const third = await runFlexBackfill({
    state: second,
    primaryFrom: '20251018',
    gapMs: 0,
    fetchWindow: async () => { refetched = true },
  })
  check('the next sync does not request the stored window', third.pending.length === 0 && refetched === false)
}

{
  let state = {
    stored: [] as FlexWindow[],
    pending: [{ fromDate: '20250701', toDate: '20251017' }],
    completed: 0,
    total: 1,
    failedRounds: 0,
  }
  for (let i = 0; i < 3; i++) {
    state = await runFlexBackfill({
      state,
      gapMs: 0,
      fetchWindow: async () => { throw new Error('IBKR 1018: Too many requests') },
    })
  }
  check('three failed rounds become an error and stop the follow-up', state.failedRounds === 3 && state.error === 'Older history did not load after several tries. Sync again in a minute.' && state.retryAfterMs === null && state.note === null, JSON.stringify(state))
}

{
  const delays: number[] = []
  const windows: string[] = []
  const result = await runFlexBackfill({
    state: { stored: [], pending: [], completed: 0, total: 0, failedRounds: 0 },
    primaryFrom: '20280101',
    gapMs: SEND_GAP_MS,
    sleep: async (ms: number) => { delays.push(ms) },
    fetchWindow: async window => { windows.push(`${window.fromDate}-${window.toDate}`) },
  })
  check('chunks are fetched serially with a gap between SendRequests', windows.length >= 2 && delays.length === windows.length && delays.every(ms => ms === SEND_GAP_MS), `${windows.length} windows, delays ${delays.join(',')}`)
  check('a finished backfill has nothing left pending', result.pending.length === 0 && result.note === null)
}

{
  let started = 0
  let release: (() => void) | undefined
  const first = enqueueToken('shared-token', () => new Promise<void>(resolve => { started++; release = resolve }))
  let secondStarted = false
  const second = enqueueToken('shared-token', async () => { secondStarted = true })
  await Promise.resolve()
  check('the same token does not run two Flex syncs at once', started === 1 && secondStarted === false)
  release?.()
  const gapStarted = Date.now()
  await first
  await second
  check('the second sync starts after the first finishes', secondStarted === true)
  check('the same token waits before its next Flex sync', Date.now() - gapStarted >= SEND_GAP_MS - 50, `${Date.now() - gapStarted}ms`)
}

{
  const note = 'Loading older history (2 of 3 windows)...'
  const dir = join(new URL('..', import.meta.url).pathname, 'node_modules/.tmp')
  mkdirSync(dir, { recursive: true })
  const outfile = join(dir, 'flex-ui-render.mjs')
  await build({
    stdin: {
      contents: `
        import { createElement } from 'react'
        import { renderToStaticMarkup } from 'react-dom/server'
        import FlexSyncBar from './src/components/shared/FlexSyncBar.tsx'
        import AccountUploadBar from './src/components/shared/AccountUploadBar.tsx'
        const note = ${JSON.stringify(note)}
        const syncHtml = renderToStaticMarkup(createElement(FlexSyncBar, {
          savedToken: 'token', savedQueryId: '1609127', loading: false, error: null, note, onSync: () => {},
        }))
        const uploadHtml = renderToStaticMarkup(createElement(AccountUploadBar, {
          label: 'Business', loading: false, error: null, onUpload: () => {}, onClear: () => {},
        }))
        export { syncHtml, uploadHtml }
      `,
      loader: 'ts',
      resolveDir: new URL('..', import.meta.url).pathname,
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    jsx: 'automatic',
    packages: 'external',
    outfile,
  })
  const rendered = await import(pathToFileURL(outfile).href) as { syncHtml: string; uploadHtml: string }
  check('the sync bar shows the backfill status without a red error', rendered.syncHtml.includes(note) && !rendered.syncHtml.includes('#ef4444'))
  check('the upload box does not repeat the sync status', !rendered.uploadHtml.includes(note) && !rendered.uploadHtml.includes('Too many requests') && !rendered.uploadHtml.includes('#ef4444'))
}

if (failed > 0) {
  console.error(`\n${failed} failed`)
  process.exit(1)
}
console.log('\nall passed')
