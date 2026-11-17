import { resolveAnalystTargetProvider, fetchLiveAnalystTargetsForSymbol } from './analystTargetProviders/index.js'
import { toYahooSymbol } from './symbolAliases.js'
import { ANALYST_TARGET_SEEDS } from './analystTargetSeed.js'
import { filterAnalystRowsInWindow } from './analystTargetWindow.js'

const CACHE_TTL_MS = 12 * 60 * 60 * 1000
const CACHE_FAIL_TTL_MS = 10 * 60 * 1000
const ACTIONS = new Set(['Assigned', 'Reiterated', 'Raised', 'Lowered', 'Initiated'])
const RATINGS = new Set(['BUY', 'HOLD', 'SELL'])

function rowToJson(row, { isManual = false, source = 'manual' } = {}) {
  return {
    id: row.id,
    ticker: row.ticker,
    analystName: row.analyst_name ?? '',
    firm: row.firm ?? '',
    starRating: row.star_rating == null ? null : Number(row.star_rating),
    rating: row.rating ?? null,
    priceTarget: Number(row.price_target),
    previousTarget: row.previous_target == null ? null : Number(row.previous_target),
    action: row.action,
    date: row.target_date instanceof Date
      ? row.target_date.toISOString().slice(0, 10)
      : String(row.target_date).slice(0, 10),
    sourceNote: row.source_note ?? '',
    source: row.source ?? source,
    isManual: row.is_manual === true || isManual,
  }
}

function liveRowToJson(ticker, row) {
  return {
    id: `live:${ticker}:${row.firm}:${row.date}`,
    ticker,
    analystName: row.analystName ?? '',
    firm: row.firm,
    starRating: null,
    rating: row.rating ?? null,
    priceTarget: row.priceTarget,
    previousTarget: row.previousTarget ?? null,
    action: row.action,
    date: row.date,
    sourceNote: '',
    source: row.source ?? 'live',
    isManual: false,
  }
}

function parseBodyFields(body) {
  const ticker = typeof body.ticker === 'string' ? body.ticker.trim().toUpperCase() : ''
  if (!ticker) return { error: 'ticker required' }

  const priceTarget = Number(body.priceTarget)
  if (!Number.isFinite(priceTarget) || priceTarget <= 0) return { error: 'priceTarget required' }

  const action = body.action
  if (typeof action !== 'string' || !ACTIONS.has(action)) return { error: 'invalid action' }

  const date = typeof body.date === 'string' ? body.date.trim() : ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: 'date required (YYYY-MM-DD)' }

  const rating = body.rating == null || body.rating === '' ? null : body.rating
  if (rating != null && !RATINGS.has(rating)) return { error: 'invalid rating' }

  let starRating = body.starRating
  if (starRating === '' || starRating == null) {
    starRating = null
  } else {
    starRating = Number(starRating)
    if (!Number.isInteger(starRating) || starRating < 0 || starRating > 5) return { error: 'starRating 0-5' }
  }

  const previousTarget = body.previousTarget == null || body.previousTarget === ''
    ? null
    : Number(body.previousTarget)
  if (previousTarget != null && (!Number.isFinite(previousTarget) || previousTarget <= 0)) {
    return { error: 'invalid previousTarget' }
  }

  const analystName = typeof body.analystName === 'string' ? body.analystName.trim() : ''
  const firm = typeof body.firm === 'string' ? body.firm.trim() : ''
  const sourceNote = typeof body.sourceNote === 'string' ? body.sourceNote.trim() : ''

  return {
    ticker,
    analyst_name: analystName || null,
    firm: firm || null,
    star_rating: starRating,
    rating,
    price_target: priceTarget,
    previous_target: previousTarget,
    action,
    target_date: date,
    source_note: sourceNote || null,
  }
}

