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
  if (params.strikeMode === 'pct' && params.strikeValue > 0) {
    return { ...params, strikeValue: -params.strikeValue }
  }
  return params
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