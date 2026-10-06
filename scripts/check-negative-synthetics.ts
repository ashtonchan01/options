/**
 * Underwater synthetic longs (long call + short put, net mark <= 0) must
 * show on their own ticker row — negative Current $, Current %, and the
 * matched contract count — and must not be dumped into OTHER.
 *
 * Run with: npx tsx --tsconfig tsconfig.app.json scripts/check-negative-synthetics.ts
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { RawPosition } from '../src/types'
import { emptyAppState } from '../src/components/shared/syntheticAccountState'
import PortfolioAllocationView, {
  currentAllocationSlices,
  fmt$,
  holdingsFromPositions,
} from '../src/components/allocation/PortfolioAllocationView'

let failed = 0
function check(name: string, ok: boolean, detail?: string) {
  if (ok) console.log(`ok  ${name}`)
  else {
    failed++
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

function opt(partial: {
  symbol: string
  underlying: string
  putCall: 'C' | 'P'
  quantity: number
  positionValue: number
  unrealizedPnL?: number
  markPrice?: number
  strike?: number
  expiry?: string
}): RawPosition {
  return {
    accountId: 'acct',
    symbol: partial.symbol,
    description: partial.symbol,
    assetClass: 'OPT',
    quantity: partial.quantity,
    costBasisPrice: 0,
    costBasisMoney: 0,
    markPrice: partial.markPrice ?? 0,
    positionValue: partial.positionValue,
    unrealizedPnL: partial.unrealizedPnL ?? 0,
    putCall: partial.putCall,
    strike: partial.strike,
    expiry: partial.expiry,
    underlyingSymbol: partial.underlying,
    currency: 'USD',
  }
}

function stk(symbol: string, quantity: number, positionValue: number, costBasisPrice = 0): RawPosition {
  return {
    accountId: 'acct',
    symbol,
    description: symbol,
    assetClass: 'STK',
    quantity,
    costBasisPrice,
    costBasisMoney: costBasisPrice * quantity,
    markPrice: 0,
    positionValue,
    unrealizedPnL: 0,
    currency: 'USD',
  }
}

function holding(positions: RawPosition[], symbol: string) {
  return holdingsFromPositions(positions).holdings.find(h => h.symbol === symbol)
}

function assertConserved(name: string, positions: RawPosition[]) {
  const summed = positions.reduce((s, p) => s + p.positionValue, 0)
  const { holdings, nakedOptionsValue } = holdingsFromPositions(positions)
  const holdingsValue = holdings.reduce((s, h) => s + h.value, 0)
  check(
    `${name}: position marks conserved`,
    Math.abs(summed - (holdingsValue + nakedOptionsValue)) < 1e-6,
    `positions ${summed} vs holdings ${holdingsValue} + naked ${nakedOptionsValue}`,
  )
}

// ── IBKR Business-shaped book: underwater synthetics + a positive one ──
const business: RawPosition[] = [
  opt({ symbol: 'BIDU  C', underlying: 'BIDU', putCall: 'C', quantity: 1, positionValue: 400 }),
  opt({ symbol: 'BIDU  P', underlying: 'BIDU', putCall: 'P', quantity: -1, positionValue: -1600 }),
  opt({ symbol: 'BABA  C', underlying: 'BABA', putCall: 'C', quantity: 2, positionValue: 100 }),
  opt({ symbol: 'BABA  P', underlying: 'BABA', putCall: 'P', quantity: -2, positionValue: -900 }),
  // Flat synthetic — mark is zero, contracts still have to show.
  opt({ symbol: 'PDD   C', underlying: 'PDD', putCall: 'C', quantity: 4, positionValue: 500 }),
  opt({ symbol: 'PDD   P', underlying: 'PDD', putCall: 'P', quantity: -4, positionValue: -500 }),
  // Mismatched lots, net debit: 5 calls vs 2 puts → 2 synthetic contracts.
  opt({ symbol: 'LI    C', underlying: 'LI', putCall: 'C', quantity: 5, positionValue: 100 }),
  opt({ symbol: 'LI    P', underlying: 'LI', putCall: 'P', quantity: -2, positionValue: -400 }),
  opt({ symbol: 'AVGO  C', underlying: 'AVGO', putCall: 'C', quantity: 1, positionValue: 4000 }),
  opt({ symbol: 'AVGO  P', underlying: 'AVGO', putCall: 'P', quantity: -1, positionValue: -500 }),
  // True naked short put — this is the only thing OTHER should keep.
  opt({ symbol: 'QQQ   P', underlying: 'QQQ', putCall: 'P', quantity: -1, positionValue: -300 }),
  stk('AAPL', 100, 10_000, 150),
]

assertConserved('business', business)
const biz = holdingsFromPositions(business)

const bidu = holding(business, 'BIDU')!
check('BIDU is its own holding', bidu != null)
check('BIDU current value is the negative net mark', bidu?.value === -1200, String(bidu?.value))
check('BIDU options value is the negative net mark', bidu?.optionsValue === -1200)
check('BIDU synthetic contracts', bidu?.syntheticContracts === 1, String(bidu?.syntheticContracts))
check('BIDU has no shares', bidu?.shares === 0)

const baba = holding(business, 'BABA')!
check('BABA current value is negative', baba?.value === -800, String(baba?.value))
check('BABA synthetic contracts', baba?.syntheticContracts === 2)

const pdd = holding(business, 'PDD')!
check('flat synthetic still has a row', pdd?.value === 0 && pdd?.syntheticContracts === 4)

const li = holding(business, 'LI')!
check('mismatched lots count the smaller leg', li?.syntheticContracts === 2 && li?.value === -300, JSON.stringify(li))

const avgo = holding(business, 'AVGO')!
check('positive synthetic still on its own row', avgo?.value === 3500 && avgo?.syntheticContracts === 1)

check('naked short put is the whole of OTHER', biz.nakedOptionsValue === -300, String(biz.nakedOptionsValue))

const cash = 20_000
const positionSum = business.reduce((s, p) => s + p.positionValue, 0)
const netLiq = positionSum + cash
const holdingsValue = biz.holdings.reduce((s, h) => s + h.value, 0)
const tableSum = holdingsValue + cash + biz.nakedOptionsValue
check('table total still equals net liquidation', Math.abs(tableSum - netLiq) < 1e-6, `${tableSum} vs ${netLiq}`)

// Gap $ is target minus the row's current value. Once the debit lives on
// the ticker, the gap has to include it — not treat current as zero.
const biduTarget = 100 * 90
const biduGap = biduTarget - bidu.value
check('BIDU gap uses the negative current value', biduGap === biduTarget - (-1200) && bidu.value < 0)

// UMAC in the live book is down on P&L (~7.8%) and still on its own row,
// because Current $ is the option marks (positionValue, about +$1.7K), not
// fifo P&L. The old gate was `sum(positionValue) > 0`. It did not look at
// unrealizedPnL, strike, expiry, equal quantities, or the live quote.
const umac: RawPosition[] = [
  opt({
    symbol: 'UMAC C', underlying: 'UMAC', putCall: 'C', quantity: 10,
    positionValue: 4000, unrealizedPnL: -180, markPrice: 0,
    strike: 15, expiry: '20270115',
  }),
  opt({
    symbol: 'UMAC P', underlying: 'UMAC', putCall: 'P', quantity: -12,
    positionValue: -2300, unrealizedPnL: -90, markPrice: 0,
    strike: 12, expiry: '20270617',
  }),
]
assertConserved('UMAC-like', umac)
const umacHolding = holding(umac, 'UMAC')!
check(
  'losing P&L with a positive mark still gets a row',
  umacHolding?.value === 1700 && umacHolding?.syntheticContracts === 10,
  JSON.stringify(umacHolding),
)
check('that positive mark is not in OTHER', holdingsFromPositions(umac).nakedOptionsValue === 0)

// Same unmatched legs (different strike, expiry, and quantity), no live
// price, but the marks themselves sum negative — this is the BIDU/BABA case.
const biduUnmatched: RawPosition[] = [
  opt({
    symbol: 'BIDU C', underlying: 'BIDU', putCall: 'C', quantity: 1,
    positionValue: 400, unrealizedPnL: -900, markPrice: 0,
    strike: 100, expiry: '20270116',
  }),
  opt({
    symbol: 'BIDU P', underlying: 'BIDU', putCall: 'P', quantity: -3,
    positionValue: -1600, unrealizedPnL: -400, markPrice: 0,
    strike: 90, expiry: '20270618',
  }),
]
assertConserved('BIDU unmatched', biduUnmatched)
const biduUnmatchedHolding = holding(biduUnmatched, 'BIDU')!
check(
  'negative mark still gets a row when legs do not match',
  biduUnmatchedHolding?.value === -1200 && biduUnmatchedHolding?.syntheticContracts === 1,
  JSON.stringify(biduUnmatchedHolding),
)
check('negative mark is not in OTHER', holdingsFromPositions(biduUnmatched).nakedOptionsValue === 0)

// ── Personal account: same structure, different tickers / signs ──
const personal: RawPosition[] = [
  opt({ symbol: 'NVDA  C', underlying: 'NVDA', putCall: 'C', quantity: 3, positionValue: 200 }),
  opt({ symbol: 'NVDA  P', underlying: 'NVDA', putCall: 'P', quantity: -3, positionValue: -2500 }),
  opt({ symbol: 'META  C', underlying: 'META', putCall: 'C', quantity: 1, positionValue: 8000 }),
  opt({ symbol: 'META  P', underlying: 'META', putCall: 'P', quantity: -1, positionValue: -1000 }),
]
assertConserved('personal', personal)
const nvda = holding(personal, 'NVDA')!
const meta = holding(personal, 'META')!
check('personal underwater synthetic', nvda?.value === -2300 && nvda?.syntheticContracts === 3)
check('personal positive synthetic', meta?.value === 7000 && meta?.syntheticContracts === 1)
check('personal has no OTHER', holdingsFromPositions(personal).nakedOptionsValue === 0)

// Structures that are not synthetic longs stay in OTHER.
const notSynthetics: RawPosition[] = [
  opt({ symbol: 'XYZ C', underlying: 'XYZ', putCall: 'C', quantity: -1, positionValue: -700 }),
  opt({ symbol: 'XYZ P', underlying: 'XYZ', putCall: 'P', quantity: 1, positionValue: 200 }),
  opt({ symbol: 'ABC C', underlying: 'ABC', putCall: 'C', quantity: 1, positionValue: 450 }),
  opt({ symbol: 'DEF P', underlying: 'DEF', putCall: 'P', quantity: -2, positionValue: -80 }),
]
assertConserved('not synthetics', notSynthetics)
const notSyn = holdingsFromPositions(notSynthetics)
check('synthetic short is not a ticker row', holding(notSynthetics, 'XYZ') == null)
check('lone long call is not a ticker row', holding(notSynthetics, 'ABC') == null)
check('lone short put is not a ticker row', holding(notSynthetics, 'DEF') == null)
check('those marks stay in OTHER', notSyn.nakedOptionsValue === -700 + 200 + 450 - 80)

// Shares plus an underwater synthetic overlay were already attributed to
// the stock. That has to keep working, including the contract count.
const overlay: RawPosition[] = [
  stk('TSLA', 10, 2000, 180),
  opt({ symbol: 'TSLA C', underlying: 'TSLA', putCall: 'C', quantity: 1, positionValue: 100 }),
  opt({ symbol: 'TSLA P', underlying: 'TSLA', putCall: 'P', quantity: -1, positionValue: -900 }),
]
assertConserved('overlay', overlay)
const tsla = holding(overlay, 'TSLA')!
check('stock + underwater synthetic stays on the stock', tsla?.value === 1200 && tsla?.syntheticContracts === 1 && tsla?.shares === 10)
check('overlay did not leak into OTHER', holdingsFromPositions(overlay).nakedOptionsValue === 0)

// Overview pie: a negative wedge still can't be drawn, so the debit is
// folded back into cash and the ticker is absent. Positive synthetics
// stay their own slice. Cash + slices still reconcile to net liq.
const overviewState = {
  sync: { positions: business, trades: [], cashBalance: cash, netLiquidation: netLiq },
}
const { slices, total } = currentAllocationSlices(overviewState, 'business')
check('overview total is net liq', total === netLiq)
check('overview has no BIDU wedge', !slices.some(s => s.label === 'BIDU'))
check('overview has no BABA wedge', !slices.some(s => s.label === 'BABA'))
check('overview keeps the positive synthetic', slices.some(s => s.label === 'AVGO' && s.value === 3500))
const overviewCash = slices.find(s => s.label === 'CASH')
// Underwater holdings BIDU -1200, BABA -800, PDD 0, LI -300 = -2300, plus the
// naked QQQ put -300, both folded into the $20,000 cash balance.
check('overview cash folds the underwater marks back in', overviewCash?.value === 17400, String(overviewCash?.value))
check('overview slices reconcile', Math.abs(slices.reduce((s, x) => s + x.value, 0) - netLiq) < 1e-6, String(slices.reduce((s, x) => s + x.value, 0)))

// ── Rendered Holdings vs Target table ──
const store = new Map<string, string>()
Object.assign(globalThis, {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v) },
    removeItem: (k: string) => { store.delete(k) },
  },
})
store.set('options:targetAllocations', JSON.stringify({
  biz: { rows: [{ id: 't-bidu', ticker: 'BIDU', shares: 100 }] },
}))

const state = emptyAppState()
state.sync = {
  ...state.sync,
  positions: business,
  trades: [],
  cashBalance: cash,
  netLiquidation: netLiq,
}
const html = renderToStaticMarkup(createElement(PortfolioAllocationView, {
  state,
  accountId: 'biz',
  sessionKey: null,
}))

function rowText(ticker: string): string {
  const rows = html.split(/<tr[\s>]/).slice(1).map(r => r.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
  const found = rows.filter(r => new RegExp(`(?:^|\\s)${ticker}(?:\\s|$)`).test(r))
  return found[0] ?? ''
}

const biduRow = rowText('BIDU')
const biduPct = `${(bidu.value / netLiq * 100).toFixed(1)}%`
check('BIDU row shows negative Current $', biduRow.includes(fmt$(bidu.value)) && fmt$(bidu.value).startsWith('-'), biduRow)
check('BIDU row shows negative Current %', biduRow.includes(biduPct) && biduPct.startsWith('-'), `${biduPct} in ${biduRow}`)
check('BIDU row shows synthetic contract count', new RegExp(`(?:^|\\s)${bidu.syntheticContracts}(?:\\s|$)`).test(biduRow), biduRow)
check('BIDU target shares still on the row', biduRow.includes('100'), biduRow)

const babaRow = rowText('BABA')
const babaPct = `${(baba.value / netLiq * 100).toFixed(1)}%`
check('BABA row shows negative Current $', babaRow.includes(fmt$(baba.value)) && fmt$(baba.value).startsWith('-'), babaRow)
check('BABA row shows negative Current %', babaRow.includes(babaPct) && babaPct.startsWith('-'), babaRow)
check('BABA row shows synthetic contract count', new RegExp(`(?:^|\\s)${baba.syntheticContracts}(?:\\s|$)`).test(babaRow), babaRow)

const liRow = rowText('LI')
check('LI row shows contract count not a dash', liRow.includes(fmt$(li.value)) && /\s2(?:\s|$)/.test(liRow), liRow)

const otherRow = rowText('OTHER')
check('OTHER row is only the naked put', otherRow.includes(fmt$(-300)) && !otherRow.includes(fmt$(-1200)) && !otherRow.includes(fmt$(-800)), otherRow)

const totalRow = rowText('Total')
check('total Current $ unchanged vs net liq', totalRow.includes(fmt$(tableSum)), totalRow)
check('total Current % still 100', totalRow.includes('100.0%'), totalRow)

const avgoRow = rowText('AVGO')
check('positive synthetic row unchanged', avgoRow.includes(fmt$(3500)) && avgoRow.includes('1'), avgoRow)

if (failed > 0) {
  console.error(`\n${failed} failed`)
  process.exit(1)
}
console.log('\nall checks passed')