function seedRowsForTicker(ticker) {
  return ANALYST_TARGET_SEEDS
    .filter(s => s.ticker === ticker)
    .map(s => ({
      id: `seed:${s.seed_key}`,
      ticker: s.ticker,
      analystName: s.analyst_name ?? '',
      firm: s.firm ?? '',
      starRating: s.star_rating,
      rating: s.rating,
      priceTarget: s.price_target,
      previousTarget: s.previous_target,
      action: s.action,
      date: s.target_date,
      sourceNote: s.source_note ?? '',
      source: 'seed',
      isManual: false,
    }))
}

function medianFromTargets(rows) {
  const pts = rows.map(r => r.priceTarget).filter(n => Number.isFinite(n))
  if (pts.length === 0) return null
  const sorted = [...pts].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2
  return sorted[mid]
}

export function statsFromDisplayRows(rows) {
  const pts = rows
    .filter(r => !r.isManual && r.source !== 'manual')
    .map(r => r.priceTarget)
    .filter(n => Number.isFinite(n) && n > 0)
  if (!pts.length) return { median: null, high: null, low: null, count: null }
  return {
    median: medianFromTargets(rows.filter(r => !r.isManual && r.source !== 'manual')),
    high: Math.max(...pts),
    low: Math.min(...pts),
    count: pts.length,
  }
}

export function countNamedFirmRows(rows) {
  const firms = new Set()
  for (const r of rows ?? []) {
    if (r.isManual) continue
    const firm = (r.firm || '').trim().toLowerCase()
    if (!firm) continue
    const pt = Number(r.priceTarget)
    if (!Number.isFinite(pt) || pt <= 0) continue
    firms.add(firm)
  }
  return firms.size > 0 ? firms.size : null
}

export function buildSummary(summary, rows, fetchedAt, nowMs = Date.now()) {
  const inWindow = filterAnalystRowsInWindow(rows, nowMs)
  const autoRows = inWindow.filter(r => !r.isManual && r.source !== 'manual')
  const namedFirmCount = countNamedFirmRows(inWindow)

  if (autoRows.length === 0) {
    return {
      median: null,
      high: null,
      low: null,
      count: null,
      namedFirmCount: namedFirmCount && inWindow.some(r => !r.isManual) ? namedFirmCount : null,
      fetchedAt: fetchedAt ?? null,
    }
  }

  const fromRows = statsFromDisplayRows(inWindow)
  return {
    median: fromRows.median,
    high: fromRows.high,
    low: fromRows.low,
    count: fromRows.count,
    namedFirmCount,
    fetchedAt: fetchedAt ?? null,
  }
}

function cacheHasLivePayload(summary, rows) {
  if ((rows?.length ?? 0) > 0) return true
  if (!summary) return false
  return (
    summary.median != null ||
    summary.high != null ||
    summary.low != null ||
    (summary.count != null && summary.count > 0)
  )
}

async function loadCache(sql, ticker) {
  const rows = await sql`
    SELECT summary, rows, fetched_at
    FROM analyst_target_live_cache
    WHERE ticker = ${ticker}
  `
  if (!rows[0]) return null
  const fetchedAt = rows[0].fetched_at
  const age = Date.now() - new Date(fetchedAt).getTime()
  const hasData = cacheHasLivePayload(rows[0].summary, rows[0].rows)
  const ttl = hasData ? CACHE_TTL_MS : CACHE_FAIL_TTL_MS
  return {
    summary: rows[0].summary,
    rows: rows[0].rows,
    fetchedAt: fetchedAt instanceof Date ? fetchedAt.toISOString() : String(fetchedAt),
    fresh: age < ttl,
    hasData,
  }
}

async function saveCache(sql, ticker, summary, rows, fetchedAt) {
  await sql`
    INSERT INTO analyst_target_live_cache (ticker, summary, rows, fetched_at)
    VALUES (${ticker}, ${JSON.stringify(summary)}, ${JSON.stringify(rows)}, ${fetchedAt})
    ON CONFLICT (ticker) DO UPDATE SET
      summary = ${JSON.stringify(summary)},
      rows = ${JSON.stringify(rows)},
      fetched_at = ${fetchedAt}
  `
}

