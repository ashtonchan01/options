/**
 * Static income-plan snapshot from the 23 Oct 2026 US close (pulled 24 Oct).
 * Premiums, mids, deltas, and narrative ideas are not live quotes. Live
 * positions, cash, net liquidation, excess liquidity, and realised P&L come
 * from the Flex book in incomeLive.ts and must not be filled from this file.
 */

export const SEED_MARK_DATE = '2026-10-24'
export const SEED_CLOSE_LABEL = '23 Oct 2026 close'

export type SplitMode = 'capital' | 'fixed'

export interface IncomeSettings {
  elFloor: number
  targetNote: string
  /** capital: each account's share of live net liquidation. fixed: personalSplitPct. */
  splitMode: SplitMode
  /** Personal share of the monthly base when splitMode is fixed. 20 means 20%. */
  personalSplitPct: number
  /** Fraction. 0.30 is 30%. Applied after the milestone gap is split. */
  personalTaxRate: number
  businessTaxRate: number
  personalInterestAud: number
  businessInterestAud: number
  /** YYYY-MM-DD */
  screenExpiry: string
  deltaMin: number
  deltaMax: number
  /** Rank key. Premium / cash secured is the screen default. */
  rankBy: 'premiumOverCash'
  excludeSymbols: string[]
  /** Option underlyings Flex does not label as ETFs. */
  etfSymbols: string[]
  /** Ticker-agnostic rules. Exit price, put/call blocks, covered calls, and caps. */
  rules: IncomeRule[]
}

export type IncomeRuleType = 'exit' | 'noNewPuts' | 'noNewCalls' | 'capExposure' | 'coveredCalls'

export interface IncomeRule {
  symbol: string
  type: IncomeRuleType
  /** Exit price, or a cap percent. Empty when the rule type does not use it. */
  value: number | null
  /** YYYY-MM-DD. A no-new-puts rule with a date blocks puts through that date. */
  date: string | null
}

export const INCOME_RULE_TYPES: { type: IncomeRuleType; label: string }[] = [
  { type: 'exit', label: 'Exit/close synthetic' },
  { type: 'noNewPuts', label: 'No new puts' },
  { type: 'noNewCalls', label: 'No new calls' },
  { type: 'capExposure', label: 'Cap exposure' },
  { type: 'coveredCalls', label: 'Covered calls only' },
]

export const DEFAULT_INCOME_SETTINGS: IncomeSettings = {
  elFloor: 30_000,
  targetNote: 'The monthly base is the gap from combined net liquidation up to the Milestone page’s next 31 Dec target, spread over the months left. Later years use the gap between consecutive 31 Dec targets. Each account then grosses its share up for tax and adds its own AUD interest at the live AUD/USD rate.',
  splitMode: 'capital',
  personalSplitPct: 20,
  personalTaxRate: 0.3,
  businessTaxRate: 0.25,
  personalInterestAud: 500,
  businessInterestAud: 1_350,
  screenExpiry: '2026-11-20',
  deltaMin: 0.2,
  deltaMax: 0.3,
  rankBy: 'premiumOverCash',
  excludeSymbols: ['AAOI', 'UMAC', 'SOFI', 'AMZN', 'IBIT', 'BIDU', 'BABA'],
  etfSymbols: ['IBIT', 'BSOL', 'SPY', 'QQQ', 'IWM', 'DIA', 'TLT', 'GLD', 'SLV', 'BITO', 'GBTC', 'ETHA', 'EEM', 'VTI', 'VOO', 'VXX', 'UVXY', 'TQQQ', 'SQQQ', 'ARKK', 'XLF', 'XLE', 'SMH'],
  rules: [
    { symbol: 'BIDU', type: 'exit', value: 160, date: null },
    { symbol: 'BABA', type: 'exit', value: 190, date: null },
    { symbol: 'MSTR', type: 'noNewPuts', value: null, date: null },
    { symbol: 'TSLA', type: 'coveredCalls', value: null, date: null },
    { symbol: 'GOOGL', type: 'noNewPuts', value: null, date: '2026-10-28' },
    { symbol: 'ARM', type: 'noNewPuts', value: null, date: '2026-11-04' },
  ],
}

export interface SeedSell {
  account: 'personal' | 'business'
  label: string
  cover: string
  premium: number
  phase: 'now' | 'afterRepair'
}

