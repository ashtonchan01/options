import {
  buildSummary,
  countNamedFirmRows,
  dedupeFirmRows,
  statsFromDisplayRows,
} from '../api/_lib/analystTargets.js'
import { mergeLiveAnalystPayloads } from '../api/_lib/analystTargetProviders/mergeAnalystLive.js'

function check(label: string, ok: boolean) {
  if (!ok) throw new Error(label)
  console.log('ok', label)
}

const seedRows = [
  {
    id: 'seed:a',
    ticker: 'SPCX',
    firm: 'Goldman Sachs',
    priceTarget: 245,
    date: '2026-11-13',
    source: 'seed',
    isManual: false,
  },
  {
    id: 'seed:b',
    ticker: 'SPCX',
    firm: 'Morgan Stanley',
    priceTarget: 300,
    date: '2026-11-16',
    source: 'seed',
    isManual: false,
  },
]

const summary = buildSummary(null, seedRows, null)
check('SPCX high from seed rows', summary.high === 300)
check('SPCX low from seed rows', summary.low === 245)
check('SPCX count from seed rows', summary.count === 2)

const deduped = dedupeFirmRows([
  { firm: 'Goldman Sachs', date: '2026-11-10', priceTarget: 200, source: 'live' },
  { firm: 'Goldman Sachs', date: '2026-11-13', priceTarget: 245, source: 'seed' },
])
check('newer firm row wins', deduped.length === 1 && deduped[0].priceTarget === 245)

const stats = statsFromDisplayRows(seedRows)
check('stats median', stats.median === 272.5)

const consensus = { median: 34, high: 42, low: 27, count: 9 }
const named = countNamedFirmRows(seedRows)
check('named firm count', named === 2)
const built = buildSummary(consensus, seedRows, '2026-11-17')
check('summary count from consensus', built.count === 9)
check('named firm count on summary', built.namedFirmCount === 2)

const merged = mergeLiveAnalystPayloads([
  { summary: { median: 10, high: 12, low: 8, count: 5 }, rows: [{ firm: 'Alpha', priceTarget: 10, date: '2026-01-01', source: 'live' }] },
  { summary: { median: 11, high: 13, low: 9, count: 9 }, rows: [{ firm: 'Alpha', priceTarget: 11, date: '2026-06-01', source: 'live' }, { firm: 'Beta', priceTarget: 9, date: '2026-03-01', source: 'live' }] },
])
check('merge keeps newer firm row', merged.rows.length === 2 && merged.rows.find(r => r.firm === 'Alpha')?.priceTarget === 11)
check('merge count is max across sources', merged.summary?.count === 9)