async function loadManualRows(sql, tickers) {
  const rows = await sql`
    SELECT *
    FROM analyst_price_targets
    WHERE ticker = ANY(${tickers}) AND is_manual = true
    ORDER BY target_date DESC
  `
  const byTicker = {}
  for (const t of tickers) byTicker[t] = []
  for (const row of rows) {
    byTicker[row.ticker]?.push(rowToJson(row, { isManual: true, source: 'manual' }))
  }
  return byTicker
}

async function resolveTickerLive(sql, ticker, forceRefresh, provider, crumbState) {
  let cached = await loadCache(sql, ticker)
  if (cached?.fresh && !forceRefresh) {
    return {
      summary: cached.summary,
      liveRows: cached.rows,
      fetchedAt: cached.fetchedAt,
      dataSource: 'live',
    }
  }

  const yahooSym = toYahooSymbol(ticker)
  try {
    const { summary, rows } = await fetchLiveAnalystTargetsForSymbol(yahooSym, provider, crumbState)
    const inWindowRows = filterAnalystRowsInWindow(rows)
    const fetchedAt = new Date().toISOString()
    const displayLive = inWindowRows.map(r => liveRowToJson(ticker, r))
    const windowSummary = buildSummary(null, displayLive, fetchedAt)
    if (cacheHasLivePayload(windowSummary, inWindowRows)) {
      await saveCache(sql, ticker, windowSummary, inWindowRows, fetchedAt)
      return { summary: windowSummary, liveRows: inWindowRows, fetchedAt, dataSource: 'live' }
    }
    await saveCache(sql, ticker, null, [], fetchedAt)
  } catch (err) {
    console.error('[analyst-targets] live fetch', ticker, err.message)
    if (cached?.hasData && !forceRefresh) {
      return {
        summary: cached.summary,
        liveRows: cached.rows,
        fetchedAt: cached.fetchedAt,
        dataSource: 'live-stale',
      }
    }
    await saveCache(sql, ticker, null, [], new Date().toISOString()).catch(() => {})
  }

  if (cached?.hasData) {
    return {
      summary: cached.summary,
      liveRows: cached.rows,
      fetchedAt: cached.fetchedAt,
      dataSource: 'live-stale',
    }
  }

  return { summary: null, liveRows: [], fetchedAt: null, dataSource: 'none' }
}

export function dedupeFirmRows(rows) {
  const byFirm = new Map()
  for (const row of rows) {
    const firmKey = (row.firm || '').trim().toLowerCase()
    if (!firmKey) continue
    const prev = byFirm.get(firmKey)
    if (!prev || (row.date ?? '').localeCompare(prev.date ?? '') > 0) {
      byFirm.set(firmKey, row)
    }
  }
  return [...byFirm.values()]
}

function mergeLiveWithSeeds(ticker, liveRows, seedJsonRows) {
  const jsonLive = (liveRows ?? []).map(r => liveRowToJson(ticker, r))
  return dedupeFirmRows([...jsonLive, ...seedJsonRows])
}

function mergeRows(ticker, liveRows, manualRows) {
  const jsonLive = (liveRows ?? []).map(r => liveRowToJson(ticker, r))
  const manualFirms = new Set(
    manualRows.map(r => (r.firm || '').toLowerCase()).filter(Boolean),
  )
  const withoutOverridden = jsonLive.filter(r => !manualFirms.has((r.firm || '').toLowerCase()))
  const combined = [...withoutOverridden, ...manualRows]
  combined.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
  return combined
}

