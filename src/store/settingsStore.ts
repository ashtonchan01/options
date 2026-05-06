import { useState } from 'react'

export interface FlexSettings {
  token: string
  queryId: string
}

const LS_KEY = 'options:flex'

function load(): FlexSettings {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return { token: '', queryId: '' }
}

function save(s: FlexSettings) {
  localStorage.setItem(LS_KEY, JSON.stringify(s))
}

export function useSettingsStore() {
  const [settings, setSettings] = useState<FlexSettings>(load)

  const update = (patch: Partial<FlexSettings>) => {
    setSettings(prev => {
      const next = { ...prev, ...patch }
      save(next)
      return next
    })
  }

  return { settings, update }
}
