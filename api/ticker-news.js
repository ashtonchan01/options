/**
 * Per-ticker headlines proxy — fetches Google News RSS search results for
 * each followed ticker server-side (RSS has no CORS headers) and returns a
 * merged, sorted JSON list tagged with the ticker. No API key required.
 */

export const config = { runtime: 'edge' }

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
const RESPONSE_TTL = 3 * 60 * 1000 // 3 min in-isolate cache
const MAX_TICKERS = 20

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

let cache = { key: '', at: 0, body: null }

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

function parseFeed(xml, ticker) {
  const items = []
  const itemRe = /<item\b[\s\S]*?<\/item>/gi
  const titleRe = /<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i
  const linkRe = /<link>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/i
  const dateRe = /<pubDate>([\s\S]*?)<\/pubDate>/i
  const sourceRe = /<source[^>]*>([\s\S]*?)<\/source>/i

  for (const match of xml.match(itemRe) ?? []) {
    const title = match.match(titleRe)?.[1]?.trim()
    const link = match.match(linkRe)?.[1]?.trim()
    const dateStr = match.match(dateRe)?.[1]?.trim()
    const source = match.match(sourceRe)?.[1]?.trim()
    if (!title || !link) continue
    const ts = dateStr ? Date.parse(dateStr) : NaN
    items.push({
      ticker,
      title: decodeEntities(title),
      link,
      source: source ? decodeEntities(source) : 'Google News',
      time: Number.isFinite(ts) ? ts : Date.now(),
    })
  }
  return items.slice(0, 5)
}

async function fetchTicker(ticker) {
  try {
    const q = encodeURIComponent(`${ticker} stock`)
    const url = `https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`
    const res = await fetch(url, { headers: { 'User-Agent': UA } })
    if (!res.ok) return []
    const xml = await res.text()
    return parseFeed(xml, ticker)
  } catch {
    return []
  }
}

/** Google News RSS `<link>` values are a news.google.com redirect, not the
 * publisher URL — following that redirect chain server-side (and handing
 * the client the final resolved URL) avoids the client's browser ever
 * visiting whatever ad/affiliate hops sit between Google's redirector and
 * the actual article (one of which was triggering iOS's password-autofill
 * prompt for an unrelated site on the way through). Falls back to the
 * original Google link if resolution fails or times out. */
async function resolveLink(item) {
  try {
    const res = await fetch(item.link, {
      method: 'HEAD', redirect: 'follow', headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(3000),
    })
    if (res.url) return { ...item, link: res.url }
  } catch { /* keep original link below */ }
  return item
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  const url = new URL(req.url)
  const tickers = (url.searchParams.get('tickers') ?? '')
    .split(',').map(t => t.trim().toUpperCase()).filter(Boolean).slice(0, MAX_TICKERS)

  if (tickers.length === 0) return jsonResponse([])

  const cacheKey = tickers.slice().sort().join(',')
  if (cache.body && cache.key === cacheKey && Date.now() - cache.at < RESPONSE_TTL) {
    return jsonResponse(cache.body)
  }

  const results = await Promise.all(tickers.map(fetchTicker))
  const topItems = results.flat().sort((a, b) => b.time - a.time).slice(0, 60)
  const merged = await Promise.all(topItems.map(resolveLink))

  cache = { key: cacheKey, at: Date.now(), body: merged }
  return jsonResponse(merged)
}
