import bcrypt from 'bcryptjs'
import { getSql, ensureSchema } from '../_lib/db.js'
import { signSession } from '../_lib/jwt.js'
import { sessionCookie } from '../_lib/cookies.js'
import { tokenVersion } from '../_lib/session.js'
import { forgotPasswordHandler, resetPasswordHandler } from '../_lib/passwordReset.js'

function requestedAction(req) {
  const queryAction = req.query?.action
  if (typeof queryAction === 'string' && queryAction) return queryAction
  const raw = typeof req.url === 'string' ? req.url : ''
  const q = raw.indexOf('?')
  if (q === -1) return ''
  return new URLSearchParams(raw.slice(q + 1)).get('action') || ''
}

export default async function handler(req, res) {
  // Password reset shares this function. Another route file under /api
  // would put the project over Vercel Hobby's serverless function limit
  // and the preview would be rejected. The handlers live in api/_lib.
  const action = requestedAction(req)
  if (action === 'forgot') return forgotPasswordHandler(req, res)
  if (action === 'reset') return resetPasswordHandler(req, res)

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { email, password } = req.body ?? {}
  if (typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Email and password are required' })
  }
  const normalizedEmail = email.trim().toLowerCase()

  try {
    await ensureSchema()
    const sql = getSql()

    const rows = await sql`SELECT id, email, password_hash, token_version FROM users WHERE email = ${normalizedEmail}`
    const user = rows[0]
    // Compare against a dummy hash when the user doesn't exist so the response
    // timing doesn't reveal whether the email is registered.
    const hash = user?.password_hash ?? '$2a$10$CwTycUXWue0Thq9StjUM0uJ8HZC5ItAdxXk1e5NDYRXwvKzP6cksy'
    const valid = await bcrypt.compare(password, hash)

    if (!user || !valid) {
      return res.status(401).json({ error: 'Incorrect email or password' })
    }

    const token = await signSession({ sub: user.id, email: user.email, tv: tokenVersion(user.token_version) })
    res.setHeader('Set-Cookie', sessionCookie(token))
    return res.status(200).json({ email: user.email })
  } catch (err) {
    console.error('[auth/login]', err)
    return res.status(500).json({ error: 'Login failed. Try again in a moment.' })
  }
}
