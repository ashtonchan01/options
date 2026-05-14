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
  plan:          'Plan',
  backtest:      'Backtest',
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
  padding: '6px 12px', fontSize: 11, letterSpacing: '0.5px', fontWeight: 500,
  border: '1px solid var(--border)', background: 'transparent',
  color: 'var(--text-3)', cursor: 'pointer', fontFamily: "'Inter', sans-serif",
  transition: 'all 0.15s', borderRadius: 4,
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
      height: 56,
      padding: '0 24px',
      background: 'var(--bg-surface)',
      borderBottom: '1px solid var(--border)',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <h1 style={{
          margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--text-1)',
          fontFamily: "'Chakra Petch', sans-serif", letterSpacing: 2,
        }}>
          {TAB_LABELS[activeTab].toUpperCase()}
        </h1>
        {lastSync && (
          <span style={{ fontSize: 11, color: 'var(--text-4)', fontFamily: 'IBM Plex Mono, monospace' }}>
            {relativeTime(lastSync)}
          </span>
        )}
        {syncStatus === 'error' && (
          <span title={syncError} style={{ fontSize: 11, color: '#FF4757', fontFamily: 'IBM Plex Mono, monospace', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'help' }}>
            {syncError ?? 'sync failed'}
          </span>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>

        {/* XML upload */}
        <label style={{ ...btn, cursor: 'pointer' }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-light)'; (e.currentTarget as HTMLElement).style.color = 'var(--text-2)' }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'; (e.currentTarget as HTMLElement).style.color = 'var(--text-3)' }}
        >
          <Upload size={12} />
          UPLOAD XML
          <input ref={fileRef} type="file" accept=".xml" style={{ display: 'none' }} onChange={handleFile} />
        </label>

        {/* Flex sync */}
        <button
          onClick={onSyncClick}
          disabled={isLoading || !hasCredentials}
          title={!hasCredentials ? 'Configure IBKR credentials first' : 'Sync from IBKR Flex'}
          style={{
            ...btn,
            color: hasCredentials ? 'var(--text-3)' : 'var(--text-4)',
            opacity: (isLoading || !hasCredentials) ? 0.4 : 1,
            cursor: (isLoading || !hasCredentials) ? 'not-allowed' : 'pointer',
          }}
          onMouseEnter={e => { if (!isLoading && hasCredentials) { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-light)'; (e.currentTarget as HTMLElement).style.color = 'var(--text-2)' } }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'; (e.currentTarget as HTMLElement).style.color = hasCredentials ? 'var(--text-3)' : 'var(--text-4)' }}
        >
          <RefreshCw size={12} style={{ animation: isLoading ? 'spin 1s linear infinite' : 'none' }} />
          FLEX SYNC
        </button>

        {/* Sync dot */}
        <span style={{
          width: 8, height: 8, borderRadius: '50%', display: 'inline-block',
          animation: isLoading ? 'pulse 1s ease-in-out infinite' : 'none',
          background: syncStatus === 'success' ? '#00D084'
            : syncStatus === 'error'   ? '#FF4757'
            : syncStatus === 'loading' ? '#F0B429'
            : 'var(--border)',
          boxShadow: syncStatus === 'success' ? '0 0 8px rgba(0,208,132,0.4)' : 'none',
        }} />

        <div style={{ width: 1, height: 16, background: 'var(--border)', margin: '0 4px' }} />

        {/* Settings */}
        <button
          onClick={onOpenSettings}
          title="IBKR Flex credentials"
          style={{ ...btn, padding: '6px 8px', color: hasCredentials ? '#00D084' : 'var(--text-4)' }}
        >
          <Settings size={13} />
        </button>

        <div style={{ width: 1, height: 16, background: 'var(--border)', margin: '0 4px' }} />

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
          <Sun size={12} style={{ color: theme === 'light' ? '#F0B429' : 'var(--text-5)', transition: 'color 0.2s' }} />
          <div style={{
            width: 34, height: 18, borderRadius: 9,
            background: theme === 'dark' ? 'var(--accent)' : '#818cf8',
            position: 'relative', transition: 'background 0.2s',
          }}>
            <div style={{
              width: 14, height: 14, borderRadius: '50%',
              background: '#fff',
              position: 'absolute', top: 2,
              left: theme === 'dark' ? 2 : 18,
              transition: 'left 0.2s ease',
              boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
            }} />
          </div>
          <Moon size={12} style={{ color: theme === 'dark' ? 'var(--accent)' : 'var(--text-5)', transition: 'color 0.2s' }} />
        </button>
      </div>
    </header>
  )
}