export const SEED_SELLS: SeedSell[] = [
  { account: 'personal', label: 'TSLA 410C Nov 20 x1', cover: 'Now; covered by 100 sh', premium: 443, phase: 'now' },
  { account: 'personal', label: 'MSTR 175C Nov 20 x3', cover: 'After repair', premium: 1_020, phase: 'afterRepair' },
  { account: 'business', label: 'ALAB 220P Nov 20', cover: '22,000 cash', premium: 1_123, phase: 'now' },
  { account: 'business', label: 'MRVL 200P Nov 20', cover: '20,000 cash', premium: 570, phase: 'now' },
  { account: 'business', label: 'SKHY 120P Nov 20', cover: '12,000 cash', premium: 350, phase: 'now' },
  { account: 'business', label: 'MSTR 175C Nov 20 x2', cover: '200 sh', premium: 680, phase: 'now' },
  { account: 'business', label: 'SKHY 155C Nov 20', cover: '100 sh', premium: 435, phase: 'now' },
]

export const SEED_NEXT_ACTIONS: Record<'personal' | 'business', string[]> = {
  personal: [
    'Close MSTR 160P (4,887); let SOFI 14.5P expire 30 Oct',
    'Resolve ARM 240P before 30 Oct (6,387)',
    'Then AAOI and UMAC (16,772) until EL is above 30k',
  ],
  business: [
    'Sell the five trades below (puts use 54,000 of 128,823 cash)',
    'Close or roll BSOL 16P (2,180) and UMAC Jan27 20P (4,806)',
    'Convert one or two pairs a month, ARM first',
  ],
}

export interface SeedPut {
  symbol: string
  strike: number
  spot: number
  mid: number
  bid: number
  ask: number
  delta: number | null
  iv: number | null
  premium: number
  cash: number
  note: string
}

export const SEED_PUTS: SeedPut[] = [
  { symbol: 'ALAB', strike: 220, spot: 257.69, mid: 11.23, bid: 9.6, ask: 12.85, delta: -0.23, iv: 0.98, premium: 1_123, cash: 22_000, note: 'Sell (business)' },
  { symbol: 'ARM', strike: 180, spot: 208.5, mid: 5.85, bid: 5.55, ask: 6.15, delta: null, iv: 0.79, premium: 585, cash: 18_000, note: 'Wait: 4 Nov earnings' },
  { symbol: 'MSTR', strike: 125, spot: 145.12, mid: 3.7, bid: 3.65, ask: 3.75, delta: -0.2, iv: 0.75, premium: 370, cash: 12_500, note: 'Skip: BTC cap' },
  { symbol: 'SKHY', strike: 120, spot: 136.1, mid: 3.5, bid: 3.3, ask: 3.7, delta: -0.21, iv: 0.68, premium: 350, cash: 12_000, note: 'Sell (business)' },
  { symbol: 'MRVL', strike: 200, spot: 226.63, mid: 5.7, bid: 5.6, ask: 5.8, delta: -0.21, iv: 0.69, premium: 570, cash: 20_000, note: 'Sell (business)' },
  { symbol: 'SPCX', strike: 130, spot: 147.53, mid: 2.42, bid: 2.36, ask: 2.48, delta: -0.18, iv: 0.56, premium: 242, cash: 13_000, note: 'Lower priority' },
]

export const SEED_PUT_NOTE = 'Personal puts wait until EL is above 30,000 and every put is fully cash-covered; then ALAB 220P first, two or three positions, 25–35 days, close at 50–70%. No IBIT/ETFs, AAOI, new UMAC, SOFI or AMZN puts. TSLA, NVDA, GOOGL, AVGO and LRCX were not re-quoted (NVDA 190P was 1.7%).'

export interface SeedCall {
  account: 'personal' | 'business'
  label: string
  symbol: string
  contracts: number
  spot: number
  mid: number
  bid: number
  ask: number
  delta: number | null
  premium: number
}

export const SEED_CALLS: SeedCall[] = [
  { account: 'personal', label: 'TSLA 410C x1', symbol: 'TSLA', contracts: 1, spot: 372, mid: 4.43, bid: 4.35, ask: 4.5, delta: 0.21, premium: 443 },
  { account: 'personal', label: 'MSTR 175C x3', symbol: 'MSTR', contracts: 3, spot: 145.12, mid: 3.4, bid: 3.35, ask: 3.45, delta: 0.22, premium: 1_020 },
  { account: 'business', label: 'MSTR 175C x2', symbol: 'MSTR', contracts: 2, spot: 145.12, mid: 3.4, bid: 3.35, ask: 3.45, delta: 0.22, premium: 680 },
  { account: 'business', label: 'SKHY 155C x1', symbol: 'SKHY', contracts: 1, spot: 136.1, mid: 4.35, bid: 4, ask: 4.7, delta: null, premium: 435 },
]

