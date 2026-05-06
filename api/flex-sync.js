const IBKR_SEND = 'https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService/SendRequest'
const IBKR_GET  = 'https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService/GetStatement'
const MAX_POLLS  = 6
const POLL_DELAY = 8000

const sleep = ms => new Promise(r => setTimeout(r, ms))

// IBKR SendRequest returns element-style XML: <Status>...</Status> <ReferenceCode>...</ReferenceCode>
// IBKR GetStatement returns the full FlexQueryResponse XML when ready (no Status element)
const el = (body, tag) => body.match(new RegExp(`<${tag}>([^<]+)<\\/${tag}>`))?.[1]

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(204).end()

  const { token, query } = req.query
  if (!token || !query) return res.status(400).json({ error: 'Missing token or query' })

  // Step 1: SendRequest → get ReferenceCode
  let referenceCode
  try {
    const r    = await fetch(`${IBKR_SEND}?t=${token}&q=${query}&v=3`)
    const body = await r.text()
    const ref  = el(body, 'ReferenceCode')
    if (!ref) {
      const msg = el(body, 'ErrorMessage') ?? el(body, 'ErrorCode') ?? body.slice(0, 120)
      return res.status(502).json({ error: `IBKR: ${msg}`, raw: body })
    }
    referenceCode = ref
  } catch (e) {
    return res.status(502).json({ error: e.message })
  }

  // Step 2: Poll GetStatement — success when body is FlexQueryResponse (no Status element)
  for (let i = 0; i < MAX_POLLS; i++) {
    if (i > 0) await sleep(POLL_DELAY)
    try {
      const r    = await fetch(`${IBKR_GET}?t=${token}&q=${referenceCode}&v=3`)
      const body = await r.text()

      // Ready: actual report XML starts with FlexQueryResponse
      if (body.includes('<FlexQueryResponse')) {
        res.setHeader('Content-Type', 'application/xml')
        return res.status(200).send(body)
      }

      const code = el(body, 'ErrorCode')
      if (code !== '1019' && code !== '1021') {
        const msg = el(body, 'ErrorMessage') ?? `Error ${code ?? 'unknown'}`
        return res.status(502).json({ error: `IBKR ${code}: ${msg}`, raw: body })
      }
      // 1019 = statement generating, 1021 = try again — keep polling
    } catch (e) {
      return res.status(502).json({ error: e.message })
    }
  }

  res.status(504).json({ error: 'Timed out — statement not ready after retries' })
}
