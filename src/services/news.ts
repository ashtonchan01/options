/**
 * Fetch world economic headlines through the /api/news proxy.
 */

const PROXY = 'https://options-jade.vercel.app'

export interface Headline {
  title: string
  link: string
  source: string
  time: number
}

export async function fetchHeadlines(): Promise<Headline[]> {
  try {
    const res = await fetch(`${PROXY}/api/news`, { signal: AbortSignal.timeout(15000) })
    if (!res.ok) return []
    return await res.json() as Headline[]
  } catch {
    return []
  }
}
