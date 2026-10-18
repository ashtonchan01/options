import type { ClosedLot, OpenLot, RawPosition, RawTrade } from '../types'

// Vercel serverless function uses AWS IPs — not blocked by IBKR like Cloudflare
const FLEX_PROXY = 'https://options-jade.vercel.app'

// ─── XML Upload ───────────────────────────────────────────────────────────────

export async function syncFromXML(file: File): Promise<FlexSnapshot> {
  const text = await file.text()
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  return parseFlexDocument(doc)
}

// ─── Flex API ─────────────────────────────────────────────────────────────────

export interface FlexSnapshot {
  positions: RawPosition[]
  trades: RawTrade[]
  cashBalance: number
  cashBalances: Record<string, number>
  netLiquidation?: number
  /** One net-liquidation reading per report date, when the Flex query
   * included Equity Summary. Kept in full so the Milestone page can plot
   * the account's real value over time instead of only the latest row. */
  equityHistory?: { date: string; netLiquidation: number }[]
  fromDate?: string
  toDate?: string
}

export async function syncFromFlexAPI(
  token: string,
  queryId: string,
  range?: { fromDate: string; toDate: string },
): Promise<FlexSnapshot> {
  if (!token || !queryId) throw new Error('Token and Query ID are required')

  const params = new URLSearchParams({ token, query: queryId })
  // fd and td together override the query's saved period. IBKR rejects them
  // combined with `p`, and rejects a span longer than 365 days.
  if (range?.fromDate && range?.toDate) {
    params.set('fd', range.fromDate)
    params.set('td', range.toDate)
  }
  const url = `${FLEX_PROXY}/api/flex-sync?${params}`
  const res = await fetch(url)

  const text = await res.text()
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try {
      const b = JSON.parse(text) as { error?: string; raw?: string }
      if (b.error) msg = b.raw ? `${b.error} | raw: ${b.raw.slice(0, 120)}` : b.error
    } catch { msg = text.slice(0, 200) }
    throw new Error(msg)
  }

  const xml = text
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  return parseFlexDocument(doc)
}

/** Parse a Flex Query document. Exported so lot-matching can be tested
 * without a browser DOMParser — pass any object that implements
 * querySelector / querySelectorAll / getAttribute the same way. */
export function parseFlexDocument(doc: Document): FlexSnapshot {
  const { positions, trades } = filterToPrimaryAccount(parsePositions(doc), allTrades(doc))
  return { positions, trades, cashBalance: parseCash(doc), cashBalances: parseCashByCurrency(doc), netLiquidation: parseNetLiq(doc), equityHistory: parseEquityHistory(doc, primaryAccountId(positions, trades)), ...parseReportWindow(doc) }
}

// ─── Ping ─────────────────────────────────────────────────────────────────────

