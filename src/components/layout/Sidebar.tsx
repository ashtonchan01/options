/**
 * Edgewonk-style left sidebar — primary navigation, expandable Strategies
 * section, sync status + actions in the bottom block. Collapses to a
 * hamburger drawer on mobile.
 */
import { useState, useRef } from 'react'
import {
  LayoutDashboard, Briefcase, Radar, BookOpen,
  Menu, X, RefreshCw, Upload, Settings,
  Sun, Moon, LogOut, ChevronLeft, ChevronRight,
} from 'lucide-react'
import type { SyncStatus } from '../../types'
import { useThemeStore } from '../../store/themeStore'

export const TAB_IDS = ['dashboard', 'portfolio', 'journal', 'scanner'] as const
export type TabId = typeof TAB_IDS[number]

const NAV_ITEMS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'dashboard',  label: 'Dashboard',  icon: <LayoutDashboard size={17} /> },
  { id: 'portfolio',  label: 'Portfolio',  icon: <Briefcase size={17} /> },
  { id: 'journal',    label: 'Journal',    icon: <BookOpen size={17} /> },
  { id: 'scanner',    label: 'Scanner',    icon: <Radar size={17} /> },
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
  userEmail?: string
  onSignOut?: () => void
}

export default function Sidebar({
  activeTab, onTabChange, actionCount,
  syncStatus, lastSync, hasCredentials, onSyncClick, onXmlUpload, onOpenSettings,
  userEmail, onSignOut,
}: Props) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [collapsed, setCollapsed]   = useState(() => localStorage.getItem('options:sidebar-collapsed') !== '0')
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
    setDrawerOpen(false)
  }

  function toggleCollapsed() {
    setCollapsed(c => {
      const next = !c
      localStorage.setItem('options:sidebar-collapsed', next ? '1' : '0')
      return next
    })
  }

  return (
    <>
      <aside className={`ew-sidebar${drawerOpen ? ' open' : ''}${collapsed ? ' collapsed' : ''}`}>
        <div className="ew-logo">
          <div className="ew-logo-mark">O</div>
          <div>
            <div className="ew-logo-name">Options</div>
            <div className="ew-logo-sub">Trading Journal</div>
          </div>
        </div>

        <nav className="ew-nav">
          {NAV_ITEMS.map(item => (
            <button key={item.id}
              className={`ew-nav-item${activeTab === item.id ? ' active' : ''}`}
              title={collapsed ? item.label : undefined}
              onClick={() => selectTab(item.id)}>
              {item.icon}
              <span>{item.label}</span>
              {item.id === 'dashboard' && actionCount > 0 && (
                <span className="top-nav-badge">{actionCount > 9 ? '9+' : actionCount}</span>
              )}
            </button>
          ))}
        </nav>

        <div className="ew-side-bottom">
          <div className="ew-sync-row">
            <span className="ew-sync-dot" data-status={syncStatus} />
            <span>{syncStatus === 'loading' ? 'Syncing…' : lastSync ? `Synced ${relativeTime(lastSync)}` : 'Not synced'}</span>
          </div>
          <div className="ew-icon-row">
            <label className="ew-icon-btn" title="Upload Flex XML">
              <Upload size={14} />
              <input ref={fileRef} type="file" accept=".xml" style={{ display: 'none' }} onChange={handleFile} />
            </label>
            <button
              className="ew-icon-btn"
              onClick={onSyncClick}
              disabled={isLoading || !hasCredentials}
              title={!hasCredentials ? 'Configure credentials first' : 'Sync from IBKR'}>
              <RefreshCw size={14} style={{ animation: isLoading ? 'spin 1s linear infinite' : 'none' }} />
            </button>
            <button className="ew-icon-btn" onClick={onOpenSettings} title="Settings"
              style={{ color: hasCredentials ? '#10b981' : undefined }}>
              <Settings size={14} />
            </button>
            <button className="ew-icon-btn" onClick={toggle} title={theme === 'dark' ? 'Light mode' : 'Dark mode'}>
              {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
            </button>
            {onSignOut && (
              <button className="ew-icon-btn" onClick={onSignOut} title={userEmail ? `Sign out (${userEmail})` : 'Sign out'}>
                <LogOut size={14} />
              </button>
            )}
          </div>
        </div>

        <button className="ew-collapse-btn" onClick={toggleCollapsed} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
          <span>Collapse</span>
        </button>
      </aside>

      {drawerOpen && <div className="ew-drawer-overlay" onClick={() => setDrawerOpen(false)} />}

      {/* Fixed mobile top bar — hidden on desktop */}
      <div className="ew-mobilebar">
        <button className="ew-burger" onClick={() => setDrawerOpen(o => !o)} aria-label="Menu">
          {drawerOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
        <div className="ew-logo-mark" style={{ width: 26, height: 26, fontSize: 13 }}>O</div>
        <span className="ew-logo-name" style={{ fontSize: 14 }}>Options</span>
        <span className="ew-sync-dot" data-status={syncStatus} style={{ marginLeft: 'auto' }} />
      </div>
    </>
  )
}
