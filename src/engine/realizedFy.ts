/**
 * Australian financial-year realised P&L, matching an IBKR Activity Statement.
 *
 * Verified trade-by-trade against the U21440275 statement for 20 Aug 2025 –
 * 30 Jun 2026 (account opened 20 Aug 2025, so this is FY2025-26). The printed
 * Realized & Unrealized Performance Summary total is $22,773.85:
 *   Stocks 3,242.20 + Equity and Index Options 18,452.31 + Forex 1,079.34.
 *
 * Rule
 * ----
 * Realised P&L for FY starting 1 Jul YYYY is the sum of IBKR's own
 * `fifoPnlRealized` on each trade whose Australia/Sydney timestamp falls in
 * [1 Jul YYYY 10:00, 1 Jul YYYY+1 10:00). The attribute is named "fifo"; the
 * number follows the account's tax-lot method (this account is Highest Cost).
 * Lot matching is not recomputed.
 *
 * - Trade timestamp, not settlement date, and not the option's expiry date.
 *   The 10:00 cutoff is statement note 6 (the period runs until 10:00 on the
 *   morning after the printed end date). Evidence: PLTR 02JUL26 120 P at
 *   2026-07-01 02:01:02, realised −280.31, is inside the statement that ends
 *   30 Jun 2026. A trade at or after 10:00 on 1 Jul is the next FY.
 * - Expiries are booked the morning after contract expiry (often 06:20),
 *   still before 10:00, so a 30 Jun expiry processed on 1 Jul stays in the
 *   old FY. Use the trade timestamp, not the contract expiry.
 * - A trade with no time is treated as 12:00 local, so a dateless 1 Jul is
 *   the new FY and a dateless 30 Jun stays in the old one.
 * - Stored tradeDate + tradeTime are read as Australia/Sydney, which is how
 *   this statement is printed. A Flex query left on US Eastern can stamp the
 *   02:01 Sydney 1 Jul trade as 30 Jun (12:01 US Eastern). That particular
 *   trade is inside the old FY either way. A trade between 10:00 Sydney on
 *   1 Jul and midnight Sydney would be stamped the previous evening in US
 *   Eastern and would fall in the wrong FY. Keep the Flex query timezone on
 *   Australia/Sydney.
 *
 * What each asset class contributes
 * ---------------------------------
 * - Stocks: the closing trade's fifoPnlRealized. On an equity assignment the
 *   option line's realised is 0 and the premium is inside the stock's
 *   realised column, not in proceeds + commission + printed basis. For the
 *   4 Oct 2025 MSTR sale that formula is 1,648.93 and the Realized column is
 *   2,068.13; the gap is the assigned call's $419.20 premium. Using the
 *   option's opening credit as well as the stock figure double-counts it.
 * - Options: the closing trade's fifoPnlRealized. Expiry (C;Ep) is the
 *   premium kept. Equity assignment is 0. Cash-settled SPX/SPXW exercise or
 *   assignment is the full economic result on the option line; the Option
 *   Cash Settlements section prints realised 0 and must not be added again.
 *   Opening trades are 0.
 * - Forex: fifoPnlRealized on CASH / AUD.USD conversions, grouped under the
 *   non-USD currency (the statement's "AUD" line). The Forex trades section
 *   of this statement has no Realized P/L column; the 1,604.87 profit and
 *   −525.54 loss exist only on the performance summary. Those two columns
 *   sum to 1,079.33, one cent under the printed forex total of 1,079.34.
 *   Cash FX Translation
 *   (−3,799.21) and Other FX Translations (−9.96) are mark-to-market and are
 *   not included.
 *
 * Short-term vs long-term
 * -----------------------
 * Positive amounts are profit, negative amounts are loss, within the term.
 * A closed lot is long-term when the closing date is strictly after the
 * one-year anniversary of origTradeDate (the anniversary date itself is
 * still short-term). Per-lot fifo plus origTradeDate is what splits a mixed
 * sale — the NVDA 13 Sep 2025 sale is 227.97 short-term and 446.94 long-term,
 * and no trade line in this statement is coded LT. When the lots don't carry
 * both figures, or they don't add up to the parent fill, the whole fill is
 * short-term.
 *
 * Fallback, and what is excluded
 * ------------------------------
 * If fifoPnlRealized is absent and the trade is a stock or option close that
 * does carry `cost`, the fallback is proceeds + commissions + cost (Flex
 * signs: commissions are negative fees, cost is signed basis). That fallback
 * is wrong for equity-assignment stock sales, so the report warns whenever
 * a closing trade in the year lacks fifoPnlRealized. Opens are never given
 * the fallback. Transfers with no fifo are skipped.
 *
 * Confirmed outside 22,773.85, because stocks + options + forex already equal
 * it: Other Fees −29.00, broker interest 913.08, GST −2.90, dividends,
 * withholding tax, deposits and withdrawals, unrealized P&L, and cash
 * settlement mark-to-market.
 *
 * Rounding
 * --------
 * The engine sums fifoPnlRealized as stored. Summing this statement's
 * cent-rounded option fills gives 18,452.63 against the printed category
 * total 18,452.31 (four symbols differ by one cent between the fill list and
 * the symbol total). Adding the forex summary columns (1,079.33) makes
 * 22,774.16 against the printed 22,773.85. Unrounded Flex values can land
 * on the printed total; the engine does not adjust either way.
 *
 * The same rule on the 1 Jul 2026 – 16 Oct 2026 statement (printed total
 * 26,555.24) gives stocks −17,910.88, option fills 46,273.54 against the
 * printed category 46,273.55, and forex −1,807.43, so 26,555.23. There is
 * no trade on 1 Jul 2026; the 02:01 PLTR trade stayed in the first
 * statement. The printed end date is 16 Oct, and the statement includes
 * the 17 Oct 01:35 SPXW closes and the 17 Oct 06:02 MSTR sale because they
 * are before 10:00 Sydney. Position transfers of 18,181.00 are market value
 * in the Change in NAV, with realised 0, and are not added. The MSTR sale's
 * basis is the $326.7901 lot (−32,679.01), not the $104.25 transfer mark.
 * That sale is long-term on the statement. Without a closed-lot open date
 * the whole fill stays short-term; the total does not change.
 */
