import type { BacktestParams } from './engine'

const LS_KEY = 'options:backtest-saves'

export interface SavedRun {
  id: string
  name: string
  savedAt: string
  params: BacktestParams
}

/** Older saves used positive % for below spot; flip to the signed convention. */
function migrateParams(params: BacktestParams): BacktestParams {
  let next = params
  if (next.strikeMode === 'pct' && next.strikeValue > 0) {
    next = { ...next, strikeValue: -next.strikeValue }
  }
  if (next.tradeFrequency == null) {
    next = {
      ...next,
      tradeFrequency: 'daily',
      frequencyWeekday: next.frequencyWeekday ?? 1,
      frequencyMonthWeek: next.frequencyMonthWeek ?? 1,
    }
  }
  return next
}

export function loadSavedRuns(): SavedRun[] {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as SavedRun[]
    if (!Array.isArray(parsed)) return []
    return parsed.map(run => ({ ...run, params: migrateParams(run.params) }))
  } catch {
    return []
  }
}

export function persistSavedRuns(runs: SavedRun[]): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(runs))
  } catch { /* ignore quota */ }
}

export function addSavedRun(name: string, params: BacktestParams): SavedRun {
  const run: SavedRun = {
    id: crypto.randomUUID(),
    name: name.trim() || 'Untitled',
    savedAt: new Date().toISOString(),
    params: { ...params, id: crypto.randomUUID() },
  }
  const next = [run, ...loadSavedRuns()].slice(0, 40)
  persistSavedRuns(next)
  return run
}

export function deleteSavedRun(id: string): void {
  persistSavedRuns(loadSavedRuns().filter(r => r.id !== id))
}