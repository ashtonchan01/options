/**
 * Income plan math: live Flex figures stay separate from the 23 Oct snapshot.
 * Run with: npm test
 */
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { parseFlexDocument } from '../src/services/ibkr'
import { DEFAULT_INCOME_SETTINGS, SEED_PUTS, type IncomeSettings } from '../src/income/incomeSeed'
import {
  annualizedReturn,
  callCover,
  callPremiumRatio,
  deltaInBand,
  displayAccountName,
  elState,
  ideaCopy,
  ideaHorizon,
  liveIdeas,
  premiumOverCash,
  putScreenRows,
  realisedInMonth,
  resolvedNetLiquidation,
  screenDays,
  toLiveBook,
  type IncomeSource,
} from '../src/income/incomeLive'
import { normalizeSettings } from '../src/store/incomePlanStore'
import type { Account } from '../src/store/accountsStore'
import PlanCards from '../src/components/overview/PlanCards'
import type { RawPosition, RawTrade } from '../src/types'

let failed = 0
function check(name: string, ok: boolean, detail?: string) {
  if (ok) console.log(`ok  ${name}`)
  else {
    failed++
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

check('the plan no longer stores a fixed monthly target', !('personalTarget' in DEFAULT_INCOME_SETTINGS) && !('businessTarget' in DEFAULT_INCOME_SETTINGS) && DEFAULT_INCOME_SETTINGS.splitMode === 'capital')

const ranked = putScreenRows(SEED_PUTS, DEFAULT_INCOME_SETTINGS)
check('puts rank by premium / cash', ranked.map(row => row.symbol).join(',') === 'ALAB,ARM,MSTR,SKHY,MRVL,SPCX', ranked.map(row => row.symbol).join(','))
check('screen is 27 days to 20 Nov 2026', screenDays(DEFAULT_INCOME_SETTINGS.screenExpiry) === 27)
check('ALAB return annualizes near 69%', Math.abs(annualizedReturn(premiumOverCash(1_123, 22_000), 27) - 0.69) < 0.005)
check('TSLA call yield is premium over the stock, annualized like puts', Math.abs(annualizedReturn(callPremiumRatio(443, 372, 1), 27) - 0.161) < 0.001)
check('MSTR call yield does not depend on the contract count', Math.abs(callPremiumRatio(1_020, 145.12, 3) - callPremiumRatio(680, 145.12, 2)) < 1e-12)
check('SPCX sits outside the 0.20-0.30 delta band', ranked.find(row => row.symbol === 'SPCX')?.band === 'out')
check('ARM delta is unknown, not outside the band', deltaInBand(null, 0.2, 0.3) === 'unknown')
check('MSTR put stays ranked and is blocked by the no-new-puts rule', ranked.find(row => row.symbol === 'MSTR')?.blockedMstr === true && ranked.find(row => row.symbol === 'MSTR')?.excluded === false)
check('exclude list keeps the named underlyings', ['AAOI', 'UMAC', 'SOFI', 'AMZN', 'IBIT', 'BIDU', 'BABA'].every(symbol => DEFAULT_INCOME_SETTINGS.excludeSymbols.includes(symbol)))
check('IBIT and BSOL are ETFs', DEFAULT_INCOME_SETTINGS.etfSymbols.includes('IBIT') && DEFAULT_INCOME_SETTINGS.etfSymbols.includes('BSOL'))

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
const personalBook = toLiveBook(personal, now)
const businessBook = toLiveBook(business, now)
check('display names keep Personal and redact an IBKR id', personalBook.name === 'Personal' && businessBook.name === 'Business' && toLiveBook(other, now).name === 'Other account')
check('live book does not carry an account id', !('accountId' in personalBook) && personalBook.shortOptions.every(row => !('accountId' in row)))
check('short close cost is mark times multiplier', personalBook.shortOptions.find(row => row.underlying === 'MSTR')?.closeCost === 4_888, String(personalBook.shortOptions.find(row => row.underlying === 'MSTR')?.closeCost))
check('realised this month ignores opens and other months', personalBook.realisedThisMonth === 250)
check('opening fifo is not monthly income', realisedInMonth(personal.trades, '202610') === 250)
check('TSLA call is covered by 100 shares and two contracts would not be', callCover(personalBook, 'TSLA', 1) === 'covered' && callCover(personalBook, 'TSLA', 2) === 'short')
check('a book with no positions cannot claim share cover', callCover(toLiveBook(other, now), 'TSLA', 1) === 'unknown')

const saved = normalizeSettings({ elFloor: 25_000, screenExpiry: '2026-12-18', deltaMin: 0.15, deltaMax: 0.25, excludeSymbols: 'aaoi, tsla', exits: [{ symbol: 'BIDU', price: 150 }, { symbol: 'NVDA', price: 140 }], noNewMstrPuts: false })
check('settings keep an edited floor, expiry, delta, and exit', saved.elFloor === 25_000 && saved.screenExpiry === '2026-12-18' && saved.deltaMin === 0.15 && saved.rules.find(rule => rule.symbol === 'BIDU' && rule.type === 'exit')?.value === 150)
check('a saved BABA exit, extra exit, and TSLA covered-call rule stay', saved.rules.some(rule => rule.symbol === 'BABA' && rule.type === 'exit' && rule.value === 190) && saved.rules.some(rule => rule.symbol === 'NVDA' && rule.type === 'exit' && rule.value === 140) && saved.rules.some(rule => rule.symbol === 'TSLA' && rule.type === 'coveredCalls'))
check('edited exclude list replaces the default', saved.excludeSymbols.join(',') === 'AAOI,TSLA')
check('turning off the MSTR rule is kept', !saved.rules.some(rule => rule.symbol === 'MSTR' && rule.type === 'noNewPuts' && rule.date == null))
const roundTrip = normalizeSettings({ rules: [{ symbol: 'nvda', type: 'capExposure', value: 10, date: null }, { symbol: '', type: 'exit', value: null, date: null }] })
check('a rules list round-trips, including a blank row', roundTrip.rules.length === 2 && roundTrip.rules[0].symbol === 'NVDA' && roundTrip.rules[0].type === 'capExposure' && roundTrip.rules[0].value === 10 && roundTrip.rules[1].symbol === '')
check('an empty rules list stays empty', normalizeSettings({ rules: [] }).rules.length === 0)
check('earnings dates migrate into dated no-new-puts rules', normalizeSettings({}).rules.some(rule => rule.symbol === 'GOOGL' && rule.type === 'noNewPuts' && rule.date === '2026-10-28') && normalizeSettings({ earningsBlackouts: [{ symbol: 'amd', date: '2026-12-01', label: 'AMD earnings' }] }).rules.some(rule => rule.symbol === 'AMD' && rule.date === '2026-12-01'))
check('a broken blob falls back to capital split and the default tax', normalizeSettings('nope').splitMode === 'capital' && normalizeSettings('nope').personalTaxRate === 0.3 && normalizeSettings({}).rankBy === 'premiumOverCash')
const legacy = normalizeSettings({ personalTarget: 5_150, businessTarget: 6_100, returnRate: 0.3, personalTaxRate: 30, businessTaxRate: 25, personalSplitPct: 1 })
check('legacy fixed targets and a return rate are not kept', !('personalTarget' in legacy) && !('returnRate' in legacy) && legacy.splitMode === 'capital')
check('a tax typed as 30 is stored as 0.30 and 0.30 stays 0.30', legacy.personalTaxRate === 0.3 && legacy.businessTaxRate === 0.25 && normalizeSettings({ personalTaxRate: 0.3 }).personalTaxRate === 0.3)
check('a personal share of 1 stays 1 percent', legacy.personalSplitPct === 1)

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
const totalOnly = parseFlexDocument(flexDoc([
  { tag: 'EquitySummaryInBase', attrs: { reportDate: '20261023', total: '250000' } },
]) as unknown as Document)
check('equity summary total is net liquidation when the named attribute is absent', totalOnly.netLiquidation === 250_000)
const namedWins = parseFlexDocument(flexDoc([
  { tag: 'EquitySummaryInBase', attrs: { reportDate: '20261023', netLiquidation: '11', total: '250000' } },
]) as unknown as Document)
check('an explicit netLiquidation wins over total', namedWins.netLiquidation === 11)
const historyTotal = parseFlexDocument(flexDoc([
  { tag: 'EquitySummaryByReportDateInBase', attrs: { reportDate: '20261022', total: '240000' } },
  { tag: 'EquitySummaryByReportDateInBase', attrs: { reportDate: '20261023', Total: '250000' } },
]) as unknown as Document)
check('equity history reads total and keeps the latest row', historyTotal.netLiquidation === 250_000 && historyTotal.equityHistory?.at(-1)?.netLiquidation === 250_000 && historyTotal.equityHistory?.[0]?.netLiquidation === 240_000)
check('stock and option market value plus cash fills a missing net liquidation', resolvedNetLiquidation({
  cashBalance: 100,
  positions: [
    { assetClass: 'STK', positionValue: 50 },
    { assetClass: 'OPT', positionValue: -10 },
    { assetClass: 'CASH', positionValue: 999 },
  ],
}) === 140)
check('an explicit net liquidation is kept, including zero', resolvedNetLiquidation({ netLiquidation: 0, cashBalance: 100, positions: [{ assetClass: 'STK', positionValue: 50 }] }) === 0 && resolvedNetLiquidation({ netLiquidation: 5, cashBalance: 100 }) === 5)
check('the latest equity history point fills a missing net liquidation', resolvedNetLiquidation({ equityHistory: [{ netLiquidation: 1 }, { netLiquidation: 9 }], cashBalance: 100 }) === 9)
check('no snapshot stays undefined', resolvedNetLiquidation({}) === undefined)

const accountView = readFileSync(new URL('../src/components/portfolio/AccountView.tsx', import.meta.url), 'utf8')
const planCards = readFileSync(new URL('../src/components/overview/PlanCards.tsx', import.meta.url), 'utf8')
const overview = readFileSync(new URL('../src/components/overview/OverviewView.tsx', import.meta.url), 'utf8')
check('the Income tab and page are gone', !accountView.includes("label: 'Income'") && !accountView.includes('IncomeView') && !accountView.includes("| 'income'"))
check('an old income URL is rewritten to Overview', accountView.includes("params.get('section') === 'income'") && accountView.includes("params.set('section', 'overview')"))
check('plan cards do not place an order or read a flex token', !planCards.includes('<button') && !planCards.includes('accountId') && !planCards.includes('flexToken') && !planCards.includes('flexQueryId'))
check('ideas come from the live book, not the October action list', planCards.includes('liveIdeas') && !planCards.includes('SEED_NEXT_ACTIONS') && !planCards.includes('SEED_SELLS'))
check('an empty idea list says there is nothing pending', planCards.includes('No pending ideas'))

const nov2 = new Date(2026, 10, 2, 12, 0, 0)
check('horizon stays three weeks when the screen date is already past', ideaHorizon('2026-11-02', '2026-10-30') === '2026-11-23')
check('a later screen expiry extends the idea horizon', ideaHorizon('2026-11-02', '2026-12-18') === '2026-12-18')

function bookFrom(name: string, positions: RawPosition[], excessLiquidity?: number): IncomeSource {
  return { name, positions, trades: [], cashBalance: 10_000, netLiquidation: 100_000, excessLiquidity }
}
const rolled = toLiveBook(bookFrom('Personal', [
  opt({ symbol: 'ARM', putCall: 'P', strike: 180, quantity: -1, markPrice: 5.85, expiry: '20261120' }),
  opt({ symbol: 'MSTR', putCall: 'P', strike: 160, quantity: -2, markPrice: 24.435, expiry: '20261218' }),
]), nov2)
const rolledIdeas = liveIdeas(rolled, DEFAULT_INCOME_SETTINGS, nov2)
const rolledText = rolledIdeas.map(idea => `${idea.symbol} ${idea.strike ?? ''} ${idea.kind} ${ideaCopy(idea, '2026-11-02').text}`)
check('the rolled ARM 180P is a resolve idea and the old 240P is not', rolledIdeas.some(idea => idea.symbol === 'ARM' && idea.strike === 180 && idea.kind === 'resolve' && idea.closeCost === 585) && !rolledIdeas.some(idea => idea.strike === 240), rolledText.join(' | '))
check('a far MSTR put is not closed just because new MSTR puts are blocked', !rolledIdeas.some(idea => idea.symbol === 'MSTR'))
check('SOFI is absent once the October put has left the book', !rolledIdeas.some(idea => idea.symbol === 'SOFI'))
check('the ARM earnings blackout stays through 4 Nov and the GOOGL blackout has expired', rolledIdeas.some(idea => idea.kind === 'blackout' && idea.symbol === 'ARM' && idea.date === '2026-11-04') && !rolledIdeas.some(idea => idea.symbol === 'GOOGL'))
check('blackout copy names the rule date', ideaCopy(rolledIdeas.find(idea => idea.kind === 'blackout' && idea.symbol === 'ARM')!, '2026-11-02').text === 'No new puts through 4 Nov')
check('resolve copy names the live strike and date without the buyback cost', ideaCopy(rolledIdeas.find(idea => idea.strike === 180)!, '2026-11-02').text === 'Resolve 180P before 20 Nov')
const twoArm = liveIdeas(toLiveBook(bookFrom('Personal', [
  opt({ symbol: 'ARM', putCall: 'P', strike: 180, quantity: -2, markPrice: 5.85, expiry: '20261120' }),
], 80_000), nov2), { ...DEFAULT_INCOME_SETTINGS, rules: [] }, nov2)
check('a two-lot short keeps its size without the buyback cost', ideaCopy(twoArm.find(idea => idea.strike === 180)!, '2026-11-02').text === 'Resolve 2× 180P before 20 Nov')

const stillExpired = toLiveBook(bookFrom('Personal', [
  opt({ symbol: 'SOFI', putCall: 'P', strike: 14.5, quantity: -1, markPrice: 0.05, expiry: '20261030' }),
], 40_000), nov2)
const expiredIdeas = liveIdeas(stillExpired, { ...DEFAULT_INCOME_SETTINGS, rules: [] }, nov2)
check('a short that is still in the book after its expiry is a close idea', expiredIdeas.some(idea => idea.kind === 'expired' && idea.symbol === 'SOFI' && idea.strike === 14.5) && ideaCopy(expiredIdeas[0], '2026-11-02').text === 'Close 14.5P — expired 30 Oct')

const repairBook = toLiveBook(bookFrom('Business', [
  opt({ symbol: 'UMAC', putCall: 'P', strike: 20, quantity: -1, markPrice: 48.06, expiry: '20270115' }),
  opt({ symbol: 'BSOL', putCall: 'P', strike: 16, quantity: -1, markPrice: 2.18, expiry: '20270115' }),
], 10_000), nov2)
const repairSettings: IncomeSettings = { ...DEFAULT_INCOME_SETTINGS, rules: [] }
const repairIdeas = liveIdeas(repairBook, repairSettings, nov2)
check('excluded and ETF shorts are repair ideas while EL is under the floor', repairIdeas.some(idea => idea.symbol === 'UMAC' && idea.kind === 'repair') && repairIdeas.some(idea => idea.symbol === 'BSOL' && idea.kind === 'repair') && repairIdeas.some(idea => idea.kind === 'floor' && idea.amount === 20_000))
check('repair copy keeps the live strike and expiry without the buyback cost', ideaCopy(repairIdeas.find(idea => idea.symbol === 'UMAC')!, '2026-11-02').text === 'Close 20P 15 Jan \'27 until EL is above 30,000')
const repaired = liveIdeas(toLiveBook(bookFrom('Business', [
  opt({ symbol: 'UMAC', putCall: 'P', strike: 20, quantity: -1, markPrice: 48.06, expiry: '20270115' }),
], 40_000), nov2), repairSettings, nov2)
check('those repair ideas drop once EL is back above the floor', repaired.length === 0)

const businessOnly = liveIdeas(toLiveBook(bookFrom('Business', [
  opt({ symbol: 'BSOL', putCall: 'P', strike: 16, quantity: -10, markPrice: 2.18, expiry: '20261120' }),
], 80_000), nov2), DEFAULT_INCOME_SETTINGS, nov2)
check('business ideas stay on the business book', businessOnly.some(idea => idea.symbol === 'BSOL' && idea.strike === 16 && idea.kind === 'resolve') && !businessOnly.some(idea => idea.strike === 180 || idea.symbol === 'SOFI'))
check('personal ideas do not pick up the business short', !rolledIdeas.some(idea => idea.symbol === 'BSOL'))

const withBidu = liveIdeas(toLiveBook(bookFrom('Personal', [
  { accountId: 'SHOULD-NOT-LEAK', symbol: 'BIDU', description: 'BIDU', assetClass: 'STK', quantity: 100, costBasisPrice: 1, costBasisMoney: 100, markPrice: 140, positionValue: 14_000, unrealizedPnL: 0, currency: 'USD' },
], 80_000), nov2), DEFAULT_INCOME_SETTINGS, nov2)
const withoutBidu = liveIdeas(toLiveBook(bookFrom('Personal', [], 80_000), nov2), DEFAULT_INCOME_SETTINGS, nov2)
check('an exit rule stays while the shares are held and drops when they are gone', withBidu.some(idea => idea.kind === 'exit' && idea.symbol === 'BIDU' && idea.amount === 160) && !withoutBidu.some(idea => idea.kind === 'exit'))
check('a long option still counts as holding the exit name', liveIdeas(toLiveBook(bookFrom('Personal', [], 80_000), nov2), DEFAULT_INCOME_SETTINGS, nov2, ['bidu']).some(idea => idea.kind === 'exit' && idea.symbol === 'BIDU'))

function ideaPanel(html: string): string {
  const start = html.indexOf('data-testid="ideas-panel"')
  const end = html.indexOf('data-testid="puts-credit-total"')
  return start >= 0 && end > start ? html.slice(start, end) : ''
}
function viewAccount(name: string, positions: RawPosition[], excessLiquidity: number): Account {
  return { id: name, name, trades: [], positions, cashBalance: 10_000, netLiquidation: 100_000, excessLiquidity }
}
const personalPage = renderToStaticMarkup(createElement(PlanCards, {
  account: viewAccount('Personal', [
    opt({ symbol: 'ARM', putCall: 'P', strike: 180, quantity: -1, markPrice: 5.85, expiry: '20261120' }),
    { accountId: 'x', symbol: 'TSLA', description: 'TSLA', assetClass: 'STK', quantity: 100, costBasisPrice: 1, costBasisMoney: 100, markPrice: 372, positionValue: 37_200, unrealizedPnL: 0, currency: 'USD' },
  ], 40_000),
  settings: DEFAULT_INCOME_SETTINGS,
  today: nov2,
}))
const personalHtml = ideaPanel(personalPage)
const callsHtml = personalPage.slice(personalPage.indexOf('data-testid="calls-credit-total"'))
check('the ideas card renders the live ARM put and drops the October lines', personalHtml.includes('Resolve') && personalHtml.includes('180P') && personalHtml.includes('before 20 Nov') && personalHtml.includes('income-ticker') && !personalHtml.includes('240P') && !personalHtml.includes('30 Oct') && !personalHtml.includes('let SOFI') && !personalHtml.includes('five trades') && !personalHtml.includes('16P') && !personalHtml.includes('(585)'))
check('calls wait for a live bid instead of the October premium', callsHtml.includes('Waiting for live bids') && callsHtml.includes('>Expiry<') && !callsHtml.includes('1,020') && !callsHtml.includes('175C'))
const liveBid = renderToStaticMarkup(createElement(PlanCards, {
  account: viewAccount('Personal', [
    { accountId: 'x', symbol: 'TSLA', description: 'TSLA', assetClass: 'STK', quantity: 100, costBasisPrice: 1, costBasisMoney: 100, markPrice: 372, positionValue: 37_200, unrealizedPnL: 0, currency: 'USD' },
    { accountId: 'x', symbol: 'MSTR', description: 'MSTR', assetClass: 'STK', quantity: 300, costBasisPrice: 1, costBasisMoney: 300, markPrice: 145.12, positionValue: 43_536, unrealizedPnL: 0, currency: 'USD' },
  ], 40_000),
  settings: DEFAULT_INCOME_SETTINGS,
  today: nov2,
  liveScreen: {
    loaded: true,
    calls: [{ symbol: 'MSTR', strike: 150, contracts: 3, spot: 126, bid: 2.4, premium: 720, delta: 0.25, quotedAt: Date.parse('2026-11-09T21:00:00Z'), stale: true }],
    puts: [],
    putQuotedAt: {},
    putStale: {},
  },
}))
check('a live call shows the bid credit and the quote time', liveBid.includes('150C') && liveBid.includes('720') && liveBid.includes('bid ·') && liveBid.includes('Stale') && !liveBid.includes('175C') && !liveBid.includes('1,020'))
const businessHtml = ideaPanel(renderToStaticMarkup(createElement(PlanCards, {
  account: viewAccount('Business', [
    opt({ symbol: 'BSOL', putCall: 'P', strike: 16, quantity: -10, markPrice: 2.18, expiry: '20261120' }),
  ], 80_000),
  settings: DEFAULT_INCOME_SETTINGS,
  today: nov2,
})))
check('the business ideas card does not show the personal ARM put', businessHtml.includes('16P') && businessHtml.includes('BSOL') && !businessHtml.includes('180P'))
const emptyHtml = ideaPanel(renderToStaticMarkup(createElement(PlanCards, {
  account: viewAccount('Personal', [], 80_000),
  settings: { ...DEFAULT_INCOME_SETTINGS, rules: [] },
  today: nov2,
})))
check('the ideas card says when nothing qualifies', emptyHtml.includes('No pending ideas'))
const otherHtml = renderToStaticMarkup(createElement(PlanCards, {
  account: viewAccount('Joint', [], 80_000),
  settings: DEFAULT_INCOME_SETTINGS,
  today: nov2,
}))
check('an account that is neither personal nor business has no ideas card', !otherHtml.includes('ideas-panel'))
check('overview no longer mounts the allocation pie', !overview.includes('PortfolioPie') && !overview.includes('ov-pie-panel'))
check('display name redacts a U-number', displayAccountName('U21440275') === 'Other account' && displayAccountName('Personal') === 'Personal')

if (failed > 0) {
  console.error(`${failed} failed`)
  process.exit(1)
}
console.log('income plan ok')
