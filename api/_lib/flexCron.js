/**
 * One schedule-aware Flex check. GitHub Actions and the Vercel cron both
 * call this. A slot is claimed in the database before SendRequest, so the
 * two callers cannot fetch the same account at the same time.
 */
import { timingSafeEqual } from 'node:crypto'
import { ensureSchema, getSql } from './db.js'
import { fetchFlexStatement } from './flexStatement.js'
import { followPlan } from './flexFollow.js'
import {
  claimAllowed,
  configuredFlexAccounts,
  flexWindowFromXml,
  pickDueAccount,
  scheduleAfterAttempt,
  scheduleWithClaim,
} from './flexSchedule.js'

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

function asSchedule(value) {
  if (!value) return {}
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }
  return typeof value === 'object' ? value : {}
}

export async function readFlexSnapshots(sql) {
  return sql`
    SELECT account_key, xml, from_date, to_date, fetched_at, schedule
    FROM flex_server_sync
  `
}

function candidatesFrom(rows, configured) {
  const byKey = new Map(rows.map(row => [row.account_key, row]))
  return configured.map(account => {
    const row = byKey.get(account.key)
    const windows = row?.from_date && row?.to_date
      ? [{ fromDate: row.from_date, toDate: row.to_date }]
      : []
    return { ...account, record: asSchedule(row?.schedule), windows }
  })
}

async function reloadAccount(sql, account) {
  const rows = await sql`
    SELECT schedule, from_date, to_date
    FROM flex_server_sync
    WHERE account_key = ${account.key}
  `
  const row = rows[0]
  if (!row) return
  account.record = asSchedule(row.schedule)
  if (row.from_date && row.to_date) {
    account.windows = [{ fromDate: row.from_date, toDate: row.to_date }]
  }
}

/**
 * Atomic claim. The WHERE matches claimAllowed: the slot is still open and
 * nobody else holds a live lease. Losing returns no row and does not fetch.
 */
async function claimSlot(sql, account, decision, claimed, now) {
  const rows = await sql`
    INSERT INTO flex_server_sync (account_key, schedule, updated_at)
    VALUES (${account.key}, ${JSON.stringify(claimed)}::jsonb, now())
    ON CONFLICT (account_key) DO UPDATE SET
      schedule = EXCLUDED.schedule,
      updated_at = now()
    WHERE flex_server_sync.schedule->>'lastSlotId' IS DISTINCT FROM ${decision.slot}
      AND flex_server_sync.schedule->>'doneSydneyDate' IS DISTINCT FROM ${decision.sydneyDate}
      AND (
        COALESCE(flex_server_sync.schedule->>'claimUntil', '') = ''
        OR flex_server_sync.schedule->>'claimUntil' <= ${now.toISOString()}
        OR flex_server_sync.schedule->>'claimSlotId' IS DISTINCT FROM ${decision.slot}
      )
    RETURNING account_key
  `
  return Array.isArray(rows) && rows.length > 0
}

export async function runFlexCron(req, res) {
  if (!process.env.CRON_SECRET) return res.status(503).json({ error: 'CRON_SECRET is not set' })
  if (!secretMatches(req)) return res.status(401).json({ error: 'Unauthorized' })

  const configured = configuredFlexAccounts()
  if (configured.length === 0) return res.status(200).json({ ran: null, reason: 'no-flex-env' })

  try {
    await ensureSchema()
    const sql = getSql()
    const candidates = candidatesFrom(await readFlexSnapshots(sql), configured)
    const now = new Date()

    let remaining = candidates.length
    while (remaining > 0) {
      remaining -= 1
      const picked = pickDueAccount(now, candidates)
      if (!picked) {
        return res.status(200).json({
          ran: null,
          reason: 'none-due',
          follow: followPlan(now, candidates),
        })
      }

      const { account, decision } = picked
      if (!claimAllowed(account.record, decision, now)) {
        account.record = { ...(account.record ?? {}), lastSlotId: decision.slot }
        continue
      }

      const claimed = scheduleWithClaim(account.record, decision, now)
      const won = await claimSlot(sql, account, decision, claimed, now)
      if (!won) {
        await reloadAccount(sql, account)
        if (claimAllowed(account.record, decision, now)) {
          account.record = scheduleWithClaim(account.record, decision, now)
        }
        continue
      }

      account.record = claimed
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
      account.record = schedule
      if (result.ok && window) {
        account.windows = [{ fromDate: window.fromDate, toDate: window.toDate }]
      }

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
      } else {
        await sql`
          INSERT INTO flex_server_sync (account_key, schedule, last_code, updated_at)
          VALUES (${account.key}, ${JSON.stringify(schedule)}::jsonb, ${code}, now())
          ON CONFLICT (account_key) DO UPDATE SET
            schedule = EXCLUDED.schedule,
            last_code = EXCLUDED.last_code,
            updated_at = now()
        `
      }

      const follow = followPlan(new Date(), candidates)
      if (result.ok && window) {
        return res.status(200).json({ ran: account.key, status: 'saved', toDate: window.toDate, follow })
      }
      const quiet = code === '1018' || code === '1019'
      return res.status(200).json({
        ran: account.key,
        status: quiet ? 'waiting' : 'error',
        code,
        follow,
      })
    }

    return res.status(200).json({
      ran: null,
      reason: 'in-flight',
      follow: followPlan(new Date(), candidates),
    })
  } catch {
    return res.status(500).json({ error: 'Flex check failed' })
  }
}
