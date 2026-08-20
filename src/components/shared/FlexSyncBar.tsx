/**
 * Per-account IBKR Flex Web Service sync — a Token + Query ID pair tied to
 * this one account (not a single app-wide primary account). Once a sync
 * succeeds the credentials are remembered on the account, so this collapses
 * to a single "Sync" button on later visits instead of asking again.
 */
import { useState } from 'react'
import { RefreshCw, ChevronDown, ChevronUp, HelpCircle } from 'lucide-react'

// The exact set of Activity Flex Query "Sections" checkboxes this app's XML
// parser (src/services/ibkr.ts) actually reads — Trade, OpenPosition,
// OptionEAE, Transfer, CashReportCurrency, EquitySummaryByReportDateInBase/
// EquitySummaryInBase. Anything else selected on the query is harmless but
// unused; anything on THIS list left unchecked means that data silently
// never shows up (e.g. no Cash Report section → cash balance shows $0).
const REQUIRED_SECTIONS = [
  'Cash Report',
  'Net Asset Value (NAV) in Base',
  'Open Positions',
  'Option Exercises, Assignments and Expirations',
  'Trades',
  'Transfers',
]

function SetupInstructions() {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-elevated)' }}>
      <button onClick={() => setOpen(o => !o)} style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px',
        background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 600, color: 'var(--text-2)',
      }}>
        <HelpCircle size={12} />
        First time setting this up? Steps for a new IBKR account
        {open ? <ChevronUp size={12} style={{ marginLeft: 'auto' }} /> : <ChevronDown size={12} style={{ marginLeft: 'auto' }} />}
      </button>
      {open && (
        <ol style={{ margin: 0, padding: '0 14px 10px 24px', fontSize: 11.5, color: 'var(--text-3)', lineHeight: 1.6 }}>
          <li>
            On IBKR's website: <strong>Reporting → Flex Queries → Flex Queries</strong> → under "Activity Flex Query" click the <strong>+</strong> to create a new one. Give it any name.
          </li>
          <li>
            Under <strong>Sections</strong>, select exactly these six (leave everything else unchecked — unused sections just make the file bigger, but these six are the ones this app actually reads):
            <ul style={{ margin: '4px 0', paddingLeft: 18 }}>
              {REQUIRED_SECTIONS.map(s => <li key={s}><span className="mono">{s}</span></li>)}
            </ul>
          </li>
          <li>Leave <strong>Symbols</strong> empty (blank = every symbol in the account).</li>
          <li>
            Under <strong>General Configuration</strong>: set <strong>Format</strong> to <span className="mono">XML</span>, and set <strong>Period</strong> to <strong>Last 365 Calendar Days</strong> — each sync only ever replaces trades inside the report's own date window and keeps everything older, so resyncing on this same period regularly is always safe and won't lose history.
          </li>
          <li>Click <strong>Continue</strong> then <strong>Create</strong>. Back on the Flex Queries list, the new query's <strong>Query ID</strong> is shown right next to its name — copy that.</li>
          <li>
            Generate a token once (separate from the query itself — creating the query only gives you a Query ID, not a token): <strong>Reporting → Flex Queries</strong>, scroll down to <strong>Flex Web Service Configuration</strong>. If it's not already on, flip the <strong>Activate</strong> toggle there first — the token option only appears once the Flex Web Service is activated for the account. Then click <strong>Configure</strong> and generate a <strong>Token</strong> (copy it immediately, IBKR won't show the full value again — and note its expiry, you'll need to regenerate it when it lapses, same as changing a password).
          </li>
          <li>Paste that <strong>Token</strong> and the <strong>Query ID</strong> into the two fields below and click <strong>Save & Sync</strong>.</li>
        </ol>
      )}
    </div>
  )
}

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
            <input value={token} onChange={e => setToken(e.target.value)} placeholder="Token" autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} style={inputStyle} />
            <input value={queryId} onChange={e => setQueryId(e.target.value)} placeholder="Query ID" autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} style={inputStyle} />
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
      {expanded && <SetupInstructions />}
    </div>
  )
}
