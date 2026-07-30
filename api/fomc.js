/**
 * FOMC meeting-date proxy — runs as a Vercel Edge Function.
 * Scrapes the Federal Reserve's published FOMC calendar page (the
 * authoritative source, updated by the Fed itself) instead of shipping
 * hardcoded dates in the client bundle.
 *
 * Edge cache + CDN Cache-Control keep this cheap: the client only needs
 * to see fresh data on a roughly weekly cadence, not on every page load.
 */

export const config = { runtime: 'edge' }

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
const FOMC_URL = 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm'
const CACHE_TTL = 24 * 60 * 60 * 1000 // 24h in-isolate cache

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

let cached = null // { dates, time }

function jsonResponse(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json', ...extra },
  })
}

/**
 * Parse the Fed's FOMC calendar page into decision dates.
 * The page renders as year sections ("2026 FOMC Meetings"), each containing
 * a month followed by a day or day-range (e.g. "27-28" or "16-17*").
 * The decision/statement day is the *last* day of the range.
 */
function parseFomcDates(html) {
  // Strip tags -> plain text lines, collapsing whitespace
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)

  const dates = []
  let year = null
  let month = null

  const yearRe = /^(20\d{2})\s+FOMC Meeting/i
  const monthRe = new RegExp(`^(${MONTHS.join('|')})$`)
  // e.g. "27-28", "16-17*", "9", "18-19 (unscheduled)"
  const dayRe = /^(\d{1,2})(?:\s*[-–]\s*(\d{1,2}))?\b/

  for (const line of lines) {
    const ym = line.match(yearRe)
    if (ym) { year = parseInt(ym[1], 10); month = null; continue }

    const mm = line.match(monthRe)
    if (mm) { month = MONTHS.indexOf(mm[1]); continue }

    if (year !== null && month !== null) {
      const dm = line.match(dayRe)
      if (dm) {
        const day = parseInt(dm[2] ?? dm[1], 10)
        if (day >= 1 && day <= 31) {
          const d = new Date(Date.UTC(year, month, day))
          if (!Number.isNaN(d.getTime())) {
            dates.push(d.toISOString().slice(0, 10))
          }
        }
        month = null // consume — next date needs a fresh month line
      }
    }
  }

  return [...new Set(dates)].sort()
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS })
  }

  if (cached && Date.now() - cached.time < CACHE_TTL) {
    return jsonResponse({ dates: cached.dates, source: 'cache' }, 200, {
      'Cache-Control': 's-maxage=604800, stale-while-revalidate=1209600',
    })
  }

  try {
    const res = await fetch(FOMC_URL, { headers: { 'User-Agent': UA } })
    if (!res.ok) return jsonResponse({ error: `Fed site returned ${res.status}` }, 502)

    const html = await res.text()
    const dates = parseFomcDates(html)
    if (dates.length === 0) return jsonResponse({ error: 'Could not parse any FOMC dates' }, 502)

    cached = { dates, time: Date.now() }
    return jsonResponse({ dates, source: 'federalreserve.gov' }, 200, {
      'Cache-Control': 's-maxage=604800, stale-while-revalidate=1209600',
    })
  } catch (error) {
    return jsonResponse({ error: error.message }, 502)
  }
}
