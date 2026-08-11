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
      // Per-user IBKR Flex credentials (token + query ID per profile), one row per user.
      await db`
        CREATE TABLE IF NOT EXISTS user_settings (
          user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          flex_settings JSONB NOT NULL DEFAULT '{"profiles":[],"activeId":""}',
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `
      // Synced portfolio data (positions, trades, cash) — lives server-side so it
      // survives clearing browser storage or switching devices, and so trade
      // history from outside IBKR's rolling 365-day Flex export window doesn't
      // get lost once a sync no longer reports it.
      await db`
        CREATE TABLE IF NOT EXISTS user_portfolio_data (
          user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          data JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `
    })()
  }
  return schemaReady
}
