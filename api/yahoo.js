const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

// Global in-memory cache for crumb/cookies across warm invocations
let cachedCrumb = null
let cachedCookies = null
let cacheTime = 0
const CACHE_TTL = 10 * 60 * 1000 // 10 minutes

// Response cache to avoid hitting Yahoo for identical requests
const responseCache = new Map()
const RESPONSE_TTL = 3 * 60 * 1000 // 3 minutes

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
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

  // Step 2: Get crumb using cookies
  const crumbRes = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
    headers: { 'User-Agent': UA, 'Cookie': cookieStr },
  })
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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(204).end()

  const { symbol, date, type } = req.query
  if (!symbol) return res.status(400).json({ error: 'Missing symbol' })
  if (!/^[A-Za-z0-9.\-]+$/.test(symbol)) return res.status(400).json({ error: 'Invalid symbol' })

  const isEarnings = type === 'earnings'

  // Check response cache
  const cacheKey = `${symbol}:${isEarnings ? 'earnings' : date || 'default'}`
  const cached = responseCache.get(cacheKey)
  if (cached && Date.now() - cached.time < RESPONSE_TTL) {
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('X-Cache', 'HIT')
    res.setHeader('Cache-Control', 's-maxage=180, stale-while-revalidate=600')
    return res.status(200).send(cached.data)
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (attempt > 0) {
        cachedCrumb = null
        await sleep(attempt * 1500) // 1.5s, 3s backoff
      }

      const { crumb, cookies } = await getCrumb()
      let url
      if (isEarnings) {
        url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=calendarEvents&crumb=${encodeURIComponent(crumb)}`
      } else {
        url = `https://query2.finance.yahoo.com/v7/finance/options/${encodeURIComponent(symbol)}?crumb=${encodeURIComponent(crumb)}`
        if (date) url += `&date=${date}`
      }

      const yahooRes = await fetch(url, {
        headers: { 'User-Agent': UA, 'Cookie': cookies },
      })

      // Rate limited — retry with backoff
      if (yahooRes.status === 429) {
        if (attempt < 2) {
          await sleep(2000 * (attempt + 1))
          continue
        }
        return res.status(429).json({ error: 'Yahoo rate limited. Try again in 30s.', retryAfter: 30 })
      }

      if (yahooRes.status === 401 || yahooRes.status === 403) {
        cachedCrumb = null
        if (attempt < 2) continue
        return res.status(502).json({ error: 'Yahoo auth failed after retries' })
      }

      if (!yahooRes.ok) {
        const errText = await yahooRes.text()
        return res.status(yahooRes.status).json({ error: `Yahoo ${yahooRes.status}`, detail: errText.slice(0, 200) })
      }

      const data = await yahooRes.text()

      // Cache the response
      responseCache.set(cacheKey, { data, time: Date.now() })

      // Evict old cache entries
      for (const [k, v] of responseCache) {
        if (Date.now() - v.time > RESPONSE_TTL * 2) responseCache.delete(k)
      }

      res.setHeader('Content-Type', 'application/json')
      res.setHeader('X-Cache', 'MISS')
      res.setHeader('Cache-Control', 's-maxage=180, stale-while-revalidate=600')
      return res.status(200).send(data)
    } catch (error) {
      if (attempt === 2) return res.status(502).json({ error: error.message })
      cachedCrumb = null
    }
  }
}
