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

function fmtDollar(n: number): string {
  const sign = n < 0 ? '-' : ''
  return `${sign}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function pnlColor(n: number) { return n > 0 ? '#10b981' : n < 0 ? '#ef4444' : 'var(--text-4)' }

/** IBKR dates come as raw "YYYYMMDD" (no dashes) — plain string comparison against
 * another YYYYMMDD string sorts correctly without needing to parse a Date at all. */
function normalizeDateStr(s: string): string {
  return /^\d{8}$/.test(s) ? s : s.replace(/-/g, '')
}

/** Australian financial year (1 Jul – 30 Jun) that a YYYYMMDD date falls in,
 * keyed by its starting calendar year (e.g. 1 Jul 2025 – 30 Jun 2026 is
 * "fy2526", key "2025"). Computed from the actual dates present in the data
 * rather than a hardcoded pair, so older financial years automatically get
 * their own tab instead of being silently folded into "All Time". */
function fyOf(dateStr: string): { key: string; label: string; startYear: number } {
  const d = normalizeDateStr(dateStr)
  const year = parseInt(d.slice(0, 4), 10)
  const month = parseInt(d.slice(4, 6), 10)
  const startYear = month >= 7 ? year : year - 1
  const key = String(startYear)
  const label = `FY ${startYear}/${String((startYear + 1) % 100).padStart(2, '0')}`
  return { key, label, startYear }
}

function currentFyKey(): string {
  const now = new Date()
  return fyOf(`${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`).key
}

const STRAT_ORDER = [
  'shares', 'leap', 'put_spread', 'spx', 'csp', 'covered_calls',
  'rotation', 'ptos', 'dcas', 'profit_taking', 'lilo', 'arb_cloud', 'tabi', 'forex', 'assignment',
]
const STRAT_LABEL: Record<string, string> = {
  shares: 'Shares', leap: 'LEAP', put_spread: 'BPS', spx: 'SPX', csp: 'CSP', covered_calls: 'CC',
  rotation: 'Rotation', ptos: 'PTOS', dcas: 'DCAs', profit_taking: 'PT', lilo: 'LILO',
  arb_cloud: 'Arb Cloud', tabi: 'TABI', forex: 'FX', assignment: 'Assignment', unlabelled: 'Unlabelled',
}
function stratLabel(s: string) { return STRAT_LABEL[s] ?? s }
function stratRank(s: string) {
  const i = STRAT_ORDER.indexOf(s)
  return i === -1 ? STRAT_ORDER.length : i
}
function monthKey(dateStr: string): string {
  const d = normalizeDateStr(dateStr)
  return `${d.slice(0, 4)}-${d.slice(4, 6)}`
}
function fmtMonth(m: string): string {
  const [y, mo] = m.split('-')
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${MONTHS[parseInt(mo, 10) - 1] ?? mo} ${y}`
}

/** Monthly realized income (closed-position P&L) split by strategy — a
 * separate table from the per-company breakdown above, since "which
 * strategy is actually making money, month to month" is a different
 * question than "which ticker." Unrealized P&L is excluded entirely (no
 * realization date to put in a month). Always split into one block per
 * financial year (mirrors the FY-by-FY layout of a manual tracking
 * spreadsheet) — the top FY filter just controls which block(s) show. */
function buildMonthlyStrategyByFy(positions: JournalPosition[], fy: FyFilter) {
  const buckets = new Map<string, { label: string; startYear: number; byMonth: Map<string, Map<string, number>>; strategies: Set<string> }>()

  for (const p of positions) {
    if (p.status === 'Active' || p.pnl == null || !p.dateClosed) continue
    const closedFy = fyOf(p.dateClosed)
    if (fy !== 'all' && fy !== closedFy.key) continue
    if (!buckets.has(closedFy.key)) buckets.set(closedFy.key, { label: closedFy.label, startYear: closedFy.startYear, byMonth: new Map(), strategies: new Set() })
    const bucket = buckets.get(closedFy.key)!
    const strategy = p.strategy ?? 'unlabelled'
    const month = monthKey(p.dateClosed)
    bucket.strategies.add(strategy)
    if (!bucket.byMonth.has(month)) bucket.byMonth.set(month, new Map())
    const row = bucket.byMonth.get(month)!
    row.set(strategy, (row.get(strategy) ?? 0) + p.pnl)
  }

  return [...buckets.entries()]
    .sort((a, b) => a[1].startYear - b[1].startYear)
    .map(([key, bucket]) => ({
      fy: key,
      label: bucket.label,
      months: [...bucket.byMonth.keys()].sort(),
      strategyList: [...bucket.strategies].sort((a, b) => stratRank(a) - stratRank(b)),
      byMonth: bucket.byMonth,
    }))
    .filter(b => b.months.length > 0)
}

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

  // Unrealized P&L is a live mark-to-market snapshot of currently open positions —
  // it has no realization date, so it only belongs to "now" (All / current FY),
  // never to a closed-out prior financial year.
  if (fy === 'all' || fy === nowFy) {
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

  const nowFy = currentFyKey()

  // Every financial year actually present in the data (closed trades by
  // close date, plus the current FY whenever there's an open position) —
  // so older years get their own tab instead of being silently folded into
  // "All Time" with no way to isolate them.
  const fyTabs = useMemo(() => {
    const seen = new Map<string, { label: string; startYear: number }>()
    for (const p of positions) {
      if (p.status === 'Active') {
        if (!seen.has(nowFy)) seen.set(nowFy, fyOf(`${nowFy}0701`))
        continue
      }
      if (p.pnl == null || !p.dateClosed) continue
      const f = fyOf(p.dateClosed)
      if (!seen.has(f.key)) seen.set(f.key, f)
    }
    return [...seen.entries()].sort((a, b) => a[1].startYear - b[1].startYear)
  }, [positions, nowFy])

  const rows = useMemo(
    () => buildRows(positions, state.sync.positions, fy),
    [positions, state.sync.positions, fy],
  )

  const monthlyStrategyBlocks = useMemo(() => buildMonthlyStrategyByFy(positions, fy), [positions, fy])

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

  // Table footer sums the currently filtered/searched rows, not the FY-wide
  // grand total above — so it stays correct when the ticker filter narrows
  // what's actually shown in the table.
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
        No trade data — sync IBKR Flex or upload an XML to start tracking companies
      </div>
    )
  }

  const winners = filtered.filter(r => r.total > 0).length
  const losers  = filtered.filter(r => r.total < 0).length

  return (
    <div className="jr-root">
      <div className="tl-filter-row" style={{ gap: 4 }}>
        <button
          className={`tl-filter-chip${fy === 'all' ? ' active' : ''}`}
          onClick={() => setFy('all')}
        >
          All Time
        </button>
        {fyTabs.map(([key, { label, startYear }]) => (
          <button
            key={key}
            className={`tl-filter-chip${fy === key ? ' active' : ''}`}
            onClick={() => setFy(key)}
            title={`1 Jul ${startYear} – 30 Jun ${startYear + 1}`}
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
      </div>

      {/* flex:'0 0 auto' (not flex:1) — this table now has the Monthly
          Income blocks stacked below it, which also need real space. A
          flex:1/min-height:0 item shrinks below its own content height
          whenever siblings need room too (flexbox satisfies the fixed
          .jr-root height by shrinking flexible children before it lets the
          container scroll) — sizing to natural content here and letting
          .jr-root's own overflow-y:auto handle the whole page's scroll is
          what actually keeps every section fully visible. */}
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
                <tr key={r.symbol}>
                  <td className="mono" style={{ fontWeight: 700, color: 'var(--text-1)', whiteSpace: 'nowrap' }}>{r.symbol}</td>
                  <td className="mono" style={{ textAlign: 'right', color: pnlColor(r.realized), whiteSpace: 'nowrap' }}>{fmtDollar(r.realized)}</td>
                  <td className="mono" style={{ textAlign: 'right', color: pnlColor(r.unrealized), whiteSpace: 'nowrap' }}>{fmtDollar(r.unrealized)}</td>
                  <td className="mono" style={{ textAlign: 'right', fontWeight: 700, color: pnlColor(r.total), whiteSpace: 'nowrap' }}>{fmtDollar(r.total)}</td>
                  <td className="mono" style={{ textAlign: 'right', color: 'var(--text-3)', whiteSpace: 'nowrap' }}>{r.closedTrades}</td>
                  <td className="mono" style={{ textAlign: 'right', color: 'var(--text-3)', whiteSpace: 'nowrap' }}>{r.openPositions}</td>
                </tr>
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

      <div
        className="cc-section-title"
        style={{ padding: 0, marginTop: 4, cursor: 'help', width: 'fit-content' }}
        title="Realized P&L by close date — each closed position's full gain/loss is attributed to the month it closed, not the month(s) it was opened or traded in. This is NOT the same as the Calendar page's monthly total, which is cash flow by trade date, so the two won't match for the same month."
      >
        Monthly Income by Strategy
      </div>

      {monthlyStrategyBlocks.length === 0 && (
        <div className="cc-section cc-table-section" style={{ flexShrink: 1, padding: 24, textAlign: 'center', color: 'var(--text-5)' }}>
          No closed trades in this range
        </div>
      )}

      {monthlyStrategyBlocks.map(block => {
        const monthTotal = (m: string) => [...block.byMonth.get(m)!.values()].reduce((s, v) => s + v, 0)
        const stratTotal = (s: string) => block.months.reduce((sum, m) => sum + (block.byMonth.get(m)!.get(s) ?? 0), 0)
        const grandTotal = block.months.reduce((sum, m) => sum + monthTotal(m), 0)
        return (
          <div key={block.fy}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.05em', margin: '2px 0' }}>
              {block.label.toUpperCase()}
            </div>
            {/* flex:'0 0 auto' (not the inherited flex:1) — these FY blocks
                must size to their own content, not compete with the
                companies table above for the fixed .jr-root column's
                growable space. Three flex:1 siblings splitting one fixed
                height squeezes each other toward 0; only the companies
                table (which should actually fill leftover space) keeps
                flex:1. */}
            <div className="cc-section cc-table-section" style={{ flex: '0 0 auto', minHeight: 'auto' }}>
              <div className="cc-companies-table-scroll" style={{ overflow: 'auto' }}>
                <table className="trade-table jr-companies-table" style={{ fontSize: 13 }}>
                  <thead>
                    <tr>
                      <th>Month</th>
                      {block.strategyList.map(s => (
                        <th key={s} style={{ textAlign: 'right' }}>{stratLabel(s)}</th>
                      ))}
                      <th style={{ textAlign: 'right', fontWeight: 800 }}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {block.months.map(m => {
                      const row = block.byMonth.get(m)!
                      return (
                        <tr key={m}>
                          <td className="mono" style={{ fontWeight: 700, color: 'var(--text-1)', whiteSpace: 'nowrap' }}>{fmtMonth(m)}</td>
                          {block.strategyList.map(s => {
                            const v = row.get(s)
                            return (
                              <td key={s} className="mono" style={{ textAlign: 'right', color: v != null ? pnlColor(v) : 'var(--text-5)', whiteSpace: 'nowrap' }}>
                                {v != null ? fmtDollar(v) : '—'}
                              </td>
                            )
                          })}
                          <td className="mono" style={{ textAlign: 'right', fontWeight: 700, color: pnlColor(monthTotal(m)), whiteSpace: 'nowrap' }}>{fmtDollar(monthTotal(m))}</td>
                        </tr>
                      )
                    })}
                    <tr style={{ borderTop: '2px solid var(--border)' }}>
                      <td className="mono" style={{ fontWeight: 800, color: 'var(--text-1)', whiteSpace: 'nowrap' }}>Total</td>
                      {block.strategyList.map(s => (
                        <td key={s} className="mono" style={{ textAlign: 'right', fontWeight: 700, color: pnlColor(stratTotal(s)), whiteSpace: 'nowrap' }}>{fmtDollar(stratTotal(s))}</td>
                      ))}
                      <td className="mono" style={{ textAlign: 'right', fontWeight: 800, color: pnlColor(grandTotal), whiteSpace: 'nowrap' }}>{fmtDollar(grandTotal)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
