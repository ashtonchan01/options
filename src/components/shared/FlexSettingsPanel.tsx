import { useState } from 'react'
import { Check, Plus, Trash2, ChevronDown, HelpCircle } from 'lucide-react'
import type { FlexSettings, FlexProfile } from '../../store/settingsStore'

interface Props {
  settings: FlexSettings
  onSave: (s: FlexSettings) => void
  onClose: () => void
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--bg-page)',
  border: '1px solid var(--border)',
  color: 'var(--text-1)',
  padding: '10px 14px',
  fontSize: 13,
  fontFamily: 'Inter, sans-serif',
  outline: 'none',
  borderRadius: 6,
}

export default function FlexSettingsPanel({ settings, onSave, onClose }: Props) {
  const [profiles, setProfiles] = useState<FlexProfile[]>(
    settings.profiles.map(p => ({ ...p }))
  )
  const [activeId, setActiveId] = useState(settings.activeId || settings.profiles[0]?.id || '')
  const [saved, setSaved] = useState(false)
  const [showGuide, setShowGuide] = useState(false)

  const current = profiles.find(p => p.id === activeId)

  function updateField(field: keyof FlexProfile, value: string) {
    setProfiles(prev => prev.map(p => p.id === activeId ? { ...p, [field]: value } : p))
  }

  function addProfile() {
    const id = crypto.randomUUID()
    const p: FlexProfile = { id, name: `Account ${profiles.length + 1}`, token: '', queryId: '' }
    setProfiles(prev => [...prev, p])
    setActiveId(id)
  }

  function deleteProfile() {
    if (profiles.length <= 1) return
    const remaining = profiles.filter(p => p.id !== activeId)
    setProfiles(remaining)
    setActiveId(remaining[0]?.id || '')
  }

  function handleSave() {
    onSave({ profiles, activeId })
    setSaved(true)
    setTimeout(onClose, 700)
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 50,
      background: 'var(--overlay)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="settings-modal" style={{
        background: 'var(--bg-card)', border: '1px solid var(--border)',
        borderRadius: 10, width: 520, maxWidth: '95vw', padding: 28,
        display: 'flex', flexDirection: 'column', gap: 18,
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--text-1)' }}>IBKR Flex Credentials</h2>
            <button onClick={() => setShowGuide(v => !v)} style={{
              display: 'flex', alignItems: 'center', gap: 5, background: 'none',
              border: '1px solid var(--border)', borderRadius: 6, color: 'var(--accent)',
              padding: '4px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
            }}>
              <HelpCircle size={12} /> How do I get this?
              <ChevronDown size={12} style={{ transform: showGuide ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
            </button>
          </div>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--text-3)' }}>
            Manage multiple accounts · saved to your account, available on any device
          </p>
        </div>

        {showGuide && (
          <ol style={{
            margin: 0, padding: '14px 16px 14px 32px', background: 'var(--bg-page)',
            border: '1px solid var(--border)', borderRadius: 8,
            fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.7,
            listStyleType: 'decimal', listStylePosition: 'outside',
          }}>
            <li style={{ marginBottom: 6 }}>
              Log in to{' '}
              <a href="https://www.interactivebrokers.com/portal" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>
                IBKR Client Portal
              </a>.
            </li>
            <li style={{ marginBottom: 6 }}>Click your account icon (top right) → <strong>Settings</strong>.</li>
            <li style={{ marginBottom: 6 }}>
              Under <strong>Account Settings</strong>, find the <strong>Reporting</strong> section and click{' '}
              <strong>Flex Queries</strong>.
            </li>
            <li style={{ marginBottom: 6 }}>
              Click the <strong>+</strong> next to "Activity Flex Query" to create one. Select the sections you
              want (at minimum: <em>Open Positions</em>, <em>Trades</em>, <em>Cash Report</em>), set the format to{' '}
              <strong>XML</strong>, and save it.
            </li>
            <li style={{ marginBottom: 6 }}>
              Back on the Flex Queries page, note the <strong>Query ID</strong> (a number) next to the query you
              just created — that's your <strong>Query ID</strong> above.
            </li>
            <li style={{ marginBottom: 6 }}>
              Still under <strong>Reporting</strong>, click <strong>Flex Web Service Configuration</strong>.
            </li>
            <li style={{ marginBottom: 6 }}>
              Click <strong>Generate Token</strong>, choose an expiration (e.g. 1 year), and confirm. Copy the token
              immediately — IBKR only shows it once. That's your <strong>Flex Token</strong> above.
            </li>
            <li style={{ marginBottom: 6 }}>Paste both values in, give the profile a name, and click Save.</li>
          </ol>
        )}

        {/* Profile tabs */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {profiles.map(p => (
            <button key={p.id} onClick={() => setActiveId(p.id)} style={{
              padding: '5px 12px', fontSize: 12, fontWeight: p.id === activeId ? 600 : 400,
              background: p.id === activeId ? 'var(--accent-dim)' : 'transparent',
              border: `1px solid ${p.id === activeId ? 'var(--accent)' : 'var(--border)'}`,
              color: p.id === activeId ? 'var(--accent)' : 'var(--text-3)',
              cursor: 'pointer', borderRadius: 4, fontFamily: "'Inter', sans-serif",
              transition: 'all 0.15s',
            }}>
              {p.name || 'Unnamed'}
            </button>
          ))}
          <button onClick={addProfile} style={{
            padding: '5px 8px', background: 'transparent',
            border: '1px dashed var(--border)', borderRadius: 4,
            color: 'var(--text-4)', cursor: 'pointer', display: 'flex',
            alignItems: 'center', gap: 4, fontSize: 11,
          }}>
            <Plus size={12} /> Add
          </button>
        </div>

        {/* Edit fields */}
        {current ? (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 10, color: 'var(--text-3)', letterSpacing: 2, textTransform: 'uppercase' }}>Account Name</label>
              <input type="text" value={current.name} onChange={e => updateField('name', e.target.value)} placeholder="e.g. Main Account" style={inputStyle} spellCheck={false} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 10, color: 'var(--text-3)', letterSpacing: 2, textTransform: 'uppercase' }}>Flex Token</label>
              <input type="text" value={current.token} onChange={e => updateField('token', e.target.value)} placeholder="Paste your Flex token" style={inputStyle} spellCheck={false} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 10, color: 'var(--text-3)', letterSpacing: 2, textTransform: 'uppercase' }}>Query ID</label>
              <input type="text" value={current.queryId} onChange={e => updateField('queryId', e.target.value)} placeholder="e.g. 123456" style={inputStyle} spellCheck={false} />
              <span style={{ fontSize: 11, color: 'var(--text-5)' }}>IBKR Client Portal → Reports → Flex Queries → your query number</span>
            </div>
            {profiles.length > 1 && (
              <button onClick={deleteProfile} style={{
                alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 6,
                background: 'transparent', border: '1px solid rgba(255,71,87,0.3)',
                borderRadius: 4, color: '#ef4444', padding: '5px 12px',
                fontSize: 11, cursor: 'pointer', fontFamily: "'Inter', sans-serif",
              }}>
                <Trash2 size={11} /> Remove &ldquo;{current.name}&rdquo;
              </button>
            )}
          </>
        ) : (
          <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--text-4)', fontSize: 13 }}>
            Click <strong>+ Add</strong> to create your first account profile
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{
            background: 'none', border: '1px solid var(--border)', borderRadius: 6,
            color: 'var(--text-3)', padding: '8px 18px', fontSize: 12,
            cursor: 'pointer', fontFamily: 'inherit',
          }}>Cancel</button>
          <button onClick={handleSave} style={{
            background: saved ? '#10b981' : '#6366F1',
            border: 'none', borderRadius: 6, color: '#fff',
            padding: '8px 22px', fontSize: 12, fontWeight: 600,
            cursor: 'pointer', fontFamily: 'inherit',
            display: 'flex', alignItems: 'center', gap: 6,
            transition: 'background 0.2s',
          }}>
            {saved ? <><Check size={13} /> Saved</> : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
