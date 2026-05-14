const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function fetchPrice(sym) {
  // Try v8 chart endpoint (no crumb needed)
  for (const host of ['query2.finance.yahoo.com', 'query1.finance.yahoo.com']) {
    try {
      const url = `https://${host}/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=1d`
      const r = await fetch(url, { headers: { 'User-Agent': UA } })
      if (r.status === 429) { await sleep(2000); continue }
      if (r.ok) {
        const d = await r.json()
        const price = d?.chart?.result?.[0]?.meta?.regularMarketPrice
        if (price) return price
      }
    } catch { /* try next */ }
  }
  return null
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(204).end()

  const { symbols } = req.query
  if (!symbols) return res.status(400).json({ error: 'Missing symbols param' })
  if (!/^[A-Za-z0-9.,\-]+$/.test(symbols)) return res.status(400).json({ error: 'Invalid symbols' })

  const tickers = symbols.split(',').filter(Boolean)
  const prices = {}

  for (let i = 0; i < tickers.length; i++) {
    const price = await fetchPrice(tickers[i])
    if (price) prices[tickers[i]] = price
    if (i < tickers.length - 1) await sleep(300)
  }

  res.setHeader('Cache-Control', 's-maxage=180, stale-while-revalidate=600')
  return res.status(200).json(prices)
}
