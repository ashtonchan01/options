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
  underlying?: string
  putCall?: 'C' | 'P'
  quantity: number
  positionValue: number
  unrealizedPnL?: number
  markPrice?: number
  multiplier?: number
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
    multiplier: partial.multiplier,
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
  const signed = positions.reduce((s, p) => s + p.positionValue, 0)
  const { holdings, nakedOptionsValue } = holdingsFromPositions(positions)
  const displayed = holdings.reduce((s, h) => s + h.value, 0) + nakedOptionsValue
  // A pure synthetic's Current $ is |signed mark| so it matches Journal's
  // Market Value column. That raises the displayed total above the signed
  // sum when the mark is negative, and never lowers it.
  check(
    `${name}: displayed total is the signed marks with pure synthetics at absolute market value`,
    displayed + 1e-6 >= signed,
    `displayed ${displayed} vs signed ${signed}`,
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
check('BIDU current value matches journal market value', bidu?.value === 1200, String(bidu?.value))
check('BIDU options value matches journal market value', bidu?.optionsValue === 1200)
check('BIDU synthetic contracts', bidu?.syntheticContracts === 1, String(bidu?.syntheticContracts))
check('BIDU has no shares', bidu?.shares === 0)

const baba = holding(business, 'BABA')!
check('BABA current value matches journal market value', baba?.value === 800, String(baba?.value))
check('BABA synthetic contracts', baba?.syntheticContracts === 2)

const pdd = holding(business, 'PDD')!
check('flat synthetic still has a row', pdd?.value === 0 && pdd?.syntheticContracts === 4)

const li = holding(business, 'LI')!
check('mismatched lots count the smaller leg', li?.syntheticContracts === 2 && li?.value === 300, JSON.stringify(li))

const avgo = holding(business, 'AVGO')!
check('positive synthetic still on its own row', avgo?.value === 3500 && avgo?.syntheticContracts === 1)

check('naked short put is the whole of OTHER', biz.nakedOptionsValue === -300, String(biz.nakedOptionsValue))

const cash = 20_000
const positionSum = business.reduce((s, p) => s + p.positionValue, 0)
const netLiq = positionSum + cash
const holdingsValue = biz.holdings.reduce((s, h) => s + h.value, 0)
const tableSum = holdingsValue + cash + biz.nakedOptionsValue
// Signed marks that Journal would print as a positive Market Value are
// BIDU 1200, BABA 800, LI 300. Each replaces a negative with its absolute
// value, so the displayed total is net liq plus twice those debits.
const journalUplift = 2 * (1200 + 800 + 300)
check('table total is net liq plus the absolute-market-value uplift', Math.abs(tableSum - (netLiq + journalUplift)) < 1e-6, `${tableSum} vs ${netLiq + journalUplift}`)

// Gap $ is target minus the row's displayed current value.
const biduTarget = 100 * 90
const biduGap = biduTarget - bidu.value
check('BIDU gap uses the journal market value', biduGap === biduTarget - 1200 && bidu.value === 1200)

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
// price, marks sum negative. Strike/expiry/quantity still do not decide
// whether the row exists — a negative net on one shared ticker still shows.
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
  'negative signed mark still gets a row, at journal market value',
  biduUnmatchedHolding?.value === 1200 && biduUnmatchedHolding?.syntheticContracts === 1,
  JSON.stringify(biduUnmatchedHolding),
)
check('negative mark is not in OTHER', holdingsFromPositions(biduUnmatched).nakedOptionsValue === 0)

