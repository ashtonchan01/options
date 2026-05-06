import { useState } from 'react'
import { Eye, EyeOff, Check } from 'lucide-react'
import type { FlexSettings } from '../../store/settingsStore'

interface FlexSettingsPanelProps {
  settings: FlexSettings
  onSave: (s: FlexSettings) => void
  onClose: () => void
}

export default function FlexSettingsPanel({ settings, onSave, onClose }: FlexSettingsPanelProps) {
  const [token,   setToken]   = useState(settings.token)
  const [queryId, setQueryId] = useState(settings.queryId)
  const [showToken, setShowToken] = useState(false)
  const [saved, setSaved] = useState(false)

  const handleSave = () => {
    onSave({ token: token.trim(), queryId: queryId.trim() })
    setSaved(true)
    setTimeout(() => { setSaved(false); onClose() }, 800)
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    background: '#0a0a0f',
    border: '1px solid #222',
    color: '#e8e8e8',
    padding: '10px 14px',
    fontSize: 13,
    fontFamily: 'IBM Plex Mono, monospace',
    outline: 'none',
    borderRadius: 4,
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 50,
        background: 'rgba(0,0,0,0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        background: '#111',
        border: '1px solid #222',
        width: 480,
        padding: 28,
        display: 'flex',
        flexDirection: 'column',
        gap: 20,
      }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: '#e8e8e8' }}>IBKR Flex Settings</h2>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: '#555' }}>
            Credentials are stored locally in your browser only.
          </p>
        </div>

        {/* Token */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontSize: 11, color: '#555', letterSpacing: 2, textTransform: 'uppercase' }}>
            Flex Token
          </label>
          <div style={{ position: 'relative' }}>
            <input
              type={showToken ? 'text' : 'password'}
              value={token}
              onChange={e => setToken(e.target.value)}
              placeholder="Paste your Flex token"
              style={{ ...inputStyle, paddingRight: 40 }}
            />
            <button
              onClick={() => setShowToken(v => !v)}
              style={{
                position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                background: 'none', border: 'none', color: '#555', cursor: 'pointer', padding: 2,
              }}
            >
              {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </div>

        {/* Query ID */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontSize: 11, color: '#555', letterSpacing: 2, textTransform: 'uppercase' }}>
            Flex Query ID
          </label>
          <input
            type="text"
            value={queryId}
            onChange={e => setQueryId(e.target.value)}
            placeholder="e.g. 123456"
            style={inputStyle}
          />
          <p style={{ margin: 0, fontSize: 11, color: '#444' }}>
            IBKR Client Portal → Reports → Flex Queries → your query ID
          </p>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: '1px solid #333', color: '#666',
              padding: '9px 20px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!token || !queryId}
            style={{
              background: saved ? '#10b981' : '#fff',
              border: 'none',
              color: '#000',
              padding: '9px 24px',
              fontSize: 12,
              fontWeight: 600,
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
