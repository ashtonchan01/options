import type { SessionBar } from './engine'

/** Trading days of log-return history for realized vol (fallback when VIX is missing). */
export const REALIZED_VOL_LOOKBACK = 21

/** Floor when history is flat or too short (annualized decimal, e.g. 0.12 = 12%). */
export const REALIZED_VOL_FLOOR = 0.12

/** VIX quotes ~30 calendar days of implied vol; lift longer-dated entries slightly. */
export const VIX_TERM_BASELINE_DTE = 30

/** Hidden term-structure lift applied above the VIX baseline (decimal, e.g. 0.10 = +10% at 60 DTE). */
export const VIX_TERM_SLOPE = 0.10

const ANNUALIZE = Math.sqrt(252)

/** Trailing realized vol from SPX closes (annualized decimal). Used only when VIX is missing. */
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

/** Implied-vol proxy from stored VIX, with a simple term lift for longer-dated spreads. */
export function markVolFromVix(vixClose: number, dte: number): number {
  const vixDec = vixClose > 0 ? vixClose / 100 : REALIZED_VOL_FLOOR
  const term = 1 + VIX_TERM_SLOPE * Math.max(0, (dte - VIX_TERM_BASELINE_DTE) / VIX_TERM_BASELINE_DTE)
  return Math.min(3, Math.max(REALIZED_VOL_FLOOR, vixDec * term))
}

/** Entry and mark vol for one session date; prefers VIX, then realized trailing vol. */
export function sessionMarkVol(session: SessionBar, dte: number, realizedFallback?: number): number {
  if (session.vixClose > 0) return markVolFromVix(session.vixClose, dte)
  if (realizedFallback != null && realizedFallback > 0) {
    return Math.max(REALIZED_VOL_FLOOR, realizedFallback)
  }
  return REALIZED_VOL_FLOOR
}