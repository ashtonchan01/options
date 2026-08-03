import { useState, useEffect, useCallback } from 'react'

export interface FlexProfile {
  id: string
  name: string
  token: string
  queryId: string
}

export interface FlexSettings {
  profiles: FlexProfile[]
  activeId: string
}

const EMPTY: FlexSettings = { profiles: [], activeId: '' }

async function fetchSettings(): Promise<FlexSettings> {
  const res = await fetch('/api/settings/flex', { credentials: 'include' })
  if (!res.ok) return EMPTY
  return await res.json() as FlexSettings
}

async function saveSettings(next: FlexSettings) {
  await fetch('/api/settings/flex', {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(next),
  })
}

/**
 * Flex credentials now live server-side per account (so signing in from any
 * device shows the same IBKR profiles), keyed by `sessionKey` — pass the
 * signed-in user's email, or null while signed out.
 */
export function useSettingsStore(sessionKey: string | null) {
  const [settings, setSettings] = useState<FlexSettings>(EMPTY)

  useEffect(() => {
    let cancelled = false
    if (!sessionKey) { setSettings(EMPTY); return }

    fetchSettings().then(server => {
      if (cancelled) return
      setSettings(server)
    })

    return () => { cancelled = true }
  }, [sessionKey])

  const update = useCallback((next: FlexSettings) => {
    setSettings(next)
    saveSettings(next).catch(() => {})
  }, [])

  const activeProfile = settings.profiles.find(p => p.id === settings.activeId) ?? null

  return { settings, update, activeProfile }
}