export const SEED_CALL_NOTE = 'TSLA 400C (0.28 delta, 6.50 mid) pays 650 for more call-away risk. SKHY\'s spread is wide and no greeks came back. Diagonals against TSLA LEAPS (personal Dec28 330C/360C, business Jun28 380C x2) wait until their short puts close; ARM, AVGO, LRCX and MRVL calls wait until those pairs convert.'

export interface SeedRepair {
  account: 'personal' | 'business'
  label: string
  qty: string
  mark: string
  closeCost: string
  spot: string
  state: string
  idea: string
}

export const SEED_PERSONAL_REPAIR: SeedRepair[] = [
  { account: 'personal', label: 'AAOI Nov06 95P', qty: '-4', mark: '28.84', closeCost: '11,537', spot: 'not quoted', state: 'Deep', idea: 'Close or roll out; largest drag' },
  { account: 'personal', label: 'ARM Oct30 240P', qty: '-2', mark: '31.93', closeCost: '6,387', spot: '208.50', state: '31.50', idea: 'Close before 4 Nov earnings, or roll' },
  { account: 'personal', label: 'GOOGL Dec18 340P', qty: '-2', mark: '27.09', closeCost: '5,419', spot: '321.12', state: '18.88', idea: 'Decide before 28 Oct earnings' },
  { account: 'personal', label: 'UMAC Feb19\'27 20P', qty: '-10', mark: '5.23', closeCost: '5,235', spot: '17.05', state: '2.95', idea: 'Close; 10 lots is oversized' },
  { account: 'personal', label: 'MSTR Dec18 160P', qty: '-2', mark: '24.44', closeCost: '4,887', spot: '145.12', state: '14.88', idea: 'Close; BTC beta already in shares' },
  { account: 'personal', label: 'SPCX Oct30 160P', qty: '-2', mark: '13.21', closeCost: '2,643', spot: '147.53', state: '12.47', idea: 'Take shares only if cash allows, else roll' },
  { account: 'personal', label: 'SOFI Oct30 14.5P', qty: '-20', mark: '0.66', closeCost: '1,322', spot: '14.59', state: 'ATM', idea: 'Let expire, then exit SOFI' },
  { account: 'personal', label: 'SPX Nov06 7575/7550 spread', qty: '-4/+4', mark: '66.49 / 59.47', closeCost: '2,808 net', spot: 'not quoted', state: 'Max loss 10,000', idea: 'Watch into 6 Nov' },
]

export const SEED_PERSONAL_REPAIR_NOTE = 'Cash 81,900, buying power 6,415, leverage 1.55; short puts carry about 267,000 of notional, about 38,000 to close the in-the-money ones. Also holds TSLA 100 sh, NVDA 10, MSTR 300 and TSLA Dec 2028 pairs (330C/340P, 360C/370P).'

export interface SeedPair {
  label: string
  qty: string
  spot: number
  marks: string
  net: string
  shares: string
  cash: string
  /** When set, the cash column is the editable exit, not a conversion cost. */
  exitSymbol?: string
}

