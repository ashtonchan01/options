/**
 * Monthly Income by Strategy — realized P&L (closed positions only) broken
 * down by month and strategy, one block per financial year. One of the two
 * Reports sub-pages (the other is Company P&L) — both live under
 * ReportsView.tsx, which owns the shared FY filter and sub-tab nav.
 */
import { useMemo, useState } from 'react'
import type { AppState, RawTrade } from '../../types'
import type { TradeLabels } from '../../App'
import { buildJournalPositions, buildStockPositions, type JournalPosition } from '../../engine/journal'
import { tradeId } from '../../store/tradeLabelsStore'
import { fmtDollar, pnlColor, fyOf, stratLabel, stratRank, monthKey, fmtMonth } from './reportsShared'

type FyFilter = 'all' | string

/** Monthly realized income (closed-position P&L) split by strategy, one
 * block per financial year (mirrors the FY-by-FY layout of a manual
 * tracking spreadsheet) — the top FY filter just controls which block(s)
 * show. Keeps the actual closed positions behind each month too (not just
 * the summed $ per cell) so a month row can be expanded into "which trade
 * made this number" instead of just showing the total. */
function buildMonthlyStrategyByFy(positions: JournalPosition[], fy: FyFilter) {
  const buckets = new Map<string, { label: string; startYear: number; byMonth: Map<string, Map<string, number>>; positionsByMonth: Map<string, JournalPosition[]>; strategies: Set<string> }>()

  for (const p of positions) {
    if (p.status === 'Active' || p.pnl == null || !p.dateClosed) continue
    const closedFy = fyOf(p.dateClosed)
    if (fy !== 'all' && fy !== closedFy.key) continue
    if (!buckets.has(closedFy.key)) buckets.set(closedFy.key, { label: closedFy.label, startYear: closedFy.startYear, byMonth: new Map(), positionsByMonth: new Map(), strategies: new Set() })
    const bucket = buckets.get(closedFy.key)!
    const strategy = p.strategy ?? 'unlabelled'
    const month = monthKey(p.dateClosed)
    bucket.strategies.add(strategy)
    if (!bucket.byMonth.has(month)) bucket.byMonth.set(month, new Map())
    const row = bucket.byMonth.get(month)!
    row.set(strategy, (row.get(strategy) ?? 0) + p.pnl)
    if (!bucket.positionsByMonth.has(month)) bucket.positionsByMonth.set(month, [])
    bucket.positionsByMonth.get(month)!.push(p)
  }

  return [...buckets.entries()]
    .sort((a, b) => a[1].startYear - b[1].startYear)
    .map(([key, bucket]) => ({
      fy: key,
      label: bucket.label,
      months: [...bucket.byMonth.keys()].sort(),
      strategyList: [...bucket.strategies].sort((a, b) => stratRank(a) - stratRank(b)),
      byMonth: bucket.byMonth,
      positionsByMonth: bucket.positionsByMonth,
    }))
    .filter(b => b.months.length > 0)
}

function fmtTradeDate(s: string): string {
  return /^\d{8}$/.test(s) ? `${s.slice(6, 8)}/${s.slice(4, 6)}/${s.slice(0, 4)}` : s
}

function positionLabel(p: JournalPosition): string {
  if (p.strikeDisplay === 'SHARES') return p.underlying
  const strikes = p.strikes.length ? p.strikes.map(s => s % 1 === 0 ? s.toLocaleString() : s.toFixed(2)).join('/') : ''
  return `${p.underlying} ${strikes}${p.putCall ?? ''}`.trim()
}

function tradeDescription(t: RawTrade): string {
  if (t.assetClass !== 'OPT') return t.symbol
  const expiry = t.expiry ? fmtTradeDate(t.expiry) : ''
  const strike = t.strike != null ? (t.strike % 1 === 0 ? t.strike.toLocaleString() : t.strike.toFixed(2)) : ''
  return `${t.underlyingSymbol ?? t.symbol} ${strike}${t.putCall ?? ''} ${expiry}`.trim()
}

