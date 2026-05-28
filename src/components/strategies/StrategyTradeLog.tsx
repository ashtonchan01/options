/**
 * Generic strategy trade log — reused by CSP, LEAP, SPX, and future pages.
 * Matches open/close legs into single position rows, spreadsheet-style.
 */
import { useState, useMemo } from 'react'
import type { AppState, RawTrade } from '../../types'

interface Config {
  id: string
  label: string
  description: string
  color: string
  filter: (t: RawTrade) => boolean
}

interface Props { state: AppState; config: Config }

// ─── FY helpers ───────────────────────────────────────────────────────────────

function getFY(dateStr: string): number {
  const d = new Date(dateStr)
  const month = d.getMonth() + 1
  return month >= 7 ? d.getFullYear() + 1 : d.getFullYear()
}

function fyLabel(fy: number) { return `FY${fy} (Jul ${fy - 1} – Jun ${fy})` }

function fyRange(fy: number): [Date, Date] {
  return [new Date(`${fy - 1}-07-01`), new Date(`${fy}-06-30T23:59:59`)]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt$(n: number, d = 2) {
  const sign = n < 0 ? '-' : ''
  return `${sign}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`
}

function fmtDate(s: string) {
  const d = new Date(s)
  return isNaN(d.getTime()) ? s : d.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })
}

function fmtExpiry(s: string) {
  if (!s) return '—'
  if (/^\d{8}$/.test(s)) s = `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`
  const d = new Date(s)
  return isNaN(d.getTime()) ? s : d.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: '2-digit' })
}

