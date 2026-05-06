import type { RawPosition, RawTrade, SyncState } from '../types'

const FLEX_PROXY = 'https://wheel-proxy.ashtonchan.workers.dev'
const FLEX_TOKEN = import.meta.env.VITE_FLEX_TOKEN ?? ''
const QUERY_ID   = import.meta.env.VITE_FLEX_QUERY_ID ?? ''

// ─── XML Upload ───────────────────────────────────────────────────────────────

export async function syncFromXML(file: File): Promise<{ positions: RawPosition[]; trades: RawTrade[] }> {
  const text = await file.text()
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  return {
    positions: parsePositions(doc),
    trades: parseTrades(doc),
  }
}

// ─── Flex API (two-step) ──────────────────────────────────────────────────────

const MAX_ATTEMPTS = 5
const RETRY_DELAY  = 8_000

export async function syncFromFlexAPI(): Promise<{ positions: RawPosition[]; trades: RawTrade[] }> {
  if (!FLEX_TOKEN || !QUERY_ID) throw new Error('VITE_FLEX_TOKEN / VITE_FLEX_QUERY_ID not configured')

  // Step 1: request
  const sendUrl = `${FLEX_PROXY}/flex/send?token=${FLEX_TOKEN}&query=${QUERY_ID}&v=3`
  const sendRes = await fetch(sendUrl)
  const sendXml = await sendRes.text()
  const sendDoc = new DOMParser().parseFromString(sendXml, 'application/xml')
  const referenceCode = sendDoc.querySelector('FlexStatementResponse')?.getAttribute('ReferenceCode')
  if (!referenceCode) throw new Error('No reference code from IBKR')

  // Step 2: poll for result
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    if (i > 0) await delay(RETRY_DELAY)
    const getUrl = `${FLEX_PROXY}/flex/get?token=${FLEX_TOKEN}&query=${referenceCode}&v=3`
    const getRes = await fetch(getUrl)
    const getXml = await getRes.text()
    const getDoc = new DOMParser().parseFromString(getXml, 'application/xml')

    const status = getDoc.querySelector('FlexStatementResponse')?.getAttribute('Status')
    if (status === 'Success') {
      return { positions: parsePositions(getDoc), trades: parseTrades(getDoc) }
    }
    const errCode = getDoc.querySelector('FlexStatementResponse')?.getAttribute('ErrorCode')
    if (errCode !== '1019' && errCode !== '1021') {
      throw new Error(`IBKR error ${errCode}: ${getDoc.querySelector('FlexStatementResponse')?.getAttribute('ErrorMessage')}`)
    }
  }
  throw new Error('IBKR Flex API timed out after retries')
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

function delay(ms: number) { return new Promise(r => setTimeout(r, ms)) }
