import { ANALYST_TARGET_WINDOW_MS } from '../analystTargetWindow.js'

/** Financial Modeling Prep price-target API — swap-in when Yahoo is unreliable. */
export async function fetchFmpAnalystTargets(symbol) {
  const key = process.env.FMP_API_KEY
  if (!key) return null

  try {
    const url = `https://financialmodelingprep.com/stable/price-target-consensus?symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(key)}`
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
    if (!res.ok) return null
    const consensus = await res.json()
    const row = Array.isArray(consensus) ? consensus[0] : consensus
    if (!row) return { summary: null, rows: [] }

    const summary = {
      median: row.targetMedian ?? row.median ?? null,
      high: row.targetHigh ?? row.high ?? null,
      low: row.targetLow ?? row.low ?? null,
      count: row.analystCount ?? row.numberOfAnalysts ?? null,
    }

    const histUrl = `https://financialmodelingprep.com/stable/price-target?symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(key)}`
    const hres = await fetch(histUrl, { signal: AbortSignal.timeout(15000) })
    const hist = hres.ok ? await hres.json() : []
    const cutoff = Date.now() - ANALYST_TARGET_WINDOW_MS
    const byFirm = new Map()
    for (const h of Array.isArray(hist) ? hist : []) {
      const firm = (h.analystCompany || h.company || '').trim()
      if (!firm) continue
      const published = h.publishedDate || h.date
      const ts = published ? Date.parse(published) : NaN
      if (!Number.isFinite(ts) || ts < cutoff) continue
      const priceTarget = Number(h.priceTarget ?? h.adjPriceTarget)
      if (!Number.isFinite(priceTarget) || priceTarget <= 0) continue
      const prev = byFirm.get(firm)
      if (!prev || ts > prev.ts) {
        byFirm.set(firm, {
          firm,
          analystName: h.analystName || '',
          priceTarget,
          previousTarget: null,
          rating: null,
          action: 'Reiterated',
          date: new Date(ts).toISOString().slice(0, 10),
          source: 'live',
          ts,
        })
      }
    }
    const rows = [...byFirm.values()]
      .sort((a, b) => b.date.localeCompare(a.date))
      .map(({ ts: _t, ...rest }) => rest)

    return { summary, rows }
  } catch {
    return null
  }
}