/**
 * Generic strategy trade log — reused by CSP, LEAP, SPX, and future pages.
 * Each strategy passes its own filter function and display config.
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

function isExpired(t: RawTrade): boolean {
  if (!t.expiry) return false
  const d = parseExpiry(t.expiry)
  return d !== null && d < TODAY
}

function pnlCls(n: number) { return n > 0 ? 'pos' : n < 0 ? 'neg' : 'neu' }

type SortKey = 'date_desc' | 'date_asc' | 'net_desc' | 'net_asc' | 'underlying'

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'date_desc',  label: 'Date — Newest first'  },
  { value: 'date_asc',   label: 'Date — Oldest first'  },
  { value: 'net_desc',   label: 'Net $ — Highest first' },
  { value: 'net_asc',    label: 'Net $ — Lowest first'  },
  { value: 'underlying', label: 'Underlying A–Z'        },
]

// ─── Summary strip ────────────────────────────────────────────────────────────

function SummaryStrip({ trades }: { trades: RawTrade[]; color?: string }) {
  // Active = trades whose expiry hasn't passed yet (or no expiry = stock/non-option)
  const active  = trades.filter(t => !isExpired(t))
  const expired = trades.filter(t => isExpired(t))

  // Open premium = net cash from sell legs (qty < 0) on active (non-expired) trades
  const openPrem   = active.filter(t => t.quantity < 0).reduce((s, t) => s + t.netCash, 0)

  // Realized P&L = net cash from all expired trades (what we kept / lost)
  const realized   = expired.reduce((s, t) => s + t.netCash, 0)

  // Total net cash across everything
  const totalNet   = trades.reduce((s, t) => s + t.netCash, 0)

  const sells      = trades.filter(t => t.quantity < 0)
  const winRate    = sells.length ? (sells.filter(t => t.netCash > 0).length / sells.length) * 100 : 0
  const openFees   = active.reduce((s, t) => s + Math.abs(t.commissions ?? 0), 0)
  const totalComm  = trades.reduce((s, t) => s + Math.abs(t.commissions ?? 0), 0)

  const cards = [
    { label: 'Total Trades',   value: String(trades.length),                color: 'var(--text-1)' },
    { label: 'Active',         value: String(active.length),                 color: '#10b981'       },
    { label: 'Expired',        value: String(expired.length),                color: 'var(--text-4)' },
    { label: 'Open Premium',   value: fmt$(openPrem, 0),                     color: openPrem >= 0 ? '#10b981' : '#f43f5e' },
    { label: 'Realized P&L',   value: fmt$(realized, 0),                     color: realized >= 0 ? '#10b981' : '#f43f5e' },
    { label: 'Net Cash',       value: fmt$(totalNet, 0),                     color: totalNet >= 0 ? '#10b981' : '#f43f5e' },
    { label: 'Win Rate',       value: sells.length ? `${winRate.toFixed(0)}%` : '—', color: winRate >= 70 ? '#10b981' : winRate >= 50 ? '#f59e0b' : '#f43f5e' },
    { label: 'Open Fees',      value: fmt$(openFees, 2),                     color: '#f59e0b'       },
    { label: 'Total Fees',     value: fmt$(totalComm, 2),                    color: 'var(--text-4)' },
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

function FYBar({ allTrades, selectedFY }: { allTrades: RawTrade[]; selectedFY: number | 'all' }) {
  const fys = useMemo(() => Array.from(new Set(allTrades.map(t => getFY(t.tradeDate)))).sort((a, b) => b - a), [allTrades])
  const fyNetMap = useMemo(() => {
    const m: Record<number, number> = {}
    for (const fy of fys) {
      const [from, to] = fyRange(fy)
      m[fy] = allTrades.filter(t => { const d = new Date(t.tradeDate); return d >= from && d <= to }).reduce((s, t) => s + t.netCash, 0)
    }
    return m
  }, [allTrades, fys])
  const max = Math.max(...Object.values(fyNetMap).map(Math.abs), 1)
  if (fys.length < 2) return null

  return (
    <div className="cc-fy-bar">
      {fys.map(fy => {
        const net = fyNetMap[fy]
        const pct = (Math.abs(net) / max) * 100
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

// ─── Spread grouping ──────────────────────────────────────────────────────────

interface SpreadRow {
  key: string
  tradeDate: string
  contracts: number
  strikes: string        // e.g. "7425/7400"
  expiry: string
  dteInitial: number
  dteCurrent: number
  pricePt: number        // net credit per contract (index points, not dollars)
  fees: number
  openingAmount: number  // net cash received (proceeds − fees)
  pnl: number            // same as openingAmount while open; differs when closed
  expired: boolean
  underlying: string
}

function msToDay(ms: number) { return Math.round(ms / 86_400_000) }

function groupIntoSpreads(trades: RawTrade[]): SpreadRow[] {
  // Group legs by (tradeDate, expiry) — same date + same expiry = one spread entry
  const map = new Map<string, RawTrade[]>()
  for (const t of trades) {
    const key = `${t.tradeDate}|${t.expiry ?? ''}|${t.underlyingSymbol ?? t.symbol}`
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(t)
  }

  const rows: SpreadRow[] = []
  for (const [key, legs] of map) {
    const expiry    = legs[0].expiry ?? ''
    const expiryDate = parseExpiry(expiry)
    const openDate  = new Date(legs[0].tradeDate)

    // contracts = abs quantity of the sell leg (qty < 0)
    const sellLegs  = legs.filter(l => l.quantity < 0)
    const contracts = sellLegs.length > 0 ? Math.abs(sellLegs[0].quantity) : Math.abs(legs[0].quantity)

    // strikes sorted descending → "7425/7400"
    const strikes = [...new Set(legs.map(l => l.strike).filter(Boolean) as number[])]
      .sort((a, b) => b - a)
      .join('/')

    // proceeds (before fees) = sum of all legs' proceeds
    const totalProceeds = legs.reduce((s, l) => s + l.proceeds, 0)
    const totalFees     = legs.reduce((s, l) => s + Math.abs(l.commissions ?? 0), 0)
    const openingAmount = legs.reduce((s, l) => s + l.netCash, 0) // proceeds already net of fees

    // price per contract in index points (proceeds / contracts / 100)
    const pricePt = contracts > 0 ? totalProceeds / contracts / 100 : 0

    const dteInitial = expiryDate ? msToDay(expiryDate.getTime() - openDate.getTime()) : 0
    const dteCurrent = expiryDate ? Math.max(0, msToDay(expiryDate.getTime() - TODAY.getTime())) : 0
    const expired    = expiryDate ? expiryDate < TODAY : false

    rows.push({
      key, tradeDate: legs[0].tradeDate, contracts, strikes, expiry,
      dteInitial, dteCurrent, pricePt, fees: totalFees,
      openingAmount, pnl: openingAmount,
      expired,
      underlying: legs[0].underlyingSymbol ?? legs[0].symbol,
    })
  }

  return rows.sort((a, b) => b.tradeDate.localeCompare(a.tradeDate))
}

// ─── Spread table ──────────────────────────────────────────────────────────────

function SpreadTable({ trades }: { trades: RawTrade[] }) {
  if (trades.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-5)', fontSize: 14 }}>
        No trades in this period
      </div>
    )
  }

  const rows = groupIntoSpreads(trades)

  return (
    <div style={{ flex: 1, overflow: 'auto' }}>
      <table className="trade-table">
        <thead>
          <tr>
            <th>Date Open</th>
            <th style={{ textAlign: 'right' }}>C</th>
            <th style={{ textAlign: 'right' }}>Strike Price</th>
            <th>Expiry Date</th>
            <th style={{ textAlign: 'right' }}>Initial DTE</th>
            <th style={{ textAlign: 'right' }}>Price (Premium)</th>
            <th style={{ textAlign: 'right' }}>Transaction Fees</th>
            <th style={{ textAlign: 'right' }}>Opening Amount</th>
            <th style={{ textAlign: 'center' }}>Position Status</th>
            <th style={{ textAlign: 'right' }}>DTE</th>
            <th style={{ textAlign: 'right' }}>Profit / Loss</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.key} style={r.expired ? { opacity: 0.38 } : undefined}>
              <td className="mono" style={{ color: 'var(--text-3)', whiteSpace: 'nowrap', fontSize: 12 }}>
                {fmtDate(r.tradeDate)}
              </td>
              <td className="mono" style={{ textAlign: 'right', color: 'var(--text-2)', fontWeight: 600 }}>
                {r.contracts}
              </td>
              <td className="mono" style={{ textAlign: 'right', fontWeight: 700, color: r.expired ? 'var(--text-4)' : 'var(--text-1)', letterSpacing: '0.02em' }}>
                {r.strikes || '—'}
              </td>
              <td className="mono" style={{ fontSize: 12, color: r.expired ? 'var(--text-5)' : 'var(--text-3)' }}>
                {fmtExpiry(r.expiry)}
              </td>
              <td className="mono" style={{ textAlign: 'right', color: 'var(--text-4)', fontSize: 12 }}>
                {r.dteInitial > 0 ? r.dteInitial : '—'}
              </td>
              <td className="mono" style={{ textAlign: 'right', color: r.pricePt >= 0 ? '#10b981' : '#f43f5e' }}>
                {r.pricePt !== 0 ? `$${r.pricePt.toFixed(2)}` : '—'}
              </td>
              <td className="mono" style={{ textAlign: 'right', color: '#f59e0b', fontSize: 12 }}>
                {fmt$(r.fees, 2)}
              </td>
              <td className="mono" style={{ textAlign: 'right', fontWeight: 600, color: r.openingAmount >= 0 ? '#10b981' : '#f43f5e' }}>
                {fmt$(r.openingAmount, 2)}
              </td>
              <td style={{ textAlign: 'center' }}>
                {r.expired ? (
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', color: 'var(--text-5)', background: 'var(--bg-2)', border: '1px solid var(--border)', letterSpacing: '0.06em' }}>
                    EXPIRED
                  </span>
                ) : (
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', color: '#10b981', background: '#10b98114', border: '1px solid #10b98133', letterSpacing: '0.06em' }}>
                    Open
                  </span>
                )}
              </td>
              <td className="mono" style={{ textAlign: 'right', color: r.dteCurrent <= 7 ? '#f59e0b' : 'var(--text-3)', fontWeight: r.dteCurrent <= 21 ? 600 : 400 }}>
                {r.expired ? '—' : r.dteCurrent}
              </td>
              <td className={`mono ${r.expired ? 'neu' : pnlCls(r.pnl)}`} style={{ textAlign: 'right', fontWeight: 700, color: r.expired ? 'var(--text-4)' : undefined }}>
                {fmt$(r.pnl, 2)}
              </td>
            </tr>
          ))}
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

  const availableFYs = useMemo(() => Array.from(new Set(allTrades.map(t => getFY(t.tradeDate)))).sort((a, b) => b - a), [allTrades])

  const filtered = useMemo(() => {
    if (selectedFY === 'all') return allTrades
    const [from, to] = fyRange(selectedFY)
    return allTrades.filter(t => { const d = new Date(t.tradeDate); return d >= from && d <= to })
  }, [allTrades, selectedFY])

  const sorted = useMemo(() => {
    const arr = [...filtered]
    switch (sort) {
      case 'date_desc':  return arr.sort((a, b) => b.tradeDate.localeCompare(a.tradeDate))
      case 'date_asc':   return arr.sort((a, b) => a.tradeDate.localeCompare(b.tradeDate))
      case 'net_desc':   return arr.sort((a, b) => b.netCash - a.netCash)
      case 'net_asc':    return arr.sort((a, b) => a.netCash - b.netCash)
      case 'underlying': return arr.sort((a, b) => (a.underlyingSymbol ?? a.symbol).localeCompare(b.underlyingSymbol ?? b.symbol))
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
              <option value="all">All Time ({allTrades.length} trades)</option>
              {availableFYs.map(fy => {
                const [from, to] = fyRange(fy)
                const count = allTrades.filter(t => { const d = new Date(t.tradeDate); return d >= from && d <= to }).length
                return <option key={fy} value={fy}>{fyLabel(fy)} — {count} trade{count !== 1 ? 's' : ''}</option>
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

      <SummaryStrip trades={filtered} color={config.color} />

      {availableFYs.length > 1 && (
        <div className="cc-section">
          <div className="cc-section-title">Performance by Financial Year</div>
          <FYBar allTrades={allTrades} selectedFY={selectedFY} />
        </div>
      )}

      <div className="cc-section cc-table-section">
        <div className="cc-section-title" style={{ marginBottom: 0 }}>
          Trade Log
          <span style={{ marginLeft: 8, fontWeight: 400, color: 'var(--text-4)' }}>
            {sorted.length} record{sorted.length !== 1 ? 's' : ''}
            {selectedFY !== 'all' ? ` · ${fyLabel(selectedFY as number)}` : ''}
          </span>
        </div>
        <SpreadTable trades={sorted} />
      </div>
    </div>
  )
}
