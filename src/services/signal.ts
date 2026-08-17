/**
 * Mean-reversion Buy/Sell/Hold read on RSI(14) — a bounded oscillator that's
 * already the standard "how stretched is this vs its own recent range"
 * signal: deeply oversold (<=30) tends to snap back up (Buy), deeply
 * overbought (>=70) tends to snap back down (Sell). Shared between the
 * Watchlist and Allocation tables so both read the same thresholds/styling.
 */
export type Signal = 'buy' | 'sell' | 'hold'

export function meanReversionSignal(rsi: number | null): Signal | null {
  if (rsi == null) return null
  if (rsi <= 30) return 'buy'
  if (rsi >= 70) return 'sell'
  return 'hold'
}

export const SIGNAL_STYLE: Record<Signal, { label: string; color: string; bg: string; border: string }> = {
  buy: { label: 'BUY', color: '#10b981', bg: '#10b98115', border: '#10b98140' },
  sell: { label: 'SELL', color: '#ef4444', bg: '#ef444415', border: '#ef444440' },
  hold: { label: 'HOLD', color: '#F0B429', bg: '#F0B42915', border: '#F0B42940' },
}
