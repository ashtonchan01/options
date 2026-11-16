import type { IntradayBar, SessionBar } from './engine'
import { barsToIntraday, mergeDailyBars, tupleToSession, type DailyTuple } from './series'

export interface DailyFile {
  built: string
  from: string
  to: string
  rows: number
  closeOnlyDays: number
  sources: { spxClose: string; spxOhlc: string; vix: string; note: string }
  bars: DailyTuple[]
}

export interface IntradayFile {
  source: string
  minuteOrigin: string
  from: string
  to: string
  days: [string, number[][]][]
}

export interface MarketBundle {
  sessions: SessionBar[]
  intra: Map<string, IntradayBar[]>
  bars: DailyTuple[]
  dailyFrom: string
  dailyTo: string
  intraFrom: string | null
  intraTo: string | null
  built: string
  note: string
  fiveMinSource: string
}

async function gunzipJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Could not load ${url} (${res.status})`)
  const bytes = new Uint8Array(await res.arrayBuffer())
  // Vite (and some CDNs) set Content-Encoding: gzip on a .gz file, so the
  // browser has already inflated it and the body is plain JSON.
  const alreadyPlain = bytes.length < 2 || bytes[0] !== 0x1f || bytes[1] !== 0x8b
  if (alreadyPlain) return JSON.parse(new TextDecoder().decode(bytes)) as T
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This browser cannot read the compressed market data.')
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
  return await new Response(stream).json() as T
}

export async function loadMarket(): Promise<MarketBundle> {
  const [daily, intra, tail] = await Promise.all([
    gunzipJson<DailyFile>('/data/spx_vix_daily.json.gz'),
    gunzipJson<IntradayFile>('/data/spx_5min.json.gz'),
    fetch('/api/market-history', { credentials: 'include' })
      .then(async res => (res.ok ? await res.json() as { bars?: DailyTuple[] } : { bars: [] }))
      .catch(() => ({ bars: [] as DailyTuple[] })),
  ])
  const bars = mergeDailyBars(daily.bars, tail.bars ?? [])
  const sessions = bars.map(tupleToSession)
  return {
    sessions,
    intra: barsToIntraday(intra.days),
    bars,
    dailyFrom: sessions[0]?.date ?? daily.from,
    dailyTo: sessions[sessions.length - 1]?.date ?? daily.to,
    intraFrom: intra.from,
    intraTo: intra.to,
    built: daily.built,
    note: daily.sources.note,
    fiveMinSource: intra.source,
  }
}

export async function fetchNewerBars(since: string): Promise<{ bars: DailyTuple[]; persisted: boolean; note?: string; error?: string }> {
  const res = await fetch('/api/market-history', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ since }),
  })
  const body = await res.json().catch(() => ({})) as { bars?: DailyTuple[]; persisted?: boolean; note?: string; error?: string }
  if (res.status === 401) return { bars: [], persisted: false, error: 'Sign in to update the saved data.' }
  if (!res.ok) return { bars: [], persisted: false, error: body.error || 'Could not fetch the latest sessions.' }
  return { bars: body.bars ?? [], persisted: body.persisted !== false, note: body.note }
}
