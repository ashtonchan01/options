import { useState } from 'react'
import { LayoutDashboard, CalendarDays, Layers, Telescope, Zap, TrendingUp, FlaskConical, Milestone, ChevronLeft, ChevronRight } from 'lucide-react'
import type { SyncStatus } from '../../types'

export const TAB_IDS = ['portfolio', 'calendar', 'strategies', 'opportunities', 'actions', 'growth', 'backtest', 'phases'] as const
export type TabId = typeof TAB_IDS[number]

const NAV_ITEMS: { id: TabId; label: string; Icon: React.FC<{ size?: number }> }[] = [
  { id: 'portfolio',     label: 'Portfolio',     Icon: LayoutDashboard },
  { id: 'calendar',      label: 'Calendar',      Icon: CalendarDays },
  { id: 'strategies',    label: 'Strategies',    Icon: Layers },
  { id: 'opportunities', label: 'Opportunities', Icon: Telescope },
  { id: 'actions',       label: 'Actions',       Icon: Zap },
  { id: 'growth',        label: 'Growth',        Icon: TrendingUp },
  { id: 'backtest',      label: 'Backtest',      Icon: FlaskConical },
  { id: 'phases',        label: 'Phases',        Icon: Milestone },
]

const SYNC_COLOR: Record<SyncStatus, string> = {
  idle: 'var(--text-5)', loading: '#f59e0b', success: '#10b981', error: '#f43f5e',
}

interface SidebarProps {
  activeTab: TabId
  onTabChange: (tab: TabId) => void
  actionCount: number
  syncStatus: SyncStatus
}

export default function Sidebar({ activeTab, onTabChange, actionCount, syncStatus }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <aside style={{
      width: collapsed ? 58 : 240,
      transition: 'width 0.2s ease',
      background: 'var(--bg-surface)',
      borderRight: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column', height: '100vh', flexShrink: 0,
    }}>
      {/* Logo + toggle */}
      <div style={{
        height: 58, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 16px', borderBottom: '1px solid var(--border)', flexShrink: 0,
      }}>
        {!collapsed && (
          <span style={{
            fontFamily: 'IBM Plex Mono, monospace', fontWeight: 700,
            fontSize: 15, letterSpacing: 4, color: 'var(--text-1)',
          }}>
            OPTIONS
          </span>
        )}
        <button onClick={() => setCollapsed(c => !c)} style={{
          marginLeft: collapsed ? 'auto' : 0,
          background: 'none', border: '1px solid var(--border)', color: 'var(--text-3)',
          cursor: 'pointer', padding: '4px 6px', display: 'flex', alignItems: 'center',
        }}>
          {collapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
        </button>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: '8px 0', display: 'flex', flexDirection: 'column', gap: 1 }}>
        {NAV_ITEMS.map(({ id, label, Icon }) => {
          const active = activeTab === id
          return (
            <button
              key={id}
              onClick={() => onTabChange(id)}
              style={{
                display: 'flex', alignItems: 'center',
                gap: collapsed ? 0 : 12,
                justifyContent: collapsed ? 'center' : 'flex-start',
                padding: collapsed ? '12px 0' : '10px 16px',
                background: active ? 'var(--bg-active)' : 'transparent',
                border: 'none',
                borderLeft: active ? '2px solid #6366F1' : '2px solid transparent',
                color: active ? 'var(--text-1)' : 'var(--text-3)',
                cursor: 'pointer', fontFamily: 'inherit', fontSize: 15,
                width: '100%', textAlign: 'left',
                transition: 'color 0.15s, background 0.15s',
              }}
              onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.color = 'var(--text-2)' }}
              onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.color = 'var(--text-3)' }}
            >
              <div style={{ position: 'relative', flexShrink: 0 }}>
                <Icon size={19} />
                {id === 'actions' && actionCount > 0 && (
                  <span style={{
                    position: 'absolute', top: -5, right: -5,
                    background: '#f43f5e', color: '#fff',
                    fontSize: 10, fontWeight: 700,
                    minWidth: 13, height: 13, borderRadius: '50%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 2px',
                  }}>
                    {actionCount > 9 ? '9+' : actionCount}
                  </span>
                )}
              </div>
              {!collapsed && label}
            </button>
          )
        })}
      </nav>

      {/* Sync dot */}
      <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{
          width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
          background: SYNC_COLOR[syncStatus],
          animation: syncStatus === 'loading' ? 'pulse 1s ease-in-out infinite' : 'none',
        }} />
        {!collapsed && (
          <span style={{ fontSize: 12, color: 'var(--text-3)', letterSpacing: 1 }}>
            {syncStatus === 'success' ? 'Synced' : syncStatus === 'loading' ? 'Syncing…' : syncStatus === 'error' ? 'Error' : 'No data'}
          </span>
        )}
      </div>
    </aside>
  )
}
