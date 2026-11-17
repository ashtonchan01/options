import type { BacktestParams } from './engine'
import { frequencySummary } from './tradeFrequency'

export const SCENARIO_COLORS = ['#14f195', '#b26bff', '#f59e0b', '#60a5fa', '#fb7185', '#2dd4bf', '#facc15', '#a3e635']

/** Sample window matches the saved 5-minute bars. */
export const SAMPLE_START = '2024-03-12'
export const SAMPLE_END = '2026-04-24'

/** Applied inside the engine — not exposed in the UI. */
export const HIDDEN_DEFAULTS = {
  skewPerPct: 0.585,
  slippage: 0.1,
  ratePct: 4,
  divPct: 1.3,
} as const

export function defaultParams(): BacktestParams {
  return {
    id: crypto.randomUUID(),
    dte: 0,
    entryWeekdays: [1, 2, 3, 4, 5],
    tradeFrequency: 'daily',
    frequencyWeekday: 1,
    frequencyMonthWeek: 1,
    strikeMode: 'pct',
    strikeValue: 0,
    width: 50,
    sizing: 'contracts',
    contracts: 1,
    riskBudget: 5000,
    takeProfitOn: true,
    takeProfitPct: 50,
    stopType: 'multiple',
    stopMultiple: 2,
    startDate: SAMPLE_START,
    endDate: SAMPLE_END,
    entryMinute: 10 * 60,
    startingCapital: 100_000,
  }
}

/** Signed % vs spot: negative below, zero at spot, positive above. */
export function formatStrikePct(value: number): string {
  if (!Number.isFinite(value) || value === 0) return '0%'
  const rounded = Math.round(value * 10) / 10
  const sign = rounded > 0 ? '+' : ''
  return `${sign}${rounded.toFixed(1)}%`
}

export function shortLabel(p: BacktestParams): string {
  const dte = p.dte === 0 ? '0 DTE' : `${p.dte} DTE`
  const strike = p.strikeMode === 'pct'
    ? formatStrikePct(p.strikeValue)
    : p.strikeMode === 'delta'
      ? `${trimNum(p.strikeValue)} delta`
      : `${trimNum(p.strikeValue)} pts below`
  const freq = frequencySummary(p)
  const tail = freq ? `, ${freq}` : ''
  return `${dte}, ${strike}, ${trimNum(p.width)}-wide${tail}`
}

function trimNum(n: number): string {
  if (!Number.isFinite(n)) return '—'
  return String(Math.round(n * 1000) / 1000)
}