import type { Trade } from './engine'

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

function cell(value: string | number): string {
  const text = String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function tradesToCsv(trades: readonly Trade[]): string {
  const headers = [
    'entryDate', 'exitDate', 'expiryDate', 'targetDte', 'actualDte', 'snapped', 'settle',
    'spxAtEntry', 'spxAtExit', 'shortStrike', 'longStrike', 'entryVol',
    'modelCredit', 'creditAtEntry', 'debitAtExit', 'contracts', 'pnl', 'risk',
    'exitReason', 'stopBasis',
  ]
  const lines = trades.map(t => [
    t.entryDate, t.expiryDate, t.exitDate, t.targetDte, t.actualDte, t.snapped ? 'yes' : 'no', t.settle,
    t.entrySpot, t.exitSpot, t.shortK, t.longK, t.entryVol.toFixed(4),
    t.modelCredit.toFixed(4), t.netCredit.toFixed(4), t.exitDebit.toFixed(4), t.contracts,
    t.pnl.toFixed(2), t.risk.toFixed(2), t.exitReason, t.stopBasis,
  ].map(cell).join(','))
  return [headers.join(','), ...lines].join('\n')
}
