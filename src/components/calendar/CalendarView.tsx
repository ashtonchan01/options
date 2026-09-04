import { useState, useMemo, useEffect, useRef, useLayoutEffect } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { AppState, Strategy, StrategyType, RawTrade } from '../../types'
import type { TradeLabels } from '../../App'
import { HOLIDAY_MAP } from '../../data/marketHolidays'
import { fetchEarningsDates, earningsByDate } from '../../services/earnings'
import { fetchFomcDates } from '../../services/fomc'
import { buildEconEventMap, type EconEvent } from '../../data/economicEvents'
import { buildJournalPositions, buildStockPositions } from '../../engine/journal'
import { tradeId } from '../../store/tradeLabelsStore'
import { STRAT_ORDER, stratLabel } from '../companies/reportsShared'

// Calendar's filter chips are a fixed 76px wide — "Synthetic Long" and
// "Shares" (the full labels used elsewhere, e.g. Journal/Reports) don't fit
// that without ellipsis-truncating unhelpfully, so this chip row gets its
// own shorter overrides while the hover title still shows the full name.
const CALENDAR_CHIP_LABEL: Record<string, string> = { leap: 'SYN', shares: 'SH' }
function calendarChipLabel(s: string): string { return CALENDAR_CHIP_LABEL[s] ?? stratLabel(s) }

interface Props { state: AppState; watchlistTickers?: string[]; tradeLabels?: TradeLabels }

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
  leap:          'SYN L',
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
  econEvents: EconEvent[] // macro events (FOMC, etc.)
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
        // The strategy-level unrealizedPnL (s.unrealizedPnL) folds in the
        // underlying shares' own unrealized gain for a covered call/PMCC —
        // fine for "how is this whole position doing" elsewhere, but wildly
        // misleading on an expiry badge for one specific option leg (a
        // long-held stock's price appreciation has nothing to do with the
        // premium collected on this call). This leg's own unrealizedPnL is
        // scoped to just the option contract expiring on this date.
        unrealizedPnL: l.unrealizedPnL,
        netPremium:   s.netPremiumReceived,
      }))
  )
}

// ─── Multi-year overview ─────────────────────────────────────────────────────

/** Every leg-expiry event still ahead of today, one row per underlying/date/
 * strategy combo — a LEAP's two legs (call+put) share both a date and an
 * underlying, so they'd otherwise print as two separate entries in the same
 * cell for what's really one combo.
 *
 * `quantity` is the contract count of the combo, NOT the sum of every leg's
 * own quantity — a risk-reversal/synthetic-long's call leg and put leg are
 * each already the full contract count (5 contracts = 5 calls + 5 puts, not
 * 10 of anything), so summing them double-counted every combo (verified: a
 * real 5-contract TSLA synthetic long showed "10x" on this calendar).
 * Taking the max across legs instead gives the actual contract count
 * regardless of how many legs the strategy has. */
function groupFutureEvents(events: ExpiryEvent[], todayStr: string) {
  const future = events.filter(e => e.date >= todayStr)
  const byKey = new Map<string, { date: string; underlying: string; strategyType: StrategyType; quantity: number; legs: ExpiryEvent[] }>()
  for (const e of future) {
    const key = `${e.date}|${e.underlying}|${e.strategyType}`
    const g = byKey.get(key)
    if (g) { g.quantity = Math.max(g.quantity, Math.abs(e.quantity)); g.legs.push(e) }
    else byKey.set(key, { date: e.date, underlying: e.underlying, strategyType: e.strategyType, quantity: Math.abs(e.quantity), legs: [e] })
  }
  return [...byKey.values()].sort((a, b) => a.date.localeCompare(b.date))
}

const CAL_MONTH_LABEL = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

// One distinct color per year column, cycled if there are more years than
// colors — lets the eye separate columns at a glance instead of reading the
// header text every time, especially once several years are open side by
// side and equally sized.
const YEAR_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#a78bfa', '#f43f5e', '#22d3ee', '#84cc16', '#fb923c']

interface CalWeekRow {
  weekNum: number
  startDate: string // YYYY-MM-DD, the week's Monday
  endDate: string   // YYYY-MM-DD, the week's Sunday
  total: number
  notes: string[]
}

