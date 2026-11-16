import type { BacktestResult, Trade } from './engine'

export function money(n: number, digits = 0): string {
  const abs = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
  return (n < 0 ? '-$' : '$') + abs
}

export function pct(n: number | null, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return `${(n * 100).toFixed(digits)}%`
}

export function pts(n: number | null, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return n.toFixed(digits)
}

/** Total P&L divided by the average trade's max loss. */
export function riskMultiple(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return `${n.toFixed(1)}×`
}

export function profitFactor(n: number | null): string {
  if (n == null) return '—'
  if (!Number.isFinite(n)) return '∞'
  return n.toFixed(2)
}

export function pathNote(results: readonly BacktestResult[], intraFrom: string | null, intraTo: string | null): string {
  const intra = results.reduce((s, r) => s + r.path.intraday, 0)
  const close = results.reduce((s, r) => s + r.path.close, 0)
  if (intra === 0) {
    return 'Stops are close-based. No 5-minute bar covers these trades, so a 0DTE position is held to the settlement print and the daily low is ignored.'
  }
  if (close === 0) {
    return `Stops use the saved 5-minute bars${intraFrom ? ` (${intraFrom} to ${intraTo})` : ''}. A short-strike stop watches the bar low. A credit multiple or take-profit is marked on the bar, and the worse one wins if both could have filled.`
  }
  return `Stops use 5-minute bars from ${intraFrom} to ${intraTo}. Outside that window they are the daily close, and the daily low is not a stop. A 0DTE trade with only a daily bar is held to settlement.`
}

function cell(value: string | number): string {
  const text = String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function tradesToCsv(trades: readonly Trade[]): string {
  const headers = [
    'entry', 'expiry', 'exit', 'targetDte', 'actualDte', 'snapped', 'settle',
    'entrySpot', 'exitSpot', 'shortStrike', 'longStrike', 'vix',
    'modelCredit', 'netCredit', 'exitDebit', 'contracts', 'pnl', 'risk',
    'exitReason', 'stopBasis',
  ]
  const lines = trades.map(t => [
    t.entryDate, t.expiryDate, t.exitDate, t.targetDte, t.actualDte, t.snapped ? 'yes' : 'no', t.settle,
    t.entrySpot, t.exitSpot, t.shortK, t.longK, t.entryVix.toFixed(2),
    t.modelCredit.toFixed(4), t.netCredit.toFixed(4), t.exitDebit.toFixed(4), t.contracts,
    t.pnl.toFixed(2), t.risk.toFixed(2), t.exitReason, t.stopBasis,
  ].map(cell).join(','))
  return [headers.join(','), ...lines].join('\n')
}