export async function handleAnalystTargets(req, res, user, sql) {
  if (!user) return res.status(401).json({ error: 'Not signed in' })

  if (req.method === 'GET') {
    const tickersRaw = req.query?.tickers ?? ''
    const tickers = String(tickersRaw)
      .split(',')
      .map(t => t.trim().toUpperCase())
      .filter(Boolean)
      .slice(0, 40)
    if (tickers.length === 0) return res.status(400).json({ error: 'tickers required' })

    const forceRefresh = req.query?.refresh === '1' || req.query?.refresh === 'true'
    const provider = resolveAnalystTargetProvider()
    const crumbState = {}
    const manualByTicker = await loadManualRows(sql, tickers)

    const byTicker = {}
    for (const ticker of tickers) {
      const resolved = await resolveTickerLive(sql, ticker, forceRefresh, provider, crumbState)
      const seeds = seedRowsForTicker(ticker)
      const mergedLive = mergeLiveWithSeeds(ticker, resolved.liveRows, seeds)
      const allRows = mergeRows(ticker, mergedLive, manualByTicker[ticker] ?? [])
      const rows = filterAnalystRowsInWindow(allRows)
      const summary = buildSummary(resolved.summary, rows, resolved.fetchedAt)
      const dataSource =
        resolved.dataSource === 'live' || resolved.dataSource === 'live-stale'
          ? resolved.dataSource
          : (resolved.liveRows?.length ?? 0) > 0
            ? 'live'
            : seeds.length > 0
              ? 'seed'
              : resolved.dataSource
      byTicker[ticker] = {
        summary,
        rows,
        provider,
        dataSource,
      }
    }

    return res.status(200).json({ byTicker, provider })
  }

  if (req.method === 'POST') {
    const parsed = parseBodyFields(req.body ?? {})
    if (parsed.error) return res.status(400).json({ error: parsed.error })
    const rows = await sql`
      INSERT INTO analyst_price_targets (
        ticker, analyst_name, firm, star_rating, rating,
        price_target, previous_target, action, target_date, source_note, is_manual
      ) VALUES (
        ${parsed.ticker},
        ${parsed.analyst_name},
        ${parsed.firm},
        ${parsed.star_rating},
        ${parsed.rating},
        ${parsed.price_target},
        ${parsed.previous_target},
        ${parsed.action},
        ${parsed.target_date},
        ${parsed.source_note},
        true
      )
      RETURNING *
    `
    return res.status(201).json({ target: rowToJson(rows[0], { isManual: true, source: 'manual' }) })
  }

  if (req.method === 'PUT') {
    const id = req.body?.id
    if (typeof id !== 'string' || !id) return res.status(400).json({ error: 'id required' })
    const parsed = parseBodyFields(req.body ?? {})
    if (parsed.error) return res.status(400).json({ error: parsed.error })
    const rows = await sql`
      UPDATE analyst_price_targets SET
        ticker = ${parsed.ticker},
        analyst_name = ${parsed.analyst_name},
        firm = ${parsed.firm},
        star_rating = ${parsed.star_rating},
        rating = ${parsed.rating},
        price_target = ${parsed.price_target},
        previous_target = ${parsed.previous_target},
        action = ${parsed.action},
        target_date = ${parsed.target_date},
        source_note = ${parsed.source_note},
        is_manual = true,
        updated_at = now()
      WHERE id = ${id}::uuid AND is_manual = true
      RETURNING *
    `
    if (!rows[0]) return res.status(404).json({ error: 'not found' })
    return res.status(200).json({ target: rowToJson(rows[0], { isManual: true, source: 'manual' }) })
  }

  if (req.method === 'DELETE') {
    const id = req.query?.id ?? req.body?.id
    if (typeof id !== 'string' || !id) return res.status(400).json({ error: 'id required' })
    const rows = await sql`
      DELETE FROM analyst_price_targets WHERE id = ${id}::uuid AND is_manual = true RETURNING id
    `
    if (!rows[0]) return res.status(404).json({ error: 'not found' })
    return res.status(200).json({ ok: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}