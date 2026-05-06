import type { RawPosition, RawTrade } from '../types'

// Use local proxy in dev (avoids IBKR blocking Cloudflare IPs), worker in prod
const FLEX_PROXY = import.meta.env.DEV
  ? 'http://localhost:3457'
  : 'https://wheel-proxy.ashtonchan.workers.dev'

// ─── XML Upload ───────────────────────────────────────────────────────────────

export async function syncFromXML(file: File): Promise<{ positions: RawPosition[]; trades: RawTrade[] }> {
  const text = await file.text()
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  return {
    positions: parsePositions(doc),
    trades: parseTrades(doc),
  }
}

// ─── Flex API ─────────────────────────────────────────────────────────────────
// Token lives in the Worker as a secret — never exposed to the browser.

export async function syncFromFlexAPI(): Promise<{ positions: RawPosition[]; trades: RawTrade[] }> {
  const res = await fetch(`${FLEX_PROXY}/flex/sync`)

  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try {
      const body = await res.json() as { error?: string }
      if (body.error) msg = body.error
    } catch { /* ignore */ }
    throw new Error(msg)
  }

  const xml = await res.text()
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  return {
    positions: parsePositions(doc),
    trades: parseTrades(doc),
  }
}

// ─── Ping ─────────────────────────────────────────────────────────────────────

export async function pingWorker(): Promise<{ ok: boolean; configured: boolean; hasToken: boolean; hasQueryId: boolean }> {
  const res = await fetch(`${FLEX_PROXY}/ping`)
  if (!res.ok) throw new Error(`Worker unreachable (${res.status})`)
  return res.json()
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
