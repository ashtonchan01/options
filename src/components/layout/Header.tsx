import { useRef, useState, useEffect } from 'react'
import { RefreshCw, Upload, Wifi, WifiOff, AlertTriangle } from 'lucide-react'
import type { SyncStatus } from '../../types'
import { pingWorker } from '../../services/ibkr'
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

  // Auto-ping on mount
  useEffect(() => { checkWorker() }, [])

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) onXmlUpload(file)
    e.target.value = ''
  }

  const isLoading = syncStatus === 'loading'

  const PingIcon = ping === 'ok' ? Wifi : ping === 'unreachable' ? WifiOff : AlertTriangle
  const pingColor = ping === 'ok' ? '#00D084' : ping === 'misconfigured' ? '#F0B429' : ping === 'unreachable' ? '#FF4757' : '#606060'
  const pingTip = ping === 'ok' ? 'Worker connected & configured'
    : ping === 'misconfigured' ? 'Worker reachable but secrets not set'
    : ping === 'unreachable' ? 'Worker unreachable'
    : 'Checking worker…'

  return (
    <header
      className="flex items-center justify-between shrink-0"
      style={{ height: 58, padding: '0 24px', background: '#1A1A1A', borderBottom: '1px solid #2E2E2E' }}
    >
      <div className="flex items-center gap-3">
        <span className="display font-bold tracking-widest" style={{ fontSize: 14, color: '#00E5FF', letterSpacing: 3 }}>
          {TAB_LABELS[activeTab]}
        </span>
        {lastSync && (
          <span className="mono" style={{ fontSize: 10, color: '#606060', letterSpacing: 1 }}>
            {relativeTime(lastSync)}
          </span>
        )}
      </div>

      <div className="flex items-center gap-3">

        {/* Worker connection indicator */}
        <button
          onClick={checkWorker}
          disabled={pinging}
          title={pingTip}
          className="flex items-center gap-1.5"
          style={{
            background: 'transparent', border: '1px solid #2E2E2E',
            padding: '6px 10px', cursor: 'pointer', color: pingColor,
            opacity: pinging ? 0.5 : 1,
          }}
        >
          <PingIcon
            size={13}
            style={{ animation: pinging ? 'spin 1s linear infinite' : 'none' }}
          />
          <span style={{ fontSize: 10, letterSpacing: 1, fontFamily: 'IBM Plex Mono, monospace' }}>
            {ping === 'ok' ? 'WORKER OK' : ping === 'misconfigured' ? 'NO SECRETS' : ping === 'unreachable' ? 'OFFLINE' : 'CHECKING'}
          </span>
        </button>

        <div style={{ width: 1, height: 20, background: '#2E2E2E' }} />

        {/* XML upload */}
        <label
          className="btn btn-cyan flex items-center gap-1.5 cursor-pointer"
          style={{ fontSize: 11, letterSpacing: 1, padding: '8px 16px' }}
        >
          <Upload size={14} />
          UPLOAD XML
          <input ref={fileRef} type="file" accept=".xml" className="hidden" onChange={handleFile} />
        </label>

        {/* Flex sync */}
        <button
          onClick={onSyncClick}
          disabled={isLoading || ping !== 'ok'}
          className="btn btn-cyan flex items-center gap-1.5"
          style={{
            fontSize: 11, letterSpacing: 1, padding: '8px 16px',
            opacity: (isLoading || ping !== 'ok') ? 0.4 : 1,
            cursor: (isLoading || ping !== 'ok') ? 'not-allowed' : 'pointer',
          }}
          title={ping !== 'ok' ? 'Worker must be connected first' : 'Sync positions from IBKR Flex'}
        >
          <RefreshCw
            size={14}
            style={{ animation: isLoading ? 'spin 1s linear infinite' : 'none' }}
          />
          FLEX SYNC
        </button>

        {/* Sync dot */}
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

        {/* Last sync error hint */}
        {syncStatus === 'error' && (
          <span style={{ fontSize: 10, color: '#FF4757', fontFamily: 'IBM Plex Mono, monospace' }}>
            SYNC FAILED
          </span>
        )}
      </div>

      <style>{`@keyframes spin { from { transform:rotate(0deg); } to { transform:rotate(360deg); } }`}</style>
    </header>
  )
}