export async function pingProxy(): Promise<{ ok: boolean }> {
  const res = await fetch(`${FLEX_PROXY}/api/flex-sync?token=ping&query=ping`)
  // 400 = reachable (missing real params), anything else = down
  return { ok: res.status === 400 || res.status === 200 }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Try multiple attribute names, return first non-null */
function attr(el: Element, ...names: string[]): string | null {
  for (const n of names) {
    const v = el.getAttribute(n)
    if (v !== null) return v
  }
  return null
}

function numAttr(el: Element, ...names: string[]): number {
  const v = attr(el, ...names)
  return v ? Number(v) : 0
}

// ─── Parsers ──────────────────────────────────────────────────────────────────

function positionKey(p: RawPosition): string {
  return `${p.accountId}|${p.assetClass}|${p.symbol}|${p.strike ?? ''}|${p.expiry ?? ''}|${p.putCall ?? ''}`
}

function toOpenLot(p: RawPosition): OpenLot {
  return {
    quantity: p.quantity,
    costBasisPrice: p.costBasisPrice,
    costBasisMoney: p.costBasisMoney,
    ...(p.openDate ? { openDate: p.openDate } : {}),
    unrealizedPnL: p.unrealizedPnL,
  }
}

/** Lot-only stock rows (no SUMMARY sibling) become one position whose
 * quantity and basis are the sum, with each lot kept on `openLots`.
 * Leaving them as separate rows made allocation's average cost the last
 * lot's price and made the journal's "what's still open" check run once
 * per lot against the whole ticker. */
function collapseStockLots(lots: RawPosition[]): RawPosition {
  const quantity = lots.reduce((s, l) => s + l.quantity, 0)
  const costBasisMoney = lots.reduce((s, l) => s + l.costBasisMoney, 0)
  const positionValue = lots.reduce((s, l) => s + l.positionValue, 0)
  const unrealizedPnL = lots.reduce((s, l) => s + l.unrealizedPnL, 0)
  const first = lots[0]
  return {
    ...first,
    quantity,
    costBasisMoney,
    costBasisPrice: quantity !== 0 ? costBasisMoney / quantity : first.costBasisPrice,
    positionValue,
    unrealizedPnL,
    levelOfDetail: 'SUMMARY',
    openDate: undefined,
    openLots: lots.map(toOpenLot),
  }
}

function parsePositions(doc: Document): RawPosition[] {
  let positions: RawPosition[] = Array.from(doc.querySelectorAll('OpenPosition')).map((el): RawPosition => {
    // IBKR Flex XML uses assetCategory in most reports, assetClass in some
    const ac = attr(el, 'assetCategory', 'assetClass') ?? ''
    const pc = attr(el, 'putCall')
    const openDate = flexDate(attr(el, 'openDateTime', 'openDate', 'origTradeDate'))
    return {
      accountId:        el.getAttribute('accountId') ?? '',
      symbol:           el.getAttribute('symbol') ?? '',
      description:      el.getAttribute('description') ?? '',
      assetClass:       ac as RawPosition['assetClass'],
      quantity:         numAttr(el, 'position', 'quantity'),
      costBasisPrice:   numAttr(el, 'costBasisPrice'),
      costBasisMoney:   numAttr(el, 'costBasisMoney'),
      markPrice:        numAttr(el, 'markPrice'),
      positionValue:    numAttr(el, 'positionValue'),
      unrealizedPnL:    numAttr(el, 'fifoPnlUnrealized', 'unrealizedPnL'),
      putCall:          (pc === 'P' || pc === 'C' ? pc : undefined) as RawPosition['putCall'],
      strike:           attr(el, 'strike') ? Number(attr(el, 'strike')) : undefined,
      expiry:           attr(el, 'expiry') ?? undefined,
      multiplier:       attr(el, 'multiplier') ? Number(attr(el, 'multiplier')) : undefined,
      underlyingSymbol: attr(el, 'underlyingSymbol') ?? undefined,
      currency:         el.getAttribute('currency') ?? 'USD',
      levelOfDetail:    attr(el, 'levelOfDetail') ?? undefined,
      ...(openDate ? { openDate } : {}),
    }
  })

  // A Flex Query with both "Summary" and "Lot" level of detail checked under
  // Open Positions emits ONE <OpenPosition> row per tax lot AND a separate
  // SUMMARY row that's already the sum of those lots — querying every
  // <OpenPosition> element without account for that double-counts
  // costBasisMoney/positionValue/unrealizedPnL for any position with more
  // than one lot (verified: a real TSLA 320P CSP reported costBasisMoney
  // twice over, -$1,707.89 shown instead of IBKR's own -$854 SUMMARY row).
  // When a key has a SUMMARY row, keep only that and hang the LOT rows off
  // it as openLots (share cost basis needs the individual lots; portfolio
  // totals must keep using the summary). A key with LOT rows and no SUMMARY
  // is collapsed for stocks so the lots stay available without being summed
  // twice; option LOT-only rows are left as they were.
  const hasAnyLevelOfDetail = positions.some(p => p.levelOfDetail)
  if (hasAnyLevelOfDetail) {
    const keysWithSummary = new Set(positions.filter(p => (p.levelOfDetail ?? '').toUpperCase() === 'SUMMARY').map(positionKey))
    const lotsByKey = new Map<string, RawPosition[]>()
    for (const p of positions) {
      if ((p.levelOfDetail ?? '').toUpperCase() !== 'LOT') continue
      const key = positionKey(p)
      lotsByKey.set(key, [...(lotsByKey.get(key) ?? []), p])
    }
    positions = positions.filter(p => (p.levelOfDetail ?? '').toUpperCase() !== 'LOT' || !keysWithSummary.has(positionKey(p)))
    for (const p of positions) {
      const lots = lotsByKey.get(positionKey(p))
      if (lots && lots.length > 0 && (p.levelOfDetail ?? '').toUpperCase() === 'SUMMARY') p.openLots = lots.map(toOpenLot)
    }
    const leftoverLots = new Map<string, RawPosition[]>()
    const kept: RawPosition[] = []
    for (const p of positions) {
      if (p.assetClass === 'STK' && (p.levelOfDetail ?? '').toUpperCase() === 'LOT') {
        const key = positionKey(p)
        leftoverLots.set(key, [...(leftoverLots.get(key) ?? []), p])
      } else {
        kept.push(p)
      }
    }
    for (const lots of leftoverLots.values()) kept.push(collapseStockLots(lots))
    positions = kept
  }

  // Debug: log first few positions so we can verify parsing
  if (positions.length > 0) {
    console.log('[IBKR] Parsed positions:', positions.length)
    console.log('[IBKR] Sample:', positions.slice(0, 3).map(p => ({
      sym: p.symbol, ac: p.assetClass, pc: p.putCall,
      strike: p.strike, expiry: p.expiry, under: p.underlyingSymbol,
      qty: p.quantity, val: p.positionValue, pnl: p.unrealizedPnL,
    })))
    const opts = positions.filter(p => p.assetClass === 'OPT')
    const stks = positions.filter(p => p.assetClass === 'STK')
    console.log(`[IBKR] ${stks.length} STK, ${opts.length} OPT, ${positions.length - stks.length - opts.length} other`)
  }

  return positions
}

function parseCash(doc: Document): number {
  // Prefer BASE_SUMMARY row; fall back to summing all currency rows. A
  // multi-date Flex query can carry one BASE_SUMMARY row per date (same
  // trap as parseNetLiq below) — take the most recent one, not whichever
  // happens to be first in the document.
  const rows = Array.from(doc.querySelectorAll('CashReportCurrency'))
  const baseRows = rows.filter(el => el.getAttribute('currency') === 'BASE_SUMMARY')
  const base = latestByReportDate(baseRows)
  if (base) return Number(base.getAttribute('endingCash') ?? 0)
  return rows.reduce((sum, el) => sum + Number(el.getAttribute('endingCash') ?? 0), 0)
}

/** Per-currency cash balances (USD, AUD, etc.) for the Trade Journal's Cash
 * Balances section — BASE_SUMMARY (the account's single converted total,
 * already covered by parseCash above) is excluded here since it isn't a
 * real currency holding. Same multi-date trap as parseCash/parseNetLiq: a
 * date-range report can carry one row per currency per report date, so each
 * currency keeps only its latest-dated row rather than being summed across
 * dates (which would double-count a currency that appears on multiple
 * report dates). */
function parseCashByCurrency(doc: Document): Record<string, number> {
  const rows = Array.from(doc.querySelectorAll('CashReportCurrency'))
    .filter(el => el.getAttribute('currency') && el.getAttribute('currency') !== 'BASE_SUMMARY')
  const byCurrency = new Map<string, Element[]>()
  for (const el of rows) {
    const ccy = el.getAttribute('currency')!
    byCurrency.set(ccy, [...(byCurrency.get(ccy) ?? []), el])
  }
  const result: Record<string, number> = {}
  for (const [ccy, els] of byCurrency) {
    const latest = latestByReportDate(els)
    if (latest) result[ccy] = Number(latest.getAttribute('endingCash') ?? 0)
  }
  return result
}

/** The Flex statement's own reporting window ("YYYYMMDD"), e.g.
 * period="Last365CalendarDays" fromDate="20250815" toDate="20260814" — the
 * report is authoritative for every trade dated inside this window, since
 * IBKR would have included it if it still existed. Used by the caller to
 * drop stale/phantom trades that a resync no longer reports, instead of
 * accumulating them forever. */
function parseReportWindow(doc: Document): { fromDate?: string; toDate?: string } {
  const stmt = doc.querySelector('FlexStatement')
  return {
    fromDate: stmt?.getAttribute('fromDate') ?? undefined,
    toDate:   stmt?.getAttribute('toDate') ?? undefined,
  }
}

/** Both EquitySummaryInBase and EquitySummaryByReportDateInBase can carry one
 * row per date when the Flex query spans a date range, not just a single
 * row for "today" — querySelector only ever returns the FIRST one in
 * document order, which is the oldest date in the report window, not the
 * current balance (verified against a real account: this silently returned
 * a stale netLiquidation from over a year ago, understating the real
 * current net worth by over $90K). Picking the row with the latest
 * reportDate (falling back to last-in-document-order if reportDate is
 * missing) gets the actual current figure instead. */
function latestByReportDate(rows: Element[]): Element | undefined {
  if (rows.length === 0) return undefined
  const withDates = rows.filter(el => el.getAttribute('reportDate'))
  if (withDates.length === 0) return rows[rows.length - 1]
  return withDates.reduce((latest, el) =>
    (el.getAttribute('reportDate')! > latest.getAttribute('reportDate')!) ? el : latest)
}

function isoReportDate(raw: string): string | null {
  if (/^\d{8}$/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10)
  return null
}

function primaryAccountId(positions: RawPosition[], trades: RawTrade[]): string | undefined {
  return positions.find(p => p.accountId)?.accountId ?? trades.find(t => t.accountId)?.accountId
}

/** Every Equity Summary row, not just the latest. ByReportDate overwrites
 * a same-day EquitySummaryInBase figure when both are present. Rows for a
 * different linked account are dropped once the sync has picked a primary. */
function parseEquityHistory(doc: Document, accountId?: string): { date: string; netLiquidation: number }[] {
  const byDate = new Map<string, number>()
  const take = (selector: string) => {
    for (const el of doc.querySelectorAll(selector)) {
      const id = el.getAttribute('accountId') ?? ''
      if (accountId && id && id !== accountId) continue
      const date = isoReportDate(el.getAttribute('reportDate') ?? '')
      const nl = el.getAttribute('netLiquidation')
      if (!date || nl == null || nl === '') continue
      const n = Number(nl)
      if (!Number.isFinite(n)) continue
      byDate.set(date, n)
    }
  }
  take('EquitySummaryInBase')
  take('EquitySummaryByReportDateInBase')
  return [...byDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, netLiquidation]) => ({ date, netLiquidation }))
}

