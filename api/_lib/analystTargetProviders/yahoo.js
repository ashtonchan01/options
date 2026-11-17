import { fetchYahooQuoteSummary } from '../yahooCrumb.js'
import { parseYahooQuoteSummary } from './parseYahooQuoteSummary.js'
import { fetchNasdaqAnalystTargets } from './nasdaq.js'

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

function hasLivePayload(out) {
  if (!out) return false
  if ((out.rows?.length ?? 0) > 0) return true
  const s = out.summary
  if (!s) return false
  return (
    s.median != null ||
    s.high != null ||
    s.low != null ||
    (s.count != null && s.count > 0)
  )
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

function mergeSummaries(primary, fallback) {
  if (!primary?.summary && !fallback?.summary) {
    return {
      summary: null,
      rows: [...(primary?.rows ?? []), ...(fallback?.rows ?? [])],
    }
  }
  const a = primary?.summary ?? {}
  const b = fallback?.summary ?? {}
  const rows = (primary?.rows?.length ?? 0) > 0 ? primary.rows : fallback?.rows ?? []
  return {
    summary: {
      median: a.median ?? b.median,
      high: a.high ?? b.high,
      low: a.low ?? b.low,
      count: a.count ?? b.count,
    },
    rows: rows ?? [],
  }
}

export async function fetchYahooAnalystTargets(symbol, crumbState) {
  const viaEdge = await fetchYahooAnalystViaEdge(symbol)
  if (hasLivePayload(viaEdge)) return viaEdge

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
  if (hasLivePayload(fromNode)) return fromNode

  const nasdaq = await fetchNasdaqAnalystTargets(symbol)
  if (hasLivePayload(nasdaq)) {
    const best =
      (viaEdge?.rows?.length ?? 0) > (fromNode?.rows?.length ?? 0) ? viaEdge : fromNode
    return mergeSummaries(best, nasdaq)
  }

  return viaEdge ?? fromNode ?? { summary: null, rows: [] }
}