/**
 * Edgewonk-style left sidebar — primary navigation, expandable Strategies
 * section, sync status + actions in the bottom block. Collapses to a
 * hamburger drawer on mobile.
 */
import { useState, useRef } from 'react'
import {
  LayoutDashboard, Briefcase, CalendarDays, Layers, BookOpen, Radar,
  FlaskConical, ClipboardList, Menu, X, RefreshCw, Upload, Settings,
  Sun, Moon, ChevronDown, Pencil,
} from 'lucide-react'
import type { SyncStatus } from '../../types'
import { useThemeStore } from '../../store/themeStore'
import type { StrategyPage } from '../../App'

export const TAB_IDS = ['dashboard', 'portfolio', 'calendar', 'strategies', 'journal', 'scanner', 'plan', 'backtest'] as const
export type TabId = typeof TAB_IDS[number]

const NAV_ITEMS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'dashboard',  label: 'Dashboard',  icon: <LayoutDashboard size={17} /> },
  { id: 'portfolio',  label: 'Portfolio',  icon: <Briefcase size={17} /> },
  { id: 'calendar',   label: 'Calendar',   icon: <CalendarDays size={17} /> },
  // strategies rendered separately (expandable)
  { id: 'journal',    label: 'Journal',    icon: <BookOpen size={17} /> },
  { id: 'scanner',    label: 'Scanner',    icon: <Radar size={17} /> },
  { id: 'backtest',   label: 'Backtest',   icon: <FlaskConical size={17} /> },
  { id: 'plan',       label: 'Plan',       icon: <ClipboardList size={17} /> },
]

const STRATEGY_ITEMS: { label: string; page: StrategyPage }[] = [
  { label: 'Covered Calls',     page: 'covered_calls' },
  { label: 'Cash Secured Puts', page: 'csp'           },
  { label: 'LEAP',              page: 'leap'          },
  { label: 'SPX',               page: 'spx'           },
  { label: 'Rotation Model',    page: 'rotation'      },
  { label: 'PTOS',              page: 'ptos'          },
  { label: 'DCAS',              page: 'dcas'          },
  { label: 'Profit Taking',     page: 'profit_taking' },
  { label: 'LILO',              page: 'lilo'          },
  { label: 'ARB Cloud',         page: 'arb_cloud'     },
  { label: 'TABI',              page: 'tabi'          },
]

function relativeTime(ms: number): string {
  const diff = Date.now() - ms
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  return `${Math.floor(diff / 3_600_000)}h ago`
}

interface Props {
  activeTab: TabId
  stratPage: StrategyPage
  onTabChange: (tab: TabId) => void
  onStrategySelect: (page: StrategyPage) => void
  actionCount: number
  syncStatus: SyncStatus
  syncError?: string
  lastSync?: number
  hasCredentials: boolean
  onSyncClick: () => void
  onXmlUpload: (file: File) => void
  onOpenSettings: () => void
}

export default function Sidebar({
  activeTab, stratPage, onTabChange, onStrategySelect, actionCount,
  syncStatus, lastSync, hasCredentials, onSyncClick, onXmlUpload, onOpenSettings,
}: Props) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [stratOpen, setStratOpen]   = useState(activeTab === 'strategies')
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

  function selectStrategy(page: StrategyPage) {
    onStrategySelect(page)
    setStratOpen(true)
    setDrawerOpen(false)
  }

  return (
    <>
      <aside className={`ew-sidebar${drawerOpen ? ' open' : ''}`}>
        <div className="ew-logo">
          <div className="ew-logo-mark">O</div>
          <div>
            <div className="ew-logo-name">Options</div>
            <div className="ew-logo-sub">Trading Journal</div>
          </div>
        </div>

        <nav className="ew-nav">
          {NAV_ITEMS.slice(0, 3).map(item => (
            <button key={item.id}
              className={`ew-nav-item${activeTab === item.id ? ' active' : ''}`}
              onClick={() => selectTab(item.id)}>
              {item.icon}
              <span>{item.label}</span>
              {item.id === 'dashboard' && actionCount > 0 && (
                <span className="top-nav-badge">{actionCount > 9 ? '9+' : actionCount}</span>
              )}
            </button>
          ))}

          {/* Strategies — expandable section */}
          <button
            className={`ew-nav-item${activeTab === 'strategies' ? ' active' : ''}`}
            onClick={() => {
              if (activeTab !== 'strategies') selectStrategy('overview')
              else setStratOpen(o => !o)
            }}>
            <Layers size={17} />
            <span>Strategies</span>
            <ChevronDown size={14} className={`ew-chev${stratOpen ? ' open' : ''}`} />
          </button>
          {stratOpen && (
            <div className="ew-nav-sub">
              <button
                className={`ew-nav-subitem${activeTab === 'strategies' && stratPage === 'overview' ? ' active' : ''}`}
                onClick={() => selectStrategy('overview')}>
                All Strategies
              </button>
              <button
                className={`ew-nav-subitem${activeTab === 'strategies' && stratPage === 'label_trades' ? ' active' : ''}`}
                style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                onClick={() => selectStrategy('label_trades')}>
                <Pencil size={11} /> Label Trades
              </button>
              {STRATEGY_ITEMS.map(item => (
                <button key={item.page}
                  className={`ew-nav-subitem${activeTab === 'strategies' && stratPage === item.page ? ' active' : ''}`}
                  onClick={() => selectStrategy(item.page)}>
                  {item.label}
                </button>
              ))}
            </div>
          )}

          {NAV_ITEMS.slice(3).map(item => (
            <button key={item.id}
              className={`ew-nav-item${activeTab === item.id ? ' active' : ''}`}
              onClick={() => selectTab(item.id)}>
              {item.icon}
              <span>{item.label}</span>
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
          </div>
        </div>
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
