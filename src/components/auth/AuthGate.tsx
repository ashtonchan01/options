import { useState } from 'react'
import { Lock } from 'lucide-react'

interface Props {
  error: string | null
  onLogin: (email: string, password: string) => Promise<void>
  onSignup: (email: string, password: string) => Promise<void>
}

export default function AuthGate({ error, onLogin, onSignup }: Props) {
  const [mode, setMode]         = useState<'login' | 'signup'>('login')
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    try {
      if (mode === 'login') await onLogin(email, password)
      else await onSignup(email, password)
    } catch { /* error surfaced via `error` prop */ }
    finally { setSubmitting(false) }
  }

  return (
    <div style={{
      height: '100vh', width: '100vw', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg-surface)',
    }}>
      <div style={{
        width: 340, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10,
        padding: '28px 28px 24px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <Lock size={16} style={{ color: 'var(--accent)' }} />
          <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-1)' }}>
            {mode === 'login' ? 'Sign in' : 'Create account'}
          </span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-4)', marginBottom: 20 }}>
          {mode === 'login' ? 'Welcome back — sign in to continue.' : 'Set up your login to get started.'}
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 600 }}>Email address</span>
            {/* No autoFocus — on iOS home-screen standalone apps, a focus()
                call that isn't the direct result of a real touch/click
                doesn't bring up the keyboard, and can leave the WebView's
                keyboard subsystem stuck for the rest of the session (every
                input silently failing to respond to taps afterward, not
                just this one). */}
            <input
              type="email" required value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              style={inputStyle}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 600 }}>Password</span>
            <input
              type="password" required minLength={8} value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder={mode === 'signup' ? 'At least 8 characters' : '••••••••'}
              style={inputStyle}
            />
          </label>

          {error && (
            <div style={{ fontSize: 12, color: '#f43f5e', background: '#f43f5e14', border: '1px solid #f43f5e30', borderRadius: 6, padding: '6px 10px' }}>
              {error}
            </div>
          )}

          <button type="submit" disabled={submitting} style={{
            marginTop: 4, padding: '9px 0', fontSize: 13, fontWeight: 700,
            background: submitting ? 'var(--bg-elevated)' : 'var(--accent-dim)',
            border: `1px solid ${submitting ? 'var(--border)' : 'var(--accent-border)'}`,
            color: submitting ? 'var(--text-3)' : 'var(--accent)',
            borderRadius: 6, cursor: submitting ? 'not-allowed' : 'pointer',
            fontFamily: 'inherit',
          }}>
            {submitting ? 'Please wait…' : mode === 'login' ? 'Continue' : 'Create account'}
          </button>
        </form>

        <div style={{ marginTop: 16, textAlign: 'center', fontSize: 12, color: 'var(--text-4)' }}>
          {mode === 'login' ? (
            <>No account? <button onClick={() => setMode('signup')} style={linkStyle}>Sign up</button></>
          ) : (
            <>Already have an account? <button onClick={() => setMode('login')} style={linkStyle}>Sign in</button></>
          )}
        </div>
      </div>
    </div>
  )
}

// fontSize must be >= 16px — below that, iOS Safari running as an installed
// home-screen app has a known bug where focusing the input never brings up
// the on-screen keyboard at all.
const inputStyle: React.CSSProperties = {
  padding: '8px 10px', fontSize: 16, background: 'var(--bg-elevated)', border: '1px solid var(--border)',
  color: 'var(--text-1)', borderRadius: 6, outline: 'none', fontFamily: 'inherit',
}

const linkStyle: React.CSSProperties = {
  background: 'none', border: 'none', padding: 0, color: 'var(--accent)', fontWeight: 600,
  cursor: 'pointer', fontSize: 12, fontFamily: 'inherit',
}
