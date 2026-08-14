/**
 * Companies tab — every underlying you've ever traded (stock or option),
 * with realized P&L (closed positions), unrealized P&L (current open
 * positions), and the combined total, sorted biggest winner to biggest
 * loser. Mirrors the "Realised & Unrealised Performance Summary" section
 * of an IBKR account statement, grouped by underlying instead of by
 * individual option contract.
 */
import { Fragment, useMemo, useState } from 'react'
import type { AppState } from '../../types'
import type { TradeLabels } from '../../App'
import { buildJournalPositions, buildStockPositions, type JournalPosition } from '../../engine/journal'

function fmt(n: number, digits = 0): string {
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (abs >= 1_000)     return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}
function fmtDollar(n: number): string {
  const sign = n < 0 ? '-' : ''
  return `${sign}$${fmt(Math.abs(n))}`
}
function pnlColor(n: number) { return n > 0 ? '#10b981' : n < 0 ? '#ef4444' : 'var(--text-4)' }

/** IBKR dates come as raw "YYYYMMDD" (no dashes) — plain string comparison against
 * another YYYYMMDD string sorts correctly without needing to parse a Date at all. */
function normalizeDateStr(s: string): string {
  return /^\d{8}$/.test(s) ? s : s.replace(/-/g, '')
}

// Australian financial year: FY2025/26 runs to 30 June 2026; FY2026/27 starts 1 July 2026.
const FY_CUTOFF = '20260701'

interface MonthRow {
  month: string // "YYYY-MM"
  realized: number
  closedTrades: number
}

interface CompanyRow {
  symbol: string
  realized: number
  unrealized: number
  total: number
  closedTrades: number
  openPositions: number
  monthly: Map<string, MonthRow>
}

function monthKey(dateStr: string): string {
  const d = normalizeDateStr(dateStr)
  return `${d.slice(0, 4)}-${d.slice(4, 6)}`
}

type SortKey = 'total' | 'realized' | 'unrealized' | 'symbol'
type FyFilter = 'all' | 'fy2526' | 'fy2627'

function buildRows(
  positions: JournalPosition[],
  livePositions: AppState['sync']['positions'],
  fy: FyFilter,
) {
  const byCompany = new Map<string, CompanyRow>()
  const get = (symbol: string) => {
    let row = byCompany.get(symbol)
    if (!row) {
      row = { symbol, realized: 0, unrealized: 0, total: 0, closedTrades: 0, openPositions: 0, monthly: new Map() }
      byCompany.set(symbol, row)
    }
    return row
  }
  const getMonth = (row: CompanyRow, month: string) => {
    let m = row.monthly.get(month)
    if (!m) { m = { month, realized: 0, closedTrades: 0 }; row.monthly.set(month, m) }
    return m
  }

  for (const p of positions) {
    if (p.status === 'Active') {
      if (fy === 'all' || fy === 'fy2627') get(p.underlying).openPositions++
      continue
    }
    if (p.pnl == null) continue
    const closedFy: FyFilter = p.dateClosed && normalizeDateStr(p.dateClosed) >= FY_CUTOFF ? 'fy2627' : 'fy2526'
    if (fy !== 'all' && fy !== closedFy) continue
    const row = get(p.underlying)
    row.realized += p.pnl
    row.closedTrades++
    if (p.dateClosed) {
      const m = getMonth(row, monthKey(p.dateClosed))
      m.realized += p.pnl
      m.closedTrades++
    }
  }

  // Unrealized P&L is a live mark-to-market snapshot of currently open positions —
  // it has no realization date, so it only belongs to "now" (All / current FY),
  // never to the closed-out prior financial year.
  if (fy === 'all' || fy === 'fy2627') {
    for (const pos of livePositions) {
      const symbol = pos.assetClass === 'STK' ? pos.symbol : (pos.underlyingSymbol ?? pos.symbol)
      get(symbol).unrealized += pos.unrealizedPnL
    }
  }

  for (const row of byCompany.values()) row.total = row.realized + row.unrealized
  return [...byCompany.values()]
}

