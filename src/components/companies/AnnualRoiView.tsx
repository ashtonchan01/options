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
 * app already has (Calendar's FY totals, Milestone's target curve, etc.) —
 * which is exactly what the per-row Manual Cash input below is for: type in
 * whatever was deposited/withdrawn that year (in whichever currency it was
 * actually in, e.g. AUD) and it's converted to USD and deducted from that
 * year's own P&L only, not treated as if it were a trading gain.
 */
import { useEffect, useMemo, useState } from 'react'
import type { AppState } from '../../types'
import type { TradeLabels } from '../../App'
import { buildJournalPositions, buildStockPositions } from '../../engine/journal'
import { useAnnualRoiManualCash } from '../../store/annualRoiCashStore'
import { fetchMarketQuotes } from '../../services/markets'
import { fmtDollar, pnlColor, fyOf, currentFyKey } from './reportsShared'

const CURRENCIES = ['USD', 'AUD', 'EUR', 'GBP', 'NZD', 'CAD', 'JPY', 'HKD', 'SGD', 'CHF']

interface FyRoiRow {
  key: string
  label: string
  startYear: number
  grossPnl: number
  manualCashUsd: number
  manualCashValue: number
  manualCashCurrency: string
  pnl: number
  startBalance: number
  endBalance: number
  roiPct: number | null
  isCurrent: boolean
}

function buildFyRoiRows(
  state: AppState,
  tradeLabels: TradeLabels | undefined,
  manualCashByFy: Record<string, { value: number; currency: string }>,
  fxRates: Record<string, number>,
): FyRoiRow[] {
  const labels = tradeLabels?.labels ?? {}
  const positions = [
    ...buildJournalPositions(state.sync.trades, labels),
    ...buildStockPositions(state.sync.trades, labels, state.sync.positions),
  ]
  const nowFy = currentFyKey()

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
  if (hasOpenPositions || !realizedByFy.has(nowFy)) {
    const cur = fyOf(`${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}01`)
    if (!realizedByFy.has(nowFy)) realizedByFy.set(nowFy, { label: cur.label, startYear: cur.startYear, pnl: 0 })
  }
  const totalUnrealized = state.sync.positions.reduce((s, p) => s + p.unrealizedPnL, 0)
  const curEntry = realizedByFy.get(nowFy)
  if (curEntry) curEntry.pnl += totalUnrealized

  for (const [key, entry] of Object.entries(manualCashByFy)) {
    if (entry.value === 0 || realizedByFy.has(key)) continue
    const startYear = Number(key)
    realizedByFy.set(key, { label: `FY ${startYear}/${String((startYear + 1) % 100).padStart(2, '0')}`, startYear, pnl: 0 })
  }

  function toUsd(entry: { value: number; currency: string } | undefined): number {
    if (!entry || entry.value === 0) return 0
    if (entry.currency === 'USD') return entry.value
    const rate = fxRates[entry.currency]
    return rate == null ? 0 : entry.value * rate
  }

  const fys = [...realizedByFy.entries()]
    .map(([key, e]) => {
      const manualCash = manualCashByFy[key]
      const manualCashUsd = toUsd(manualCash)
      return {
        key, label: e.label, startYear: e.startYear, grossPnl: e.pnl,
        manualCashUsd, manualCashValue: manualCash?.value ?? 0, manualCashCurrency: manualCash?.currency ?? 'USD',
        pnl: e.pnl - manualCashUsd,
      }
    })
    .sort((a, b) => b.startYear - a.startYear)

  const stockMV = state.sync.positions.filter(p => p.assetClass === 'STK').reduce((s, p) => s + p.positionValue, 0)
  const optionMV = state.sync.positions.filter(p => p.assetClass === 'OPT').reduce((s, p) => s + p.positionValue, 0)
  const todayNetWorth = state.sync.netLiquidation ?? (stockMV + optionMV + (state.sync.cashBalance ?? 0))

  const rows: FyRoiRow[] = []
  let runningEnd = todayNetWorth
  for (const fy of fys) {
    const endBalance = runningEnd
    const startBalance = endBalance - fy.pnl
    rows.push({
      key: fy.key, label: fy.label, startYear: fy.startYear,
      grossPnl: fy.grossPnl, manualCashUsd: fy.manualCashUsd,
      manualCashValue: fy.manualCashValue, manualCashCurrency: fy.manualCashCurrency,
      pnl: fy.pnl,
      startBalance, endBalance,
      roiPct: startBalance > 0 ? (fy.pnl / startBalance) * 100 : null,
      isCurrent: fy.key === nowFy,
    })
    runningEnd = startBalance
  }
  return rows
}

