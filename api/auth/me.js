import { getSessionUser } from '../_lib/session.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const user = await getSessionUser(req)
  if (!user) return res.status(401).json({ error: 'Not signed in' })

  return res.status(200).json({ email: user.email })
}
