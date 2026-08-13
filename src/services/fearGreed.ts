/**
 * Fetch crypto + stock Fear & Greed readings via the /api/fear-greed proxy.
 */

const PROXY = 'https://options-jade.vercel.app'

export interface FearGreedReading {
  value: number
  classification?: string
  rating?: string
  timestamp: number
}

export interface FearGreedData {
  crypto: FearGreedReading | null
  stocks: FearGreedReading | null
}

export async function fetchFearGreed(): Promise<FearGreedData> {
  try {
    const res = await fetch(`${PROXY}/api/fear-greed`, { signal: AbortSignal.timeout(15000) })
    if (!res.ok) return { crypto: null, stocks: null }
    return await res.json() as FearGreedData
  } catch {
    return { crypto: null, stocks: null }
  }
}
