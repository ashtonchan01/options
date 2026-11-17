import { createHash } from 'node:crypto'

const RESET_SUBJECT = 'Reset your Options password'

export function mailerConfig(env = process.env) {
  const apiKey = typeof env.RESEND_API_KEY === 'string' ? env.RESEND_API_KEY.trim() : ''
  const from = typeof env.PASSWORD_RESET_FROM === 'string' ? env.PASSWORD_RESET_FROM.trim() : ''
  if (!apiKey || !from) return null
  return { apiKey, from }
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

export function resetEmailContent(resetUrl) {
  const text = [
    'Someone asked to reset the password for this email address.',
    'If that was you, open the link below to choose a new password.',
    'The link expires in 30 minutes and can only be used once.',
    '',
    resetUrl,
    '',
    'If you did not ask for this, you can ignore this email. Your password will stay the same.',
  ].join('\n')
  const href = escapeHtml(resetUrl)
  const html = [
    '<p>Someone asked to reset the password for this email address.</p>',
    '<p>If that was you, open this link to choose a new password. It expires in 30 minutes and can only be used once.</p>',
    `<p><a href="${href}">${href}</a></p>`,
    '<p>If you did not ask for this, you can ignore this email. Your password will stay the same.</p>',
  ].join('')
  return { subject: RESET_SUBJECT, text, html }
}

export async function sendResetEmail({ to, resetUrl, env = process.env, fetchImpl = fetch }) {
  const config = mailerConfig(env)
  if (!config) throw new Error('Password reset email is not configured')
  const message = resetEmailContent(resetUrl)
  const res = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
      'User-Agent': 'options-password-reset/1.0',
      'Idempotency-Key': createHash('sha256').update(resetUrl).digest('hex'),
    },
    body: JSON.stringify({
      from: config.from,
      to: [to],
      subject: message.subject,
      text: message.text,
      html: message.html,
    }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    const reason = data && typeof data.message === 'string' ? data.message : res.statusText
    throw new Error(`Resend ${res.status}: ${reason}`)
  }
}
