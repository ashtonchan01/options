/**
 * RSI(14) proxy — pulls ~3 months of daily closes from Yahoo Finance
 * v8/finance/chart (same public endpoint /api/price uses) and computes
 * Wilder's RSI server-side, so the client just gets a number (plus a short
 * rolling history for a sparkline) per symbol.
 *
 * GET /api/rsi?symbols=MSTR,TSLA,BTC-USD
 * → { "MSTR": { "rsi": 63.2, "series": [58.1, 60.4, ..., 63.2] }, ... }
 */

export const config = { runtime: 'edge' }

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
const RSI_PERIOD = 14

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

const SERIES_POINTS = 30

/** Wilder's RSI — simple average to seed, then exponential smoothing over the
 * rest of the series so the result converges to the same value production
 * charting tools show, not just a naive 14-bar average. Returns the full
 * rolling RSI series (one value per close once enough history exists), not
 * just the final number, so the caller can both report the current RSI and
 * chart its recent trend. */
function computeRSISeries(closes) {
  if (closes.length < RSI_PERIOD + 1) return []

  let gainSum = 0, lossSum = 0
  for (let i = 1; i <= RSI_PERIOD; i++) {
    const delta = closes[i] - closes[i - 1]
    if (delta >= 0) gainSum += delta
    else lossSum -= delta
  }
  let avgGain = gainSum / RSI_PERIOD
  let avgLoss = lossSum / RSI_PERIOD

  const series = [avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)]

  for (let i = RSI_PERIOD + 1; i < closes.length; i++) {
    const delta = closes[i] - closes[i - 1]
    const gain = delta >= 0 ? delta : 0
    const loss = delta < 0 ? -delta : 0
    avgGain = (avgGain * (RSI_PERIOD - 1) + gain) / RSI_PERIOD
    avgLoss = (avgLoss * (RSI_PERIOD - 1) + loss) / RSI_PERIOD
    series.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss))
  }

  return series
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

  const url = new URL(req.url)
  const symbolsParam = url.searchParams.get('symbols')
  if (!symbolsParam) {
    return new Response(JSON.stringify({ error: 'Missing symbols' }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  const symbols = symbolsParam
    .split(',')
    .map(s => s.trim().toUpperCase())
    .filter(s => /^[A-Za-z0-9.\-]{1,10}$/.test(s))
    .slice(0, 25)

  if (symbols.length === 0) {
    return new Response(JSON.stringify({ error: 'No valid symbols' }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  const results = await Promise.all(
    symbols.map(async sym => {
      try {
        const r = await fetch(
          `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=3mo&interval=1d&includePrePost=false`,
          { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) },
        )
        if (!r.ok) return [sym, null]
        const json = await r.json()
        const result = json?.chart?.result?.[0]
        const closesRaw = result?.indicators?.quote?.[0]?.close
        if (!Array.isArray(closesRaw)) return [sym, null]
        const closes = closesRaw.filter(c => typeof c === 'number')
        const series = computeRSISeries(closes)
        if (series.length === 0) return [sym, null]
        const rounded = series.map(v => Math.round(v * 10) / 10)
        return [sym, { rsi: rounded[rounded.length - 1], series: rounded.slice(-SERIES_POINTS) }]
      } catch {
        return [sym, null]
      }
    })
  )

  const body = Object.fromEntries(results.filter(([, v]) => v !== null))
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
  })
}
