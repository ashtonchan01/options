import { useState, useMemo, useEffect } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { AppState, Strategy, StrategyType, RawTrade } from '../../types'
import { HOLIDAY_MAP } from '../../data/marketHolidays'
import { WATCHLIST } from '../../data/watchlist'
import { fetchEarningsDates, earningsByDate } from '../../services/earnings'

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
  other:         '#64748b',
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

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
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
  earnings: string[]     // ticker symbols reporting earnings
  holiday: string | null // CBOE holiday name or null
}

interface CalendarWeek {
  dates: (string | null)[] // exactly 5 elements (Mon–Fri)
  weekNum: number
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

function isoWeek(d: Date): number {
  const dt = new Date(d.getTime())
  dt.setHours(0, 0, 0, 0)
  dt.setDate(dt.getDate() + 4 - (dt.getDay() || 7))
  const y1 = new Date(dt.getFullYear(), 0, 1)
  return Math.ceil((((dt.getTime() - y1.getTime()) / 86400000) + 1) / 7)
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

// ─── Calendar weeks (Mon–Fri only) ──────────────────────────────────────────

function calendarWeeks(year: number, month: number): CalendarWeek[] {
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const weeks: CalendarWeek[] = []
  let curWeek: (string | null)[] = []

  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month, d)
    const dow = date.getDay() // 0=Sun … 6=Sat
    if (dow === 0 || dow === 6) continue // skip weekends

    const wdIdx = dow - 1 // 0=Mon … 4=Fri

    // Monday → flush previous week if any
    if (wdIdx === 0 && curWeek.length > 0) {
      while (curWeek.length < 5) curWeek.push(null)
      weeks.push({ dates: curWeek, weekNum: 0 })
      curWeek = []
    }

    // Pad start of first partial week
    if (curWeek.length === 0 && wdIdx > 0) {
      for (let i = 0; i < wdIdx; i++) curWeek.push(null)
    }

    curWeek.push(`${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`)
  }

  // Flush last week
  if (curWeek.length > 0) {
    while (curWeek.length < 5) curWeek.push(null)
    weeks.push({ dates: curWeek, weekNum: 0 })
  }

  // Fill week numbers
  for (const w of weeks) {
    const first = w.dates.find(d => d !== null)
    if (first) w.weekNum = isoWeek(new Date(first + 'T12:00:00'))
  }

  return weeks
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
  if (!date) return <div style={{ background: 'var(--bg-surface)', borderRadius: 4 }} />

  const dayNum = parseInt(date.split('-')[2])
  const { events, trades, hasActivity, earnings, holiday } = data
  const hasPnL = trades && trades.netCash !== 0
  const isHoliday = !!holiday

  return (
    <div
      onClick={onClick}
      style={{
        background: isHoliday ? '#f43f5e08' : isSelected ? 'var(--bg-active)' : hasActivity ? 'var(--bg-card)' : 'var(--bg-surface)',
        border: `1px solid ${isSelected ? '#312e81' : isToday ? '#3b82f6' : isHoliday ? '#f43f5e30' : 'var(--bg-active)'}`,
        borderRadius: 4,
        padding: '4px 6px',
        cursor: hasActivity ? 'pointer' : 'default',
        overflow: 'hidden',
        transition: 'background 0.1s',
        display: 'flex',
        flexDirection: 'column',
        opacity: isHoliday ? 0.7 : 1,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
        <span style={{
          fontSize: 13, fontWeight: isToday ? 700 : 400,
          color: isToday ? '#3b82f6' : isHoliday ? '#f43f5e' : hasActivity ? 'var(--text-1)' : 'var(--text-3)',
          fontFamily: 'Inter, sans-serif',
          background: isToday ? '#3b82f614' : 'transparent',
          borderRadius: 2, padding: isToday ? '0 3px' : 0,
        }}>
          {dayNum}
        </span>
        {hasPnL && (
          <span style={{
            fontSize: 11, fontFamily: 'Inter, sans-serif', fontWeight: 600,
            color: trades.netCash >= 0 ? '#10b981' : '#f43f5e',
          }}>
            {trades.netCash >= 0 ? '+' : ''}{Math.round(trades.netCash)}
          </span>
        )}
      </div>

      {/* Fills remaining cell height; content lists run down until they hit the bottom, soft-fading instead of an abrupt cut or "+N" counter */}
      <div style={{
        flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column',
        WebkitMaskImage: 'linear-gradient(to bottom, black calc(100% - 10px), transparent 100%)',
        maskImage: 'linear-gradient(to bottom, black calc(100% - 10px), transparent 100%)',
      }}>
        {/* CBOE holiday */}
        {isHoliday && (
          <div style={{
            fontSize: 9, fontWeight: 700, letterSpacing: '0.05em',
            color: '#f43f5e', background: '#f43f5e14',
            padding: '1px 4px', borderRadius: 3, marginBottom: 2,
            textAlign: 'center', border: '1px solid #f43f5e30', flexShrink: 0,
          }}>
            CLOSED
          </div>
        )}

        {/* Earnings badges */}
        {earnings.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2, marginBottom: 2, flexShrink: 0 }}>
            {earnings.map(t => (
              <span key={t} style={{
                fontSize: 9, fontWeight: 700, letterSpacing: '0.03em',
                color: '#F0B429', background: '#F0B42914',
                padding: '1px 4px', borderRadius: 3,
                border: '1px solid #F0B42930',
                fontFamily: 'Inter, sans-serif',
              }}>
                ER {t}
              </span>
            ))}
          </div>
        )}

