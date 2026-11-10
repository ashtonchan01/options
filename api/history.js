/**
 * Daily close history for the Pairs page. Same Yahoo v8/finance/chart
 * source as /api/price and /api/rsi, returning aligned timestamps + closes
 * so the client can build a price ratio without pulling a full chart payload.
 *
 * GET /api/history?symbols=TSLA,NVDA&range=1y
 * → { "TSLA": { "t": [1719792000, ...], "c": [248.5, ...] }, ... }
 *
 * Read-only. No orders.
 */

export const config = { runtime: 'edge' }

const UA = 'Mozilla/5.0'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

const RANGES = new Set(['3mo', '6mo', '1y', '2y'])

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

  const url = new URL(req.url)
  const symbolsParam = url.searchParams.get('symbols')
  const range = RANGES.has(url.searchParams.get('range') ?? '') ? url.searchParams.get('range') : '1y'
  if (!symbolsParam) {
    return new Response(JSON.stringify({ error: 'Missing symbols' }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  const symbols = [...new Set(symbolsParam
    .split(',')
    .map(s => s.trim().toUpperCase())
    .filter(s => /^[A-Za-z0-9.\-=^]{1,12}$/.test(s)))]
    .slice(0, 4)

  if (symbols.length === 0) {
    return new Response(JSON.stringify({ error: 'No valid symbols' }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  async function fetchOne(sym) {
    const hosts = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com']
    let r = null
    for (const host of hosts) {
      r = await fetch(
        `https://${host}/v8/finance/chart/${encodeURIComponent(sym)}?range=${range}&interval=1d&includePrePost=false`,
        { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000) },
      )
      if (r.ok) break
      if (r.status !== 429) return null
    }
    if (!r || !r.ok) return null
    const json = await r.json()
    const result = json?.chart?.result?.[0]
    const ts = result?.timestamp
    const closes = result?.indicators?.quote?.[0]?.close
    if (!Array.isArray(ts) || !Array.isArray(closes)) return null
    const t = []
    const c = []
    for (let i = 0; i < ts.length; i++) {
      const close = closes[i]
      if (typeof ts[i] === 'number' && typeof close === 'number' && close > 0) {
        t.push(ts[i])
        c.push(close)
      }
    }
    if (t.length < 5) return null
    return { t, c }
  }

  const sleep = ms => new Promise(r => setTimeout(r, ms))

  async function attempt(sym) {
    try {
      const first = await fetchOne(sym)
      if (first) return [sym, first]
      await sleep(800)
      return [sym, await fetchOne(sym)]
    } catch {
      try {
        await sleep(800)
        return [sym, await fetchOne(sym)]
      } catch {
        return [sym, null]
      }
    }
  }

  const results = []
  for (const sym of symbols) {
    results.push(await attempt(sym))
  }
  const body = Object.fromEntries(results.filter(([, v]) => v !== null))
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
  })
}
