/**
 * Overview covered-call and put credits come from the live option bid.
 * Run with: npm test
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { DEFAULT_INCOME_SETTINGS } from '../src/income/incomeSeed'
import { recommendCalls, recommendPuts, toLiveBook } from '../src/income/incomeLive'
import {
  BID_STALE_MS,
  bidPremium,
  bidQuoteLabel,
  buildCallRecs,
  buildPutRows,
  incomeScanSymbols,
  parseCboeChain,
  parseCboeTimestamp,
  pickLeg,
  quoteIsStale,
  type ChainLeg,
  type SymbolChain,
} from '../src/income/livePremium'
import PlanCards from '../src/components/overview/PlanCards'
import type { Account } from '../src/store/accountsStore'

let failed = 0
function check(name: string, ok: boolean, detail?: string) {
  if (ok) console.log(`ok  ${name}`)
  else {
    failed++
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

check('premium is bid times 100 times contracts', bidPremium(3.4, 3) === 1_020)
check('a missing, zero, or blank bid is not a premium', bidPremium(null, 3) == null && bidPremium(0, 3) == null && bidPremium(undefined, 1) == null)

const spot = 126
const expiry = '2026-11-20'
function call(strike: number, bid: number | null, delta: number | null): ChainLeg {
  return { strike, putCall: 'C', expiry, bid, ask: bid, delta, iv: 0.7 }
}
const legs: ChainLeg[] = [
  call(175, 3.4, 0.04),
  call(150, 0, 0.25),
  call(145, null, 0.28),
  call(140, 2.4, 0.25),
  call(130, 4, 0.4),
  { strike: 110, putCall: 'P', expiry, bid: 2, ask: 2.2, delta: -0.24, iv: 0.7 },
  { strike: 100, putCall: 'P', expiry, bid: 0, ask: 0.4, delta: -0.2, iv: 0.7 },
]

const picked = pickLeg(legs, { putCall: 'C', expiry, spot, deltaMin: 0.2, deltaMax: 0.3 })
check('strike follows the live spot, not the October 175 call', picked?.strike === 140, String(picked?.strike))
check('a zero bid and a null bid are dropped', picked?.bid === 2.4 && !legs.filter(leg => leg.bid == null || leg.bid === 0).some(leg => leg.strike === picked?.strike))

const closed = Date.parse('2026-11-09T21:00:00.000Z')
const chain: SymbolChain = { quotedAt: closed, legs }
const settings = { screenExpiry: expiry, deltaMin: 0.2, deltaMax: 0.3 }
const calls = buildCallRecs(
  [{ symbol: 'MSTR', shares: 300 }, { symbol: 'TSLA', shares: 50 }],
  { MSTR: chain },
  { MSTR: spot, TSLA: 400 },
  settings,
  new Date('2026-11-10T02:00:00Z'),
  false,
)
check('three contracts credit the live bid', calls.length === 1 && calls[0].premium === 720 && calls[0].strike === 140 && calls[0].spot === 126, JSON.stringify(calls))
check('a closed market marks the bid stale', calls[0].stale === true)
check('a fresh bid during the session is not stale', quoteIsStale(Date.now(), Date.now(), true) === false)
check('an old bid during the session is stale', quoteIsStale(Date.now() - BID_STALE_MS - 1, Date.now(), true) === true)

const puts = buildPutRows(['MSTR'], { MSTR: 'Skip: BTC cap' }, { MSTR: chain }, { MSTR: spot }, settings)
check('puts use the same bid credit and drop a zero bid', puts.length === 1 && puts[0].strike === 110 && puts[0].premium === 200 && puts[0].cash === 11_000)

const label = bidQuoteLabel(closed)
check('the quote label names the bid and the New York time', label.startsWith('bid ·') && label.includes('Nov') && label.includes('4:00'), label)
check('a missing timestamp stays a bid with no clock', bidQuoteLabel(null) === 'bid · time unavailable')

const parsed = parseCboeChain({
  timestamp: '2026-11-09 16:00:00',
  data: {
    options: [
      { option: 'MSTR261120C00175000', bid: 0.05, ask: 0.1, delta: 0.02, iv: 0.8 },
      { option: 'MSTR261120C00140000', bid: 2.4, ask: 2.6, delta: 0.25, iv: 0.8 },
    ],
  },
})
check('the chain timestamp is read and a modelled mid is never stored', parsed.legs.length === 2 && parsed.quotedAt != null && parsed.legs.every(leg => !('mid' in leg) && !('theo' in leg)))
check('a zone-less chain timestamp is UTC', parseCboeTimestamp('2026-11-09 21:00:00') === closed, String(parseCboeTimestamp('2026-11-09 21:00:00')))

const account: Account = {
  id: 'Personal',
  name: 'Personal',
  trades: [],
  positions: [
    { accountId: 'x', symbol: 'MSTR', description: 'MSTR', assetClass: 'STK', quantity: 300, costBasisPrice: 1, costBasisMoney: 300, markPrice: 145, positionValue: 1, unrealizedPnL: 0, currency: 'USD' },
  ],
  cashBalance: 0,
  netLiquidation: 1,
  excessLiquidity: 40_000,
}
const screened = recommendPuts([
  { symbol: 'MSTR', premium: 200, cash: 11_000, delta: -0.24, bid: 2 },
  { symbol: 'IBIT', premium: 100, cash: 5_000, delta: -0.22, bid: 1 },
  { symbol: 'SPCX', premium: 200, cash: 13_000, delta: -0.18, bid: 2 },
  { symbol: 'ARM', premium: 400, cash: 18_000, delta: -0.25, bid: 0 },
], DEFAULT_INCOME_SETTINGS)
check('a good put stays even when a saved rule or the exclude list names it', screened.map(row => row.symbol).join(',') === 'IBIT,MSTR', screened.map(row => row.symbol).join(','))
check('an empty watchlist still scans the default names, including MSTR', incomeScanSymbols([]).includes('MSTR') && incomeScanSymbols(undefined).includes('TSLA'))
check('a watchlist is priced as given', incomeScanSymbols(['baba']).join(',') === 'BABA')
check('held shares join the put scan and a flat holding does not', incomeScanSymbols(['NVDA'], [{ symbol: 'mstr', shares: 10 }, { symbol: 'SOFI', shares: 0 }]).join(',') === 'NVDA,MSTR')

const coverBook = toLiveBook({
  name: 'Personal',
  positions: [
    { accountId: 'x', symbol: 'AAA', description: 'AAA', assetClass: 'STK', quantity: 100, costBasisPrice: 1, costBasisMoney: 100, markPrice: 100, positionValue: 100, unrealizedPnL: 0, currency: 'USD' },
    { accountId: 'x', symbol: 'BBB', description: 'BBB', assetClass: 'STK', quantity: 100, costBasisPrice: 1, costBasisMoney: 100, markPrice: 100, positionValue: 100, unrealizedPnL: 0, currency: 'USD' },
    { accountId: 'x', symbol: 'TSLA', description: 'TSLA', assetClass: 'STK', quantity: 50, costBasisPrice: 1, costBasisMoney: 50, markPrice: 400, positionValue: 20_000, unrealizedPnL: 0, currency: 'USD' },
  ],
  trades: [],
  cashBalance: 1,
  netLiquidation: 1,
}, new Date('2026-11-10T02:00:00Z'))
const rankedCalls = recommendCalls([
  { symbol: 'AAA', premium: 100, spot: 100, contracts: 1, delta: 0.25, bid: 1 },
  { symbol: 'BBB', premium: 300, spot: 100, contracts: 1, delta: 0.22, bid: 3 },
  { symbol: 'TSLA', premium: 500, spot: 400, contracts: 1, delta: 0.25, bid: 5 },
  { symbol: 'QQQ', premium: 400, spot: 400, contracts: 1, delta: 0.5, bid: 4 },
], coverBook, DEFAULT_INCOME_SETTINGS)
check('calls rank by yield and drop a name the shares do not cover', rankedCalls.map(row => row.symbol).join(',') === 'BBB,AAA', rankedCalls.map(row => row.symbol).join(','))

const html = renderToStaticMarkup(createElement(PlanCards, {
  account,
  settings: DEFAULT_INCOME_SETTINGS,
  today: new Date(2026, 10, 9, 18, 0, 0),
  liveScreen: {
    loaded: true,
    calls: [
      ...calls,
      { symbol: 'TSLA', strike: 400, contracts: 1, spot: 400, bid: 5, premium: 500, delta: 0.25, quotedAt: closed, stale: false },
    ],
    puts: [
      ...puts,
      { symbol: 'IBIT', strike: 50, spot: 60, mid: 1, bid: 1, ask: 1.1, delta: -0.22, iv: 0.4, premium: 100, cash: 5_000, note: '' },
      { symbol: 'SPCX', strike: 130, spot: 147, mid: 2, bid: 2, ask: 2.2, delta: -0.18, iv: 0.5, premium: 200, cash: 13_000, note: '' },
      { symbol: 'ARM', strike: 180, spot: 200, mid: 0, bid: 0, ask: 0.4, delta: -0.25, iv: 0.5, premium: 400, cash: 18_000, note: '' },
    ],
    putQuotedAt: { MSTR: closed },
    putStale: { MSTR: true },
  },
}))
check('the card shows the bid stamp beside the credit', html.includes('data-testid="premium-quote"') && html.includes(label) && html.includes('Stale') && html.includes('140C') && html.includes('720'))
check('the October 175 call premium is not rendered', !html.includes('175C') && !html.includes('1,020'))
check('a good MSTR put and an ETF put both stay on the card', html.includes('110P') && html.includes('IBIT') && html.includes('50P'))
check('ticker rules are not painted on the recommendations', !html.includes('No puts') && !html.includes('Excluded') && !html.includes('No calls'))
check('a strike outside the delta band, a zero bid, and an uncovered call are left off', !html.includes('SPCX') && !html.includes('ARM') && !html.includes('400C'))

if (failed > 0) {
  console.error(`${failed} failed`)
  process.exit(1)
}
console.log('live bid premium ok')
