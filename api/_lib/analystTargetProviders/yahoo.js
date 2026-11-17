import { fetchYahooQuoteSummary } from '../yahooCrumb.js'
import { parseYahooQuoteSummary } from './parseYahooQuoteSummary.js'
import { mergeLiveAnalystPayloads } from './mergeAnalystLive.js'

function proxyBases() {
  const bases = [
    process.env.ANALYST_YAHOO_PROXY_URL?.replace(/\/$/, ''),
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null,
    process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : null,
    'https://options-jade.vercel.app',
  ].filter(Boolean)
  return [...new Set(bases)]
}

async function fetchYahooAnalystViaEdge(symbol) {
  for (const base of proxyBases()) {
    const url = `${base}/api/yahoo?type=analyst-targets&symbol=${encodeURIComponent(symbol)}`
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(25000) })
      if (!res.ok) continue
      const json = await res.json()
      if (json?.error) continue
      if (json?.summary !== undefined && json?.rows !== undefined) return json
      if (json?.quoteSummary) return parseYahooQuoteSummary(json)
    } catch {
      /* try next base */
    }
  }
  return null
}

/** Yahoo quoteSummary via edge proxy and Node crumb; rows merged and deduped. */
export async function fetchYahooAnalystTargets(symbol, crumbState) {
  const viaEdge = await fetchYahooAnalystViaEdge(symbol)

  let fromNode = null
  try {
    const json = await fetchYahooQuoteSummary(
      symbol,
      ['financialData', 'upgradeDowngradeHistory'],
      crumbState,
    )
    fromNode = parseYahooQuoteSummary(json)
  } catch {
    fromNode = null
  }

  return mergeLiveAnalystPayloads([viaEdge, fromNode])
}