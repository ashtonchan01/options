import { useState, useRef } from 'react'
import { LayoutDashboard, CalendarDays, Layers, Radar, ClipboardList, FlaskConical, Menu, X, RefreshCw, Upload, Settings, Sun, Moon, ChevronDown } from 'lucide-react'
import type { SyncStatus } from '../../types'
import { useThemeStore } from '../../store/themeStore'
import type { StrategyPage } from '../../App'

export const TAB_IDS = ['dashboard', 'portfolio', 'calendar', 'strategies', 'scanner', 'plan', 'backtest'] as const
export type TabId = typeof TAB_IDS[number]

const STRATEGY_ITEMS: { label: string; page: StrategyPage }[] = [
  { label: 'Covered Calls',    page: 'covered_calls'  },
  { label: 'Cash Secured Puts',page: 'csp'            },
  { label: 'LEAP',             page: 'leap'           },
  { label: 'SPX',              page: 'spx'            },
  { label: 'Rotation Model',   page: 'rotation'       },
  { label: 'PTOS',             page: 'ptos'           },
  { label: 'DCAS',             page: 'dcas'           },
  { label: 'Profit Taking',    page: 'profit_taking'  },
  { label: 'LILO',             page: 'lilo'           },
  { label: 'ARB Cloud',        page: 'arb_cloud'      },
  { label: 'TABI',             page: 'tabi'           },
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

export default function TopNav({ activeTab, onTabChange, onStrategySelect, actionCount, syncStatus, lastSync, hasCredentials, onSyncClick, onXmlUpload, onOpenSettings }: Props) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [stratOpen, setStratOpen] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const stratRef = useRef<HTMLDivElement>(null)
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
    setStratOpen(false)
  }

  // Close strat dropdown on outside click
  const handleStratBlur = () => {
    setTimeout(() => {
      if (stratRef.current && !stratRef.current.contains(document.activeElement)) {
        setStratOpen(false)
      }
    }, 150)
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
          {/* Dashboard */}
          <button
            className={`top-nav-tab${activeTab === 'dashboard' ? ' active' : ''}`}
            onClick={() => selectTab('dashboard')}
          >
            <LayoutDashboard size={15} />
            <span>Dashboard</span>
            {actionCount > 0 && (
              <span className="top-nav-badge">{actionCount > 9 ? '9+' : actionCount}</span>
            )}
          </button>

          {/* Portfolio */}
          <button
            className={`top-nav-tab${activeTab === 'portfolio' ? ' active' : ''}`}
            onClick={() => selectTab('portfolio')}
          >
            <LayoutDashboard size={15} />
            <span>Portfolio</span>
          </button>

          {/* Calendar */}
          <button
            className={`top-nav-tab${activeTab === 'calendar' ? ' active' : ''}`}
            onClick={() => selectTab('calendar')}
          >
            <CalendarDays size={15} />
            <span>Calendar</span>
          </button>

          {/* Strategies dropdown */}
          <div className="strat-dropdown-wrap" ref={stratRef} onBlur={handleStratBlur}>
            <button
              className={`top-nav-tab strat-dropdown-trigger${activeTab === 'strategies' ? ' active' : ''}`}
              onClick={() => setStratOpen(o => !o)}
              aria-haspopup="true"
              aria-expanded={stratOpen}
            >
              <Layers size={15} />
              <span>Strategies</span>
              <ChevronDown size={12} style={{ transition: 'transform 0.2s', transform: stratOpen ? 'rotate(180deg)' : 'none', marginLeft: 2 }} />
            </button>
            {stratOpen && (
              <div className="strat-dropdown-menu">
                <div className="strat-dropdown-view-all">
                  <button className="strat-dropdown-item strat-all" onClick={() => { onStrategySelect('overview'); setStratOpen(false) }}>
                    All Strategies
                  </button>
                </div>
                <div className="strat-dropdown-divider" />
                {STRATEGY_ITEMS.map(item => (
                  <button key={item.page} className="strat-dropdown-item" onClick={() => { onStrategySelect(item.page); setStratOpen(false) }}>
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Scanner */}
          <button
            className={`top-nav-tab${activeTab === 'scanner' ? ' active' : ''}`}
            onClick={() => selectTab('scanner')}
          >
            <Radar size={15} />
            <span>Scanner</span>
          </button>

          {/* Backtest */}
          <button
            className={`top-nav-tab${activeTab === 'backtest' ? ' active' : ''}`}
            onClick={() => selectTab('backtest')}
          >
            <FlaskConical size={15} />
            <span>Backtest</span>
          </button>

          {/* Plan */}
          <button
            className={`top-nav-tab${activeTab === 'plan' ? ' active' : ''}`}
            onClick={() => selectTab('plan')}
          >
            <ClipboardList size={15} />
            <span>Plan</span>
          </button>
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
            {(['dashboard', 'portfolio', 'calendar', 'strategies', 'scanner', 'backtest', 'plan'] as TabId[]).map(id => {
              const iconMap: Record<TabId, React.ReactNode> = {
                dashboard:  <LayoutDashboard size={18} />,
                portfolio:  <LayoutDashboard size={18} />,
                calendar:   <CalendarDays size={18} />,
                strategies: <Layers size={18} />,
                scanner:    <Radar size={18} />,
                backtest:   <FlaskConical size={18} />,
                plan:       <ClipboardList size={18} />,
              }
              const labelMap: Record<TabId, string> = {
                dashboard:  'Dashboard',
                portfolio:  'Portfolio',
                calendar:   'Calendar',
                strategies: 'Strategies',
                scanner:    'Scanner',
                backtest:   'Backtest',
                plan:       'Plan',
              }
              return (
                <button
                  key={id}
                  className={`mobile-menu-item${activeTab === id ? ' active' : ''}`}
                  onClick={() => selectTab(id)}
                >
                  {iconMap[id]}
                  <span>{labelMap[id]}</span>
                  {id === 'dashboard' && actionCount > 0 && (
                    <span className="top-nav-badge">{actionCount > 9 ? '9+' : actionCount}</span>
                  )}
                </button>
              )
            })}
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
