/**
 * Income plan math: live Flex figures stay separate from the 23 Oct snapshot.
 * Run with: npm test
 */
import { readFileSync } from 'node:fs'
import { parseFlexDocument } from '../src/services/ibkr'
import { DEFAULT_INCOME_SETTINGS, SEED_PUTS, SEED_SELLS } from '../src/income/incomeSeed'
import { DEFAULT_MILESTONE_CONFIG, buildYears, monthsBetween } from '../src/components/dashboard/milestoneYears'
import {
  accountRules,
  annualizedReturn,
  booksFor,
  btcCap,
  callCover,
  callYield,
  deltaInBand,
  displayAccountName,
  elState,
  exitUpside,
  livePairExits,
  milestoneIncome,
  planPremium,
  premiumOverCash,
  putScreenRows,
  quoteFreshness,
  realisedInMonth,
  resolvedNetLiquidation,
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
check('the plan no longer stores a fixed monthly target', !('personalTarget' in DEFAULT_INCOME_SETTINGS) && !('businessTarget' in DEFAULT_INCOME_SETTINGS) && DEFAULT_INCOME_SETTINGS.splitMode === 'capital')

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

const personalRules = accountRules(personalBook, DEFAULT_INCOME_SETTINGS)
const businessBook = books.find(book => book.role === 'business')!
const businessRules = accountRules(businessBook, DEFAULT_INCOME_SETTINGS)
const rule = (id: string) => personalRules.find(row => row.id === id)
check('personal EL under the floor fails and business EL passes', rule('el')?.status === 'no' && businessRules.find(row => row.id === 'el')?.status === 'yes')
check('missing EL stays unknown', elState(toLiveBook(other, now).excessLiquidity, 30_000) === 'unknown')
check('open MSTR put fails the no-new-puts rule on this account only', rule('mstr-puts')?.status === 'no' && !rule('mstr-puts')?.detail.includes('Personal'))
check('BSOL short put fails the ETF rule on the business book', businessRules.find(row => row.id === 'etf')?.status === 'no')
check('AAOI short put fails the exclude list', rule('excluded-puts')?.status === 'no' && rule('excluded-puts')?.detail.includes('AAOI') === true)
check('covered TSLA call passes', rule('tsla-calls')?.status === 'yes')
const cap = btcCap([personalBook, businessBook])
check('BTC cap sums both books without naming an account or a strike', cap.mstrShares === 200 && cap.mstrPutContracts === 2 && cap.bsolPutContracts === 10 && cap.over === true && !cap.detail.includes('Personal') && !cap.detail.includes('Business') && !cap.detail.includes('160') && !cap.detail.includes('16P'))

check('Saturday is a prior close', quoteFreshness({ now: new Date('2026-10-24T15:00:00Z') }).stale && quoteFreshness({ now: new Date('2026-10-24T15:00:00Z') }).label === 'Prior close')
check('Wednesday midday is a regular session without a market state', quoteFreshness({ now: new Date('2026-10-21T15:00:00Z') }).stale === false)
check('after the cash close is after hours', quoteFreshness({ now: new Date('2026-10-21T21:00:00Z') }).label === 'After hours')
check('Yahoo POST overrides the clock', quoteFreshness({ marketState: 'POST', now: new Date('2026-10-21T15:00:00Z') }).label === 'After hours')
check('Yahoo REGULAR is fresh', quoteFreshness({ marketState: 'REGULAR', now: new Date('2026-10-24T15:00:00Z') }).stale === false)

const saved = normalizeSettings({ elFloor: 25_000, screenExpiry: '2026-12-18', deltaMin: 0.15, deltaMax: 0.25, excludeSymbols: 'aaoi, tsla', exits: [{ symbol: 'BIDU', price: 150 }], noNewMstrPuts: false })
check('settings keep an edited floor, expiry, delta, and exit', saved.elFloor === 25_000 && saved.screenExpiry === '2026-12-18' && saved.deltaMin === 0.15 && saved.exits.find(exit => exit.symbol === 'BIDU')?.price === 150)
check('edited exclude list replaces the default', saved.excludeSymbols.join(',') === 'AAOI,TSLA')
check('turning off the MSTR rule is kept', saved.noNewMstrPuts === false)
check('a broken blob falls back to capital split and the default tax', normalizeSettings('nope').splitMode === 'capital' && normalizeSettings('nope').personalTaxRate === 0.3 && normalizeSettings({}).rankBy === 'premiumOverCash')
const legacy = normalizeSettings({ personalTarget: 5_150, businessTarget: 6_100, returnRate: 0.3, personalTaxRate: 30, businessTaxRate: 25, personalSplitPct: 1 })
check('legacy fixed targets and a return rate are not kept', !('personalTarget' in legacy) && !('returnRate' in legacy) && legacy.splitMode === 'capital')
check('a tax typed as 30 is stored as 0.30 and 0.30 stays 0.30', legacy.personalTaxRate === 0.3 && legacy.businessTaxRate === 0.25 && normalizeSettings({ personalTaxRate: 0.3 }).personalTaxRate === 0.3)
check('a personal share of 1 stays 1 percent', legacy.personalSplitPct === 1)

const milestoneToday = new Date(2026, 9, 24)
const fx = 0.65
const milestoneDec = buildYears(DEFAULT_MILESTONE_CONFIG, milestoneToday).find(row => row.decDate?.getFullYear() === 2026 && row.decEnd != null)
const milestoneArgs = {
  config: DEFAULT_MILESTONE_CONFIG,
  today: milestoneToday,
  personalNlv: 134_982,
  businessNlv: 156_539,
  otherNlv: [] as number[],
  audUsd: fx as number | null,
  splitMode: 'capital' as const,
  personalSplitPct: 20,
  personalTaxRate: 0.3,
  businessTaxRate: 0.25,
  personalInterestAud: 500,
  businessInterestAud: 1_350,
}
const income = milestoneIncome(milestoneArgs)
const milestoneMonths = monthsBetween(milestoneToday, milestoneDec!.decDate!)
const combinedNlv = 134_982 + 156_539
const monthlyBase = Math.max(0, milestoneDec!.decEnd! * fx - combinedNlv) / (milestoneMonths > 0 ? milestoneMonths : 1)
const capitalShare = 134_982 / combinedNlv
check('this December matches the milestone curve, not a second formula', income.current?.year === 2026 && income.current.decEndAud === milestoneDec!.decEnd)
check('monthly base is the clamped gap over the months left', Math.abs((income.current?.monthlyBaseUsd ?? NaN) - monthlyBase) < 1e-6)
check('personal target grosses the capital share up and adds interest', Math.abs((income.current?.personalTarget ?? NaN) - (monthlyBase * capitalShare / 0.7 + 500 * fx)) < 1e-4)
check('business target uses its own tax and interest', Math.abs((income.current?.businessTarget ?? NaN) - (monthlyBase * (1 - capitalShare) / 0.75 + 1_350 * fx)) < 1e-4)
const later = income.rows[1]
check('a later year is the gap between December targets over 12 months', later.months === 12 && Math.abs((later.monthlyBaseUsd ?? NaN) - Math.max(0, (later.decEndAud - income.rows[0].decEndAud) * fx) / 12) < 1e-4)
const above = milestoneIncome({ ...milestoneArgs, personalNlv: 5_000_000, businessNlv: 5_000_000 })
check('a portfolio already above the milestone pays interest only', above.current?.monthlyBaseUsd === 0 && Math.abs((above.current?.personalTarget ?? NaN) - 500 * fx) < 1e-6 && Math.abs((above.current?.businessTarget ?? NaN) - 1_350 * fx) < 1e-6)
const missingNlv = milestoneIncome({ ...milestoneArgs, personalNlv: undefined })
check('missing net liquidation blocks the dollar target and keeps the AUD year end', missingNlv.current?.personalTarget == null && missingNlv.nlvNote != null && missingNlv.current?.decEndAud === milestoneDec!.decEnd)
const missingFx = milestoneIncome({ ...milestoneArgs, audUsd: null })
check('a missing FX rate does not fall back to 0.65', missingFx.audUsd == null && missingFx.fxNote != null && missingFx.current?.personalTarget == null && missingFx.current?.decEndUsd == null && missingFx.current?.monthlyBaseUsd == null && missingFx.current?.decEndAud === milestoneDec!.decEnd)
const fixed = milestoneIncome({ ...milestoneArgs, splitMode: 'fixed' })
check('a fixed 20 percent split ignores the capital weights', fixed.personalShare === 0.2 && fixed.businessShare === 0.8 && Math.abs((fixed.current?.personalTarget ?? NaN) - (monthlyBase * 0.2 / 0.7 + 500 * fx)) < 1e-4)
const fixedMissing = milestoneIncome({ ...milestoneArgs, splitMode: 'fixed', personalNlv: undefined })
check('a fixed share without net liquidation still has no dollar target', fixedMissing.personalShare === 0.2 && fixedMissing.current?.personalTarget == null)
const withOther = milestoneIncome({ ...milestoneArgs, otherNlv: [10_000, Number.NaN] })
check('another account with a balance is in the gap and not in the split', Math.abs((withOther.current?.monthlyBaseUsd ?? NaN) - Math.max(0, milestoneDec!.decEnd! * fx - (combinedNlv + 10_000)) / milestoneMonths) < 1e-6 && withOther.personalShare === capitalShare)

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

const view = readFileSync(new URL('../src/components/income/IncomeView.tsx', import.meta.url), 'utf8')
function optPos(partial: Partial<RawPosition> & Pick<RawPosition, 'symbol' | 'quantity' | 'putCall' | 'strike' | 'expiry' | 'markPrice'>): RawPosition {
  return {
    accountId: '',
    description: partial.symbol,
    assetClass: 'OPT',
    costBasisPrice: 0,
    costBasisMoney: 0,
    positionValue: partial.markPrice * partial.quantity * 100,
    unrealizedPnL: 0,
    currency: 'USD',
    multiplier: 100,
    underlyingSymbol: partial.symbol,
    ...partial,
  }
}
const pairToday = new Date(2026, 9, 24)
const hkPair = livePairExits([
  optPos({ symbol: 'BABA', putCall: 'C', strike: 110, expiry: '20290115', quantity: 2, markPrice: 24.73 }),
  optPos({ symbol: '9988  290115P00120000', underlyingSymbol: '9988', putCall: 'P', strike: 120, expiry: '20290115', quantity: -2, markPrice: 32.96 }),
], { today: pairToday, spots: { BABA: 99.66 }, exits: [{ symbol: 'BABA', price: 190 }] })
check('a Hong Kong 9988 put pairs with the BABA call', hkPair.length === 1 && hkPair[0].underlying === 'BABA' && hkPair[0].quantity === 2 && hkPair[0].callStrike === 110 && hkPair[0].putStrike === 120)
check('an exit price replaces cash to convert', hkPair[0].flag === 'exit' && hkPair[0].exitPrice === 190 && hkPair[0].cash == null && hkPair[0].shares == null && Math.abs((hkPair[0].net ?? NaN) - (24.73 - 32.96)) < 1e-9)
const bidu = livePairExits([
  optPos({ symbol: 'BIDU', putCall: 'C', strike: 90, expiry: '20280120', quantity: 1, markPrice: 12.51 }),
  optPos({ symbol: '9888', underlyingSymbol: '9888', putCall: 'P', strike: 90, expiry: '20280120', quantity: -1, markPrice: 21.09 }),
], { today: pairToday, spots: { BIDU: 77.22 } })
check('9888 pairs as BIDU and cash is spot times shares', bidu.length === 1 && bidu[0].underlying === 'BIDU' && bidu[0].flag === 'convert' && bidu[0].shares === 100 && bidu[0].cash === 77.22 * 100)
const two = livePairExits([
  optPos({ symbol: 'LRCX', putCall: 'C', strike: 230, expiry: '20280616', quantity: 1, markPrice: 68 }),
  optPos({ symbol: 'LRCX', putCall: 'C', strike: 260, expiry: '20280616', quantity: 1, markPrice: 58 }),
  optPos({ symbol: 'LRCX', putCall: 'P', strike: 240, expiry: '20280616', quantity: -1, markPrice: 60 }),
  optPos({ symbol: 'LRCX', putCall: 'P', strike: 270, expiry: '20280616', quantity: -1, markPrice: 79 }),
], { today: pairToday, spots: { LRCX: 229.9 } })
check('two strikes on one ticker stay two pairs', two.filter(row => row.kind === 'pair').length === 2 && two.some(row => row.callStrike === 230 && row.putStrike === 240) && two.some(row => row.callStrike === 260 && row.putStrike === 270))
const leftover = livePairExits([
  optPos({ symbol: 'UMAC', putCall: 'C', strike: 20, expiry: '20290115', quantity: 10, markPrice: 8.51 }),
  optPos({ symbol: 'UMAC', putCall: 'P', strike: 22.5, expiry: '20290115', quantity: -10, markPrice: 11.66 }),
  optPos({ symbol: 'UMAC', putCall: 'P', strike: 20, expiry: '20270617', quantity: -10, markPrice: 4.81 }),
], { today: pairToday, spots: { UMAC: 17.05 } })
check('a shorter put left beside a pair is marked close', leftover.some(row => row.flag === 'convert' && row.quantity === 10) && leftover.some(row => row.flag === 'close' && row.putStrike === 20 && row.quantity === 10))
const alone = livePairExits([
  optPos({ symbol: 'BSOL', putCall: 'P', strike: 16, expiry: '20261120', quantity: -10, markPrice: 2.18 }),
], { today: pairToday })
check('a short put with no long call is not a pair', alone.length === 0)
const lots = livePairExits([
  optPos({ symbol: 'ARM', putCall: 'C', strike: 230, expiry: '20280616', quantity: 1, markPrice: 65, levelOfDetail: 'SUMMARY' }),
  optPos({ symbol: 'ARM', putCall: 'C', strike: 230, expiry: '20280616', quantity: 1, markPrice: 65, levelOfDetail: 'LOT' }),
  optPos({ symbol: 'ARM', putCall: 'P', strike: 240, expiry: '20280616', quantity: -1, markPrice: 78, levelOfDetail: 'SUMMARY' }),
], { today: pairToday, spots: { ARM: 208.5 } })
check('a lot row does not double the summary pair', lots.length === 1 && lots[0].quantity === 1 && lots[0].cash === 208.5 * 100)

check('income page has no order button', !view.includes('<button'))
check('income page does not read account ids or flex tokens', !view.includes('accountId') && !view.includes('flexToken') && !view.includes('flexQueryId'))
check('income page does not keep a fixed target or a 0.65 FX fallback', !view.includes('5_150') && !view.includes('5150') && !view.includes('6_100') && !view.includes('6100') && !view.includes('0.65') && !view.includes('liveRules'))
check('pair exits are not the 23 Oct snapshot', !view.includes('SEED_PAIRS') && !view.includes('SEED_BUSINESS_RISK'))
check('display name redacts a U-number', displayAccountName('U21440275') === 'Other account' && displayAccountName('Personal') === 'Personal')

if (failed > 0) {
  console.error(`${failed} failed`)
  process.exit(1)
}
console.log('income plan ok')
