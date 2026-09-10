/**
 * Bloomberg headlines proxy — fetches Bloomberg's own published RSS feeds
 * server-side (RSS has no CORS headers) and returns a merged, sorted JSON
 * list. No API key required; these are Bloomberg's public syndication feeds.
 */

export const config = { runtime: 'edge' }

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
const RESPONSE_TTL = 3 * 60 * 1000 // 3 min in-isolate cache

// Bloomberg's own public RSS feeds, by section — markets/economics first
// since this app is a trading journal, general/politics/tech fill out the
// rest of the board.
const FEEDS = [
  { section: 'Markets',    url: 'https://feeds.bloomberg.com/markets/news.rss' },
  { section: 'Economics',  url: 'https://feeds.bloomberg.com/economics/news.rss' },
  { section: 'Technology', url: 'https://feeds.bloomberg.com/technology/news.rss' },
  { section: 'Politics',   url: 'https://feeds.bloomberg.com/politics/news.rss' },
]

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

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

// Bloomberg's items carry an image a few different ways depending on feed —
// <media:content>/<media:thumbnail> (MRSS, the common case), a plain
// <enclosure> some readers use instead, or (rarely) an <img> buried in the
// HTML <description>. Tried in that order; the first match wins.
const MEDIA_CONTENT_RE = /<media:content\b[^>]*\burl="([^"]+)"/i
const MEDIA_THUMBNAIL_RE = /<media:thumbnail\b[^>]*\burl="([^"]+)"/i
const ENCLOSURE_RE = /<enclosure\b[^>]*\burl="([^"]+)"[^>]*\btype="image\//i
const DESC_IMG_RE = /<description>[\s\S]*?<img[^>]+src="([^"]+)"[\s\S]*?<\/description>/i

function extractImage(itemXml) {
  const m = itemXml.match(MEDIA_CONTENT_RE) ?? itemXml.match(MEDIA_THUMBNAIL_RE)
    ?? itemXml.match(ENCLOSURE_RE) ?? itemXml.match(DESC_IMG_RE)
  return m?.[1]?.trim()
}

function parseFeed(xml, section) {
  const items = []
  const itemRe = /<item\b[\s\S]*?<\/item>/gi
  const titleRe = /<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i
  const linkRe = /<link>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/i
  const dateRe = /<pubDate>([\s\S]*?)<\/pubDate>/i

  for (const match of xml.match(itemRe) ?? []) {
    const title = match.match(titleRe)?.[1]?.trim()
    const link = match.match(linkRe)?.[1]?.trim()
    const dateStr = match.match(dateRe)?.[1]?.trim()
    if (!title || !link) continue
    const ts = dateStr ? Date.parse(dateStr) : NaN
    items.push({
      section,
      title: decodeEntities(title),
      link,
      source: 'Bloomberg',
      time: Number.isFinite(ts) ? ts : Date.now(),
      image: extractImage(match),
    })
  }
  return items.slice(0, 20)
}

async function fetchSection({ section, url }) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA } })
    if (!res.ok) return []
    const xml = await res.text()
    return parseFeed(xml, section)
  } catch {
    return []
  }
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  if (cache.body && Date.now() - cache.at < RESPONSE_TTL) {
    return jsonResponse(cache.body)
  }

  const results = await Promise.all(FEEDS.map(fetchSection))
  const merged = results.flat().sort((a, b) => b.time - a.time).slice(0, 40)

  cache = { at: Date.now(), body: merged }
  return jsonResponse(merged)
}
