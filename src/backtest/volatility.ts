import type { SessionBar } from './engine'

/** Trading days of log-return history for annualized realized vol. */
export const REALIZED_VOL_LOOKBACK = 21

/** Floor when history is flat or too short (annualized decimal, e.g. 0.12 = 12%). */
export const REALIZED_VOL_FLOOR = 0.12

const ANNUALIZE = Math.sqrt(252)

/** Trailing realized vol from SPX closes at each session date (annualized decimal). */
export function buildRealizedVol(sessions: readonly SessionBar[]): Map<string, number> {
  const out = new Map<string, number>()
  const closes = sessions.map(s => s.close)
  for (let i = 0; i < sessions.length; i++) {
    const start = Math.max(1, i - REALIZED_VOL_LOOKBACK + 1)
    const rets: number[] = []
    for (let j = start; j <= i; j++) {
      const prev = closes[j - 1]
      const cur = closes[j]
      if (prev > 0 && cur > 0) rets.push(Math.log(cur / prev))
    }
    let vol = REALIZED_VOL_FLOOR
    if (rets.length >= 5) {
      const mean = rets.reduce((s, r) => s + r, 0) / rets.length
      const variance = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / rets.length
      vol = Math.max(REALIZED_VOL_FLOOR, Math.sqrt(variance) * ANNUALIZE)
    }
    out.set(sessions[i].date, vol)
  }
  return out
}