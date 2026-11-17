import { fetchYahooAnalystTargets } from './yahoo.js'
import { fetchFmpAnalystTargets } from './fmp.js'
import { fetchNasdaqAnalystTargets } from './nasdaq.js'
import { mergeLiveAnalystPayloads } from './mergeAnalystLive.js'

/** Default live chain: Yahoo quoteSummary (+ Nasdaq consensus) → optional FMP. */

export function resolveAnalystTargetProvider() {
  const configured = (process.env.ANALYST_TARGET_PROVIDER || '').toLowerCase()
  if (configured === 'fmp' && process.env.FMP_API_KEY) return 'fmp'
  if (configured === 'yahoo') return 'yahoo'
  if (process.env.FMP_API_KEY && configured !== 'yahoo') return 'fmp'
  return 'yahoo'
}

export async function fetchLiveAnalystTargetsForSymbol(symbol, provider, crumbState) {
  const yahoo = await fetchYahooAnalystTargets(symbol, crumbState)
  const nasdaq = await fetchNasdaqAnalystTargets(symbol)

  if (provider === 'fmp') {
    const fmp = await fetchFmpAnalystTargets(symbol)
    const merged = mergeLiveAnalystPayloads([yahoo, nasdaq, fmp])
    if (merged.summary || merged.rows?.length) return merged
    return mergeLiveAnalystPayloads([yahoo, nasdaq])
  }

  const merged = mergeLiveAnalystPayloads([yahoo, nasdaq])
  if (merged.summary || merged.rows?.length) return merged
  return { summary: null, rows: [] }
}