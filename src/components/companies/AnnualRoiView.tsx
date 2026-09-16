/**
 * Annual ROI — dollar and % return for each financial year, one of the
 * Reports sub-pages (alongside Company P&L and Monthly Income by Strategy).
 *
 * There's no historical daily-balance snapshot to divide each year's P&L
 * against, only today's live net worth and each year's own P&L — so a
 * year's starting balance is derived backward from today: peel this year's
 * P&L off next year's starting balance, and so on back through history.
 * That's exactly "this year's return against the balance you ended last
 * year with" per the user's own framing, just computed in reverse since
 * only the CURRENT balance is actually known. This assumes no external
 * deposits/withdrawals between years — any cash added or pulled out shows
 * up as a return distortion, same limitation every other FY total in this
 * app already has (Calendar's FY totals, Milestone's target curve, etc.).
 */
import { useMemo } from 'react'
import type { AppState } from '../../types'
import type { TradeLabels } from '../../App'
import { buildJournalPositions, buildStockPositions } from '../../engine/journal'
import { fmtDollar, pnlColor, fyOf, currentFyKey } from './reportsShared'

interface FyRoiRow {
  key: string
  label: string
  startYear: number
  pnl: number
  startBalance: number
  endBalance: number
  roiPct: number | null
  isCurrent: boolean
}

function buildFyRoiRows(state: AppState, tradeLabels?: TradeLabels): FyRoiRow[] {
  const labels = tradeLabels?.labels ?? {}
  const positions = [
    ...buildJournalPositions(state.sync.trades, labels),
    ...buildStockPositions(state.sync.trades, labels),
  ]
  const nowFy = currentFyKey()

  // Realized P&L per FY, keyed by closed-position date — same bucketing
  // Monthly Income and the Calendar's FY totals already use.
  const realizedByFy = new Map<string, { label: string; startYear: number; pnl: number }>()
  let hasOpenPositions = false
  for (const p of positions) {
    if (p.status === 'Active') { hasOpenPositions = true; continue }
    if (p.pnl == null || !p.dateClosed) continue
    const f = fyOf(p.dateClosed)
    const e = realizedByFy.get(f.key) ?? { label: f.label, startYear: f.startYear, pnl: 0 }
    e.pnl += p.pnl
    realizedByFy.set(f.key, e)
  }
  // The current FY isn't over — its "return so far" needs live open
  // positions' unrealized P&L folded in too, on top of whatever's already
  // realized this year, or an in-progress year with only closed trades
  // would understate what actually happened to the account balance.
  if (hasOpenPositions || !realizedByFy.has(nowFy)) {
    const cur = fyOf(`${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}01`)
    if (!realizedByFy.has(nowFy)) realizedByFy.set(nowFy, { label: cur.label, startYear: cur.startYear, pnl: 0 })
  }
  const totalUnrealized = state.sync.positions.reduce((s, p) => s + p.unrealizedPnL, 0)
  const curEntry = realizedByFy.get(nowFy)
  if (curEntry) curEntry.pnl += totalUnrealized

  const fys = [...realizedByFy.entries()]
    .map(([key, e]) => ({ key, ...e }))
    .sort((a, b) => b.startYear - a.startYear) // latest first, for backward derivation

  const stockMV = state.sync.positions.filter(p => p.assetClass === 'STK').reduce((s, p) => s + p.positionValue, 0)
  const optionMV = state.sync.positions.filter(p => p.assetClass === 'OPT').reduce((s, p) => s + p.positionValue, 0)
  const todayNetWorth = state.sync.netLiquidation ?? (stockMV + optionMV + (state.sync.cashBalance ?? 0))

  const rows: FyRoiRow[] = []
  let runningEnd = todayNetWorth
  for (const fy of fys) {
    const endBalance = runningEnd
    const startBalance = endBalance - fy.pnl
    rows.push({
      key: fy.key, label: fy.label, startYear: fy.startYear, pnl: fy.pnl,
      startBalance, endBalance,
      roiPct: startBalance > 0 ? (fy.pnl / startBalance) * 100 : null,
      isCurrent: fy.key === nowFy,
    })
    runningEnd = startBalance
  }
  return rows
}

export default function AnnualRoiView({ state, tradeLabels }: { state: AppState; tradeLabels?: TradeLabels }) {
  const rows = useMemo(() => buildFyRoiRows(state, tradeLabels), [state, tradeLabels])

  if (rows.length === 0) {
    return <div style={{ padding: '16px 4px', color: 'var(--text-4)', fontSize: 13 }}>No closed trades or open positions yet — nothing to compute a return from.</div>
  }

  return (
    <div style={{ padding: '10px 4px' }}>
      <div style={{ fontSize: 11, color: 'var(--text-4)', marginBottom: 10, lineHeight: 1.5 }}>
        Each year's starting balance is derived backward from today's live net worth (peeling off each
        year's own P&L in turn) since there's no historical daily balance to divide against — assumes no
        deposits/withdrawals between years. The current financial year's figure includes today's
        unrealized P&L on open positions since the year isn't over yet.
      </div>
      {/* Same horizontal-scroll-instead-of-wrap pattern as Company P&L/Monthly
          Income's tables (.jr-companies-table, min-width + white-space:nowrap
          on narrow screens) — without it, "Start Balance"/"End Balance"
          wrapped onto 2 lines while the data cells stayed single-line, so
          headers and values no longer lined up, and the Financial Year
          column was pushed off-screen on mobile with no way to reach it. */}
      <div className="cc-companies-table-scroll" style={{ overflow: 'auto' }}>
        <table className="trade-table jr-companies-table" style={{ width: '100%', fontSize: 13 }}>
          <thead>
            <tr>
              <th style={{ whiteSpace: 'nowrap' }}>Financial Year</th>
              <th style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>Start Balance</th>
              <th style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>End Balance</th>
              <th style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>P&amp;L ($)</th>
              <th style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>ROI (%)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.key}>
                <td className="mono" style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                  {r.label}{r.isCurrent && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: 'var(--accent)' }}>YTD</span>}
                </td>
                <td className="mono" style={{ textAlign: 'right', color: 'var(--text-3)', whiteSpace: 'nowrap' }}>{fmtDollar(r.startBalance)}</td>
                <td className="mono" style={{ textAlign: 'right', color: 'var(--text-3)', whiteSpace: 'nowrap' }}>{fmtDollar(r.endBalance)}</td>
                <td className="mono" style={{ textAlign: 'right', color: pnlColor(r.pnl), fontWeight: 600, whiteSpace: 'nowrap' }}>{fmtDollar(r.pnl)}</td>
                <td className="mono" style={{ textAlign: 'right', color: r.roiPct == null ? 'var(--text-4)' : pnlColor(r.roiPct), fontWeight: 700, whiteSpace: 'nowrap' }}>
                  {r.roiPct == null ? '—' : `${r.roiPct >= 0 ? '+' : ''}${r.roiPct.toFixed(1)}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
