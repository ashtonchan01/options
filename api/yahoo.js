const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

// Cache crumb+cookies across warm invocations (Vercel keeps the process alive)
let cachedCrumb = null
let cachedCookies = null
let cacheTime = 0
const CACHE_TTL = 300_000 // 5 minutes

async function getCrumb() {
  // Return cached if still fresh
  if (cachedCrumb && Date.now() - cacheTime < CACHE_TTL) {
    return { crumb: cachedCrumb, cookies: cachedCookies }
  }

  // Step 1: hit fc.yahoo.com — follow redirects to collect cookies
  const fcRes = await fetch('https://fc.yahoo.com', {
    headers: { 'User-Agent': UA },
    redirect: 'follow',
  })
  // Consume body so connection closes
  await fcRes.text()

  // Extract set-cookie headers — try multiple approaches for Node compatibility
  let cookieParts = []
  if (typeof fcRes.headers.getSetCookie === 'function') {
    cookieParts = fcRes.headers.getSetCookie()
  } else {
    // Fallback: raw header (Node <18.14 or some runtimes)
    const raw = fcRes.headers.get('set-cookie') ?? ''
    cookieParts = raw.split(/,(?=\s*\w+=)/)
  }
  const cookieStr = cookieParts
    .map(c => c.split(';')[0].trim())
    .filter(c => c.includes('='))
    .join('; ')

  if (!cookieStr) {
    throw new Error('No cookies from fc.yahoo.com')
  }

  // Step 2: get crumb
  const crumbRes = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
    headers: { 'User-Agent': UA, 'Cookie': cookieStr },
  })
  const crumb = (await crumbRes.text()).trim()

  if (!crumb || crumb.startsWith('{') || crumb.startsWith('<') || crumb.length > 40) {
    throw new Error(`Bad crumb: ${crumb.slice(0, 80)}`)
  }

  // Cache for reuse
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

  const { symbol, date } = req.query
  if (!symbol) return res.status(400).json({ error: 'Missing symbol' })

  // Try up to 2 times — first with cache, then with fresh crumb
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      if (attempt === 1) {
        // Force refresh on retry
        cachedCrumb = null
      }

      const { crumb, cookies } = await getCrumb()
      let url = `https://query2.finance.yahoo.com/v7/finance/options/${encodeURIComponent(symbol)}?crumb=${encodeURIComponent(crumb)}`
      if (date) url += `&date=${date}`

      const dataRes = await fetch(url, {
        headers: { 'User-Agent': UA, 'Cookie': cookies },
      })

      if (dataRes.status === 401 || dataRes.status === 403) {
        // Crumb expired — clear cache and retry
        cachedCrumb = null
        if (attempt === 0) continue
      }

      if (!dataRes.ok) {
        const errText = await dataRes.text()
        return res.status(dataRes.status).json({
          error: `Yahoo ${dataRes.status}`,
          detail: errText.slice(0, 200),
        })
      }

      const text = await dataRes.text()
      res.setHeader('Content-Type', 'application/json')
      res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300')
      return res.status(200).send(text)
    } catch (e) {
      if (attempt === 1) {
        return res.status(502).json({ error: e.message })
      }
      // Retry with fresh crumb
      cachedCrumb = null
    }
  }
}
