import { getSql, ensureSchema } from './_lib/db.js'
import { getSessionUser } from './_lib/session.js'

export default async function handler(req, res) {
  const user = await getSessionUser(req)
  if (!user) return res.status(401).json({ error: 'Not signed in' })

  try {
    await ensureSchema()
    const sql = getSql()

    if (req.method === 'GET') {
      const rows = await sql`SELECT data FROM user_portfolio_data WHERE user_id = ${user.id}`
      return res.status(200).json(rows[0]?.data ?? null)
    }

    if (req.method === 'PUT') {
      const body = req.body ?? {}
      if (!Array.isArray(body.positions) || !Array.isArray(body.trades)) {
        return res.status(400).json({ error: 'Invalid portfolio payload' })
      }
      await sql`
        INSERT INTO user_portfolio_data (user_id, data, updated_at)
        VALUES (${user.id}, ${JSON.stringify(body)}, now())
        ON CONFLICT (user_id) DO UPDATE SET data = ${JSON.stringify(body)}, updated_at = now()
      `
      return res.status(200).json({ ok: true })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (err) {
    console.error('[portfolio-data]', err)
    return res.status(500).json({ error: 'Could not save portfolio data. Try again in a moment.' })
  }
}