        {trades && trades.tradeCount > 0 && (
          <div style={{
            fontSize: 10, fontFamily: 'Inter, sans-serif',
            color: trades.netCash >= 0 ? '#10b981' : '#f43f5e',
            background: trades.netCash >= 0 ? '#10b98110' : '#f43f5e10',
            padding: '1px 4px', borderRadius: 3, marginBottom: 2,
            textAlign: 'center', flexShrink: 0,
          }}>
            {trades.tradeCount} trade{trades.tradeCount !== 1 ? 's' : ''}
          </div>
        )}

        {events.map((ev, i) => {
          const color = STRAT_COLOR[ev.strategyType]
          return (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 3,
              padding: '1px 4px', marginBottom: 1, flexShrink: 0,
              background: `${color}14`, border: `1px solid ${color}30`,
              fontSize: 11, lineHeight: 1.3, borderRadius: 3,
            }}>
              <span style={{ fontWeight: 700, color, fontFamily: 'Inter, sans-serif', flexShrink: 0 }}>
                {ev.underlying}
              </span>
              <span style={{ color: 'var(--text-2)', flexShrink: 0 }}>{STRAT_LABEL[ev.strategyType]}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Weekly P&L cell ─────────────────────────────────────────────────────────

function WeekPnLCell({
  weekNum, dates, dailyTrades,
}: {
  weekNum: number
  dates: (string | null)[]
  dailyTrades: Record<string, DailyTradeData>
}) {
  const weekPnL = dates
    .filter((d): d is string => d !== null)
    .reduce((s, d) => s + (dailyTrades[d]?.netCash ?? 0), 0)
  const tradeCount = dates
    .filter((d): d is string => d !== null)
    .reduce((s, d) => s + (dailyTrades[d]?.tradeCount ?? 0), 0)

  return (
    <div style={{
      background: weekPnL !== 0 ? (weekPnL > 0 ? '#10b98108' : '#f43f5e08') : 'var(--bg-surface)',
      border: `1px solid ${weekPnL > 0 ? '#10b98120' : weekPnL < 0 ? '#f43f5e20' : 'var(--bg-active)'}`,
      borderRadius: 4,
      padding: '4px 8px',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
      gap: 2,
    }}>
      <span style={{ fontSize: 10, color: 'var(--text-4)', fontWeight: 600, letterSpacing: '0.05em' }}>
        WK {weekNum}
      </span>
      {weekPnL !== 0 ? (
        <span style={{
          fontSize: 14, fontWeight: 700,
          fontFamily: 'Inter, sans-serif',
          color: weekPnL >= 0 ? '#10b981' : '#f43f5e',
        }}>
          {weekPnL >= 0 ? '+' : ''}{Math.round(weekPnL).toLocaleString()}
        </span>
      ) : (
        <span style={{ fontSize: 11, color: 'var(--text-4)' }}>—</span>
      )}
      {tradeCount > 0 && (
        <span style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: 'Inter, sans-serif' }}>
          {tradeCount} trade{tradeCount !== 1 ? 's' : ''}
        </span>
      )}
    </div>
  )
}

// ─── Sidebar ─────────────────────────────────────────────────────────────────

function ActivitySidebar({
  events, dailyTrades, earningsByDateMap, selectedDate, year, month,
}: {
  events: ExpiryEvent[]
  dailyTrades: Record<string, DailyTradeData>
  earningsByDateMap: Record<string, string[]>
  selectedDate: string | null
  year: number
  month: number // 0-indexed
}) {
  const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}`

  // Collect all dates that have any activity (trades, earnings, holidays)
  const monthDates = useMemo(() => {
    const dateSet = new Set<string>()
    // Trade dates
    for (const d of Object.keys(dailyTrades)) {
      if (d.startsWith(monthPrefix)) dateSet.add(d)
    }
    // Earnings dates
    for (const d of Object.keys(earningsByDateMap)) {
      if (d.startsWith(monthPrefix)) dateSet.add(d)
    }
    // Holiday dates
    for (const d of Object.keys(HOLIDAY_MAP)) {
      if (d.startsWith(monthPrefix)) dateSet.add(d)
    }
    return [...dateSet].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))
  }, [dailyTrades, earningsByDateMap, monthPrefix])

  const displayDates = selectedDate ? [selectedDate] : monthDates

  const title = selectedDate
    ? new Date(selectedDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    : 'All Activity'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', flex: 1 }}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', fontSize: 13, fontWeight: 700, color: 'var(--text-2)', letterSpacing: '0.08em', flexShrink: 0 }}>
        {title.toUpperCase()}
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        {displayDates.length === 0 && (
          <div style={{ padding: 24, color: 'var(--text-3)', fontSize: 14, textAlign: 'center' }}>
            No activity
          </div>
        )}

        {displayDates.map(date => {
          const dayEvents = events.filter(e => e.date === date)
          const dayTrades = dailyTrades[date]
          const dayEarnings = earningsByDateMap[date] ?? []
          const dayHoliday = HOLIDAY_MAP[date] ?? null
          if (!dayEvents.length && !dayTrades && !dayEarnings.length && !dayHoliday) return null

          const d = new Date(date + 'T12:00:00')
          const label = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
          const dayPnL = (dayTrades?.netCash ?? 0)

          return (
            <div key={date} style={{ borderBottom: '1px solid var(--border-light)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', background: 'var(--bg-elevated)' }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-2)', fontFamily: 'Inter, sans-serif' }}>{label}</span>
                <div style={{ flex: 1 }} />
                {dayHoliday && (
                  <span style={{ fontSize: 10, fontWeight: 700, color: '#f43f5e', background: '#f43f5e14', padding: '1px 6px', borderRadius: 3, border: '1px solid #f43f5e30' }}>
                    CLOSED
                  </span>
                )}
                {dayPnL !== 0 && (
                  <span style={{ fontSize: 12, fontFamily: 'Inter, sans-serif', fontWeight: 600, color: dayPnL >= 0 ? '#10b981' : '#f43f5e' }}>
                    {fmt$(dayPnL)}
                  </span>
                )}
              </div>

              {/* Holiday detail */}
              {dayHoliday && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 14px', borderTop: '1px solid var(--border-light)', fontSize: 13 }}>
                  <div style={{ width: 3, height: 24, background: '#f43f5e', flexShrink: 0, borderRadius: 1 }} />
                  <span style={{ color: '#f43f5e', fontWeight: 600, fontSize: 12 }}>{dayHoliday}</span>
                </div>
              )}

              {/* Earnings detail */}
              {dayEarnings.map(ticker => (
                <div key={`er-${ticker}`} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 14px', borderTop: '1px solid var(--border-light)', fontSize: 13 }}>
                  <div style={{ width: 3, height: 24, background: '#F0B429', flexShrink: 0, borderRadius: 1 }} />
                  <span style={{ fontWeight: 700, color: 'var(--text-1)', fontFamily: 'Inter, sans-serif', fontSize: 13 }}>{ticker}</span>
                  <span style={{ fontSize: 10, fontWeight: 700, color: '#F0B429', background: '#F0B42914', padding: '1px 6px', borderRadius: 3, border: '1px solid #F0B42930' }}>EARNINGS</span>
                </div>
              ))}

              {dayTrades && [...dayTrades.trades].sort((a, b) => Math.abs(b.netCash) - Math.abs(a.netCash)).map((t, i) => (
                <div key={`t-${i}`} style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '5px 14px', borderTop: '1px solid var(--border-light)',
                  fontSize: 13,
                }}>
                  <div style={{ width: 3, height: 24, background: t.netCash >= 0 ? '#10b981' : '#f43f5e', flexShrink: 0, borderRadius: 1 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ fontWeight: 700, color: 'var(--text-1)', fontFamily: 'Inter, sans-serif', fontSize: 13 }}>
                        {t.underlyingSymbol ?? t.symbol}
                      </span>
                      <span style={{ fontSize: 10, padding: '1px 4px', border: '1px solid var(--border)', color: 'var(--text-3)', borderRadius: 3 }}>
                        {t.assetClass === 'OPT' ? `${t.putCall} ${t.strike}` : t.assetClass}
                      </span>
                      <span style={{ fontSize: 11, color: t.quantity > 0 ? '#10b981' : '#f43f5e', fontFamily: 'Inter, sans-serif' }}>
                        {t.quantity > 0 ? '+' : ''}{t.quantity}
                      </span>
                    </div>
                  </div>
                  <span style={{ fontSize: 12, fontFamily: 'Inter, sans-serif', fontWeight: 600, color: t.netCash >= 0 ? '#10b981' : '#f43f5e', flexShrink: 0 }}>
                    {fmt$(t.netCash)}
                  </span>
                </div>
              ))}

              {dayEvents.map((ev, i) => {
                const color = STRAT_COLOR[ev.strategyType]
                return (
                  <div key={`e-${i}`} style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '5px 14px', borderTop: '1px solid var(--border-light)',
                    fontSize: 13,
                  }}>
                    <div style={{ width: 3, height: 24, background: color, flexShrink: 0, borderRadius: 1 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ fontWeight: 700, color: 'var(--text-1)', fontFamily: 'Inter, sans-serif', fontSize: 13 }}>
                          {ev.underlying}
                        </span>
                        <span style={{ padding: '1px 4px', fontSize: 10, fontWeight: 700, color, background: `${color}14`, border: `1px solid ${color}30`, borderRadius: 3 }}>
                          {STRAT_LABEL[ev.strategyType]}
                        </span>
                        <span style={{ fontSize: 10, color: 'var(--text-3)' }}>EXP</span>
                      </div>
                    </div>
                    <span style={{ fontSize: 12, fontFamily: 'Inter, sans-serif', color: ev.unrealizedPnL >= 0 ? '#10b981' : '#f43f5e', flexShrink: 0 }}>
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

  // Earnings dates (fetched once, cached 6h)
  const [earningsMap, setEarningsMap] = useState<Record<string, string[]>>({})
  useEffect(() => {
    fetchEarningsDates([...WATCHLIST]).then(setEarningsMap).catch(() => {})
  }, [])
  const earningsByDateMap = useMemo(() => earningsByDate(earningsMap), [earningsMap])

  const events = useMemo(() => deriveEvents(state.strategies), [state.strategies])
  const dailyTrades = useMemo(() => buildDailyTrades(state.sync.trades), [state.sync.trades])

  const eventsByDate = useMemo(() => {
    const map: Record<string, ExpiryEvent[]> = {}
    for (const e of events) map[e.date] = [...(map[e.date] ?? []), e]
    return map
  }, [events])

  const weeks = useMemo(() => calendarWeeks(year, month), [year, month])
  const todayStr = todayYMD()

  function prevMonth() {
    if (month === 0) { setYear(y => y - 1); setMonth(11) }
    else setMonth(m => m - 1)
  }
  function nextMonth() {
    if (month === 11) { setYear(y => y + 1); setMonth(0) }
    else setMonth(m => m + 1)
  }

  const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}`
  const monthTradePnL = Object.entries(dailyTrades)
    .filter(([d]) => d.startsWith(monthPrefix))
    .reduce((s, [, dt]) => s + dt.netCash, 0)
  const monthTradeCount = Object.entries(dailyTrades)
    .filter(([d]) => d.startsWith(monthPrefix))
    .reduce((s, [, dt]) => s + dt.tradeCount, 0)

