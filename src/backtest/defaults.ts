import type { BacktestParams } from './engine'

export const SCENARIO_COLORS = ['#14f195', '#b26bff', '#f59e0b', '#60a5fa', '#fb7185', '#2dd4bf', '#facc15', '#a3e635']

/** Sample window matches the saved 5-minute bars, so 0DTE stops are intraday. */
export const SAMPLE_START = '2024-03-12'
export const SAMPLE_END = '2026-04-24'

const shared: Omit<BacktestParams, 'id' | 'strikeValue'> = {
  dte: 0,
  entryWeekdays: [1, 2, 3, 4, 5],
  strikeMode: 'pct',
  width: 50,
  sizing: 'contracts',
  contracts: 1,
  riskBudget: 5000,
  takeProfitOn: true,
  takeProfitPct: 50,
  stopType: 'multiple',
  stopMultiple: 2,
  vixMin: null,
  vixMax: null,
  startDate: SAMPLE_START,
  endDate: SAMPLE_END,
  skewPerPct: 2,
  slippage: 0.1,
  entryMinute: 10 * 60,
  ratePct: 4,
  divPct: 1.3,
  startingCapital: 100_000,
}

export function sampleConfigs(): BacktestParams[] {
  return [
    { ...shared, id: 'atm', strikeValue: 0 },
    { ...shared, id: 'otm3', strikeValue: 3 },
  ]
}

export function shortLabel(p: BacktestParams): string {
  const dte = p.dte === 0 ? '0DTE' : `${p.dte}d`
  const strike = p.strikeMode === 'pct'
    ? (p.strikeValue === 0 ? 'ATM' : `${trimNum(p.strikeValue)}%`)
    : p.strikeMode === 'delta'
      ? `${trimNum(p.strikeValue)}Δ`
      : `${trimNum(p.strikeValue)}pt`
  return `${dte} ${strike} ${trimNum(p.width)}w`
}

function trimNum(n: number): string {
  if (!Number.isFinite(n)) return '—'
  return String(Math.round(n * 1000) / 1000)
}
