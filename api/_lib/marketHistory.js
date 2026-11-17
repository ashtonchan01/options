/**
 * Daily SPX + VIX assembly.
 *
 * Cboe's public SPX file is close-only (DATE, SPX) back to 1975.
 * Open/high/low come from Yahoo ^GSPC. The close stays the Cboe print when
 * it sits inside that day's Yahoo range. VIX OHLC is Cboe's file from 1990;
 * Yahoo ^VIX fills sessions Cboe has not published yet.
 *
 * No schedule. Callers ask for rows strictly after a date.
 */

export const CBOE_SPX_URL = 'https://cdn.cboe.com/api/global/us_indices/daily_prices/SPX_History.csv'
export const CBOE_VIX_URL = 'https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv'
export const YAHOO_CHART = 'https://query1.finance.yahoo.com/v8/finance/chart/'

const UA = 'Mozilla/5.0 (compatible; options-backtest/1.0)'
const SERIES_START = '1990-01-02'

function r2(n) {
  return Math.round(n * 100) / 100
}

export function mdyToIso(s) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(s).trim())
  if (!m) return null
  return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
}

export function parseCboeSpx(text) {
  const map = new Map()
  for (const line of String(text).trim().split(/\r?\n/).slice(1)) {
    const [date, px] = line.split(',')
    const iso = mdyToIso(date ?? '')
    const n = Number(px)
    if (iso && n > 0) map.set(iso, n)
  }
  return map
}

export function parseCboeVix(text) {
  const map = new Map()
  for (const line of String(text).trim().split(/\r?\n/).slice(1)) {
    const [date, open, high, low, close] = line.split(',')
    const iso = mdyToIso(date ?? '')
    const c = Number(close)
    if (!iso || !(c > 0)) continue
    map.set(iso, {
      o: Number(open) > 0 ? Number(open) : c,
      h: Number(high) > 0 ? Number(high) : c,
      l: Number(low) > 0 ? Number(low) : c,
      c,
    })
  }
  return map
}

export function isoFromUnix(sec) {
  return new Date(sec * 1000).toISOString().slice(0, 10)
}

/** Yahoo v8 chart JSON → date → OHLC. Timestamps are the cash-session morning UTC. */
export function parseYahooChart(json) {
  const map = new Map()
  const result = json?.chart?.result?.[0]
  const ts = result?.timestamp
  const q = result?.indicators?.quote?.[0]
  if (!Array.isArray(ts) || !q) return map
  for (let i = 0; i < ts.length; i++) {
    const o = q.open?.[i]
    const h = q.high?.[i]
    const l = q.low?.[i]
    const c = q.close?.[i]
    if (!(o > 0) || !(h > 0) || !(l > 0) || !(c > 0)) continue
    map.set(isoFromUnix(ts[i]), { o, h, l, c })
  }
  return map
}

export function mergeMaps(primary, fallback) {
  const out = new Map(primary)
  for (const [k, v] of fallback) if (!out.has(k)) out.set(k, v)
  return out
}

/**
 * One row: [date, spxO, spxH, spxL, spxC, vixO, vixH, vixL, vixC].
 * Dates before 1990 are dropped — that is the first VIX session.
 */
export function joinDaily({ cboeSpx, yahooSpx, vix }) {
  const bars = []
  let closeOnly = 0
  let keptYahoo = 0
  for (const date of [...vix.keys()].sort()) {
    if (date < SERIES_START) continue
    const v = vix.get(date)
    if (!v || !(v.c > 0)) continue
    const y = yahooSpx.get(date)
    const cboe = cboeSpx.get(date)
    let o
    let h
    let l
    let c
    if (y && y.o > 0 && y.h > 0 && y.l > 0 && y.c > 0) {
      o = y.o
      h = y.h
      l = y.l
      c = y.c
      if (typeof cboe === 'number' && cboe > 0) {
        if (cboe <= h + 0.5 && cboe >= l - 0.5) {
          c = cboe
          if (c > h) h = c
          if (c < l) l = c
        } else {
          keptYahoo += 1
        }
      }
    } else if (typeof cboe === 'number' && cboe > 0) {
      o = h = l = c = cboe
      closeOnly += 1
    } else {
      continue
    }
    bars.push([date, r2(o), r2(h), r2(l), r2(c), r2(v.o), r2(v.h), r2(v.l), r2(v.c)])
  }
  return { bars, closeOnly, keptYahoo }
}

export function selectNewBars(bars, since) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) throw new Error('since must be YYYY-MM-DD')
  return bars.filter(bar => bar[0] > since)
}

