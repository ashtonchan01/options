/**
 * Quote proxy for the Portfolio Allocation page — price + 52-week high per
 * symbol, pulled from the same Yahoo v8/finance/chart meta object /api/price
 * uses (just reading two more fields off it instead of one).
 *
 * GET /api/quote?symbols=TSLA,MSTR
 * → { "TSLA": { "price": 332.81, "high52": 488.54 }, ... }
 */

export const config = { runtime: 'edge' }

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
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
    .filter(s => /^[A-Za-z0-9.\-=^]{1,10}$/.test(s))
    .slice(0, 25)

  if (symbols.length === 0) {
    return new Response(JSON.stringify({ error: 'No valid symbols' }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  // Two attempts per symbol: `range=1d` is usually enough (meta is populated
  // regardless of range for most tickers), but some lower-volume instruments
  // — commodity ETFs like CPER among them — occasionally come back with an
  // empty/incomplete meta object on a 1-day window specifically. A `range=5d`
  // retry only on that failure avoids doubling every request while still
  // recovering the ones that need a wider window.
  async function fetchChart(sym, range) {
    const r = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=${range}&interval=1d&includePrePost=false`,
      { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(6000) },
    )
    if (!r.ok) return null
    return await r.json()
  }
  async function fetchMeta(sym, range) {
    const json = await fetchChart(sym, range)
    return json?.chart?.result?.[0]?.meta ?? null
  }

  // Some tickers — commodity ETFs like CPER among them — have a working
  // regularMarketPrice but a genuinely empty fiftyTwoWeekHigh/Low in Yahoo's
  // meta object (not a timing/range issue like the price retry above, just
  // absent for that instrument type). A full year of daily closes gives a
  // real 52w range to fall back to instead of leaving the ticker stuck with
  // no high52 forever — which silently disqualifies it from every discount/
  // premium-based signal in the app (mean-reversion buy/sell ranking chief
  // among them), even though it has a perfectly good live price.
  async function fetch52wFromHistory(sym) {
    const json = await fetchChart(sym, '1y')
    const closes = json?.chart?.result?.[0]?.indicators?.quote?.[0]?.close
    if (!Array.isArray(closes)) return { high52: null, low52: null }
    const valid = closes.filter(c => typeof c === 'number' && c > 0)
    if (valid.length === 0) return { high52: null, low52: null }
    return { high52: Math.max(...valid), low52: Math.min(...valid) }
  }

  const sleep = ms => new Promise(r => setTimeout(r, ms))

  async function attemptQuote(sym) {
    let meta = await fetchMeta(sym, '1d')
    if (typeof meta?.regularMarketPrice !== 'number' || meta.regularMarketPrice <= 0) {
      meta = await fetchMeta(sym, '5d')
    }
    const price = meta?.regularMarketPrice
    let high52 = meta?.fiftyTwoWeekHigh
    let low52 = meta?.fiftyTwoWeekLow
    const prevClose = meta?.chartPreviousClose ?? meta?.previousClose
    const volume = meta?.regularMarketVolume
    const avgVolume = meta?.averageDailyVolume10Day ?? meta?.averageDailyVolume3Month
    if (typeof price !== 'number' || price <= 0) return null
    if (typeof high52 !== 'number' || high52 <= 0) {
      const fallback = await fetch52wFromHistory(sym)
      high52 = fallback.high52
      if (typeof low52 !== 'number' || low52 <= 0) low52 = fallback.low52
    }
    return {
      price,
      high52: typeof high52 === 'number' && high52 > 0 ? high52 : null,
      low52: typeof low52 === 'number' && low52 > 0 ? low52 : null,
      prevClose: typeof prevClose === 'number' && prevClose > 0 ? prevClose : null,
      volume: typeof volume === 'number' ? volume : null,
      avgVolume: typeof avgVolume === 'number' ? avgVolume : null,
    }
  }

  async function attemptWithRetry(sym) {
    try {
      const first = await attemptQuote(sym)
      if (first) return [sym, first]
      await sleep(250)
      return [sym, await attemptQuote(sym)]
    } catch {
      try {
        await sleep(250)
        return [sym, await attemptQuote(sym)]
      } catch {
        return [sym, null]
      }
    }
  }

  // Chunked, not one big Promise.all over every symbol — a full watchlist
  // (25-30 tickers) firing all at once was intermittently rate-limited by
  // Yahoo even for perfectly valid, heavily-traded tickers (verified: TSLA/
  // TSM/VIX came back empty in a 30-symbol batch, fine alone, and the retry
  // above alone wasn't enough to recover them since the whole batch was
  // still contending at once). Small concurrent chunks with a short pause
  // between them keeps well under whatever's triggering the rate limit.
  const CHUNK_SIZE = 6
  const results = []
  for (let i = 0; i < symbols.length; i += CHUNK_SIZE) {
    const chunk = symbols.slice(i, i + CHUNK_SIZE)
    const chunkResults = await Promise.all(chunk.map(attemptWithRetry))
    results.push(...chunkResults)
    if (i + CHUNK_SIZE < symbols.length) await sleep(150)
  }

  const body = Object.fromEntries(results.filter(([, v]) => v !== null))
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' },
  })
}
