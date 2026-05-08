import { useState } from 'react'
import { Check } from 'lucide-react'
import type { FlexSettings } from '../../store/settingsStore'

interface FlexSettingsPanelProps {
  settings: FlexSettings
  onSave: (s: FlexSettings) => void
  onClose: () => void
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: '#0B0E18',
  border: '1px solid #1E2540',
  color: '#EAEDF3',
  padding: '10px 14px',
  fontSize: 13,
  fontFamily: 'IBM Plex Mono, monospace',
  outline: 'none',
  borderRadius: 6,
}

export default function FlexSettingsPanel({ settings, onSave, onClose }: FlexSettingsPanelProps) {
  const [token,   setToken]   = useState(settings.token)
  const [queryId, setQueryId] = useState(settings.queryId)
  const [saved,   setSaved]   = useState(false)

  const handleSave = () => {
    onSave({ token: token.trim(), queryId: queryId.trim() })
    setSaved(true)
    setTimeout(() => { setSaved(false); onClose() }, 700)
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 50,
        background: 'rgba(0,0,0,0.75)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        background: '#131726', border: '1px solid #1E2540',
        borderRadius: 10,
        width: 480, padding: 28,
        display: 'flex', flexDirection: 'column', gap: 20,
      }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: '#EAEDF3' }}>IBKR Flex Credentials</h2>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: '#5D6580' }}>
            Stored in your browser only · never sent to any server
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontSize: 10, color: '#5D6580', letterSpacing: 2, textTransform: 'uppercase' }}>Flex Token</label>
          <input
            type="text"
            value={token}
            onChange={e => setToken(e.target.value)}
            placeholder="Paste your Flex token"
            style={inputStyle}
            spellCheck={false}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontSize: 10, color: '#5D6580', letterSpacing: 2, textTransform: 'uppercase' }}>Query ID</label>
          <input
            type="text"
            value={queryId}
            onChange={e => setQueryId(e.target.value)}
            placeholder="e.g. 123456"
            style={inputStyle}
            spellCheck={false}
          />
          <span style={{ fontSize: 11, color: '#2A3250' }}>
            IBKR Client Portal → Reports → Flex Queries → your query number
          </span>
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{ background: 'none', border: '1px solid #1E2540', borderRadius: 6, color: '#5D6580', padding: '8px 18px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!token || !queryId}
            style={{
              background: saved ? '#10b981' : '#6366F1',
              border: 'none', borderRadius: 6, color: '#fff',
              padding: '8px 22px', fontSize: 12, fontWeight: 600,
              cursor: (!token || !queryId) ? 'not-allowed' : 'pointer',
              opacity: (!token || !queryId) ? 0.4 : 1,
              fontFamily: 'inherit',
              display: 'flex', alignItems: 'center', gap: 6,
              transition: 'background 0.2s',
            }}
          >
            {saved ? <><Check size={13} /> Saved</> : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
