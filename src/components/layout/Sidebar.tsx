import { useState } from 'react'
import { LayoutDashboard, CalendarDays, Layers, Telescope, Zap, ClipboardList, FlaskConical, ChevronLeft, ChevronRight } from 'lucide-react'
import type { SyncStatus } from '../../types'

export const TAB_IDS = ['portfolio', 'calendar', 'strategies', 'opportunities', 'actions', 'plan', 'backtest'] as const
export type TabId = typeof TAB_IDS[number]

const NAV_ITEMS: { id: TabId; label: string; Icon: React.FC<{ size?: number }> }[] = [
  { id: 'portfolio',     label: 'Portfolio',     Icon: LayoutDashboard },
  { id: 'calendar',      label: 'Calendar',      Icon: CalendarDays },
  { id: 'strategies',    label: 'Strategies',    Icon: Layers },
  { id: 'opportunities', label: 'Opportunities', Icon: Telescope },
  { id: 'actions',       label: 'Actions',       Icon: Zap },
  { id: 'plan',          label: 'Plan',          Icon: ClipboardList },
  { id: 'backtest',      label: 'Backtest',      Icon: FlaskConical },
]

const SYNC_COLOR: Record<SyncStatus, string> = {
  idle: 'var(--text-5)', loading: '#F0B429', success: '#00D084', error: '#FF4757',
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
      width: collapsed ? 58 : 220,
      transition: 'width 0.2s ease',
      background: 'var(--bg-surface)',
      borderRight: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column', height: '100vh', flexShrink: 0,
    }}>
      {/* Logo + toggle */}
      <div style={{
        height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 16px', borderBottom: '1px solid var(--border)', flexShrink: 0,
      }}>
        {!collapsed && (
          <span style={{
            fontFamily: "'Chakra Petch', sans-serif", fontWeight: 700,
            fontSize: 16, letterSpacing: 3, color: 'var(--accent)',
          }}>
            OPTIONS
          </span>
        )}
        <button onClick={() => setCollapsed(c => !c)} style={{
          marginLeft: collapsed ? 'auto' : 0,
          background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-4)',
          cursor: 'pointer', padding: '4px 6px', display: 'flex', alignItems: 'center',
          borderRadius: 4, transition: 'border-color 0.15s, color 0.15s',
        }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--border-light)'; e.currentTarget.style.color = 'var(--text-2)' }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-4)' }}
        >
          {collapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
        </button>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: '10px 0', display: 'flex', flexDirection: 'column', gap: 2 }}>
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
                padding: collapsed ? '11px 0' : '9px 16px',
                background: active ? 'var(--accent-dim)' : 'transparent',
                border: 'none',
                borderLeft: active ? '2px solid var(--accent)' : '2px solid transparent',
                color: active ? 'var(--accent)' : 'var(--text-4)',
                cursor: 'pointer', fontFamily: "'Inter', sans-serif", fontSize: 13,
                fontWeight: active ? 600 : 400,
                letterSpacing: active ? '0.5px' : '0',
                width: '100%', textAlign: 'left',
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => {
                if (!active) {
                  (e.currentTarget as HTMLElement).style.color = 'var(--text-2)'
                  ;(e.currentTarget as HTMLElement).style.background = 'var(--bg-elevated)'
                }
              }}
              onMouseLeave={e => {
                if (!active) {
                  (e.currentTarget as HTMLElement).style.color = 'var(--text-4)'
                  ;(e.currentTarget as HTMLElement).style.background = 'transparent'
                }
              }}
            >
              <div style={{ position: 'relative', flexShrink: 0 }}>
                <Icon size={17} />
                {id === 'actions' && actionCount > 0 && (
                  <span style={{
                    position: 'absolute', top: -5, right: -5,
                    background: '#FF4757', color: '#fff',
                    fontSize: 9, fontWeight: 700,
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
          width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
          background: SYNC_COLOR[syncStatus],
          animation: syncStatus === 'loading' ? 'pulse 1s ease-in-out infinite' : 'none',
          boxShadow: syncStatus === 'success' ? '0 0 6px rgba(0,208,132,0.4)' : 'none',
        }} />
        {!collapsed && (
          <span style={{ fontSize: 11, color: 'var(--text-4)', letterSpacing: 1.5, fontWeight: 500 }}>
            {syncStatus === 'success' ? 'SYNCED' : syncStatus === 'loading' ? 'SYNCING…' : syncStatus === 'error' ? 'ERROR' : 'NO DATA'}
          </span>
        )}
      </div>
    </aside>
  )
}