function parseNetLiq(doc: Document): number | undefined {
  // IBKR Flex reports include EquitySummaryInBase with exact netLiquidation
  const eqBase = latestByReportDate(Array.from(doc.querySelectorAll('EquitySummaryInBase')))
  if (eqBase) {
    const nl = eqBase.getAttribute('netLiquidation')
    if (nl) return Number(nl)
  }
  // Also try EquitySummaryByReportDateInBase
  const eqDate = latestByReportDate(Array.from(doc.querySelectorAll('EquitySummaryByReportDateInBase')))
  if (eqDate) {
    const nl = eqDate.getAttribute('netLiquidation')
    if (nl) return Number(nl)
  }
  return undefined
}

/** First YYYYMMDD in an IBKR date or dateTime ("20261016", "20261016;060248", "2026-10-16"). */
function flexDate(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined
  const digits = raw.replace(/\D/g, '')
  return digits.length >= 8 ? digits.slice(0, 8) : undefined
}

function optionalNumber(el: Element, ...names: string[]): number | undefined {
  const v = attr(el, ...names)
  if (v == null || v === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

/** A Trade row plus the closed-lot fields that only CLOSED_LOT rows carry.
 * Those fields are copied onto `ClosedLot` and not kept on the execution. */
interface ParsedTrade extends RawTrade {
  origTradeDate?: string
  origTradePrice?: number
  origTradeId?: string
}

function readTrade(el: Element, forceLevel?: string): ParsedTrade {
  const level = forceLevel ?? attr(el, 'levelOfDetail') ?? undefined
  const cost = optionalNumber(el, 'cost', 'costBasis')
  const fifoPnlRealized = optionalNumber(el, 'fifoPnlRealized', 'realizedPnl')
  const origTradePrice = optionalNumber(el, 'origTradePrice', 'openPrice')
  return {
    accountId:        el.getAttribute('accountId') ?? undefined,
    execId:           el.getAttribute('tradeID') || undefined,
    orderId:          el.getAttribute('ibOrderID') || el.getAttribute('orderID') || undefined,
    tradeDate:        el.getAttribute('tradeDate') || flexDate(el.getAttribute('dateTime')) || el.getAttribute('date') || '',
    // Real Flex reports (verified against a live account's XML) don't
    // actually populate a standalone `tradeTime` attribute at all — only
    // `dateTime="YYYYMMDD;HHMMSS"`. Reading the missing attribute silently
    // returned undefined for every single trade, which meant the position
    // matcher's execution-time disambiguation never engaged and every trade
    // sharing a tradeDate/expiry/underlying got bucketed together regardless
    // of when it actually executed — the real cause of unrelated same-day
    // spreads merging into one fake blended position. Pull the time portion
    // out of dateTime as a fallback so that disambiguation actually runs.
    tradeTime:        el.getAttribute('tradeTime') ?? el.getAttribute('dateTime')?.split(';')[1] ?? undefined,
    symbol:           (el.getAttribute('symbol') ?? '').trim(),
    underlyingSymbol: el.getAttribute('underlyingSymbol') ?? undefined,
    assetClass:       (attr(el, 'assetCategory', 'assetClass') ?? 'STK') as RawTrade['assetClass'],
    putCall:          (el.getAttribute('putCall') || undefined) as RawTrade['putCall'],
    strike:           el.getAttribute('strike') ? Number(el.getAttribute('strike')) : undefined,
    expiry:           el.getAttribute('expiry') ?? undefined,
    quantity:         Number(el.getAttribute('quantity') ?? 0),
    tradePrice:       Number(el.getAttribute('tradePrice') ?? 0),
    proceeds:         Number(el.getAttribute('proceeds') ?? 0),
    commissions:      Number(el.getAttribute('ibCommission') ?? el.getAttribute('commissions') ?? 0),
    netCash:          Number(el.getAttribute('netCash') ?? 0),
    openClose:        (el.getAttribute('openCloseIndicator') || undefined) as RawTrade['openClose'],
    ...(level ? { levelOfDetail: level } : {}),
    ...(cost != null ? { cost } : {}),
    ...(fifoPnlRealized != null ? { fifoPnlRealized } : {}),
    origTradeDate:    flexDate(attr(el, 'origTradeDate', 'openDateTime', 'openDate')),
    ...(origTradePrice != null ? { origTradePrice } : {}),
    origTradeId:      attr(el, 'origTradeID', 'origTradeId') ?? undefined,
  }
}

function toClosedLot(row: ParsedTrade): ClosedLot {
  return {
    quantity: row.quantity,
    tradeDate: row.tradeDate,
    tradePrice: row.tradePrice,
    proceeds: row.proceeds,
    commissions: row.commissions,
    cost: row.cost ?? 0,
    ...(row.fifoPnlRealized != null ? { fifoPnlRealized: row.fifoPnlRealized } : {}),
    ...(row.origTradeDate ? { origTradeDate: row.origTradeDate } : {}),
    ...(row.origTradePrice != null ? { origTradePrice: row.origTradePrice } : {}),
    ...(row.origTradeId ? { origTradeId: row.origTradeId } : {}),
  }
}

function sameFlexDay(a: string, b: string): boolean {
  const da = flexDate(a) ?? a
  const db = flexDate(b) ?? b
  return da !== '' && da === db
}

/** Pick closed-lot rows whose quantities sum to the execution. An exact
 * subset wins; otherwise a single row of the same size. */
function takeClosedLots(pool: { row: ParsedTrade; index: number }[], need: number): { row: ParsedTrade; index: number }[] {
  if (pool.length === 0 || need <= 0) return []
  if (pool.length <= 12) {
    let found: { row: ParsedTrade; index: number }[] | null = null
    const acc: { row: ParsedTrade; index: number }[] = []
    const dfs = (i: number, left: number) => {
      if (found) return
      if (Math.abs(left) <= 0.01) { found = [...acc]; return }
      if (i >= pool.length || left < -0.01) return
      dfs(i + 1, left)
      const q = Math.abs(pool[i].row.quantity)
      if (q > 0) {
        acc.push(pool[i])
        dfs(i + 1, left - q)
        acc.pop()
      }
    }
    dfs(0, need)
    if (found) return found
  }
  const one = pool.find(p => Math.abs(Math.abs(p.row.quantity) - need) <= 0.01)
  return one ? [one] : []
}

function syntheticClose(row: ParsedTrade): RawTrade {
  const qty = row.quantity < 0 ? row.quantity : -Math.abs(row.quantity || 0)
  const lot = toClosedLot({ ...row, quantity: qty })
  const trade: RawTrade = {
    accountId: row.accountId,
    execId: row.execId,
    tradeDate: row.tradeDate,
    tradeTime: row.tradeTime,
    symbol: row.symbol,
    underlyingSymbol: row.underlyingSymbol,
    assetClass: row.assetClass,
    quantity: qty,
    tradePrice: row.tradePrice,
    proceeds: row.proceeds,
    commissions: row.commissions,
    netCash: row.netCash,
    openClose: 'C',
    levelOfDetail: 'EXECUTION',
    closedLots: [lot],
  }
  if (row.cost != null) trade.cost = row.cost
  if (row.fifoPnlRealized != null) trade.fifoPnlRealized = row.fifoPnlRealized
  return trade
}

/**
 * Closed-lot rows are detail about a sale, not a second sale. Fold them
 * onto the execution they belong to. ORDER rows are a rollup of EXECUTION
 * rows when both are present, and WASH_SALE rows repeat the same fill, so
 * neither is kept as its own trade. A stock closed lot with no execution
 * (the query was set to Closed Lots only) is kept as one closing trade so
 * its basis and P&L are not dropped. Option closed lots are never turned
 * into extra trades — that would double-count the option matcher.
 */
function attachClosedLots(rows: ParsedTrade[]): RawTrade[] {
  const hasExecution = rows.some(r => (r.levelOfDetail ?? '').toUpperCase() === 'EXECUTION')
  const lots: ParsedTrade[] = []
  const execs: ParsedTrade[] = []
  for (const row of rows) {
    const level = (row.levelOfDetail ?? '').toUpperCase()
    if (level === 'CLOSED_LOT') { lots.push(row); continue }
    if (level === 'WASH_SALE') continue
    if (hasExecution && level === 'ORDER') continue
    execs.push(row)
  }

  const used = new Set<number>()
  for (const exec of execs) {
    const closingStock = exec.assetClass === 'STK' && exec.quantity < 0
    const closingOption = exec.assetClass === 'OPT' && (exec.openClose === 'C' || exec.quantity > 0)
    if (!closingStock && !closingOption) continue
    const candidates = lots
      .map((row, index) => ({ row, index }))
      .filter(({ index, row }) => !used.has(index)
        && row.symbol === exec.symbol
        && row.assetClass === exec.assetClass
        && (!row.accountId || !exec.accountId || row.accountId === exec.accountId)
        && sameFlexDay(row.tradeDate, exec.tradeDate))
    const idHits = exec.execId
      ? candidates.filter(({ row }) => row.execId != null && row.execId === exec.execId)
      : []
    const pool = idHits.length > 0 ? idHits : candidates
    const taken = takeClosedLots(pool, Math.abs(exec.quantity))
    if (taken.length === 0) continue
    for (const t of taken) used.add(t.index)
    const closed = taken.map(t => toClosedLot(t.row))
    exec.closedLots = closed
    if (exec.fifoPnlRealized == null && closed.every(c => c.fifoPnlRealized != null)) {
      exec.fifoPnlRealized = closed.reduce((s, c) => s + (c.fifoPnlRealized ?? 0), 0)
    }
    if ((exec.cost == null || exec.cost === 0) && closed.some(c => c.cost !== 0)) {
      exec.cost = closed.reduce((s, c) => s + c.cost, 0)
    }
  }

  const out: RawTrade[] = execs.map(exec => {
    const trade: RawTrade = { ...exec }
    const extra = trade as ParsedTrade
    delete extra.origTradeDate
    delete extra.origTradePrice
    delete extra.origTradeId
    return trade
  })
  for (let i = 0; i < lots.length; i++) {
    if (used.has(i)) continue
    if (lots[i].assetClass !== 'STK') continue
    out.push(syntheticClose(lots[i]))
  }
  return out
}

function parseTrades(doc: Document): RawTrade[] {
  const fromTrades = Array.from(doc.querySelectorAll('Trade')).map(el => readTrade(el))
  // Some Flex templates emit a dedicated element instead of a Trade row
  // tagged levelOfDetail="CLOSED_LOT". Treat those the same.
  const fromElements = Array.from(doc.querySelectorAll('ClosedLot')).map(el => readTrade(el, 'CLOSED_LOT'))
  return attachClosedLots([...fromTrades, ...fromElements])
}

/** Option Exercises, Assignments & Expirations (and SPX/SPXW-style cash
 * settlements) can be missing from plain <Trade> records — an assigned/
 * exercised/expired option, or the stock position that results from a put/
 * call assignment, is sometimes booked as an <OptionEAE> record instead.
 * Ignoring these silently drops the closing leg of any assigned/expired
 * position (it stays "Active" forever) and drops the resulting share
 * acquisition/delivery (share counts undercount or a ticker vanishes from
 * the journal entirely).
 *
 * BUT many accounts' Flex reports list the *same* event in both sections —
 * the same execution shows up as both a <Trade> and an <OptionEAE> row,
 * sharing the same tradeID. Adding both double-counts it (verified: a real
 * account showed MSTR shares double from 500 to 1000 this way). `usedTradeIds`
 * is every tradeID already present among the plain <Trade> records; any
 * OptionEAE row carrying one of those IDs is the account's own duplicate
 * report of a trade already counted, and is skipped. */
function parseOptionEAE(doc: Document, usedTradeIds: Set<string>): RawTrade[] {
  return Array.from(doc.querySelectorAll('OptionEAE'))
    .filter(el => {
      const id = el.getAttribute('tradeID')
      return !id || !usedTradeIds.has(id)
    })
    .map(el => {
    const assetClass    = (attr(el, 'assetCategory') ?? 'STK') as RawTrade['assetClass']
    const transactionType = el.getAttribute('transactionType') ?? ''
    const rawQty         = Number(el.getAttribute('quantity') ?? 0)
    const proceeds        = Number(el.getAttribute('proceeds') ?? 0)
    const commissions     = Number(el.getAttribute('commisionsAndTax') ?? 0)
    const fifoPnlRealized = optionalNumber(el, 'fifoPnlRealized', 'realizedPnl')
    const cost            = optionalNumber(el, 'cost', 'costBasis')

    // STK leg (shares bought/delivered via assignment): sign matters for the
    // FIFO lot matcher — Buy opens a lot, Sell closes one.
    // OPT leg (the option's own exercise/assignment/expiration/cash-settlement):
    // this always fully closes the position, and the matcher only checks
    // openClose === 'C' for it (quantity sign isn't load-bearing there), so a
    // plain magnitude is fine.
    const quantity = assetClass === 'STK'
      ? (transactionType === 'Sell' ? -Math.abs(rawQty) : Math.abs(rawQty))
      : Math.abs(rawQty)

    return {
      accountId:        el.getAttribute('accountId') ?? undefined,
      execId:           el.getAttribute('tradeID') ?? undefined,
      tradeDate:        el.getAttribute('date') || flexDate(el.getAttribute('dateTime')) || '',
      tradeTime:        el.getAttribute('tradeTime') ?? el.getAttribute('dateTime')?.split(';')[1] ?? undefined,
      symbol:           (el.getAttribute('symbol') ?? '').trim(),
      underlyingSymbol: el.getAttribute('underlyingSymbol') || undefined,
      assetClass,
      putCall:          (el.getAttribute('putCall') || undefined) as RawTrade['putCall'],
      strike:           el.getAttribute('strike') ? Number(el.getAttribute('strike')) : undefined,
      expiry:           el.getAttribute('expiry') || undefined,
      quantity,
      tradePrice:       Number(el.getAttribute('tradePrice') ?? 0),
      proceeds,
      commissions,
      // OptionEAE has no netCash attribute. proceeds − |commission| matches
      // the cash that moved. It is not the realised P&L: an equity assignment
      // prints realised 0 on the option (the premium rolls into the stock's
      // fifoPnlRealized), and a cash-settled SPX/SPXW exercise puts the full
      // result in fifoPnlRealized while proceeds on that line can be 0.
      netCash:          proceeds - Math.abs(commissions),
      // Every OptionEAE event is terminal for that option — always a close.
      openClose:        assetClass === 'OPT' ? 'C' as const : undefined,
      ...(cost != null ? { cost } : {}),
      ...(fifoPnlRealized != null ? { fifoPnlRealized } : {}),
    }
  })
}

/** Shares moved in/out of the account via ACATS or an internal transfer (e.g.
 * an option that settled by delivering the underlying into this account from
 * elsewhere) never appear as a <Trade> or <OptionEAE> either — they're a
 * <Transfer> record with its own direction/quantity/positionAmount fields.
 * Verified against a real account: two <Transfer> records (TSLA +42, NVDA
 * +10, both "IN") fully explained share counts that otherwise looked
 * undercounted with no error anywhere else in the data.
 *
 * BUT some accounts' Flex reports book an option assignment/exercise's share
 * delivery BOTH as an <OptionEAE> STK leg AND as its own <Transfer> record —
 * unlike the Trade/OptionEAE overlap above, these carry no shared tradeID to
 * dedupe by. Verified against a real account: a 100-share MSTR assignment and
 * a 100-share NVDA assignment each also produced a same-day, same-quantity
 * <Transfer>, silently doubling both share counts (700 shown instead of 600,
 * 110 instead of 10) even immediately after a fresh resync. Any Transfer
 * whose date+symbol+quantity exactly matches an OptionEAE STK leg already
 * counted is the account's own duplicate report of that assignment and is
 * skipped. */
function parseTransfers(doc: Document, optionEaeStockKeys: Set<string>): RawTrade[] {
  return Array.from(doc.querySelectorAll('Transfer'))
    .filter(el => (attr(el, 'assetCategory') ?? 'STK') === 'STK')
    .filter(el => {
      const date = el.getAttribute('date') ?? ''
      const symbol = (el.getAttribute('symbol') ?? '').trim()
      const direction = el.getAttribute('direction') ?? 'IN'
      const rawQty = Number(el.getAttribute('quantity') ?? 0)
      const quantity = direction === 'OUT' ? -Math.abs(rawQty) : Math.abs(rawQty)
      return !optionEaeStockKeys.has(`${date}|${symbol}|${quantity}`)
    })
    .map(el => {
      const direction = el.getAttribute('direction') ?? 'IN'
      const rawQty = Number(el.getAttribute('quantity') ?? 0)
      const quantity = direction === 'OUT' ? -Math.abs(rawQty) : Math.abs(rawQty)
      const positionAmount = Math.abs(Number(el.getAttribute('positionAmount') ?? 0))
      const tradePrice = rawQty !== 0 ? positionAmount / Math.abs(rawQty) : 0
      // Shares coming IN cost the account money (like a buy, negative cash);
      // shares going OUT return value (like a sell, positive cash).
      const netCash = quantity > 0 ? -positionAmount : positionAmount
      return {
        accountId:        el.getAttribute('accountId') ?? undefined,
        tradeDate:        el.getAttribute('date') ?? '',
        symbol:           (el.getAttribute('symbol') ?? '').trim(),
        underlyingSymbol: el.getAttribute('underlyingSymbol') || undefined,
        assetClass:       'STK' as RawTrade['assetClass'],
        quantity,
        tradePrice,
        proceeds:         netCash,
        commissions:      0,
        netCash,
        isTransfer:       true,
      }
    })
}

// A Flex Query token can be provisioned across multiple linked accounts
// (family/advisor structure) — every account's activity comes back in the
// same XML. OpenPosition rows always carry accountId, but that alone isn't
// enough: if the export mixes accounts, keep only the one this sync is
// actually for (the account with the most positions/trades), so a closed
// trade from an unrelated linked account doesn't leak into this journal.
function filterToPrimaryAccount(
  positions: RawPosition[],
  trades: RawTrade[],
): { positions: RawPosition[]; trades: RawTrade[] } {
  const counts = new Map<string, number>()
  for (const p of positions) {
    if (p.accountId) counts.set(p.accountId, (counts.get(p.accountId) ?? 0) + 1)
  }
  if (counts.size === 0) {
    for (const t of trades) {
      if (t.accountId) counts.set(t.accountId, (counts.get(t.accountId) ?? 0) + 1)
    }
  }
  if (counts.size < 2) return { positions, trades }

  let primary = ''
  let max = -1
  for (const [id, n] of counts) {
    if (n > max) { max = n; primary = id }
  }
  return {
    positions: positions.filter(p => !p.accountId || p.accountId === primary),
    trades: trades.filter(t => !t.accountId || t.accountId === primary),
  }
}

function allTrades(doc: Document): RawTrade[] {
  // Execution ids only. A CLOSED_LOT row often repeats the closing tradeID;
  // collecting every Trade element's id (the old approach) is the same set
  // for that case, but a closed-lot-only id must not suppress an OptionEAE
  // assignment that isn't already in the execution list.
  const trades = parseTrades(doc)
  const usedTradeIds = new Set(trades.map(t => t.execId).filter((id): id is string => !!id))
  const optionEae = parseOptionEAE(doc, usedTradeIds)
  const optionEaeStockKeys = new Set(
    optionEae
      .filter(t => t.assetClass === 'STK')
      .map(t => `${t.tradeDate}|${t.symbol}|${t.quantity}`),
  )
  // `trades` already replaced whatever this report window contains. Accounts
  // synced before cost / fifoPnlRealized / closedLots were parsed pick those
  // fields up on the next Flex sync — portfolio data is one JSON document,
  // so there is no separate column migration. History older than the report
  // window is left as it was (see mergeTrades).
  return [...trades, ...optionEae, ...parseTransfers(doc, optionEaeStockKeys)]
}
