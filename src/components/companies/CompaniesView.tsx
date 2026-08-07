/**
 * Companies tab — every underlying you've ever traded (stock or option),
 * with realized P&L (closed positions), unrealized P&L (current open
 * positions), and the combined total, sorted biggest winner to biggest
 * loser. Mirrors the "Realized & Unrealized Performance Summary" section
 * of an IBKR account statement, grouped by underlying instead of by
 * individual option contract.
 */
import { useMemo, useState } from 'react'
import type { AppState } from '../../types'
import type { TradeLabels } from '../../App'
import { buildJournalPositions, buildStockPositions } from '../../engine/journal'

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

interface CompanyRow {
  symbol: string
  realized: number
  unrealized: number
  total: number
  closedTrades: number
  openPositions: number
}

type SortKey = 'total' | 'realized' | 'unrealized' | 'symbol'

export default function CompaniesView({ state, tradeLabels }: { state: AppState; tradeLabels?: TradeLabels }) {
  const [sortKey, setSortKey] = useState<SortKey>('total')
  const [query, setQuery] = useState('')

  const rows = useMemo(() => {
    const labels = tradeLabels?.labels ?? {}
    const positions = [
      ...buildJournalPositions(state.sync.trades, labels),
      ...buildStockPositions(state.sync.trades, labels),
    ]

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
      const row = get(p.underlying)
      if (p.status === 'Active') {
        row.openPositions++
      } else if (p.pnl != null) {
        row.realized += p.pnl
        row.closedTrades++
      }
    }

    // Unrealized P&L comes from current live positions (marked to market), not
    // the closed-position journal — an open CSP/covered-call/stock holding has
    // no realized pnl yet, but still needs to show its live gain/loss here.
    for (const pos of state.sync.positions) {
      const symbol = pos.assetClass === 'STK' ? pos.symbol : (pos.underlyingSymbol ?? pos.symbol)
      const row = get(symbol)
      row.unrealized += pos.unrealizedPnL
    }

    for (const row of byCompany.values()) row.total = row.realized + row.unrealized

    return [...byCompany.values()]
  }, [state.sync.trades, state.sync.positions, tradeLabels?.labels])

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
    <div className="jr-root" style={{ maxWidth: 1100, margin: '0 auto', width: '100%' }}>
      <div className="cc-section-title" style={{ padding: 0 }}>Companies</div>

      <div className="jr-mini-strip">
        <div className="jr-mini"><span className="label">Total P&amp;L</span><b style={{ color: pnlColor(grand.total) }}>{fmtDollar(grand.total)}</b></div>
        <div className="jr-mini"><span className="label">Realized</span><b style={{ color: pnlColor(grand.realized) }}>{fmtDollar(grand.realized)}</b></div>
        <div className="jr-mini"><span className="label">Unrealized</span><b style={{ color: pnlColor(grand.unrealized) }}>{fmtDollar(grand.unrealized)}</b></div>
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
              {k === 'total' ? 'Total P&L' : k === 'realized' ? 'Realized' : k === 'unrealized' ? 'Unrealized' : 'A–Z'}
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
                <th style={{ textAlign: 'right' }}>Realized</th>
                <th style={{ textAlign: 'right' }}>Unrealized</th>
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
