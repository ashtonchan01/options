/**
 * Edge Function to fetch Yahoo Finance crumb.
 * Runs on Cloudflare's edge network (different IPs from serverless),
 * which helps avoid datacenter-specific rate limits on Yahoo's crumb endpoint.
 */

export const config = { runtime: 'edge' }

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

export default async function handler(req) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 's-maxage=1200, stale-while-revalidate=3600',
  }

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers })
  }

  const HOSTS = ['query2.finance.yahoo.com', 'query1.finance.yahoo.com']

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (attempt > 0) await sleep(2000 * attempt)

      // Step 1: Get cookies
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

      if (!cookieStr) continue

      // Step 2: Get crumb (alternate hosts)
      const host = HOSTS[attempt % HOSTS.length]
      const crumbRes = await fetch(`https://${host}/v1/test/getcrumb`, {
        headers: { 'User-Agent': UA, 'Cookie': cookieStr },
      })

      if (crumbRes.status === 429) {
        if (attempt < 2) continue
        return new Response(
          JSON.stringify({ error: 'Yahoo crumb rate limited' }),
          { status: 429, headers: { ...headers, 'Content-Type': 'application/json' } }
        )
      }

      if (!crumbRes.ok) continue

      const crumb = (await crumbRes.text()).trim()
      if (!crumb || crumb.startsWith('{') || crumb.startsWith('<') || crumb.length > 40) continue

      return new Response(
        JSON.stringify({ crumb, cookies: cookieStr }),
        { status: 200, headers: { ...headers, 'Content-Type': 'application/json' } }
      )
    } catch {
      if (attempt === 2) {
        return new Response(
          JSON.stringify({ error: 'Failed to fetch crumb' }),
          { status: 502, headers: { ...headers, 'Content-Type': 'application/json' } }
        )
      }
    }
  }

  return new Response(
    JSON.stringify({ error: 'Failed after retries' }),
    { status: 502, headers: { ...headers, 'Content-Type': 'application/json' } }
  )
}