/** The actual buy/sell fills behind one closed position — matched by
 * tradeId() against this position's own tradeIds, same lookup the
 * Journal's SHARES row expansion uses. This is the level of detail that
 * answers "which trade made this ticker negative this month": the summed
 * P&L on its own doesn't say whether it was one bad exit or several. */
function PositionTradesTable({ position, tradesByKey }: { position: JournalPosition; tradesByKey: Map<string, RawTrade> }) {
  const rows = useMemo(() => position.tradeIds
    .map(id => tradesByKey.get(id))
    .filter((t): t is RawTrade => t != null)
    .sort((a, b) => a.tradeDate.localeCompare(b.tradeDate) || (a.tradeTime ?? '').localeCompare(b.tradeTime ?? '')),
    [position.tradeIds, tradesByKey])

  if (rows.length === 0) {
    return <div style={{ padding: '8px 16px', color: 'var(--text-5)', fontSize: 11.5 }}>No trade history found for this position.</div>
  }

  return (
    <div style={{ padding: '8px 16px 8px 32px', background: 'var(--bg-surface)' }}>
      <table className="mono" style={{ width: '100%', fontSize: 11.5, borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ color: 'var(--text-5)', textAlign: 'left' }}>
            <th style={{ fontWeight: 500, padding: '3px 8px 3px 0' }}>Date</th>
            <th style={{ fontWeight: 500, padding: '3px 8px' }}>Description</th>
            <th style={{ fontWeight: 500, padding: '3px 8px' }}>Action</th>
            <th style={{ fontWeight: 500, padding: '3px 8px', textAlign: 'right' }}>Qty</th>
            <th style={{ fontWeight: 500, padding: '3px 8px', textAlign: 'right' }}>Price</th>
            <th style={{ fontWeight: 500, padding: '3px 8px', textAlign: 'right' }}>Fees</th>
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
                <td style={{ padding: '3px 8px 3px 0', color: 'var(--text-4)', whiteSpace: 'nowrap' }}>{fmtTradeDate(t.tradeDate)}</td>
                <td style={{ padding: '3px 8px', color: 'var(--text-3)', whiteSpace: 'nowrap' }}>{tradeDescription(t)}</td>
                <td style={{ padding: '3px 8px', color: t.quantity > 0 ? '#10b981' : '#ef4444', fontWeight: 600, whiteSpace: 'nowrap' }}>{action}</td>
                <td style={{ padding: '3px 8px', textAlign: 'right' }}>{Math.abs(t.quantity)}</td>
                <td style={{ padding: '3px 8px', textAlign: 'right' }}>{fmtDollar(t.tradePrice)}</td>
                <td style={{ padding: '3px 8px', textAlign: 'right', color: 'var(--text-5)' }}>{fmtDollar(Math.abs(t.commissions ?? 0))}</td>
                <td style={{ padding: '3px 8px', textAlign: 'right', color: pnlColor(t.netCash), fontWeight: 600 }}>{fmtDollar(t.netCash)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** Every closed position behind one month's total, biggest winner first —
 * so "which trade made the most/least this month" is a click away instead
 * of just seeing the summed $ per strategy. Each position row is itself
 * clickable to drill one level further into the actual buy/sell fills that
 * made it up — a summed P&L alone doesn't say which specific trade(s)
 * drove it. */
function MonthPositionsTable({ positions, trades, colSpan }: { positions: JournalPosition[]; trades: RawTrade[]; colSpan: number }) {
  const rows = useMemo(() => [...positions].sort((a, b) => (b.pnl ?? 0) - (a.pnl ?? 0)), [positions])
  const tradesByKey = useMemo(() => {
    const m = new Map<string, RawTrade>()
    for (const t of trades) m.set(tradeId(t), t)
    return m
  }, [trades])
  const [openId, setOpenId] = useState<string | null>(null)

  return (
    <tr>
      <td colSpan={colSpan} style={{ padding: 0 }}>
        <div style={{ padding: '10px 16px', background: 'var(--bg-elevated)' }}>
          <table className="mono" style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ color: 'var(--text-4)', textAlign: 'left' }}>
                <th style={{ fontWeight: 500, padding: '3px 8px 3px 0' }}>Ticker</th>
                <th style={{ fontWeight: 500, padding: '3px 8px' }}>Strategy</th>
                <th style={{ fontWeight: 500, padding: '3px 8px' }}>Open</th>
                <th style={{ fontWeight: 500, padding: '3px 8px' }}>Closed</th>
                <th style={{ fontWeight: 500, padding: '3px 8px', textAlign: 'right' }}>Fees</th>
                <th style={{ fontWeight: 500, padding: '3px 8px', textAlign: 'right' }}>P&amp;L</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(p => {
                const isOpen = openId === p.id
                return (
                  <>
                    <tr key={p.id} onClick={() => setOpenId(isOpen ? null : p.id)} style={{ borderTop: '1px solid var(--border)', cursor: 'pointer' }}>
                      <td style={{ padding: '4px 8px 4px 0', fontWeight: 700, color: 'var(--text-1)', whiteSpace: 'nowrap' }}>
                        <span style={{ display: 'inline-block', width: 10, color: 'var(--text-5)', transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.1s' }}>▸</span>
                        {positionLabel(p)}
                      </td>
                      <td style={{ padding: '4px 8px', color: 'var(--text-3)', whiteSpace: 'nowrap' }}>{stratLabel(p.strategy ?? 'unlabelled')}</td>
                      <td style={{ padding: '4px 8px', color: 'var(--text-3)', whiteSpace: 'nowrap' }}>{fmtTradeDate(p.dateOpen)}</td>
                      <td style={{ padding: '4px 8px', color: 'var(--text-3)', whiteSpace: 'nowrap' }}>{p.dateClosed ? fmtTradeDate(p.dateClosed) : '—'}</td>
                      <td style={{ padding: '4px 8px', textAlign: 'right', color: 'var(--text-4)' }}>{fmtDollar(p.openFees + (p.closeFees ?? 0))}</td>
                      <td style={{ padding: '4px 8px', textAlign: 'right', fontWeight: 700, color: pnlColor(p.pnl ?? 0) }}>{fmtDollar(p.pnl ?? 0)}</td>
                    </tr>
                    {isOpen && (
                      <tr key={`${p.id}-detail`}>
                        <td colSpan={6} style={{ padding: 0 }}>
                          <PositionTradesTable position={p} tradesByKey={tradesByKey} />
                        </td>
                      </tr>
                    )}
                  </>
                )
              })}
            </tbody>
          </table>
        </div>
      </td>
    </tr>
  )
}

export default function MonthlyIncomeView({ state, tradeLabels, fy }: { state: AppState; tradeLabels?: TradeLabels; fy: FyFilter }) {
  const [expanded, setExpanded] = useState<string | null>(null)

  const positions = useMemo(() => {
    const labels = tradeLabels?.labels ?? {}
    return [
      ...buildJournalPositions(state.sync.trades, labels),
      ...buildStockPositions(state.sync.trades, labels),
    ]
  }, [state.sync.trades, tradeLabels?.labels])

  const monthlyStrategyBlocks = useMemo(() => buildMonthlyStrategyByFy(positions, fy), [positions, fy])

  const hasData = state.sync.trades.length > 0

  if (!hasData) {
    return (
      <div className="db-empty-msg" style={{ flex: 1 }}>
        No trade data — sync IBKR Flex or upload a statement to start tracking income
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div
        className="cc-section-title"
        style={{ padding: 0, cursor: 'help', width: 'fit-content' }}
        title="Realized P&L by close date — each closed position's full gain/loss is attributed to the month it closed, not the month(s) it was opened or traded in. This is NOT the same as the Calendar page's monthly total, which is cash flow by trade date, so the two won't match for the same month. Click a month row to see every closed position behind that total, biggest winner first."
      >
        Monthly Income by Strategy
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-4)', marginTop: -8 }}>Click a month to see which trades drove it</div>

      {monthlyStrategyBlocks.length === 0 && (
        <div className="cc-section cc-table-section" style={{ flexShrink: 1, padding: 24, textAlign: 'center', color: 'var(--text-5)' }}>
          No closed trades in this range
        </div>
      )}

      {monthlyStrategyBlocks.map(block => {
        const monthTotal = (m: string) => [...block.byMonth.get(m)!.values()].reduce((s, v) => s + v, 0)
        const stratTotal = (s: string) => block.months.reduce((sum, m) => sum + (block.byMonth.get(m)!.get(s) ?? 0), 0)
        const grandTotal = block.months.reduce((sum, m) => sum + monthTotal(m), 0)
        const monthFees = (m: string) => (block.positionsByMonth.get(m) ?? []).reduce((s, p) => s + p.openFees + (p.closeFees ?? 0), 0)
        const grandFees = block.months.reduce((sum, m) => sum + monthFees(m), 0)
        return (
          <div key={block.fy}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.05em', margin: '2px 0' }}>
              {block.label.toUpperCase()}
            </div>
            <div className="cc-section cc-table-section" style={{ flex: '0 0 auto', minHeight: 'auto' }}>
              <div className="cc-companies-table-scroll" style={{ overflow: 'auto' }}>
                <table className="trade-table jr-companies-table" style={{ fontSize: 13 }}>
                  <thead>
                    <tr>
                      <th>Month</th>
                      {block.strategyList.map(s => (
                        <th key={s} style={{ textAlign: 'right' }}>{stratLabel(s)}</th>
                      ))}
                      <th style={{ textAlign: 'right' }}>Fees</th>
                      <th style={{ textAlign: 'right', fontWeight: 800 }}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {block.months.map(m => {
                      const row = block.byMonth.get(m)!
                      const key = `${block.fy}|${m}`
                      const isOpen = expanded === key
                      return (
                        <>
                          <tr key={m} onClick={() => setExpanded(isOpen ? null : key)} style={{ cursor: 'pointer' }}>
                            <td className="mono" style={{ fontWeight: 700, color: 'var(--text-1)', whiteSpace: 'nowrap' }}>
                              <span style={{ display: 'inline-block', width: 12, color: 'var(--text-4)', transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.1s' }}>▸</span>
                              {fmtMonth(m)}
                            </td>
                            {block.strategyList.map(s => {
                              const v = row.get(s)
                              return (
                                <td key={s} className="mono" style={{ textAlign: 'right', color: v != null ? pnlColor(v) : 'var(--text-5)', whiteSpace: 'nowrap' }}>
                                  {v != null ? fmtDollar(v) : '—'}
                                </td>
                              )
                            })}
                            <td className="mono" style={{ textAlign: 'right', color: 'var(--text-4)', whiteSpace: 'nowrap' }}>{fmtDollar(monthFees(m))}</td>
                            <td className="mono" style={{ textAlign: 'right', fontWeight: 700, color: pnlColor(monthTotal(m)), whiteSpace: 'nowrap' }}>{fmtDollar(monthTotal(m))}</td>
                          </tr>
                          {isOpen && <MonthPositionsTable positions={block.positionsByMonth.get(m) ?? []} trades={state.sync.trades} colSpan={block.strategyList.length + 3} />}
                        </>
                      )
                    })}
                    <tr style={{ borderTop: '2px solid var(--border)' }}>
                      <td className="mono" style={{ fontWeight: 800, color: 'var(--text-1)', whiteSpace: 'nowrap' }}>Total</td>
                      {block.strategyList.map(s => (
                        <td key={s} className="mono" style={{ textAlign: 'right', fontWeight: 700, color: pnlColor(stratTotal(s)), whiteSpace: 'nowrap' }}>{fmtDollar(stratTotal(s))}</td>
                      ))}
                      <td className="mono" style={{ textAlign: 'right', fontWeight: 700, color: 'var(--text-2)', whiteSpace: 'nowrap' }}>{fmtDollar(grandFees)}</td>
                      <td className="mono" style={{ textAlign: 'right', fontWeight: 800, color: pnlColor(grandTotal) }}>{fmtDollar(grandTotal)}</td>
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