/** The Manual Cash cell — a value input plus a currency picker, since a
 * deposit/withdrawal isn't always in USD (an AUD bank transfer, say). Local
 * text state so a mid-edit value doesn't get clobbered by the parent
 * re-rendering on every keystroke; commits on blur or Enter rather than on
 * every keystroke, same as every other inline-edit input in this app. The
 * currency picker commits immediately on change. */
function ManualCashCell({ value, currency, onCommit }: {
  value: number; currency: string; onCommit: (value: number, currency: string) => void
}) {
  const [text, setText] = useState(String(value))
  function commit() {
    const parsed = parseFloat(text)
    const next = Number.isFinite(parsed) ? parsed : 0
    setText(String(next))
    if (next !== value) onCommit(next, currency)
  }
  return (
    <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
      <input
        type="number"
        value={text}
        onChange={e => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        style={{
          width: 90, padding: '3px 6px', textAlign: 'right', fontSize: 12, fontFamily: 'inherit',
          borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-1)',
        }}
      />
      <select
        value={currency}
        onChange={e => onCommit(value, e.target.value)}
        style={{
          padding: '3px 4px', fontSize: 12, fontFamily: 'inherit',
          borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-1)',
        }}
      >
        {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
      </select>
    </div>
  )
}

export default function AnnualRoiView({ state, tradeLabels, accountId, sessionKey }: {
  state: AppState; tradeLabels?: TradeLabels; accountId: string; sessionKey?: string | null
}) {
  const { byFy: manualCashByFy, setValue: setManualCash } = useAnnualRoiManualCash(accountId, sessionKey)

  const [fxRates, setFxRates] = useState<Record<string, number>>({})
  const nonUsdKey = useMemo(
    () => [...new Set(Object.values(manualCashByFy).map(e => e.currency).filter(c => c && c !== 'USD'))].sort().join(','),
    [manualCashByFy],
  )
  useEffect(() => {
    if (!nonUsdKey) { setFxRates({}); return }
    const currencies = nonUsdKey.split(',')
    let cancelled = false
    fetchMarketQuotes(currencies.map(c => `${c}USD=X`)).then(quotes => {
      if (cancelled) return
      const rates: Record<string, number> = {}
      for (const c of currencies) {
        const q = quotes[`${c}USD=X`]
        if (q && q.price > 0) rates[c] = q.price
      }
      setFxRates(rates)
    })
    return () => { cancelled = true }
  }, [nonUsdKey])

  const rows = useMemo(() => buildFyRoiRows(state, tradeLabels, manualCashByFy, fxRates), [state, tradeLabels, manualCashByFy, fxRates])

  if (rows.length === 0) {
    return <div style={{ padding: '16px 4px', color: 'var(--text-4)', fontSize: 13 }}>No closed trades or open positions yet — nothing to compute a return from.</div>
  }

  return (
    <div style={{ padding: '10px 4px' }}>
      <div style={{ fontSize: 11, color: 'var(--text-4)', marginBottom: 10, lineHeight: 1.5 }}>
        Each year's starting balance is derived backward from today's live net worth (peeling off each
        year's own P&L in turn) since there's no historical daily balance to divide against — assumes no
        deposits/withdrawals between years. The current financial year's figure includes today's
        unrealized P&L on open positions since the year isn't over yet. Type a deposit/withdrawal amount
        and pick its currency into a year's Manual Cash cell to convert it to USD and deduct it from that
        year's own P&L instead of counting it as a trading gain.
      </div>
      <div className="cc-companies-table-scroll" style={{ overflow: 'auto' }}>
        <table className="trade-table jr-companies-table" style={{ width: '100%', fontSize: 13 }}>
          <thead>
            <tr>
              <th style={{ whiteSpace: 'nowrap' }}>Financial Year</th>
              <th style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>Start Balance</th>
              <th style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>End Balance</th>
              <th style={{ textAlign: 'right', whiteSpace: 'nowrap' }} title="Type a deposit/withdrawal for this year in its own currency — converted to USD and deducted from this year's own P&L only">Manual Cash</th>
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
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <ManualCashCell
                    value={r.manualCashValue}
                    currency={r.manualCashCurrency}
                    onCommit={(v, c) => setManualCash(r.key, v, c)}
                  />
                  {r.manualCashCurrency !== 'USD' && r.manualCashValue !== 0 && (
                    <div style={{ fontSize: 10, color: 'var(--text-4)', marginTop: 2 }}>
                      {fxRates[r.manualCashCurrency] == null ? 'loading rate…' : `≈ ${fmtDollar(r.manualCashUsd)}`}
                    </div>
                  )}
                </td>
                <td className="mono" style={{ textAlign: 'right', color: pnlColor(r.pnl), fontWeight: 600, whiteSpace: 'nowrap' }}
                  title={r.manualCashUsd !== 0 ? `Gross (before manual cash): ${fmtDollar(r.grossPnl)}` : undefined}>
                  {fmtDollar(r.pnl)}
                </td>
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
