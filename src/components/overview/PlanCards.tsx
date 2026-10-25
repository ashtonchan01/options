/**
 * Ideas, Puts, and Calls for the open account. Same rows the Income page
 * showed: ticker chips, strike and right, expiry, quantity, and the saved
 * ticker rules. Nothing here places a trade.
 */
import { useMemo, type ReactNode } from 'react'
import type { Account } from '../../store/accountsStore'
import {
  SEED_CALLS,
  SEED_CALL_NOTE,
  SEED_MARK_DATE,
  SEED_NEXT_ACTIONS,
  SEED_PUTS,
  SEED_PUT_NOTE,
  SEED_SELLS,
  type IncomeSettings,
} from '../../income/incomeSeed'
import {
  annualizedReturn,
  callCover,
  daysBetween,
  pct,
  putScreenRows,
  resolvedNetLiquidation,
  screenDays,
  toLiveBook,
  usd0,
  type IncomeSource,
} from '../../income/incomeLive'
import { tickerColor } from '../../income/tickerColor'

function formatExpiry(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

function todayIso(today: Date): string {
  const month = String(today.getMonth() + 1).padStart(2, '0')
  const day = String(today.getDate()).padStart(2, '0')
  return `${today.getFullYear()}-${month}-${day}`
}

function daysLeft(iso: string, today: Date): number | null {
  if (!iso) return null
  return daysBetween(todayIso(today), iso.slice(0, 10))
}

function formatExpiryShort(iso: string, today: Date): string {
  const date = new Date(`${iso.slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return iso || '—'
  const month = date.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })
  const day = date.getUTCDate()
  if (date.getUTCFullYear() === today.getFullYear()) return `${day} ${month}`
  return `${day} ${month} '${String(date.getUTCFullYear()).slice(2)}`
}

function EmojiTitle({ emoji, children }: { emoji: string; children: ReactNode }) {
  return (
    <span className="income-title">
      <span className="income-emoji" aria-hidden="true">{emoji}</span>
      <span>{children}</span>
    </span>
  )
}

function IncomePanel({ emoji, title, children }: { emoji: string; title: string; children: ReactNode }) {
  return (
    <section className="dash-panel income-panel">
      <div className="dash-panel-header"><EmojiTitle emoji={emoji}>{title}</EmojiTitle></div>
      {children}
    </section>
  )
}

function TickerChip({ symbol }: { symbol: string }) {
  return <span className="income-ticker" style={{ ['--tick' as string]: tickerColor(symbol) }}>{symbol}</span>
}

function DtePill({ days }: { days: number | null }) {
  if (days == null) return null
  const kind = days <= 7 ? 'urgent' : days <= 30 ? 'soon' : 'later'
  return <span className={`income-dte-pill ${kind}`}>{`${Math.max(days, 0)}d`}</span>
}

function ExpiryCell({ iso, today }: { iso: string; today: Date }) {
  return (
    <span className="income-expiry">
      <span>{formatExpiryShort(iso, today)}</span>
      <DtePill days={daysLeft(iso, today)} />
    </span>
  )
}

function qtyText(n: number): string {
  const abs = Math.abs(n)
  const body = Number.isInteger(abs) ? abs.toLocaleString('en-US') : abs.toLocaleString('en-US', { maximumFractionDigits: 2 })
  return `${body}×`
}

function ScanTable({ columns, children }: { columns: { label: string; align?: 'n' }[]; children: ReactNode }) {
  return (
    <div className="income-scan">
      <table className="income-scan-table">
        <thead>
          <tr>
            {columns.map(column => <th key={column.label} className={column.align}>{column.label}</th>)}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

function sourceFor(account: Account): IncomeSource {
  return {
    name: account.name,
    positions: account.positions ?? [],
    trades: account.trades,
    cashBalance: account.cashBalance,
    netLiquidation: resolvedNetLiquidation(account),
    excessLiquidity: account.excessLiquidity,
  }
}

export default function PlanCards({ account, settings }: { account: Account; settings: IncomeSettings }) {
  const now = useMemo(() => new Date(), [])
  const focus = useMemo(() => toLiveBook(sourceFor(account), now), [account, now])
  const role = focus.role === 'personal' || focus.role === 'business' ? focus.role : null
  const days = screenDays(settings.screenExpiry)
  const puts = putScreenRows(SEED_PUTS, settings)
  const calls = role ? SEED_CALLS.filter(row => row.account === role) : []
  const sells = role ? SEED_SELLS.filter(sell => sell.account === role) : []

  return (
    <div className="income-list-row ov-plan-row">
      {role && (
        <IncomePanel emoji="💡" title="Ideas">
          <ScanTable columns={[{ label: 'Ticker' }, { label: 'Idea' }, { label: 'Credit', align: 'n' }]}>
            {SEED_NEXT_ACTIONS[role].map(step => (
              <tr key={step}>
                <td>—</td>
                <td title={step}>{step}</td>
                <td className="n">—</td>
              </tr>
            ))}
            {sells.map(sell => (
              <tr key={sell.label}>
                <td><TickerChip symbol={sell.label.split(' ')[0] ?? sell.label} /></td>
                <td title={sell.cover}>{`${sell.label} · ${sell.phase === 'now' ? 'Now' : 'After repair'}`}</td>
                <td className="n">{usd0(sell.premium)}</td>
              </tr>
            ))}
          </ScanTable>
        </IncomePanel>
      )}
      <IncomePanel emoji="📉" title={`Puts · ${formatExpiry(settings.screenExpiry)}`}>
        <ScanTable columns={[{ label: 'Ticker' }, { label: 'Contract' }, { label: 'Expiry' }, { label: 'Credit', align: 'n' }, { label: 'Yield', align: 'n' }, { label: 'Flag' }]}>
          {puts.map(row => (
            <tr key={`${row.symbol}-${row.strike}`} className={row.excluded || row.blockedMstr ? 'muted' : undefined} title={row.note}>
              <td><TickerChip symbol={row.symbol} /></td>
              <td>
                <span className="income-kind">📉</span>
                <span className="income-right put">{`${row.strike}P`}</span>
              </td>
              <td><ExpiryCell iso={settings.screenExpiry} today={now} /></td>
              <td className="n">{usd0(row.premium)}</td>
              <td className="n">{pct(annualizedReturn(row.ratio, days))}</td>
              <td>
                {row.excluded && <span className="income-flag bad">Excluded</span>}
                {row.blockedMstr && <span className="income-flag bad">No puts</span>}
                {row.band === 'out' && <span className="income-flag warn">Outside</span>}
                {!row.excluded && !row.blockedMstr && row.band !== 'out' && '—'}
              </td>
            </tr>
          ))}
        </ScanTable>
        <details className="income-fold">
          <summary><EmojiTitle emoji="📝">How this is calculated</EmojiTitle></summary>
          <ul className="income-actions">
            <li>{SEED_PUT_NOTE}</li>
            <li>Rank is premium / cash secured, {days} days from {SEED_MARK_DATE} to {formatExpiry(settings.screenExpiry)}. Δ {settings.deltaMin.toFixed(2)}–{settings.deltaMax.toFixed(2)}.</li>
          </ul>
        </details>
      </IncomePanel>
      {calls.length > 0 && (
        <IncomePanel emoji="📞" title="Calls">
          <ScanTable columns={[{ label: 'Ticker' }, { label: 'Contract' }, { label: 'Qty', align: 'n' }, { label: 'Credit', align: 'n' }, { label: 'Cover' }]}>
            {calls.map(row => {
              const coveredOnly = settings.rules.some(rule => rule.type === 'coveredCalls' && rule.symbol.trim().toUpperCase() === row.symbol)
              const blockedCalls = settings.rules.some(rule => rule.type === 'noNewCalls' && rule.symbol.trim().toUpperCase() === row.symbol)
              const cover = coveredOnly ? callCover(focus, row.symbol, row.contracts) : null
              const shares = focus.shares.find(holding => holding.symbol === row.symbol)?.quantity
              const strike = row.label.match(/(\d+(?:\.\d+)?)C/)?.[1]
              return (
                <tr key={row.label} className={blockedCalls ? 'muted' : undefined}>
                  <td><TickerChip symbol={row.symbol} /></td>
                  <td>
                    <span className="income-kind">📈</span>
                    <span className="income-right call">{strike ? `${strike}C` : row.label}</span>
                  </td>
                  <td className="n">{qtyText(row.contracts)}</td>
                  <td className="n">{usd0(row.premium)}</td>
                  <td>
                    {blockedCalls && <span className="income-flag bad">No calls</span>}
                    {cover === 'covered' && <span className="income-flag ok">Covered</span>}
                    {cover === 'short' && <span className="income-flag bad">Uncovered</span>}
                    {cover === 'unknown' && <span className="income-flag warn">Unknown</span>}
                    {cover == null && shares != null && <span>{`${Math.round(shares)} sh`}</span>}
                    {cover == null && shares == null && '—'}
                  </td>
                </tr>
              )
            })}
          </ScanTable>
          <details className="income-fold">
            <summary><EmojiTitle emoji="🗒️">How this is calculated</EmojiTitle></summary>
            <ul className="income-actions"><li>{SEED_CALL_NOTE}</li></ul>
          </details>
        </IncomePanel>
      )}
    </div>
  )
}
