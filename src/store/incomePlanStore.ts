/**
 * Editable income-plan settings. Defaults are the 23 Oct 2026 plan.
 * localStorage is the write that survives offline; /api/user-data mirrors
 * it when a session is present. This blob is settings only — no Flex token.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { DEFAULT_INCOME_SETTINGS, INCOME_RULE_TYPES, type IncomeRule, type IncomeRuleType, type IncomeSettings, type SplitMode } from '../income/incomeSeed'
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

const RULE_TYPES = new Set<string>(INCOME_RULE_TYPES.map(row => row.type))

function copyRules(rules: IncomeRule[]): IncomeRule[] {
  return rules.map(rule => ({ ...rule }))
}

function freshSettings(): IncomeSettings {
  const base = DEFAULT_INCOME_SETTINGS
  return { ...base, rules: copyRules(base.rules), excludeSymbols: [...base.excludeSymbols], etfSymbols: [...base.etfSymbols] }
}

function asRule(item: unknown): IncomeRule | null {
  if (typeof item !== 'object' || item === null) return null
  const rec = item as { symbol?: unknown; type?: unknown; value?: unknown; date?: unknown }
  if (typeof rec.type !== 'string' || !RULE_TYPES.has(rec.type)) return null
  const symbol = typeof rec.symbol === 'string' ? rec.symbol.trim().toUpperCase() : ''
  const value = typeof rec.value === 'number' && Number.isFinite(rec.value) ? rec.value : null
  const date = typeof rec.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(rec.date.trim()) ? rec.date.trim() : null
  return { symbol, type: rec.type as IncomeRuleType, value, date }
}

/** Old blobs stored BIDU/BABA prices, two booleans, and earnings dates. */
function legacyRules(row: Record<string, unknown>): IncomeRule[] {
  const rules: IncomeRule[] = []
  const defaults = DEFAULT_INCOME_SETTINGS.rules.filter(rule => rule.type === 'exit')
  const exitInput = Array.isArray(row.exits) ? row.exits : null
  const seen = new Set<string>()
  for (const exit of defaults) {
    const found = exitInput?.find(item => typeof item === 'object' && item !== null && String((item as { symbol?: unknown }).symbol ?? '').trim().toUpperCase() === exit.symbol)
    const rawPrice = found && typeof found === 'object' ? (found as { price?: unknown }).price : undefined
    const price = typeof rawPrice === 'number' && Number.isFinite(rawPrice) ? rawPrice : exit.value
    rules.push({ symbol: exit.symbol, type: 'exit', value: price, date: null })
    seen.add(exit.symbol)
  }
  for (const item of exitInput ?? []) {
    if (typeof item !== 'object' || item === null) continue
    const symbol = String((item as { symbol?: unknown }).symbol ?? '').trim().toUpperCase()
    const price = (item as { price?: unknown }).price
    if (!symbol || seen.has(symbol) || typeof price !== 'number' || !Number.isFinite(price)) continue
    rules.push({ symbol, type: 'exit', value: price, date: null })
    seen.add(symbol)
  }
  if (row.noNewMstrPuts !== false) rules.push({ symbol: 'MSTR', type: 'noNewPuts', value: null, date: null })
  if (row.tslaCallsCoveredOnly !== false) rules.push({ symbol: 'TSLA', type: 'coveredCalls', value: null, date: null })
  const blackoutInput = Array.isArray(row.earningsBlackouts) && row.earningsBlackouts.length > 0 ? row.earningsBlackouts : null
  const blackouts = blackoutInput ?? DEFAULT_INCOME_SETTINGS.rules.filter(rule => rule.type === 'noNewPuts' && rule.date)
  for (const item of blackouts) {
    if (typeof item !== 'object' || item === null) continue
    const rec = item as { symbol?: unknown; date?: unknown }
    const symbol = typeof rec.symbol === 'string' ? rec.symbol.trim().toUpperCase() : ''
    const date = typeof rec.date === 'string' ? rec.date.trim() : ''
    if (!symbol || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
    rules.push({ symbol, type: 'noNewPuts', value: null, date })
  }
  return rules
}

export function normalizeSettings(raw: unknown): IncomeSettings {
  if (typeof raw !== 'object' || raw === null) return freshSettings()
  const row = raw as Record<string, unknown>
  const base = DEFAULT_INCOME_SETTINGS
  const rules = Array.isArray(row.rules) ? row.rules.flatMap(item => {
    const rule = asRule(item)
    return rule ? [rule] : []
  }) : legacyRules(row)
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
    rules,
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
