import { useRef } from 'react'
import { RefreshCw, Upload, Settings, Sun, Moon } from 'lucide-react'
import type { SyncStatus } from '../../types'
import type { TabId } from './Sidebar'
import { useThemeStore } from '../../store/themeStore'

const TAB_LABELS: Record<TabId, string> = {
  portfolio:     'Portfolio',
  calendar:      'Calendar',
  strategies:    'Strategies',
  opportunities: 'Opportunities',
  actions:       'Actions',
  growth:        'Growth',
  backtest:      'Backtest',
  phases:        'Phases',
}

function relativeTime(ms: number): string {
  const diff = Date.now() - ms
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  return `${Math.floor(diff / 3_600_000)}h ago`
}

interface HeaderProps {
  activeTab: TabId
  syncStatus: SyncStatus
  syncError?: string
  lastSync?: number
  hasCredentials: boolean
  onSyncClick: () => void
  onXmlUpload: (file: File) => void
  onOpenSettings: () => void
}

const btn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '7px 14px', fontSize: 14,
  border: '1px solid var(--border)', background: 'var(--bg-card)',
  color: 'var(--text-2)', cursor: 'pointer', fontFamily: 'inherit',
  transition: 'all 0.15s',
}

export default function Header({ activeTab, syncStatus, syncError, lastSync, hasCredentials, onSyncClick, onXmlUpload, onOpenSettings }: HeaderProps) {
  const fileRef = useRef<HTMLInputElement>(null)
  const isLoading = syncStatus === 'loading'
  const { theme, toggle } = useThemeStore()

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) onXmlUpload(file)
    e.target.value = ''
  }

  return (
    <header style={{
      height: 58,
      padding: '0 28px',
      background: 'var(--bg-surface)',
      borderBottom: '1px solid var(--border)',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: 'var(--text-1)' }}>
          {TAB_LABELS[activeTab]}
        </h1>
        {lastSync && (
          <span style={{ fontSize: 13, color: 'var(--text-3)', fontFamily: 'IBM Plex Mono, monospace' }}>
            {relativeTime(lastSync)}
          </span>
        )}
        {syncStatus === 'error' && (
          <span title={syncError} style={{ fontSize: 13, color: '#f43f5e', fontFamily: 'IBM Plex Mono, monospace', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'help' }}>
            {syncError ?? 'sync failed'}
          </span>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>

        {/* XML upload */}
        <label style={{ ...btn, cursor: 'pointer' }}>
          <Upload size={13} />
          Upload XML
          <input ref={fileRef} type="file" accept=".xml" style={{ display: 'none' }} onChange={handleFile} />
        </label>

        {/* Flex sync */}
        <button
          onClick={onSyncClick}
          disabled={isLoading || !hasCredentials}
          title={!hasCredentials ? 'Configure IBKR credentials first (⚙)' : 'Sync from IBKR Flex'}
          style={{
            ...btn,
            color: hasCredentials ? 'var(--text-2)' : 'var(--text-3)',
            opacity: (isLoading || !hasCredentials) ? 0.5 : 1,
            cursor: (isLoading || !hasCredentials) ? 'not-allowed' : 'pointer',
          }}
        >
          <RefreshCw size={13} style={{ animation: isLoading ? 'spin 1s linear infinite' : 'none' }} />
          Flex Sync
        </button>

        {/* Sync dot */}
        <span style={{
          width: 7, height: 7, borderRadius: '50%', display: 'inline-block',
          animation: isLoading ? 'pulse 1s ease-in-out infinite' : 'none',
          background: syncStatus === 'success' ? '#10b981'
            : syncStatus === 'error'   ? '#f43f5e'
            : syncStatus === 'loading' ? '#f59e0b'
            : 'var(--border)',
        }} />

        <div style={{ width: 1, height: 18, background: 'var(--border)', margin: '0 2px' }} />

        {/* Settings */}
        <button
          onClick={onOpenSettings}
          title="IBKR Flex credentials"
          style={{ ...btn, padding: '7px 10px', color: hasCredentials ? '#10b981' : 'var(--text-3)' }}
        >
          <Settings size={14} />
        </button>

        <div style={{ width: 1, height: 18, background: 'var(--border)', margin: '0 2px' }} />

        {/* Theme toggle switch */}
        <button
          onClick={toggle}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: 0, background: 'none', border: 'none',
            cursor: 'pointer', position: 'relative',
          }}
        >
          <Sun size={13} style={{ color: theme === 'light' ? '#f59e0b' : 'var(--text-4)', transition: 'color 0.2s' }} />
          {/* Track */}
          <div style={{
            width: 36, height: 20, borderRadius: 10,
            background: theme === 'dark' ? '#6366F1' : '#818cf8',
            position: 'relative', transition: 'background 0.2s',
          }}>
            {/* Knob */}
            <div style={{
              width: 16, height: 16, borderRadius: '50%',
              background: '#fff',
              position: 'absolute', top: 2,
              left: theme === 'dark' ? 2 : 18,
              transition: 'left 0.2s ease',
              boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
            }} />
          </div>
          <Moon size={13} style={{ color: theme === 'dark' ? '#818cf8' : 'var(--text-4)', transition: 'color 0.2s' }} />
        </button>
      </div>

      <style>{`
        @keyframes spin { from { transform:rotate(0deg); } to { transform:rotate(360deg); } }
        @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.3; } }
      `}</style>
    </header>
  )
}
