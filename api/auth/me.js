import { readSessionToken } from '../_lib/cookies.js'
import { verifySession } from '../_lib/jwt.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const token = readSessionToken(req)
  if (!token) return res.status(401).json({ error: 'Not signed in' })

  const payload = await verifySession(token)
  if (!payload?.email) return res.status(401).json({ error: 'Session expired' })

  return res.status(200).json({ email: payload.email })
}
