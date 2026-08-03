const SESSION_COOKIE = 'session'
const MAX_AGE = 30 * 24 * 60 * 60 // 30 days

export function parseCookies(req) {
  const header = req.headers.cookie
  const out = {}
  if (!header) return out
  for (const part of header.split(';')) {
    const idx = part.indexOf('=')
    if (idx === -1) continue
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim())
  }
  return out
}

export function sessionCookie(token) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE}`
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
}

export function readSessionToken(req) {
  return parseCookies(req)[SESSION_COOKIE] ?? null
}
