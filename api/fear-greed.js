/**
 * Fear & Greed proxy — crypto (alternative.me's public Fear & Greed Index
 * API, documented and CORS-open) and stocks (CNN's own Fear & Greed Index
 * data endpoint, same one cnn.com/markets/fear-and-greed itself reads —
 * undocumented but widely relied on; needs browser-like headers or it 403s).
 *
 * GET /api/fear-greed
 * → { crypto: { value, classification, timestamp } | null,
 *     stocks: { value, rating, timestamp } | null }
 */

export const config = { runtime: 'edge' }

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
const RESPONSE_TTL = 15 * 60 * 1000 // 15 min in-isolate cache

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

let cache = { at: 0, body: null }

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

async function fetchCrypto() {
  try {
    const r = await fetch('https://api.alternative.me/fng/?limit=1', { signal: AbortSignal.timeout(8000) })
    if (!r.ok) return null
    const json = await r.json()
    const d = json?.data?.[0]
    if (!d) return null
    return {
      value: Number(d.value),
      classification: d.value_classification,
      timestamp: Number(d.timestamp) * 1000,
    }
  } catch {
    return null
  }
}

async function fetchStocks() {
  try {
    const r = await fetch('https://production.dataviz.cnn.io/index/fearandgreed/graphdata', {
      headers: {
        'User-Agent': UA,
        'Accept': 'application/json',
        'Referer': 'https://www.cnn.com/markets/fear-and-greed',
      },
      signal: AbortSignal.timeout(8000),
    })
    if (!r.ok) return null
    const json = await r.json()
    const d = json?.fear_and_greed
    if (!d || typeof d.score !== 'number') return null
    return {
      value: Math.round(d.score),
      rating: d.rating,
      timestamp: d.timestamp ? Date.parse(d.timestamp) : Date.now(),
    }
  } catch {
    return null
  }
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

  if (cache.body && Date.now() - cache.at < RESPONSE_TTL) return jsonResponse(cache.body)

  const [crypto, stocks] = await Promise.all([fetchCrypto(), fetchStocks()])
  const body = { crypto, stocks }
  cache = { at: Date.now(), body }
  return jsonResponse(body)
}
