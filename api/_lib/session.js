import { readSessionToken } from './cookies.js'
import { verifySession } from './jwt.js'

/** Returns { sub, email } for the signed-in user, or null if there isn't one. */
export async function getSessionUser(req) {
  const token = readSessionToken(req)
  if (!token) return null
  const payload = await verifySession(token)
  if (!payload?.sub || !payload?.email) return null
  return { id: payload.sub, email: payload.email }
}
