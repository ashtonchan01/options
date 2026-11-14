/**
 * Vercel Cron entry. Vercel sends GET with Authorization: Bearer CRON_SECRET.
 * One schedule-aware check, the same one GitHub posts to /api/flex-sync.
 */
import { runFlexCron } from './_lib/flexCron.js'

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST')
    return res.status(405).end()
  }
  return runFlexCron(req, res)
}
