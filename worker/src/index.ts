/**
 * wheel-proxy — Cloudflare Worker
 * Proxies IBKR Flex Web Service requests with CORS headers.
 * FLEX_TOKEN and FLEX_QUERY_ID are stored as Worker secrets (never in client code).
 */

interface Env {
  FLEX_TOKEN: string
  FLEX_QUERY_ID: string
}

const IBKR_SEND = 'https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService/SendRequest'
const IBKR_GET  = 'https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService/GetStatement'

const MAX_POLLS  = 6
const POLL_DELAY = 8_000  // ms between polls

function cors(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '*'
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  }
}

function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extra },
  })
}

function xmlResponse(text: string, extra: Record<string, string> = {}) {
  return new Response(text, {
    status: 200,
    headers: { 'Content-Type': 'application/xml', ...extra },
  })
}

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms))
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const c = cors(request)

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: c })
    }

    const url  = new URL(request.url)
    const path = url.pathname

    // ── /ping — health check ─────────────────────────────────────────────────
    if (path === '/ping') {
      const hasToken   = !!env.FLEX_TOKEN
      const hasQueryId = !!env.FLEX_QUERY_ID
      return json({ ok: true, configured: hasToken && hasQueryId, hasToken, hasQueryId }, 200, c)
    }

    // ── /flex/sync — full two-step Flex sync, returns XML ───────────────────
    if (path === '/flex/sync') {
      if (!env.FLEX_TOKEN || !env.FLEX_QUERY_ID) {
        return json({ error: 'Worker secrets FLEX_TOKEN / FLEX_QUERY_ID not set' }, 500, c)
      }

      // Step 1: SendRequest
      let referenceCode: string
      try {
        const sendUrl = `${IBKR_SEND}?t=${env.FLEX_TOKEN}&q=${env.FLEX_QUERY_ID}&v=3`
        const sendRes = await fetch(sendUrl)
        const sendXml = await sendRes.text()

        const refMatch = sendXml.match(/ReferenceCode="([^"]+)"/)
        referenceCode = refMatch?.[1] ?? ''

        if (!referenceCode) {
          // Surface IBKR's error message if present
          const errMsg = sendXml.match(/ErrorMessage="([^"]+)"/)?.[1] ?? 'No ReferenceCode in response'
          return json({ error: `IBKR SendRequest failed: ${errMsg}`, raw: sendXml }, 502, c)
        }
      } catch (e: any) {
        return json({ error: `SendRequest network error: ${e.message}` }, 502, c)
      }

      // Step 2: Poll GetStatement
      for (let i = 0; i < MAX_POLLS; i++) {
        if (i > 0) await sleep(POLL_DELAY)

        try {
          const getUrl = `${IBKR_GET}?t=${env.FLEX_TOKEN}&q=${referenceCode}&v=3`
          const getRes = await fetch(getUrl)
          const getXml = await getRes.text()

          const status  = getXml.match(/Status="([^"]+)"/)?.[1]
          const errCode = getXml.match(/ErrorCode="([^"]+)"/)?.[1]

          if (status === 'Success') {
            return xmlResponse(getXml, c)
          }

          // 1019 = statement not ready yet, 1021 = request still processing — keep polling
          if (errCode !== '1019' && errCode !== '1021') {
            const errMsg = getXml.match(/ErrorMessage="([^"]+)"/)?.[1] ?? `Error ${errCode}`
            return json({ error: `IBKR error ${errCode}: ${errMsg}`, raw: getXml }, 502, c)
          }
        } catch (e: any) {
          return json({ error: `GetStatement network error: ${e.message}` }, 502, c)
        }
      }

      return json({ error: 'IBKR Flex API timed out — statement not ready after retries' }, 504, c)
    }

    return json({ error: 'Not found' }, 404, c)
  },
}
