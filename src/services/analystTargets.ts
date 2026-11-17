export type AnalystRating = 'BUY' | 'HOLD' | 'SELL'
export type AnalystAction = 'Assigned' | 'Reiterated' | 'Raised' | 'Lowered' | 'Initiated'
export type AnalystRowSource = 'live' | 'manual' | 'seed'

export interface AnalystPriceTarget {
  id: string
  ticker: string
  analystName: string
  firm: string
  starRating: number | null
  rating: AnalystRating | null
  priceTarget: number
  previousTarget: number | null
  action: AnalystAction
  date: string
  sourceNote: string
  source: AnalystRowSource
  isManual: boolean
}

export interface AnalystTargetSummary {
  median: number | null
  high: number | null
  low: number | null
  count: number | null
  fetchedAt: string | null
}

export interface AnalystTickerBundle {
  summary: AnalystTargetSummary
  rows: AnalystPriceTarget[]
  provider?: string
  dataSource?: string
}

export interface AnalystTargetInput {
  ticker: string
  analystName?: string
  firm?: string
  starRating?: number | null
  rating?: AnalystRating | null
  priceTarget: number
  previousTarget?: number | null
  action: AnalystAction
  date: string
  sourceNote?: string
}

export function upsidePct(price: number | null | undefined, target: number): number | null {
  if (price == null || !Number.isFinite(price) || price <= 0) return null
  return ((target - price) / price) * 100
}

const ANALYST_CACHE_KEY = 'options:analyst-target-bundles'

type AnalystBundleStore = Record<string, AnalystTickerBundle>

function readAnalystBundleStore(): AnalystBundleStore {
  try {
    const raw = localStorage.getItem(ANALYST_CACHE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as AnalystBundleStore
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/** Bundles for the given tickers from localStorage (instant first paint). */
export function loadCachedAnalystBundles(tickers: string[]): Record<string, AnalystTickerBundle> {
  if (tickers.length === 0) return {}
  const store = readAnalystBundleStore()
  const out: Record<string, AnalystTickerBundle> = {}
  for (const t of tickers) {
    const b = store[t]
    if (b) out[t] = b
  }
  return out
}

export function persistAnalystBundles(partial: Record<string, AnalystTickerBundle>): void {
  const keys = Object.keys(partial)
  if (keys.length === 0) return
  try {
    const store = readAnalystBundleStore()
    for (const t of keys) store[t] = partial[t]
    localStorage.setItem(ANALYST_CACHE_KEY, JSON.stringify(store))
  } catch {
    /* quota / private mode */
  }
}

export function analystBundleHasPtData(bundle: AnalystTickerBundle | undefined): boolean {
  const s = bundle?.summary
  if (!s) return false
  return s.median != null || s.high != null || s.low != null || (s.count != null && s.count > 0)
}

/** Background revalidate batch size (tickers per API call). */
export const ANALYST_REVALIDATE_BATCH = 4

export async function fetchAnalystTargets(
  tickers: string[],
  refresh = false,
): Promise<Record<string, AnalystTickerBundle>> {
  if (tickers.length === 0) return {}
  try {
    const q = new URLSearchParams({
      resource: 'analyst-targets',
      tickers: tickers.join(','),
    })
    if (refresh) q.set('refresh', '1')
    const res = await fetch(`/api/user-data?${q}`, { credentials: 'include' })
    if (!res.ok) return {}
    const data = (await res.json()) as { byTicker?: Record<string, AnalystTickerBundle> }
    return data.byTicker ?? {}
  } catch {
    return {}
  }
}

export async function createAnalystTarget(input: AnalystTargetInput): Promise<AnalystPriceTarget | null> {
  const res = await fetch('/api/user-data', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resource: 'analyst-targets', ...input }),
  })
  if (!res.ok) return null
  const data = (await res.json()) as { target?: AnalystPriceTarget }
  return data.target ?? null
}

export async function updateAnalystTarget(id: string, input: AnalystTargetInput): Promise<AnalystPriceTarget | null> {
  const res = await fetch('/api/user-data', {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resource: 'analyst-targets', id, ...input }),
  })
  if (!res.ok) return null
  const data = (await res.json()) as { target?: AnalystPriceTarget }
  return data.target ?? null
}

export async function deleteAnalystTarget(id: string): Promise<boolean> {
  const res = await fetch(
    `/api/user-data?resource=analyst-targets&id=${encodeURIComponent(id)}`,
    { method: 'DELETE', credentials: 'include' },
  )
  return res.ok
}