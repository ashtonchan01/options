const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

let cachedCrumb = null
let cachedCookies = null
let cacheTime = 0
const CACHE_TTL = 10 * 60 * 1000

const earningsCache = new Map()
const EARNINGS_TTL = 6 * 60 * 60 * 1000

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

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

async function fetchOne(symbol, crumb, cookies) {
  const cached = earningsCache.get(symbol)
  if (cached && Date.now() - cached.time < EARNINGS_TTL) return cached.data

  const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=calendarEvents&crumb=${encodeURIComponent(crumb)}`
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Cookie': cookies } })

  if (res.status === 429) return null // caller will retry
  if (!res.ok) return null

  const json = await res.json()
  const cal = json?.quoteSummary?.result?.[0]?.calendarEvents
  const dates = cal?.earnings?.earningsDate?.map(d => d.fmt).filter(Boolean) ?? []
  const result = { symbol, dates }
  earningsCache.set(symbol, { data: result, time: Date.now() })
  return result
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(204).end()

  const { symbols } = req.query
  if (!symbols) return res.status(400).json({ error: 'Missing symbols param' })

  const syms = symbols.split(',').filter(s => /^[A-Za-z0-9.\-]+$/.test(s)).slice(0, 20)
  if (syms.length === 0) return res.status(400).json({ error: 'No valid symbols' })

  // Retry loop — same pattern as yahoo.js
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (attempt > 0) {
        cachedCrumb = null          // force fresh crumb
        await sleep(attempt * 1500) // 1.5s, 3s backoff
      }

      const { crumb, cookies } = await getCrumb()

      // Fetch in small batches (5 at a time) to avoid hammering Yahoo
      const data = {}
      for (let i = 0; i < syms.length; i += 5) {
        const batch = syms.slice(i, i + 5)
        const results = await Promise.all(
          batch.map(s => fetchOne(s, crumb, cookies).catch(() => null))
        )
        for (const r of results) {
          if (r && r.dates && r.dates.length > 0) data[r.symbol] = r.dates
        }
        // Small delay between batches
        if (i + 5 < syms.length) await sleep(300)
      }

      // If we got at least some results, return them
      if (Object.keys(data).length > 0 || attempt === 2) {
        res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200')
        return res.status(200).json(data)
      }

      // No results — might be rate limited, retry
      await sleep(2000)
    } catch (err) {
      if (attempt === 2) {
        return res.status(502).json({ error: err.message })
      }
      cachedCrumb = null
    }
  }
}
