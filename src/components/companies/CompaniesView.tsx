/**
 * Companies tab — every underlying you've ever traded (stock or option),
 * with realized P&L (closed positions), unrealized P&L (current open
 * positions), and the combined total, sorted biggest winner to biggest
 * loser. Mirrors the "Realised & Unrealised Performance Summary" section
 * of an IBKR account statement, grouped by underlying instead of by
 * individual option contract.
 */
import { useMemo, useState } from 'react'
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

interface CompanyRow {
  symbol: string
  realized: number
  unrealized: number
  total: number
  closedTrades: number
  openPositions: number
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
      row = { symbol, realized: 0, unrealized: 0, total: 0, closedTrades: 0, openPositions: 0 }
      byCompany.set(symbol, row)
    }
    return row
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

export default function CompaniesView({ state, tradeLabels }: { state: AppState; tradeLabels?: TradeLabels }) {
  const [sortKey, setSortKey] = useState<SortKey>('total')
  const [query, setQuery] = useState('')
  const [fy, setFy] = useState<FyFilter>('all')

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
        <div style={{ overflow: 'auto' }}>
          <table className="trade-table" style={{ fontSize: 13 }}>
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
              {filtered.map(r => (
                <tr key={r.symbol}>
                  <td className="mono" style={{ fontWeight: 700, color: 'var(--text-1)' }}>{r.symbol}</td>
                  <td className="mono" style={{ textAlign: 'right', color: pnlColor(r.realized) }}>{fmtDollar(r.realized)}</td>
                  <td className="mono" style={{ textAlign: 'right', color: pnlColor(r.unrealized) }}>{fmtDollar(r.unrealized)}</td>
                  <td className="mono" style={{ textAlign: 'right', fontWeight: 700, color: pnlColor(r.total) }}>{fmtDollar(r.total)}</td>
                  <td className="mono" style={{ textAlign: 'right', color: 'var(--text-3)' }}>{r.closedTrades}</td>
                  <td className="mono" style={{ textAlign: 'right', color: 'var(--text-3)' }}>{r.openPositions}</td>
                </tr>
              ))}
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
