/** Black-Scholes puts. Index options: dividend yield q, European exercise. */

export function normCDF(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x))
  const d = 0.3989422804014327 * Math.exp(-0.5 * x * x)
  const p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))))
  return x > 0 ? 1 - p : p
}

export function bsmPut(spot: number, strike: number, t: number, r: number, q: number, iv: number): number {
  if (spot <= 0 || strike <= 0) return 0
  if (t <= 1e-10 || iv <= 0) return Math.max(strike - spot, 0)
  const vol = iv * Math.sqrt(t)
  const d1 = (Math.log(spot / strike) + (r - q + 0.5 * iv * iv) * t) / vol
  const d2 = d1 - vol
  const dfR = Math.exp(-r * t)
  const dfQ = Math.exp(-q * t)
  return strike * dfR * normCDF(-d2) - spot * dfQ * normCDF(-d1)
}

/** Put delta, negative. */
export function bsmPutDelta(spot: number, strike: number, t: number, r: number, q: number, iv: number): number {
  if (spot <= 0 || strike <= 0) return 0
  if (t <= 1e-10 || iv <= 0) return spot < strike ? -1 : 0
  const vol = iv * Math.sqrt(t)
  const d1 = (Math.log(spot / strike) + (r - q + 0.5 * iv * iv) * t) / vol
  return -Math.exp(-q * t) * normCDF(-d1)
}

/** Base annualized vol (decimal) plus skew slope for OTM puts. */
export function legIv(baseVol: number, spot: number, strike: number, skewPerPct: number): number {
  const otmPct = spot > 0 ? Math.max(0, ((spot - strike) / spot) * 100) : 0
  const iv = baseVol + (Math.max(0, skewPerPct) / 100) * otmPct
  return Math.min(3, Math.max(0.03, iv))
}

/** @deprecated Use legIv — kept for tests that pass VIX as percent. */
export function skewedIv(vix: number, spot: number, strike: number, skewPerPct: number): number {
  return legIv(vix / 100, spot, strike, skewPerPct)
}

export function roundStrike(price: number, step = 5): number {
  return Math.max(step, Math.round(price / step) * step)
}

export function spreadIntrinsic(spot: number, shortK: number, longK: number): number {
  const width = shortK - longK
  const raw = Math.max(0, shortK - spot) - Math.max(0, longK - spot)
  return Math.min(width, Math.max(0, raw))
}

export function spreadMark(
  spot: number,
  shortK: number,
  longK: number,
  t: number,
  r: number,
  q: number,
  baseVol: number,
  skewPerPct: number,
): number {
  const width = shortK - longK
  if (width <= 0) return 0
  if (t <= 1e-10) return spreadIntrinsic(spot, shortK, longK)
  const ivS = legIv(baseVol, spot, shortK, skewPerPct)
  const ivL = legIv(baseVol, spot, longK, skewPerPct)
  const px = bsmPut(spot, shortK, t, r, q, ivS) - bsmPut(spot, longK, t, r, q, ivL)
  return Math.min(width, Math.max(0, px))
}

export function strikeFromDelta(
  spot: number,
  targetAbs: number,
  t: number,
  r: number,
  q: number,
  baseVol: number,
  skewPerPct: number,
): number {
  const target = -Math.min(0.99, Math.max(0.01, targetAbs))
  let bestK = roundStrike(spot)
  let bestErr = Infinity
  const floorK = Math.max(5, roundStrike(spot * 0.4))
  for (let k = bestK; k >= floorK; k -= 5) {
    const iv = legIv(baseVol, spot, k, skewPerPct)
    const delta = bsmPutDelta(spot, k, t, r, q, iv)
    const err = Math.abs(delta - target)
    if (err < bestErr) {
      bestErr = err
      bestK = k
    }
    if (delta > target && bestErr < 0.02) break
  }
  return bestK
}

export function selectShortStrike(
  spot: number,
  mode: 'pct' | 'delta' | 'points',
  value: number,
  t: number,
  r: number,
  q: number,
  baseVol: number,
  skewPerPct: number,
): number {
  if (mode === 'pct') return roundStrike(spot * (1 + value / 100))
  if (mode === 'points') return roundStrike(spot - value)
  return strikeFromDelta(spot, value, t, r, q, baseVol, skewPerPct)
}
