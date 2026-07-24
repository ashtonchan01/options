import { useState, useEffect } from 'react'

export type Theme = 'dark' | 'light'

const LS_KEY = 'options:theme'

function loadTheme(): Theme {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (raw === 'light' || raw === 'dark') return raw
  } catch { /* ignore */ }
  return 'light'
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
  localStorage.setItem(LS_KEY, theme)
}

// Apply on module load (before React renders) to prevent flash
applyTheme(loadTheme())

export function useThemeStore() {
  const [theme, setTheme] = useState<Theme>(loadTheme)

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  const toggle = () => setTheme(t => t === 'dark' ? 'light' : 'dark')

  return { theme, toggle }
}
