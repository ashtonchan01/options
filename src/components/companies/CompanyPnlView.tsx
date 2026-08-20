/**
 * Company P&L — every underlying you've ever traded (stock or option), with
 * realized P&L (closed positions), unrealized P&L (current open
 * positions), and the combined total, sorted biggest winner to biggest
 * loser. Mirrors the "Realised & Unrealised Performance Summary" section of
 * an IBKR account statement, grouped by underlying instead of by
 * individual option contract.
 *
 * One of the two Reports sub-pages (the other is Monthly Income by
 * Strategy) — both live under ReportsView.tsx, which owns the shared FY
 * filter and sub-tab nav so the two pages can't drift onto different years.
 * Clicking a row expands it into every individual trade (stock or option)
 * tied to that ticker, same idea as the Journal's per-position "SHARES" row
 * expansion — so "how did this P&L number happen" is always one click away
 * instead of having to cross-reference the raw statement yourself.
 */
import { useMemo, useState } from 'react'
import type { AppState, RawTrade } from '../../types'
import type { TradeLabels } from '../../App'
import { buildJournalPositions, buildStockPositions } from '../../engine/journal'
import { fmtDollar, pnlColor, fyOf, currentFyKey, normalizeDateStr } from './reportsShared'

interface CompanyRow {
  symbol: string
  realized: number
  unrealized: number
  total: number
  closedTrades: number
  openPositions: number
}

type SortKey = 'total' | 'realized' | 'unrealized' | 'symbol'
type FyFilter = 'all' | string

function buildRows(
  positions: ReturnType<typeof buildJournalPositions>,
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

  const nowFy = currentFyKey()

  for (const p of positions) {
    if (p.status === 'Active') {
      if (fy === 'all' || fy === nowFy) get(p.underlying).openPositions++
      continue
    }
    if (p.pnl == null) continue
    const closedFy = p.dateClosed ? fyOf(p.dateClosed).key : nowFy
    if (fy !== 'all' && fy !== closedFy) continue
    const row = get(p.underlying)
    row.realized += p.pnl
    row.closedTrades++
  }

  if (fy === 'all' || fy === nowFy) {
    for (const pos of livePositions) {
      const symbol = pos.assetClass === 'STK' ? pos.symbol : (pos.underlyingSymbol ?? pos.symbol)
      get(symbol).unrealized += pos.unrealizedPnL
    }
  }

  for (const row of byCompany.values()) row.total = row.realized + row.unrealized
  return [...byCompany.values()]
}

function fmtTradeDate(s: string) {
  const d = normalizeDateStr(s)
  return /^\d{8}$/.test(d) ? `${d.slice(6, 8)}/${d.slice(4, 6)}/${d.slice(0, 4)}` : s
}

function tradeDescription(t: RawTrade): string {
  if (t.assetClass !== 'OPT') return t.symbol
  const expiry = t.expiry ? fmtTradeDate(t.expiry) : ''
  const strike = t.strike != null ? (t.strike % 1 === 0 ? t.strike.toLocaleString() : t.strike.toFixed(2)) : ''
  return `${t.underlyingSymbol ?? t.symbol} ${strike}${t.putCall ?? ''} ${expiry}`.trim()
}

/** Every raw trade (stock or option) tied to this ticker, oldest first —
 * matched by underlying symbol, not by which JournalPosition/lot it ended
 * up grouped into, since a company row can combine several lots/strategies
 * at once and this needs all of them. When a specific financial year is
 * selected, only that year's own trades show (approximated by trade date's
 * own FY, since a raw fill has no "close date" of its own — the row's P&L
 * itself is bucketed by each position's close date, which can differ
 * slightly from when the underlying trade happened for a position that
 * spans a FY boundary). */
