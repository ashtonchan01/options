import { createHash, randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { getSql, ensureSchema } from './db.js'
import { clearSessionCookie } from './cookies.js'
import { mailerConfig, sendResetEmail } from './mailer.js'

export const RESET_TTL_MS = 30 * 60 * 1000
export const REQUEST_WINDOW_MS = 60 * 60 * 1000
export const REQUEST_EMAIL_LIMIT = 5
export const REQUEST_IP_LIMIT = 20
export const REDEEM_WINDOW_MS = 15 * 60 * 1000
export const REDEEM_IP_LIMIT = 10
export const GENERIC_RESET_MESSAGE = 'If an account exists for that email, a reset link is on its way. It expires in 30 minutes and can only be used once.'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const UNAVAILABLE = 'Password reset is temporarily unavailable.'
const SERVER_ERROR = 'Something went wrong. Try again in a moment.'
const INVALID_LINK = 'This reset link is invalid or has expired.'
const TOO_MANY_REQUESTS = 'Too many reset requests. Try again later.'
const TOO_MANY_ATTEMPTS = 'Too many attempts. Try again later.'

export function normalizeEmail(email) {
  if (typeof email !== 'string') return null
  const normalized = email.trim().toLowerCase()
  if (normalized.length > 254 || !EMAIL_RE.test(normalized)) return null
  return normalized
}

export function passwordError(password) {
  if (typeof password !== 'string' || password.length < 8) return 'Password must be at least 8 characters'
  if (password.length > 128) return 'Password must be at most 128 characters'
  return null
}

export function hashResetToken(token) {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

export function generateResetToken() {
  const token = randomBytes(32).toString('base64url')
  return { token, tokenHash: hashResetToken(token) }
}

export function acceptableToken(token) {
  return typeof token === 'string' && token.length >= 20 && token.length <= 200 && !/\s/.test(token)
}

/** The link origin is never taken from the request Host header. */
export function publicAppOrigin(env = process.env) {
  const configured = typeof env.APP_URL === 'string' ? env.APP_URL.trim() : ''
  if (configured) {
    let url
    try { url = new URL(configured) } catch { throw new Error('APP_URL is not a valid URL') }
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
      throw new Error('APP_URL must use https')
    }
    return url.origin
  }
  if (env.VERCEL_ENV === 'preview') {
    const preview = httpsOrigin(env.VERCEL_URL)
    if (preview) return preview
  }
  const production = httpsOrigin(env.VERCEL_PROJECT_PRODUCTION_URL)
  if (production) return production
  return 'https://options-jade.vercel.app'
}

function httpsOrigin(host) {
  if (typeof host !== 'string') return null
  const trimmed = host.trim()
  if (!trimmed || /[\s/\\]/.test(trimmed)) return null
  return `https://${trimmed}`
}

export function resetUrlFor(origin, token) {
  return `${origin}/reset-password?token=${encodeURIComponent(token)}`
}

export function clientIp(req) {
  const real = headerValue(req, 'x-real-ip')
  if (real) return real.slice(0, 64)
  const forwarded = headerValue(req, 'x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim() ?? ''
    if (first) return first.slice(0, 64)
  }
  return 'unknown'
}

function headerValue(req, name) {
  const headers = req?.headers ?? {}
  const wanted = name.toLowerCase()
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== wanted) continue
    if (typeof value === 'string') return value.trim()
    if (Array.isArray(value) && typeof value[0] === 'string') return value[0].trim()
  }
  return ''
}

function toCount(value) {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}

export function createPasswordResetRepo(sql) {
  return {
    async cleanup(now) {
      const cutoff = new Date(now - REQUEST_WINDOW_MS)
      await sql`DELETE FROM password_reset_attempts WHERE created_at < ${cutoff}`
      await sql`DELETE FROM password_reset_tokens WHERE expires_at < ${cutoff}`
    },
    async countAttempts({ email, ip, kind, since }) {
      const rows = await sql`
        SELECT
          COUNT(*) FILTER (WHERE email = ${email}) AS email_count,
          COUNT(*) FILTER (WHERE ip = ${ip}) AS ip_count
        FROM password_reset_attempts
        WHERE kind = ${kind} AND created_at > ${since}
      `
      return {
        emailCount: toCount(rows[0]?.email_count),
        ipCount: toCount(rows[0]?.ip_count),
      }
    },
    async recordAttempt({ email, ip, kind }) {
      await sql`
        INSERT INTO password_reset_attempts (email, ip, kind)
        VALUES (${email}, ${ip}, ${kind})
      `
    },
    async findUser(email) {
      const rows = await sql`SELECT id, email FROM users WHERE email = ${email}`
      return rows[0] ? { id: rows[0].id, email: rows[0].email } : null
    },
    async saveToken({ userId, tokenHash, expiresAt }) {
      await sql`DELETE FROM password_reset_tokens WHERE user_id = ${userId}`
      await sql`
        INSERT INTO password_reset_tokens (token_hash, user_id, expires_at)
        VALUES (${tokenHash}, ${userId}, ${expiresAt})
      `
    },
    async deleteToken(tokenHash) {
      await sql`DELETE FROM password_reset_tokens WHERE token_hash = ${tokenHash}`
    },
    async consumeToken(tokenHash) {
      const rows = await sql`
        UPDATE password_reset_tokens
        SET used_at = now()
        WHERE token_hash = ${tokenHash}
          AND used_at IS NULL
          AND expires_at > now()
        RETURNING user_id
      `
      return rows[0] ? { userId: rows[0].user_id } : null
    },
    async updatePassword({ userId, passwordHash }) {
      await sql`
        UPDATE users
        SET password_hash = ${passwordHash}, token_version = token_version + 1
        WHERE id = ${userId}
      `
    },
    async deleteUserTokens(userId) {
      await sql`DELETE FROM password_reset_tokens WHERE user_id = ${userId}`
    },
  }
}

