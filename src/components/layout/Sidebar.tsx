/**
 * Edgewonk-style left sidebar — primary navigation, expandable Personal/
 * Business account groups, sync status + actions in the bottom block.
 * Collapses to a hamburger drawer on mobile.
 */
import { useState, useRef } from 'react'
import {
  LayoutDashboard, User, Building2, Radar,
  Menu, X, RefreshCw, Upload, Settings,
  Sun, Moon, LogOut, ChevronLeft, ChevronRight, ChevronDown,
} from 'lucide-react'
import type { SyncStatus } from '../../types'
import { useThemeStore } from '../../store/themeStore'

export const TAB_IDS = ['dashboard', 'personal_ibkr', 'personal_moomoo', 'business_ibkr', 'business_moomoo', 'scanner'] as const
export type TabId = typeof TAB_IDS[number]

/* Personal/Business used to be a single flat "Portfolio" tab with its own
 * in-page Personal/Business + IBKR/Moomoo switcher; that level moved into
 * the sidebar as two expandable groups so the main content area's own top
 * nav (Calendar/Journal/Reports/Allocation) can sit on one line with more
 * room underneath instead of stacking 3 rows of chips above the content. */
type Group = 'personal' | 'business'
const GROUPS: { id: Group; label: string; icon: React.ReactNode; children: { id: TabId; label: string }[] }[] = [
  {
    id: 'personal', label: 'Personal', icon: <User size={17} />,
    children: [
      { id: 'personal_ibkr', label: 'IBKR' },
      { id: 'personal_moomoo', label: 'Moomoo' },
    ],
  },
  {
    id: 'business', label: 'Business', icon: <Building2 size={17} />,
    children: [
      { id: 'business_ibkr', label: 'IBKR' },
      { id: 'business_moomoo', label: 'Moomoo' },
    ],
  },
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
  const [openGroups, setOpenGroups] = useState<Set<Group>>(() => new Set(
    GROUPS.filter(g => g.children.some(c => c.id === activeTab)).map(g => g.id),
  ))
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

  function toggleGroup(id: Group) {
    setOpenGroups(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
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
          <button
            className={`ew-nav-item${activeTab === 'dashboard' ? ' active' : ''}`}
            title={collapsed ? 'Dashboard' : undefined}
            onClick={() => selectTab('dashboard')}>
            <LayoutDashboard size={17} />
            <span>Dashboard</span>
            {actionCount > 0 && (
              <span className="top-nav-badge">{actionCount > 9 ? '9+' : actionCount}</span>
            )}
          </button>

          {GROUPS.map(group => {
            const isOpen = openGroups.has(group.id)
            const groupActive = group.children.some(c => c.id === activeTab)
            return (
              <div key={group.id}>
                <button
                  className={`ew-nav-item${groupActive ? ' active' : ''}`}
                  title={collapsed ? group.label : undefined}
                  onClick={() => toggleGroup(group.id)}>
                  {group.icon}
                  <span>{group.label}</span>
                  <ChevronDown size={14} className={`ew-chev${isOpen ? ' open' : ''}`} />
                </button>
                {isOpen && (
                  <div className="ew-nav-sub">
                    {group.children.map(child => (
                      <button key={child.id}
                        className={`ew-nav-subitem${activeTab === child.id ? ' active' : ''}`}
                        onClick={() => selectTab(child.id)}>
                        {child.label}
                      </button>

                    ))}
                  </div>
                )}
              </div>
            )
          })}

          <button
            className={`ew-nav-item${activeTab === 'scanner' ? ' active' : ''}`}
            title={collapsed ? 'Scanner' : undefined}
            onClick={() => selectTab('scanner')}>
            <Radar size={17} />
            <span>Scanner</span>
          </button>
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
