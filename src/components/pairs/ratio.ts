/** Pure ratio math for the Pairs page. No network, no orders. */

export interface RatioPoint {
  t: number
  date: string
  ratio: number
}

export interface Bands {
  top: number
  bottom: number
}

export interface RatioSignal {
  index: number
  side: 'top' | 'bottom'
}

export function dayKey(unixSec: number): string {
  return new Date(unixSec * 1000).toISOString().slice(0, 10)
}

/** Inner-join two daily close series on calendar day and divide A by B. */
export function buildRatio(
  a: { t: number[]; c: number[] } | undefined,
  b: { t: number[]; c: number[] } | undefined,
): RatioPoint[] {
  if (!a || !b) return []
  const bByDay = new Map<string, number>()
  for (let i = 0; i < b.t.length; i++) {
    if (b.c[i] > 0) bByDay.set(dayKey(b.t[i]), b.c[i])
  }
  const out: RatioPoint[] = []
  for (let i = 0; i < a.t.length; i++) {
    const closeB = bByDay.get(dayKey(a.t[i]))
    if (closeB == null || !(a.c[i] > 0)) continue
    out.push({ t: a.t[i], date: dayKey(a.t[i]), ratio: a.c[i] / closeB })
  }
  return out
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return NaN
  const sorted = [...values].sort((x, y) => x - y)
  const idx = (sorted.length - 1) * p
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sorted[lo]
  return sorted[lo] * (hi - idx) + sorted[hi] * (idx - lo)
}

/** Horizontal bands: 10th and 90th percentile of the lookback ratio.
 *  A single spike does not set the line, matching hand-drawn range lines. */
export function autoBands(points: RatioPoint[]): Bands | null {
  if (points.length < 10) return null
  const ratios = points.map(p => p.ratio)
  const bottom = percentile(ratios, 0.1)
  const top = percentile(ratios, 0.9)
  if (!(top > bottom)) return null
  return { top, bottom }
}

export function mean(values: number[]): number {
  if (values.length === 0) return NaN
  let s = 0
  for (const v of values) s += v
  return s / values.length
}

export function stdev(values: number[]): number {
  if (values.length < 2) return NaN
  const m = mean(values)
  let s = 0
  for (const v of values) s += (v - m) ** 2
  return Math.sqrt(s / (values.length - 1))
}

export function zScore(value: number, values: number[]): number | null {
  const sd = stdev(values)
  if (!Number.isFinite(sd) || sd === 0) return null
  return (value - mean(values)) / sd
}

/** Rolling z-score of the ratio (window 20). Null until the window fills. */
export function rollingZ(points: RatioPoint[], window = 20): (number | null)[] {
  return points.map((_, i) => {
    if (i + 1 < window) return null
    const slice = points.slice(i + 1 - window, i + 1).map(p => p.ratio)
    return zScore(points[i].ratio, slice)
  })
}

/** Position of the ratio inside the band, 0 at the bottom and 100 at the top. */
export function rangePosition(ratio: number, bands: Bands): number {
  return ((ratio - bands.bottom) / (bands.top - bands.bottom)) * 100
}

/** First bar that touches or crosses each band after being on the inside. */
export function bandSignals(points: RatioPoint[], bands: Bands): RatioSignal[] {
  const out: RatioSignal[] = []
  for (let i = 0; i < points.length; i++) {
    const cur = points[i].ratio
    const prev = i === 0 ? null : points[i - 1].ratio
    if (cur >= bands.top && (prev == null || prev < bands.top)) out.push({ index: i, side: 'top' })
    if (cur <= bands.bottom && (prev == null || prev > bands.bottom)) out.push({ index: i, side: 'bottom' })
  }
  return out
}

export function fmtRatio(n: number): string {
  if (!Number.isFinite(n)) return '—'
  const abs = Math.abs(n)
  const digits = abs >= 100 ? 2 : abs >= 1 ? 3 : 4
  return n.toFixed(digits)
}
