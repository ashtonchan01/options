/**
 * Income plan math: live Flex figures stay separate from the 23 Oct snapshot.
 * Run with: npm test
 */
import { readFileSync } from 'node:fs'
import { parseFlexDocument } from '../src/services/ibkr'
import { DEFAULT_INCOME_SETTINGS, SEED_PUTS, SEED_SELLS } from '../src/income/incomeSeed'
import {
  annualizedReturn,
  booksFor,
  callCover,
  callYield,
  deltaInBand,
  displayAccountName,
  elState,
  exitUpside,
  liveRules,
  planPremium,
  premiumOverCash,
  putScreenRows,
  quoteFreshness,
  realisedInMonth,
  screenDays,
  toLiveBook,
  type IncomeSource,
} from '../src/income/incomeLive'
import { normalizeSettings } from '../src/store/incomePlanStore'
import type { RawPosition, RawTrade } from '../src/types'

let failed = 0
function check(name: string, ok: boolean, detail?: string) {
  if (ok) console.log(`ok  ${name}`)
  else {
    failed++
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

const personalNow = planPremium(SEED_SELLS, 'personal', 'now')
const personalAfter = planPremium(SEED_SELLS, 'personal', 'after')
const businessNow = planPremium(SEED_SELLS, 'business', 'now')
const businessAfter = planPremium(SEED_SELLS, 'business', 'after')
check('personal plan now is the covered TSLA call only', personalNow === 443)
check('personal plan after repair adds the MSTR calls', personalAfter === 1_463)
check('business plan is the five ideas', businessNow === 3_158 && businessAfter === 3_158)
check('combined plan now and after repair match the snapshot totals', personalNow + businessNow === 3_601 && personalAfter + businessAfter === 4_621)
check('gap is needed minus plan now, not a stored remainder', DEFAULT_INCOME_SETTINGS.personalTarget - personalNow === 4_707)
check('needed total is the sum of the two targets', DEFAULT_INCOME_SETTINGS.personalTarget + DEFAULT_INCOME_SETTINGS.businessTarget === 11_250)

const ranked = putScreenRows(SEED_PUTS, DEFAULT_INCOME_SETTINGS)
check('puts rank by premium / cash', ranked.map(row => row.symbol).join(',') === 'ALAB,ARM,MSTR,SKHY,MRVL,SPCX', ranked.map(row => row.symbol).join(','))
check('screen is 27 days to 20 Nov 2026', screenDays(DEFAULT_INCOME_SETTINGS.screenExpiry) === 27)
check('ALAB return annualizes near 69%', Math.abs(annualizedReturn(premiumOverCash(1_123, 22_000), 27) - 0.69) < 0.005)
check('SPCX sits outside the 0.20-0.30 delta band', ranked.find(row => row.symbol === 'SPCX')?.band === 'out')
check('ARM delta is unknown, not outside the band', deltaInBand(null, 0.2, 0.3) === 'unknown')
check('MSTR put stays ranked and is blocked by the no-new-puts rule', ranked.find(row => row.symbol === 'MSTR')?.blockedMstr === true && ranked.find(row => row.symbol === 'MSTR')?.excluded === false)
check('exclude list keeps the named underlyings', ['AAOI', 'UMAC', 'SOFI', 'AMZN', 'IBIT', 'BIDU', 'BABA'].every(symbol => DEFAULT_INCOME_SETTINGS.excludeSymbols.includes(symbol)))
check('IBIT and BSOL are ETFs', DEFAULT_INCOME_SETTINGS.etfSymbols.includes('IBIT') && DEFAULT_INCOME_SETTINGS.etfSymbols.includes('BSOL'))

check('call yield matches the snapshot percents', Math.abs(callYield(443, 372, 1) - 0.012) < 0.001 && Math.abs(callYield(435, 136.1, 1) - 0.032) < 0.001)
check('BIDU and BABA exits match the snapshot upside', Math.round(exitUpside(77.22, 160) * 100) === 107 && Math.round(exitUpside(99.66, 190) * 100) === 91)

check('EL below the floor is red-worthy and a missing EL is not', elState(11_940, 30_000) === 'below' && elState(51_919, 30_000) === 'ok' && elState(undefined, 30_000) === 'unknown')

function opt(partial: Partial<RawPosition> & Pick<RawPosition, 'symbol' | 'quantity' | 'putCall' | 'strike'>): RawPosition {
  return {
    accountId: 'SHOULD-NOT-LEAK',
    description: partial.symbol,
    assetClass: 'OPT',
    costBasisPrice: 1,
    costBasisMoney: 1,
    markPrice: 1,
    positionValue: 1,
    unrealizedPnL: 0,
    currency: 'USD',
    multiplier: 100,
    expiry: '20261120',
    underlyingSymbol: partial.symbol,
    ...partial,
  }
}

const personal: IncomeSource = {
  name: 'Personal',
  cashBalance: 10_000,
  netLiquidation: 100_000,
  excessLiquidity: 11_940,
  positions: [
    opt({ symbol: 'MSTR', putCall: 'P', strike: 160, quantity: -2, markPrice: 24.44, expiry: '20261218' }),
    opt({ symbol: 'TSLA', putCall: 'C', strike: 410, quantity: -1, markPrice: 4.43 }),
    opt({ symbol: 'AAOI', putCall: 'P', strike: 95, quantity: -1, markPrice: 1 }),
    { accountId: 'SHOULD-NOT-LEAK', symbol: 'TSLA', description: 'TSLA', assetClass: 'STK', quantity: 100, costBasisPrice: 1, costBasisMoney: 100, markPrice: 372, positionValue: 37_200, unrealizedPnL: 0, currency: 'USD' },
  ],
  trades: [
    { tradeDate: '20261016', symbol: 'MSTR', assetClass: 'OPT', quantity: 1, tradePrice: 1, proceeds: 0, commissions: 0, netCash: 0, openClose: 'C', fifoPnlRealized: 250 },
    { tradeDate: '20261002', symbol: 'MSTR', assetClass: 'OPT', quantity: -1, tradePrice: 1, proceeds: 100, commissions: 0, netCash: 100, openClose: 'O', fifoPnlRealized: 999 },
    { tradeDate: '20260930', symbol: 'MSTR', assetClass: 'STK', quantity: -1, tradePrice: 1, proceeds: 0, commissions: 0, netCash: 0, openClose: 'C', fifoPnlRealized: 80, isTransfer: true },
  ] satisfies RawTrade[],
}
const business: IncomeSource = {
  name: 'Business',
  cashBalance: 128_823,
  netLiquidation: 156_539,
  excessLiquidity: 51_919,
  positions: [
    opt({ symbol: 'BSOL', putCall: 'P', strike: 16, quantity: -10, markPrice: 2.18 }),
    { accountId: 'SHOULD-NOT-LEAK', symbol: 'MSTR', description: 'MSTR', assetClass: 'STK', quantity: 200, costBasisPrice: 1, costBasisMoney: 200, markPrice: 145, positionValue: 29_000, unrealizedPnL: 0, currency: 'USD' },
  ],
  trades: [],
}
const other: IncomeSource = { name: 'U23020202', positions: [], trades: [] }
const now = new Date('2026-10-24T15:00:00Z')
const books = booksFor([other, business, personal], now)
const personalBook = books.find(book => book.role === 'personal')!
check('books order personal then business and redact an IBKR id', books.map(book => `${book.role}:${book.name}`).join('|') === 'personal:Personal|business:Business|other:Other account', books.map(book => book.name).join('|'))
check('live book does not carry an account id', !('accountId' in personalBook) && personalBook.shortOptions.every(row => !('accountId' in row)))
check('short close cost is mark times multiplier', personalBook.shortOptions.find(row => row.underlying === 'MSTR')?.closeCost === 4_888, String(personalBook.shortOptions.find(row => row.underlying === 'MSTR')?.closeCost))
check('realised this month ignores opens and other months', personalBook.realisedThisMonth === 250)
check('opening fifo is not monthly income', realisedInMonth(personal.trades, '202610') === 250)
check('TSLA call is covered by 100 shares and two contracts would not be', callCover(personalBook, 'TSLA', 1) === 'covered' && callCover(personalBook, 'TSLA', 2) === 'short')
check('a book with no positions cannot claim share cover', callCover(toLiveBook(other, now), 'TSLA', 1) === 'unknown')

const rules = liveRules(books, DEFAULT_INCOME_SETTINGS)
const rule = (id: string) => rules.find(row => row.id === id)
check('personal EL under the floor fails and business EL passes', rule('personal-el')?.status === 'no' && rule('business-el')?.status === 'yes')
check('missing EL stays unknown', elState(toLiveBook(other, now).excessLiquidity, 30_000) === 'unknown')
check('open MSTR put fails the no-new-puts rule', rule('mstr-puts')?.status === 'no')
check('BSOL short put fails the ETF rule', rule('etf')?.status === 'no')
check('AAOI short put fails the exclude list', rule('excluded-puts')?.status === 'no' && rule('excluded-puts')?.detail.includes('AAOI') === true)
check('covered TSLA call passes', rule('tsla-calls')?.status === 'yes')

check('Saturday is a prior close', quoteFreshness({ now: new Date('2026-10-24T15:00:00Z') }).stale && quoteFreshness({ now: new Date('2026-10-24T15:00:00Z') }).label === 'Prior close')
check('Wednesday midday is a regular session without a market state', quoteFreshness({ now: new Date('2026-10-21T15:00:00Z') }).stale === false)
check('after the cash close is after hours', quoteFreshness({ now: new Date('2026-10-21T21:00:00Z') }).label === 'After hours')
check('Yahoo POST overrides the clock', quoteFreshness({ marketState: 'POST', now: new Date('2026-10-21T15:00:00Z') }).label === 'After hours')
check('Yahoo REGULAR is fresh', quoteFreshness({ marketState: 'REGULAR', now: new Date('2026-10-24T15:00:00Z') }).stale === false)

const saved = normalizeSettings({ elFloor: 25_000, screenExpiry: '2026-12-18', deltaMin: 0.15, deltaMax: 0.25, excludeSymbols: 'aaoi, tsla', exits: [{ symbol: 'BIDU', price: 150 }], noNewMstrPuts: false })
check('settings keep an edited floor, expiry, delta, and exit', saved.elFloor === 25_000 && saved.screenExpiry === '2026-12-18' && saved.deltaMin === 0.15 && saved.exits.find(exit => exit.symbol === 'BIDU')?.price === 150)
check('edited exclude list replaces the default', saved.excludeSymbols.join(',') === 'AAOI,TSLA')
check('turning off the MSTR rule is kept', saved.noNewMstrPuts === false)
check('a broken blob falls back to the HTML defaults', normalizeSettings('nope').personalTarget === 5_150 && normalizeSettings({}).rankBy === 'premiumOverCash')

function flexDoc(rows: { tag: string; attrs: Record<string, string> }[]) {
  const elements = rows.map(row => ({
    tag: row.tag,
    getAttribute(name: string) { return Object.prototype.hasOwnProperty.call(row.attrs, name) ? row.attrs[name] : null },
  }))
  return {
    querySelectorAll(sel: string) { return elements.filter(el => el.tag === sel) },
    querySelector(sel: string) { return elements.find(el => el.tag === sel) ?? null },
  }
}
const withEl = parseFlexDocument(flexDoc([
  { tag: 'EquitySummaryInBase', attrs: { reportDate: '20251023', netLiquidation: '100', excessLiquidity: '1' } },
  { tag: 'EquitySummaryInBase', attrs: { reportDate: '20261023', netLiquidation: '134982', excessLiquidity: '11940' } },
]) as unknown as Document)
check('excess liquidity is the latest equity-summary row', withEl.excessLiquidity === 11_940 && withEl.netLiquidation === 134_982)
const withoutEl = parseFlexDocument(flexDoc([
  { tag: 'EquitySummaryInBase', attrs: { reportDate: '20261023', netLiquidation: '10' } },
]) as unknown as Document)
check('a summary without excess liquidity does not invent one', withoutEl.excessLiquidity === undefined && withoutEl.netLiquidation === 10)

const view = readFileSync(new URL('../src/components/income/IncomeView.tsx', import.meta.url), 'utf8')
check('income page has no order button', !view.includes('<button'))
check('income page does not read account ids or flex tokens', !view.includes('accountId') && !view.includes('flexToken') && !view.includes('flexQueryId'))
check('display name redacts a U-number', displayAccountName('U21440275') === 'Other account' && displayAccountName('Personal') === 'Personal')

if (failed > 0) {
  console.error(`${failed} failed`)
  process.exit(1)
}
console.log('income plan ok')
