/**
 * World economic headlines proxy — fetches a few free business RSS feeds
 * server-side (RSS has no CORS headers) and returns a merged, sorted JSON
 * list. No API key required.
 */

export const config = { runtime: 'edge' }

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
const RESPONSE_TTL = 3 * 60 * 1000 // 3 min in-isolate cache

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

const FEEDS = [
  { source: 'CNBC',       url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258' },
  { source: 'MarketWatch', url: 'https://feeds.content.dowjones.io/public/rss/mw_topstories' },
  { source: 'Reuters',    url: 'https://feeds.reuters.com/reuters/businessNews' },
]

let cache = { at: 0, body: null }

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
}

function parseFeed(xml, source) {
  const items = []
  const itemRe = /<item\b[\s\S]*?<\/item>/gi
  const titleRe = /<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i
  const linkRe = /<link>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/i
  const dateRe = /<(?:pubDate|dc:date)>([\s\S]*?)<\/(?:pubDate|dc:date)>/i

  for (const match of xml.match(itemRe) ?? []) {
    const title = match.match(titleRe)?.[1]?.trim()
    const link = match.match(linkRe)?.[1]?.trim()
    const dateStr = match.match(dateRe)?.[1]?.trim()
    if (!title || !link) continue
    const ts = dateStr ? Date.parse(dateStr) : NaN
    items.push({
      title: decodeEntities(title),
      link,
      source,
      time: Number.isFinite(ts) ? ts : Date.now(),
    })
  }
  return items
}

async function fetchFeed(feed) {
  try {
    const res = await fetch(feed.url, { headers: { 'User-Agent': UA } })
    if (!res.ok) return []
    const xml = await res.text()
    return parseFeed(xml, feed.source)
  } catch {
    return []
  }
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  if (cache.body && Date.now() - cache.at < RESPONSE_TTL) {
    return jsonResponse(cache.body)
  }

  const results = await Promise.all(FEEDS.map(fetchFeed))
  const merged = results.flat()
    .sort((a, b) => b.time - a.time)
    .slice(0, 40)

  cache = { at: Date.now(), body: merged }
  return jsonResponse(merged)
}
