/**
 * Fetch Bloomberg headlines (Markets/Economics/Technology/Politics) through
 * the /api/bloomberg-news proxy, which reads Bloomberg's own public RSS
 * feeds server-side.
 */

const PROXY = 'https://options-jade.vercel.app'

export interface BloombergHeadline {
  section: string
  title: string
  link: string
  source: string
  time: number
  image?: string
}

export async function fetchBloombergNews(): Promise<BloombergHeadline[]> {
  try {
    const res = await fetch(`${PROXY}/api/bloomberg-news`, { signal: AbortSignal.timeout(15000) })
    if (!res.ok) return []
    return await res.json() as BloombergHeadline[]
  } catch {
    return []
  }
}
