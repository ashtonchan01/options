import { readSessionToken } from './cookies.js'
import { verifySession } from './jwt.js'
import { ensureSchema, getSql } from './db.js'

/** Non-negative integer stored on the user and copied into the JWT as `tv`. */
export function tokenVersion(value) {
  const n = typeof value === 'number' ? value : Number(value ?? 0)
  return Number.isInteger(n) && n >= 0 ? n : 0
}

/**
 * `stored === null` means the user row is gone. A JWT minted before this
 * claim existed has no `tv` and is treated as 0, matching the column default.
 * A non-integer stored value fails open so a driver quirk can't log everyone out.
 */
export function sessionVersionAllowed(claimed, stored) {
  if (stored == null) return false
  const current = typeof stored === 'number' ? stored : Number(stored)
  if (!Number.isInteger(current)) return true
  return tokenVersion(claimed) === current
}

async function readTokenVersion(userId) {
  await ensureSchema()
  const sql = getSql()
  const rows = await sql`SELECT token_version FROM users WHERE id = ${userId}`
  if (rows.length === 0) return null
  return rows[0].token_version
}

/** Returns { id, email } for the signed-in user, or null if there isn't one. */
export async function getSessionUser(req) {
  const token = readSessionToken(req)
  if (!token) return null
  const payload = await verifySession(token)
  if (!payload?.sub || !payload?.email) return null
  try {
    const stored = await readTokenVersion(payload.sub)
    if (!sessionVersionAllowed(payload.tv, stored)) return null
  } catch (err) {
    // A database blip must not tear down a still-valid JWT. A password
    // reset only sticks as an invalidation once this lookup succeeds.
    console.error('[session] token version check skipped', err)
  }
  return { id: payload.sub, email: payload.email }
}