/** Every Monday-start week of one calendar year (Jan–Dec), each carrying its
 * trade cash-flow total and a Notes list of key dates landing in it — LEAP/
 * risk-reversal combos are called out by name (mirroring a manual weekly P&L
 * ledger's own "4x TSLA Syn Long" / "TSLA Expiry" annotations), same as
 * every other strategy's expiry, so a long-dated LEAP doesn't just look like
 * an unexplained lump in the Total column a year from now. */
function buildCalYearWeeks(year: number, dailyTrades: Record<string, DailyTradeData>, groupedEvents: ReturnType<typeof groupFutureEvents>): { month: string; weeks: CalWeekRow[] }[] {
  const yearStart = new Date(year, 0, 1)
  const yearEnd = new Date(year + 1, 0, 1)
  let monday = new Date(yearStart)
  const dow = monday.getDay() || 7
  monday.setDate(monday.getDate() - (dow - 1))

  const byMonth = new Map<number, CalWeekRow[]>()
  while (monday < yearEnd) {
    const sunday = new Date(monday); sunday.setDate(sunday.getDate() + 6)
    const startDate = monday.toISOString().slice(0, 10)
    const endDate = sunday.toISOString().slice(0, 10)
    let total = 0
    const notes: string[] = []
    for (let d = new Date(monday); d <= sunday; d.setDate(d.getDate() + 1)) {
      const ds = d.toISOString().slice(0, 10)
      total += dailyTrades[ds]?.netCash ?? 0
    }
    for (const g of groupedEvents) {
      if (g.date < startDate || g.date > endDate) continue
      const isLeap = g.strategyType === 'leap' || g.strategyType === 'risk_reversal'
      notes.push(`${g.quantity > 1 ? `${g.quantity}x ` : ''}${g.underlying} ${isLeap ? 'Syn Long Expiry' : `${STRAT_LABEL[g.strategyType]} Expiry`}`)
    }
    // Bucket by the month containing the Monday of this week — matches how
    // a manual weekly ledger groups week rows under one month header even
    // when the week itself spans a month boundary.
    const bucketMonth = monday.getFullYear() === year ? monday.getMonth() : 0
    if (!byMonth.has(bucketMonth)) byMonth.set(bucketMonth, [])
    byMonth.get(bucketMonth)!.push({ weekNum: isoWeek(monday), startDate, endDate, total, notes })
    monday = new Date(monday); monday.setDate(monday.getDate() + 7)
  }

  return CAL_MONTH_LABEL.map((label, m) => ({ month: label, weeks: byMonth.get(m) ?? [] }))
}

/** Multi-year ledger — one equally-sized, distinctly-colored column per
 * calendar year, each broken into month blocks of weekly rows (labeled by
 * ISO week number) with a running Total and a Notes column, mirroring a
 * manual weekly P&L spreadsheet. Exists specifically so a LEAP/synthetic-
 * long combo's expiry — routinely a year or more out — shows up as a named
 * annotation on the week it lands in, long before the month-at-a-time
 * Calendar view would ever surface it. */
