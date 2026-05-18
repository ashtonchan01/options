/**
 * Vercel proxy for CBOE delayed options data.
 * No API key needed — proxies the public CDN endpoint.
 * Returns full chain with Greeks (delta, gamma, theta, vega, rho).
 *
 * Usage: /api/cboe?symbol=AAPL
 */

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(204).end()

  const { symbol } = req.query
  if (!symbol) return res.status(400).json({ error: 'Missing symbol' })
  if (!/^[A-Za-z0-9.\-]+$/.test(symbol)) return res.status(400).json({ error: 'Invalid symbol' })

  const url = `https://cdn.cboe.com/api/global/delayed_quotes/options/${encodeURIComponent(symbol.toUpperCase())}.json`

  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
    })

    if (!resp.ok) {
      // Some symbols use _0 suffix on CBOE (e.g. BRK/B → BRK_B)
      // Try with underscore variant
      const alt = symbol.replace(/[./]/g, '_')
      if (alt !== symbol) {
        const altUrl = `https://cdn.cboe.com/api/global/delayed_quotes/options/${encodeURIComponent(alt.toUpperCase())}.json`
        const altResp = await fetch(altUrl, {
          headers: { 'User-Agent': UA, Accept: 'application/json' },
        })
        if (altResp.ok) {
          const data = await altResp.json()
          res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=300')
          return res.status(200).json(data)
        }
      }
      return res.status(resp.status).json({ error: `CBOE returned ${resp.status}` })
    }

    const data = await resp.json()
    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=300')
    return res.status(200).json(data)
  } catch (err) {
    return res.status(502).json({ error: err.message })
  }
}