function parseExpiry(s: string): Date | null {
  if (!s) return null
  if (/^\d{8}$/.test(s)) s = `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d
}

const TODAY = new Date(); TODAY.setHours(0,0,0,0)

function daysBetween(a: Date | string, b: Date | string): number {
  const da = typeof a === 'string' ? new Date(a) : a
  const db = typeof b === 'string' ? new Date(b) : b
  return Math.round((db.getTime() - da.getTime()) / 86_400_000)
}

function pnlCls(n: number) { return n > 0 ? 'pos' : n < 0 ? 'neg' : 'neu' }

type SortKey = 'date_desc' | 'date_asc' | 'pnl_desc' | 'pnl_asc' | 'underlying'

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'date_desc',  label: 'Date — Newest first'  },
  { value: 'date_asc',   label: 'Date — Oldest first'  },
  { value: 'pnl_desc',   label: 'P&L — Highest first'  },
  { value: 'pnl_asc',    label: 'P&L — Lowest first'   },
  { value: 'underlying', label: 'Ticker A–Z'            },
]

// ─── Position model ───────────────────────────────────────────────────────────

interface Position {
  id: string
  week: number
  underlying: string
  contracts: number
  strikeDisplay: string   // "170.00" or "7425/7400"
  putCall: string         // "C" | "P" | ""
  expiry: string
  dateOpen: string
  initialDTE: number
  openPrice: number       // net credit per share
  openFees: number
  premiumCollected: number  // gross credit from sell legs only
  netPremium: number        // net credit after hedge cost + fees
  bep: number             // breakeven price

  status: 'Active' | 'Closed' | 'Expired'
  currentDTE: number | null

  dateClosed?: string
  closePrice?: number
  closeFees?: number
  closingAmount?: number
  pnl?: number
}

// ─── Position builder ─────────────────────────────────────────────────────────

function buildPositions(trades: RawTrade[]): Position[] {
  // Group all trades by (tradeDate, expiry, underlying) → one group = one position event
  const groups = new Map<string, RawTrade[]>()
  for (const t of trades) {
    const key = `${t.tradeDate}|${t.expiry ?? ''}|${t.underlyingSymbol ?? t.symbol}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(t)
  }

  // Separate opening groups (contain at least one sell leg) from closing groups
  const openGroups:  Array<{ key: string; date: string; expiry: string; underlying: string; legs: RawTrade[] }> = []
  const closeGroups: Array<{ date: string; expiry: string; underlying: string; legs: RawTrade[] }> = []

  for (const [key, legs] of groups) {
    const hasSell = legs.some(l => l.quantity < 0)
    const hasBuy  = legs.some(l => l.quantity > 0)
    const [date, expiry, underlying] = key.split('|')
    if (hasSell) openGroups.push({ key, date, expiry, underlying, legs })
    else if (hasBuy) closeGroups.push({ date, expiry, underlying, legs })
  }

  // Sort opens oldest-first so week numbering is chronological
  openGroups.sort((a, b) => a.date.localeCompare(b.date))

  // Week number relative to first trade
  function isoWeekNum(dateStr: string): number {
    const d = new Date(dateStr); d.setHours(0,0,0,0)
    d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7)
    const w1 = new Date(d.getFullYear(), 0, 4)
    return 1 + Math.round(((d.getTime() - w1.getTime()) / 86_400_000 - 3 + (w1.getDay() + 6) % 7) / 7)
  }
  const firstWeek = openGroups.length ? isoWeekNum(openGroups[0].date) : 1
  const firstYear = openGroups.length ? new Date(openGroups[0].date).getFullYear() : new Date().getFullYear()

  const usedCloses = new Set<number>()

  return openGroups.map((og) => {
    const expDate = parseExpiry(og.expiry)
    const legs    = og.legs

    // Split legs: true opening trades (openClose='O' or unset) vs settlement/close entries (openClose='C')
    // For 0DTE ITM, IBKR records the cash settlement as trades with openClose='C' on the same day
    const openLegs       = legs.filter(l => l.openClose !== 'C')
    const settlementLegs = legs.filter(l => l.openClose === 'C')

    // Sells = the short legs among opening trades
    const sells = openLegs.filter(l => l.quantity < 0)
    const buys  = openLegs.filter(l => l.quantity > 0)  // hedge legs (spread)

    const contracts = sells.length > 0 ? Math.abs(sells[0].quantity) : 1

    // Opening proceeds = only from true opening legs
    const totalProceeds  = openLegs.reduce((s, l) => s + l.proceeds, 0)
    const openFees       = openLegs.reduce((s, l) => s + Math.abs(l.commissions ?? 0), 0)
    const openingNetCash = openLegs.reduce((s, l) => s + l.netCash, 0)

    // Premium collected = gross cash from sell legs only (before hedge cost)
    const premiumCollected = sells.reduce((s, l) => s + l.netCash, 0)

    // openPrice = net credit per share (net proceeds / contracts / 100)
    const openPrice = contracts > 0 ? totalProceeds / contracts / 100 : 0

    // Net premium = opening credit net of hedge cost and fees
    const netPremium = openingNetCash

    // Strikes
    const allStrikes = [...new Set(legs.map(l => l.strike).filter(Boolean) as number[])].sort((a, b) => b - a)
    const strikeDisplay = allStrikes.length > 0
      ? allStrikes.map(s => s % 1 === 0 ? s.toFixed(0) : s.toFixed(2)).join('/')
      : '—'

    // Put/Call from sell leg
    const putCallChar = sells[0]?.putCall ?? buys[0]?.putCall ?? ''

    // BEP: sell call → strike + net credit/share; sell put → strike - net credit/share
    const sellStrike = sells[0]?.strike ?? 0
    const netCreditPerShare = contracts > 0 ? totalProceeds / contracts / 100 : 0
    const bep = sellStrike
      ? (putCallChar === 'P' ? sellStrike - netCreditPerShare : sellStrike + netCreditPerShare)
      : 0

    const initialDTE = expDate ? daysBetween(og.date, expDate) : 0

    // Find matching close group (same expiry + underlying, later date, has buys)
    const closeIdx = closeGroups.findIndex((cg, i) =>
      !usedCloses.has(i) &&
      cg.expiry === og.expiry &&
      cg.underlying === og.underlying &&
      cg.date > og.date
    )

    const expired = expDate ? expDate < TODAY : false

    // Relative week
    const d = new Date(og.date); d.setHours(0,0,0,0)
    const yearDiff = d.getFullYear() - firstYear
    const week = isoWeekNum(og.date) - firstWeek + 1 + yearDiff * 52

    if (closeIdx >= 0) {
      usedCloses.add(closeIdx)
      const cg = closeGroups[closeIdx]
      const closeFees    = cg.legs.reduce((s, l) => s + Math.abs(l.commissions ?? 0), 0)
      const closeNetCash = cg.legs.reduce((s, l) => s + l.netCash, 0)
      const closingAmount = Math.abs(closeNetCash)
      const closePrice   = cg.legs.reduce((s, l) => s + l.tradePrice, 0) / cg.legs.length
      const pnl          = openingNetCash + closeNetCash

      return {
        id: og.key, week, underlying: og.underlying,
        contracts, strikeDisplay, putCall: putCallChar,
        expiry: og.expiry, dateOpen: og.date, initialDTE,
        openPrice, openFees, premiumCollected, netPremium, bep,
        status: 'Closed', currentDTE: null,
        dateClosed: cg.date, closePrice, closeFees, closingAmount, pnl,
      }
    }

    if (expired) {
      // For 0DTE ITM: settlement trades are in settlementLegs (openClose='C')
      const settlementNetCash = settlementLegs.reduce((s, l) => s + l.netCash, 0)
      const closingAmount     = settlementLegs.length > 0 ? Math.abs(settlementNetCash) : 0
      const pnl               = openingNetCash + settlementNetCash  // net of opening credit + settlement debit

      return {
        id: og.key, week, underlying: og.underlying,
        contracts, strikeDisplay, putCall: putCallChar,
        expiry: og.expiry, dateOpen: og.date, initialDTE,
        openPrice, openFees, premiumCollected, netPremium, bep,
        status: 'Expired', currentDTE: null,
        closingAmount: settlementLegs.length > 0 ? closingAmount : undefined,
        pnl,
      }
    }

    const currentDTE = expDate ? Math.max(0, daysBetween(TODAY, expDate)) : null
    return {
      id: og.key, week, underlying: og.underlying,
      contracts, strikeDisplay, putCall: putCallChar,
      expiry: og.expiry, dateOpen: og.date, initialDTE,
      openPrice, openFees, premiumCollected, netPremium, bep,
      status: 'Active', currentDTE,
    }
  })
}

