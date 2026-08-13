/**
 * Batch index/quote proxy for the Markets page — Vercel Edge Function.
 * Returns price + change + marketState for a list of symbols in one call.
 */

export const config = { runtime: 'edge' }

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
const RESPONSE_TTL = 45 * 1000 // 45s in-isolate cache

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

const responseCache = new Map()

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

function jsonResponse(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json', ...extra },
  })
}

async function fetchOne(symbol) {
  for (const host of ['query2.finance.yahoo.com', 'query1.finance.yahoo.com']) {
    try {
      const url = `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?interval=15m&range=1d`
      const res = await fetch(url, { headers: { 'User-Agent': UA } })
      if (res.status === 429) { await sleep(1500); continue }
      if (!res.ok) continue
      const json = await res.json()
      const result = json?.chart?.result?.[0]
      const meta = result?.meta
      if (!meta || typeof meta.regularMarketPrice !== 'number') continue

      const price = meta.regularMarketPrice
      const prevClose = meta.previousClose ?? meta.chartPreviousClose ?? price
      const change = price - prevClose
      const changePercent = prevClose ? (change / prevClose) * 100 : 0

      const closes = result?.indicators?.quote?.[0]?.close ?? []
      let sparkline = closes.filter(c => typeof c === 'number')

      // Yahoo's intraday chart for a closed market sometimes hasn't rolled
      // over to today's just-finished session yet even though `meta` already
      // has — the "1d" bars it returns can still be yesterday's (down) day
      // while regularMarketPrice/previousClose already reflect today's (up)
      // close, so the sparkline visibly trends the opposite way from the %
      // shown next to it (verified against a user report: Nikkei showing
      // +1.16% with a strictly-declining chart). If the bars' own net
      // direction disagrees with the authoritative change sign, they're not
      // trustworthy — fall back to a straight two-point line from
      // previousClose to price, which is guaranteed to agree.
      if (sparkline.length >= 2) {
        const barsDelta = sparkline[sparkline.length - 1] - sparkline[0]
        if (Math.sign(barsDelta) !== Math.sign(change) && change !== 0 && barsDelta !== 0) {
          sparkline = [prevClose, price]
        }
      } else {
        sparkline = [prevClose, price]
      }

      return {
        price,
        change,
        changePercent,
        marketState: meta.marketState ?? null,
        exchangeName: meta.exchangeName ?? null,
        sparkline,
      }
    } catch { /* try next host */ }
  }
  return null
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS })
  }

  const url = new URL(req.url)
  const symbolsParam = url.searchParams.get('symbols')
  if (!symbolsParam) return jsonResponse({ error: 'Missing symbols param' }, 400)
  if (!/^[A-Za-z0-9.^=,\-]+$/.test(symbolsParam)) return jsonResponse({ error: 'Invalid symbols' }, 400)

  const symbols = [...new Set(symbolsParam.split(',').filter(Boolean))]

  const cacheKey = symbols.slice().sort().join(',')
  const cached = responseCache.get(cacheKey)
  if (cached && Date.now() - cached.time < RESPONSE_TTL) {
    return jsonResponse(cached.data, 200, { 'X-Cache': 'HIT', 'Cache-Control': 's-maxage=45, stale-while-revalidate=120' })
  }

  const data = {}
  for (let i = 0; i < symbols.length; i++) {
    const quote = await fetchOne(symbols[i])
    if (quote) data[symbols[i]] = quote
    if (i < symbols.length - 1) await sleep(150)
  }

  responseCache.set(cacheKey, { data, time: Date.now() })
  for (const [k, v] of responseCache) {
    if (Date.now() - v.time > RESPONSE_TTL * 3) responseCache.delete(k)
  }

  return jsonResponse(data, 200, { 'X-Cache': 'MISS', 'Cache-Control': 's-maxage=45, stale-while-revalidate=120' })
}
