/** Yahoo Finance crumb + consent cookies for quoteSummary and chart APIs. */
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
const HOSTS = ['query2.finance.yahoo.com', 'query1.finance.yahoo.com']

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export async function fetchYahooCrumb() {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(2000 * attempt)

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

    const host = HOSTS[attempt % HOSTS.length]
    const crumbRes = await fetch(`https://${host}/v1/test/getcrumb`, {
      headers: { 'User-Agent': UA, Cookie: cookieStr },
    })

    if (crumbRes.status === 429) continue
    if (!crumbRes.ok) continue

    const crumb = (await crumbRes.text()).trim()
    if (!crumb || crumb.startsWith('{') || crumb.startsWith('<') || crumb.length > 40) continue

    return { crumb, cookies: cookieStr, host }
  }
  throw new Error('Yahoo crumb fetch failed')
}

export async function fetchYahooQuoteSummary(symbol, modules, crumbState) {
  let { crumb, cookies, host } = crumbState ?? {}
  if (!crumb) {
    const fresh = await fetchYahooCrumb()
    crumb = fresh.crumb
    cookies = fresh.cookies
    host = fresh.host
    if (crumbState) {
      crumbState.crumb = crumb
      crumbState.cookies = cookies
      crumbState.host = host
    }
  }

  const mod = encodeURIComponent(modules.join(','))
  const url = `https://${host}/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${mod}&crumb=${encodeURIComponent(crumb)}`

  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Cookie: cookies },
  })

  if (res.status === 401 || res.status === 403) {
    const fresh = await fetchYahooCrumb()
    if (crumbState) Object.assign(crumbState, fresh)
    const retryUrl = `https://${fresh.host}/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${mod}&crumb=${encodeURIComponent(fresh.crumb)}`
    const retry = await fetch(retryUrl, {
      headers: { 'User-Agent': UA, Cookie: fresh.cookies },
    })
    if (!retry.ok) throw new Error(`Yahoo quoteSummary ${retry.status}`)
    return retry.json()
  }

  if (!res.ok) throw new Error(`Yahoo quoteSummary ${res.status}`)
  return res.json()
}

export { UA }