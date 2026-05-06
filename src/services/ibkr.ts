import type { RawPosition, RawTrade } from '../types'

// Vercel serverless function uses AWS IPs — not blocked by IBKR like Cloudflare
const FLEX_PROXY = 'https://options-jade.vercel.app'

// ─── XML Upload ───────────────────────────────────────────────────────────────

export async function syncFromXML(file: File): Promise<{ positions: RawPosition[]; trades: RawTrade[]; cashBalance: number }> {
  const text = await file.text()
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  return { positions: parsePositions(doc), trades: parseTrades(doc), cashBalance: parseCash(doc) }
}

// ─── Flex API ─────────────────────────────────────────────────────────────────

export async function syncFromFlexAPI(token: string, queryId: string): Promise<{ positions: RawPosition[]; trades: RawTrade[]; cashBalance: number }> {
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
  return { positions: parsePositions(doc), trades: parseTrades(doc), cashBalance: parseCash(doc) }
}

// ─── Ping ─────────────────────────────────────────────────────────────────────

export async function pingProxy(): Promise<{ ok: boolean }> {
  const res = await fetch(`${FLEX_PROXY}/api/flex-sync?token=ping&query=ping`)
  // 400 = reachable (missing real params), anything else = down
  return { ok: res.status === 400 || res.status === 200 }
}

// ─── Parsers ──────────────────────────────────────────────────────────────────

function parsePositions(doc: Document): RawPosition[] {
  return Array.from(doc.querySelectorAll('OpenPosition')).map(el => ({
    accountId:        el.getAttribute('accountId') ?? '',
    symbol:           el.getAttribute('symbol') ?? '',
    description:      el.getAttribute('description') ?? '',
    assetClass:       (el.getAttribute('assetClass') ?? 'STK') as RawPosition['assetClass'],
    quantity:         Number(el.getAttribute('position') ?? 0),
    costBasisPrice:   Number(el.getAttribute('costBasisPrice') ?? 0),
    costBasisMoney:   Number(el.getAttribute('costBasisMoney') ?? 0),
    markPrice:        Number(el.getAttribute('markPrice') ?? 0),
    positionValue:    Number(el.getAttribute('positionValue') ?? 0),
    unrealizedPnL:    Number(el.getAttribute('unrealizedPnL') ?? 0),
    putCall:          (el.getAttribute('putCall') || undefined) as RawPosition['putCall'],
    strike:           el.getAttribute('strike') ? Number(el.getAttribute('strike')) : undefined,
    expiry:           el.getAttribute('expiry') ?? undefined,
    multiplier:       el.getAttribute('multiplier') ? Number(el.getAttribute('multiplier')) : undefined,
    underlyingSymbol: el.getAttribute('underlyingSymbol') ?? undefined,
    currency:         el.getAttribute('currency') ?? 'USD',
  }))
}

function parseCash(doc: Document): number {
  // Prefer BASE_SUMMARY row; fall back to summing all currency rows
  const rows = Array.from(doc.querySelectorAll('CashReportCurrency'))
  const base = rows.find(el => el.getAttribute('currency') === 'BASE_SUMMARY')
  if (base) return Number(base.getAttribute('endingCash') ?? 0)
  return rows.reduce((sum, el) => sum + Number(el.getAttribute('endingCash') ?? 0), 0)
}

function parseTrades(doc: Document): RawTrade[] {
  return Array.from(doc.querySelectorAll('Trade')).map(el => ({
    tradeDate:        el.getAttribute('tradeDate') ?? '',
    symbol:           el.getAttribute('symbol') ?? '',
    underlyingSymbol: el.getAttribute('underlyingSymbol') ?? undefined,
    assetClass:       (el.getAttribute('assetClass') ?? 'STK') as RawTrade['assetClass'],
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
