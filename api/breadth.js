/**
 * Market-breadth proxy — % of the given ticker list trading above its own
 * 20/50/200-day SMA, computed server-side from Yahoo daily closes (same
 * source/shape as /api/rsi). Labelled "Watchlist Breadth" client-side since
 * this covers whatever tickers the caller passes, not the full S&P 500 —
 * a true full-index breadth read needs constituent-level data this app
 * doesn't have.
 *
 * GET /api/breadth?symbols=AAPL,MSFT,...
 * → { above20: 62.5, above50: 58.3, above200: 71.2, count: 24,
 *     tickers: [{ symbol: 'AAPL', above20: true, above50: false, above200: true }, ...] }
 */

export const config = { runtime: 'edge' }

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
const RESPONSE_TTL = 5 * 60 * 1000 // 5 min in-isolate cache

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

let cache = { key: '', at: 0, body: null }

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

function sma(closes, period) {
  if (closes.length < period) return null
  const slice = closes.slice(-period)
  return slice.reduce((s, c) => s + c, 0) / period
}

async function fetchOne(symbol) {
  try {
    const r = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1y&interval=1d`,
      { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) },
    )
    if (!r.ok) return null
    const json = await r.json()
    const result = json?.chart?.result?.[0]
    const closesRaw = result?.indicators?.quote?.[0]?.close
    if (!Array.isArray(closesRaw)) return null
    const closes = closesRaw.filter(c => typeof c === 'number')
    if (closes.length === 0) return null
    const price = closes[closes.length - 1]
    return {
      symbol,
      above20: sma(closes, 20) != null ? price > sma(closes, 20) : null,
      above50: sma(closes, 50) != null ? price > sma(closes, 50) : null,
      above200: sma(closes, 200) != null ? price > sma(closes, 200) : null,
    }
  } catch {
    return null
  }
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

  const url = new URL(req.url)
  const symbolsParam = url.searchParams.get('symbols')
  if (!symbolsParam) return jsonResponse({ error: 'Missing symbols' }, 400)

  const symbols = symbolsParam
    .split(',')
    .map(s => s.trim().toUpperCase())
    .filter(s => /^[A-Za-z0-9.\-]{1,10}$/.test(s))
    .slice(0, 40)

  if (symbols.length === 0) return jsonResponse({ error: 'No valid symbols' }, 400)

  const cacheKey = symbols.slice().sort().join(',')
  if (cache.body && cache.key === cacheKey && Date.now() - cache.at < RESPONSE_TTL) {
    return jsonResponse(cache.body)
  }

  const results = (await Promise.all(symbols.map(fetchOne))).filter(Boolean)
  const pct = key => {
    const withData = results.filter(r => r[key] != null)
    if (withData.length === 0) return null
    return Math.round((withData.filter(r => r[key]).length / withData.length) * 1000) / 10
  }

  const body = {
    above20: pct('above20'),
    above50: pct('above50'),
    above200: pct('above200'),
    count: results.length,
    tickers: results,
  }
  cache = { key: cacheKey, at: Date.now(), body }
  return jsonResponse(body)
}
