/**
 * Edgewonk-style left sidebar — primary navigation, expandable Personal/
 * Business account groups built from whatever accounts the signed-in user
 * has created (no hardcoded brokers — generic for any user), sync status +
 * actions in the bottom block. Collapses to a hamburger drawer on mobile.
 */
import { useState, useRef } from 'react'
import {
  LayoutDashboard, User, Building2, Radar, Plus, X as XIcon,
  Menu, X, RefreshCw, Upload, Settings,
  Sun, Moon, LogOut, ChevronLeft, ChevronRight, ChevronDown,
} from 'lucide-react'
import type { SyncStatus } from '../../types'
import type { Account, Entity } from '../../store/accountsStore'
import { useThemeStore } from '../../store/themeStore'

export type TabId = 'dashboard' | 'scanner' | string

export function accountTabId(accountId: string): TabId {
  return `account:${accountId}`
}
export function parseAccountTabId(tab: TabId): string | null {
  return tab.startsWith('account:') ? tab.slice('account:'.length) : null
}

const ENTITY_META: Record<Entity, { label: string; icon: React.ReactNode }> = {
  personal: { label: 'Personal', icon: <User size={17} /> },
  business: { label: 'Business', icon: <Building2 size={17} /> },
}

function relativeTime(ms: number): string {
  const diff = Date.now() - ms
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  return `${Math.floor(diff / 3_600_000)}h ago`
}

interface Props {
  activeTab: TabId
  onTabChange: (tab: TabId) => void
  accounts: Account[]
  onAddAccount: (name: string, entity: Entity) => string
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
  activeTab, onTabChange, accounts, onAddAccount,
  syncStatus, lastSync, hasCredentials, onSyncClick, onXmlUpload, onOpenSettings,
  userEmail, onSignOut,
}: Props) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [collapsed, setCollapsed]   = useState(() => localStorage.getItem('options:sidebar-collapsed') !== '0')
  const [openGroups, setOpenGroups] = useState<Set<Entity>>(() => new Set(
    (['personal', 'business'] as Entity[]).filter(entity =>
      accounts.some(a => a.entity === entity && accountTabId(a.id) === activeTab),
    ),
  ))
  const [addingIn, setAddingIn] = useState<Entity | null>(null)
  const [newName, setNewName] = useState('')
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

  function toggleGroup(entity: Entity) {
    setOpenGroups(prev => {
      const next = new Set(prev)
      if (next.has(entity)) next.delete(entity); else next.add(entity)
      return next
    })
  }

  function startAdding(entity: Entity) {
    setOpenGroups(prev => new Set(prev).add(entity))
    setAddingIn(entity)
    setNewName('')
  }

  function confirmAdd(entity: Entity) {
    const name = newName.trim()
    if (name) {
      const id = onAddAccount(name, entity)
      selectTab(accountTabId(id))
    }
    setAddingIn(null)
    setNewName('')
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
          </button>

          {(['personal', 'business'] as Entity[]).map(entity => {
            const isOpen = openGroups.has(entity)
            const entityAccounts = accounts.filter(a => a.entity === entity)
            const groupActive = entityAccounts.some(a => accountTabId(a.id) === activeTab)
            const meta = ENTITY_META[entity]
            return (
              <div key={entity}>
                <button
                  className={`ew-nav-item${groupActive ? ' active' : ''}`}
                  title={collapsed ? meta.label : undefined}
                  onClick={() => toggleGroup(entity)}>
                  {meta.icon}
                  <span>{meta.label}</span>
                  <ChevronDown size={14} className={`ew-chev${isOpen ? ' open' : ''}`} />
                </button>
                {isOpen && (
                  <div className="ew-nav-sub">
                    {entityAccounts.map(account => (
                      <button key={account.id}
                        className={`ew-nav-subitem${activeTab === accountTabId(account.id) ? ' active' : ''}`}
                        onClick={() => selectTab(accountTabId(account.id))}>
                        {account.name}
                      </button>
                    ))}
                    {addingIn === entity ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 12px 4px 38px' }}>
                        <input
                          autoFocus
                          value={newName}
                          onChange={e => setNewName(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') confirmAdd(entity); if (e.key === 'Escape') setAddingIn(null) }}
                          placeholder="Account name"
                          style={{
                            flex: 1, minWidth: 0, fontSize: 12, padding: '4px 6px', borderRadius: 5,
                            border: '1px solid var(--sb-border)', background: 'var(--sb-hover)', color: 'var(--sb-text)',
                          }}
                        />
                        <button onClick={() => confirmAdd(entity)} title="Add account" className="ew-icon-btn" style={{ width: 24, height: 24 }}>
                          <Plus size={12} />
                        </button>
                        <button onClick={() => setAddingIn(null)} title="Cancel" className="ew-icon-btn" style={{ width: 24, height: 24 }}>
                          <XIcon size={12} />
                        </button>
                      </div>
                    ) : (
                      <button className="ew-nav-subitem" onClick={() => startAdding(entity)}
                        style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--sb-text-faint)' }}>
                        <Plus size={11} /> Add account
                      </button>
                    )}
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