import type { RawTrade } from '../types'

export type RealizedCategory = 'stocks' | 'options' | 'forex'

export interface RealizedLine {
  category: RealizedCategory
  symbol: string
  underlying: string
  stProfit: number
  stLoss: number
  ltProfit: number
  ltLoss: number
  total: number
  fyStartYear: number
}

export interface RealizedTotals {
  stProfit: number
  stLoss: number
  ltProfit: number
  ltLoss: number
  total: number
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

export function emptyTotals(): RealizedTotals {
  return { stProfit: 0, stLoss: 0, ltProfit: 0, ltLoss: 0, total: 0 }
}

export function fyBounds(startYear: number): { start: string; end: string } {
  return {
    start: `${startYear}-07-01T10:00:00`,
    end: `${startYear + 1}-07-01T10:00:00`,
  }
}

export function normalizeYmd(s: string | undefined): string {
  if (!s) return ''
  const d = s.replace(/-/g, '')
  return /^\d{8}$/.test(d) ? d : ''
}

function normalizeHms(s: string | undefined): string | null {
  if (!s) return null
  const digits = s.replace(/:/g, '')
  if (!/^\d{6}$/.test(digits)) return null
  return `${digits.slice(0, 2)}:${digits.slice(2, 4)}:${digits.slice(4, 6)}`
}

/** Australia/Sydney timestamp `YYYY-MM-DDTHH:MM:SS`, or null when undated.
 * Missing times are noon, so a dateless 1 Jul belongs to the new FY. */
export function tradeStamp(trade: { tradeDate: string; tradeTime?: string }): string | null {
  const ymd = normalizeYmd(trade.tradeDate)
  if (!ymd) return null
  const hms = normalizeHms(trade.tradeTime) ?? '12:00:00'
  return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}T${hms}`
}

export function inFy(trade: { tradeDate: string; tradeTime?: string }, startYear: number): boolean {
  const stamp = tradeStamp(trade)
  if (!stamp) return false
  const { start, end } = fyBounds(startYear)
  return stamp >= start && stamp < end
}

/** Starting calendar year of the Australian FY that contains this trade. */
export function fyStartYearOf(trade: { tradeDate: string; tradeTime?: string }): number | null {
  const stamp = tradeStamp(trade)
  if (!stamp) return null
  const year = Number(stamp.slice(0, 4))
  return stamp < `${year}-07-01T10:00:00` ? year - 1 : year
}

function fmtStrike(n: number): string {
  if (!Number.isFinite(n)) return ''
  if (Math.abs(n - Math.round(n)) < 1e-6) return String(Math.round(n))
  return n.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')
}

function fmtExpiryToken(yyyymmdd: string): string | null {
  const d = normalizeYmd(yyyymmdd)
  if (!d) return null
  const month = Number(d.slice(4, 6))
  const mon = MONTHS[month - 1]
  if (!mon) return null
  return `${d.slice(6, 8)}${mon}${d.slice(2, 4)}`
}

/** Statement symbol: `MSTR`, `MSTR 17OCT25 350 C`, `AUD`. */
export function statementSymbol(trade: RawTrade): string {
  if (isForexTrade(trade)) return forexCurrency(trade.symbol)
  if (trade.assetClass === 'OPT') {
    const underlying = trade.underlyingSymbol || trade.symbol
    const exp = trade.expiry ? fmtExpiryToken(trade.expiry) : null
    if (exp && trade.strike != null && trade.putCall) {
      return `${underlying} ${exp} ${fmtStrike(trade.strike)} ${trade.putCall}`
    }
  }
  return trade.symbol
}

function forexCurrency(symbol: string): string {
  const [base, quote] = symbol.split('.')
  if (base && quote) return quote === 'USD' ? base : quote
  return symbol
}

function isForexTrade(trade: RawTrade): boolean {
  if (trade.assetClass === 'OPT') return false
  if (trade.assetClass === 'CASH') return true
  return /^[A-Z]{3}\.[A-Z]{3}$/.test(trade.symbol)
}

function categoryOf(trade: RawTrade): RealizedCategory {
  if (trade.assetClass === 'OPT') return 'options'
  if (isForexTrade(trade)) return 'forex'
  return 'stocks'
}

function isClosingTrade(trade: RawTrade): boolean {
  if (trade.isTransfer) return false
  if (trade.openClose === 'O') return false
  if (trade.openClose === 'C') return true
  if (trade.assetClass === 'STK' && trade.quantity < 0) return true
  return false
}

/** Anniversary date itself is still short-term. Feb 29 rolls to Mar 1. */
export function isLongTerm(closeYmd: string, origYmd: string): boolean {
  const close = normalizeYmd(closeYmd)
  const orig = normalizeYmd(origYmd)
  if (!close || !orig) return false
  const year = Number(orig.slice(0, 4)) + 1
  const month = Number(orig.slice(4, 6))
  const day = Number(orig.slice(6, 8))
  const ann = new Date(Date.UTC(year, month - 1, day))
  const rolled = ann.getUTCMonth() !== month - 1
  const anniversary = rolled
    ? `${year}0301`
    : `${year}${orig.slice(4, 6)}${orig.slice(6, 8)}`
  return close > anniversary
}

interface Piece { amount: number; longTerm: boolean }

function piecesOf(trade: RawTrade): Piece[] {
  const fifo = trade.fifoPnlRealized
  if (fifo != null && Number.isFinite(fifo)) {
    const lots = trade.closedLots ?? []
    const complete = lots.length > 0 && lots.every(l => l.fifoPnlRealized != null && !!l.origTradeDate)
    if (complete) {
      const lotSum = lots.reduce((s, l) => s + (l.fifoPnlRealized ?? 0), 0)
      if (Math.abs(lotSum - fifo) <= 0.02) {
        return lots.map(l => ({
          amount: l.fifoPnlRealized ?? 0,
          longTerm: isLongTerm(trade.tradeDate, l.origTradeDate ?? ''),
        }))
      }
    }
    return [{ amount: fifo, longTerm: false }]
  }
  if (!isClosingTrade(trade) || trade.assetClass === 'CASH' || isForexTrade(trade)) return []
  if (trade.cost == null || !Number.isFinite(trade.cost)) return []
  return [{ amount: trade.proceeds + (trade.commissions ?? 0) + trade.cost, longTerm: false }]
}

function addAmount(line: RealizedLine, amount: number, longTerm: boolean) {
  if (longTerm) {
    if (amount >= 0) line.ltProfit += amount
    else line.ltLoss += amount
  } else if (amount >= 0) line.stProfit += amount
  else line.stLoss += amount
  line.total += amount
}

/**
 * One row per statement symbol. Pass `fyStartYear` to keep a single
 * Australian FY; omit it to keep every year present in the trades.
 * Closed-lot rows must already be folded onto their execution — summing
 * both would double-count.
 */
export function realizedLines(trades: RawTrade[], fyStartYear?: number): RealizedLine[] {
  const byKey = new Map<string, RealizedLine>()
  for (const trade of trades) {
    const year = fyStartYearOf(trade)
    if (year == null) continue
    if (fyStartYear != null && year !== fyStartYear) continue
    const pieces = piecesOf(trade)
    if (pieces.length === 0) continue
    const category = categoryOf(trade)
    const symbol = statementSymbol(trade)
    const underlying = category === 'forex' ? symbol : (trade.underlyingSymbol || trade.symbol)
    const key = `${year}|${category}|${symbol}`
    let line = byKey.get(key)
    if (!line) {
      line = { category, symbol, underlying, stProfit: 0, stLoss: 0, ltProfit: 0, ltLoss: 0, total: 0, fyStartYear: year }
      byKey.set(key, line)
    }
    for (const piece of pieces) addAmount(line, piece.amount, piece.longTerm)
  }
  return [...byKey.values()]
}

export function mergeLines(lines: RealizedLine[]): RealizedLine[] {
  return foldLines(lines)
}

function foldLines(lines: RealizedLine[]): RealizedLine[] {
  const byKey = new Map<string, RealizedLine>()
  for (const line of lines) {
    const key = `${line.fyStartYear}|${line.category}|${line.symbol}`
    let acc = byKey.get(key)
    if (!acc) {
      acc = { ...line }
      byKey.set(key, acc)
      continue
    }
    acc.stProfit += line.stProfit
    acc.stLoss += line.stLoss
    acc.ltProfit += line.ltProfit
    acc.ltLoss += line.ltLoss
    acc.total += line.total
  }
  return [...byKey.values()]
}

export function addTotals(into: RealizedTotals, line: Pick<RealizedLine, 'stProfit' | 'stLoss' | 'ltProfit' | 'ltLoss' | 'total'>) {
  into.stProfit += line.stProfit
  into.stLoss += line.stLoss
  into.ltProfit += line.ltProfit
  into.ltLoss += line.ltLoss
  into.total += line.total
}

export function summarize(lines: RealizedLine[]): { stocks: RealizedTotals; options: RealizedTotals; forex: RealizedTotals; all: RealizedTotals } {
  const stocks = emptyTotals()
  const options = emptyTotals()
  const forex = emptyTotals()
  const all = emptyTotals()
  for (const line of lines) {
    const bucket = line.category === 'stocks' ? stocks : line.category === 'options' ? options : forex
    addTotals(bucket, line)
    addTotals(all, line)
  }
  return { stocks, options, forex, all }
}

/** Closes in the FY with no fifoPnlRealized. Their P&L is omitted when
 * `cost` is also missing, and estimated from proceeds + commissions + cost
 * when it is present. Either way the report should say so. */
export function closesMissingRealized(trades: RawTrade[], fyStartYear: number): RawTrade[] {
  return trades.filter(trade => {
    if (!inFy(trade, fyStartYear)) return false
    if (trade.fifoPnlRealized != null && Number.isFinite(trade.fifoPnlRealized)) return false
    if (isForexTrade(trade)) return true
    return isClosingTrade(trade)
  })
}

export function closesUsingFallback(trades: RawTrade[], fyStartYear: number): RawTrade[] {
  return closesMissingRealized(trades, fyStartYear).filter(trade =>
    !isForexTrade(trade) && trade.cost != null && Number.isFinite(trade.cost),
  )
}
