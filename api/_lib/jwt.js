import { SignJWT, jwtVerify } from 'jose'

const encoder = new TextEncoder()

function secretKey() {
  const secret = process.env.JWT_SECRET
  if (!secret) throw new Error('JWT_SECRET env var is not set')
  return encoder.encode(secret)
}

export async function signSession(payload) {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(secretKey())
}

export async function verifySession(token) {
  try {
    const { payload } = await jwtVerify(token, secretKey())
    return payload
  } catch {
    return null
  }
}
