import { fetchFlexStatement } from './_lib/flexStatement.js'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(204).end()

  const { token, query, fd, td } = req.query
  if (!token || !query) return res.status(400).json({ error: 'Missing token or query' })

  // fd and td together (YYYYMMDD) override the query's saved period. IBKR
  // allows at most 365 days and rejects the pair when it is combined with
  // period `p`, so this proxy never sends `p`.
  const dated = typeof fd === 'string' && typeof td === 'string' && /^\d{8}$/.test(fd) && /^\d{8}$/.test(td)

  const result = await fetchFlexStatement({
    token,
    query,
    ...(dated ? { fd, td } : {}),
  })

  if (!result.ok) {
    const status = result.retryable ? 503 : 502
    return res.status(status).json({
      error: result.error,
      code: result.code,
      retryable: result.retryable,
      raw: result.raw,
    })
  }

  res.setHeader('Content-Type', 'application/xml')
  return res.status(200).send(result.xml)
}
