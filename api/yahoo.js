/**
 * Yahoo Finance proxy — runs as Vercel Edge Function (Cloudflare network)
 * to avoid datacenter-specific rate limits on Yahoo's API.
 */

export const config = { runtime: 'edge' }

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

// In-memory cache (per edge isolate)
let cachedCrumb = null
let cachedCookies = null
let cacheTime = 0
const CACHE_TTL = 25 * 60 * 1000 // 25 minutes

const responseCache = new Map()
const RESPONSE_TTL = 3 * 60 * 1000 // 3 minutes

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

function jsonResponse(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json', ...extra },
  })
}

function rawResponse(data, status = 200, extra = {}) {
  return new Response(data, {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json', ...extra },
  })
}

async function getCrumb() {
  if (cachedCrumb && Date.now() - cacheTime < CACHE_TTL) {
    return { crumb: cachedCrumb, cookies: cachedCookies }
  }

  // Step 1: Get cookies from consent endpoint
  const fcRes = await fetch('https://fc.yahoo.com', {
    headers: { 'User-Agent': UA },
    redirect: 'follow',
  })
  await fcRes.text()

  let cookieParts = []
  if (typeof fcRes.headers.getSetCookie === 'function') {
    cookieParts = fcRes.headers.getSetCookie()
  } else {
    const raw = fcRes.headers.get('set-cookie') || ''
    cookieParts = raw.split(/,(?=\s*\w+=)/)
  }

  const cookieStr = cookieParts
    .map(c => c.split(';')[0].trim())
    .filter(c => c.includes('='))
    .join('; ')

  if (!cookieStr) throw new Error('No cookies from fc.yahoo.com')

  // Step 2: Get crumb (try both query hosts)
  const HOSTS = ['query2.finance.yahoo.com', 'query1.finance.yahoo.com']
  let crumbRes
  for (let ci = 0; ci < 3; ci++) {
    const host = HOSTS[ci % HOSTS.length]
    crumbRes = await fetch(`https://${host}/v1/test/getcrumb`, {
      headers: { 'User-Agent': UA, 'Cookie': cookieStr },
    })
    if (crumbRes.status === 429 && ci < 2) {
      await sleep(2000 * (ci + 1))
      continue
    }
    break
  }
  if (!crumbRes.ok) throw new Error(`Crumb endpoint returned ${crumbRes.status}`)

  const crumb = (await crumbRes.text()).trim()
  if (!crumb || crumb.startsWith('{') || crumb.startsWith('<') || crumb.length > 40) {
    throw new Error(`Invalid crumb: ${crumb.slice(0, 50)}`)
  }

  cachedCrumb = crumb
  cachedCookies = cookieStr
  cacheTime = Date.now()
  return { crumb, cookies: cookieStr }
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS })
  }

  const url = new URL(req.url)
  const symbol = url.searchParams.get('symbol')
  const date = url.searchParams.get('date')
  const type = url.searchParams.get('type')

  if (!symbol) return jsonResponse({ error: 'Missing symbol' }, 400)
  if (!/^[A-Za-z0-9.\-]+$/.test(symbol)) return jsonResponse({ error: 'Invalid symbol' }, 400)

  const isEarnings = type === 'earnings'

  // Check response cache
  const cacheKey = `${symbol}:${isEarnings ? 'earnings' : date || 'default'}`
  const cached = responseCache.get(cacheKey)
  if (cached && Date.now() - cached.time < RESPONSE_TTL) {
    return rawResponse(cached.data, 200, {
      'X-Cache': 'HIT',
      'Cache-Control': 's-maxage=180, stale-while-revalidate=600',
    })
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (attempt > 0) {
        cachedCrumb = null
        await sleep(attempt * 3000)
      }

      const { crumb, cookies } = await getCrumb()
      const dataHost = attempt % 2 === 0 ? 'query2.finance.yahoo.com' : 'query1.finance.yahoo.com'
      let yahooUrl
      if (isEarnings) {
        yahooUrl = `https://${dataHost}/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=calendarEvents&crumb=${encodeURIComponent(crumb)}`
      } else {
        yahooUrl = `https://${dataHost}/v7/finance/options/${encodeURIComponent(symbol)}?crumb=${encodeURIComponent(crumb)}`
        if (date) yahooUrl += `&date=${date}`
      }

      const yahooRes = await fetch(yahooUrl, {
        headers: { 'User-Agent': UA, 'Cookie': cookies },
      })

      if (yahooRes.status === 429) {
        if (attempt < 2) {
          await sleep(2000 * (attempt + 1))
          continue
        }
        return jsonResponse({ error: 'Yahoo rate limited. Try again in 30s.', retryAfter: 30 }, 429)
      }

      if (yahooRes.status === 401 || yahooRes.status === 403) {
        cachedCrumb = null
        if (attempt < 2) continue
        return jsonResponse({ error: 'Yahoo auth failed after retries' }, 502)
      }

      if (!yahooRes.ok) {
        const errText = await yahooRes.text()
        return jsonResponse({ error: `Yahoo ${yahooRes.status}`, detail: errText.slice(0, 200) }, yahooRes.status)
      }

      const data = await yahooRes.text()

      // Cache the response
      responseCache.set(cacheKey, { data, time: Date.now() })

      // Evict old entries
      for (const [k, v] of responseCache) {
        if (Date.now() - v.time > RESPONSE_TTL * 2) responseCache.delete(k)
      }

      return rawResponse(data, 200, {
        'X-Cache': 'MISS',
        'Cache-Control': 's-maxage=180, stale-while-revalidate=600',
      })
    } catch (error) {
      if (attempt === 2) return jsonResponse({ error: error.message }, 502)
      cachedCrumb = null
    }
  }
}
