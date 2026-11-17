import { ANALYST_TARGET_WINDOW_MS } from '../analystTargetWindow.js'

function num(raw) {
  const n = raw?.raw ?? raw
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

function ymdFromEpoch(epochSec) {
  if (!epochSec || !Number.isFinite(epochSec)) return null
  return new Date(epochSec * 1000).toISOString().slice(0, 10)
}

function mapRating(grade) {
  if (!grade || typeof grade !== 'string') return null
  const g = grade.toLowerCase()
  if (g.includes('sell') || g.includes('underweight') || g.includes('reduce')) return 'SELL'
  if (g.includes('hold') || g.includes('neutral') || g.includes('equal')) return 'HOLD'
  if (g.includes('buy') || g.includes('overweight') || g.includes('outperform') || g.includes('positive')) return 'BUY'
  return null
}

function mapAction(action) {
  if (!action) return 'Reiterated'
  const a = String(action).toLowerCase()
  if (a === 'up' || a === 'upgrade') return 'Raised'
  if (a === 'down' || a === 'downgrade') return 'Lowered'
  if (a === 'init') return 'Initiated'
  if (a === 'reit' || a === 'reiterate') return 'Reiterated'
  if (a === 'main' || a === 'assume') return 'Assigned'
  return 'Reiterated'
}

function medianFromRows(rows) {
  const pts = rows.map(r => r.priceTarget).filter(n => Number.isFinite(n))
  if (pts.length === 0) return null
  const sorted = [...pts].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2
  return sorted[mid]
}

function processHistory(history) {
  const cutoff = Date.now() - ANALYST_TARGET_WINDOW_MS
  const byFirm = new Map()

  for (const h of history ?? []) {
    const epoch = h.epochGradeDate
    if (!epoch || epoch * 1000 < cutoff) continue
    const firm = (h.firm || h.company || '').trim()
    if (!firm) continue
    const priceTarget = num(h.currentPriceTarget) ?? num(h.priceTarget)
    if (priceTarget == null || priceTarget <= 0) continue
    const previousTarget = num(h.priorPriceTarget)
    const row = {
      firm,
      analystName: '',
      priceTarget,
      previousTarget: previousTarget != null && previousTarget > 0 ? previousTarget : null,
      rating: mapRating(h.toGrade),
      action: mapAction(h.action),
      date: ymdFromEpoch(epoch),
      source: 'live',
    }
    const prev = byFirm.get(firm)
    if (!prev || epoch > prev.epoch) byFirm.set(firm, { ...row, epoch })
  }

  return [...byFirm.values()]
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
    .map(({ epoch: _e, ...rest }) => rest)
}

function highLowFromRows(rows) {
  const pts = rows.map(r => r.priceTarget).filter(n => Number.isFinite(n) && n > 0)
  if (!pts.length) return { high: null, low: null }
  return { high: Math.max(...pts), low: Math.min(...pts) }
}

function summaryFromFinancial(fd, rows) {
  const fromPts = highLowFromRows(rows)
  const median = num(fd?.targetMedianPrice) ?? medianFromRows(rows)
  const high = num(fd?.targetHighPrice) ?? fromPts.high
  const low = num(fd?.targetLowPrice) ?? fromPts.low
  let count = num(fd?.numberOfAnalystOpinions)
  if (count == null && rows.length > 0) count = rows.length
  if (median == null && high == null && low == null && count == null) return null
  return { median, high, low, count }
}

export function parseYahooQuoteSummary(json) {
  const result = json?.quoteSummary?.result?.[0]
  if (!result) return { summary: null, rows: [] }
  const rows = processHistory(result.upgradeDowngradeHistory?.history)
  const summary = summaryFromFinancial(result.financialData, rows)
  return { summary, rows }
}