// ─── Summary strip ────────────────────────────────────────────────────────────

function SummaryStrip({ positions }: { positions: Position[] }) {
  const active  = positions.filter(p => p.status === 'Active')
  const closed  = positions.filter(p => p.status === 'Closed')
  const expired = positions.filter(p => p.status === 'Expired')

  const openPrem  = active.reduce((s, p) => s + p.netPremium, 0)
  const realized  = [...closed, ...expired].reduce((s, p) => s + (p.pnl ?? 0), 0)
  const totalPnl  = positions.reduce((s, p) => s + (p.pnl ?? p.netPremium), 0)
  const openFees  = active.reduce((s, p) => s + p.openFees, 0)
  const totalFees = positions.reduce((s, p) => s + p.openFees + (p.closeFees ?? 0), 0)

  const wins    = [...closed, ...expired].filter(p => (p.pnl ?? 0) > 0)
  const winRate = (closed.length + expired.length) > 0
    ? (wins.length / (closed.length + expired.length)) * 100 : 0

  const cards = [
    { label: 'Positions',     value: String(positions.length),           color: 'var(--text-1)' },
    { label: 'Active',        value: String(active.length),              color: '#10b981'       },
    { label: 'Closed',        value: String(closed.length),              color: '#f59e0b'       },
    { label: 'Expired',       value: String(expired.length),             color: 'var(--text-4)' },
    { label: 'Open Premium',  value: fmt$(openPrem, 0),                  color: openPrem >= 0 ? '#10b981' : '#f43f5e' },
    { label: 'Realized P&L',  value: fmt$(realized, 0),                  color: realized >= 0 ? '#10b981' : '#f43f5e' },
    { label: 'Total P&L',     value: fmt$(totalPnl, 0),                  color: totalPnl >= 0 ? '#10b981' : '#f43f5e' },
    { label: 'Win Rate',      value: (closed.length + expired.length) > 0 ? `${winRate.toFixed(0)}%` : '—',
                              color: winRate >= 70 ? '#10b981' : winRate >= 50 ? '#f59e0b' : '#f43f5e' },
    { label: 'Open Fees',     value: fmt$(openFees, 2),                  color: '#f59e0b'       },
    { label: 'Total Fees',    value: fmt$(totalFees, 2),                  color: 'var(--text-4)' },
  ]

  return (
    <div className="cc-summary-strip">
      {cards.map(c => (
        <div key={c.label} className="cc-summary-card">
          <div className="stat-label">{c.label}</div>
          <div className="stat-value cc-summary-value" style={{ color: c.color }}>{c.value}</div>
        </div>
      ))}
    </div>
  )
}

