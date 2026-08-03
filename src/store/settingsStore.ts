import { useState, useEffect, useCallback, useRef } from 'react'

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

/** Old pre-accounts storage — read once to migrate a returning user's credentials
 * into their new account, then cleared so it doesn't shadow server data again. */
const LEGACY_LS_KEY = 'options:flex'

function readLegacyLocalSettings(): FlexSettings | null {
  try {
    const raw = localStorage.getItem(LEGACY_LS_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (parsed.profiles) return parsed as FlexSettings
    if (parsed.token || parsed.queryId) {
      const id = crypto.randomUUID()
      return { profiles: [{ id, name: 'Default', token: parsed.token || '', queryId: parsed.queryId || '' }], activeId: id }
    }
  } catch { /* ignore corrupt data */ }
  return null
}

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
  const migrated = useRef(false)

  useEffect(() => {
    let cancelled = false
    if (!sessionKey) { setSettings(EMPTY); return }

    fetchSettings().then(async server => {
      if (cancelled) return
      if (server.profiles.length === 0 && !migrated.current) {
        migrated.current = true
        const legacy = readLegacyLocalSettings()
        if (legacy && legacy.profiles.length > 0) {
          await saveSettings(legacy)
          localStorage.removeItem(LEGACY_LS_KEY)
          if (!cancelled) setSettings(legacy)
          return
        }
      }
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
