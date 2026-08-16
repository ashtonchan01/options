/**
 * Persists journal entries (setup, mistakes, discipline rating, notes) per
 * position to localStorage, mirrored to the server (/api/user-data) when
 * signed in so reviews follow the user across browsers/devices. Keyed by
 * position id `${tradeDate}|${expiry}|${underlying}` (stable across Flex
 * re-syncs, same id scheme as StrategyTradeLog rows).
 */
import { useEffect, useState } from 'react'
import { loadUserData, saveUserData } from '../services/userData'

export interface JournalEntry {
  setup?: string
  mistakes?: string[]
  rating?: number        // 1-5 discipline / execution grade
  note?: string
}

export const DEFAULT_SETUPS = [
  'Wheel income', 'Post-earnings IV crush', 'High IV rank', 'Support bounce',
  'Resistance fade', 'Trend continuation', 'Hedge', 'Roll',
]

export const MISTAKES = [
  'Oversized', 'No plan', 'Chased entry', 'Early exit', 'Late exit',
  'Ignored stop', 'FOMO', 'Revenge trade', 'Held through earnings',
]

const LS_KEY        = 'options:journal'
const LS_SETUPS_KEY = 'options:journalSetups'

function load(): Record<string, JournalEntry> {
  try {
    const raw = localStorage.getItem(LS_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}

function loadSetups(): string[] {
  try {
    const raw = localStorage.getItem(LS_SETUPS_KEY)
    return raw ? JSON.parse(raw) : DEFAULT_SETUPS
  } catch { return DEFAULT_SETUPS }
}

export function useJournalStore(sessionKey: string | null) {
  const [entries, setEntries] = useState<Record<string, JournalEntry>>(load)
  const [setups, setSetups]   = useState<string[]>(loadSetups)

  useEffect(() => {
    if (!sessionKey) return
    let cancelled = false
    loadUserData<Record<string, JournalEntry>>('journalEntries').then(remote => {
      if (cancelled || !remote || Object.keys(remote).length === 0) return
      setEntries(remote)
      localStorage.setItem(LS_KEY, JSON.stringify(remote))
    })
    loadUserData<string[]>('journalSetups').then(remote => {
      if (cancelled || !remote?.length) return
      setSetups(remote)
      localStorage.setItem(LS_SETUPS_KEY, JSON.stringify(remote))
    })
    return () => { cancelled = true }
  }, [sessionKey])

  function updateEntry(id: string, patch: Partial<JournalEntry>) {
    setEntries(prev => {
      const cur  = prev[id] ?? {}
      const next = { ...prev, [id]: { ...cur, ...patch } }
      // Drop empty entries so the store stays clean
      const e = next[id]
      if (!e.setup && !(e.mistakes?.length) && !e.rating && !e.note) delete next[id]
      localStorage.setItem(LS_KEY, JSON.stringify(next))
      if (sessionKey) saveUserData('journalEntries', next)
      return next
    })
  }

  function addSetup(name: string) {
    const trimmed = name.trim()
    if (!trimmed) return
    setSetups(prev => {
      if (prev.includes(trimmed)) return prev
      const next = [...prev, trimmed]
      localStorage.setItem(LS_SETUPS_KEY, JSON.stringify(next))
      if (sessionKey) saveUserData('journalSetups', next)
      return next
    })
  }

  return { entries, updateEntry, setups, addSetup }
}
