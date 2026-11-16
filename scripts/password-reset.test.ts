/**
 * Password-reset tokens are stored hashed, expire, and don't reveal whether
 * an email is registered. Login fields expose the autocomplete tokens
 * password managers need. Run with: npm test
 */
import { readFileSync } from 'node:fs'
import bcrypt from 'bcryptjs'
import { mailerConfig, resetEmailContent, sendResetEmail } from '../api/_lib/mailer.js'
import {
  GENERIC_RESET_MESSAGE,
  REQUEST_EMAIL_LIMIT,
  REQUEST_WINDOW_MS,
  RESET_TTL_MS,
  acceptableToken,
  clientIp,
  createPasswordResetRepo,
  forgotPasswordHandler,
  generateResetToken,
  hashResetToken,
  publicAppOrigin,
  resetPasswordHandler,
  resetUrlFor,
} from '../api/_lib/passwordReset.js'
import { sessionVersionAllowed, tokenVersion } from '../api/_lib/session.js'

let failed = 0
function check(name: string, ok: boolean, detail?: string) {
  if (ok) console.log(`ok  ${name}`)
  else {
    failed++
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

check('token version defaults missing claims to 0', tokenVersion(undefined) === 0 && tokenVersion(null) === 0)
check('token version keeps a stored integer', tokenVersion(2) === 2 && tokenVersion('3') === 3)
check('legacy session matches the default version', sessionVersionAllowed(undefined, 0))
check('legacy session dies after a reset bumps the version', !sessionVersionAllowed(undefined, 1))
check('current session matches its stored version', sessionVersionAllowed(2, '2'))
check('deleted user is signed out', !sessionVersionAllowed(0, null))

const minted = generateResetToken()
check('reset token is not stored as itself', minted.token !== minted.tokenHash)
check('reset token hash is sha256 hex', /^[a-f0-9]{64}$/.test(minted.tokenHash) && minted.tokenHash === hashResetToken(minted.token))
check('a second token is different', generateResetToken().token !== minted.token)
check('short tokens are rejected', !acceptableToken('abc') && acceptableToken(minted.token))

check('origin ignores the request host', publicAppOrigin({}) === 'https://options-jade.vercel.app')
check('APP_URL origin drops any path', publicAppOrigin({ APP_URL: 'https://example.com/reset' }) === 'https://example.com')
check('localhost http is allowed', publicAppOrigin({ APP_URL: 'http://localhost:5173' }) === 'http://localhost:5173')
let badOrigin = false
try { publicAppOrigin({ APP_URL: 'http://evil.example' }) } catch { badOrigin = true }
check('non-local http APP_URL is rejected', badOrigin)
check('preview links stay on the preview host', publicAppOrigin({
  VERCEL_ENV: 'preview',
  VERCEL_URL: 'options-git-preview.vercel.app',
  VERCEL_PROJECT_PRODUCTION_URL: 'options-jade.vercel.app',
}) === 'https://options-git-preview.vercel.app')
check('production ignores a deployment-specific host', publicAppOrigin({
  VERCEL_ENV: 'production',
  VERCEL_URL: 'options-abc123.vercel.app',
  VERCEL_PROJECT_PRODUCTION_URL: 'options-jade.vercel.app',
}) === 'https://options-jade.vercel.app')
check('a slashed host is not turned into an origin', publicAppOrigin({
  VERCEL_PROJECT_PRODUCTION_URL: 'evil.example/phish',
}) === 'https://options-jade.vercel.app')

const link = resetUrlFor('https://options-jade.vercel.app', 'a+b/c')
check('reset link encodes the token', link === 'https://options-jade.vercel.app/reset-password?token=a%2Bb%2Fc')

check('x-real-ip wins over a forwarded chain', clientIp({
  headers: { 'x-real-ip': '203.0.113.5', 'x-forwarded-for': '198.51.100.9, 203.0.113.5' },
}) === '203.0.113.5')
check('forwarded chain uses the first hop', clientIp({
  headers: { 'X-Forwarded-For': '198.51.100.9, 203.0.113.5' },
}) === '198.51.100.9')
check('missing ip is a shared bucket', clientIp({ headers: {} }) === 'unknown')

const escaped = resetEmailContent('https://options.example/reset-password?token=a"b<c')
check('reset email escapes the link in html', escaped.html.includes('a&quot;b&lt;c') && !escaped.html.includes('"b<c'))
check('reset email text has the raw link once', escaped.text.includes('https://options.example/reset-password?token=a"b<c'))

check('mailer is off until both secrets exist', mailerConfig({}) == null)
check('mailer config reads the two env vars', mailerConfig({
  RESEND_API_KEY: 're_test_key',
  PASSWORD_RESET_FROM: 'Options <noreply@example.com>',
})?.from === 'Options <noreply@example.com>')

{
  let captured: { url: string, init: RequestInit } | null = null
  await sendResetEmail({
    to: 'person@example.com',
    resetUrl: 'https://options.example/reset-password?token=raw-token',
    env: { RESEND_API_KEY: 're_test_key', PASSWORD_RESET_FROM: 'Options <noreply@example.com>' },
    fetchImpl: async (url, init) => {
      captured = { url: String(url), init: init ?? {} }
      return new Response(JSON.stringify({ id: 'email_1' }), { status: 200 })
    },
  })
  const headers = captured?.init.headers as Record<string, string>
  const body = JSON.parse(String(captured?.init.body))
  check('mailer posts to Resend', captured?.url === 'https://api.resend.com/emails')
  check('mailer sends a user agent and the key as a bearer', headers['User-Agent'] === 'options-password-reset/1.0' && headers.Authorization === 'Bearer re_test_key')
  check('mailer does not follow redirects', captured?.init.redirect === 'error')
  check('mailer body has the link and not the api key', body.to[0] === 'person@example.com' && body.text.includes('raw-token') && !JSON.stringify(body).includes('re_test_key'))
  check('idempotency key is not the reset url', headers['Idempotency-Key'] !== 'https://options.example/reset-password?token=raw-token')
}

{
  let threw = false
  try {
    await sendResetEmail({
      to: 'person@example.com',
      resetUrl: 'https://options.example/reset-password?token=raw-token',
      env: { RESEND_API_KEY: 're_test_key', PASSWORD_RESET_FROM: 'Options <noreply@example.com>' },
      fetchImpl: async () => new Response(JSON.stringify({ message: 'domain not verified' }), { status: 403 }),
    })
  } catch (err) {
    threw = err instanceof Error && !err.message.includes('re_test_key') && err.message.includes('403')
  }
  check('mailer failure hides the api key', threw)
}

interface Attempt { email: string, ip: string, kind: string, created_at: Date }
interface TokenRow { userId: string, tokenHash: string, expiresAt: Date, usedAt: Date | null }
interface UserRow { id: string, email: string, password_hash: string, token_version: number }

function fakeRepo(users: UserRow[]) {
  const attempts: Attempt[] = []
  const tokens: TokenRow[] = []
  let findCalls = 0
  return {
    attempts,
    tokens,
    findCalls: () => findCalls,
    async cleanup() {},
    async countAttempts({ email, ip, kind, since }: { email: string, ip: string, kind: string, since: Date }) {
      const rows = attempts.filter(row => row.kind === kind && row.created_at > since)
      return {
        emailCount: rows.filter(row => row.email === email).length,
        ipCount: rows.filter(row => row.ip === ip).length,
      }
    },
    async recordAttempt(row: { email: string, ip: string, kind: string }) {
      attempts.push({ ...row, created_at: new Date() })
    },
    async findUser(email: string) {
      findCalls++
      const user = users.find(row => row.email === email)
      return user ? { id: user.id, email: user.email } : null
    },
    async saveToken(row: { userId: string, tokenHash: string, expiresAt: Date }) {
      for (let i = tokens.length - 1; i >= 0; i--) if (tokens[i].userId === row.userId) tokens.splice(i, 1)
      tokens.push({ ...row, usedAt: null })
    },
    async deleteToken(tokenHash: string) {
      for (let i = tokens.length - 1; i >= 0; i--) if (tokens[i].tokenHash === tokenHash) tokens.splice(i, 1)
    },
    async consumeToken(tokenHash: string) {
      const row = tokens.find(item => item.tokenHash === tokenHash && !item.usedAt && item.expiresAt.getTime() > Date.now())
      if (!row) return null
      row.usedAt = new Date()
      return { userId: row.userId }
    },
    async updatePassword({ userId, passwordHash }: { userId: string, passwordHash: string }) {
      const user = users.find(row => row.id === userId)
      if (!user) throw new Error('missing user')
      user.password_hash = passwordHash
      user.token_version += 1
    },
    async deleteUserTokens(userId: string) {
      for (let i = tokens.length - 1; i >= 0; i--) if (tokens[i].userId === userId) tokens.splice(i, 1)
    },
  }
}

function mockRes() {
  return {
    statusCode: 0,
    body: null as unknown,
    headers: {} as Record<string, string>,
    status(code: number) { this.statusCode = code; return this },
    json(payload: unknown) { this.body = payload; return this },
    setHeader(name: string, value: string) { this.headers[name] = value },
  }
}

function req(body: unknown, headers: Record<string, string> = { 'x-real-ip': '203.0.113.8' }) {
  return { method: 'POST', body, headers }
}

const NOW = Date.now()

async function requestReset(repo: ReturnType<typeof fakeRepo>, email: string, sent: { to: string, resetUrl: string }[], sendFails = false) {
  const res = mockRes()
  await forgotPasswordHandler(req({ email }), res, {
    ensureSchema: async () => {},
    repo,
    now: () => NOW,
    mailerConfigured: () => true,
    appOrigin: () => publicAppOrigin({}),
    sendResetEmail: async (message: { to: string, resetUrl: string }) => {
      if (sendFails) throw new Error('smtp down')
      sent.push(message)
    },
  })
  return res
}

{
  const user = { id: 'user-1', email: 'ada@example.com', password_hash: 'old', token_version: 0 }
  const known = fakeRepo([user])
  const unknown = fakeRepo([])
  const knownSent: { to: string, resetUrl: string }[] = []
  const unknownSent: { to: string, resetUrl: string }[] = []
  const knownRes = await requestReset(known, 'Ada@Example.com', knownSent)
  const unknownRes = await requestReset(unknown, 'missing@example.com', unknownSent)
  check('known and unknown emails get the same response', knownRes.statusCode === 200 && unknownRes.statusCode === 200 && JSON.stringify(knownRes.body) === JSON.stringify(unknownRes.body))
  check('the response does not confirm the account', (knownRes.body as { message: string }).message === GENERIC_RESET_MESSAGE && !JSON.stringify(knownRes.body).includes('ada@example.com'))
  check('only a real account is emailed', knownSent.length === 1 && unknownSent.length === 0 && knownSent[0].to === 'ada@example.com')
  check('the link does not follow the request host', knownSent[0].resetUrl.startsWith('https://options-jade.vercel.app/reset-password?token='))
  const token = new URL(knownSent[0].resetUrl).searchParams.get('token') ?? ''
  check('the database stores the hash, not the link token', token !== known.tokens[0]?.tokenHash && known.tokens[0]?.tokenHash === hashResetToken(token))
  check('the link expires in 30 minutes', known.tokens[0]?.expiresAt.getTime() === NOW + RESET_TTL_MS)
  check('responses are not cached', knownRes.headers['Cache-Control'] === 'no-store')

  const repo = fakeRepo([user])
  const sent: { to: string, resetUrl: string }[] = []
  await requestReset(repo, 'ada@example.com', sent)
  const raw = new URL(sent[0].resetUrl).searchParams.get('token') ?? ''
  const short = mockRes()
  await resetPasswordHandler(req({ token: raw, password: 'short' }), short, {
    ensureSchema: async () => {},
    repo,
    now: () => NOW,
  })
  check('a short password does not burn the link', short.statusCode === 400 && repo.tokens[0]?.usedAt == null && user.token_version === 0)

  const ok = mockRes()
  await resetPasswordHandler(req({ token: raw, password: 'correct-horse' }), ok, {
    ensureSchema: async () => {},
    repo,
    now: () => NOW,
  })
  const matches = await bcrypt.compare('correct-horse', user.password_hash)
  check('reset stores a bcrypt hash and bumps the session version', ok.statusCode === 200 && (ok.body as { ok: boolean }).ok === true && matches && user.token_version === 1)
  check('reset clears the browser session and does not mint a new one', ok.headers['Set-Cookie']?.includes('Max-Age=0') === true && !ok.headers['Set-Cookie']?.includes('eyJ'))
  check('the used link is gone', repo.tokens.length === 0)

  const again = mockRes()
  await resetPasswordHandler(req({ token: raw, password: 'correct-horse' }), again, {
    ensureSchema: async () => {},
    repo,
    now: () => NOW,
  })
  check('a used link cannot set the password again', again.statusCode === 400 && user.token_version === 1)

  repo.tokens.push({
    userId: user.id,
    tokenHash: hashResetToken('expired-token-value-xxxxxxxx'),
    expiresAt: new Date(Date.now() - 1000),
    usedAt: null,
  })
  const expired = mockRes()
  await resetPasswordHandler(req({ token: 'expired-token-value-xxxxxxxx', password: 'correct-horse' }), expired, {
    ensureSchema: async () => {},
    repo,
    now: () => NOW,
  })
  check('an expired link is rejected', expired.statusCode === 400 && user.token_version === 1)
}

{
  const user = { id: 'user-1', email: 'ada@example.com', password_hash: 'old', token_version: 0 }
  const repo = fakeRepo([user])
  const sent: { to: string, resetUrl: string }[] = []
  const res = await requestReset(repo, 'ada@example.com', sent, true)
  check('a failed send does not leave a live token', res.statusCode === 500 && repo.tokens.length === 0 && sent.length === 0)
  check('a failed send does not say whether the account exists', !(JSON.stringify(res.body) ?? '').includes('ada@example.com'))
}

{
  const limited = fakeRepo([])
  const since = new Date(Date.now() - 1000)
  for (let i = 0; i < REQUEST_EMAIL_LIMIT; i++) {
    limited.attempts.push({ email: 'ada@example.com', ip: '203.0.113.8', kind: 'request', created_at: since })
  }
  const res = await requestReset(limited, 'ada@example.com', [])
  check('email reset requests are rate limited', res.statusCode === 429 && limited.findCalls() === 0)

  const other = fakeRepo([])
  for (let i = 0; i < 20; i++) {
    other.attempts.push({ email: `other${i}@example.com`, ip: '203.0.113.8', kind: 'request', created_at: since })
  }
  const ipRes = await requestReset(other, 'fresh@example.com', [])
  check('reset requests are also limited per ip', ipRes.statusCode === 429 && other.findCalls() === 0)
  check('rate limit window is an hour', REQUEST_WINDOW_MS === 60 * 60 * 1000)
}

{
  const repo = fakeRepo([])
  for (let i = 0; i < 10; i++) {
    repo.attempts.push({ email: '-', ip: '203.0.113.8', kind: 'redeem', created_at: new Date() })
  }
  const res = mockRes()
  await resetPasswordHandler(req({ token: minted.token, password: 'correct-horse' }), res, {
    ensureSchema: async () => {},
    repo,
    now: () => NOW,
  })
  check('reset guesses are rate limited', res.statusCode === 429 && repo.attempts.length === 10)
}

{
  const calls: { text: string, values: unknown[] }[] = []
  const sql = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ text: strings.join('?'), values })
    if (strings.join('?').includes('COUNT(*)')) return [{ email_count: '4', ip_count: '2' }]
    if (strings.join('?').includes('RETURNING')) return [{ user_id: 'user-1' }]
    if (strings.join('?').includes('SELECT id, email')) return [{ id: 'user-1', email: 'ada@example.com' }]
    return []
  }
  const repo = createPasswordResetRepo(sql as never)
  const secretEmail = 'leak-check@example.com'
  const secretHash = 'f'.repeat(64)
  await repo.findUser(secretEmail)
  await repo.saveToken({ userId: 'user-1', tokenHash: secretHash, expiresAt: new Date(NOW + RESET_TTL_MS) })
  await repo.consumeToken(secretHash)
  await repo.updatePassword({ userId: 'user-1', passwordHash: '$2a$secret' })
  const counts = await repo.countAttempts({ email: secretEmail, ip: '203.0.113.8', kind: 'request', since: new Date(NOW) })
  const joined = calls.map(call => call.text).join('\n')
  check('queries keep emails and token hashes out of the sql text', !joined.includes(secretEmail) && !joined.includes(secretHash) && !joined.includes('$2a$secret'))
  check('consume requires an unused unexpired token', calls.some(call => call.text.includes('used_at IS NULL') && call.text.includes('expires_at > now()') && call.values.includes(secretHash)))
  check('password changes bump token_version in the database', calls.some(call => call.text.includes('token_version = token_version + 1') && call.values.includes('$2a$secret')))
  check('attempt counts come back as numbers', counts.emailCount === 4 && counts.ipCount === 2)
}

