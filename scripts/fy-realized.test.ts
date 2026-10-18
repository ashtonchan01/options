/**
 * FY realised P&L against the U21440275 Activity Statement, 20 Aug 2025 –
 * 30 Jun 2026. The fixture is the statement's per-symbol summary and trades.
 * Run with: npm test
 */
import { readFileSync } from 'node:fs'
import type { RawTrade } from '../src/types'
import { buildJournalPositions } from '../src/engine/journal'
import {
  closesMissingRealized,
  fyStartYearOf,
  inFy,
  isLongTerm,
  realizedLines,
  summarize,
} from '../src/engine/realizedFy'
import { tradesFromFixture, type StatementFixture } from '../src/engine/statementFixture'
import { inclusiveDays, replaceTradeWindow, uncoveredFlexRanges, ymdAdd } from '../src/services/flexWindow'

let failed = 0
function check(name: string, ok: boolean, detail?: string) {
  if (ok) console.log(`ok  ${name}`)
  else {
    failed++
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

const fixture = JSON.parse(readFileSync(new URL('./fixtures/ibkr-u21440275-fy2025-26.json', import.meta.url), 'utf8')) as StatementFixture
const trades = tradesFromFixture(fixture)
const lines = realizedLines(trades, fixture.fyStartYear)
const totals = summarize(lines)
const bySymbol = new Map(lines.map(l => [`${l.category}|${l.symbol}`, l]))

check('official total is the printed all-assets figure', fixture.official.total === 22773.85)
check(
  'stocks + options + forex is the printed total',
  Math.abs(fixture.official.stocks + fixture.official.options + fixture.official.forex - fixture.official.total) < 1e-9,
)
const identity = fixture.official.stocks + fixture.official.options + fixture.official.forex
check(
  'other fees are not part of the realised total',
  Math.abs(identity + fixture.official.otherFees - fixture.official.total) > 0.5,
)
check(
  'broker interest is not part of the realised total',
  Math.abs(identity + fixture.official.brokerInterest - fixture.official.total) > 1,
)

check('stocks realised matches 3,242.20', Math.abs(totals.stocks.total - 3242.20) < 0.001, `got ${totals.stocks.total}`)
check(
  'options realised is within 50 cents of the printed 18,452.31',
  Math.abs(totals.options.total - 18452.31) <= 0.5,
  `got ${totals.options.total} delta ${(totals.options.total - 18452.31).toFixed(2)}`,
)
check(
  'forex realised is within a cent of 1,079.34',
  Math.abs(totals.forex.total - 1079.34) <= 0.02,
  `got ${totals.forex.total}`,
)
check('forex short-term profit matches 1,604.87', Math.abs(totals.forex.stProfit - 1604.87) < 0.001)
check('forex short-term loss matches -525.54', Math.abs(totals.forex.stLoss - -525.54) < 0.001)
check('forex has no long-term', totals.forex.ltProfit === 0 && totals.forex.ltLoss === 0)
check(
  'all-assets total is within 50 cents of 22,773.85',
  Math.abs(totals.all.total - 22773.85) <= 0.5,
  `got ${totals.all.total} delta ${(totals.all.total - 22773.85).toFixed(2)}`,
)

const mismatches: string[] = []
for (const symbol of fixture.symbols) {
  const line = bySymbol.get(`${symbol.category}|${symbol.symbol}`)
  const got = line?.total ?? 0
  if (Math.abs(got - symbol.realized) > 0.02) {
    mismatches.push(`${symbol.symbol} statement ${symbol.realized} engine ${got}`)
  }
}
check('every summary symbol matches within 2 cents', mismatches.length === 0, mismatches.slice(0, 8).join('; '))

const extras = lines.filter(l => Math.abs(l.total) > 0.02 && !fixture.symbols.some(s => s.category === l.category && s.symbol === l.symbol))
check('no extra non-zero symbols', extras.length === 0, extras.map(l => l.symbol).join(', '))

const mstr = bySymbol.get('stocks|MSTR')
check('MSTR stock realised is 2,068.13 and not the assignment premium on top', mstr != null && Math.abs(mstr.total - 2068.13) < 0.001, `got ${mstr?.total}`)
const assignedCall = bySymbol.get('options|MSTR 03OCT25 350 C')
check('assigned MSTR call contributes 0, not its 419.20 premium', (assignedCall?.total ?? 0) === 0, `got ${assignedCall?.total}`)
const expired = bySymbol.get('options|MSTR 22AUG25 340 P')
check('expiry books the premium on the trade date', expired != null && Math.abs((expired?.total ?? 0) - 699.30) < 0.02, `got ${expired?.total}`)

const pltr = trades.find(t => t.underlyingSymbol === 'PLTR' && t.tradeDate === '20260701' && t.tradeTime === '020102')
check('PLTR 02:01 on 1 Jul 2026 is inside FY2025-26', !!pltr && inFy(pltr!, 2025) && fyStartYearOf(pltr!) === 2025)
check('that same trade is outside FY2026-27', !!pltr && !inFy(pltr!, 2026))
check('10:00 on 1 Jul 2026 opens FY2026-27', fyStartYearOf({ tradeDate: '20260701', tradeTime: '100000' }) === 2026)
check('09:59 on 1 Jul 2026 stays in FY2025-26', fyStartYearOf({ tradeDate: '20260701', tradeTime: '095900' }) === 2025)
check('a dateless 1 Jul is the new FY', fyStartYearOf({ tradeDate: '20260701' }) === 2026)
check('a dateless 30 Jun stays in the old FY', fyStartYearOf({ tradeDate: '20260630' }) === 2025)

check('anniversary date is still short-term', isLongTerm('20250913', '20240913') === false)
check('the day after the anniversary is long-term', isLongTerm('20250914', '20240913') === true)

const nvdaSplit: RawTrade = {
  accountId: 'U21440275',
  assetClass: 'STK',
  symbol: 'NVDA',
  tradeDate: '20250913',
  tradeTime: '062000',
  quantity: -10,
  tradePrice: 175,
  proceeds: 1750,
  commissions: -0.02,
  netCash: 0,
  openClose: 'C',
  fifoPnlRealized: 674.91,
  closedLots: [
    { quantity: -4, tradeDate: '20250913', tradePrice: 0, proceeds: 0, commissions: 0, cost: 0, fifoPnlRealized: 227.97, origTradeDate: '20250820' },
    { quantity: -6, tradeDate: '20250913', tradePrice: 0, proceeds: 0, commissions: 0, cost: 0, fifoPnlRealized: 446.94, origTradeDate: '20240801' },
  ],
}
const split = realizedLines([nvdaSplit], 2025)
check('mixed lots split short-term and long-term', split.length === 1 && Math.abs(split[0].stProfit - 227.97) < 0.001 && Math.abs(split[0].ltProfit - 446.94) < 0.001, JSON.stringify(split[0]))
check('mixed lots still sum to the parent fifo', split.length === 1 && Math.abs(split[0].total - 674.91) < 0.001)

const parentOnly = realizedLines([{ ...nvdaSplit, closedLots: undefined }], 2025)
check('a fill with no lot open dates stays entirely short-term', parentOnly.length === 1 && parentOnly[0].ltProfit === 0 && Math.abs(parentOnly[0].stProfit - 674.91) < 0.001)

check('fixture closes all carry fifo, so nothing is flagged missing', closesMissingRealized(trades, 2025).length === 0)

{
  const withFifo = buildJournalPositions([
    opt({ symbol: 'MSTR', tradeDate: '20250901', tradeTime: '100000', quantity: -1, tradePrice: 4.192, strike: 350, putCall: 'C', expiry: '20251003', openClose: 'O' }),
    opt({ symbol: 'MSTR', tradeDate: '20251004', tradeTime: '062000', quantity: 1, tradePrice: 0, strike: 350, putCall: 'C', expiry: '20251003', openClose: 'C', fifoPnlRealized: 0 }),
  ], {})
  check('assignment fifo of 0 is the option P&L', withFifo.length === 1 && withFifo[0].pnl === 0, `pnl ${withFifo[0]?.pnl}`)

  const cash = buildJournalPositions([
    opt({ symbol: 'MSTR', tradeDate: '20250901', tradeTime: '100000', quantity: -1, tradePrice: 4.192, strike: 350, putCall: 'C', expiry: '20251003', openClose: 'O' }),
    opt({ symbol: 'MSTR', tradeDate: '20251004', tradeTime: '062000', quantity: 1, tradePrice: 0, strike: 350, putCall: 'C', expiry: '20251003', openClose: 'C' }),
  ], {})
  check('a close without fifo keeps the cash P&L', cash.length === 1 && Math.abs((cash[0].pnl ?? 0) - 419.2) < 0.01, `pnl ${cash[0]?.pnl}`)

  const marked = buildJournalPositions([
    opt({ symbol: 'ALAB', tradeDate: '20260203', tradeTime: '023814', quantity: -1, tradePrice: 2.32, strike: 165, putCall: 'C', expiry: '20260206', openClose: 'O' }),
    opt({ symbol: 'ALAB', tradeDate: '20260207', tradeTime: '055402', quantity: 1, tradePrice: 4.4, strike: 165, putCall: 'C', expiry: '20260206', openClose: 'C', fifoPnlRealized: -209.32 }),
  ], {})
  check('a close with fifo uses that figure', marked.length === 1 && marked[0].pnl === -209.32, `pnl ${marked[0]?.pnl}`)
}

{
  const one = uncoveredFlexRanges('20251018')
  check('a 2025-10-18 window backfills one chunk through the day before', one.length === 1 && one[0].fromDate === '20250701' && one[0].toDate === '20251017', JSON.stringify(one))
  check('the backfill chunk is at most 365 days', one.every(r => inclusiveDays(r.fromDate, r.toDate) <= 365))
  check('a window that already starts on 1 Jul 2025 needs no backfill', uncoveredFlexRanges('20250701').length === 0)
  check('a missing window needs no backfill', uncoveredFlexRanges(undefined).length === 0)
  const later = uncoveredFlexRanges('20280101')
  check('a 2028 window is several chunks', later.length >= 2, JSON.stringify(later))
  check('every later chunk is at most 365 days', later.every(r => inclusiveDays(r.fromDate, r.toDate) <= 365))
  check('later chunks start at 1 Jul 2025', later[later.length - 1].fromDate === '20250701')
  check('later chunks end the day before the primary window', later[0].toDate === ymdAdd('20280101', -1))
  for (let i = 0; i < later.length - 1; i++) {
    check(`chunk ${i} meets the next`, ymdAdd(later[i + 1].toDate, 1) === later[i].fromDate, `${later[i + 1].toDate} -> ${later[i].fromDate}`)
  }
}

{
  const existing = [
    { tradeDate: '20250601', symbol: 'OLD' },
    { tradeDate: '20250901', symbol: 'GAP' },
    { tradeDate: '20251101', symbol: 'NEW' },
  ]
  const merged = replaceTradeWindow(existing, [{ tradeDate: '20250915', symbol: 'FILL' }], '20250701', '20251017')
  check('backfill keeps trades after its end date', !!merged && merged.some(t => t.symbol === 'NEW') && merged.some(t => t.symbol === 'FILL') && !merged.some(t => t.symbol === 'GAP'))
  check('backfill keeps trades before its start', !!merged && merged.some(t => t.symbol === 'OLD'))
  const tail = replaceTradeWindow(existing, [{ tradeDate: '20251102', symbol: 'SYNC' }], '20251018')
  check('a primary sync with no end date still replaces its tail', !!tail && tail.some(t => t.symbol === 'OLD') && tail.some(t => t.symbol === 'GAP') && tail.some(t => t.symbol === 'SYNC') && !tail.some(t => t.symbol === 'NEW'))
}

function opt(partial: Partial<RawTrade> & Pick<RawTrade, 'tradeDate' | 'quantity' | 'tradePrice' | 'symbol'>): RawTrade {
  return {
    underlyingSymbol: partial.symbol,
    assetClass: 'OPT',
    putCall: 'P',
    strike: 100,
    expiry: '20261218',
    proceeds: 0,
    commissions: 0,
    netCash: 0,
    ...partial,
  }
}

console.log(`engine FY2025-26 U21440275  stocks ${totals.stocks.total.toFixed(2)}  options ${totals.options.total.toFixed(2)}  forex ${totals.forex.total.toFixed(2)}  total ${totals.all.total.toFixed(2)}`)

if (failed > 0) {
  console.error(`${failed} failed`)
  process.exit(1)
}
console.log('fy realised checks passed')