function json(res, status, body) {
  res.setHeader('Cache-Control', 'no-store')
  return res.status(status).json(body)
}

async function repoFor(deps) {
  await (deps.ensureSchema ?? ensureSchema)()
  return deps.repo ?? createPasswordResetRepo((deps.getSql ?? getSql)())
}

export async function forgotPasswordHandler(req, res, deps = {}) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })

  const email = normalizeEmail(req.body?.email)
  if (!email) return json(res, 400, { error: 'Enter a valid email address' })

  const configured = deps.mailerConfigured ?? (() => mailerConfig() != null)
  if (!configured()) return json(res, 503, { error: UNAVAILABLE })

  let origin
  try {
    origin = (deps.appOrigin ?? publicAppOrigin)()
  } catch (err) {
    console.error('[auth/forgot-password] origin', err)
    return json(res, 503, { error: UNAVAILABLE })
  }

  try {
    const repo = await repoFor(deps)
    const now = (deps.now ?? Date.now)()
    await repo.cleanup(now)
    const ip = clientIp(req)
    const counts = await repo.countAttempts({
      email,
      ip,
      kind: 'request',
      since: new Date(now - REQUEST_WINDOW_MS),
    })
    if (counts.emailCount >= REQUEST_EMAIL_LIMIT || counts.ipCount >= REQUEST_IP_LIMIT) {
      return json(res, 429, { error: TOO_MANY_REQUESTS })
    }
    await repo.recordAttempt({ email, ip, kind: 'request' })

    const user = await repo.findUser(email)
    if (!user) return json(res, 200, { message: GENERIC_RESET_MESSAGE })

    const { token, tokenHash } = (deps.generateResetToken ?? generateResetToken)()
    const expiresAt = new Date(now + RESET_TTL_MS)
    await repo.saveToken({ userId: user.id, tokenHash, expiresAt })
    const resetUrl = resetUrlFor(origin, token)
    try {
      await (deps.sendResetEmail ?? sendResetEmail)({ to: user.email, resetUrl })
    } catch (err) {
      console.error('[auth/forgot-password] send failed', err)
      try { await repo.deleteToken(tokenHash) } catch { /* the unused token expires on its own */ }
      return json(res, 500, { error: 'Could not send the reset email. Try again in a moment.' })
    }
    return json(res, 200, { message: GENERIC_RESET_MESSAGE })
  } catch (err) {
    console.error('[auth/forgot-password]', err)
    return json(res, 500, { error: SERVER_ERROR })
  }
}

export async function resetPasswordHandler(req, res, deps = {}) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })

  const password = req.body?.password
  const problem = passwordError(password)
  if (problem) return json(res, 400, { error: problem })

  const token = req.body?.token
  const ip = clientIp(req)

  try {
    const repo = await repoFor(deps)
    const now = (deps.now ?? Date.now)()
    await repo.cleanup(now)
    const counts = await repo.countAttempts({
      email: '-',
      ip,
      kind: 'redeem',
      since: new Date(now - REDEEM_WINDOW_MS),
    })
    if (counts.ipCount >= REDEEM_IP_LIMIT) return json(res, 429, { error: TOO_MANY_ATTEMPTS })

    if (!acceptableToken(token)) {
      await repo.recordAttempt({ email: '-', ip, kind: 'redeem' })
      return json(res, 400, { error: INVALID_LINK })
    }

    const consumed = await repo.consumeToken(hashResetToken(token))
    if (!consumed) {
      await repo.recordAttempt({ email: '-', ip, kind: 'redeem' })
      return json(res, 400, { error: INVALID_LINK })
    }

    const passwordHash = await bcrypt.hash(password, 10)
    try {
      await repo.updatePassword({ userId: consumed.userId, passwordHash })
      await repo.deleteUserTokens(consumed.userId)
    } catch (err) {
      console.error('[auth/reset-password] update failed', err)
      return json(res, 500, { error: 'Could not update the password. Request a new reset link.' })
    }

    res.setHeader('Set-Cookie', clearSessionCookie())
    return json(res, 200, { ok: true })
  } catch (err) {
    console.error('[auth/reset-password]', err)
    return json(res, 500, { error: SERVER_ERROR })
  }
}
