import { useState, useEffect, useCallback } from 'react'

export interface AuthUser {
  email: string
}

async function call(path: string, body?: unknown) {
  const res = await fetch(`/api/auth/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'include',
  })
  const data = await res.json().catch(() => ({})) as Record<string, unknown>
  if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Request failed')
  return data
}

export function useAuthStore() {
  const [user, setUser]       = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const data = await call('me')
      setUser({ email: data.email as string })
    } catch {
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  async function signup(email: string, password: string) {
    setError(null)
    try {
      const data = await call('signup', { email, password })
      setUser({ email: data.email as string })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Signup failed'
      setError(msg)
      throw e
    }
  }

  async function login(email: string, password: string) {
    setError(null)
    try {
      const data = await call('login', { email, password })
      setUser({ email: data.email as string })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Login failed'
      setError(msg)
      throw e
    }
  }

  async function logout() {
    try { await call('logout', {}) } catch { /* ignore */ }
    setUser(null)
  }

  return { user, loading, error, signup, login, logout }
}
