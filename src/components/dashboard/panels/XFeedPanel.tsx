/**
 * Embedded X (Twitter) timeline via the official publish.twitter.com
 * widget — no API key needed. Supports either individual accounts or a
 * public X List URL (twitter.com/i/lists/... or twitter.com/user/lists/...).
 * The list of entries is user-editable and saved to this browser.
 */
import { useEffect, useRef, useState } from 'react'
import { Plus, X, Settings2 } from 'lucide-react'

const STORAGE_KEY = 'options:x-entries'

interface XEntry {
  type: 'account' | 'list'
  value: string   // account: bare handle; list: full https://twitter.com/... url
  label: string   // display label on the tab
}

const DEFAULT_ENTRIES: XEntry[] = [{ type: 'account', value: 'DeItaone', label: '@DeItaone' }]

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

function loadEntries(): XEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return DEFAULT_ENTRIES
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : DEFAULT_ENTRIES
  } catch {
    return DEFAULT_ENTRIES
  }
}

/** Recognizes a pasted X List URL in either `i/lists/<id>` or `<user>/lists/<slug>` form. */
function parseListUrl(input: string): XEntry | null {
  const idMatch = input.match(/(?:twitter|x)\.com\/i\/lists\/(\d+)/i)
  if (idMatch) {
    return { type: 'list', value: `https://twitter.com/i/lists/${idMatch[1]}`, label: `List ${idMatch[1]}` }
  }
  const slugMatch = input.match(/(?:twitter|x)\.com\/([A-Za-z0-9_]+)\/lists\/([A-Za-z0-9_-]+)/i)
  if (slugMatch) {
    return { type: 'list', value: `https://twitter.com/${slugMatch[1]}/lists/${slugMatch[2]}`, label: slugMatch[2] }
  }
  return null
}

function parseEntry(raw: string): XEntry | null {
  const input = raw.trim()
  if (!input) return null
  const list = parseListUrl(input)
  if (list) return list
  const handle = input.replace(/^@/, '').replace(/^https?:\/\/(x|twitter)\.com\//i, '').split('/')[0].split('?')[0]
  if (!handle) return null
  return { type: 'account', value: handle, label: `@${handle}` }
}

function entryKey(e: XEntry): string {
  return `${e.type}:${e.value}`
}

export default function XFeedPanel() {
  const containerRef = useRef<HTMLDivElement>(null)
  const [entries, setEntries] = useState<XEntry[]>(loadEntries)
  const [active, setActive] = useState<XEntry | null>(() => loadEntries()[0] ?? null)
  const [editing, setEditing] = useState(false)
  const [newInput, setNewInput] = useState('')

  useEffect(() => {
    let cancelled = false
    loadTwitterWidgets().then(() => {
      if (!cancelled && containerRef.current) window.twttr?.widgets?.load(containerRef.current)
    })
    return () => { cancelled = true }
  }, [active])

  function persist(next: XEntry[]) {
    setEntries(next)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    if (!active || !next.some(e => entryKey(e) === entryKey(active))) setActive(next[0] ?? null)
  }

  function addEntry() {
    const entry = parseEntry(newInput)
    if (!entry || entries.some(e => entryKey(e) === entryKey(entry))) { setNewInput(''); return }
    persist([...entries, entry])
    setActive(entry)
    setNewInput('')
  }

  function removeEntry(key: string) {
    persist(entries.filter(e => entryKey(e) !== key))
  }

  return (
    <div className="dash-panel" style={{ flex: 1 }}>
      <div className="dash-panel-header">
        <span>X / Twitter</span>
        <button onClick={() => setEditing(v => !v)} style={{
          display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none',
          color: editing ? '#8b5cf6' : 'var(--text-4)', cursor: 'pointer', padding: 2,
        }} title="Manage accounts & lists">
          <Settings2 size={13} />
        </button>
      </div>

      {editing && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              value={newInput}
              onChange={e => setNewInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addEntry() }}
              placeholder="@handle or X List URL"
              style={{
                flex: 1, background: 'var(--bg-page)', border: '1px solid var(--border)', borderRadius: 5,
                color: 'var(--text-1)', fontSize: 11.5, padding: '5px 8px', fontFamily: 'inherit',
              }}
            />
            <button onClick={addEntry} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', width: 26, borderRadius: 5,
              border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-3)', cursor: 'pointer',
            }}>
              <Plus size={13} />
            </button>
          </div>
          <span style={{ fontSize: 10, color: 'var(--text-4)' }}>
            Paste a public List URL (e.g. x.com/i/lists/12345) to follow a list instead of one account.
          </span>
        </div>
      )}

      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', flexShrink: 0 }}>
        {entries.map(entry => {
          const key = entryKey(entry)
          const isActive = active ? entryKey(active) === key : false
          return (
            <div key={key} style={{ display: 'flex', alignItems: 'center' }}>
              <button onClick={() => setActive(entry)} style={{
                fontSize: 10.5, fontWeight: 600, padding: editing ? '3px 4px 3px 8px' : '3px 8px', borderRadius: editing ? '5px 0 0 5px' : 5,
                border: `1px solid ${isActive ? '#8b5cf6' : 'var(--border)'}`,
                background: isActive ? '#8b5cf61a' : 'transparent',
                color: isActive ? '#8b5cf6' : 'var(--text-3)',
                cursor: 'pointer', fontFamily: 'inherit',
              }}>
                {entry.type === 'list' ? `☰ ${entry.label}` : entry.label}
              </button>
              {editing && (
                <button onClick={() => removeEntry(key)} style={{
                  display: 'flex', alignItems: 'center', padding: '3px 6px', borderRadius: '0 5px 5px 0',
                  border: `1px solid ${isActive ? '#8b5cf6' : 'var(--border)'}`, borderLeft: 'none',
                  background: 'transparent', color: 'var(--text-4)', cursor: 'pointer',
                }}>
                  <X size={10} />
                </button>
              )}
            </div>
          )
        })}
      </div>

      <div ref={containerRef} key={active ? entryKey(active) : 'none'} style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {active ? (
          <a
            className="twitter-timeline"
            data-theme="dark"
            data-chrome="noheader nofooter noborders transparent"
            href={
              active.type === 'list'
                ? `${active.value}?ref_src=twsrc%5Etfw`
                : `https://twitter.com/${active.value}?ref_src=twsrc%5Etfw`
            }
          >
            {active.type === 'list' ? `List: ${active.label}` : `Tweets by ${active.value}`}
          </a>
        ) : (
          <div style={{ fontSize: 12, color: 'var(--text-4)', padding: '12px 4px' }}>Add an account or list to follow.</div>
        )}
      </div>
    </div>
  )
}
