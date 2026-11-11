import { timingSafeEqual } from 'node:crypto'
import { ensureSchema, getSql } from './_lib/db.js'
import { fetchFlexStatement } from './_lib/flexStatement.js'
import { getSessionUser } from './_lib/session.js'
import {
  configuredFlexAccounts,
  flexWindowFromXml,
  pickDueAccount,
  scheduleAfterAttempt,
} from './_lib/flexSchedule.js'

/** One account per call so SendRequest/GetStatement stays inside the function limit. */
const CRON_BUDGET_MS = 45_000

function presentedSecret(req) {
  const header = req.headers?.authorization || req.headers?.Authorization || ''
  if (typeof header === 'string' && header.startsWith('Bearer ')) return header.slice(7)
  const alt = req.headers?.['x-cron-secret']
  return typeof alt === 'string' ? alt : ''
}

function secretMatches(req) {
  const expected = process.env.CRON_SECRET
  if (!expected) return false
  const given = presentedSecret(req)
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

async function readSnapshots(sql) {
  return sql`
    SELECT account_key, xml, from_date, to_date, fetched_at, schedule
    FROM flex_server_sync
  `
}

async function readSnapshotResponse(req, res) {
  const user = await getSessionUser(req)
  if (!user) return res.status(401).json({ error: 'Sign in required' })
  try {
    await ensureSchema()
    const rows = await readSnapshots(getSql())
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

async function runCron(req, res) {
  if (!process.env.CRON_SECRET) return res.status(503).json({ error: 'CRON_SECRET is not set' })
  if (!secretMatches(req)) return res.status(401).json({ error: 'Unauthorized' })

  const configured = configuredFlexAccounts()
  if (configured.length === 0) return res.status(200).json({ ran: null, reason: 'no-flex-env' })

  try {
    await ensureSchema()
    const sql = getSql()
    const rows = await readSnapshots(sql)
    const byKey = new Map(rows.map(row => [row.account_key, row]))
    const now = new Date()
    const candidates = configured.map(account => {
      const row = byKey.get(account.key)
      const schedule = row?.schedule && typeof row.schedule === 'object' ? row.schedule : {}
      const windows = row?.from_date && row?.to_date
        ? [{ fromDate: row.from_date, toDate: row.to_date }]
        : []
      return { ...account, record: schedule, windows }
    })
    const picked = pickDueAccount(now, candidates)
    if (!picked) return res.status(200).json({ ran: null, reason: 'none-due' })

    const { account, decision } = picked
    const result = await fetchFlexStatement({
      token: account.token,
      query: account.query,
      budgetMs: CRON_BUDGET_MS,
    })
    const window = result.ok ? flexWindowFromXml(result.xml) : null
    const schedule = scheduleAfterAttempt(account.record, decision, {
      ok: Boolean(result.ok && window),
      toDate: window?.toDate,
    })
    const code = result.ok ? null : (result.code ? String(result.code) : null)

    if (result.ok && window) {
      await sql`
        INSERT INTO flex_server_sync (account_key, xml, from_date, to_date, fetched_at, schedule, last_code, updated_at)
        VALUES (${account.key}, ${result.xml}, ${window.fromDate}, ${window.toDate}, now(), ${JSON.stringify(schedule)}::jsonb, ${code}, now())
        ON CONFLICT (account_key) DO UPDATE SET
          xml = EXCLUDED.xml,
          from_date = EXCLUDED.from_date,
          to_date = EXCLUDED.to_date,
          fetched_at = now(),
          schedule = EXCLUDED.schedule,
          last_code = EXCLUDED.last_code,
          updated_at = now()
      `
      return res.status(200).json({ ran: account.key, status: 'saved', toDate: window.toDate })
    }

    await sql`
      INSERT INTO flex_server_sync (account_key, schedule, last_code, updated_at)
      VALUES (${account.key}, ${JSON.stringify(schedule)}::jsonb, ${code}, now())
      ON CONFLICT (account_key) DO UPDATE SET
        schedule = EXCLUDED.schedule,
        last_code = EXCLUDED.last_code,
        updated_at = now()
    `
    const quiet = code === '1018' || code === '1019'
    return res.status(200).json({
      ran: account.key,
      status: quiet ? 'waiting' : 'error',
      code,
    })
  } catch {
    return res.status(500).json({ error: 'Flex check failed' })
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(204).end()

  // Scheduled check and the signed-in snapshot read share this function so
  // the project stays inside the serverless function limit.
  if (req.method === 'POST') return runCron(req, res)

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
