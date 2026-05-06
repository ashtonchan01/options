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
  { id: 'portfolio',     label: 'Portfolio',      Icon: LayoutDashboard },
  { id: 'calendar',      label: 'Calendar',       Icon: CalendarDays },
  { id: 'strategies',    label: 'Strategies',     Icon: Layers },
  { id: 'opportunities', label: 'Opportunities',  Icon: Telescope },
  { id: 'actions',       label: 'Actions',        Icon: Zap },
  { id: 'growth',        label: 'Growth',         Icon: TrendingUp },
]

const SYNC_DOT: Record<SyncStatus, string> = {
  idle:    'bg-neutral-600',
  loading: 'bg-amber-400 animate-pulse',
  success: 'bg-emerald-400',
  error:   'bg-rose-500',
}
const SYNC_LABEL: Record<SyncStatus, string> = {
  idle: 'No data', loading: 'Syncing…', success: 'Synced', error: 'Error',
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
      className="flex flex-col h-screen shrink-0 transition-all duration-200 ease-in-out"
      style={{
        width: collapsed ? 64 : 220,
        background: '#13121c',
        borderRight: '1px solid rgba(124,58,237,0.15)',
      }}
    >
      {/* Logo + toggle */}
      <div className="flex items-center justify-between px-3 py-4" style={{ minHeight: 56 }}>
        {!collapsed && (
          <span
            className="font-bold tracking-widest text-sm select-none"
            style={{
              background: 'linear-gradient(135deg, #7c3aed, #06b6d4)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            OPTIONS
          </span>
        )}
        <button
          onClick={() => setCollapsed(c => !c)}
          className="rounded-md p-1 transition-colors"
          style={{
            marginLeft: collapsed ? 'auto' : 0,
            background: 'rgba(124,58,237,0.15)',
            border: '1px solid rgba(124,58,237,0.25)',
            color: '#c4b5fd',
            cursor: 'pointer',
          }}
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
      </div>

      {/* Nav */}
      <nav className="flex flex-col gap-1 px-2 flex-1">
        {NAV_ITEMS.map(({ id, label, Icon }) => {
          const active = activeTab === id
          return (
            <button
              key={id}
              onClick={() => onTabChange(id)}
              className={clsx(
                'flex items-center rounded-lg text-sm transition-all duration-150 relative w-full',
                collapsed ? 'justify-center py-3' : 'gap-3 px-3 py-2.5',
                active
                  ? 'text-violet-300'
                  : 'text-base-400 hover:text-base-200',
              )}
              style={{
                background: active ? 'rgba(124,58,237,0.15)' : 'transparent',
                border: 'none',
                borderLeft: active ? '2px solid #7c3aed' : '2px solid transparent',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              <div className="relative shrink-0">
                <Icon size={18} />
                {id === 'actions' && actionCount > 0 && (
                  <span
                    className="absolute -top-1.5 -right-1.5 text-white rounded-full flex items-center justify-center"
                    style={{
                      fontSize: 9,
                      fontWeight: 700,
                      background: '#f43f5e',
                      minWidth: 14,
                      height: 14,
                      padding: '0 3px',
                    }}
                  >
                    {actionCount > 9 ? '9+' : actionCount}
                  </span>
                )}
              </div>
              {!collapsed && <span className="truncate">{label}</span>}
            </button>
          )
        })}
      </nav>

      {/* Sync status */}
      <div
        className="flex items-center gap-2 px-4 py-3"
        style={{ borderTop: '1px solid rgba(124,58,237,0.1)' }}
      >
        <span className={clsx('rounded-full shrink-0', SYNC_DOT[syncStatus])} style={{ width: 7, height: 7 }} />
        {!collapsed && (
          <span className="text-xs truncate" style={{ color: '#6b6490' }}>
            {SYNC_LABEL[syncStatus]}
          </span>
        )}
      </div>
    </aside>
  )
}
