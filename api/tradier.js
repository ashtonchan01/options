/**
 * Vercel serverless proxy for Tradier Sandbox API.
 * Keeps the API token server-side.
 *
 * Actions:
 *   ?action=expirations&symbol=AAPL
 *   ?action=chain&symbol=AAPL&expiration=2025-06-20
 *   ?action=quotes&symbols=AAPL,TSLA,NVDA
 */

const BASE = 'https://sandbox.tradier.com/v1/markets'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(204).end()

  const token = process.env.TRADIER_TOKEN
  if (!token) {
    return res.status(500).json({ error: 'TRADIER_TOKEN not configured' })
  }

  const { action, symbol, symbols, expiration } = req.query
  if (!action) return res.status(400).json({ error: 'Missing action param' })

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  }

  try {
    let url
    switch (action) {
      case 'expirations': {
        if (!symbol) return res.status(400).json({ error: 'Missing symbol' })
        url = `${BASE}/options/expirations?symbol=${encodeURIComponent(symbol)}&includeAllRoots=true`
        break
      }
      case 'chain': {
        if (!symbol) return res.status(400).json({ error: 'Missing symbol' })
        if (!expiration) return res.status(400).json({ error: 'Missing expiration' })
        url = `${BASE}/options/chains?symbol=${encodeURIComponent(symbol)}&expiration=${encodeURIComponent(expiration)}&greeks=true`
        break
      }
      case 'quotes': {
        if (!symbols) return res.status(400).json({ error: 'Missing symbols' })
        url = `${BASE}/quotes?symbols=${encodeURIComponent(symbols)}&greeks=false`
        break
      }
      default:
        return res.status(400).json({ error: `Unknown action: ${action}` })
    }

    const resp = await fetch(url, { headers })

    if (!resp.ok) {
      const text = await resp.text()
      return res.status(resp.status).json({
        error: `Tradier ${resp.status}`,
        detail: text.slice(0, 300),
      })
    }

    const data = await resp.json()

    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=300')
    return res.status(200).json(data)
  } catch (err) {
    return res.status(502).json({ error: err.message })
  }
}
