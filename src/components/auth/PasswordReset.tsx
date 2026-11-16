import { useState } from 'react'
import { Lock } from 'lucide-react'

async function postAuth(path: string, body: unknown) {
  const res = await fetch(`/api/auth/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({})) as Record<string, unknown>
  return { ok: res.ok, data }
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    setMessage(null)
    try {
      const { ok, data } = await postAuth('forgot-password', { email })
      if (!ok) {
        setError(typeof data.error === 'string' ? data.error : 'Request failed')
        return
      }
      setMessage(typeof data.message === 'string'
        ? data.message
        : 'If an account exists for that email, a reset link is on its way. It expires in 30 minutes and can only be used once.')
    } catch {
      setError('Request failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthCard title="Reset password" subtitle="We'll email a reset link if an account exists for that address.">
      {message ? (
        <div style={infoStyle}>{message}</div>
      ) : (
        <form method="post" onSubmit={handleSubmit} style={formStyle}>
          <label htmlFor="reset-email" style={labelStyle}>
            <span style={labelTextStyle}>Email address</span>
            <input
              id="reset-email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              style={inputStyle}
            />
          </label>
          {error && <div style={errorStyle}>{error}</div>}
          <button type="submit" disabled={submitting} style={submitStyle(submitting)}>
            {submitting ? 'Please wait…' : 'Send reset link'}
          </button>
        </form>
      )}
      <Footer><a href="/" style={anchorStyle}>Back to sign in</a></Footer>
    </AuthCard>
  )
}

export function ResetPasswordPage() {
  const [token] = useState(() => new URLSearchParams(window.location.search).get('token') ?? '')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const { ok, data } = await postAuth('reset-password', { token, password })
      if (!ok) {
        setError(typeof data.error === 'string' ? data.error : 'Request failed')
        return
      }
      window.history.replaceState(null, '', '/reset-password')
      setDone(true)
    } catch {
      setError('Request failed')
    } finally {
      setSubmitting(false)
    }
  }

  const invalid = !token && !done

  return (
    <AuthCard title="Choose a new password" subtitle="Use at least 8 characters. This link works once.">
      {done ? (
        <div style={infoStyle}>Password updated. Sign in with your new password.</div>
      ) : invalid ? (
        <div style={errorStyle}>This reset link is invalid or has expired.</div>
      ) : (
        <form method="post" onSubmit={handleSubmit} style={formStyle}>
          <label htmlFor="new-password" style={labelStyle}>
            <span style={labelTextStyle}>New password</span>
            <input
              id="new-password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              maxLength={128}
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              style={inputStyle}
            />
          </label>
          <label htmlFor="confirm-password" style={labelStyle}>
            <span style={labelTextStyle}>Confirm password</span>
            <input
              id="confirm-password"
              name="confirm-password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              maxLength={128}
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              placeholder="Repeat the new password"
              style={inputStyle}
            />
          </label>
          {error && <div style={errorStyle}>{error}</div>}
          <button type="submit" disabled={submitting} style={submitStyle(submitting)}>
            {submitting ? 'Please wait…' : 'Update password'}
          </button>
        </form>
      )}
      <Footer>
        {invalid ? (
          <a href="/forgot-password" style={anchorStyle}>Request a new link</a>
        ) : (
          <a href="/" style={anchorStyle}>Back to sign in</a>
        )}
      </Footer>
    </AuthCard>
  )
}

function AuthCard({ title, subtitle, children }: { title: string, subtitle: string, children: React.ReactNode }) {
  return (
    <div style={{
      height: '100%', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg-surface)',
    }}>
      <div style={{
        width: 340, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10,
        padding: '28px 28px 24px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <Lock size={16} style={{ color: 'var(--accent)' }} />
          <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-1)' }}>{title}</span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-4)', marginBottom: 20 }}>{subtitle}</div>
        {children}
      </div>
    </div>
  )
}

function Footer({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 16, textAlign: 'center', fontSize: 12, color: 'var(--text-4)' }}>
      {children}
    </div>
  )
}

const formStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 12 }
const labelStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 5 }
const labelTextStyle: React.CSSProperties = { fontSize: 11, color: 'var(--text-3)', fontWeight: 600 }

const inputStyle: React.CSSProperties = {
  padding: '8px 10px', fontSize: 16, background: 'var(--bg-elevated)', border: '1px solid var(--border)',
  color: 'var(--text-1)', borderRadius: 6, outline: 'none', fontFamily: 'inherit',
}

const anchorStyle: React.CSSProperties = {
  color: 'var(--accent)', fontWeight: 600, fontSize: 12, fontFamily: 'inherit', textDecoration: 'none',
}

const errorStyle: React.CSSProperties = {
  fontSize: 12, color: '#f43f5e', background: '#f43f5e14', border: '1px solid #f43f5e30', borderRadius: 6, padding: '6px 10px',
}

const infoStyle: React.CSSProperties = {
  fontSize: 12, color: 'var(--text-2)', background: 'var(--accent-dim)', border: '1px solid var(--accent-border)', borderRadius: 6, padding: '6px 10px',
}

function submitStyle(submitting: boolean): React.CSSProperties {
  return {
    marginTop: 4, padding: '9px 0', fontSize: 13, fontWeight: 700,
    background: submitting ? 'var(--bg-elevated)' : 'var(--accent-dim)',
    border: `1px solid ${submitting ? 'var(--border)' : 'var(--accent-border)'}`,
    color: submitting ? 'var(--text-3)' : 'var(--accent)',
    borderRadius: 6, cursor: submitting ? 'not-allowed' : 'pointer',
    fontFamily: 'inherit',
  }
}