const authGate = readFileSync(new URL('../src/components/auth/AuthGate.tsx', import.meta.url), 'utf8')
const usernameAt = authGate.indexOf('id="username"')
const passwordAt = authGate.indexOf('id="password"')
const usernameBlock = authGate.slice(usernameAt, passwordAt)
const passwordBlock = authGate.slice(passwordAt, authGate.indexOf('Forgot password?'))
check('username field comes before the password field', usernameAt > authGate.indexOf('<form') && usernameAt < passwordAt)
check('username field is an email with autocomplete username', usernameBlock.includes('name="username"') && usernameBlock.includes('type="email"') && usernameBlock.includes('autoComplete="username"') && !usernameBlock.includes('type="password"') && !usernameBlock.includes('current-password') && !usernameBlock.includes('new-password'))
check('password field is current-password on login and new-password on signup', passwordBlock.includes('name="password"') && passwordBlock.includes('type="password"') && passwordBlock.includes("autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}"))
check('login offers a forgot-password page', authGate.includes('href="/forgot-password"') && authGate.includes('Forgot password?'))
check('login form does not mask the username field', !authGate.includes('webkit-text-security') && !authGate.includes('autoComplete="off"') && !authGate.includes('autoComplete="current-password"'))

const resetUi = readFileSync(new URL('../src/components/auth/PasswordReset.tsx', import.meta.url), 'utf8')
const forgotUi = resetUi.slice(resetUi.indexOf('function ForgotPasswordPage'), resetUi.indexOf('function ResetPasswordPage'))
const chooseUi = resetUi.slice(resetUi.indexOf('function ResetPasswordPage'))
check('reset request is an email field, not a password field', forgotUi.includes('type="email"') && forgotUi.includes('autoComplete="email"') && !forgotUi.includes('type="password"'))
check('choosing a password uses new-password on both fields', chooseUi.includes('id="new-password"') && chooseUi.includes('id="confirm-password"') && chooseUi.split('autoComplete="new-password"').length === 3)

