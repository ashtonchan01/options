import { fetchYahooQuoteSummary } from '../yahooCrumb.js'
import { parseYahooQuoteSummary } from './parseYahooQuoteSummary.js'

function proxyBase() {
  if (process.env.ANALYST_YAHOO_PROXY_URL) return process.env.ANALYST_YAHOO_PROXY_URL.replace(/\/$/, '')
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  return 'https://options-jade.vercel.app'
}

async function fetchYahooAnalystViaEdge(symbol) {
  const url = `${proxyBase()}/api/yahoo?type=analyst-targets&symbol=${encodeURIComponent(symbol)}`
  const res = await fetch(url, { signal: AbortSignal.timeout(25000) })
  if (!res.ok) return null
  const json = await res.json()
  if (json?.summary !== undefined && json?.rows !== undefined) return json
  if (json?.quoteSummary) return parseYahooQuoteSummary(json)
  return null
}

export async function fetchYahooAnalystTargets(symbol, crumbState) {
  const viaEdge = await fetchYahooAnalystViaEdge(symbol)
  if (viaEdge && ((viaEdge.rows?.length ?? 0) > 0 || viaEdge.summary)) return viaEdge

  try {
    const json = await fetchYahooQuoteSummary(
      symbol,
      ['financialData', 'upgradeDowngradeHistory'],
      crumbState,
    )
    return parseYahooQuoteSummary(json)
  } catch {
    return viaEdge ?? { summary: null, rows: [] }
  }
}