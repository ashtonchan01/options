import { useMemo, useState, useRef, useEffect } from 'react'
import type { RawTrade } from '../../types'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface TradeLogEntry {
  id: string
  week: number
  yearWeek: number       // year*100+week for cross-year sorting (e.g. 202540, 202605)
  ticker: string
  dateOpen: string       // YYYY-MM-DD
  strategy: string       // CC, SHORT PUT, LONG CALL, LONG PUT
  contracts: number
  strike: number
  expiry: string         // YYYY-MM-DD (normalised)
  initialDTE: number
  premium: number        // per-share avg price
  openFees: number       // absolute
  netPremium: number     // signed: positive = credit
  bep: number
  status: 'Open' | 'Closed' | 'Expired'
  currentDTE: number | null
  dateClosed: string | null
  closingPrice: number | null
  closingFees: number
  daysHeld: number | null
  closingAmount: number  // absolute
  profitLoss: number     // signed
  putCall: 'C' | 'P'
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function norm(s: string): string {
  const m = s.match(/^(\d{4})(\d{2})(\d{2})$/)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : s
}

function fmtDateShort(ymd: string): string {
  const [y, m, d] = ymd.split('-')
  return `${d}/${m}/${y.slice(2)}`
}

function isoWeekYear(d: Date): { week: number; year: number } {
  const dt = new Date(d.getTime())
  dt.setHours(0, 0, 0, 0)
  dt.setDate(dt.getDate() + 4 - (dt.getDay() || 7))
  const year = dt.getFullYear()
  const y1 = new Date(year, 0, 1)
  const week = Math.ceil((((dt.getTime() - y1.getTime()) / 86400000) + 1) / 7)
  return { week, year }
}

function fmt$(n: number, digits = 2): string {
  const prefix = n < 0 ? '-$' : '$'
  return prefix + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

// ─── Strategy colors ────────────────────────────────────────────────────────

const STRAT_CLR: Record<string, string> = {
  CC:          '#3b82f6',
  'SHORT PUT': '#f43f5e',
  'LONG CALL': '#10b981',
  'LONG PUT':  '#fb923c',
}

// ─── Builder ────────────────────────────────────────────────────────────────

export function buildTradeLog(trades: RawTrade[]): TradeLogEntry[] {
  const opts = trades.filter(t => t.assetClass === 'OPT' && t.strike && t.expiry && t.putCall)

  // Group by contract key
  // Split into trade lifecycles: each time position goes flat→open→flat is one lifecycle.
  // This prevents reopening the same contract from merging old + new trades.
  // Key includes the open date cluster to separate re-trades.
  const lifecycles: { key: string; opens: RawTrade[]; closes: RawTrade[] }[] = []

  // First group by contract spec (underlying + putCall + strike + expiry)
  const specGroups: Record<string, RawTrade[]> = {}
  for (const t of opts) {
    const under = t.underlyingSymbol || t.symbol.split(/\s/)[0]
    const spec = `${under}_${t.putCall}_${t.strike}_${t.expiry}`
    ;(specGroups[spec] ??= []).push(t)
  }

  // Within each spec group, split into lifecycles (open→close cycles)
  for (const [spec, grp] of Object.entries(specGroups)) {
    const sorted = [...grp].sort((a, b) => a.tradeDate.localeCompare(b.tradeDate))

    // Classify each trade as open or close
    const classified: { trade: RawTrade; oc: 'O' | 'C' }[] = []
    const hasOC = sorted.some(t => t.openClose)

    if (hasOC) {
      // Use openClose field, treating undefined as open (fix: silent drop bug)
      for (const t of sorted) {
        classified.push({ trade: t, oc: t.openClose === 'C' ? 'C' : 'O' })
      }
    } else {
      // Infer from position accumulation
      let pos = 0
      const initSign = sorted.find(t => t.quantity !== 0)?.quantity ?? 0
      for (const t of sorted) {
        if (t.quantity === 0) continue // skip zero-qty trades
        if (pos === 0 || Math.sign(t.quantity) === Math.sign(initSign)) {
          classified.push({ trade: t, oc: 'O' })
        } else {
          classified.push({ trade: t, oc: 'C' })
        }
        pos += t.quantity
      }
    }

    // Split into lifecycles: each sequence of opens followed by closes
    let curOpens: RawTrade[] = []
    let curCloses: RawTrade[] = []
    let openQty = 0
    let closeQty = 0

    for (const { trade, oc } of classified) {
      if (oc === 'O') {
        // If we had a completed lifecycle, flush it
        if (curOpens.length > 0 && closeQty >= openQty && closeQty > 0) {
          lifecycles.push({ key: `${spec}_${curOpens[0].tradeDate}`, opens: curOpens, closes: curCloses })
          curOpens = []; curCloses = []; openQty = 0; closeQty = 0
        }
        curOpens.push(trade)
        openQty += Math.abs(trade.quantity)
      } else {
        curCloses.push(trade)
        closeQty += Math.abs(trade.quantity)
        // If fully closed, flush
        if (closeQty >= openQty && curOpens.length > 0) {
          lifecycles.push({ key: `${spec}_${curOpens[0].tradeDate}`, opens: curOpens, closes: curCloses })
          curOpens = []; curCloses = []; openQty = 0; closeQty = 0
        }
      }
    }
    // Remaining open or partially-closed lifecycle
    if (curOpens.length > 0) {
      lifecycles.push({ key: `${spec}_${curOpens[0].tradeDate}`, opens: curOpens, closes: curCloses })
    }
  }

  const now = Date.now()
  const entries: TradeLogEntry[] = []

  for (const { key, opens, closes } of lifecycles) {
    if (opens.length === 0) continue

    const first   = opens[0]
    const under   = first.underlyingSymbol || first.symbol.split(/\s/)[0]
    const isShort = first.quantity < 0
    const pc      = first.putCall as 'C' | 'P'

    const strategy = pc === 'C'
      ? (isShort ? 'CC' : 'LONG CALL')
      : (isShort ? 'SHORT PUT' : 'LONG PUT')

    // Aggregate opens
    const oQty   = opens.reduce((s, t) => s + Math.abs(t.quantity), 0)
    if (oQty === 0) continue // guard against zero-qty division
    const oComm  = opens.reduce((s, t) => s + t.commissions, 0)
    const oNet   = opens.reduce((s, t) => s + t.netCash, 0)
    const avgP   = opens.reduce((s, t) => s + t.tradePrice * Math.abs(t.quantity), 0) / oQty

    // Aggregate closes
    const cQty   = closes.reduce((s, t) => s + Math.abs(t.quantity), 0)
    const cComm  = closes.reduce((s, t) => s + t.commissions, 0)
    const cNet   = closes.reduce((s, t) => s + t.netCash, 0)
    const avgCP  = cQty > 0
      ? closes.reduce((s, t) => s + t.tradePrice * Math.abs(t.quantity), 0) / cQty
      : null

    // Dates
    const sortedO = [...opens].sort((a, b) => a.tradeDate.localeCompare(b.tradeDate))
    const sortedC = [...closes].sort((a, b) => b.tradeDate.localeCompare(a.tradeDate))
    const dateOpen  = norm(sortedO[0].tradeDate)
    const dateClose = sortedC.length > 0 ? norm(sortedC[0].tradeDate) : null

    const expiryNorm = norm(first.expiry!)
    const expiryMs   = new Date(expiryNorm + 'T16:00:00').getTime()
    const openMs     = new Date(dateOpen + 'T12:00:00').getTime()
    if (isNaN(expiryMs) || isNaN(openMs)) continue // guard against invalid dates
    const initDTE    = Math.max(0, Math.round((expiryMs - openMs) / 86400000))
    const curDTE     = Math.max(0, Math.round((expiryMs - now) / 86400000))

    // Status
    let status: TradeLogEntry['status']
    if (cQty >= oQty)             status = 'Closed'
    else if (expiryMs < now)      status = 'Expired'
    else                          status = 'Open'

    // Days held
    const closeMs = dateClose ? new Date(dateClose + 'T12:00:00').getTime() : null
    const daysHeld = status === 'Closed' && closeMs
      ? Math.round((closeMs - openMs) / 86400000)
      : status === 'Expired'
        ? Math.round((expiryMs - openMs) / 86400000)
        : null

    const { week: wk, year: wkYear } = isoWeekYear(new Date(dateOpen + 'T12:00:00'))

    entries.push({
      id:             key,
      week:           wk,
      yearWeek:       wkYear * 100 + wk,
      ticker:         under,
      dateOpen,
      strategy,
      contracts:      oQty,
      strike:         first.strike!,
      expiry:         expiryNorm,
      initialDTE:     initDTE,
      premium:        +avgP.toFixed(2),
      openFees:       +Math.abs(oComm).toFixed(2),
      netPremium:     +oNet.toFixed(2),
      bep:            +(pc === 'C' ? first.strike! + avgP : first.strike! - avgP).toFixed(2),
      status,
      currentDTE:     status === 'Open' ? curDTE : status === 'Expired' ? 0 : null,
      dateClosed:     dateClose ?? (status === 'Expired' ? expiryNorm : null),
      closingPrice:   avgCP !== null ? +avgCP.toFixed(2) : (status === 'Expired' ? 0 : null),
      closingFees:    +Math.abs(cComm).toFixed(2),
      daysHeld,
      closingAmount:  +Math.abs(cNet).toFixed(2),
      profitLoss:     +(oNet + cNet).toFixed(2),
      putCall:        pc,
    })
  }

  entries.sort((a, b) => a.dateOpen.localeCompare(b.dateOpen))
  return entries
}

// ─── Column defs ────────────────────────────────────────────────────────────

type SortKey = keyof TradeLogEntry
type Align = 'left' | 'right' | 'center'

const COLS: { key: SortKey; label: string; w: number; align: Align; section: 'open' | 'current' | 'close' }[] = [
  { key: 'week',          label: 'WK',        w: 40,  align: 'center', section: 'open' },
  { key: 'ticker',        label: 'TICKER',    w: 70,  align: 'left',   section: 'open' },
  { key: 'dateOpen',      label: 'OPENED',    w: 88,  align: 'left',   section: 'open' },
  { key: 'strategy',      label: 'STRATEGY',  w: 100, align: 'left',   section: 'open' },
  { key: 'contracts',     label: 'C',         w: 32,  align: 'right',  section: 'open' },
  { key: 'strike',        label: 'STRIKE',    w: 75,  align: 'right',  section: 'open' },
  { key: 'expiry',        label: 'EXPIRY',    w: 88,  align: 'right',  section: 'open' },
  { key: 'initialDTE',    label: 'INIT DTE',  w: 58,  align: 'right',  section: 'open' },
  { key: 'premium',       label: 'PREMIUM',   w: 78,  align: 'right',  section: 'open' },
  { key: 'openFees',      label: 'FEES',      w: 60,  align: 'right',  section: 'open' },
  { key: 'netPremium',    label: 'NET PREM',  w: 90,  align: 'right',  section: 'open' },
  { key: 'bep',           label: 'BEP',       w: 78,  align: 'right',  section: 'open' },
  { key: 'status',        label: 'STATUS',    w: 72,  align: 'center', section: 'current' },
  { key: 'currentDTE',    label: 'DTE',       w: 45,  align: 'right',  section: 'current' },
  { key: 'dateClosed',    label: 'CLOSED',    w: 88,  align: 'left',   section: 'close' },
  { key: 'closingPrice',  label: 'CLS PRICE', w: 78,  align: 'right',  section: 'close' },
  { key: 'closingFees',   label: 'CLS FEES',  w: 65,  align: 'right',  section: 'close' },
  { key: 'daysHeld',      label: 'DAYS',      w: 45,  align: 'right',  section: 'close' },
  { key: 'closingAmount', label: 'CLS AMT',   w: 90,  align: 'right',  section: 'close' },
  { key: 'profitLoss',    label: 'P&L',       w: 100, align: 'right',  section: 'close' },
]

const OPEN_SPAN   = COLS.filter(c => c.section === 'open').length
const CUR_SPAN    = COLS.filter(c => c.section === 'current').length
const CLOSE_SPAN  = COLS.filter(c => c.section === 'close').length

// ─── Cell renderers ─────────────────────────────────────────────────────────

function renderCell(col: typeof COLS[number], e: TradeLogEntry): React.ReactNode {
  const mono: React.CSSProperties = { fontFamily: 'IBM Plex Mono, monospace' }

  switch (col.key) {
    case 'week':
      return <span style={{ ...mono, color: 'var(--text-3)', fontSize: 12 }}>{e.week}</span>

    case 'ticker':
      return <span style={{ ...mono, fontWeight: 700, color: 'var(--text-1)', fontSize: 13 }}>{e.ticker}</span>

    case 'dateOpen':
      return <span style={{ ...mono, color: 'var(--text-2)', fontSize: 12 }}>{fmtDateShort(e.dateOpen)}</span>

    case 'strategy': {
      const color = STRAT_CLR[e.strategy] ?? '#64748b'
      return (
        <span style={{
          ...mono, fontSize: 10, fontWeight: 700, padding: '2px 6px',
          background: `${color}18`, border: `1px solid ${color}40`, color,
          borderRadius: 3, whiteSpace: 'nowrap',
        }}>
          {e.strategy}
        </span>
      )
    }

    case 'contracts':
      return <span style={{ ...mono, color: 'var(--text-2)' }}>{e.contracts}</span>

    case 'strike':
      return <span style={{ ...mono, color: 'var(--text-1)' }}>${e.strike.toLocaleString()}</span>

    case 'expiry':
      return <span style={{ ...mono, color: 'var(--text-2)', fontSize: 12 }}>{fmtDateShort(e.expiry)}</span>

    case 'initialDTE':
      return <span style={{ ...mono, color: 'var(--text-2)' }}>{e.initialDTE}</span>

    case 'premium':
      return <span style={{ ...mono, color: 'var(--text-1)' }}>${e.premium.toFixed(2)}</span>

    case 'openFees':
      return <span style={{ ...mono, color: 'var(--text-3)', fontSize: 12 }}>${e.openFees.toFixed(2)}</span>

    case 'netPremium': {
      const c = e.netPremium >= 0 ? '#10b981' : '#f43f5e'
      return <span style={{ ...mono, color: c, fontWeight: 600 }}>{fmt$(e.netPremium)}</span>
    }

    case 'bep':
      return <span style={{ ...mono, color: 'var(--text-2)' }}>${e.bep.toFixed(2)}</span>

    case 'status': {
      const bg  = e.status === 'Open' ? '#f59e0b' : e.status === 'Closed' ? 'var(--text-3)' : 'var(--text-4)'
      const fg  = e.status === 'Open' ? '#fff' : e.status === 'Closed' ? 'var(--bg-card)' : 'var(--bg-card)'
      return (
        <span style={{
          fontSize: 10, fontWeight: 700, padding: '2px 7px',
          background: bg, color: fg, borderRadius: 3,
        }}>
          {e.status}
        </span>
      )
    }

    case 'currentDTE':
      return e.currentDTE !== null
        ? <span style={{ ...mono, color: e.currentDTE <= 7 ? '#f59e0b' : 'var(--text-2)' }}>{e.currentDTE}</span>
        : <span style={{ color: 'var(--text-4)' }}>—</span>

    case 'dateClosed':
      return e.dateClosed
        ? <span style={{ ...mono, color: 'var(--text-2)', fontSize: 12 }}>{fmtDateShort(e.dateClosed)}</span>
        : <span style={{ color: 'var(--text-4)' }}>—</span>

    case 'closingPrice':
      return e.closingPrice !== null
        ? <span style={{ ...mono, color: 'var(--text-1)' }}>${e.closingPrice.toFixed(2)}</span>
        : <span style={{ color: 'var(--text-4)' }}>—</span>

    case 'closingFees':
      return e.closingFees > 0
        ? <span style={{ ...mono, color: 'var(--text-3)', fontSize: 12 }}>${e.closingFees.toFixed(2)}</span>
        : <span style={{ color: 'var(--text-4)' }}>—</span>

    case 'daysHeld':
      return e.daysHeld !== null
        ? <span style={{ ...mono, color: 'var(--text-2)' }}>{e.daysHeld}</span>
        : <span style={{ color: 'var(--text-4)' }}>—</span>

    case 'closingAmount':
      return e.closingAmount > 0
        ? <span style={{ ...mono, color: '#f43f5e', fontWeight: 600 }}>{fmt$(e.closingAmount)}</span>
        : <span style={{ color: 'var(--text-4)' }}>—</span>

    case 'profitLoss': {
      if (e.status === 'Open') return <span style={{ color: 'var(--text-4)' }}>—</span>
      const c = e.profitLoss >= 0 ? '#10b981' : '#f43f5e'
      return <span style={{ ...mono, color: c, fontWeight: 700 }}>{fmt$(e.profitLoss)}</span>
    }

    default:
      return String((e as unknown as Record<string, unknown>)[col.key] ?? '')
  }
}

// ─── Component ──────────────────────────────────────────────────────────────

// Numeric columns default to descending (biggest first), strings to ascending
const DESC_DEFAULT = new Set<SortKey>([
  'week', 'dateOpen', 'contracts', 'strike', 'initialDTE', 'premium',
  'openFees', 'netPremium', 'bep', 'currentDTE', 'dateClosed',
  'closingPrice', 'closingFees', 'daysHeld', 'closingAmount', 'profitLoss',
])

const SECTION_LAST_KEYS = new Set([
  COLS.filter(c => c.section === 'open').at(-1)!.key,
  COLS.filter(c => c.section === 'current').at(-1)!.key,
])

export default function TradeLog({ trades }: { trades: RawTrade[] }) {
  const entries = useMemo(() => buildTradeLog(trades), [trades])
  const [sortKey, setSortKey] = useState<SortKey>('dateOpen')
  const [sortAsc, setSortAsc] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const sorted = useMemo(() => {
    const ek: keyof TradeLogEntry = sortKey === 'week' ? 'yearWeek' : sortKey

    return [...entries].sort((a, b) => {
      const av = a[ek], bv = b[ek]
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1

      let diff: number
      if (typeof av === 'number' && typeof bv === 'number') {
        diff = av - bv
      } else {
        const sa = String(av), sb = String(bv)
        diff = sa < sb ? -1 : sa > sb ? 1 : 0
      }

      if (diff === 0 && ek !== 'dateOpen') {
        diff = a.dateOpen < b.dateOpen ? -1 : a.dateOpen > b.dateOpen ? 1 : 0
      }

      return sortAsc ? diff : -diff
    })
  }, [entries, sortKey, sortAsc])

  // Scroll to top when sort changes
  useEffect(() => {
    scrollRef.current?.scrollTo(0, 0)
  }, [sortKey, sortAsc])

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortAsc(a => !a)
    else { setSortKey(key); setSortAsc(!DESC_DEFAULT.has(key)) }
  }

  // Summary stats
  const closed   = entries.filter(e => e.status !== 'Open')
  const totalPnL = closed.reduce((s, e) => s + e.profitLoss, 0)
  const totalPrem = entries.reduce((s, e) => s + e.netPremium, 0)
  const wins     = closed.filter(e => e.profitLoss >= 0).length
  const winRate  = closed.length > 0 ? (wins / closed.length * 100) : 0

  if (entries.length === 0) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)', fontSize: 14 }}>
        No option trades to display. Sync your IBKR data to populate the trade log.
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

      {/* Header bar */}
      <div style={{
        padding: '8px 16px', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0, background: 'var(--bg-card)',
      }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.08em' }}>TRADE LOG</span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, fontFamily: 'IBM Plex Mono, monospace', color: 'var(--text-3)' }}>
          {entries.length} trades
        </span>
        <span style={{ fontSize: 12, fontFamily: 'IBM Plex Mono, monospace', color: 'var(--text-3)' }}>
          Win rate: <span style={{ color: winRate >= 60 ? '#10b981' : '#f59e0b', fontWeight: 600 }}>{winRate.toFixed(0)}%</span>
        </span>
        <span style={{ fontSize: 12, fontFamily: 'IBM Plex Mono, monospace', color: 'var(--text-3)' }}>
          Premium: <span style={{ color: totalPrem >= 0 ? '#10b981' : '#f43f5e', fontWeight: 600 }}>{fmt$(totalPrem, 0)}</span>
        </span>
        <span style={{ fontSize: 12, fontFamily: 'IBM Plex Mono, monospace', color: 'var(--text-3)' }}>
          P&L: <span style={{ color: totalPnL >= 0 ? '#10b981' : '#f43f5e', fontWeight: 700 }}>{fmt$(totalPnL, 0)}</span>
        </span>
      </div>

      {/* Table — border-separate for Safari sticky support */}
      <div ref={scrollRef} style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: 13, minWidth: 1400 }}>

          <thead>
            {/* Section headers */}
            <tr>
              <th colSpan={OPEN_SPAN} style={{
                padding: '5px 10px', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em',
                textAlign: 'center', color: '#3b82f6',
                borderBottom: '1px solid var(--border)', borderRight: '1px solid var(--border)',
                background: 'var(--bg-card)', position: 'sticky', top: 0, zIndex: 3,
                pointerEvents: 'none',
              }}>OPENING PARAMETERS</th>
              <th colSpan={CUR_SPAN} style={{
                padding: '5px 10px', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em',
                textAlign: 'center', color: '#f59e0b',
                borderBottom: '1px solid var(--border)', borderRight: '1px solid var(--border)',
                background: 'var(--bg-card)', position: 'sticky', top: 0, zIndex: 3,
                pointerEvents: 'none',
              }}>CURRENT</th>
              <th colSpan={CLOSE_SPAN} style={{
                padding: '5px 10px', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em',
                textAlign: 'center', color: '#10b981',
                borderBottom: '1px solid var(--border)',
                background: 'var(--bg-card)', position: 'sticky', top: 0, zIndex: 3,
                pointerEvents: 'none',
              }}>CLOSING PARAMETERS</th>
            </tr>
            {/* Column headers */}
            <tr>
              {COLS.map((col) => (
                <th
                  key={col.key}
                  onClick={() => toggleSort(col.key)}
                  style={{
                    padding: '6px 10px', fontSize: 10, fontWeight: 700,
                    letterSpacing: '0.06em', whiteSpace: 'nowrap',
                    userSelect: 'none', cursor: 'pointer',
                    borderBottom: '1px solid var(--border)',
                    borderRight: SECTION_LAST_KEYS.has(col.key) ? '1px solid var(--border)' : undefined,
                    background: 'var(--bg-elevated)',
                    position: 'sticky', top: 25, zIndex: 4,
                    textAlign: col.align, width: col.w, minWidth: col.w,
                    color: sortKey === col.key ? 'var(--text-1)' : 'var(--text-3)',
                  }}
                >
                  {col.label}
                  {sortKey === col.key && (
                    <span style={{ marginLeft: 3, color: '#6366F1', fontWeight: 700 }}>
                      {sortAsc ? '▲' : '▼'}
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {sorted.map((e, idx) => (
              <tr
                key={`${e.id}_${idx}`}
                style={{
                  background: idx % 2 ? 'var(--bg-surface)' : 'transparent',
                }}
              >
                {COLS.map(col => (
                  <td
                    key={col.key}
                    style={{
                      padding: '7px 10px',
                      textAlign: col.align, width: col.w, minWidth: col.w,
                      borderBottom: '1px solid var(--border-light)',
                      borderRight: SECTION_LAST_KEYS.has(col.key) ? '1px solid var(--border-light)' : undefined,
                    }}
                  >
                    {renderCell(col, e)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
