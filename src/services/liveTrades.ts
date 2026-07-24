export interface LiveTrade {
  tradeId: string
  symbol: string
  description: string
  secType: string
  side: string
  size: number
  price: number
  commission: number
  netAmount: number
  realizedPnl: number
  tradeTime: string   // ISO string from CPAPI
  exchange: string
}

export class LiveProxyUnconfiguredError extends Error {}

/**
 * Fetches recent trades directly from IB Gateway (via the local proxy +
 * ngrok tunnel), bypassing Flex's ~day-old lag. These are informational only
 * — CPAPI doesn't return strike/expiry/putCall, so they can't feed the
 * position-matching classifier/journal (that stays on Flex).
 */
export async function fetchLiveTrades(proxyUrl: string): Promise<LiveTrade[]> {
  if (!proxyUrl) throw new LiveProxyUnconfiguredError('No live proxy URL configured')

  const res = await fetch(`${proxyUrl}/live/trades`)
  const text = await res.text()

  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try {
      const b = JSON.parse(text) as { error?: string }
      if (b.error) msg = b.error
    } catch { msg = text.slice(0, 200) }
    throw new Error(msg)
  }

  const body = JSON.parse(text) as { trades: LiveTrade[] }
  return body.trades ?? []
}

/** True if the trade happened today (local time). */
export function isToday(iso: string): boolean {
  const t = new Date(iso)
  if (isNaN(t.getTime())) return false
  const now = new Date()
  return t.getFullYear() === now.getFullYear() && t.getMonth() === now.getMonth() && t.getDate() === now.getDate()
}
