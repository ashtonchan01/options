// Vercel serverless function — proxies IBKR Flex from AWS IPs (not blocked)
const https = require('https')

const IBKR_SEND = 'https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService/SendRequest'
const IBKR_GET  = 'https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService/GetStatement'
const MAX_POLLS  = 6
const POLL_DELAY = 8000

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let body = ''
      res.on('data', c => body += c)
      res.on('end', () => resolve({ status: res.statusCode, body }))
    }).on('error', reject)
  })
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(204).end()

  const { token, query } = req.query
  if (!token || !query) return res.status(400).json({ error: 'Missing token or query' })

  // Step 1: SendRequest
  let referenceCode
  try {
    const { body } = await get(`${IBKR_SEND}?t=${token}&q=${query}&v=3`)
    const ref = body.match(/ReferenceCode="([^"]+)"/)?.[1]
    if (!ref) {
      const msg = body.match(/ErrorMessage="([^"]+)"/)?.[1] ?? 'No ReferenceCode'
      return res.status(502).json({ error: `IBKR: ${msg}`, raw: body })
    }
    referenceCode = ref
  } catch (e) {
    return res.status(502).json({ error: e.message })
  }

  // Step 2: Poll GetStatement
  for (let i = 0; i < MAX_POLLS; i++) {
    if (i > 0) await sleep(POLL_DELAY)
    try {
      const { body } = await get(`${IBKR_GET}?t=${token}&q=${referenceCode}&v=3`)
      const status = body.match(/Status="([^"]+)"/)?.[1]
      const code   = body.match(/ErrorCode="([^"]+)"/)?.[1]

      if (status === 'Success') {
        res.setHeader('Content-Type', 'application/xml')
        return res.status(200).send(body)
      }
      if (code !== '1019' && code !== '1021') {
        const msg = body.match(/ErrorMessage="([^"]+)"/)?.[1] ?? `Error ${code}`
        return res.status(502).json({ error: `IBKR ${code}: ${msg}` })
      }
    } catch (e) {
      return res.status(502).json({ error: e.message })
    }
  }

  res.status(504).json({ error: 'Timed out — statement not ready after retries' })
}
