/**
 * Reports — Company P&L and Monthly Income by Strategy, as two sub-pages
 * under one shared FY filter instead of two separate top-level account
 * tabs (they used to be split that way; folded back under one "Reports"
 * tab per request, with an internal sub-nav instead). Owning the FY filter
 * here means both sub-pages always agree on which financial year is
 * selected — switching sub-tabs never resets or desyncs it.
 */
import { useMemo, useState } from 'react'
import type { AppState } from '../../types'
import type { TradeLabels } from '../../App'
import { buildJournalPositions, buildStockPositions } from '../../engine/journal'
import { fyOf, currentFyKey } from './reportsShared'
import CompanyPnlView from './CompanyPnlView'
import MonthlyIncomeView from './MonthlyIncomeView'

type FyFilter = 'all' | string
type SubPage = 'company' | 'monthly'

const SUB_PAGES: { id: SubPage; label: string }[] = [
  { id: 'company', label: 'Company P&L' },
  { id: 'monthly', label: 'Monthly Income' },
]

export default function ReportsView({ state, tradeLabels }: { state: AppState; tradeLabels?: TradeLabels }) {
  const [sub, setSub] = useState<SubPage>('company')
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
  // shared by both sub-pages so a FY tab picked on one still applies after
  // switching to the other.
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

  return (
    <div className="jr-root">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        {/* Sub-tab nav — a lighter-weight pill row (not the page-level
            ph-underline-tabs) since this is a second level of navigation
            nested inside the Reports tab, not a sibling of Overview/
            Calendar/Journal/Allocation. */}
        <div className="rp-subnav">
          {SUB_PAGES.map(p => (
            <button
              key={p.id}
              className={`rp-subnav-tab${sub === p.id ? ' active' : ''}`}
              onClick={() => setSub(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>

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
      </div>

      {sub === 'company'
        ? <CompanyPnlView state={state} tradeLabels={tradeLabels} fy={fy} />
        : <MonthlyIncomeView state={state} tradeLabels={tradeLabels} fy={fy} />}
    </div>
  )
}
