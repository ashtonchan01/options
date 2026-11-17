import { fetchYahooAnalystTargets } from './yahoo.js'
import { fetchFmpAnalystTargets } from './fmp.js'

export function resolveAnalystTargetProvider() {
  const configured = (process.env.ANALYST_TARGET_PROVIDER || '').toLowerCase()
  if (configured === 'fmp' && process.env.FMP_API_KEY) return 'fmp'
  if (configured === 'yahoo') return 'yahoo'
  if (process.env.FMP_API_KEY && configured !== 'yahoo') return 'fmp'
  return 'yahoo'
}

export async function fetchLiveAnalystTargetsForSymbol(symbol, provider, crumbState) {
  if (provider === 'fmp') {
    const out = await fetchFmpAnalystTargets(symbol)
    if (out) return out
    return fetchYahooAnalystTargets(symbol, crumbState)
  }
  return fetchYahooAnalystTargets(symbol, crumbState)
}