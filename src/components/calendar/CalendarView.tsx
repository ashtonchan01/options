import { useState, useMemo } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { AppState, Strategy, StrategyType, RawTrade } from '../../types'
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
  other:         '#3B4263',
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
  date: string
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

interface DailyTradeData {
  date: string
  netCash: number
  tradeCount: number
  optionPnL: number
  stockPnL: number
  trades: RawTrade[]
}

interface DayData {
  events: ExpiryEvent[]
  trades: DailyTradeData | null
  totalPnL: number
  hasActivity: boolean
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt$(n: number, d = 0) {
  return (n < 0 ? '-$' : '+$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
}

function normalizeDate(s: string): string {
  const m = s.match(/^(\d{4})(\d{2})(\d{2})$/)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : s
}

function todayYMD(): string {
  return new Date().toISOString().slice(0, 10)
}

// ─── Derive events from strategies ───────────────────────────────────────────

function deriveEvents(strategies: Strategy[]): ExpiryEvent[] {
  return strategies.flatMap(s =>
    s.legs
      .filter(l => l.expiry)
      .map(l => ({
        date:         normalizeDate(l.expiry),
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

// ─── Build daily trade P&L ───────────────────────────────────────────────────

function buildDailyTrades(trades: RawTrade[]): Record<string, DailyTradeData> {
  const map: Record<string, DailyTradeData> = {}
  for (const t of trades) {
    if (!t.tradeDate) continue
    const date = normalizeDate(t.tradeDate)
    if (!map[date]) map[date] = { date, netCash: 0, tradeCount: 0, optionPnL: 0, stockPnL: 0, trades: [] }
    map[date].netCash += t.netCash
    if (t.assetClass === 'OPT') map[date].optionPnL += t.netCash
    else map[date].stockPnL += t.netCash
    map[date].tradeCount++
    map[date].trades.push(t)
  }
  return map
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

// ─── Day cell ────────────────────────────────────────────────────────────────

function DayCell({
  date, data, isToday, isSelected, onClick,
}: {
  date: string | null
  data: DayData
  isToday: boolean
  isSelected: boolean
  onClick: () => void
}) {
  if (!date) return <div style={{ background: '#0F1220', borderRadius: 4 }} />

  const dayNum = parseInt(date.split('-')[2])
  const { events, trades, hasActivity } = data
  const hasPnL = trades && trades.netCash !== 0

  return (
    <div
      onClick={onClick}
      style={{
        background: isSelected ? '#1A1F35' : hasActivity ? '#131726' : '#0F1220',
        border: `1px solid ${isSelected ? '#312e81' : isToday ? '#3b82f6' : '#1A1F35'}`,
        borderRadius: 4,
        padding: '4px 6px',
        cursor: hasActivity ? 'pointer' : 'default',
        overflow: 'hidden',
        transition: 'background 0.1s',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Day number + daily P&L */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
        <span style={{
          fontSize: 13, fontWeight: isToday ? 700 : 400,
          color: isToday ? '#3b82f6' : hasActivity ? '#EAEDF3' : '#5D6580',
          fontFamily: 'IBM Plex Mono, monospace',
          background: isToday ? '#3b82f614' : 'transparent',
          borderRadius: 2, padding: isToday ? '0 3px' : 0,
        }}>
          {dayNum}
        </span>
        {hasPnL && (
          <span style={{
            fontSize: 11, fontFamily: 'IBM Plex Mono, monospace', fontWeight: 600,
            color: trades.netCash >= 0 ? '#10b981' : '#f43f5e',
          }}>
            {trades.netCash >= 0 ? '+' : ''}{Math.round(trades.netCash)}
          </span>
        )}
      </div>

      {/* Trade count badge */}
      {trades && trades.tradeCount > 0 && (
        <div style={{
          fontSize: 10, fontFamily: 'IBM Plex Mono, monospace',
          color: trades.netCash >= 0 ? '#10b981' : '#f43f5e',
          background: trades.netCash >= 0 ? '#10b98110' : '#f43f5e10',
          padding: '1px 4px', borderRadius: 3, marginBottom: 2,
          textAlign: 'center',
        }}>
          {trades.tradeCount} trade{trades.tradeCount !== 1 ? 's' : ''}
        </div>
      )}

      {/* Expiry pills */}
      {events.slice(0, 2).map((ev, i) => {
        const color = STRAT_COLOR[ev.strategyType]
        return (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 3,
            padding: '1px 4px', marginBottom: 1,
            background: `${color}14`, border: `1px solid ${color}30`,
            fontSize: 11, lineHeight: 1.3, borderRadius: 3,
          }}>
            <span style={{ fontWeight: 700, color, fontFamily: 'IBM Plex Mono, monospace', flexShrink: 0 }}>
              {ev.underlying}
            </span>
            <span style={{ color: '#9198AE', flexShrink: 0 }}>{STRAT_LABEL[ev.strategyType]}</span>
          </div>
        )
      })}
      {events.length > 2 && (
        <div style={{ fontSize: 10, color: '#5D6580', fontFamily: 'IBM Plex Mono, monospace' }}>
          +{events.length - 2}
        </div>
      )}
    </div>
  )
}

// ─── Sidebar ─────────────────────────────────────────────────────────────────

function ActivitySidebar({
  events, dailyTrades, selectedDate,
}: {
  events: ExpiryEvent[]
  dailyTrades: Record<string, DailyTradeData>
  selectedDate: string | null
}) {
  // Build all activity dates
  const allDates = useMemo(() => {
    const dateSet = new Set<string>()
    for (const e of events) dateSet.add(e.date)
    for (const d of Object.keys(dailyTrades)) dateSet.add(d)
    return [...dateSet].sort().reverse() // newest first
  }, [events, dailyTrades])

  const displayDates = selectedDate ? [selectedDate] : allDates

  const title = selectedDate
    ? new Date(selectedDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    : 'All Activity'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', flex: 1 }}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid #1E2540', fontSize: 13, fontWeight: 700, color: '#9198AE', letterSpacing: '0.08em', flexShrink: 0 }}>
        {title.toUpperCase()}
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        {displayDates.length === 0 && (
          <div style={{ padding: 24, color: '#5D6580', fontSize: 14, textAlign: 'center' }}>
            No activity
          </div>
        )}

        {displayDates.map(date => {
          const dayEvents = events.filter(e => e.date === date)
          const dayTrades = dailyTrades[date]
          if (!dayEvents.length && !dayTrades) return null

          const d = new Date(date + 'T12:00:00')
          const label = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
          const dayPnL = (dayTrades?.netCash ?? 0)

          return (
            <div key={date} style={{ borderBottom: '1px solid #1A1F35' }}>
              {/* Date header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', background: '#171C30' }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#9198AE', fontFamily: 'IBM Plex Mono, monospace' }}>{label}</span>
                <div style={{ flex: 1 }} />
                {dayPnL !== 0 && (
                  <span style={{ fontSize: 12, fontFamily: 'IBM Plex Mono, monospace', fontWeight: 600, color: dayPnL >= 0 ? '#10b981' : '#f43f5e' }}>
                    {fmt$(dayPnL)}
                  </span>
                )}
              </div>

              {/* Trades */}
              {dayTrades && dayTrades.trades.map((t, i) => (
                <div key={`t-${i}`} style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '5px 14px', borderTop: '1px solid #1A1F35',
                  fontSize: 13,
                }}>
                  <div style={{ width: 3, height: 24, background: t.netCash >= 0 ? '#10b981' : '#f43f5e', flexShrink: 0, borderRadius: 1 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ fontWeight: 700, color: '#EAEDF3', fontFamily: 'IBM Plex Mono, monospace', fontSize: 13 }}>
                        {t.underlyingSymbol ?? t.symbol}
                      </span>
                      <span style={{ fontSize: 10, padding: '1px 4px', border: '1px solid #1E2540', color: '#5D6580', borderRadius: 3 }}>
                        {t.assetClass === 'OPT' ? `${t.putCall} ${t.strike}` : t.assetClass}
                      </span>
                      <span style={{ fontSize: 11, color: t.quantity > 0 ? '#10b981' : '#f43f5e', fontFamily: 'IBM Plex Mono, monospace' }}>
                        {t.quantity > 0 ? '+' : ''}{t.quantity}
                      </span>
                    </div>
                  </div>
                  <span style={{ fontSize: 12, fontFamily: 'IBM Plex Mono, monospace', fontWeight: 600, color: t.netCash >= 0 ? '#10b981' : '#f43f5e', flexShrink: 0 }}>
                    {fmt$(t.netCash)}
                  </span>
                </div>
              ))}

              {/* Expiration events */}
              {dayEvents.map((ev, i) => {
                const color = STRAT_COLOR[ev.strategyType]
                return (
                  <div key={`e-${i}`} style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '5px 14px', borderTop: '1px solid #1A1F35',
                    fontSize: 13,
                  }}>
                    <div style={{ width: 3, height: 24, background: color, flexShrink: 0, borderRadius: 1 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ fontWeight: 700, color: '#EAEDF3', fontFamily: 'IBM Plex Mono, monospace', fontSize: 13 }}>
                          {ev.underlying}
                        </span>
                        <span style={{ padding: '1px 4px', fontSize: 10, fontWeight: 700, color, background: `${color}14`, border: `1px solid ${color}30`, borderRadius: 3 }}>
                          {STRAT_LABEL[ev.strategyType]}
                        </span>
                        <span style={{ fontSize: 10, color: '#5D6580' }}>EXP</span>
                      </div>
                    </div>
                    <span style={{ fontSize: 12, fontFamily: 'IBM Plex Mono, monospace', color: ev.unrealizedPnL >= 0 ? '#10b981' : '#f43f5e', flexShrink: 0 }}>
                      {fmt$(ev.unrealizedPnL)}
                    </span>
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
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
  const dailyTrades = useMemo(() => buildDailyTrades(state.sync.trades), [state.sync.trades])

  const eventsByDate = useMemo(() => {
    const map: Record<string, ExpiryEvent[]> = {}
    for (const e of events) map[e.date] = [...(map[e.date] ?? []), e]
    return map
  }, [events])

  const cells = useMemo(() => calendarDays(year, month), [year, month])
  const todayStr = todayYMD()
  const numRows = Math.ceil(cells.length / 7)

  function prevMonth() {
    if (month === 0) { setYear(y => y - 1); setMonth(11) }
    else setMonth(m => m - 1)
  }
  function nextMonth() {
    if (month === 11) { setYear(y => y + 1); setMonth(0) }
    else setMonth(m => m + 1)
  }

  // Month P&L from trades
  const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}`
  const monthTradePnL = Object.entries(dailyTrades)
    .filter(([d]) => d.startsWith(monthPrefix))
    .reduce((s, [, dt]) => s + dt.netCash, 0)
  const monthTradeCount = Object.entries(dailyTrades)
    .filter(([d]) => d.startsWith(monthPrefix))
    .reduce((s, [, dt]) => s + dt.tradeCount, 0)

  const hasAnyData = state.strategies.length > 0 || state.sync.trades.length > 0

  if (!hasAnyData) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <EmptyState title="No data" message="Sync your IBKR portfolio to see trades and expirations on the calendar." showUpload />
      </div>
    )
  }

  // Build day data for each cell
  function getDayData(date: string | null): DayData {
    if (!date) return { events: [], trades: null, totalPnL: 0, hasActivity: false }
    const evs = eventsByDate[date] ?? []
    const tr = dailyTrades[date] ?? null
    const totalPnL = (tr?.netCash ?? 0) + evs.reduce((s, e) => s + e.unrealizedPnL, 0)
    return { events: evs, trades: tr, totalPnL, hasActivity: evs.length > 0 || (tr !== null && tr.tradeCount > 0) }
  }

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>

      {/* ── Calendar ──────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: 20 }}>

        {/* Month nav */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexShrink: 0 }}>
          <button onClick={prevMonth} style={{ background: 'none', border: '1px solid #1E2540', color: '#5D6580', cursor: 'pointer', padding: '4px 8px', display: 'flex', borderRadius: 4 }}>
            <ChevronLeft size={14} />
          </button>
          <span style={{ fontSize: 15, fontWeight: 600, color: '#EAEDF3', minWidth: 150, textAlign: 'center' }}>
            {MONTHS[month]} {year}
          </span>
          <button onClick={nextMonth} style={{ background: 'none', border: '1px solid #1E2540', color: '#5D6580', cursor: 'pointer', padding: '4px 8px', display: 'flex', borderRadius: 4 }}>
            <ChevronRight size={14} />
          </button>
          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: '#5D6580' }}>{monthTradeCount} trades</span>
            <span style={{ fontSize: 15, fontWeight: 600, fontFamily: 'IBM Plex Mono, monospace', color: monthTradePnL >= 0 ? '#10b981' : '#f43f5e' }}>
              {monthTradePnL >= 0 ? '+' : ''}{Math.round(monthTradePnL).toLocaleString()}
            </span>
          </div>
          {selected && (
            <button onClick={() => setSelected(null)} style={{ background: 'none', border: '1px solid #1E2540', color: '#5D6580', cursor: 'pointer', padding: '3px 8px', fontSize: 12, fontFamily: 'inherit', borderRadius: 4 }}>
              Clear
            </button>
          )}
        </div>

        {/* Day headers */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 3, marginBottom: 3, flexShrink: 0 }}>
          {DAYS.map(d => (
            <div key={d} style={{ padding: '4px', fontSize: 11, fontWeight: 700, color: '#5D6580', letterSpacing: '0.08em', textAlign: 'center' }}>
              {d}
            </div>
          ))}
        </div>

        {/* Grid — fixed row height so cells stay compact */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, 1fr)',
          gridTemplateRows: `repeat(${numRows}, minmax(0, 1fr))`,
          gap: 3,
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
        }}>
          {cells.map((date, i) => {
            const data = getDayData(date)
            return (
              <DayCell
                key={i}
                date={date}
                data={data}
                isToday={date === todayStr}
                isSelected={date === selected}
                onClick={() => date && data.hasActivity && setSelected(date === selected ? null : date)}
              />
            )
          })}
        </div>
      </div>

      {/* ── Activity sidebar ──────────────────────────────────────────────── */}
      <div style={{ width: 320, borderLeft: '1px solid #1E2540', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <ActivitySidebar events={events} dailyTrades={dailyTrades} selectedDate={selected} />
      </div>
    </div>
  )
}
