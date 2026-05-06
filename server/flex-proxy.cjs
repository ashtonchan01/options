/**
 * Local IBKR Flex proxy — runs on port 3457.
 * Calls IBKR Flex Web Service from your real IP (avoids cloud IP blocks).
 * Token + Query ID stored in .env.local, never committed.
 */
'use strict'

const http  = require('http')
const https = require('https')
const fs    = require('fs')
const path  = require('path')

// Load .env.local
const envPath = path.join(__dirname, '..', '.env.local')
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const [k, ...v] = line.split('=')
    if (k && v.length) process.env[k.trim()] = v.join('=').trim().replace(/^"|"$/g, '')
  })
}

const PORT       = 3457
const FLEX_TOKEN = process.env.VITE_FLEX_TOKEN   || ''
const QUERY_ID   = process.env.VITE_FLEX_QUERY_ID || ''
const IBKR_SEND  = 'https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService/SendRequest'
const IBKR_GET   = 'https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService/GetStatement'

const MAX_POLLS  = 6
const POLL_DELAY = 8000

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let data = ''
      res.on('data', c => data += c)
      res.on('end', () => resolve({ status: res.statusCode, body: data }))
    }).on('error', reject)
  })
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

function sendJson(res, status, obj) {
  cors(res)
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(obj))
}

function sendXml(res, xml) {
  cors(res)
  res.writeHead(200, { 'Content-Type': 'application/xml' })
  res.end(xml)
}

async function handleSync(res) {
  if (!FLEX_TOKEN || !QUERY_ID) {
    return sendJson(res, 500, { error: 'VITE_FLEX_TOKEN / VITE_FLEX_QUERY_ID not set in .env.local' })
  }

  // Step 1: SendRequest
  let referenceCode
  try {
    const { body } = await fetchUrl(`${IBKR_SEND}?t=${FLEX_TOKEN}&q=${QUERY_ID}&v=3`)
    const match = body.match(/ReferenceCode="([^"]+)"/)
    referenceCode = match?.[1]
    if (!referenceCode) {
      const errMsg = body.match(/ErrorMessage="([^"]+)"/)?.[1] ?? 'No ReferenceCode'
      console.error('[flex] SendRequest failed:', errMsg, '\nRaw:', body.slice(0, 200))
      return sendJson(res, 502, { error: `IBKR: ${errMsg}`, raw: body })
    }
    console.log('[flex] ReferenceCode:', referenceCode)
  } catch (e) {
    return sendJson(res, 502, { error: `SendRequest error: ${e.message}` })
  }

  // Step 2: Poll GetStatement
  for (let i = 0; i < MAX_POLLS; i++) {
    if (i > 0) await sleep(POLL_DELAY)
    try {
      const { body } = await fetchUrl(`${IBKR_GET}?t=${FLEX_TOKEN}&q=${referenceCode}&v=3`)
      const status  = body.match(/Status="([^"]+)"/)?.[1]
      const errCode = body.match(/ErrorCode="([^"]+)"/)?.[1]

      console.log(`[flex] Poll ${i + 1}: status=${status} errCode=${errCode}`)

      if (status === 'Success') return sendXml(res, body)

      if (errCode !== '1019' && errCode !== '1021') {
        const errMsg = body.match(/ErrorMessage="([^"]+)"/)?.[1] ?? `Error ${errCode}`
        return sendJson(res, 502, { error: `IBKR ${errCode}: ${errMsg}` })
      }
    } catch (e) {
      return sendJson(res, 502, { error: `GetStatement error: ${e.message}` })
    }
  }

  sendJson(res, 504, { error: 'IBKR timed out — statement not ready after retries' })
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)

  if (req.method === 'OPTIONS') {
    cors(res)
    res.writeHead(204)
    return res.end()
  }

  if (url.pathname === '/ping') {
    return sendJson(res, 200, {
      ok: true,
      configured: !!(FLEX_TOKEN && QUERY_ID),
      hasToken: !!FLEX_TOKEN,
      hasQueryId: !!QUERY_ID,
    })
  }

  if (url.pathname === '/flex/sync') {
    console.log('[flex] Sync requested')
    return await handleSync(res)
  }

  sendJson(res, 404, { error: 'Not found' })
})

server.listen(PORT, () => {
  console.log(`[flex-proxy] Listening on http://localhost:${PORT}`)
  console.log(`[flex-proxy] Token: ${FLEX_TOKEN ? '✓ set' : '✗ missing'}`)
  console.log(`[flex-proxy] Query: ${QUERY_ID ? '✓ set (' + QUERY_ID + ')' : '✗ missing'}`)
})
