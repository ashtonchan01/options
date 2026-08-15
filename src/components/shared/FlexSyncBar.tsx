/**
 * Per-account IBKR Flex Web Service sync — a Token + Query ID pair tied to
 * this one account (not a single app-wide primary account). Once a sync
 * succeeds the credentials are remembered on the account, so this collapses
 * to a single "Sync" button on later visits instead of asking again.
 */
import { useState } from 'react'
import { RefreshCw, ChevronDown, ChevronUp } from 'lucide-react'

export default function FlexSyncBar({ savedToken, savedQueryId, loading, error, onSync }: {
  savedToken?: string
  savedQueryId?: string
  loading: boolean
  error: string | null
  onSync: (token: string, queryId: string) => void
}) {
  const hasSaved = !!(savedToken && savedQueryId)
  const [expanded, setExpanded] = useState(!hasSaved)
  const [token, setToken] = useState(savedToken ?? '')
  const [queryId, setQueryId] = useState(savedQueryId ?? '')

  function handleSync() {
    if (token.trim() && queryId.trim()) onSync(token.trim(), queryId.trim())
  }

  const inputStyle: React.CSSProperties = {
    padding: '5px 8px', fontSize: 12, borderRadius: 4, border: '1px solid var(--border)',
    background: 'var(--bg-elevated)', color: 'var(--text-1)', width: 180,
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 14px',
      background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)' }}>IBKR Flex Web Service</span>
        {hasSaved && !expanded ? (
          <>
            <span style={{ fontSize: 11, color: 'var(--text-4)' }}>Query ID {savedQueryId}</span>
            <button onClick={handleSync} disabled={loading} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px',
              fontSize: 11, fontWeight: 600, background: 'var(--accent-dim)', border: '1px solid var(--accent-border)',
              color: 'var(--accent)', cursor: loading ? 'not-allowed' : 'pointer', borderRadius: 4,
            }}>
              <RefreshCw size={12} style={{ animation: loading ? 'spin 1.5s linear infinite' : 'none' }} />
              {loading ? 'Syncing…' : 'Sync'}
            </button>
            <button onClick={() => setExpanded(true)} title="Edit credentials" style={{
              background: 'none', border: '1px solid var(--border)', color: 'var(--text-4)',
              cursor: 'pointer', padding: '4px 6px', borderRadius: 4, display: 'flex',
            }}>
              <ChevronDown size={12} />
            </button>
          </>
        ) : (
          <>
            <input value={token} onChange={e => setToken(e.target.value)} placeholder="Token" style={inputStyle} />
            <input value={queryId} onChange={e => setQueryId(e.target.value)} placeholder="Query ID" style={inputStyle} />
            <button onClick={handleSync} disabled={loading || !token.trim() || !queryId.trim()} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px',
              fontSize: 11, fontWeight: 600, background: 'var(--accent-dim)', border: '1px solid var(--accent-border)',
              color: 'var(--accent)', cursor: loading ? 'not-allowed' : 'pointer', borderRadius: 4,
            }}>
              <RefreshCw size={12} style={{ animation: loading ? 'spin 1.5s linear infinite' : 'none' }} />
              {loading ? 'Syncing…' : 'Save & Sync'}
            </button>
            {hasSaved && (
              <button onClick={() => setExpanded(false)} title="Collapse" style={{
                background: 'none', border: '1px solid var(--border)', color: 'var(--text-4)',
                cursor: 'pointer', padding: '4px 6px', borderRadius: 4, display: 'flex',
              }}>
                <ChevronUp size={12} />
              </button>
            )}
          </>
        )}
      </div>
      {error && <div style={{ fontSize: 11, color: '#ef4444' }}>{error}</div>}
    </div>
  )
}
