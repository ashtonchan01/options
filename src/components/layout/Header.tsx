import { useRef, useState, useEffect } from 'react'
import { RefreshCw, Upload, Wifi, WifiOff, AlertTriangle } from 'lucide-react'
import type { SyncStatus } from '../../types'
import { pingWorker } from '../../services/ibkr'
import type { TabId } from './Sidebar'

const TAB_LABELS: Record<TabId, string> = {
  portfolio:     'Portfolio',
  calendar:      'Calendar',
  strategies:    'Strategies',
  opportunities: 'Opportunities',
  actions:       'Actions',
  growth:        'Growth',
}

function relativeTime(ms: number): string {
  const diff = Date.now() - ms
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  return `${Math.floor(diff / 3_600_000)}h ago`
}

type PingState = 'unknown' | 'ok' | 'misconfigured' | 'unreachable'

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
  const [ping, setPing] = useState<PingState>('unknown')
  const [pinging, setPinging] = useState(false)

  const checkWorker = async () => {
    setPinging(true)
    try {
      const result = await pingWorker()
      setPing(result.configured ? 'ok' : 'misconfigured')
    } catch {
      setPing('unreachable')
    } finally {
      setPinging(false)
    }
  }

  useEffect(() => { checkWorker() }, [])

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) onXmlUpload(file)
    e.target.value = ''
  }

  const isLoading = syncStatus === 'loading'

  const PingIcon = ping === 'ok' ? Wifi : ping === 'unreachable' ? WifiOff : AlertTriangle
  const pingColor = ping === 'ok' ? '#10b981' : ping === 'misconfigured' ? '#f59e0b' : ping === 'unreachable' ? '#f43f5e' : '#6b6490'
  const pingLabel = ping === 'ok' ? 'Live' : ping === 'misconfigured' ? 'No secrets' : ping === 'unreachable' ? 'Offline' : '…'
  const pingTip   = ping === 'ok' ? 'Worker connected & configured'
    : ping === 'misconfigured' ? 'Worker reachable but secrets not set'
    : ping === 'unreachable' ? 'Worker unreachable — check deployment'
    : 'Checking worker…'

  return (
    <header
      className="flex items-center justify-between shrink-0"
      style={{
        height: 58,
        padding: '0 24px',
        background: 'rgba(13,12,20,0.95)',
        borderBottom: '1px solid rgba(124,58,237,0.15)',
      }}
    >
      <div className="flex items-center gap-3">
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: '#edeaf5' }}>
          {TAB_LABELS[activeTab]}
        </h1>
        {lastSync && (
          <span className="mono" style={{ fontSize: 11, color: '#6b6490' }}>
            {relativeTime(lastSync)}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">

        {/* Worker ping indicator */}
        <button
          onClick={checkWorker}
          disabled={pinging}
          title={pingTip}
          className="flex items-center gap-1.5 btn"
          style={{
            color: pingColor,
            borderColor: `${pingColor}40`,
            background: `${pingColor}0d`,
            opacity: pinging ? 0.6 : 1,
            fontSize: 12,
          }}
        >
          <PingIcon size={13} style={{ animation: pinging ? 'spin 1s linear infinite' : 'none' }} />
          {pingLabel}
        </button>

        <div style={{ width: 1, height: 18, background: 'rgba(124,58,237,0.2)' }} />

        {/* XML upload */}
        <label className="btn btn-violet flex items-center gap-1.5 cursor-pointer" style={{ fontSize: 12 }}>
          <Upload size={13} />
          Upload XML
          <input ref={fileRef} type="file" accept=".xml" className="hidden" onChange={handleFile} />
        </label>

        {/* Flex sync */}
        <button
          onClick={onSyncClick}
          disabled={isLoading || ping !== 'ok'}
          className="btn btn-violet flex items-center gap-1.5"
          style={{
            fontSize: 12,
            opacity: (isLoading || ping !== 'ok') ? 0.4 : 1,
            cursor: (isLoading || ping !== 'ok') ? 'not-allowed' : 'pointer',
          }}
          title={ping !== 'ok' ? 'Worker must be connected first' : 'Sync from IBKR Flex'}
        >
          <RefreshCw size={13} style={{ animation: isLoading ? 'spin 1s linear infinite' : 'none' }} />
          Flex Sync
        </button>

        {/* Sync status dot */}
        <span
          className={isLoading ? 'pulsing' : ''}
          style={{
            width: 8, height: 8, borderRadius: '50%', display: 'inline-block',
            background: syncStatus === 'success' ? '#10b981'
              : syncStatus === 'error'   ? '#f43f5e'
              : syncStatus === 'loading' ? '#f59e0b'
              : 'rgba(124,58,237,0.2)',
          }}
        />

        {syncStatus === 'error' && (
          <span className="mono" style={{ fontSize: 11, color: '#f43f5e' }}>Sync failed</span>
        )}
      </div>

      <style>{`@keyframes spin { from { transform:rotate(0deg); } to { transform:rotate(360deg); } }`}</style>
    </header>
  )
}
