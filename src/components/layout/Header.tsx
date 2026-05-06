import { useRef } from 'react'
import { RefreshCw, Upload } from 'lucide-react'
import type { SyncStatus } from '../../types'
import type { TabId } from './Sidebar'

const TAB_LABELS: Record<TabId, string> = {
  portfolio: 'PORTFOLIO',
  calendar: 'CALENDAR',
  strategies: 'STRATEGIES',
  opportunities: 'OPPORTUNITIES',
  actions: 'ACTIONS',
  growth: 'GROWTH',
}

function relativeTime(ms: number): string {
  const diff = Date.now() - ms
  if (diff < 60_000) return 'JUST NOW'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}M AGO`
  return `${Math.floor(diff / 3_600_000)}H AGO`
}

interface HeaderProps {
  activeTab: TabId
  syncStatus: SyncStatus
  syncMode?: string
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

  const isLoading = syncStatus === 'loading'

  return (
    <header
      className="flex items-center justify-between shrink-0"
      style={{
        height: 48,
        padding: '0 20px',
        background: '#1A1A1A',
        borderBottom: '1px solid #2E2E2E',
      }}
    >
      <div className="flex items-center gap-3">
        <span
          className="display font-bold tracking-widest"
          style={{ fontSize: 12, color: '#00E5FF', letterSpacing: 3 }}
        >
          {TAB_LABELS[activeTab]}
        </span>
        {lastSync && (
          <span className="mono" style={{ fontSize: 9, color: '#606060', letterSpacing: 1 }}>
            {relativeTime(lastSync)}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        {/* XML upload */}
        <label
          className="btn btn-cyan flex items-center gap-1.5 cursor-pointer"
          style={{ fontSize: 9, letterSpacing: 1 }}
        >
          <Upload size={11} />
          UPLOAD XML
          <input ref={fileRef} type="file" accept=".xml" className="hidden" onChange={handleFile} />
        </label>

        {/* Flex API sync */}
        <button
          onClick={onSyncClick}
          disabled={isLoading}
          className="btn btn-cyan flex items-center gap-1.5"
          style={{
            fontSize: 9, letterSpacing: 1,
            opacity: isLoading ? 0.5 : 1,
            cursor: isLoading ? 'not-allowed' : 'pointer',
          }}
        >
          <RefreshCw
            size={11}
            style={{ animation: isLoading ? 'spin 1s linear infinite' : 'none' }}
          />
          FLEX SYNC
        </button>

        {/* Live dot */}
        <span
          className={isLoading ? 'pulsing' : ''}
          style={{
            width: 8, height: 8, borderRadius: '50%', display: 'inline-block',
            background: syncStatus === 'success' ? '#00D084'
              : syncStatus === 'error' ? '#FF4757'
              : syncStatus === 'loading' ? '#F0B429'
              : '#2E2E2E',
          }}
        />
      </div>
    </header>
  )
}
