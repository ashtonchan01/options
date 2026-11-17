/**
 * Nasdaq public analyst consensus API (no API key).
 * Used when Yahoo quoteSummary is unreachable from Vercel serverless / edge.
 *
 * Endpoint: https://api.nasdaq.com/api/analyst/{symbol}/targetprice
 * Returns consensus high/low/median and buy/hold/sell counts (not per-firm rows).
 */
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

function num(raw) {
  const n = typeof raw === 'number' ? raw : Number(raw)
  return Number.isFinite(n) ? n : null
}

export async function fetchNasdaqAnalystTargets(symbol) {
  const sym = String(symbol).replace(/^\^/, '').toUpperCase()
  if (!sym) return null

  const url = `https://api.nasdaq.com/api/analyst/${encodeURIComponent(sym)}/targetprice`
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) return null
    const json = await res.json()
    const c = json?.data?.consensusOverview
    if (!c) return null

    const buy = num(c.buy) ?? 0
    const hold = num(c.hold) ?? 0
    const sell = num(c.sell) ?? 0
    const countTotal = buy + hold + sell

    return {
      summary: {
        median: num(c.priceTarget),
        high: num(c.highPriceTarget),
        low: num(c.lowPriceTarget),
        count: countTotal > 0 ? countTotal : null,
      },
      rows: [],
    }
  } catch {
    return null
  }
}