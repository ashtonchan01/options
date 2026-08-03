import bcrypt from 'bcryptjs'
import { getSql, ensureSchema } from '../_lib/db.js'
import { signSession } from '../_lib/jwt.js'
import { sessionCookie } from '../_lib/cookies.js'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { email, password } = req.body ?? {}
  if (typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Email and password are required' })
  }
  const normalizedEmail = email.trim().toLowerCase()
  if (!EMAIL_RE.test(normalizedEmail)) {
    return res.status(400).json({ error: 'Enter a valid email address' })
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' })
  }

  try {
    await ensureSchema()
    const sql = getSql()

    const existing = await sql`SELECT id FROM users WHERE email = ${normalizedEmail}`
    if (existing.length > 0) {
      return res.status(409).json({ error: 'An account with that email already exists' })
    }

    const passwordHash = await bcrypt.hash(password, 10)
    const rows = await sql`
      INSERT INTO users (email, password_hash) VALUES (${normalizedEmail}, ${passwordHash})
      RETURNING id, email
    `
    const user = rows[0]
    const token = await signSession({ sub: user.id, email: user.email })
    res.setHeader('Set-Cookie', sessionCookie(token))
    return res.status(200).json({ email: user.email })
  } catch (err) {
    console.error('[auth/signup]', err)
    return res.status(500).json({ error: 'Signup failed. Try again in a moment.' })
  }
}