function MultiYearCalendarView({ trades, events }: { trades: RawTrade[]; events: ExpiryEvent[] }) {
  const dailyTrades = useMemo(() => buildDailyTrades(trades), [trades])

  // 2025-2029 by default (a fixed 5-year window is easier to scan than one
  // that reshuffles as trades/events come and go) — widened only if real
  // data or a LEAP/spread expiry actually falls outside it, so nothing gets
  // silently cut off.
  const years = useMemo(() => {
    const tradeYears = trades.filter(t => t.tradeDate && !t.isTransfer).map(t => Number(normalizeDate(t.tradeDate).slice(0, 4)))
    const eventYears = events.filter(e => e.date).map(e => Number(e.date.slice(0, 4)))
    const all = [...tradeYears, ...eventYears, 2025, 2029]
    const min = Math.min(...all)
    const max = Math.max(...all)
    return Array.from({ length: max - min + 1 }, (_, i) => min + i)
  }, [trades, events])

  const groupedEvents = useMemo(() => groupFutureEvents(events, '0000-00-00'), [events])
  const columns = useMemo(() => years.map(y => ({ year: y, months: buildCalYearWeeks(y, dailyTrades, groupedEvents) })), [years, dailyTrades, groupedEvents])

  // Financial-year total (1 Jul of the previous calendar year – 30 Jun of
  // this one) shown at the June boundary — the actual FY convention used
  // elsewhere in the app (Reports' fyOf) ends in June, not December, so
  // "the annual total" belongs there rather than only at the bottom of a
  // Jan-Dec calendar-year column.
  const fyTotalByYear = useMemo(() => {
    const m = new Map<number, number>()
    for (const y of years) {
      const start = `${y - 1}-07-01`, end = `${y}-06-30`
      let sum = 0
      for (const [d, dt] of Object.entries(dailyTrades)) if (d >= start && d <= end) sum += dt.netCash
      m.set(y, sum)
    }
    return m
  }, [years, dailyTrades])

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${columns.length}, minmax(240px, 1fr))`, gap: 16, alignItems: 'start' }}>
        {columns.map((col, ci) => {
          const grandTotal = col.months.reduce((s, m) => s + m.weeks.reduce((s2, w) => s2 + w.total, 0), 0)
          const color = YEAR_COLORS[ci % YEAR_COLORS.length]
          return (
            <div key={col.year} style={{ minWidth: 0, border: `1px solid ${color}55`, borderRadius: 6, overflow: 'hidden', background: `${color}0a` }}>
              <div style={{ padding: '8px 10px', fontSize: 13, fontWeight: 700, color, background: `${color}30`, textAlign: 'center', borderBottom: `1px solid ${color}55` }}>
                {col.year}
              </div>
              <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', fontSize: 11 }}>
                <colgroup>
                  <col style={{ width: 26 }} />
                  <col style={{ width: 32 }} />
                  <col style={{ width: 70 }} />
                  <col />
                </colgroup>
                <tbody>
                  {col.months.map(mb => (
                    <MonthBlock key={mb.month} month={mb.month} weeks={mb.weeks} accent={color}>
                      {mb.month === 'JUN' && (
                        <tr style={{ borderTop: `2px solid ${color}55` }}>
                          <td colSpan={2} style={{ padding: '5px 6px', fontSize: 9.5, fontWeight: 700, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>
                            FY {col.year - 1}/{String(col.year).slice(-2)}
                          </td>
                          <td style={{ padding: '5px 6px', fontWeight: 700, textAlign: 'right', color: pnlColorCal(fyTotalByYear.get(col.year) ?? 0), whiteSpace: 'nowrap' }}>
                            {fmt$(fyTotalByYear.get(col.year) ?? 0)}
                          </td>
                          <td />
                        </tr>
                      )}
                    </MonthBlock>
                  ))}
                  <tr style={{ borderTop: `2px solid ${color}55` }}>
                    <td colSpan={2} style={{ padding: '8px 6px', fontSize: 9.5, fontWeight: 700, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>Calendar {col.year}</td>
                    <td style={{ padding: '8px 6px', fontWeight: 700, textAlign: 'right', color: pnlColorCal(grandTotal), whiteSpace: 'nowrap' }}>{fmt$(grandTotal)}</td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function pnlColorCal(n: number) { return n > 0 ? '#10b981' : n < 0 ? '#ef4444' : 'var(--text-4)' }

function MonthBlock({ month, weeks, accent, children }: { month: string; weeks: CalWeekRow[]; accent: string; children?: React.ReactNode }) {
  if (weeks.length === 0) return null
  const subtotal = weeks.reduce((s, w) => s + w.total, 0)
  return (
    <>
      {weeks.map((w, i) => (
        <tr key={w.startDate} style={{ borderTop: `1px solid ${accent}25` }}>
          {i === 0 && (
            <td rowSpan={weeks.length + 1} style={{
              padding: '4px 2px', fontSize: 9.5, fontWeight: 700, color: accent, writingMode: 'vertical-rl',
              textAlign: 'center', borderRight: `1px solid ${accent}25`, verticalAlign: 'middle', letterSpacing: '0.05em',
            }}>
              {month}
            </td>
          )}
          <td style={{ padding: '4px 4px', textAlign: 'center', color: 'var(--text-3)', fontSize: 9.5 }}>
            W{w.weekNum}
          </td>
          <td style={{ padding: '4px 6px', textAlign: 'right', color: w.total === 0 ? 'var(--text-4)' : pnlColorCal(w.total), whiteSpace: 'nowrap' }}>
            {w.total === 0 ? '—' : fmt$(w.total, 2)}
          </td>
          {/* Single line, ellipsis-truncated with the full text in `title` —
              letting notes stack into multiple lines per week (the first
              pass) made row heights vary by how many expiries landed in a
              given week, so no two year columns lined up vertically even
              though they cover the same 52 weeks. A fixed one-line height
              keeps every column the same total height regardless of note
              content. */}
          <td style={{ padding: '4px 6px', color: 'var(--text-2)', fontSize: 10, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}
            title={w.notes.length > 0 ? w.notes.join(' · ') : undefined}>
            {w.notes.length > 0 && <span style={{ color: accent, fontWeight: 600 }}>{w.notes.join(' · ')}</span>}
          </td>
        </tr>
      ))}
      <tr style={{ borderTop: `1px solid ${accent}25` }}>
        <td colSpan={2} />
        <td style={{ padding: '4px 6px', textAlign: 'right', fontWeight: 700, color: 'var(--text-1)', whiteSpace: 'nowrap' }}>{fmt$(subtotal, 2)}</td>
        <td />
      </tr>
      {children}
    </>
  )
}

// ─── Build daily trade P&L ───────────────────────────────────────────────────

function buildDailyTrades(trades: RawTrade[]): Record<string, DailyTradeData> {
  const map: Record<string, DailyTradeData> = {}
  for (const t of trades) {
    if (!t.tradeDate || t.isTransfer) continue
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
  if (!date) return <div style={{ background: 'var(--bg-surface)' }} />

  const dayNum = parseInt(date.split('-')[2])
  const { events, trades, hasActivity, earnings, holiday, econEvents } = data
  const hasPnL = trades && trades.netCash !== 0
  const isHoliday = !!holiday

  const listRef = useRef<HTMLDivElement>(null)
  const [hiddenCount, setHiddenCount] = useState(0)

  useLayoutEffect(() => {
    const el = listRef.current
    if (!el) { setHiddenCount(0); return }
    const bottom = el.getBoundingClientRect().bottom
    let count = 0
    el.querySelectorAll('[data-cal-item]').forEach(child => {
      const r = (child as HTMLElement).getBoundingClientRect()
      if (r.bottom > bottom + 0.5) count++
    })
    setHiddenCount(count)
  })

  return (
    <div
      onClick={onClick}
      style={{
        position: 'relative',
        background: isHoliday ? '#f43f5e08' : isSelected ? 'var(--bg-active)' : hasActivity ? 'var(--bg-card)' : 'var(--bg-surface)',
        border: `1px solid ${isSelected ? '#312e81' : isToday ? '#3b82f6' : isHoliday ? '#f43f5e30' : 'var(--bg-active)'}`,
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

      {/* Fills remaining cell height; content lists run down until they hit the bottom, soft-fading instead of an abrupt cut */}
      <div ref={listRef} style={{
        flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column',
        WebkitMaskImage: 'linear-gradient(to bottom, black calc(100% - 10px), transparent 100%)',
        maskImage: 'linear-gradient(to bottom, black calc(100% - 10px), transparent 100%)',
      }}>
        {/* CBOE holiday */}
        {isHoliday && (
          <div data-cal-item style={{
            fontSize: 9, fontWeight: 700, letterSpacing: '0.05em',
            color: '#f43f5e', background: '#f43f5e14',
            padding: '1px 4px', borderRadius: 3, marginBottom: 2,
            textAlign: 'center', border: '1px solid #f43f5e30', flexShrink: 0,
          }}>
            CLOSED
          </div>
        )}

        {/* Economic events (FOMC, Jackson Hole, etc.) — one shared purple
            treatment for every kind, the label text is what tells them
            apart. */}
        {econEvents.map((e, i) => {
          return (
            <div key={`econ-${i}`} data-cal-item title={e.kind === 'jackson_hole' ? 'Jackson Hole Economic Symposium' : 'FOMC rate decision'} style={{
              fontSize: 9, fontWeight: 700, letterSpacing: '0.03em',
              color: '#a78bfa', background: '#a78bfa14',
              padding: '1px 4px', marginBottom: 1, borderRadius: 3,
              textAlign: 'center', border: '1px solid #a78bfa30', flexShrink: 0,
              fontFamily: 'Inter, sans-serif',
            }}>
              {e.label}
            </div>
          )
        })}

        {/* Earnings badges */}
        {earnings.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2, marginBottom: 2, flexShrink: 0 }}>
            {earnings.map(t => (
              <span key={t} data-cal-item style={{
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

        {trades && trades.trades.map((t, i) => (
          <div key={i} data-cal-item style={{
            display: 'flex', alignItems: 'center', gap: 3,
            padding: '1px 4px', marginBottom: 1, flexShrink: 0,
            background: t.netCash >= 0 ? '#10b98112' : '#f43f5e12',
            border: `1px solid ${t.netCash >= 0 ? '#10b98130' : '#f43f5e30'}`,
            fontSize: 10.5, lineHeight: 1.3, borderRadius: 3,
          }}>
            <span style={{ fontWeight: 700, color: 'var(--text-2)', fontFamily: 'Inter, sans-serif', flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 44 }}>
              {t.underlyingSymbol ?? t.symbol}
            </span>
            <span style={{ color: 'var(--text-4)', flexShrink: 0 }}>{t.quantity > 0 ? '+' : ''}{t.quantity}</span>
            <span style={{ marginLeft: 'auto', fontWeight: 600, color: t.netCash >= 0 ? '#10b981' : '#f43f5e', flexShrink: 0, fontFamily: 'Inter, sans-serif' }}>
              {t.netCash >= 0 ? '+' : ''}{Math.round(t.netCash)}
            </span>
          </div>
        ))}

        {events.map((ev, i) => {
          const color = STRAT_COLOR[ev.strategyType]
          return (
            <div key={i} data-cal-item style={{
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

      {hiddenCount > 0 && (
        <div style={{
          position: 'absolute', bottom: 2, right: 3,
          fontSize: 9, fontWeight: 700, lineHeight: 1,
          color: 'var(--text-1)', background: 'var(--bg-elevated)',
          padding: '2px 4px', borderRadius: 8,
          border: '1px solid var(--border)',
          fontFamily: 'Inter, sans-serif',
          pointerEvents: 'none',
        }}>
          +{hiddenCount}
        </div>
      )}
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
  events, dailyTrades, earningsByDateMap, econEventMap, selectedDate, year, month,
}: {
  events: ExpiryEvent[]
  dailyTrades: Record<string, DailyTradeData>
  earningsByDateMap: Record<string, string[]>
  econEventMap: Record<string, EconEvent[]>
  selectedDate: string | null
  year: number
  month: number // 0-indexed
}) {
  const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}`

  // Collect all dates that have any activity (trades, earnings, holidays, econ events)
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
    // Economic event dates (FOMC, etc.)
    for (const d of Object.keys(econEventMap)) {
      if (d.startsWith(monthPrefix)) dateSet.add(d)
    }
    return [...dateSet].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))
  }, [dailyTrades, earningsByDateMap, econEventMap, monthPrefix])

  const displayDates = selectedDate ? [selectedDate] : monthDates

  const title = selectedDate
    ? new Date(selectedDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    : 'All Activity'

  return (
    <div className="calendar-activity-sidebar" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', flex: 1 }}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', fontSize: 13, fontWeight: 700, color: 'var(--text-2)', letterSpacing: '0.08em', flexShrink: 0 }}>
        {title.toUpperCase()}
      </div>

      <div className="calendar-activity-list" style={{ flex: 1, overflow: 'auto' }}>
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
          const dayEcon = econEventMap[date] ?? []
          if (!dayEvents.length && !dayTrades && !dayEarnings.length && !dayHoliday && !dayEcon.length) return null

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

              {/* Economic event detail (FOMC, etc.) */}
              {dayEcon.map((e, i) => (
                <div key={`econ-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 14px', borderTop: '1px solid var(--border-light)', fontSize: 13 }}>
                  <div style={{ width: 3, height: 24, background: '#a78bfa', flexShrink: 0, borderRadius: 1 }} />
                  <span style={{ fontWeight: 700, color: 'var(--text-1)', fontFamily: 'Inter, sans-serif', fontSize: 13 }}>{e.label}</span>
                  <span style={{ fontSize: 10, fontWeight: 700, color: '#a78bfa', background: '#a78bfa14', padding: '1px 6px', borderRadius: 3, border: '1px solid #a78bfa30' }}>RATE DECISION</span>
                </div>
              ))}

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

export default function CalendarView({ state, watchlistTickers = [], tradeLabels }: Props) {
  const today = new Date()
  const [year, setYear]     = useState(today.getFullYear())
  const [month, setMonth]   = useState(today.getMonth())
  const [selected, setSelected] = useState<string | null>(null)
  const [view, setView] = useState<'month' | 'multiyear'>('month')

  // Reuses the same trade-labeling/auto-classification engine that drives
  // Journal/Reports (buildJournalPositions/buildStockPositions resolve each
  // closed or open position's `strategy` from manual labels, falling back to
  // auto-classification for unlabeled short puts/calls) so "CSP" or "LEAP"
  // means the same thing here as everywhere else in the app, instead of a
  // second, calendar-only classification. Every trade that ends up in some
  // position's tradeIds gets that position's strategy; a trade in no
  // position at all (shouldn't normally happen) falls back to 'unlabelled'.
  const labels = tradeLabels?.labels ?? {}
  const tradeStrategy = useMemo(() => {
    const positions = [
      ...buildJournalPositions(state.sync.trades, labels),
      ...buildStockPositions(state.sync.trades, labels),
    ]
    const map = new Map<string, string>()
    for (const p of positions) for (const id of p.tradeIds) map.set(id, p.strategy ?? 'unlabelled')
    // FX conversions (assetClass CASH) aren't options or stock, so neither
    // engine above ever sees them — they had no strategy anywhere and
    // silently fell to "unlabelled" here, which isn't even a selectable
    // filter chip since nothing else ever sets it explicitly. Auto-classify
    // them as 'forex' (still overridable by an explicit manual label) so
    // they're a real, filterable "FX" bucket instead of invisible.
    for (const t of state.sync.trades) {
      if (t.assetClass !== 'CASH') continue
      const id = tradeId(t)
      map.set(id, labels[id] ?? 'forex')
    }
    return map
  }, [state.sync.trades, labels])

  const availableStrategies = useMemo(() => {
    const present = new Set(tradeStrategy.values())
    return STRAT_ORDER.filter(s => present.has(s))
      .concat(present.has('unlabelled') ? ['unlabelled'] : [])
  }, [tradeStrategy])

  // null = no filter applied (show everything); otherwise only trades whose
  // resolved strategy is in this set count toward every total/list below.
  const [strategyFilter, setStrategyFilter] = useState<Set<string> | null>(null)

  function toggleStrategy(s: string) {
    setStrategyFilter(prev => {
      const base = prev ?? new Set(availableStrategies)
      const next = new Set(base)
      if (next.has(s)) next.delete(s)
      else next.add(s)
      // Every available strategy selected is the same as no filter — collapse
      // back to null so re-adding a newly-appearing strategy later (e.g. after
      // syncing new trades) doesn't get silently excluded by a stale "all"-set.
      return next.size === availableStrategies.length ? null : next
    })
  }

  const filteredTrades = useMemo(() => {
    if (!strategyFilter) return state.sync.trades
    return state.sync.trades.filter(t => strategyFilter.has(tradeStrategy.get(tradeId(t)) ?? 'unlabelled'))
  }, [state.sync.trades, strategyFilter, tradeStrategy])

  // The sidebar must never grow past the calendar box's own height (a long
  // trade day list was pushing the whole card taller than the calendar and
  // overlapping the row below it) — measure the calendar's actual rendered
  // height and cap the sidebar to it, scrolling internally instead.
  const calMainRef = useRef<HTMLDivElement>(null)
  const [calHeight, setCalHeight] = useState<number | null>(null)
  useLayoutEffect(() => {
    const el = calMainRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => {
      const h = entries[0]?.contentRect.height
      if (h) setCalHeight(h)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Earnings dates (fetched once, cached 6h) — the user's Watchlist plus every
  // ticker actually traded (stock symbol or option underlying), so tickers
  // outside the watchlist still get their earnings date pulled and shown.
  const heldTickers = useMemo(() => {
    const set = new Set<string>(watchlistTickers)
    for (const p of state.sync.positions) set.add(p.underlyingSymbol ?? p.symbol)
    for (const t of state.sync.trades) set.add(t.underlyingSymbol ?? t.symbol)
    return [...set]
  }, [state.sync.positions, state.sync.trades, watchlistTickers])

  const [earningsMap, setEarningsMap] = useState<Record<string, string[]>>({})
  useEffect(() => {
    fetchEarningsDates(heldTickers).then(setEarningsMap).catch(() => {})
  }, [heldTickers])
  const earningsByDateMap = useMemo(() => earningsByDate(earningsMap), [earningsMap])

  // FOMC dates (fetched live from federalreserve.gov, cached/re-checked weekly)
  const [fomcDates, setFomcDates] = useState<string[]>([])
  useEffect(() => {
    fetchFomcDates().then(setFomcDates).catch(() => {})
  }, [])
  const econEventMap = useMemo(() => buildEconEventMap(fomcDates), [fomcDates])

  const events = useMemo(() => deriveEvents(state.strategies), [state.strategies])
  const dailyTrades = useMemo(() => buildDailyTrades(filteredTrades), [filteredTrades])

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
  const monthEconEventCount = Object.entries(econEventMap)
    .filter(([d]) => d.startsWith(monthPrefix))
    .reduce((s, [, evs]) => s + evs.length, 0)

  // Calendar always renders (holidays + earnings are always available)

  function getDayData(date: string | null): DayData {
    if (!date) return { events: [], trades: null, totalPnL: 0, hasActivity: false, earnings: [], holiday: null, econEvents: [] }
    const evs = eventsByDate[date] ?? []
    const tr = dailyTrades[date] ?? null
    const totalPnL = (tr?.netCash ?? 0) + evs.reduce((s, e) => s + e.unrealizedPnL, 0)
    const earnings = earningsByDateMap[date] ?? []
    const holiday = HOLIDAY_MAP[date] ?? null
    const econEvents = econEventMap[date] ?? []
    const hasActivity = evs.length > 0 || (tr !== null && tr.tradeCount > 0) || earnings.length > 0 || holiday !== null || econEvents.length > 0
    return { events: evs, trades: tr, totalPnL, hasActivity, earnings, holiday, econEvents }
  }

  return (
    <div className="calendar-page-root" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

      {/* Month nav + view toggle + strategy filter — all on shared top rows
          (rather than the toggle getting its own full-width row above them)
          so the calendar grid below keeps as much vertical space as
          possible. Kept outside the month/multi-year conditional below so
          the toggle (and, in month view, the nav/filter) stays visible and
          clickable regardless of which view is active. */}
      <div style={{ padding: '16px 20px 0', flexShrink: 0 }}>
        <div className="calendar-nav" style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
          {/* View toggle: single month grid vs. multi-year LEAP/expiry
              overview — same rp-subnav pill style as the Reports tab's
              Company P&L/Monthly Income toggle, for a consistent
              sub-page-switcher look app-wide. inline-flex + flexShrink:0
              keeps it sized to its two labels instead of stretching to the
              flex row's full width. */}
          <div className="rp-subnav" style={{ flexShrink: 0 }}>
            <button onClick={() => setView('month')} className={`rp-subnav-tab${view === 'month' ? ' active' : ''}`}>
              Month
            </button>
            <button onClick={() => setView('multiyear')} className={`rp-subnav-tab${view === 'multiyear' ? ' active' : ''}`}>
              Multi-Year
            </button>
          </div>
          {view === 'month' && (
          <>
            <button onClick={prevMonth} style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-3)', cursor: 'pointer', padding: '4px 8px', display: 'flex', borderRadius: 4 }}>
              <ChevronLeft size={14} />
            </button>
            <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-1)', minWidth: 150, textAlign: 'center' }}>
              {MONTHS[month]} {year}
            </span>
            <button onClick={nextMonth} style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-3)', cursor: 'pointer', padding: '4px 8px', display: 'flex', borderRadius: 4 }}>
              <ChevronRight size={14} />
            </button>

            {availableStrategies.length > 0 && (
              <div className="calendar-strategy-filter" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, color: 'var(--text-4)', marginRight: 2 }}>Strategy:</span>
                {availableStrategies.map(s => {
                  const active = !strategyFilter || strategyFilter.has(s)
                  return (
                    <button
                      key={s}
                      onClick={() => toggleStrategy(s)}
                      className={`tl-filter-chip${active ? ' active' : ''}`}
                      title={active ? `Click to exclude ${stratLabel(s)}` : `Click to include ${stratLabel(s)}`}
                      style={{ width: 76, textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    >
                      {calendarChipLabel(s)}
                    </button>
                  )
                })}
                {strategyFilter && (
                  <button
                    onClick={() => setStrategyFilter(null)}
                    style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-3)', cursor: 'pointer', padding: '3px 8px', fontSize: 11, fontFamily: 'inherit', borderRadius: 4 }}
                  >
                    Reset
                  </button>
                )}
              </div>
            )}

            <div style={{ flex: 1 }} />
            <div
              style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'help' }}
              title="Cash flow by trade date — premium/proceeds from trades executed this month, whether they opened or closed a position. This is NOT realized P&L by close date (see Companies → Monthly Income by Strategy for that), so the two totals for the same month won't match: a trade opened in an earlier month but closed this month shows its cash flow in the month it was opened, while its full realized gain/loss shows in the month it closed."
            >
              <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{monthTradeCount} trades</span>
              <span style={{ fontSize: 15, fontWeight: 600, fontFamily: 'Inter, sans-serif', color: monthTradePnL >= 0 ? '#10b981' : '#f43f5e' }}>
                {monthTradePnL >= 0 ? '+' : ''}{Math.round(monthTradePnL).toLocaleString()}
              </span>
            </div>
            {monthEconEventCount > 0 && (
              <div
                style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  fontSize: 11, fontWeight: 700, color: '#a78bfa', background: '#a78bfa14',
                  padding: '3px 8px', borderRadius: 4, border: '1px solid #a78bfa30',
                }}
                title="Economic events (FOMC, etc.) this month"
              >
                {monthEconEventCount} econ event{monthEconEventCount !== 1 ? 's' : ''}
              </div>
            )}
            {selected && (
              <button onClick={() => setSelected(null)} style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-3)', cursor: 'pointer', padding: '3px 8px', fontSize: 12, fontFamily: 'inherit', borderRadius: 4 }}>
                Clear
              </button>
            )}
          </>
          )}
        </div>
      </div>

      {view === 'multiyear' ? (
        <MultiYearCalendarView trades={state.sync.trades} events={events} />
      ) : (
      <>
      {/* ── Top: Calendar + Sidebar ──────────────────────────────────────── */}
      <div className="calendar-layout" style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>

        {/* Calendar grid */}
        <div ref={calMainRef} className="calendar-main" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'auto', padding: '0 20px 16px' }}>

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
        <div className="calendar-sidebar" style={{
          width: 300, borderLeft: '1px solid var(--border)', display: 'flex', flexDirection: 'column',
          overflow: 'hidden', flexShrink: 0,
          height: calHeight ? `${calHeight}px` : '100%',
          maxHeight: calHeight ? `${calHeight}px` : undefined,
        }}>
          <ActivitySidebar events={events} dailyTrades={dailyTrades} earningsByDateMap={earningsByDateMap} econEventMap={econEventMap} selectedDate={selected} year={year} month={month} />
        </div>
      </div>
      </>
      )}

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
