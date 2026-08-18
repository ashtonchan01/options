/**
 * Edgewonk-style left sidebar — primary navigation. Accounts are a flat,
 * fully user-named list (no imposed Personal/Business/broker
 * categorization) built via an inline "+ Add account" row. Each account
 * owns its own IBKR Flex sync / statement upload (see AccountView), so
 * this sidebar no longer has a single app-wide sync status or credentials
 * to show — just theme + sign-out in the bottom block. Collapses to a
 * hamburger drawer on mobile.
 */
import { useState } from 'react'
import {
  LayoutDashboard, Briefcase, Radar, ListChecks, Plus, X as XIcon,
  Menu, X,
  Sun, Moon, LogOut, ChevronLeft, ChevronRight,
} from 'lucide-react'
import type { Account } from '../../store/accountsStore'
import { useThemeStore } from '../../store/themeStore'

export type TabId = 'dashboard' | 'watchlist' | 'scanner' | string

export function accountTabId(accountId: string): TabId {
  return `account:${accountId}`
}
export function parseAccountTabId(tab: TabId): string | null {
  return tab.startsWith('account:') ? tab.slice('account:'.length) : null
}

interface Props {
  activeTab: TabId
  onTabChange: (tab: TabId) => void
  accounts: Account[]
  onAddAccount: (name: string) => string
  userEmail?: string
  onSignOut?: () => void
}

export default function Sidebar({
  activeTab, onTabChange, accounts, onAddAccount,
  userEmail, onSignOut,
}: Props) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [collapsed, setCollapsed]   = useState(() => localStorage.getItem('options:sidebar-collapsed') !== '0')
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const { theme, toggle } = useThemeStore()

  function selectTab(tab: TabId) {
    onTabChange(tab)
    setDrawerOpen(false)
  }

  function confirmAdd() {
    const name = newName.trim()
    if (name) {
      const id = onAddAccount(name)
      selectTab(accountTabId(id))
    }
    setAdding(false)
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
          <div className="ew-logo-name">Options</div>
        </div>

        <nav className="ew-nav">
          <button
            className={`ew-nav-item${activeTab === 'dashboard' ? ' active' : ''}`}
            title={collapsed ? 'Dashboard' : undefined}
            onClick={() => selectTab('dashboard')}>
            <LayoutDashboard size={17} />
            <span>Dashboard</span>
          </button>

          <button
            className={`ew-nav-item${activeTab === 'watchlist' ? ' active' : ''}`}
            title={collapsed ? 'Watchlist' : undefined}
            onClick={() => selectTab('watchlist')}>
            <ListChecks size={17} />
            <span>Watchlist</span>
          </button>

          {accounts.map(account => (
            <button key={account.id}
              className={`ew-nav-item${activeTab === accountTabId(account.id) ? ' active' : ''}`}
              title={collapsed ? account.name : undefined}
              onClick={() => selectTab(accountTabId(account.id))}>
              <Briefcase size={17} />
              <span>{account.name}</span>
            </button>
          ))}

          {adding ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 12px' }}>
              {/* Decoy username/password pair — Safari's Keychain autofill
                  heuristic associates a saved login for this domain with the
                  first text-feeling input on the page regardless of
                  autocomplete="off" on the real field below. Giving it these
                  off-screen (but not display:none, which some heuristics
                  ignore) fields to latch onto instead keeps the suggestion
                  off the actual "Account name" input. */}
              <input type="text" name="username" autoComplete="username" tabIndex={-1} aria-hidden="true"
                style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }} />
              <input type="password" name="password" autoComplete="current-password" tabIndex={-1} aria-hidden="true"
                style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }} />
              <input
                autoFocus
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') confirmAdd(); if (e.key === 'Escape') setAdding(false) }}
                placeholder="Account name"
                name="acct-label"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                style={{
                  flex: 1, minWidth: 0, fontSize: 12, padding: '5px 7px', borderRadius: 5,
                  border: '1px solid var(--sb-border)', background: 'var(--sb-hover)', color: 'var(--sb-text)',
                }}
              />
              <button onClick={confirmAdd} title="Add account" className="ew-icon-btn" style={{ width: 26, height: 26 }}>
                <Plus size={13} />
              </button>
              <button onClick={() => setAdding(false)} title="Cancel" className="ew-icon-btn" style={{ width: 26, height: 26 }}>
                <XIcon size={13} />
              </button>
            </div>
          ) : (
            <button className="ew-nav-item" title={collapsed ? 'Add account' : undefined} onClick={() => setAdding(true)}
              style={{ color: 'var(--sb-text-faint)' }}>
              <Plus size={17} />
              <span>Add account</span>
            </button>
          )}

          <button
            className={`ew-nav-item${activeTab === 'scanner' ? ' active' : ''}`}
            title={collapsed ? 'Scanner' : undefined}
            onClick={() => selectTab('scanner')}>
            <Radar size={17} />
            <span>Scanner</span>
          </button>
        </nav>

        <div className="ew-side-bottom">
          <div className="ew-icon-row">
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
      </div>
    </>
  )
}
