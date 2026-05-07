const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

async function getCrumb() {
  // Step 1: hit fc.yahoo.com to get consent cookies
  const fcRes = await fetch('https://fc.yahoo.com', {
    headers: { 'User-Agent': UA },
    redirect: 'manual',
  })
  const rawCookies = typeof fcRes.headers.getSetCookie === 'function'
    ? fcRes.headers.getSetCookie()
    : [fcRes.headers.get('set-cookie') ?? '']
  const cookieStr = rawCookies.map(c => c.split(';')[0]).filter(Boolean).join('; ')

  // Step 2: get crumb using cookies
  const crumbRes = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
    headers: { 'User-Agent': UA, 'Cookie': cookieStr },
  })
  const crumb = await crumbRes.text()
  if (!crumb || crumb.includes('<') || crumb.length > 40) {
    throw new Error(`Crumb fetch failed: ${crumb.slice(0, 60)}`)
  }
  return { crumb: crumb.trim(), cookies: cookieStr }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(204).end()

  const { symbol, date } = req.query
  if (!symbol) return res.status(400).json({ error: 'Missing symbol' })

  try {
    const { crumb, cookies } = await getCrumb()

    let url = `https://query2.finance.yahoo.com/v7/finance/options/${encodeURIComponent(symbol)}?crumb=${encodeURIComponent(crumb)}`
    if (date) url += `&date=${date}`

    const dataRes = await fetch(url, {
      headers: { 'User-Agent': UA, 'Cookie': cookies },
    })

    if (!dataRes.ok) {
      const errText = await dataRes.text()
      return res.status(dataRes.status).json({
        error: `Yahoo ${dataRes.status}`,
        detail: errText.slice(0, 200),
      })
    }

    const text = await dataRes.text()
    res.setHeader('Content-Type', 'application/json')
    return res.status(200).send(text)
  } catch (e) {
    return res.status(502).json({ error: e.message })
  }
}
