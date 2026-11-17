import {
  buildSummary,
  dedupeFirmRows,
  statsFromDisplayRows,
} from '../api/_lib/analystTargets.js'

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