const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')) as { rewrites: { source: string, destination: string }[], crons: { path: string }[] }
check('reset pages rewrite to the spa', vercel.rewrites.some(rule => rule.source === '/forgot-password' && rule.destination === '/index.html') && vercel.rewrites.some(rule => rule.source === '/reset-password' && rule.destination === '/index.html'))
check('rewrites do not swallow the api or the flex cron', vercel.rewrites.every(rule => !rule.source.startsWith('/api')) && vercel.crons[0].path === '/api/flex-sync')

const flexSync = readFileSync(new URL('../api/flex-sync.js', import.meta.url), 'utf8')
const flexCron = readFileSync(new URL('../api/_lib/flexCron.js', import.meta.url), 'utf8')
const bearerAt = flexSync.indexOf("authorization.startsWith('Bearer ')")
const snapshotAt = flexSync.indexOf('return readSnapshotResponse(req, res)')
check('flex cron bearer still runs before the session snapshot', bearerAt > 0 && bearerAt < snapshotAt && flexSync.includes('return runFlexCron(req, res)') && flexCron.includes('CRON_SECRET'))

const login = readFileSync(new URL('../api/auth/login.js', import.meta.url), 'utf8')
const signup = readFileSync(new URL('../api/auth/signup.js', import.meta.url), 'utf8')
const me = readFileSync(new URL('../api/auth/me.js', import.meta.url), 'utf8')
check('login and signup stamp the session version', login.includes('tv: tokenVersion(user.token_version)') && signup.includes('tv: tokenVersion(user.token_version)') && me.includes('getSessionUser'))

if (failed > 0) {
  console.error(`\n${failed} failed`)
  process.exit(1)
}
console.log('\nall password-reset checks passed')
