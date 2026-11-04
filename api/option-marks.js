/**
 * Live mids for index option legs. The journal's Flex mark is the last
 * sync, which is stale enough on a 1–2 DTE SPX put spread to show a loss
 * on a position that is most of the way to max profit.
 *
 * GET /api/option-marks?contracts=SPX|20261106|7575|P,SPX|20261106|7550|P
 * → { "SPX|20261106|7575|P": { "bid": 6, "ask": 6.2, "mid": 6.1 }, ... }
 *
 * Chains are CBOE's public delayed quotes. Weeklies live on the same chain
 * as the monthly (SPXW is inside _SPX), so a position stored as SPX still
 * finds the SPXW contract.
 */

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
const CHAIN_TTL = 60 * 1000

const CHAIN = {
  SPX: '_SPX', SPXW: '_SPX',
  XSP: '_XSP',
  NDX: '_NDX', NDXP: '_NDX', NDXW: '_NDX',
  RUT: '_RUT', RUTW: '_RUT',
  VIX: '_VIX',
  DJX: '_DJX',
  OEX: '_OEX',
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

const chainCache = new Map()

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function midOf(bid, ask) {
  if (bid == null && ask == null) return null
  if (bid == null) return ask
  if (ask == null) return bid
  return (bid + ask) / 2
}

function yyMMdd(expiry) {
  const digits = String(expiry).replace(/\D/g, '')
  if (digits.length === 8) return digits.slice(2)
  if (digits.length === 6) return digits
  return null
}

function occStrike(strike) {
  const n = Number(strike)
  if (!Number.isFinite(n)) return null
  return String(Math.round(n * 1000)).padStart(8, '0')
}

async function loadChain(chain) {
  const hit = chainCache.get(chain)
  if (hit && Date.now() - hit.at < CHAIN_TTL) return hit.byTail
  const url = `https://cdn.cboe.com/api/global/delayed_quotes/options/${chain}.json`
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    redirect: 'follow',
    signal: AbortSignal.timeout(20000),
  })
  if (!res.ok) return null
  const json = await res.json()
  const byTail = new Map()
  for (const o of json?.data?.options ?? []) {
    const symbol = o?.option
    if (typeof symbol !== 'string') continue
    const m = symbol.match(/(\d{6})([CP])(\d{8})$/)
    if (!m) continue
    const tail = `${m[1]}${m[2]}${m[3]}`
    const root = symbol.slice(0, symbol.length - 15)
    const list = byTail.get(tail) ?? []
    list.push({ root, bid: num(o.bid), ask: num(o.ask) })
    byTail.set(tail, list)
  }
  chainCache.set(chain, { at: Date.now(), byTail })
  return byTail
}

function pick(list, root) {
  if (!list || list.length === 0) return null
  return list.find(row => row.root === root) ?? list[0]
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', CORS['Access-Control-Allow-Origin'])
  res.setHeader('Access-Control-Allow-Methods', CORS['Access-Control-Allow-Methods'])
  res.setHeader('Access-Control-Allow-Headers', CORS['Access-Control-Allow-Headers'])
  if (req.method === 'OPTIONS') return res.status(204).end()

  const raw = req.query?.contracts
  const contracts = (Array.isArray(raw) ? raw.join(',') : raw ?? '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 60)
  if (contracts.length === 0) return res.status(400).json({ error: 'Missing contracts' })

  const byChain = new Map()
  const parsed = []
  for (const key of contracts) {
    const [root, expiry, strike, right] = key.split('|')
    const chain = CHAIN[(root ?? '').toUpperCase()]
    const yy = yyMMdd(expiry ?? '')
    const occ = occStrike(strike)
    const pc = (right ?? '').toUpperCase()
    if (!chain || !yy || !occ || (pc !== 'P' && pc !== 'C')) continue
    parsed.push({ key, root: root.toUpperCase(), chain, tail: `${yy}${pc}${occ}` })
    if (!byChain.has(chain)) byChain.set(chain, true)
  }

  const chains = new Map()
  await Promise.all([...byChain.keys()].map(async chain => {
    try {
      chains.set(chain, await loadChain(chain))
    } catch {
      chains.set(chain, null)
    }
  }))

  const out = {}
  for (const item of parsed) {
    const row = pick(chains.get(item.chain)?.get(item.tail), item.root)
    if (!row) continue
    const mid = midOf(row.bid, row.ask)
    if (mid == null || mid < 0) continue
    out[item.key] = { bid: row.bid, ask: row.ask, mid }
  }

  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60')
  return res.status(200).json(out)
}
