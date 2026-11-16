/**
 * Saved daily tail for the backtest.
 *
 * GET  /api/market-history          → bars already stored after the committed snapshot
 * POST /api/market-history { since } → fetch only sessions after `since`, store them
 *
 * Signed-in users only. Nothing here runs on a timer.
 */
import { getSql } from './_lib/db.js'
import { getSessionUser } from './_lib/session.js'
import { fetchMissingBars } from './_lib/marketHistory.js'

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

export default async function handler(req, res) {
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
