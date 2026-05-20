import { useState, useRef } from 'react'
import { LayoutDashboard, CalendarDays, Layers, Radar, Zap, ClipboardList, FlaskConical, Menu, X, RefreshCw, Upload, Settings, Sun, Moon } from 'lucide-react'
import type { SyncStatus } from '../../types'
import { useThemeStore } from '../../store/themeStore'

export const TAB_IDS = ['portfolio', 'calendar', 'strategies', 'scanner', 'actions', 'plan', 'backtest'] as const
export type TabId = typeof TAB_IDS[number]

const NAV_ITEMS: { id: TabId; label: string; Icon: React.FC<{ size?: number }> }[] = [
  { id: 'portfolio',  label: 'Portfolio',  Icon: LayoutDashboard },
  { id: 'calendar',   label: 'Calendar',   Icon: CalendarDays },
  { id: 'strategies', label: 'Strategies', Icon: Layers },
  { id: 'scanner',    label: 'Scanner',    Icon: Radar },
  { id: 'actions',    label: 'Actions',    Icon: Zap },
  { id: 'plan',       label: 'Plan',       Icon: ClipboardList },
  { id: 'backtest',   label: 'Backtest',   Icon: FlaskConical },
]

function relativeTime(ms: number): string {
  const diff = Date.now() - ms
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  return `${Math.floor(diff / 3_600_000)}h ago`
}

interface Props {
  activeTab: TabId
  onTabChange: (tab: TabId) => void
  actionCount: number
  syncStatus: SyncStatus
  syncError?: string
  lastSync?: number
  hasCredentials: boolean
  onSyncClick: () => void
  onXmlUpload: (file: File) => void
  onOpenSettings: () => void
}

export default function TopNav({ activeTab, onTabChange, actionCount, syncStatus, lastSync, hasCredentials, onSyncClick, onXmlUpload, onOpenSettings }: Props) {
  const [menuOpen, setMenuOpen] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const { theme, toggle } = useThemeStore()
  const isLoading = syncStatus === 'loading'

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) onXmlUpload(file)
    e.target.value = ''
  }

  function selectTab(tab: TabId) {
    onTabChange(tab)
    setMenuOpen(false)
  }

  return (
    <>
      <nav className="top-nav">
        <div className="top-nav-brand">
          <span className="top-nav-logo">OPTIONS</span>
          <span className="top-nav-sync-dot" data-status={syncStatus} />
          {lastSync && <span className="top-nav-sync-time">{relativeTime(lastSync)}</span>}
        </div>

        <div className="top-nav-tabs">
          {NAV_ITEMS.map(({ id, label, Icon }) => (
            <button
              key={id}
              className={`top-nav-tab${activeTab === id ? ' active' : ''}`}
              onClick={() => selectTab(id)}
            >
              <Icon size={15} />
              <span>{label}</span>
              {id === 'actions' && actionCount > 0 && (
                <span className="top-nav-badge">{actionCount > 9 ? '9+' : actionCount}</span>
              )}
            </button>
          ))}
        </div>

        <div className="top-nav-actions">
          <label className="top-nav-btn" title="Upload Flex XML">
            <Upload size={13} />
            <input ref={fileRef} type="file" accept=".xml" style={{ display: 'none' }} onChange={handleFile} />
          </label>
          <button
            className="top-nav-btn"
            onClick={onSyncClick}
            disabled={isLoading || !hasCredentials}
            title={!hasCredentials ? 'Configure credentials first' : 'Sync from IBKR'}
          >
            <RefreshCw size={13} style={{ animation: isLoading ? 'spin 1s linear infinite' : 'none' }} />
          </button>
          <button
            className="top-nav-btn"
            onClick={onOpenSettings}
            title="Settings"
            style={{ color: hasCredentials ? '#00D084' : undefined }}
          >
            <Settings size={13} />
          </button>
          <button className="top-nav-btn" onClick={toggle} title={theme === 'dark' ? 'Light mode' : 'Dark mode'}>
            {theme === 'dark' ? <Sun size={13} /> : <Moon size={13} />}
          </button>
        </div>

        <button className="top-nav-burger" onClick={() => setMenuOpen(o => !o)} aria-label="Menu">
          {menuOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      </nav>

      {menuOpen && (
        <div className="mobile-menu-overlay" onClick={() => setMenuOpen(false)}>
          <div className="mobile-menu" onClick={e => e.stopPropagation()}>
            {NAV_ITEMS.map(({ id, label, Icon }) => (
              <button
                key={id}
                className={`mobile-menu-item${activeTab === id ? ' active' : ''}`}
                onClick={() => selectTab(id)}
              >
                <Icon size={18} />
                <span>{label}</span>
                {id === 'actions' && actionCount > 0 && (
                  <span className="top-nav-badge">{actionCount > 9 ? '9+' : actionCount}</span>
                )}
              </button>
            ))}
            <div className="mobile-menu-divider" />
            <div className="mobile-menu-actions">
              <label className="mobile-menu-action-btn">
                <Upload size={16} /> Upload XML
                <input type="file" accept=".xml" style={{ display: 'none' }} onChange={handleFile} />
              </label>
              <button
                className="mobile-menu-action-btn"
                onClick={() => { onSyncClick(); setMenuOpen(false) }}
                disabled={isLoading || !hasCredentials}
              >
                <RefreshCw size={16} style={{ animation: isLoading ? 'spin 1s linear infinite' : 'none' }} /> Flex Sync
              </button>
              <button className="mobile-menu-action-btn" onClick={() => { onOpenSettings(); setMenuOpen(false) }}>
                <Settings size={16} /> Settings
              </button>
              <button className="mobile-menu-action-btn" onClick={toggle}>
                {theme === 'dark' ? <><Sun size={16} /> Light Mode</> : <><Moon size={16} /> Dark Mode</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
