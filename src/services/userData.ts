/**
 * Generic client for the /api/user-data blob store — the server-side
 * counterpart to whatever localStorage key a per-user store already keeps
 * (watchlists, trade labels, journal entries/setups). Errors are swallowed;
 * localStorage remains the authoritative write on failure and the caller's
 * next mutation retries the PUT.
 */
export type UserDataKey = 'watchlists' | 'tradeLabels' | 'journalEntries' | 'journalSetups' | 'targetAllocations'

export async function saveUserData<T>(key: UserDataKey, value: T): Promise<void> {
  try {
    await fetch('/api/user-data', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value }),
    })
  } catch { /* offline or request failed — localStorage still has it */ }
}

export async function loadUserData<T>(key: UserDataKey): Promise<T | null> {
  try {
    const res = await fetch(`/api/user-data?key=${key}`, { credentials: 'include' })
    if (!res.ok) return null
    const data: unknown = await res.json()
    const value = (data as { value?: unknown } | null)?.value
    return value == null ? null : value as T
  } catch {
    return null
  }
}
