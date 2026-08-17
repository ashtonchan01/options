import { getSql, ensureSchema } from './_lib/db.js'
import { getSessionUser } from './_lib/session.js'

// Allowlist of recognized blob keys — keeps data_key from becoming an
// arbitrary free-form column an unexpected client could pollute.
const ALLOWED_KEYS = new Set(['watchlists', 'tradeLabels', 'journalEntries', 'journalSetups', 'targetAllocations'])

export default async function handler(req, res) {
  const user = await getSessionUser(req)
  if (!user) return res.status(401).json({ error: 'Not signed in' })

  const key = req.method === 'GET' ? req.query?.key : (req.body ?? {}).key
  if (typeof key !== 'string' || !ALLOWED_KEYS.has(key)) {
    return res.status(400).json({ error: 'Unknown or missing key' })
  }

  try {
    await ensureSchema()
    const sql = getSql()

    if (req.method === 'GET') {
      const rows = await sql`SELECT data FROM user_app_data WHERE user_id = ${user.id} AND data_key = ${key}`
      return res.status(200).json({ value: rows[0]?.data ?? null })
    }

    if (req.method === 'PUT') {
      const body = req.body ?? {}
      if (!('value' in body)) return res.status(400).json({ error: 'Missing value' })
      await sql`
        INSERT INTO user_app_data (user_id, data_key, data, updated_at)
        VALUES (${user.id}, ${key}, ${JSON.stringify(body.value)}, now())
        ON CONFLICT (user_id, data_key) DO UPDATE SET data = ${JSON.stringify(body.value)}, updated_at = now()
      `
      return res.status(200).json({ ok: true })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (err) {
    console.error('[user-data]', err)
    return res.status(500).json({ error: 'Could not save data. Try again in a moment.' })
  }
}
