import { useState } from 'react'

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

const LS_KEY = 'options:flex'

function load(): FlexSettings {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed.profiles) return parsed as FlexSettings
      if (parsed.token || parsed.queryId) {
        const id = crypto.randomUUID()
        return {
          profiles: [{ id, name: 'Default', token: parsed.token || '', queryId: parsed.queryId || '' }],
          activeId: id,
        }
      }
    }
  } catch { /* ignore */ }
  return { profiles: [], activeId: '' }
}

function save(s: FlexSettings) {
  localStorage.setItem(LS_KEY, JSON.stringify(s))
}

export function useSettingsStore() {
  const [settings, setSettings] = useState<FlexSettings>(load)

  const update = (next: FlexSettings) => {
    save(next)
    setSettings(next)
  }

  const activeProfile = settings.profiles.find(p => p.id === settings.activeId) ?? null

  return { settings, update, activeProfile }
}
