/**
 * One Flex Web Service statement, paced to IBKR's per-token limits
 * (about one request a second and ten a minute). SendRequest retries and
 * GetStatement polls share one clock so a single Vercel invocation stays
 * inside its time limit and hands the rest back as retryable.
 */

export const IBKR_SEND = 'https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService/SendRequest'
export const IBKR_GET = 'https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService/GetStatement'

/**
 * IBKR allows about one Flex call a second and ten a minute per token.
 * Six seconds between calls stays inside the tighter per-minute cap,
 * including when the next invocation starts as soon as this one returns.
 */
export const MIN_GAP_MS = 6_000
/** Leave headroom under the 90s Vercel limit for this function. */
export const BUDGET_MS = 75_000
const MAX_SENDS = 4
const MAX_POLLS = 5

const RETRYABLE = new Set(['1001', '1004', '1005', '1018', '1019', '1021'])

export function flexTag(body, tag) {
  if (!body) return undefined
  const element = body.match(new RegExp(`<${tag}>([^<]+)</${tag}>`, 'i'))
  if (element) return element[1].trim()
  const attr = body.match(new RegExp(`${tag}="([^"]+)"`, 'i'))
  return attr?.[1]
}

export function isRetryableFlexCode(code) {
  return RETRYABLE.has(String(code ?? ''))
}

/** Exponential wait. 1018 is the per-minute limit; 1019 means the statement is still generating. */
export function flexBackoffMs(code, attempt) {
  const n = Math.max(0, attempt)
  if (String(code) === '1018') return Math.min(30_000, 8_000 * 2 ** n)
  // Other retries, including "statement not ready", never go faster than the per-minute pace.
  return Math.min(20_000, MIN_GAP_MS * 2 ** n)
}

function messageFrom(body, code) {
  const msg = flexTag(body, 'ErrorMessage')
  if (msg) return `IBKR: ${msg}`
  if (code) return `IBKR ${code}`
  return 'IBKR Flex request failed'
}

/**
 * @param {{
 *   token: string,
 *   query: string,
 *   fd?: string,
 *   td?: string,
 *   fetchImpl?: (url: string) => Promise<string | { text: () => Promise<string> }>,
 *   sleep?: (ms: number) => Promise<void>,
 *   now?: () => number,
 *   budgetMs?: number,
 * }} opts
 */
export async function fetchFlexStatement(opts) {
  const fetchImpl = opts.fetchImpl ?? (async url => {
    const res = await fetch(url)
    return res.text()
  })
  const sleep = opts.sleep ?? (ms => new Promise(r => setTimeout(r, ms)))
  const now = opts.now ?? (() => Date.now())
  const budgetMs = opts.budgetMs ?? BUDGET_MS
  const started = now()
  const remaining = () => budgetMs - (now() - started)
  let lastAt = started - MIN_GAP_MS

  async function pause(ms) {
    if (ms <= 0) return true
    if (ms > remaining()) return false
    await sleep(ms)
    return true
  }

  async function ibkr(url) {
    const gap = MIN_GAP_MS - (now() - lastAt)
    if (!(await pause(gap))) return null
    if (remaining() < 500) return null
    lastAt = now()
    const res = await fetchImpl(url)
    return typeof res === 'string' ? res : await res.text()
  }

  const dated = opts.fd && opts.td ? `&fd=${opts.fd}&td=${opts.td}` : ''
  const sendUrl = `${IBKR_SEND}?t=${opts.token}&q=${opts.query}${dated}&v=3`

  let reference
  let lastCode
  let lastBody = ''
  for (let send = 0; send < MAX_SENDS && !reference; send++) {
    const body = await ibkr(sendUrl)
    if (body == null) {
      return { ok: false, retryable: true, code: lastCode, error: messageFrom(lastBody, lastCode), raw: lastBody }
    }
    lastBody = body
    const code = flexTag(body, 'ErrorCode')
    const ref = flexTag(body, 'ReferenceCode')
    const status = (flexTag(body, 'Status') ?? '').toLowerCase()
    if (ref && status !== 'fail' && !code) {
      reference = ref
      break
    }
    lastCode = code
    if (!isRetryableFlexCode(code)) {
      return { ok: false, retryable: false, code, error: messageFrom(body, code), raw: body }
    }
    if (send === MAX_SENDS - 1) break
    const wait = flexBackoffMs(code, send)
    if (!(await pause(wait))) {
      return { ok: false, retryable: true, code, error: messageFrom(body, code), raw: body }
    }
  }

  if (!reference) {
    return { ok: false, retryable: true, code: lastCode, error: messageFrom(lastBody, lastCode), raw: lastBody }
  }

  const getUrl = `${IBKR_GET}?t=${opts.token}&q=${reference}&v=3`
  lastCode = '1019'
  for (let poll = 0; poll < MAX_POLLS; poll++) {
    const wait = flexBackoffMs(lastCode, poll === 0 ? 0 : poll)
    if (!(await pause(wait))) break
    const body = await ibkr(getUrl)
    if (body == null) break
    lastBody = body
    if (body.includes('<FlexQueryResponse')) {
      return { ok: true, xml: body }
    }
    const code = flexTag(body, 'ErrorCode')
    lastCode = code ?? lastCode
    if (code === '1019' || code === '1021') continue
    if (isRetryableFlexCode(code)) continue
    return { ok: false, retryable: false, code, error: messageFrom(body, code), raw: body }
  }

  return {
    ok: false,
    retryable: true,
    code: lastCode,
    error: messageFrom(lastBody, lastCode) || 'IBKR: statement not ready',
    raw: lastBody,
  }
}
