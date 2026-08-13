/**
 * Fetch a reader-mode extraction of an article through the /api/article
 * proxy — plain title/byline/paragraphs, no ads/scripts/trackers from the
 * source page ever reach the client.
 */

const PROXY = 'https://options-jade.vercel.app'

export interface Article {
  title: string
  byline: string
  paragraphs: string[]
  url: string
}

export async function fetchArticle(url: string): Promise<Article | null> {
  try {
    const res = await fetch(`${PROXY}/api/article?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(15000) })
    if (!res.ok) return null
    const data = await res.json()
    if (data.error) return null
    return data as Article
  } catch {
    return null
  }
}