// Live book: nets are positive (BABA ~$303, BIDU ~$25, UMAC ~$1.7K) but the
// call and the put are not the same underlying string. IBKR's HK line is
// 9988 / 9888; the ADR line, and the target row, is BABA / BIDU. A blank
// underlyingSymbol falls through to the full OCC symbol, which also differs
// per leg. Either way the old grouping never saw both a long call and a
// short put, so each leg was added to OTHER (the short put is the negative
// piece) and the target row stayed "—".
const splitListings: RawPosition[] = [
  opt({
    symbol: 'BABA  270115C00120000', underlying: 'BABA', putCall: 'C', quantity: 1,
    positionValue: 2000, strike: 120, expiry: '20270115',
  }),
  opt({
    symbol: '9988  270630P00090000', underlying: '9988', putCall: 'P', quantity: -1,
    positionValue: -1697, strike: 90, expiry: '20270630',
  }),
  opt({
    symbol: 'BIDU  270115C00100000', underlying: 'BIDU', putCall: 'C', quantity: 2,
    positionValue: 900, strike: 100, expiry: '20270115',
  }),
  opt({
    symbol: '9888  270115P00080000', underlying: '9888', putCall: 'P', quantity: -2,
    positionValue: -875, strike: 80, expiry: '20270115',
  }),
  opt({
    symbol: 'UMAC  270115C00015000', underlying: 'UMAC', putCall: 'C', quantity: 10,
    positionValue: 4000, strike: 15, expiry: '20270115',
  }),
  opt({
    symbol: 'UMAC  270617P00012000', underlying: 'UMAC', putCall: 'P', quantity: -10,
    positionValue: -2300, strike: 12, expiry: '20270617',
  }),
  // Real naked short. Must stay in OTHER, and must not become a BABA/BIDU row.
  opt({ symbol: 'QQQ   P', underlying: 'QQQ', putCall: 'P', quantity: -1, positionValue: -2100 }),
]
assertConserved('split listings', splitListings)
const split = holdingsFromPositions(splitListings)
const babaSplit = holding(splitListings, 'BABA')!
const biduSplit = holding(splitListings, 'BIDU')!
const umacSplit = holding(splitListings, 'UMAC')!
check('no HK board-code row', holding(splitListings, '9988') == null && holding(splitListings, '9888') == null)
check('BABA synthetic net is +303 on the ADR row', babaSplit?.value === 303 && babaSplit?.syntheticContracts === 1, JSON.stringify(babaSplit))
check('BIDU synthetic net is +25 on the ADR row', biduSplit?.value === 25 && biduSplit?.syntheticContracts === 2, JSON.stringify(biduSplit))
check('UMAC still its own positive row', umacSplit?.value === 1700 && umacSplit?.syntheticContracts === 10, JSON.stringify(umacSplit))
check('OTHER is only the naked put, not the synthetics', split.nakedOptionsValue === -2100, String(split.nakedOptionsValue))

// Both legs already on the HK code (no ADR string anywhere). They still
// have to land on BABA, not on "9988" and not in OTHER.
const bothHk: RawPosition[] = [
  opt({ symbol: '9988 C', underlying: '9988', putCall: 'C', quantity: 1, positionValue: 1800, strike: 100, expiry: '20270115' }),
  opt({ symbol: '9988 P', underlying: '9988', putCall: 'P', quantity: -1, positionValue: -1497, strike: 80, expiry: '20270617' }),
]
assertConserved('both HK', bothHk)
check('HK-only synthetic shows as BABA', holding(bothHk, 'BABA')?.value === 303 && holding(bothHk, 'BABA')?.syntheticContracts === 1)
check('HK-only synthetic is not a 9988 row', holding(bothHk, '9988') == null)
check('HK-only synthetic is not OTHER', holdingsFromPositions(bothHk).nakedOptionsValue === 0)

// No underlyingSymbol at all: the contract symbol is the only ticker, and
// it is different for the call and the put. putCall is also absent and has
// to be read off the OCC symbol.
const occOnly: RawPosition[] = [
  opt({ symbol: 'BABA  270115C00120000', quantity: 1, positionValue: 500, strike: 120, expiry: '20270115' }),
  opt({ symbol: 'BABA  270115P00090000', quantity: -1, positionValue: -197, strike: 90, expiry: '20270115' }),
]
assertConserved('OCC only', occOnly)
check('OCC legs with no underlyingSymbol pair on BABA', holding(occOnly, 'BABA')?.value === 303 && holding(occOnly, 'BABA')?.syntheticContracts === 1, JSON.stringify(holding(occOnly, 'BABA')))
check('OCC legs are not OTHER', holdingsFromPositions(occOnly).nakedOptionsValue === 0)

