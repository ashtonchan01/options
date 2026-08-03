import { neon } from '@neondatabase/serverless'

let sql
let schemaReady = null

export function getSql() {
  if (!sql) {
    const url = process.env.DATABASE_URL || process.env.POSTGRES_URL
    if (!url) throw new Error('DATABASE_URL (or POSTGRES_URL) env var is not set')
    sql = neon(url)
  }
  return sql
}

/** Creates the users table on first use. Safe to call on every request. */
export async function ensureSchema() {
  if (!schemaReady) {
    const db = getSql()
    schemaReady = (async () => {
      try {
        await db`CREATE EXTENSION IF NOT EXISTS pgcrypto`
      } catch { /* already enabled, or not permitted — gen_random_uuid() is built into Postgres 13+ anyway */ }
      await db`
        CREATE TABLE IF NOT EXISTS users (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          email TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `
    })()
  }
  return schemaReady
}
