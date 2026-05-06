import { useRef } from 'react'
import { RefreshCw, Upload, Wifi, WifiOff, Loader2 } from 'lucide-react'
import type { SyncStatus, SyncMode } from '../../types'
import type { TabId } from './Sidebar'

const TAB_LABELS: Record<TabId, string> = {
  portfolio: 'Portfolio',
  calendar: 'Calendar',
  strategies: 'Strategies',
  opportunities: 'Opportunities',
  actions: 'Actions',
  growth: 'Growth',
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
  syncMode?: SyncMode
  lastSync?: number
  onSyncClick: () => void
  onXmlUpload: (file: File) => void
}

export default function Header({ activeTab, syncStatus, lastSync, onSyncClick, onXmlUpload }: HeaderProps) {
  const fileRef = useRef<HTMLInputElement>(null)

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) onXmlUpload(file)
    e.target.value = ''
  }

  const StatusIcon = syncStatus === 'error' ? WifiOff
    : syncStatus === 'loading' ? Loader2
    : Wifi

  const statusColor = syncStatus === 'success' ? '#10b981'
    : syncStatus === 'error' ? '#f43f5e'
    : syncStatus === 'loading' ? '#f59e0b'
    : '#6b6490'

  return (
    <header
      className="flex items-center justify-between shrink-0"
      style={{
        height: 56,
        padding: '0 24px',
        background: '#13121c',
        borderBottom: '1px solid rgba(124,58,237,0.15)',
      }}
    >
      <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: '#edeaf5' }}>
        {TAB_LABELS[activeTab]}
      </h1>

      <div className="flex items-center gap-3">
        {lastSync && (
          <span style={{ fontSize: 12, color: '#6b6490' }}>
            {relativeTime(lastSync)}
          </span>
        )}

        {/* XML upload */}
        <label
          className="flex items-center gap-1.5 cursor-pointer transition-colors hover:opacity-80"
          style={{
            padding: '5px 12px',
            background: 'rgba(26,24,40,0.8)',
            border: '1px solid rgba(124,58,237,0.25)',
            borderRadius: 8,
            color: '#9d96c0',
            fontSize: 13,
            userSelect: 'none',
          }}
        >
          <Upload size={14} />
          Upload XML
          <input ref={fileRef} type="file" accept=".xml" className="hidden" onChange={handleFile} />
        </label>

        {/* Flex API sync — only show when in api mode or always visible */}
        <button
          onClick={onSyncClick}
          disabled={syncStatus === 'loading'}
          className="flex items-center gap-1.5 transition-opacity"
          style={{
            padding: '5px 12px',
            background: 'rgba(124,58,237,0.2)',
            border: '1px solid rgba(124,58,237,0.35)',
            borderRadius: 8,
            color: '#c4b5fd',
            fontSize: 13,
            cursor: syncStatus === 'loading' ? 'not-allowed' : 'pointer',
            opacity: syncStatus === 'loading' ? 0.7 : 1,
            fontFamily: 'inherit',
          }}
        >
          <RefreshCw
            size={14}
            style={{
              animation: syncStatus === 'loading' ? 'spin 1s linear infinite' : 'none',
            }}
          />
          Flex Sync
        </button>

        {/* Connection status */}
        <StatusIcon
          size={16}
          style={{
            color: statusColor,
            animation: syncStatus === 'loading' ? 'spin 1s linear infinite' : 'none',
          }}
        />
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </header>
  )
}
