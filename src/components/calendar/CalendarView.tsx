import { useState, useMemo } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { AppState, Strategy, StrategyType } from '../../types'
import EmptyState from '../shared/EmptyState'

interface Props { state: AppState }

// ─── Constants ───────────────────────────────────────────────────────────────

const STRAT_COLOR: Record<StrategyType, string> = {
  csp:           '#f43f5e',
  covered_call:  '#3b82f6',
  pmcc:          '#3b82f6',
  risk_reversal: '#38bdf8',
  put_spread:    '#fbbf24',
  call_spread:   '#fb923c',
  leap:          '#10b981',
  other:         '#444',
}

const STRAT_LABEL: Record<StrategyType, string> = {
  csp:           'CSP',
  covered_call:  'CC',
  pmcc:          'PMCC',
  risk_reversal: 'RR',
  put_spread:    'P SPD',
  call_spread:   'C SPD',
  leap:          'LEAP',
  other:         'OTH',
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

// ─── Types ───────────────────────────────────────────────────────────────────

interface ExpiryEvent {
  date: string        // YYYY-MM-DD
  strategyId: string
  strategyType: StrategyType
  underlying: string
  strike: number
  putCall: 'C' | 'P'
  quantity: number
  dte: number
  unrealizedPnL: number
  netPremium: number
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt$(n: number, d = 0) {
  return (n < 0 ? '-$' : '+$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
}

function normalizeExpiry(s: string): string {
  const m = s.match(/^(\d{4})(\d{2})(\d{2})$/)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : s
}

function toYMD(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function todayYMD(): string {
  return toYMD(new Date())
}

// ─── Derive events from strategies ───────────────────────────────────────────

function deriveEvents(strategies: Strategy[]): ExpiryEvent[] {
  return strategies.flatMap(s =>
    s.legs
      .filter(l => l.expiry)
      .map(l => ({
        date:         normalizeExpiry(l.expiry),
        strategyId:   s.id,
        strategyType: s.type,
        underlying:   s.underlying,
        strike:       l.strike,
        putCall:      l.putCall,
        quantity:     l.quantity,
        dte:          l.dte,
        unrealizedPnL: s.unrealizedPnL,
        netPremium:   s.netPremiumReceived,
      }))
  )
}

// ─── Calendar grid logic ──────────────────────────────────────────────────────

function calendarDays(year: number, month: number): (string | null)[] {
  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: (string | null)[] = []
  for (let i = 0; i < firstDay; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(`${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`)
  }
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

// ─── Event pill ──────────────────────────────────────────────────────────────

function EventPill({ ev }: { ev: ExpiryEvent }) {
  const color = STRAT_COLOR[ev.strategyType]
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 4,
      padding: '2px 5px', marginBottom: 2,
      background: `${color}14`, border: `1px solid ${color}30`,
      fontSize: 10, lineHeight: 1.4,
    }}>
      <span style={{ fontWeight: 700, color, fontFamily: 'IBM Plex Mono, monospace', flexShrink: 0 }}>
        {ev.underlying}
      </span>
      <span style={{ color: '#444', flexShrink: 0 }}>{STRAT_LABEL[ev.strategyType]}</span>
      <span style={{ marginLeft: 'auto', fontFamily: 'IBM Plex Mono, monospace', color: ev.unrealizedPnL >= 0 ? '#10b981' : '#f43f5e', flexShrink: 0 }}>
        {ev.unrealizedPnL >= 0 ? '+' : ''}{Math.round(ev.unrealizedPnL)}
      </span>
    </div>
  )
}

// ─── Day cell ────────────────────────────────────────────────────────────────

function DayCell({
  date, events, isToday, isSelected, onClick,
}: {
  date: string | null
  events: ExpiryEvent[]
  isToday: boolean
  isSelected: boolean
  onClick: () => void
}) {
  if (!date) return <div style={{ background: '#080808', border: '1px solid #0f0f0f' }} />

  const dayNum = parseInt(date.split('-')[2])
  const hasEvents = events.length > 0
  const totalPnL = events.reduce((s, e) => s + e.unrealizedPnL, 0)

  return (
    <div
      onClick={onClick}
      style={{
        background: isSelected ? '#0d1a2e' : hasEvents ? '#0a0d14' : '#0a0a0a',
        border: `1px solid ${isSelected ? '#1d3a6e' : isToday ? '#2a2a2a' : '#111'}`,
        padding: '6px 8px',
        cursor: hasEvents ? 'pointer' : 'default',
        minHeight: 80,
        position: 'relative',
        transition: 'background 0.1s',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{
          fontSize: 12, fontWeight: isToday ? 700 : 400,
          color: isToday ? '#3b82f6' : '#333',
          fontFamily: 'IBM Plex Mono, monospace',
          background: isToday ? '#3b82f614' : 'transparent',
          borderRadius: 2, padding: isToday ? '0 4px' : 0,
        }}>
          {dayNum}
        </span>
        {hasEvents && (
          <span style={{
            fontSize: 9, fontFamily: 'IBM Plex Mono, monospace',
            color: totalPnL >= 0 ? '#10b981' : '#f43f5e',
          }}>
            {totalPnL >= 0 ? '+' : ''}{Math.round(totalPnL)}
          </span>
        )}
      </div>
      {events.slice(0, 3).map((ev, i) => <EventPill key={i} ev={ev} />)}
      {events.length > 3 && (
        <div style={{ fontSize: 9, color: '#333', fontFamily: 'IBM Plex Mono, monospace', paddingLeft: 2 }}>
          +{events.length - 3} more
        </div>
      )}
    </div>
  )
}

// ─── Expiry list (sidebar) ────────────────────────────────────────────────────

function ExpiryList({ events, selectedDate }: { events: ExpiryEvent[]; selectedDate: string | null }) {
  const today = todayYMD()
  const upcoming = [...events]
    .filter(e => e.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date))

  const displayEvents = selectedDate
    ? events.filter(e => e.date === selectedDate)
    : upcoming

  const title = selectedDate
    ? new Date(selectedDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    : 'Upcoming Expirations'

  // Group by date for upcoming view
  const grouped = displayEvents.reduce<Record<string, ExpiryEvent[]>>((acc, e) => {
    acc[e.date] = [...(acc[e.date] ?? []), e]
    return acc
  }, {})

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0, overflow: 'auto', flex: 1 }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #111', fontSize: 11, fontWeight: 700, color: '#444', letterSpacing: '0.08em' }}>
        {title.toUpperCase()}
      </div>

      {displayEvents.length === 0 && (
        <div style={{ padding: 24, color: '#222', fontSize: 12, textAlign: 'center' }}>
          {selectedDate ? 'No expirations on this date' : 'No upcoming expirations'}
        </div>
      )}

      {Object.entries(grouped).map(([date, evs]) => {
        const d = new Date(date + 'T12:00:00')
        const label = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
        const datePnL = evs.reduce((s, e) => s + e.unrealizedPnL, 0)
        const daysAway = Math.round((d.getTime() - Date.now()) / 86_400_000)

        return (
          <div key={date} style={{ borderBottom: '1px solid #0f0f0f' }}>
            {/* Date header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', background: '#0d0d0d' }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#555', fontFamily: 'IBM Plex Mono, monospace' }}>{label}</span>
              <span style={{ fontSize: 10, color: '#2a2a2a' }}>{daysAway}d away</span>
              <div style={{ flex: 1 }} />
              <span style={{ fontSize: 11, fontFamily: 'IBM Plex Mono, monospace', color: datePnL >= 0 ? '#10b981' : '#f43f5e' }}>
                {fmt$(datePnL)}
              </span>
            </div>

            {/* Events */}
            {evs.map((ev, i) => {
              const color = STRAT_COLOR[ev.strategyType]
              const isShort = ev.quantity < 0
              return (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '8px 16px', borderTop: '1px solid #0a0a0a',
                  fontSize: 12,
                }}>
                  <div style={{ width: 3, height: 32, background: color, flexShrink: 0, borderRadius: 1 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                      <span style={{ fontWeight: 700, color: '#ccc', fontFamily: 'IBM Plex Mono, monospace', fontSize: 13 }}>
                        {ev.underlying}
                      </span>
                      <span style={{ padding: '1px 5px', fontSize: 9, fontWeight: 700, color, background: `${color}14`, border: `1px solid ${color}30` }}>
                        {STRAT_LABEL[ev.strategyType]}
                      </span>
                      <span style={{ fontSize: 10, color: '#444', fontFamily: 'IBM Plex Mono, monospace' }}>
                        {isShort ? 'SHORT' : 'LONG'} {ev.putCall === 'C' ? 'CALL' : 'PUT'}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: '#444', fontFamily: 'IBM Plex Mono, monospace' }}>
                      ${ev.strike.toLocaleString()} · {ev.dte}d · {ev.quantity} contracts
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: 11, fontFamily: 'IBM Plex Mono, monospace', color: ev.unrealizedPnL >= 0 ? '#10b981' : '#f43f5e', fontWeight: 600 }}>
                      {fmt$(ev.unrealizedPnL)}
                    </div>
                    {ev.netPremium > 0 && (
                      <div style={{ fontSize: 10, color: '#333', fontFamily: 'IBM Plex Mono, monospace' }}>
                        {fmt$(ev.netPremium)} prem
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

// ─── Main view ────────────────────────────────────────────────────────────────

export default function CalendarView({ state }: Props) {
  const today = new Date()
  const [year, setYear]     = useState(today.getFullYear())
  const [month, setMonth]   = useState(today.getMonth())
  const [selected, setSelected] = useState<string | null>(null)

  const events = useMemo(() => deriveEvents(state.strategies), [state.strategies])

  const byDate = useMemo(() => {
    const map: Record<string, ExpiryEvent[]> = {}
    for (const e of events) map[e.date] = [...(map[e.date] ?? []), e]
    return map
  }, [events])

  const cells = useMemo(() => calendarDays(year, month), [year, month])
  const todayStr = todayYMD()

  function prevMonth() {
    if (month === 0) { setYear(y => y - 1); setMonth(11) }
    else setMonth(m => m - 1)
  }
  function nextMonth() {
    if (month === 11) { setYear(y => y + 1); setMonth(0) }
    else setMonth(m => m + 1)
  }

  const monthPnL = Object.entries(byDate)
    .filter(([d]) => d.startsWith(`${year}-${String(month + 1).padStart(2, '0')}`))
    .reduce((s, [, evs]) => s + evs.reduce((a, e) => a + e.unrealizedPnL, 0), 0)

  if (!state.strategies.length) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <EmptyState title="No expirations" message="Sync your IBKR portfolio to see expirations on the calendar." showUpload />
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>

      {/* ── Calendar ──────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: '20px 0 20px 24px' }}>

        {/* Month nav */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, paddingRight: 24 }}>
          <button onClick={prevMonth} style={{ background: 'none', border: '1px solid #1a1a1a', color: '#555', cursor: 'pointer', padding: '4px 8px', display: 'flex' }}>
            <ChevronLeft size={14} />
          </button>
          <span style={{ fontSize: 15, fontWeight: 600, color: '#e8e8e8', minWidth: 160, textAlign: 'center' }}>
            {MONTHS[month]} {year}
          </span>
          <button onClick={nextMonth} style={{ background: 'none', border: '1px solid #1a1a1a', color: '#555', cursor: 'pointer', padding: '4px 8px', display: 'flex' }}>
            <ChevronRight size={14} />
          </button>
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 11, color: '#333', fontFamily: 'IBM Plex Mono, monospace' }}>month P&L</span>
          <span style={{ fontSize: 14, fontWeight: 600, fontFamily: 'IBM Plex Mono, monospace', color: monthPnL >= 0 ? '#10b981' : '#f43f5e' }}>
            {monthPnL >= 0 ? '+' : ''}{Math.round(monthPnL).toLocaleString()}
          </span>
          {selected && (
            <button onClick={() => setSelected(null)} style={{ background: 'none', border: '1px solid #1a1a1a', color: '#444', cursor: 'pointer', padding: '4px 10px', fontSize: 11, fontFamily: 'inherit' }}>
              Clear
            </button>
          )}
        </div>

        {/* Day headers */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1, marginBottom: 1, paddingRight: 24 }}>
          {DAYS.map(d => (
            <div key={d} style={{ padding: '6px 8px', fontSize: 10, fontWeight: 700, color: '#2a2a2a', letterSpacing: '0.08em', textAlign: 'center' }}>
              {d}
            </div>
          ))}
        </div>

        {/* Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1, flex: 1, overflow: 'auto', paddingRight: 24 }}>
          {cells.map((date, i) => (
            <DayCell
              key={i}
              date={date}
              events={date ? (byDate[date] ?? []) : []}
              isToday={date === todayStr}
              isSelected={date === selected}
              onClick={() => date && (byDate[date]?.length ?? 0) > 0 && setSelected(date === selected ? null : date)}
            />
          ))}
        </div>
      </div>

      {/* ── Expiry sidebar ────────────────────────────────────────────────── */}
      <div style={{ width: 300, borderLeft: '1px solid #111', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <ExpiryList events={events} selectedDate={selected} />
      </div>
    </div>
  )
}