// A lone HK put is still naked. Aliasing the ticker must not invent a synthetic.
const loneHkPut: RawPosition[] = [
  opt({ symbol: '9988 P', underlying: '9988', putCall: 'P', quantity: -1, positionValue: -400 }),
]
check('lone HK put is not a BABA row', holding(loneHkPut, 'BABA') == null && holding(loneHkPut, '9988') == null)
check('lone HK put stays in OTHER', holdingsFromPositions(loneHkPut).nakedOptionsValue === -400)

// HK shares keep their own row. Options on that same line stay with the
// shares instead of being renamed onto the ADR.
const hkStock: RawPosition[] = [
  stk('9988', 100, 5000, 80),
  opt({ symbol: '9988 C', underlying: '9988', putCall: 'C', quantity: 1, positionValue: 200 }),
  opt({ symbol: '9988 P', underlying: '9988', putCall: 'P', quantity: -1, positionValue: -50 }),
]
assertConserved('HK stock', hkStock)
const hkShares = holding(hkStock, '9988')!
check('HK shares stay on 9988 and keep the option marks', hkShares?.symbol === '9988' && hkShares?.shares === 100 && hkShares?.value === 5150 && hkShares?.syntheticContracts === 1, JSON.stringify(hkShares))
check('HK shares did not also open a BABA row', holding(hkStock, 'BABA') == null)

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
check('personal synthetic uses journal market value', nvda?.value === 2300 && nvda?.syntheticContracts === 3)
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
check('overview shows BIDU at journal market value', slices.some(s => s.label === 'BIDU' && s.value === 1200))
check('overview shows BABA at journal market value', slices.some(s => s.label === 'BABA' && s.value === 800))
check('overview keeps the positive synthetic', slices.some(s => s.label === 'AVGO' && s.value === 3500))
const overviewCash = slices.find(s => s.label === 'CASH')
// PDD's flat mark is still not a wedge. The naked QQQ put stays in cash.
// BABA/BIDU/LI are positive market values now, so they are not folded in.
check('overview cash keeps the naked put and not the synthetics', overviewCash?.value === 19700, String(overviewCash?.value))

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
check('BIDU row shows journal market value', biduRow.includes(fmt$(bidu.value)) && fmt$(bidu.value) === '$1.2K', biduRow)
check('BIDU row shows positive Current %', biduRow.includes(biduPct) && !biduPct.startsWith('-'), `${biduPct} in ${biduRow}`)
check('BIDU row shows synthetic contract count', new RegExp(`(?:^|\\s)${bidu.syntheticContracts}(?:\\s|$)`).test(biduRow), biduRow)
check('BIDU target shares still on the row', biduRow.includes('100'), biduRow)

const babaRow = rowText('BABA')
const babaPct = `${(baba.value / netLiq * 100).toFixed(1)}%`
check('BABA row shows journal market value', babaRow.includes(fmt$(baba.value)) && fmt$(baba.value) === '$800', babaRow)
check('BABA row shows positive Current %', babaRow.includes(babaPct) && !babaPct.startsWith('-'), babaRow)
check('BABA row shows synthetic contract count', new RegExp(`(?:^|\\s)${baba.syntheticContracts}(?:\\s|$)`).test(babaRow), babaRow)

const liRow = rowText('LI')
check('LI row shows contract count not a dash', liRow.includes(fmt$(li.value)) && /\s2(?:\s|$)/.test(liRow), liRow)

const otherRow = rowText('OTHER')
check('OTHER row is only the naked put', otherRow.includes(fmt$(-300)) && !otherRow.includes('-$1.2K') && !otherRow.includes('-$800'), otherRow)

