/**
 * Embedded X (Twitter) timeline via the official publish.twitter.com
 * widget — no API key needed. The list of accounts to follow is
 * user-editable and saved to this browser.
 */
import { useEffect, useRef, useState } from 'react'
import { Plus, X, Settings2 } from 'lucide-react'

const STORAGE_KEY = 'options:x-accounts'
const DEFAULT_ACCOUNTS = ['DeItaone']

declare global {
  interface Window {
    twttr?: { widgets?: { load: (el?: HTMLElement) => void } }
  }
}

function loadTwitterWidgets(): Promise<void> {
  if (window.twttr?.widgets) return Promise.resolve()
  return new Promise(resolve => {
    const existing = document.getElementById('twitter-wjs')
    if (existing) { existing.addEventListener('load', () => resolve()); return }
    const script = document.createElement('script')
    script.id = 'twitter-wjs'
    script.src = 'https://platform.twitter.com/widgets.js'
    script.async = true
    script.onload = () => resolve()
    document.body.appendChild(script)
  })
}

function loadAccounts(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return DEFAULT_ACCOUNTS
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : DEFAULT_ACCOUNTS
  } catch {
    return DEFAULT_ACCOUNTS
  }
}

function cleanHandle(input: string): string {
  return input.trim().replace(/^@/, '').replace(/^https?:\/\/(x|twitter)\.com\//i, '').split('/')[0].split('?')[0]
}

export default function XFeedPanel() {
  const containerRef = useRef<HTMLDivElement>(null)
  const [accounts, setAccounts] = useState<string[]>(loadAccounts)
  const [active, setActive] = useState(() => loadAccounts()[0])
  const [editing, setEditing] = useState(false)
  const [newHandle, setNewHandle] = useState('')

  useEffect(() => {
    let cancelled = false
    loadTwitterWidgets().then(() => {
      if (!cancelled && containerRef.current) window.twttr?.widgets?.load(containerRef.current)
    })
    return () => { cancelled = true }
  }, [active])

  function persist(next: string[]) {
    setAccounts(next)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    if (!next.includes(active)) setActive(next[0] ?? '')
  }

  function addAccount() {
    const handle = cleanHandle(newHandle)
    if (!handle || accounts.includes(handle)) { setNewHandle(''); return }
    persist([...accounts, handle])
    setActive(handle)
    setNewHandle('')
  }

  function removeAccount(handle: string) {
    persist(accounts.filter(a => a !== handle))
  }

  return (
    <div className="dash-panel" style={{ flex: 1 }}>
      <div className="dash-panel-header">
        <span>X / Twitter</span>
        <button onClick={() => setEditing(v => !v)} style={{
          display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none',
          color: editing ? '#8b5cf6' : 'var(--text-4)', cursor: 'pointer', padding: 2,
        }} title="Manage accounts">
          <Settings2 size={13} />
        </button>
      </div>

      {editing && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              value={newHandle}
              onChange={e => setNewHandle(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addAccount() }}
              placeholder="@handle"
              style={{
                flex: 1, background: 'var(--bg-page)', border: '1px solid var(--border)', borderRadius: 5,
                color: 'var(--text-1)', fontSize: 11.5, padding: '5px 8px', fontFamily: 'inherit',
              }}
            />
            <button onClick={addAccount} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', width: 26, borderRadius: 5,
              border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-3)', cursor: 'pointer',
            }}>
              <Plus size={13} />
            </button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', flexShrink: 0 }}>
        {accounts.map(handle => (
          <div key={handle} style={{ display: 'flex', alignItems: 'center' }}>
            <button onClick={() => setActive(handle)} style={{
              fontSize: 10.5, fontWeight: 600, padding: editing ? '3px 4px 3px 8px' : '3px 8px', borderRadius: editing ? '5px 0 0 5px' : 5,
              border: `1px solid ${active === handle ? '#8b5cf6' : 'var(--border)'}`,
              background: active === handle ? '#8b5cf61a' : 'transparent',
              color: active === handle ? '#8b5cf6' : 'var(--text-3)',
              cursor: 'pointer', fontFamily: 'inherit',
            }}>
              @{handle}
            </button>
            {editing && (
              <button onClick={() => removeAccount(handle)} style={{
                display: 'flex', alignItems: 'center', padding: '3px 6px', borderRadius: '0 5px 5px 0',
                border: `1px solid ${active === handle ? '#8b5cf6' : 'var(--border)'}`, borderLeft: 'none',
                background: 'transparent', color: 'var(--text-4)', cursor: 'pointer',
              }}>
                <X size={10} />
              </button>
            )}
          </div>
        ))}
      </div>

      <div ref={containerRef} key={active} style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {active ? (
          <a
            className="twitter-timeline"
            data-theme="dark"
            data-chrome="noheader nofooter noborders transparent"
            href={`https://twitter.com/${active}?ref_src=twsrc%5Etfw`}
          >
            Tweets by {active}
          </a>
        ) : (
          <div style={{ fontSize: 12, color: 'var(--text-4)', padding: '12px 4px' }}>Add an account to follow.</div>
        )}
      </div>
    </div>
  )
}
