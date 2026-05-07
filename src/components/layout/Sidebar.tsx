import { useState } from 'react'
import { LayoutDashboard, CalendarDays, Layers, Telescope, Zap, TrendingUp, ChevronLeft, ChevronRight } from 'lucide-react'
import type { SyncStatus } from '../../types'

export const TAB_IDS = ['portfolio', 'calendar', 'strategies', 'opportunities', 'actions', 'growth'] as const
export type TabId = typeof TAB_IDS[number]

const NAV_ITEMS: { id: TabId; label: string; Icon: React.FC<{ size?: number }> }[] = [
  { id: 'portfolio',     label: 'Portfolio',     Icon: LayoutDashboard },
  { id: 'calendar',      label: 'Calendar',      Icon: CalendarDays },
  { id: 'strategies',    label: 'Strategies',    Icon: Layers },
  { id: 'opportunities', label: 'Opportunities', Icon: Telescope },
  { id: 'actions',       label: 'Actions',       Icon: Zap },
  { id: 'growth',        label: 'Growth',        Icon: TrendingUp },
]

const SYNC_COLOR: Record<SyncStatus, string> = {
  idle: '#333', loading: '#f59e0b', success: '#10b981', error: '#f43f5e',
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
      width: collapsed ? 54 : 220,
      transition: 'width 0.2s ease',
      background: '#161616',
      borderRight: '1px solid #2E2E2E',
      display: 'flex', flexDirection: 'column', height: '100vh', flexShrink: 0,
    }}>
      {/* Logo + toggle */}
      <div style={{
        height: 54, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 14px', borderBottom: '1px solid #2E2E2E', flexShrink: 0,
      }}>
        {!collapsed && (
          <span style={{
            fontFamily: 'IBM Plex Mono, monospace', fontWeight: 700,
            fontSize: 13, letterSpacing: 4, color: '#e8e8e8',
          }}>
            OPTIONS
          </span>
        )}
        <button onClick={() => setCollapsed(c => !c)} style={{
          marginLeft: collapsed ? 'auto' : 0,
          background: 'none', border: '1px solid #2E2E2E', color: '#808080',
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
                background: active ? '#161616' : 'transparent',
                border: 'none',
                borderLeft: active ? '2px solid #e8e8e8' : '2px solid transparent',
                color: active ? '#e8e8e8' : '#888',
                cursor: 'pointer', fontFamily: 'inherit', fontSize: 13,
                width: '100%', textAlign: 'left',
                transition: 'color 0.15s, background 0.15s',
              }}
              onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.color = '#ccc' }}
              onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.color = '#888' }}
            >
              <div style={{ position: 'relative', flexShrink: 0 }}>
                <Icon size={17} />
                {id === 'actions' && actionCount > 0 && (
                  <span style={{
                    position: 'absolute', top: -5, right: -5,
                    background: '#f43f5e', color: '#fff',
                    fontSize: 8, fontWeight: 700,
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
      <div style={{ padding: '12px 16px', borderTop: '1px solid #2E2E2E', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{
          width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
          background: SYNC_COLOR[syncStatus],
          animation: syncStatus === 'loading' ? 'pulse 1s ease-in-out infinite' : 'none',
        }} />
        {!collapsed && (
          <span style={{ fontSize: 10, color: '#909090', letterSpacing: 1 }}>
            {syncStatus === 'success' ? 'Synced' : syncStatus === 'loading' ? 'Syncing…' : syncStatus === 'error' ? 'Error' : 'No data'}
          </span>
        )}
      </div>
    </aside>
  )
}
