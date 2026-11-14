import { ensureSchema, getSql } from './_lib/db.js'
import { fetchFlexStatement } from './_lib/flexStatement.js'
import { getSessionUser } from './_lib/session.js'
import { readFlexSnapshots, runFlexCron } from './_lib/flexCron.js'

async function readSnapshotResponse(req, res) {
  const user = await getSessionUser(req)
  if (!user) return res.status(401).json({ error: 'Sign in required' })
  try {
    await ensureSchema()
    const rows = await readFlexSnapshots(getSql())
    return res.status(200).json({
      snapshots: rows
        .filter(row => row.xml)
        .map(row => ({
          key: row.account_key,
          xml: row.xml,
          fromDate: row.from_date,
          toDate: row.to_date,
          fetchedAt: row.fetched_at,
        })),
    })
  } catch {
    return res.status(500).json({ error: 'Could not load statements' })
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(204).end()

  // Scheduled check and the signed-in snapshot read share this function so
  // the project stays inside the serverless function limit. Vercel Cron
  // sends GET with Authorization: Bearer CRON_SECRET. A snapshot read has
  // no bearer header.
  const authorization = req.headers?.authorization || req.headers?.Authorization || ''
  const cronBearer = typeof authorization === 'string' && authorization.startsWith('Bearer ')
  if (req.method === 'POST' || (req.method === 'GET' && cronBearer)) return runFlexCron(req, res)

  const { token, query, fd, td } = req.query
  if (!token && !query) return readSnapshotResponse(req, res)

  if (!token || !query) return res.status(400).json({ error: 'Missing token or query' })

  const dated = typeof fd === 'string' && typeof td === 'string' && /^\d{8}$/.test(fd) && /^\d{8}$/.test(td)

  const result = await fetchFlexStatement({
    token,
    query,
    ...(dated ? { fd, td } : {}),
  })

  if (!result.ok) {
    const status = result.retryable ? 503 : 502
    return res.status(status).json({
      error: result.error,
      code: result.code,
      retryable: result.retryable,
      raw: result.raw,
    })
  }

  res.setHeader('Content-Type', 'application/xml')
  return res.status(200).send(result.xml)
}
