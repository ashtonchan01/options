/**
 * Stock price proxy — uses Yahoo Finance v8/finance/chart.
 * No crumb, no cookies, no auth. Different service from the options
 * chain endpoint so it has none of the same rate-limit issues.
 *
 * GET /api/price?symbols=MSTR,TSLA,NVDA
 * → { "MSTR": 148.50, "TSLA": 182.30, "NVDA": 950.00 }
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

  // Fetch all in parallel — v8/finance/chart needs no crumb or cookies
  const results = await Promise.all(
    symbols.map(async sym => {
      try {
        const r = await fetch(
          `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=1d&interval=1d&includePrePost=false`,
          { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(6000) },
        )
        if (!r.ok) return [sym, null]
        const json = await r.json()
        const price = json?.chart?.result?.[0]?.meta?.regularMarketPrice
        return [sym, typeof price === 'number' && price > 0 ? price : null]
      } catch {
        return [sym, null]
      }
    })
  )

  const data = {}
  for (const [sym, price] of results) {
    if (price !== null) data[sym] = price
  }

  return new Response(JSON.stringify(data), {
    status: 200,
    headers: {
      ...CORS,
      'Content-Type': 'application/json',
      'Cache-Control': 's-maxage=60, stale-while-revalidate=120',
    },
  })
}
