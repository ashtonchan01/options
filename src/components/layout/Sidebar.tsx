import { useState } from 'react'
import {
  LayoutDashboard, CalendarDays, Layers, Telescope,
  Zap, TrendingUp, ChevronLeft, ChevronRight,
} from 'lucide-react'
import clsx from 'clsx'
import type { SyncStatus } from '../../types'

export const TAB_IDS = ['portfolio', 'calendar', 'strategies', 'opportunities', 'actions', 'growth'] as const
export type TabId = typeof TAB_IDS[number]

const NAV_ITEMS: { id: TabId; label: string; Icon: React.FC<{ size?: number }> }[] = [
  { id: 'portfolio',     label: 'PORTFOLIO',      Icon: LayoutDashboard },
  { id: 'calendar',      label: 'CALENDAR',       Icon: CalendarDays },
  { id: 'strategies',    label: 'STRATEGIES',     Icon: Layers },
  { id: 'opportunities', label: 'OPPORTUNITIES',  Icon: Telescope },
  { id: 'actions',       label: 'ACTIONS',        Icon: Zap },
  { id: 'growth',        label: 'GROWTH',         Icon: TrendingUp },
]

const SYNC_COLOR: Record<SyncStatus, string> = {
  idle: '#606060', loading: '#F0B429', success: '#00D084', error: '#FF4757',
}
const SYNC_LABEL: Record<SyncStatus, string> = {
  idle: 'NO DATA', loading: 'SYNCING', success: 'SYNCED', error: 'ERROR',
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
    <aside
      className="flex flex-col h-screen shrink-0"
      style={{
        width: collapsed ? 60 : 230,
        transition: 'width 0.2s ease',
        background: '#1A1A1A',
        borderRight: '1px solid #2E2E2E',
      }}
    >
      {/* Logo + toggle */}
      <div
        className="flex items-center justify-between px-3"
        style={{ height: 58, borderBottom: '1px solid #2E2E2E' }}
      >
        {!collapsed && (
          <span
            className="display font-bold tracking-widest text-xs select-none"
            style={{ color: '#00E5FF', letterSpacing: 4, fontSize: 13 }}
          >
            OPTIONS
          </span>
        )}
        <button
          onClick={() => setCollapsed(c => !c)}
          style={{
            marginLeft: collapsed ? 'auto' : 0,
            background: 'transparent',
            border: '1px solid #2E2E2E',
            color: '#606060',
            cursor: 'pointer',
            padding: '3px 5px',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          {collapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
        </button>
      </div>

      {/* Nav */}
      <nav className="flex flex-col flex-1 py-2">
        {NAV_ITEMS.map(({ id, label, Icon }) => {
          const active = activeTab === id
          return (
            <button
              key={id}
              onClick={() => onTabChange(id)}
              className={clsx('flex items-center w-full relative', collapsed ? 'justify-center py-3.5 px-0' : 'gap-3 px-5 py-3')}
              style={{
                background: active ? 'rgba(0,229,255,0.06)' : 'transparent',
                border: 'none',
                borderLeft: active ? '2px solid #00E5FF' : '2px solid transparent',
                color: active ? '#00E5FF' : '#606060',
                cursor: 'pointer',
                fontFamily: 'inherit',
                fontSize: 11,
                letterSpacing: 2,
                fontWeight: 600,
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.color = '#909090' }}
              onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.color = '#606060' }}
            >
              <div className="relative shrink-0">
                <Icon size={18} />
                {id === 'actions' && actionCount > 0 && (
                  <span
                    className="absolute -top-1.5 -right-1.5 flex items-center justify-center"
                    style={{
                      fontSize: 8, fontWeight: 700,
                      background: '#FF4757', color: '#fff',
                      minWidth: 13, height: 13,
                      borderRadius: '50%', padding: '0 2px',
                    }}
                  >
                    {actionCount > 9 ? '9+' : actionCount}
                  </span>
                )}
              </div>
              {!collapsed && <span>{label}</span>}
            </button>
          )
        })}
      </nav>

      {/* Sync status */}
      <div
        className="flex items-center gap-2 px-3 py-3"
        style={{ borderTop: '1px solid #2E2E2E' }}
      >
        <span
          className={syncStatus === 'loading' ? 'pulsing' : ''}
          style={{ width: 7, height: 7, borderRadius: '50%', background: SYNC_COLOR[syncStatus], display: 'inline-block', flexShrink: 0 }}
        />
        {!collapsed && (
          <span style={{ fontSize: 9, color: '#606060', letterSpacing: 2 }}>
            {SYNC_LABEL[syncStatus]}
          </span>
        )}
      </div>
    </aside>
  )
}
