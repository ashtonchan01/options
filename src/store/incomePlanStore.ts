/**
 * Editable income-plan settings. Defaults are the 23 Oct 2026 plan.
 * localStorage is the write that survives offline; /api/user-data mirrors
 * it when a session is present. This blob is settings only — no Flex token.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { DEFAULT_INCOME_SETTINGS, type IncomeSettings, type SplitMode } from '../income/incomeSeed'
import { loadUserData, saveUserData } from '../services/userData'

const LS_KEY = 'options:incomePlan'

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback
}

function asSymbols(value: unknown, fallback: string[]): string[] {
  const source = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : null
  if (!source) return fallback
  const symbols = [...new Set(source.map(item => String(item).trim().toUpperCase()).filter(Boolean))]
  return symbols.length > 0 ? symbols : fallback
}

/** 30 and 0.30 both mean 30%. A value of 1 stays 100%, which the gross-up then rejects. */
function asTaxRate(value: unknown, fallback: number): number {
  const n = asNumber(value, fallback)
  return n > 1 && n <= 100 ? n / 100 : n
}

function asSplitMode(value: unknown, fallback: SplitMode): SplitMode {
  return value === 'capital' || value === 'fixed' ? value : fallback
}

export function normalizeSettings(raw: unknown): IncomeSettings {
  const base = DEFAULT_INCOME_SETTINGS
  if (typeof raw !== 'object' || raw === null) return { ...base, exits: base.exits.map(e => ({ ...e })), earningsBlackouts: base.earningsBlackouts.map(e => ({ ...e })), excludeSymbols: [...base.excludeSymbols], etfSymbols: [...base.etfSymbols] }
  const row = raw as Record<string, unknown>
  const exitInput = Array.isArray(row.exits) ? row.exits : null
  const exits = base.exits.map(exit => {
    const found = exitInput?.find(item => typeof item === 'object' && item !== null && String((item as { symbol?: unknown }).symbol).toUpperCase() === exit.symbol)
    const price = found && typeof found === 'object' ? asNumber((found as { price?: unknown }).price, exit.price) : exit.price
    return { symbol: exit.symbol, price }
  })
  const earningsBlackouts = Array.isArray(row.earningsBlackouts) && row.earningsBlackouts.length > 0
    ? row.earningsBlackouts.flatMap(item => {
        if (typeof item !== 'object' || item === null) return []
        const rec = item as { symbol?: unknown; date?: unknown; label?: unknown }
        const symbol = typeof rec.symbol === 'string' ? rec.symbol.trim().toUpperCase() : ''
        const date = typeof rec.date === 'string' ? rec.date.trim() : ''
        if (!symbol || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return []
        const label = typeof rec.label === 'string' && rec.label.trim() ? rec.label.trim() : `${symbol} earnings`
        return [{ symbol, date, label }]
      })
    : base.earningsBlackouts.map(e => ({ ...e }))
  return {
    elFloor: asNumber(row.elFloor, base.elFloor),
    targetNote: asString(row.targetNote, base.targetNote),
    splitMode: asSplitMode(row.splitMode, base.splitMode),
    personalSplitPct: asNumber(row.personalSplitPct, base.personalSplitPct),
    personalTaxRate: asTaxRate(row.personalTaxRate, base.personalTaxRate),
    businessTaxRate: asTaxRate(row.businessTaxRate, base.businessTaxRate),
    personalInterestAud: asNumber(row.personalInterestAud, base.personalInterestAud),
    businessInterestAud: asNumber(row.businessInterestAud, base.businessInterestAud),
    screenExpiry: typeof row.screenExpiry === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.screenExpiry) ? row.screenExpiry : base.screenExpiry,
    deltaMin: asNumber(row.deltaMin, base.deltaMin),
    deltaMax: asNumber(row.deltaMax, base.deltaMax),
    rankBy: 'premiumOverCash',
    excludeSymbols: asSymbols(row.excludeSymbols, [...base.excludeSymbols]),
    etfSymbols: asSymbols(row.etfSymbols, [...base.etfSymbols]),
    noNewMstrPuts: typeof row.noNewMstrPuts === 'boolean' ? row.noNewMstrPuts : base.noNewMstrPuts,
    tslaCallsCoveredOnly: typeof row.tslaCallsCoveredOnly === 'boolean' ? row.tslaCallsCoveredOnly : base.tslaCallsCoveredOnly,
    exits,
    earningsBlackouts: earningsBlackouts.length > 0 ? earningsBlackouts : base.earningsBlackouts.map(e => ({ ...e })),
  }
}

function loadLocal(): IncomeSettings {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return normalizeSettings(null)
    return normalizeSettings(JSON.parse(raw))
  } catch {
    return normalizeSettings(null)
  }
}

function saveLocal(settings: IncomeSettings) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(settings)) } catch { /* ignore */ }
}

export function useIncomePlan(sessionKey: string | null) {
  const [settings, setSettings] = useState<IncomeSettings>(loadLocal)
  const settingsRef = useRef(settings)
  useEffect(() => { settingsRef.current = settings }, [settings])

  useEffect(() => {
    if (!sessionKey) return
    let cancelled = false
    loadUserData<unknown>('incomePlan').then(remote => {
      if (cancelled || remote == null) return
      const next = normalizeSettings(remote)
      settingsRef.current = next
      setSettings(next)
      saveLocal(next)
    })
    return () => { cancelled = true }
  }, [sessionKey])

  const update = useCallback((patch: Partial<IncomeSettings>) => {
    const next = normalizeSettings({ ...settingsRef.current, ...patch })
    settingsRef.current = next
    setSettings(next)
    saveLocal(next)
    if (sessionKey) void saveUserData('incomePlan', next)
  }, [sessionKey])

  return { settings, update }
}
