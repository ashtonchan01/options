import { getSql, ensureSchema } from '../_lib/db.js'
import { getSessionUser } from '../_lib/session.js'

const EMPTY = { profiles: [], activeId: '' }

export default async function handler(req, res) {
  const user = await getSessionUser(req)
  if (!user) return res.status(401).json({ error: 'Not signed in' })

  try {
    await ensureSchema()
    const sql = getSql()

    if (req.method === 'GET') {
      const rows = await sql`SELECT flex_settings FROM user_settings WHERE user_id = ${user.id}`
      return res.status(200).json(rows[0]?.flex_settings ?? EMPTY)
    }

    if (req.method === 'PUT') {
      const body = req.body ?? {}
      if (!Array.isArray(body.profiles) || typeof body.activeId !== 'string') {
        return res.status(400).json({ error: 'Invalid settings payload' })
      }
      await sql`
        INSERT INTO user_settings (user_id, flex_settings, updated_at)
        VALUES (${user.id}, ${JSON.stringify(body)}, now())
        ON CONFLICT (user_id) DO UPDATE SET flex_settings = ${JSON.stringify(body)}, updated_at = now()
      `
      return res.status(200).json({ ok: true })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (err) {
    console.error('[settings/flex]', err)
    return res.status(500).json({ error: 'Could not save settings. Try again in a moment.' })
  }
}
