/**
 * RSI(14) proxy — pulls ~3 months of daily closes from Yahoo Finance
 * v8/finance/chart (same public endpoint /api/price uses) and computes
 * Wilder's RSI server-side, so the client just gets a number per symbol.
 *
 * GET /api/rsi?symbols=MSTR,TSLA,BTC-USD
 * → { "MSTR": 63.2, "TSLA": 41.8, "BTC-USD": 28.4 }
 */

export const config = { runtime: 'edge' }

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
const RSI_PERIOD = 14

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

/** Wilder's RSI — simple average to seed, then exponential smoothing over the
 * rest of the series so the result converges to the same value production
 * charting tools show, not just a naive 14-bar average. */
function computeRSI(closes) {
  if (closes.length < RSI_PERIOD + 1) return null

  let gainSum = 0, lossSum = 0
  for (let i = 1; i <= RSI_PERIOD; i++) {
    const delta = closes[i] - closes[i - 1]
    if (delta >= 0) gainSum += delta
    else lossSum -= delta
  }
  let avgGain = gainSum / RSI_PERIOD
  let avgLoss = lossSum / RSI_PERIOD

  for (let i = RSI_PERIOD + 1; i < closes.length; i++) {
    const delta = closes[i] - closes[i - 1]
    const gain = delta >= 0 ? delta : 0
    const loss = delta < 0 ? -delta : 0
    avgGain = (avgGain * (RSI_PERIOD - 1) + gain) / RSI_PERIOD
    avgLoss = (avgLoss * (RSI_PERIOD - 1) + loss) / RSI_PERIOD
  }

  if (avgLoss === 0) return 100
  const rs = avgGain / avgLoss
  return 100 - 100 / (1 + rs)
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
        const rsi = computeRSI(closes)
        return [sym, rsi === null ? null : Math.round(rsi * 10) / 10]
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