  // Calendar always renders (holidays + earnings are always available)

  function getDayData(date: string | null): DayData {
    if (!date) return { events: [], trades: null, totalPnL: 0, hasActivity: false, earnings: [], holiday: null }
    const evs = eventsByDate[date] ?? []
    const tr = dailyTrades[date] ?? null
    const totalPnL = (tr?.netCash ?? 0) + evs.reduce((s, e) => s + e.unrealizedPnL, 0)
    const earnings = earningsByDateMap[date] ?? []
    const holiday = HOLIDAY_MAP[date] ?? null
    const hasActivity = evs.length > 0 || (tr !== null && tr.tradeCount > 0) || earnings.length > 0 || holiday !== null
    return { events: evs, trades: tr, totalPnL, hasActivity, earnings, holiday }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

      {/* ── Top: Calendar + Sidebar ──────────────────────────────────────── */}
      <div className="calendar-layout" style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>

        {/* Calendar grid */}
        <div className="calendar-main" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'auto', padding: '16px 20px' }}>

          {/* Month nav */}
          <div className="calendar-nav" style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexShrink: 0 }}>
            <button onClick={prevMonth} style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-3)', cursor: 'pointer', padding: '4px 8px', display: 'flex', borderRadius: 4 }}>
              <ChevronLeft size={14} />
            </button>
            <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-1)', minWidth: 150, textAlign: 'center' }}>
              {MONTHS[month]} {year}
            </span>
            <button onClick={nextMonth} style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-3)', cursor: 'pointer', padding: '4px 8px', display: 'flex', borderRadius: 4 }}>
              <ChevronRight size={14} />
            </button>
            <div style={{ flex: 1 }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{monthTradeCount} trades</span>
              <span style={{ fontSize: 15, fontWeight: 600, fontFamily: 'Inter, sans-serif', color: monthTradePnL >= 0 ? '#10b981' : '#f43f5e' }}>
                {monthTradePnL >= 0 ? '+' : ''}{Math.round(monthTradePnL).toLocaleString()}
              </span>
            </div>
            {selected && (
              <button onClick={() => setSelected(null)} style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-3)', cursor: 'pointer', padding: '3px 8px', fontSize: 12, fontFamily: 'inherit', borderRadius: 4 }}>
                Clear
              </button>
            )}
          </div>

          {/* Fixed-ratio landscape calendar block — headers + grid together */}
          <div className="calendar-ratio-box" style={{ width: '100%', aspectRatio: '16 / 9', maxHeight: '100%', display: 'flex', flexDirection: 'column', margin: '0 auto' }}>

            {/* Day headers: Mon–Fri + WK P&L */}
            <div className="calendar-header-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr) 100px', gap: 3, marginBottom: 3, flexShrink: 0 }}>
              {WEEKDAYS.map(d => (
                <div key={d} style={{ padding: '4px', fontSize: 11, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.08em', textAlign: 'center' }}>
                  {d}
                </div>
              ))}
              <div style={{ padding: '4px', fontSize: 11, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.08em', textAlign: 'center' }}>
                WK P&L
              </div>
            </div>

            {/* Grid: 5 weekday cols + 1 P&L col */}
            <div className="calendar-grid-wrap" style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(5, 1fr) 100px',
              gridTemplateRows: `repeat(${weeks.length}, minmax(0, 1fr))`,
              gap: 3,
              flex: 1,
              minHeight: 0,
              overflow: 'hidden',
            }}>
              {weeks.map((week, wi) => (
                <WeekRow
                  key={wi}
                  week={week}
                  getDayData={getDayData}
                  todayStr={todayStr}
                  selected={selected}
                  onSelect={(date) => setSelected(date === selected ? null : date)}
                  dailyTrades={dailyTrades}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Activity sidebar */}
        <div className="calendar-sidebar" style={{ width: 300, borderLeft: '1px solid var(--border)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <ActivitySidebar events={events} dailyTrades={dailyTrades} earningsByDateMap={earningsByDateMap} selectedDate={selected} year={year} month={month} />
        </div>
      </div>

    </div>
  )
}

// ─── Week row (renders 5 day cells + 1 P&L cell as grid children) ───────────

function WeekRow({
  week, getDayData, todayStr, selected, onSelect, dailyTrades,
}: {
  week: CalendarWeek
  getDayData: (date: string | null) => DayData
  todayStr: string
  selected: string | null
  onSelect: (date: string) => void
  dailyTrades: Record<string, DailyTradeData>
}) {
  return (
    <>
      {week.dates.map((date, di) => {
        const data = getDayData(date)
        return (
          <DayCell
            key={di}
            date={date}
            data={data}
            isToday={date === todayStr}
            isSelected={date === selected}
            onClick={() => date && data.hasActivity && onSelect(date)}
          />
        )
      })}
      <WeekPnLCell weekNum={week.weekNum} dates={week.dates} dailyTrades={dailyTrades} />
    </>
  )
}
