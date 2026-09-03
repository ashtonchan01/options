/**
 * Market movers proxy — Vercel Edge Function. Returns trending tickers,
 * top gainers, top losers, and most active stocks in one call, mirroring
 * the sidebar on Yahoo Finance's markets pages. Yahoo's screener/trending
 * endpoints don't set CORS headers for browser calls, so this proxies them
 * server-side the same way api/markets.js does for quotes.
 */

export const config = { runtime: 'edge' }

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
const RESPONSE_TTL = 60 * 1000 // 60s in-isolate cache — these lists don't need to be second-fresh

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

let cache = null // { data, time }

function jsonResponse(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json', ...extra },
  })
}

/** Normalizes one Yahoo screener/trending quote row into the shape the
 * client actually renders — Yahoo's raw quote objects carry dozens of
 * fields this UI has no use for. */
function normalizeQuote(q) {
  if (!q || typeof q.regularMarketPrice !== 'number') return null
  return {
    symbol: q.symbol,
    name: q.shortName ?? q.longName ?? q.symbol,
    price: q.regularMarketPrice,
    change: q.regularMarketChange ?? 0,
    changePercent: q.regularMarketChangePercent ?? 0,
    volume: q.regularMarketVolume ?? null,
  }
}

async function fetchScreener(scrId, count) {
  for (const host of ['query2.finance.yahoo.com', 'query1.finance.yahoo.com']) {
    try {
      const url = `https://${host}/v1/finance/screener/predefined/saved?formatted=false&lang=en-US&region=US&scrIds=${scrId}&count=${count}`
      const res = await fetch(url, { headers: { 'User-Agent': UA } })
      if (!res.ok) continue
      const json = await res.json()
      const quotes = json?.finance?.result?.[0]?.quotes ?? []
      return quotes.map(normalizeQuote).filter(Boolean)
    } catch { /* try next host */ }
  }
  return []
}

async function fetchTrending(count) {
  for (const host of ['query2.finance.yahoo.com', 'query1.finance.yahoo.com']) {
    try {
      const url = `https://${host}/v1/finance/trending/US?count=${count}`
      const res = await fetch(url, { headers: { 'User-Agent': UA } })
      if (!res.ok) continue
      const json = await res.json()
      const symbols = (json?.finance?.result?.[0]?.quotes ?? []).map(q => q.symbol).filter(Boolean)
      if (symbols.length === 0) return []
      // Trending only returns symbols, not quote data — fetch a real quote
      // for each so the row can show price/change like the other three lists.
      const quoteUrl = `https://${host}/v7/finance/quote?symbols=${symbols.join(',')}`
      const quoteRes = await fetch(quoteUrl, { headers: { 'User-Agent': UA } })
      if (!quoteRes.ok) continue
      const quoteJson = await quoteRes.json()
      const quotes = quoteJson?.quoteResponse?.result ?? []
      return quotes.map(normalizeQuote).filter(Boolean)
    } catch { /* try next host */ }
  }
  return []
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS })
  }

  if (cache && Date.now() - cache.time < RESPONSE_TTL) {
    return jsonResponse(cache.data, 200, { 'X-Cache': 'HIT', 'Cache-Control': 's-maxage=60, stale-while-revalidate=180' })
  }

  const COUNT = 10
  const [gainers, losers, actives, trending] = await Promise.all([
    fetchScreener('day_gainers', COUNT),
    fetchScreener('day_losers', COUNT),
    fetchScreener('most_actives', COUNT),
    fetchTrending(COUNT),
  ])

  const data = { gainers, losers, actives, trending }
  cache = { data, time: Date.now() }

  return jsonResponse(data, 200, { 'X-Cache': 'MISS', 'Cache-Control': 's-maxage=60, stale-while-revalidate=180' })
}