export const SEED_PAIRS: SeedPair[] = [
  { label: 'ARM Jun28 230C / 240P', qty: '1', spot: 208.5, marks: '65.74 / 78.96', net: '-13.22', shares: '100', cash: '20,850' },
  { label: 'AVGO Jan29 340C / 360P', qty: '1', spot: 321.45, marks: '86.89 / 90.92', net: '-4.03', shares: '100', cash: '32,145' },
  { label: 'BABA Jan29 110C / 120P', qty: '2', spot: 99.66, marks: '24.73 / 32.96', net: '-8.23', shares: 'Not converting', cash: '', exitSymbol: 'BABA' },
  { label: 'BIDU Jan28 90C / 90P', qty: '2', spot: 77.22, marks: '12.51 / 21.09', net: '-8.58', shares: 'Not converting', cash: '', exitSymbol: 'BIDU' },
  { label: 'LRCX Jun28 230C / 240P', qty: '1', spot: 229.9, marks: '68.41 / 60.81', net: '+7.60', shares: '100', cash: '22,990' },
  { label: 'LRCX Jun28 260C / 270P', qty: '1', spot: 229.9, marks: '58.16 / 79.91', net: '-21.75', shares: '100', cash: '22,990' },
  { label: 'MRVL Jun28 200C / 220P', qty: '1', spot: 226.63, marks: '87.86 / 58.16', net: '+29.70', shares: '100', cash: '22,663' },
  { label: 'ALAB Jun28 250C / 260P', qty: '1', spot: 257.41, marks: '105.67 / 88.81', net: '+16.86', shares: '100', cash: '25,741' },
  { label: 'SKHY Dec28 150C / 165P', qty: '1', spot: 136.1, marks: '45.02 / 58.05', net: '-13.03', shares: '100', cash: '13,610' },
  { label: 'TSLA Jun28 380C / 400P', qty: '2', spot: 371.26, marks: '91.40 / 85.93', net: '+5.47', shares: '200', cash: '74,252' },
  { label: 'UMAC Jan29 20C / 22.5P', qty: '10', spot: 17.05, marks: '8.51 / 11.66', net: '-3.15', shares: '1,000', cash: '17,045' },
]

export const SEED_BUSINESS_RISK: SeedRepair[] = [
  { account: 'business', label: 'BSOL Nov20 16P', qty: '-10', mark: '2.18', closeCost: '2,180', spot: '14.17', state: 'ITM 1.83', idea: 'Close or roll; assignment means an ETF' },
  { account: 'business', label: 'UMAC Jan27 20P', qty: '-10', mark: '4.81', closeCost: '4,806', spot: '17.05', state: 'ITM 2.95', idea: 'Close; UMAC already 1,000 sh via pair' },
  { account: 'business', label: 'SPCX Oct28 157.5P', qty: '-1', mark: '10.61', closeCost: '1,061', spot: '147.53', state: 'ITM 9.97', idea: 'Assignment of 100 sh is fine at 15,750' },
  { account: 'business', label: 'SPX Dec11 7650/7625 spread', qty: '-2/+2', mark: '158.97 / 149.82', closeCost: '1,830 net', spot: 'not quoted', state: 'Max loss 5,000', idea: 'Watch' },
]

export const SEED_BUSINESS_NOTE = 'Cash 128,823, buying power 39,892, leverage 1.85. Converting the nine pairs needs about 253,000, so rotate one or two a month: ARM, then MRVL, ALAB, LRCX 230. Shares held: MSTR 200, SKHY 100.'

export const SEED_CALENDAR: { date: string; event: string }[] = [
  { date: '28 Oct', event: 'GOOGL earnings; SPCX 157.5P expires (business)' },
  { date: '30 Oct', event: 'Expiry: ARM, SPCX, SOFI puts (personal)' },
  { date: '4 Nov', event: 'ARM earnings' },
  { date: '6 Nov', event: 'Expiry: AAOI put, SPX spread (personal)' },
  { date: '20 Nov', event: 'Monthly expiry: BSOL 16P; new cycle' },
  { date: '11 Dec', event: 'Business SPX 7650/7625 put spread expires' },
  { date: '18 Dec', event: 'GOOGL 340P and MSTR 160P expire (personal)' },
  { date: '15 Jan 2027', event: 'UMAC 20P expires (business)' },
  { date: '19 Feb 2027', event: 'UMAC 20P expires (personal)' },
]

export const SEED_SNAPSHOT_RULES: { rule: string; status: 'Yes' | 'No'; now: string }[] = [
  { rule: 'Personal EL above 30,000', status: 'No', now: '11,940' },
  { rule: 'Business EL above 30,000', status: 'Yes', now: '51,919' },
  { rule: 'Every personal short put fully cash-covered', status: 'No', now: '267k notional vs 81.9k cash' },
  { rule: 'Two or three personal positions at a time', status: 'No', now: '7 short puts open' },
  { rule: 'BTC beta (MSTR, BSOL) under one cap; no new MSTR puts', status: 'No', now: 'MSTR 500 sh + 160P + BSOL 16P x10' },
  { rule: 'No ETF holdings', status: 'No', now: 'BSOL 16P ITM risks assignment' },
  { rule: 'No AMZN short puts; TSLA calls only against shares held', status: 'Yes', now: '' },
  { rule: 'No short puts through GOOGL 28 Oct or ARM 4 Nov earnings unless intended', status: 'No', now: '' },
]
