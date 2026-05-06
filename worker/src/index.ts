/**
 * wheel-proxy — Cloudflare Worker (CORS proxy only)
 * Token and Query ID are passed from the browser — no secrets needed.
 */

const IBKR_SEND = 'https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService/SendRequest'
const IBKR_GET  = 'https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService/GetStatement'

const MAX_POLLS  = 6
const POLL_DELAY = 8_000

function cors(req: Request): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': req.headers.get('Origin') ?? '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  }
}

function json(body: unknown, status = 200, c: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...c } })
}

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

export default {
  async fetch(request: Request): Promise<Response> {
    const c   = cors(request)
    const url = new URL(request.url)

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: c })

    if (url.pathname === '/ping') return json({ ok: true }, 200, c)

    if (url.pathname === '/flex/sync') {
      const token   = url.searchParams.get('token')
      const queryId = url.searchParams.get('query')

      if (!token || !queryId) return json({ error: 'Missing token or query params' }, 400, c)

      // Step 1: SendRequest
      let referenceCode: string
      try {
        const res = await fetch(`${IBKR_SEND}?t=${token}&q=${queryId}&v=3`)
        const xml = await res.text()
        const ref = xml.match(/ReferenceCode="([^"]+)"/)?.[1]
        if (!ref) {
          const msg = xml.match(/ErrorMessage="([^"]+)"/)?.[1] ?? 'No ReferenceCode'
          return json({ error: `IBKR: ${msg}`, raw: xml }, 502, c)
        }
        referenceCode = ref
      } catch (e: any) {
        return json({ error: e.message }, 502, c)
      }

      // Step 2: Poll
      for (let i = 0; i < MAX_POLLS; i++) {
        if (i > 0) await sleep(POLL_DELAY)
        try {
          const res    = await fetch(`${IBKR_GET}?t=${token}&q=${referenceCode}&v=3`)
          const xml    = await res.text()
          const status = xml.match(/Status="([^"]+)"/)?.[1]
          const code   = xml.match(/ErrorCode="([^"]+)"/)?.[1]

          if (status === 'Success') {
            return new Response(xml, { headers: { 'Content-Type': 'application/xml', ...c } })
          }
          if (code !== '1019' && code !== '1021') {
            const msg = xml.match(/ErrorMessage="([^"]+)"/)?.[1] ?? `Error ${code}`
            return json({ error: `IBKR ${code}: ${msg}` }, 502, c)
          }
        } catch (e: any) {
          return json({ error: e.message }, 502, c)
        }
      }
      return json({ error: 'Timed out — statement not ready' }, 504, c)
    }

    return json({ error: 'Not found' }, 404, c)
  },
}
