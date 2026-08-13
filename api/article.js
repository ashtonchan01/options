/**
 * Reader-mode article proxy — fetches a news article's HTML server-side and
 * extracts just the readable text (title, byline/source, paragraphs), so the
 * Dashboard can show the article in-page without an iframe (most publishers
 * block framing anyway via X-Frame-Options/CSP) and without pulling in the
 * source page's own ads, trackers, or scripts — only plain extracted text
 * ever reaches the client.
 *
 * GET /api/article?url=https://example.com/some-story
 * → { title, byline, paragraphs: string[], url }
 */

export const config = { runtime: 'edge' }

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
/** A plain UA alone gets a 403 from a fair number of news sites' basic bot
 * filters — the rest of a real browser's request headers (Accept,
 * Accept-Language, and a Referer that isn't blank) are also checked by some
 * of them, so send the full set instead of just User-Agent. */
const FETCH_HEADERS = {
  'User-Agent': UA,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://www.google.com/',
}
const RESPONSE_TTL = 10 * 60 * 1000 // 10 min in-isolate cache

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

const cache = new Map()

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&mdash;/g, '—').replace(/&ndash;/g, '–')
    .replace(/&rsquo;/g, '’').replace(/&lsquo;/g, '‘')
    .replace(/&rdquo;/g, '”').replace(/&ldquo;/g, '“')
}

function stripTags(html) {
  return decodeEntities(html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).trim()
}

/** Strips whole elements whose content is never article body text (scripts,
 * styles, nav/header/footer chrome, embedded widgets) before paragraph
 * extraction, so their text doesn't leak into the result. */
function stripNonContentElements(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|iframe|svg|form|header|footer|nav|aside)\b[\s\S]*?<\/\1>/gi, '')
}

function extractMeta(html, property) {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']*)["']`, 'i')
  return html.match(re)?.[1]
}

/** Picks the <article>/<main> block if present (most news sites use one),
 * else falls back to the whole document — the paragraph-quality filter
 * below does the real work of dropping boilerplate either way. */
function extractContentBlock(html) {
  const articleMatch = html.match(/<article\b[\s\S]*?<\/article>/i)
  if (articleMatch) return articleMatch[0]
  const mainMatch = html.match(/<main\b[\s\S]*?<\/main>/i)
  if (mainMatch) return mainMatch[0]
  return html
}

/** Plain <p> extraction with a length floor to filter out nav links, ad
 * labels, and other short boilerplate strings that aren't real sentences. */
function extractParagraphs(block) {
  const paraRe = /<p\b[^>]*>([\s\S]*?)<\/p>/gi
  const paragraphs = []
  let m
  while ((m = paraRe.exec(block))) {
    const text = stripTags(m[1])
    if (text.length >= 40) paragraphs.push(text)
  }
  return paragraphs
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  const reqUrl = new URL(req.url)
  const target = reqUrl.searchParams.get('url')
  if (!target) return jsonResponse({ error: 'Missing url' }, 400)

  let parsed
  try { parsed = new URL(target) } catch { return jsonResponse({ error: 'Invalid url' }, 400) }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return jsonResponse({ error: 'Invalid url' }, 400)

  const cached = cache.get(target)
  if (cached && Date.now() - cached.at < RESPONSE_TTL) return jsonResponse(cached.body)

  try {
    const res = await fetch(target, { headers: FETCH_HEADERS, redirect: 'follow', signal: AbortSignal.timeout(10000) })
    if (!res.ok) return jsonResponse({ error: `Fetch failed (${res.status})` }, 502)
    const html = await res.text()

    const title = decodeEntities(
      extractMeta(html, 'og:title') ?? html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? 'Untitled',
    ).trim()
    const byline = extractMeta(html, 'og:site_name') ?? parsed.hostname.replace(/^www\./, '')

    const cleaned = stripNonContentElements(html)
    const block = extractContentBlock(cleaned)
    let paragraphs = extractParagraphs(block)
    if (paragraphs.length === 0) paragraphs = extractParagraphs(cleaned) // article/main missed the real body — fall back to whole page

    // Some pages (client-rendered SPAs especially) have no real <p> content
    // in the server-sent HTML at all — rather than a hard failure, fall back
    // to the page's own og:description/meta description summary, which is
    // usually still a real (if short) excerpt of the story.
    if (paragraphs.length === 0) {
      const desc = extractMeta(html, 'og:description') ?? extractMeta(html, 'description')
      if (desc) paragraphs = [decodeEntities(desc).trim()]
    }
    if (paragraphs.length === 0) return jsonResponse({ error: 'Could not extract article text' }, 422)

    const body = { title, byline, paragraphs: paragraphs.slice(0, 80), url: target }
    cache.set(target, { at: Date.now(), body })
    for (const [k, v] of cache) if (Date.now() - v.at > RESPONSE_TTL * 3) cache.delete(k)

    return jsonResponse(body)
  } catch (err) {
    return jsonResponse({ error: err?.message ?? 'Fetch failed' }, 502)
  }
}