function fmtMonth(m: string): string {
  const [y, mo] = m.split('-')
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${MONTHS[parseInt(mo, 10) - 1] ?? mo} ${y}`
}

export default function CompaniesView({ state, tradeLabels }: { state: AppState; tradeLabels?: TradeLabels }) {
  const [sortKey, setSortKey] = useState<SortKey>('total')
  const [query, setQuery] = useState('')
  const [fy, setFy] = useState<FyFilter>('all')
  const [expanded, setExpanded] = useState<string | null>(null)

  const positions = useMemo(() => {
    const labels = tradeLabels?.labels ?? {}
    return [
      ...buildJournalPositions(state.sync.trades, labels),
      ...buildStockPositions(state.sync.trades, labels),
    ]
  }, [state.sync.trades, tradeLabels?.labels])

  const rows = useMemo(
    () => buildRows(positions, state.sync.positions, fy),
    [positions, state.sync.positions, fy],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toUpperCase()
    const list = q ? rows.filter(r => r.symbol.includes(q)) : rows
    return [...list].sort((a, b) => {
      if (sortKey === 'symbol') return a.symbol.localeCompare(b.symbol)
      return b[sortKey] - a[sortKey]
    })
  }, [rows, query, sortKey])

  const grand = useMemo(() => rows.reduce((acc, r) => ({
    realized: acc.realized + r.realized,
    unrealized: acc.unrealized + r.unrealized,
    total: acc.total + r.total,
  }), { realized: 0, unrealized: 0, total: 0 }), [rows])

  const hasData = state.sync.trades.length > 0

  if (!hasData) {
    return (
      <div className="db-empty-msg" style={{ flex: 1 }}>
        No trade data — sync IBKR Flex or upload an XML to start tracking companies
      </div>
    )
  }

  const winners = filtered.filter(r => r.total > 0).length
  const losers  = filtered.filter(r => r.total < 0).length

  return (
    <div className="jr-root">
      <div className="cc-section-title" style={{ padding: 0 }}>Companies</div>

      <div style={{ display: 'flex', gap: 4 }}>
        {([
          ['all', 'All Time'],
          ['fy2526', 'FY 2025/26 (to 30 Jun 2026)'],
          ['fy2627', 'FY 2026/27 (from 1 Jul 2026)'],
        ] as [FyFilter, string][]).map(([id, label]) => (
          <button
            key={id}
            className={`tl-filter-chip${fy === id ? ' active' : ''}`}
            onClick={() => setFy(id)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="jr-mini-strip">
        <div className="jr-mini"><span className="label">Total P&amp;L</span><b style={{ color: pnlColor(grand.total) }}>{fmtDollar(grand.total)}</b></div>
        <div className="jr-mini"><span className="label">Realised</span><b style={{ color: pnlColor(grand.realized) }}>{fmtDollar(grand.realized)}</b></div>
        <div className="jr-mini"><span className="label">Unrealised</span><b style={{ color: pnlColor(grand.unrealized) }}>{fmtDollar(grand.unrealized)}</b></div>
        <div className="jr-mini"><span className="label">Winners</span><b style={{ color: '#10b981' }}>{winners}</b></div>
        <div className="jr-mini"><span className="label">Losers</span><b style={{ color: '#ef4444' }}>{losers}</b></div>
      </div>

      <div className="cc-controls" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          className="cc-select"
          placeholder="Filter ticker…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          style={{ minWidth: 160 }}
        />
        <div style={{ display: 'flex', gap: 4 }}>
          {(['total', 'realized', 'unrealized', 'symbol'] as SortKey[]).map(k => (
            <button
              key={k}
              className={`tl-filter-chip${sortKey === k ? ' active' : ''}`}
              onClick={() => setSortKey(k)}
            >
              {k === 'total' ? 'Total P&L' : k === 'realized' ? 'Realised' : k === 'unrealized' ? 'Unrealised' : 'A–Z'}
            </button>
          ))}
        </div>
      </div>

      <div className="cc-section cc-table-section" style={{ flexShrink: 1 }}>
        <div className="jr-trade-table-scroll" style={{ overflow: 'auto' }}>
          <table className="trade-table jr-companies-table" style={{ fontSize: 13 }}>
            <thead>
              <tr>
                <th>Company</th>
                <th style={{ textAlign: 'right' }}>Realised</th>
                <th style={{ textAlign: 'right' }}>Unrealised</th>
                <th style={{ textAlign: 'right' }}>Total P&amp;L</th>
                <th style={{ textAlign: 'right' }}>Closed Trades</th>
                <th style={{ textAlign: 'right' }}>Open</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => {
                const isOpen = expanded === r.symbol
                const months = [...r.monthly.values()].sort((a, b) => a.month.localeCompare(b.month))
                return (
                  <Fragment key={r.symbol}>
                    <tr onClick={() => setExpanded(isOpen ? null : r.symbol)}
                      style={{ cursor: months.length > 0 ? 'pointer' : 'default', background: isOpen ? 'rgba(16,185,129,0.05)' : undefined }}>
                      <td className="mono" style={{ fontWeight: 700, color: 'var(--text-1)' }}>
                        {months.length > 0 && <span style={{ display: 'inline-block', width: 14, color: 'var(--text-4)', fontSize: 10 }}>{isOpen ? '▾' : '▸'}</span>}
                        {r.symbol}
                      </td>
                      <td className="mono" style={{ textAlign: 'right', color: pnlColor(r.realized) }}>{fmtDollar(r.realized)}</td>
                      <td className="mono" style={{ textAlign: 'right', color: pnlColor(r.unrealized) }}>{fmtDollar(r.unrealized)}</td>
                      <td className="mono" style={{ textAlign: 'right', fontWeight: 700, color: pnlColor(r.total) }}>{fmtDollar(r.total)}</td>
                      <td className="mono" style={{ textAlign: 'right', color: 'var(--text-3)' }}>{r.closedTrades}</td>
                      <td className="mono" style={{ textAlign: 'right', color: 'var(--text-3)' }}>{r.openPositions}</td>
                    </tr>
                    {isOpen && months.length > 0 && (
                      <tr key={`${r.symbol}-detail`}>
                        <td colSpan={6} style={{ padding: 0, background: 'rgba(16,185,129,0.03)' }}>
                          <table className="mono" style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                            <thead>
                              <tr style={{ color: 'var(--text-4)' }}>
                                <th style={{ textAlign: 'left', fontWeight: 500, padding: '4px 12px 4px 34px' }}>Month</th>
                                <th style={{ textAlign: 'right', fontWeight: 500, padding: '4px 12px' }}>Realised P&amp;L</th>
                                <th style={{ textAlign: 'right', fontWeight: 500, padding: '4px 12px' }}>Closed Trades</th>
                              </tr>
                            </thead>
                            <tbody>
                              {months.map(m => (
                                <tr key={m.month} style={{ borderTop: '1px solid var(--border-light)' }}>
                                  <td style={{ padding: '4px 12px 4px 34px', color: 'var(--text-2)' }}>{fmtMonth(m.month)}</td>
                                  <td style={{ padding: '4px 12px', textAlign: 'right', color: pnlColor(m.realized), fontWeight: 600 }}>{fmtDollar(m.realized)}</td>
                                  <td style={{ padding: '4px 12px', textAlign: 'right', color: 'var(--text-3)' }}>{m.closedTrades}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-5)', padding: 24 }}>No matches</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
