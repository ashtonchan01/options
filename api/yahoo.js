const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

// Global in-memory cache for crumb/cookies across warm invocations
let cachedCrumb = null
let cachedCookies = null
let cacheTime = 0
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

async function getCrumb() {
  if (cachedCrumb && Date.now() - cacheTime < CACHE_TTL) {
    return { crumb: cachedCrumb, cookies: cachedCookies }
  }

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

  const { symbol, date } = req.query
  if (!symbol) return res.status(400).json({ error: 'Missing symbol' })
  if (!/^[A-Za-z0-9.\-]+$/.test(symbol)) return res.status(400).json({ error: 'Invalid symbol' })

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      if (attempt === 1) cachedCrumb = null

      const { crumb, cookies } = await getCrumb()
      let url = `https://query2.finance.yahoo.com/v7/finance/options/${encodeURIComponent(symbol)}?crumb=${encodeURIComponent(crumb)}`
      if (date) url += `&date=${date}`

      const yahooRes = await fetch(url, {
        headers: { 'User-Agent': UA, 'Cookie': cookies },
      })

      if (yahooRes.status === 401 || yahooRes.status === 403) {
        cachedCrumb = null
        if (attempt === 0) continue
        return res.status(502).json({ error: 'Yahoo auth failed after refresh' })
      }

      if (!yahooRes.ok) {
        const errText = await yahooRes.text()
        return res.status(yahooRes.status).json({ error: `Yahoo ${yahooRes.status}`, detail: errText.slice(0, 200) })
      }

      const data = await yahooRes.text()
      res.setHeader('Content-Type', 'application/json')
      res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=300')
      return res.status(200).send(data)
    } catch (error) {
      if (attempt === 1) return res.status(502).json({ error: error.message })
      cachedCrumb = null
    }
  }
}
