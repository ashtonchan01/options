/**
 * Quote proxy for the Portfolio Allocation page — price + 52-week high per
 * symbol, pulled from the same Yahoo v8/finance/chart meta object /api/price
 * uses (just reading two more fields off it instead of one).
 *
 * GET /api/quote?symbols=TSLA,MSTR
 * → { "TSLA": { "price": 332.81, "high52": 488.54 }, ... }
 */

export const config = { runtime: 'edge' }

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

  const url = new URL(req.url)
  const symbolsParam = url.searchParams.get('symbols')
  if (!symbolsParam) {
    return new Response(JSON.stringify({ error: 'Missing symbols' }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  const symbols = symbolsParam
    .split(',')
    .map(s => s.trim().toUpperCase())
    .filter(s => /^[A-Za-z0-9.\-]{1,10}$/.test(s))
    .slice(0, 25)

  if (symbols.length === 0) {
    return new Response(JSON.stringify({ error: 'No valid symbols' }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  const results = await Promise.all(
    symbols.map(async sym => {
      try {
        const r = await fetch(
          `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=1d&interval=1d&includePrePost=false`,
          { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(6000) },
        )
        if (!r.ok) return [sym, null]
        const json = await r.json()
        const meta = json?.chart?.result?.[0]?.meta
        const price = meta?.regularMarketPrice
        const high52 = meta?.fiftyTwoWeekHigh
        if (typeof price !== 'number' || price <= 0) return [sym, null]
        return [sym, { price, high52: typeof high52 === 'number' && high52 > 0 ? high52 : null }]
      } catch {
        return [sym, null]
      }
    })
  )

  const body = Object.fromEntries(results.filter(([, v]) => v !== null))
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' },
  })
}
