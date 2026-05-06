import type { RawPosition, RawTrade } from '../types'

// Vercel serverless function uses AWS IPs — not blocked by IBKR like Cloudflare
const FLEX_PROXY = 'https://options-jade.vercel.app'

// ─── XML Upload ───────────────────────────────────────────────────────────────

export async function syncFromXML(file: File): Promise<{ positions: RawPosition[]; trades: RawTrade[]; cashBalance: number; netLiquidation?: number }> {
  const text = await file.text()
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  return { positions: parsePositions(doc), trades: parseTrades(doc), cashBalance: parseCash(doc), netLiquidation: parseNetLiq(doc) }
}

// ─── Flex API ─────────────────────────────────────────────────────────────────

export async function syncFromFlexAPI(token: string, queryId: string): Promise<{ positions: RawPosition[]; trades: RawTrade[]; cashBalance: number; netLiquidation?: number }> {
  if (!token || !queryId) throw new Error('Token and Query ID are required')

  const url = `${FLEX_PROXY}/api/flex-sync?token=${encodeURIComponent(token)}&query=${encodeURIComponent(queryId)}`
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
  return { positions: parsePositions(doc), trades: parseTrades(doc), cashBalance: parseCash(doc), netLiquidation: parseNetLiq(doc) }
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

function parsePositions(doc: Document): RawPosition[] {
  const positions = Array.from(doc.querySelectorAll('OpenPosition')).map(el => {
    // IBKR Flex XML uses assetCategory in most reports, assetClass in some
    const ac = attr(el, 'assetCategory', 'assetClass') ?? ''
    const pc = attr(el, 'putCall')
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
    }
  })

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
  // Prefer BASE_SUMMARY row; fall back to summing all currency rows
  const rows = Array.from(doc.querySelectorAll('CashReportCurrency'))
  const base = rows.find(el => el.getAttribute('currency') === 'BASE_SUMMARY')
  if (base) return Number(base.getAttribute('endingCash') ?? 0)
  return rows.reduce((sum, el) => sum + Number(el.getAttribute('endingCash') ?? 0), 0)
}

function parseNetLiq(doc: Document): number | undefined {
  // IBKR Flex reports include EquitySummaryInBase with exact netLiquidation
  const eqBase = doc.querySelector('EquitySummaryInBase')
  if (eqBase) {
    const nl = eqBase.getAttribute('netLiquidation')
    if (nl) return Number(nl)
  }
  // Also try EquitySummaryByReportDateInBase
  const eqDate = doc.querySelector('EquitySummaryByReportDateInBase')
  if (eqDate) {
    const nl = eqDate.getAttribute('netLiquidation')
    if (nl) return Number(nl)
  }
  return undefined
}

function parseTrades(doc: Document): RawTrade[] {
  return Array.from(doc.querySelectorAll('Trade')).map(el => ({
    tradeDate:        el.getAttribute('tradeDate') ?? '',
    symbol:           el.getAttribute('symbol') ?? '',
    underlyingSymbol: el.getAttribute('underlyingSymbol') ?? undefined,
    assetClass:       (attr(el, 'assetCategory', 'assetClass') ?? 'STK') as RawTrade['assetClass'],
    putCall:          (el.getAttribute('putCall') || undefined) as RawTrade['putCall'],
    strike:           el.getAttribute('strike') ? Number(el.getAttribute('strike')) : undefined,
    expiry:           el.getAttribute('expiry') ?? undefined,
    quantity:         Number(el.getAttribute('quantity') ?? 0),
    tradePrice:       Number(el.getAttribute('tradePrice') ?? 0),
    proceeds:         Number(el.getAttribute('proceeds') ?? 0),
    commissions:      Number(el.getAttribute('ibCommission') ?? 0),
    netCash:          Number(el.getAttribute('netCash') ?? 0),
    openClose:        (el.getAttribute('openCloseIndicator') || undefined) as RawTrade['openClose'],
  }))
}