const totalRow = rowText('Total')
check('total Current $ is the displayed sum', totalRow.includes(fmt$(tableSum)), totalRow)
const totalPct = `${((tableSum / netLiq) * 100).toFixed(1)}%`
check('total Current % is the displayed sum over net liq', totalRow.includes(totalPct), `${totalPct} in ${totalRow}`)

const avgoRow = rowText('AVGO')
check('positive synthetic row unchanged', avgoRow.includes(fmt$(3500)) && avgoRow.includes('1'), avgoRow)

// The corrected live shape: positive nets, legs on different listing tickers,
// target rows already named BABA and BIDU. Current $ is the signed net,
// Synth. Long is the matched contracts, OTHER is only the naked put.
store.set('options:targetAllocations', JSON.stringify({
  live: {
    rows: [
      { id: 't-baba', ticker: 'BABA', shares: 10 },
      { id: 't-bidu', ticker: 'BIDU', shares: 10 },
    ],
  },
}))
const liveState = emptyAppState()
const liveCash = 80_000
const livePositions = splitListings
const liveSum = livePositions.reduce((s, p) => s + p.positionValue, 0) + liveCash
liveState.sync = {
  ...liveState.sync,
  positions: livePositions,
  trades: [],
  cashBalance: liveCash,
  netLiquidation: liveSum,
}
const liveHtml = renderToStaticMarkup(createElement(PortfolioAllocationView, {
  state: liveState,
  accountId: 'live',
  sessionKey: null,
}))
function liveRow(ticker: string): string {
  const rows = liveHtml.split(/<tr[\s>]/).slice(1).map(r => r.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
  return rows.find(r => new RegExp(`(?:^|\\s)${ticker}(?:\\s|$)`).test(r)) ?? ''
}
const liveBaba = liveRow('BABA')
const liveBidu = liveRow('BIDU')
const liveOther = liveRow('OTHER')
const liveUmac = liveRow('UMAC')
check('BABA row shows +$303 and 1 contract', liveBaba.includes('$303') && /(?:^|\s)1(?:\s|$)/.test(liveBaba), liveBaba)
check('BIDU row shows +$25 and 2 contracts', liveBidu.includes('$25') && /(?:^|\s)2(?:\s|$)/.test(liveBidu), liveBidu)
check('UMAC row still shows $1.7K and 10 contracts', liveUmac.includes('$1.7K') && /(?:^|\s)10(?:\s|$)/.test(liveUmac), liveUmac)
check('OTHER row is the naked -$2.1K only', liveOther.includes('-$2.1K') && !liveOther.includes('$303') && !liveOther.includes('$25'), liveOther)
check('no 9988 or 9888 row', liveRow('9988') === '' && liveRow('9888') === '')

// Production IBKR Business, October 2026. Journal Market Value is
// Math.abs(signed mark). The signed mark is positionValue, and it is also
// what Journal's other columns imply: unrealised = signed mark − cost basis.
// BABA cost basis +$983.58 and unrealised −$1,287.00 only reconcile if the
// signed mark is −$303.42 (Journal then prints $303.42). BIDU is −$25.82
// printed as $25.82. UMAC's signed mark is already +$1,729.90, so both pages
// already agreed. Allocation Current $ has to be that printed market value.
const liveSigns: RawPosition[] = [
  opt({
    symbol: 'BABA  281215C00110000', underlying: 'BABA', putCall: 'C', quantity: 2,
    positionValue: 4000, markPrice: 20, multiplier: 100, strike: 110, expiry: '20281215',
  }),
  opt({
    symbol: 'BABA  281215P00120000', underlying: 'BABA', putCall: 'P', quantity: -2,
    positionValue: -4303.42, markPrice: 21.5171, multiplier: 100, strike: 120, expiry: '20281215',
  }),
  opt({
    symbol: 'BIDU  270115C00090000', underlying: 'BIDU', putCall: 'C', quantity: 2,
    positionValue: 1000, markPrice: 5, multiplier: 100, strike: 90, expiry: '20270115',
  }),
  opt({
    symbol: 'BIDU  270115P00090000', underlying: 'BIDU', putCall: 'P', quantity: -2,
    positionValue: -1025.82, markPrice: 5.1291, multiplier: 100, strike: 90, expiry: '20270115',
  }),
  opt({
    symbol: 'UMAC  281215C00020000', underlying: 'UMAC', putCall: 'C', quantity: 10,
    positionValue: 5000, markPrice: 5, multiplier: 100, strike: 20, expiry: '20281215',
  }),
  opt({
    symbol: 'UMAC  281215P00022500', underlying: 'UMAC', putCall: 'P', quantity: -10,
    positionValue: -3270.10, markPrice: 3.2701, multiplier: 100, strike: 22.5, expiry: '20281215',
  }),
  // The two books that are not synthetics on this account. Journal shows
  // their market value as an absolute number too, but Allocation keeps the
  // signed mark because they are not synthetic longs. SPX bull put spread
  // ≈ −$1,670.30, SPCX short put ≈ −$51.00. Together −$1,721.30, which the
  // table rounds to −$1.7K. That is the whole of OTHER.
  opt({ symbol: 'SPX   261016P07700000', underlying: 'SPX', putCall: 'P', quantity: -2, positionValue: -8000, strike: 7700, expiry: '20261016' }),
  opt({ symbol: 'SPX   261016P07675000', underlying: 'SPX', putCall: 'P', quantity: 2, positionValue: 6329.70, strike: 7675, expiry: '20261016' }),
  opt({ symbol: 'SPCX  261016P00135000', underlying: 'SPCX', putCall: 'P', quantity: -2, positionValue: -51, strike: 135, expiry: '20261016' }),
]
const signedMark = (legs: RawPosition[]) => legs.reduce((s, p) => s + p.markPrice * p.quantity * (p.multiplier ?? 100), 0)
const babaLegs = liveSigns.filter(p => (p.underlyingSymbol ?? '').startsWith('BABA'))
const biduLegs = liveSigns.filter(p => (p.underlyingSymbol ?? '').startsWith('BIDU'))
const umacLegs = liveSigns.filter(p => (p.underlyingSymbol ?? '').startsWith('UMAC'))
check('BABA signed mark is -303.42', Math.abs(signedMark(babaLegs) - (-303.42)) < 0.02, String(signedMark(babaLegs)))
check('BIDU signed mark is -25.82', Math.abs(signedMark(biduLegs) - (-25.82)) < 0.02, String(signedMark(biduLegs)))
check('UMAC signed mark is +1729.90', Math.abs(signedMark(umacLegs) - 1729.90) < 0.02, String(signedMark(umacLegs)))
const signedBook = holdingsFromPositions(liveSigns)
check('BABA Current $ is the positive journal market value', Math.abs((holding(liveSigns, 'BABA')?.value ?? 0) - 303.42) < 0.02)
check('BIDU Current $ is the positive journal market value', Math.abs((holding(liveSigns, 'BIDU')?.value ?? 0) - 25.82) < 0.02)
check('UMAC Current $ stays the positive mark', Math.abs((holding(liveSigns, 'UMAC')?.value ?? 0) - 1729.90) < 0.02)
check('BABA and BIDU each show 2 synthetic contracts', holding(liveSigns, 'BABA')?.syntheticContracts === 2 && holding(liveSigns, 'BIDU')?.syntheticContracts === 2)
check('OTHER is the SPX spread plus the SPCX put', Math.abs(signedBook.nakedOptionsValue - (-1670.30 - 51)) < 0.02, String(signedBook.nakedOptionsValue))
check('OTHER rounds to -$1.7K', fmt$(signedBook.nakedOptionsValue) === '-$1.7K', fmt$(signedBook.nakedOptionsValue))

if (failed > 0) {
  console.error(`\n${failed} failed`)
  process.exit(1)
}
console.log('\nall checks passed')
