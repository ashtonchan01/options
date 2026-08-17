/**
 * Mean-reversion Buy/Sell read on RSI(14) — a bounded oscillator that's
 * already the standard "how stretched is this vs its own recent range"
 * signal. Always resolves to one side or the other (no neutral "Hold" —
 * with everything landing there most of the time, a three-way split wasn't
 * actionable): below the 50 midpoint reads relatively oversold → Buy,
 * at/above it reads relatively overbought → Sell. Shared between the
 * Watchlist and Allocation tables so both read the same threshold/styling.
 */
export type Signal = 'buy' | 'sell'

export function meanReversionSignal(rsi: number | null): Signal | null {
  if (rsi == null) return null
  return rsi < 50 ? 'buy' : 'sell'
}

export const SIGNAL_STYLE: Record<Signal, { label: string; color: string; bg: string; border: string }> = {
  buy: { label: 'BUY', color: '#10b981', bg: '#10b98115', border: '#10b98140' },
  sell: { label: 'SELL', color: '#ef4444', bg: '#ef444415', border: '#ef444440' },
}
