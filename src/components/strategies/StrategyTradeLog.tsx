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

function SummaryStrip({ trades, color }: { trades: RawTrade[]; color: string }) {
  const opens     = trades.filter(t => t.quantity < 0)
  const closes    = trades.filter(t => t.quantity > 0)
  const totalNet  = trades.reduce((s, t) => s + t.netCash, 0)
  const income    = trades.filter(t => t.netCash > 0).reduce((s, t) => s + t.netCash, 0)
  const winRate   = opens.length ? (opens.filter(t => t.netCash > 0).length / opens.length) * 100 : 0
  const avgPrem   = opens.length ? income / opens.length : 0
  const totalComm = trades.reduce((s, t) => s + Math.abs(t.commissions ?? 0), 0)

  const cards = [
    { label: 'Total Trades',    value: String(trades.length),          color: 'var(--text-1)' },
    { label: 'Opens (Sold)',    value: String(opens.length),            color: 'var(--text-1)' },
    { label: 'Closes (Bought)', value: String(closes.length),          color: 'var(--text-1)' },
    { label: 'Total Income',    value: fmt$(income, 0),                 color: '#10b981'       },
    { label: 'Net Cash',        value: fmt$(totalNet, 0),               color: totalNet >= 0 ? '#10b981' : '#f43f5e' },
    { label: 'Win Rate',        value: opens.length ? `${winRate.toFixed(0)}%` : '—', color: winRate >= 70 ? '#10b981' : winRate >= 50 ? '#f59e0b' : '#f43f5e' },
    { label: 'Avg Premium',     value: opens.length ? fmt$(avgPrem, 0) : '—', color },
    { label: 'Commissions',     value: fmt$(totalComm, 2),              color: '#f59e0b'       },
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

// ─── Trade table ──────────────────────────────────────────────────────────────

function TradeTable({ trades }: { trades: RawTrade[] }) {
  if (trades.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-5)', fontSize: 14 }}>
        No trades in this period
      </div>
    )
  }
  return (
    <div style={{ flex: 1, overflow: 'auto' }}>
      <table className="trade-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Underlying</th>
            <th>Symbol</th>
            <th>Type</th>
            <th style={{ textAlign: 'right' }}>Strike</th>
            <th>Expiry</th>
            <th style={{ textAlign: 'center' }}>O/C</th>
            <th style={{ textAlign: 'right' }}>Qty</th>
            <th style={{ textAlign: 'right' }}>Price</th>
            <th style={{ textAlign: 'right' }}>Commissions</th>
            <th style={{ textAlign: 'right' }}>Net Cash</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((t, i) => {
            const isOpen  = t.quantity < 0
            const ocColor = isOpen ? '#10b981' : '#f59e0b'
            const pcColor = t.putCall === 'C' ? '#3b82f6' : '#f43f5e'
            return (
              <tr key={i}>
                <td className="mono" style={{ color: 'var(--text-3)', whiteSpace: 'nowrap', fontSize: 12 }}>{fmtDate(t.tradeDate)}</td>
                <td style={{ fontWeight: 700, color: 'var(--text-1)', fontFamily: 'IBM Plex Mono, monospace' }}>{t.underlyingSymbol ?? '—'}</td>
                <td style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 11, color: 'var(--text-3)' }}>{t.symbol}</td>
                <td>
                  {t.putCall && (
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 5px', color: pcColor, background: `${pcColor}14`, border: `1px solid ${pcColor}30` }}>
                      {t.putCall === 'C' ? 'CALL' : 'PUT'}
                    </span>
                  )}
                  {!t.putCall && <span style={{ color: 'var(--text-4)', fontSize: 11 }}>{t.assetClass}</span>}
                </td>
                <td className="mono" style={{ textAlign: 'right', color: 'var(--text-2)' }}>{t.strike ? `$${t.strike.toLocaleString()}` : '—'}</td>
                <td className="mono" style={{ fontSize: 12, color: 'var(--text-3)' }}>{fmtExpiry(t.expiry ?? '')}</td>
                <td style={{ textAlign: 'center' }}>
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', color: ocColor, background: `${ocColor}14`, border: `1px solid ${ocColor}33`, letterSpacing: '0.06em' }}>
                    {isOpen ? 'OPEN' : 'CLOSE'}
                  </span>
                </td>
                <td className="mono" style={{ textAlign: 'right', color: t.quantity > 0 ? '#f43f5e' : '#10b981' }}>
                  {t.quantity > 0 ? '+' : ''}{t.quantity}
                </td>
                <td className="mono" style={{ textAlign: 'right', color: 'var(--text-2)' }}>{t.tradePrice != null ? `$${t.tradePrice.toFixed(2)}` : '—'}</td>
                <td className="mono" style={{ textAlign: 'right', color: '#f59e0b', fontSize: 12 }}>{t.commissions != null ? fmt$(t.commissions, 2) : '—'}</td>
                <td className={`mono ${pnlCls(t.netCash)}`} style={{ textAlign: 'right', fontWeight: 700 }}>{fmt$(t.netCash)}</td>
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
        <TradeTable trades={sorted} />
      </div>
    </div>
  )
}
