/**
 * While this tab is open, pull each Flex account on the Sydney schedule.
 * Stops for the rest of the Sydney day once the latest window covers the
 * US session that just closed. Does nothing when the tab is closed.
 */
import { useEffect, useRef } from 'react'
import type { Account } from '../store/accountsStore'
import {
  latestSlotId,
  sydneyClock,
  expectedUsTradingDay,
  waitingForStatementNote,
  windowCoversTradingDay,
} from '../services/flexSchedule'

interface AutoRecord {
  doneSydneyDate?: string
  lastSlotId?: string
}

interface SyncOutcome {
  ok: boolean
  toDate?: string
}

function storageKey(sessionKey: string): string {
  return `options:flex-auto:${sessionKey}`
}

function load(sessionKey: string): Record<string, AutoRecord> {
  try {
    const raw = localStorage.getItem(storageKey(sessionKey))
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, AutoRecord>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function save(sessionKey: string, state: Record<string, AutoRecord>) {
  try { localStorage.setItem(storageKey(sessionKey), JSON.stringify(state)) } catch { /* ignore */ }
}

export function useFlexAutoSync(
  sessionKey: string | null,
  accounts: Account[],
  syncFlex: (id: string, token: string, queryId: string, opts?: { auto?: boolean; waitingNote?: string; expectedDay?: string }) => Promise<SyncOutcome>,
  loadingId: string | null,
) {
  const accountsRef = useRef(accounts)
  const loadingRef = useRef(loadingId)
  const syncRef = useRef(syncFlex)
  const running = useRef(false)
  accountsRef.current = accounts
  loadingRef.current = loadingId
  syncRef.current = syncFlex

  useEffect(() => {
    if (!sessionKey) return
    let cancelled = false

    async function tick() {
      if (cancelled || running.current || loadingRef.current) return
      const now = new Date()
      const today = sydneyClock(now).ymd
      const expected = expectedUsTradingDay(now)
      const state = load(sessionKey!)
      const withFlex = accountsRef.current
        .filter(a => a.flexToken && a.flexQueryId)
        .sort((a, b) => a.id.localeCompare(b.id))

      let dirty = false
      const due: { account: Account; index: number }[] = []
      withFlex.forEach((account, index) => {
        const rec = state[account.id] ?? {}
        if (rec.doneSydneyDate === today) return
        if (windowCoversTradingDay(account.flexStoredWindows, expected)) {
          state[account.id] = { ...rec, doneSydneyDate: today }
          dirty = true
          return
        }
        const slot = latestSlotId(now, index)
        if (!slot || slot === rec.lastSlotId) return
        due.push({ account, index })
      })
      if (dirty) save(sessionKey!, state)
      if (due.length === 0) return

      running.current = true
      try {
        for (let i = 0; i < due.length; i++) {
          if (cancelled) return
          if (i > 0) await new Promise(r => setTimeout(r, 60_000))
          if (cancelled || loadingRef.current) return
          const { account, index } = due[i]
          const started = new Date()
          const slot = latestSlotId(started, index)
          const rec = state[account.id] ?? {}
          state[account.id] = { ...rec, lastSlotId: slot ?? rec.lastSlotId }
          save(sessionKey!, state)
          const outcome = await syncRef.current(account.id, account.flexToken!, account.flexQueryId!, {
            auto: true,
            waitingNote: waitingForStatementNote(started, index),
            expectedDay: expected,
          })
          if (outcome.ok && outcome.toDate && outcome.toDate >= expected) {
            state[account.id] = { ...state[account.id], doneSydneyDate: sydneyClock(new Date()).ymd }
            save(sessionKey!, state)
          }
        }
      } finally {
        running.current = false
      }
    }

    void tick()
    const timer = setInterval(() => { void tick() }, 20_000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [sessionKey])
}