function CompanyTradesTable({ symbol, trades, fy }: { symbol: string; trades: RawTrade[]; fy: FyFilter }) {
  const rows = useMemo(() => {
    return trades
      .filter(t => !t.isTransfer)
      .filter(t => t.assetClass === 'STK' ? t.symbol === symbol : (t.assetClass === 'OPT' ? (t.underlyingSymbol ?? t.symbol) === symbol : false))
      .filter(t => fy === 'all' || fyOf(t.tradeDate).key === fy)
      .sort((a, b) => a.tradeDate.localeCompare(b.tradeDate) || (a.tradeTime ?? '').localeCompare(b.tradeTime ?? ''))
  }, [trades, symbol, fy])

  if (rows.length === 0) {
    return <div style={{ padding: '14px 16px', color: 'var(--text-4)', fontSize: 12 }}>No trades found for {symbol} in this range.</div>
  }

  return (
    <div style={{ padding: '10px 16px', background: 'var(--bg-elevated)' }}>
      <table className="mono" style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ color: 'var(--text-4)', textAlign: 'left' }}>
            <th style={{ fontWeight: 500, padding: '3px 8px 3px 0' }}>Date</th>
            <th style={{ fontWeight: 500, padding: '3px 8px' }}>Description</th>
            <th style={{ fontWeight: 500, padding: '3px 8px' }}>Action</th>
            <th style={{ fontWeight: 500, padding: '3px 8px', textAlign: 'right' }}>Qty</th>
            <th style={{ fontWeight: 500, padding: '3px 8px', textAlign: 'right' }}>Price</th>
            <th style={{ fontWeight: 500, padding: '3px 8px', textAlign: 'right' }}>Net Cash</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t, i) => {
            const assigned = Math.abs(t.commissions ?? 0) < 0.005 && t.assetClass === 'STK'
            const action = t.assetClass === 'OPT'
              ? `${t.quantity > 0 ? 'Buy' : 'Sell'} ${t.openClose === 'C' ? 'to Close' : 'to Open'}`
              : `${t.quantity > 0 ? 'Buy' : 'Sell'}${assigned ? ' (assigned)' : ''}`
            return (
              <tr key={`${t.tradeDate}|${t.execId ?? i}`} style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ padding: '4px 8px 4px 0', color: 'var(--text-3)', whiteSpace: 'nowrap' }}>{fmtTradeDate(t.tradeDate)}</td>
                <td style={{ padding: '4px 8px', color: 'var(--text-2)', whiteSpace: 'nowrap' }}>{tradeDescription(t)}</td>
                <td style={{ padding: '4px 8px', color: t.quantity > 0 ? '#10b981' : '#ef4444', fontWeight: 600, whiteSpace: 'nowrap' }}>{action}</td>
                <td style={{ padding: '4px 8px', textAlign: 'right' }}>{Math.abs(t.quantity)}</td>
                <td style={{ padding: '4px 8px', textAlign: 'right' }}>{fmtDollar(t.tradePrice)}</td>
                <td style={{ padding: '4px 8px', textAlign: 'right', color: pnlColor(t.netCash), fontWeight: 600 }}>{fmtDollar(t.netCash)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default function CompanyPnlView({ state, tradeLabels, fy }: { state: AppState; tradeLabels?: TradeLabels; fy: FyFilter }) {
  const [sortKey, setSortKey] = useState<SortKey>('total')
  const [query, setQuery] = useState('')
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

  const filteredTotals = useMemo(() => filtered.reduce((acc, r) => ({
    realized: acc.realized + r.realized,
    unrealized: acc.unrealized + r.unrealized,
    total: acc.total + r.total,
    closedTrades: acc.closedTrades + r.closedTrades,
    openPositions: acc.openPositions + r.openPositions,
  }), { realized: 0, unrealized: 0, total: 0, closedTrades: 0, openPositions: 0 }), [filtered])

  const hasData = state.sync.trades.length > 0

  if (!hasData) {
    return (
      <div className="db-empty-msg" style={{ flex: 1 }}>
        No trade data — sync IBKR Flex or upload a statement to start tracking companies
      </div>
    )
  }

  const winners = filtered.filter(r => r.total > 0).length
  const losers = filtered.filter(r => r.total < 0).length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
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
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
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
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-4)' }}>Click a row to see its trades</span>
      </div>

      <div className="cc-section cc-table-section" style={{ flex: '0 0 auto', minHeight: 'auto' }}>
        <div className="cc-companies-table-scroll" style={{ overflow: 'auto' }}>
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
              {filtered.map(r => (
                <>
                  <tr
                    key={r.symbol}
                    onClick={() => setExpanded(expanded === r.symbol ? null : r.symbol)}
                    style={{ cursor: 'pointer' }}
                  >
                    <td className="mono" style={{ fontWeight: 700, color: 'var(--text-1)', whiteSpace: 'nowrap' }}>
                      <span style={{ display: 'inline-block', width: 12, color: 'var(--text-4)', transform: expanded === r.symbol ? 'rotate(90deg)' : 'none', transition: 'transform 0.1s' }}>▸</span>
                      {r.symbol}
                    </td>
                    <td className="mono" style={{ textAlign: 'right', color: pnlColor(r.realized), whiteSpace: 'nowrap' }}>{fmtDollar(r.realized)}</td>
                    <td className="mono" style={{ textAlign: 'right', color: pnlColor(r.unrealized), whiteSpace: 'nowrap' }}>{fmtDollar(r.unrealized)}</td>
                    <td className="mono" style={{ textAlign: 'right', fontWeight: 700, color: pnlColor(r.total), whiteSpace: 'nowrap' }}>{fmtDollar(r.total)}</td>
                    <td className="mono" style={{ textAlign: 'right', color: 'var(--text-3)', whiteSpace: 'nowrap' }}>{r.closedTrades}</td>
                    <td className="mono" style={{ textAlign: 'right', color: 'var(--text-3)', whiteSpace: 'nowrap' }}>{r.openPositions}</td>
                  </tr>
                  {expanded === r.symbol && (
                    <tr key={`${r.symbol}-detail`}>
                      <td colSpan={6} style={{ padding: 0 }}>
                        <CompanyTradesTable symbol={r.symbol} trades={state.sync.trades} fy={fy} />
                      </td>
                    </tr>
                  )}
                </>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-5)', padding: 24 }}>No matches</td></tr>
              )}
            </tbody>
            {filtered.length > 0 && (
              <tfoot>
                <tr style={{ borderTop: '2px solid var(--border)' }}>
                  <td className="mono" style={{ fontWeight: 700, color: 'var(--text-1)', whiteSpace: 'nowrap' }}>Total</td>
                  <td className="mono" style={{ textAlign: 'right', fontWeight: 700, color: pnlColor(filteredTotals.realized), whiteSpace: 'nowrap' }}>{fmtDollar(filteredTotals.realized)}</td>
                  <td className="mono" style={{ textAlign: 'right', fontWeight: 700, color: pnlColor(filteredTotals.unrealized), whiteSpace: 'nowrap' }}>{fmtDollar(filteredTotals.unrealized)}</td>
                  <td className="mono" style={{ textAlign: 'right', fontWeight: 700, color: pnlColor(filteredTotals.total), whiteSpace: 'nowrap' }}>{fmtDollar(filteredTotals.total)}</td>
                  <td className="mono" style={{ textAlign: 'right', fontWeight: 700, color: 'var(--text-2)', whiteSpace: 'nowrap' }}>{filteredTotals.closedTrades}</td>
                  <td className="mono" style={{ textAlign: 'right', fontWeight: 700, color: 'var(--text-2)', whiteSpace: 'nowrap' }}>{filteredTotals.openPositions}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  )
}
