/**
 * Monthly Income by Strategy — realized P&L (closed positions only) broken
 * down by month and strategy, one block per financial year. Was part of
 * the same page as Company P&L (CompaniesView); split into its own page
 * per request since the two are different questions ("which ticker" vs
 * "which strategy, which month").
 */
import { useMemo, useState } from 'react'
import type { AppState } from '../../types'
import type { TradeLabels } from '../../App'
import { buildJournalPositions, buildStockPositions, type JournalPosition } from '../../engine/journal'
import { fmtDollar, pnlColor, fyOf, currentFyKey, stratLabel, stratRank, monthKey, fmtMonth } from './reportsShared'

type FyFilter = 'all' | string

/** Monthly realized income (closed-position P&L) split by strategy, one
 * block per financial year (mirrors the FY-by-FY layout of a manual
 * tracking spreadsheet) — the top FY filter just controls which block(s)
 * show. */
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

export default function MonthlyIncomeView({ state, tradeLabels }: { state: AppState; tradeLabels?: TradeLabels }) {
  const [fy, setFy] = useState<FyFilter>('all')

  const positions = useMemo(() => {
    const labels = tradeLabels?.labels ?? {}
    return [
      ...buildJournalPositions(state.sync.trades, labels),
      ...buildStockPositions(state.sync.trades, labels),
    ]
  }, [state.sync.trades, tradeLabels?.labels])

  const nowFy = currentFyKey()

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
    <div className="jr-root">
      <div className="tl-filter-row" style={{ gap: 4 }}>
        <button className={`tl-filter-chip${fy === 'all' ? ' active' : ''}`} onClick={() => setFy('all')}>
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

      <div
        className="cc-section-title"
        style={{ padding: 0, cursor: 'help', width: 'fit-content' }}
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