// ─── FY bar ───────────────────────────────────────────────────────────────────

function FYBar({ allPositions, selectedFY }: { allPositions: Position[]; selectedFY: number | 'all' }) {
  const fys = useMemo(() => Array.from(new Set(allPositions.map(p => getFY(p.dateOpen)))).sort((a, b) => b - a), [allPositions])
  const fyPnlMap = useMemo(() => {
    const m: Record<number, number> = {}
    for (const fy of fys) {
      const [from, to] = fyRange(fy)
      m[fy] = allPositions
        .filter(p => { const d = new Date(p.dateOpen); return d >= from && d <= to })
        .reduce((s, p) => s + (p.pnl ?? p.netPremium), 0)
    }
    return m
  }, [allPositions, fys])
  const max = Math.max(...Object.values(fyPnlMap).map(Math.abs), 1)
  if (fys.length < 2) return null

  return (
    <div className="cc-fy-bar">
      {fys.map(fy => {
        const net    = fyPnlMap[fy]
        const pct    = (Math.abs(net) / max) * 100
        const active = selectedFY === fy
        return (
          <div key={fy} className={`cc-fy-bar-item${active ? ' active' : ''}`}>
            <div className="cc-fy-bar-label">FY{fy}</div>
            <div className="cc-fy-bar-track">
              <div className="cc-fy-bar-fill" style={{ width: `${pct}%`, background: net >= 0 ? '#10b981' : '#f43f5e', opacity: active ? 1 : 0.45 }} />
            </div>
            <div className={`cc-fy-bar-val ${pnlCls(net)}`} style={{ opacity: active ? 1 : 0.6 }}>{fmt$(net, 0)}</div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Position table ───────────────────────────────────────────────────────────

const TH_OPEN  = { background: '#10b98112', color: '#10b981' }
const TH_CUR   = { background: '#f59e0b12', color: '#f59e0b' }
const TH_CLOSE = { background: '#3b82f612', color: '#3b82f6' }
const TH_PNL   = { background: '#8b5cf612', color: '#8b5cf6' }

function PositionTable({ positions, strategyId }: { positions: Position[]; strategyId: string }) {
  if (positions.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-5)', fontSize: 14 }}>
        No positions in this period
      </div>
    )
  }

  return (
    <div style={{ flex: 1, overflow: 'auto' }}>
      <table className="trade-table" style={{ fontSize: 12 }}>
        <thead>
          {/* Group headers */}
          <tr>
            <th colSpan={12} style={{ ...TH_OPEN, textAlign: 'center', letterSpacing: '0.1em', fontSize: 10, fontWeight: 700, padding: '4px 8px' }}>
              OPENING PARAMETERS
            </th>
            <th colSpan={2} style={{ ...TH_CUR, textAlign: 'center', letterSpacing: '0.1em', fontSize: 10, fontWeight: 700, padding: '4px 8px' }}>
              CURRENT
            </th>
            <th colSpan={4} style={{ ...TH_CLOSE, textAlign: 'center', letterSpacing: '0.1em', fontSize: 10, fontWeight: 700, padding: '4px 8px' }}>
              CLOSING PARAMETERS
            </th>
            <th style={{ ...TH_PNL, textAlign: 'center', letterSpacing: '0.1em', fontSize: 10, fontWeight: 700, padding: '4px 8px' }}>
              P&amp;L
            </th>
          </tr>
          {/* Column headers */}
          <tr>
            <th style={{ textAlign: 'center' }}>#</th>
            <th>Ticker</th>
            <th>Date Open</th>
            <th style={{ textAlign: 'center' }}>Strategy</th>
            <th style={{ textAlign: 'right' }}>C</th>
            <th style={{ textAlign: 'right' }}>Strike</th>
            <th>Expiry</th>
            <th style={{ textAlign: 'right' }}>Price</th>
            <th style={{ textAlign: 'right' }}>Open Fees</th>
            <th style={{ textAlign: 'right' }}>Premium Collected</th>
            <th style={{ textAlign: 'right' }}>Net Premium</th>
            <th style={{ textAlign: 'right' }}>BEP</th>
            <th style={{ textAlign: 'center' }}>Status</th>
            <th style={{ textAlign: 'right' }}>DTE</th>
            <th>Date Closed</th>
            <th style={{ textAlign: 'right' }}>Close Price</th>
            <th style={{ textAlign: 'right' }}>Close Fees</th>
            <th style={{ textAlign: 'right' }}>Closing Amt</th>
            <th style={{ textAlign: 'right' }}>Profit / Loss</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((p, i) => {
            const isExpired = p.status === 'Expired'
            const isClosed  = p.status === 'Closed'

            const statusEl = isExpired ? (
              <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px',
                color: 'var(--text-5)', background: 'var(--bg-3)', border: '1px solid var(--border)',
                letterSpacing: '0.06em' }}>
                Expired
              </span>
            ) : isClosed ? (
              <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px',
                color: '#f59e0b', background: '#f59e0b14', border: '1px solid #f59e0b33',
                letterSpacing: '0.06em' }}>
                Closed
              </span>
            ) : (
              <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px',
                color: '#10b981', background: '#10b98114', border: '1px solid #10b98133',
                letterSpacing: '0.06em' }}>
                Active
              </span>
            )

            return (
              <tr key={p.id}>
                <td className="mono" style={{ textAlign: 'center', color: 'var(--text-5)', fontSize: 11 }}>{i + 1}</td>
                <td style={{ fontWeight: 700, fontFamily: 'IBM Plex Mono, monospace', color: 'var(--text-1)' }}>{p.underlying}</td>
                <td className="mono" style={{ color: 'var(--text-3)', whiteSpace: 'nowrap' }}>{fmtDate(p.dateOpen)}</td>
                <td style={{ textAlign: 'center' }}>
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px',
                    color: 'var(--text-3)', background: 'var(--bg-3)', border: '1px solid var(--border)',
                    letterSpacing: '0.06em' }}>
                    {strategyId}
                  </span>
                </td>
                <td className="mono" style={{ textAlign: 'right', color: 'var(--text-2)', fontWeight: 600 }}>{p.contracts}</td>
                <td className="mono" style={{ textAlign: 'right', fontWeight: 700, color: 'var(--text-1)' }}>{p.strikeDisplay}</td>
                <td className="mono" style={{ color: 'var(--text-3)', whiteSpace: 'nowrap' }}>{fmtExpiry(p.expiry)}</td>
                <td className="mono" style={{ textAlign: 'right', color: '#10b981', whiteSpace: 'nowrap' }}>${p.openPrice.toFixed(2)}</td>
                <td className="mono" style={{ textAlign: 'right', color: '#f59e0b', whiteSpace: 'nowrap' }}>{fmt$(p.openFees, 2)}</td>
                <td className="mono pos" style={{ textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap' }}>{fmt$(p.premiumCollected, 2)}</td>
                <td className={`mono ${pnlCls(p.netPremium)}`} style={{ textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' }}>{fmt$(p.netPremium, 2)}</td>
                <td className="mono" style={{ textAlign: 'right', color: 'var(--text-3)', whiteSpace: 'nowrap' }}>{p.bep ? `$${p.bep.toFixed(2)}` : '—'}</td>
                <td style={{ textAlign: 'center' }}>{statusEl}</td>
                <td className="mono" style={{ textAlign: 'right',
                  color: (p.currentDTE ?? 99) <= 7 ? '#f43f5e' : (p.currentDTE ?? 99) <= 21 ? '#f59e0b' : 'var(--text-3)',
                  fontWeight: (p.currentDTE ?? 99) <= 21 ? 700 : 400 }}>
                  {p.currentDTE ?? '—'}
                </td>
                <td className="mono" style={{ color: 'var(--text-3)', whiteSpace: 'nowrap' }}>{p.dateClosed ? fmtDate(p.dateClosed) : '—'}</td>
                <td className="mono" style={{ textAlign: 'right', color: 'var(--text-3)', whiteSpace: 'nowrap' }}>{p.closePrice != null ? `$${p.closePrice.toFixed(2)}` : '—'}</td>
                <td className="mono" style={{ textAlign: 'right', color: '#f59e0b', whiteSpace: 'nowrap' }}>{p.closeFees != null ? fmt$(p.closeFees, 2) : '—'}</td>
                <td className="mono" style={{ textAlign: 'right', color: 'var(--text-3)', whiteSpace: 'nowrap' }}>{p.closingAmount != null ? fmt$(p.closingAmount, 2) : '—'}</td>
                <td className={`mono ${p.pnl != null ? pnlCls(p.pnl) : ''}`} style={{ textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' }}>
                  {p.pnl != null ? fmt$(p.pnl, 2) : '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function StrategyTradeLog({ state, config }: Props) {
  const [selectedFY, setSelectedFY] = useState<number | 'all'>('all')
  const [sort, setSort] = useState<SortKey>('date_desc')

  const allTrades = useMemo(() => state.sync.trades.filter(config.filter), [state.sync.trades, config.filter])

  const allPositions = useMemo(() => buildPositions(allTrades), [allTrades])

  const availableFYs = useMemo(
    () => Array.from(new Set(allPositions.map(p => getFY(p.dateOpen)))).sort((a, b) => b - a),
    [allPositions]
  )

  const filtered = useMemo(() => {
    if (selectedFY === 'all') return allPositions
    const [from, to] = fyRange(selectedFY)
    return allPositions.filter(p => { const d = new Date(p.dateOpen); return d >= from && d <= to })
  }, [allPositions, selectedFY])

  const sorted = useMemo(() => {
    const arr = [...filtered]
    switch (sort) {
      case 'date_desc':  return arr.sort((a, b) => b.dateOpen.localeCompare(a.dateOpen))
      case 'date_asc':   return arr.sort((a, b) => a.dateOpen.localeCompare(b.dateOpen))
      case 'pnl_desc':   return arr.sort((a, b) => (b.pnl ?? b.netPremium) - (a.pnl ?? a.netPremium))
      case 'pnl_asc':    return arr.sort((a, b) => (a.pnl ?? a.netPremium) - (b.pnl ?? b.netPremium))
      case 'underlying': return arr.sort((a, b) => a.underlying.localeCompare(b.underlying))
    }
  }, [filtered, sort])

  return (
    <div className="cc-root">
      {/* Header */}
      <div className="cc-header">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="cc-title-badge" style={{ color: config.color, background: `${config.color}14`, border: `1px solid ${config.color}33` }}>{config.id}</span>
            <h2 className="cc-title">{config.label}</h2>
          </div>
          <div className="cc-subtitle">{config.description}</div>
        </div>
        <div className="cc-controls">
          <div className="cc-control-group">
            <label className="cc-control-label">Financial Year</label>
            <select className="cc-select" value={selectedFY} onChange={e => setSelectedFY(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
              <option value="all">All Time ({allPositions.length} positions)</option>
              {availableFYs.map(fy => {
                const [from, to] = fyRange(fy)
                const count = allPositions.filter(p => { const d = new Date(p.dateOpen); return d >= from && d <= to }).length
                return <option key={fy} value={fy}>{fyLabel(fy)} — {count} position{count !== 1 ? 's' : ''}</option>
              })}
            </select>
          </div>
          <div className="cc-control-group">
            <label className="cc-control-label">Sort by</label>
            <select className="cc-select" value={sort} onChange={e => setSort(e.target.value as SortKey)}>
              {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>
      </div>

      <SummaryStrip positions={filtered} />

      {availableFYs.length > 1 && (
        <div className="cc-section">
          <div className="cc-section-title">Performance by Financial Year</div>
          <FYBar allPositions={allPositions} selectedFY={selectedFY} />
        </div>
      )}

      <div className="cc-section cc-table-section">
        <div className="cc-section-title" style={{ marginBottom: 0 }}>
          Trade Log
          <span style={{ marginLeft: 8, fontWeight: 400, color: 'var(--text-4)' }}>
            {sorted.length} position{sorted.length !== 1 ? 's' : ''}
            {selectedFY !== 'all' ? ` · ${fyLabel(selectedFY as number)}` : ''}
          </span>
        </div>
        <PositionTable positions={sorted} strategyId={config.id} />
      </div>
    </div>
  )
}