export async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/csv' }, signal: AbortSignal.timeout(25000) })
  if (!res.ok) throw new Error(`${url} returned ${res.status}`)
  return res.text()
}

export async function fetchYahoo(symbol, period1, period2) {
  const url = `${YAHOO_CHART}${encodeURIComponent(symbol)}?interval=1d&period1=${period1}&period2=${period2}&events=history&includeAdjustedClose=false`
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(25000) })
  if (!res.ok) throw new Error(`Yahoo ${symbol} returned ${res.status}`)
  return parseYahooChart(await res.json())
}

export async function fetchMissingBars(since) {
  const period1 = Math.floor(Date.parse(`${since}T00:00:00Z`) / 1000) - 12 * 86400
  const period2 = Math.floor(Date.now() / 1000) + 2 * 86400
  const [spxCsv, vixCsv, yahooSpx, yahooVix] = await Promise.all([
    fetchText(CBOE_SPX_URL).catch(() => ''),
    fetchText(CBOE_VIX_URL).catch(() => ''),
    fetchYahoo('^GSPC', period1, period2).catch(() => new Map()),
    fetchYahoo('^VIX', period1, period2).catch(() => new Map()),
  ])
  const cboeSpx = spxCsv ? parseCboeSpx(spxCsv) : new Map()
  const cboeVix = vixCsv ? parseCboeVix(vixCsv) : new Map()
  if (cboeSpx.size === 0 && yahooSpx.size === 0) throw new Error('SPX history was unavailable from Cboe and Yahoo')
  if (cboeVix.size === 0 && yahooVix.size === 0) throw new Error('VIX history was unavailable from Cboe and Yahoo')
  const joined = joinDaily({
    cboeSpx,
    yahooSpx,
    vix: mergeMaps(cboeVix, yahooVix),
  })
  return {
    bars: selectNewBars(joined.bars, since),
    sources: {
      spxClose: cboeSpx.size ? 'cboe' : 'yahoo',
      spxOhlc: 'yahoo-^GSPC',
      vix: cboeVix.size ? 'cboe' : 'yahoo',
    },
  }
}

async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body) } catch { return {} }
  }
  const chunks = []
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  if (!chunks.length) return {}
  try { return JSON.parse(Buffer.concat(chunks).toString()) } catch { return {} }
}

async function withTable() {
  const { getSql } = await import('./db.js')
  const sql = getSql()
  await sql`
    CREATE TABLE IF NOT EXISTS market_daily_tail (
      trade_date DATE PRIMARY KEY,
      bar JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `
  return sql
}

/** Served from /api/cboe?history= so this does not add another serverless function. */
export async function handleMarketHistory(req, res) {
  const { getSessionUser } = await import('./session.js')
  const user = await getSessionUser(req)
  if (!user) return res.status(401).json({ error: 'Sign in to update market data.' })

  try {
    if (req.method === 'GET') {
      try {
        const sql = await withTable()
        const rows = await sql`SELECT bar FROM market_daily_tail ORDER BY trade_date`
        const bars = rows.map(row => (typeof row.bar === 'string' ? JSON.parse(row.bar) : row.bar))
        return res.status(200).json({ bars, persisted: true })
      } catch (err) {
        console.error('[market-history] read', err)
        return res.status(200).json({ bars: [], persisted: false })
      }
    }

    if (req.method === 'POST') {
      const body = await readJson(req)
      const since = body.since
      if (typeof since !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(since)) {
        return res.status(400).json({ error: 'since must be YYYY-MM-DD' })
      }
      const { bars, sources } = await fetchMissingBars(since)
      let persisted = false
      try {
        const sql = await withTable()
        for (const bar of bars.slice(0, 500)) {
          await sql`
            INSERT INTO market_daily_tail (trade_date, bar)
            VALUES (${bar[0]}, ${JSON.stringify(bar)})
            ON CONFLICT (trade_date) DO NOTHING
          `
        }
        persisted = true
      } catch (err) {
        console.error('[market-history] save', err)
      }
      return res.status(200).json({
        bars,
        persisted,
        sources,
        note: persisted
          ? 'New sessions were appended to the saved tail.'
          : 'Fetched the new sessions, but they were not saved in the database. They are available for this session only.',
      })
    }

    res.setHeader('Allow', 'GET, POST')
    return res.status(405).json({ error: 'Method not allowed' })
  } catch (err) {
    console.error('[market-history]', err)
    return res.status(502).json({ error: 'Could not fetch the latest SPX and VIX sessions.' })
  }
}
