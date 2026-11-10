/**
 * Overview covered-call and put credits come from the live option bid.
 * Run with: npm test
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { DEFAULT_INCOME_SETTINGS } from '../src/income/incomeSeed'
import {
  BID_STALE_MS,
  bidPremium,
  bidQuoteLabel,
  buildCallRecs,
  buildPutRows,
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
const html = renderToStaticMarkup(createElement(PlanCards, {
  account,
  settings: DEFAULT_INCOME_SETTINGS,
  today: new Date(2026, 10, 9, 18, 0, 0),
  liveScreen: {
    loaded: true,
    calls,
    puts,
    putQuotedAt: { MSTR: closed },
    putStale: { MSTR: true },
  },
}))
check('the card shows the bid stamp beside the credit', html.includes('data-testid="premium-quote"') && html.includes(label) && html.includes('Stale') && html.includes('140C') && html.includes('720'))
check('the October 175 call premium is not rendered', !html.includes('175C') && !html.includes('1,020'))

if (failed > 0) {
  console.error(`${failed} failed`)
  process.exit(1)
}
console.log('live bid premium ok')
