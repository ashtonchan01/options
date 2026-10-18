/**
 * Australian financial-year realised P&L, in the shape of IBKR's
 * Realized & Unrealized Performance Summary: stocks, equity and index
 * options, and forex, each split into short-term and long-term profit
 * and loss. The figures are IBKR's fifoPnlRealized (see realizedFy.ts),
 * in USD. One block per account, then the same block combined.
 */
import { useEffect, useMemo, useState } from 'react'
import type { RawTrade } from '../../types'
import { fetchMarketQuotes } from '../../services/markets'
import {
  closesMissingRealized,
  closesUsingFallback,
  fyBounds,
  fyStartYearOf,
  mergeLines,
  realizedLines,
  summarize,
  type RealizedCategory,
  type RealizedLine,
  type RealizedTotals,
} from '../../engine/realizedFy'
import { currentFyKey, fmtDollar, fyLabel, pnlColor } from './reportsShared'

export interface RealisedAccount {
  id: string
  name: string
  trades: RawTrade[]
}

const CATEGORIES: { id: RealizedCategory; label: string }[] = [
  { id: 'stocks', label: 'Stocks' },
  { id: 'options', label: 'Equity and Index Options' },
  { id: 'forex', label: 'Forex' },
]

function dominantAccountId(trades: RawTrade[]): string | undefined {
  const counts = new Map<string, number>()
  for (const t of trades) {
    if (!t.accountId) continue
    counts.set(t.accountId, (counts.get(t.accountId) ?? 0) + 1)
  }
  let best: string | undefined
  let n = 0
  for (const [id, c] of counts) if (c > n) { best = id; n = c }
  return best
}

function fyYears(accounts: RealisedAccount[]): number[] {
  const current = Number(currentFyKey())
  let min = Math.min(2025, current)
  for (const account of accounts) {
    for (const trade of account.trades) {
      const year = fyStartYearOf(trade)
      if (year != null) min = Math.min(min, year)
    }
  }
  const years: number[] = []
  for (let year = min; year <= Math.max(current, min); year++) years.push(year)
  return years
}

function initialYear(): number {
  if (typeof window === 'undefined') return Number(currentFyKey())
  const q = new URLSearchParams(window.location.search)
  const requested = q.get('fy')
  if (requested && /^\d{4}$/.test(requested)) return Number(requested)
  if (import.meta.env.DEV && q.get('fypreview') === '1') return 2025
  return Number(currentFyKey())
}

function fmtStamp(iso: string): string {
  const [date, time] = iso.split('T')
  const [y, m, d] = date.split('-')
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${Number(d)} ${months[Number(m) - 1]} ${y} ${time.slice(0, 5)}`
}

function TotalsRow({ label, totals, strong }: { label: string; totals: RealizedTotals; strong?: boolean }) {
  const cells = [totals.stProfit, totals.stLoss, totals.ltProfit, totals.ltLoss, totals.total]
  return (
    <tr style={strong ? { borderTop: '2px solid var(--border)' } : undefined}>
      <td className="mono" style={{ fontWeight: strong ? 800 : 600, whiteSpace: 'nowrap' }}>{label}</td>
      {cells.map((n, i) => (
        <td key={i} className="mono" style={{ textAlign: 'right', fontWeight: strong || i === cells.length - 1 ? 700 : 500, color: pnlColor(n), whiteSpace: 'nowrap' }}>
          {fmtDollar(n)}
        </td>
      ))}
    </tr>
  )
}

function CategoryTable({ title, subtitle, lines }: { title: string; subtitle?: string; lines: RealizedLine[] }) {
  const totals = summarize(lines)
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div>
        <div style={{ fontWeight: 700, color: 'var(--text-1)' }}>{title}</div>
        {subtitle && <div style={{ fontSize: 11, color: 'var(--text-4)' }}>{subtitle}</div>}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="trade-table jr-companies-table" style={{ width: '100%', fontSize: 13, minWidth: 640 }}>
          <thead>
            <tr>
              <th style={{ whiteSpace: 'nowrap' }}>Asset class</th>
              <th style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>S/T Profit</th>
              <th style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>S/T Loss</th>
              <th style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>L/T Profit</th>
              <th style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>L/T Loss</th>
              <th style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>Realized Total</th>
            </tr>
          </thead>
          <tbody>
            <TotalsRow label="Stocks" totals={totals.stocks} />
            <TotalsRow label="Equity and Index Options" totals={totals.options} />
            <TotalsRow label="Forex" totals={totals.forex} />
            <TotalsRow label="Total" totals={totals.all} strong />
          </tbody>
        </table>
      </div>
    </section>
  )
}

export default function RealisedFyView({ accounts, activeAccountId }: { accounts: RealisedAccount[]; activeAccountId: string }) {
  const years = useMemo(() => fyYears(accounts), [accounts])
  const [year, setYear] = useState(initialYear)
  const selected = years.includes(year) ? year : years[years.length - 1]
  const [scope, setScope] = useState<'account' | 'all'>('account')
  const [showZero, setShowZero] = useState(false)
  const [audUsd, setAudUsd] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchMarketQuotes(['AUDUSD=X']).then(quotes => {
      if (cancelled) return
      const price = quotes['AUDUSD=X']?.price
      if (price && price > 0) setAudUsd(price)
    })
    return () => { cancelled = true }
  }, [])

  const blocks = useMemo(() => accounts.map(account => ({
    ...account,
    ibkrId: dominantAccountId(account.trades),
    lines: realizedLines(account.trades, selected),
    missing: closesMissingRealized(account.trades, selected).length,
    fallback: closesUsingFallback(account.trades, selected).length,
  })), [accounts, selected])

  const combined = useMemo(() => mergeLines(blocks.flatMap(b => b.lines)), [blocks])
  const combinedTotals = summarize(combined)
  const active = blocks.find(b => b.id === activeAccountId) ?? blocks[0]
  const symbolLines = (scope === 'all' ? combined : active?.lines ?? [])
    .filter(line => showZero || Math.abs(line.total) > 0.004)
    .sort((a, b) => CATEGORIES.findIndex(c => c.id === a.category) - CATEGORIES.findIndex(c => c.id === b.category)
      || Math.abs(b.total) - Math.abs(a.total)
      || a.symbol.localeCompare(b.symbol))

  const bounds = fyBounds(selected)
  const preview = import.meta.env.DEV && typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('fypreview') === '1'
  const missing = blocks.reduce((s, b) => s + b.missing, 0)
  const fallback = blocks.reduce((s, b) => s + b.fallback, 0)
  const aud = audUsd ? combinedTotals.all.total / audUsd : null

  return (
    <div id="realised-fy" style={{ display: 'flex', flexDirection: 'column', gap: 18, paddingTop: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <div className="tl-filter-row" style={{ gap: 4 }}>
          {years.map(y => (
            <button
              key={y}
              className={`tl-filter-chip${selected === y ? ' active' : ''}`}
              onClick={() => setYear(y)}
              title={`${fmtStamp(fyBounds(y).start)} to ${fmtStamp(fyBounds(y).end)} Australia/Sydney`}
            >
              {fyLabel(y)}
            </button>
          ))}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-4)', lineHeight: 1.45, maxWidth: 520 }}>
          {fyLabel(selected)} · {fmtStamp(bounds.start)} inclusive to {fmtStamp(bounds.end)} exclusive · Australia/Sydney · USD
        </div>
      </div>

      {preview && (
        <div style={{ fontSize: 12, color: 'var(--text-2)', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px' }}>
          Preview uses the FY2025-26 and FY2026-27 statement fixtures for Personal, plus two small synthetic accounts dated September 2025. It is not a live Flex sync.
        </div>
      )}

      {missing > 0 && (
        <div style={{ fontSize: 12, color: 'var(--text-2)', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px' }}>
          {missing} closing {missing === 1 ? 'trade' : 'trades'} in this FY {missing === 1 ? 'has' : 'have'} no IBKR realised figure.
          {fallback > 0
            ? ` ${fallback} of them are estimated as proceeds + commissions + basis, which is short by the option premium on an equity assignment.`
            : ' They are omitted until a Flex sync includes fifoPnlRealized.'}
          {' '}Sync again to load cost basis and realised P&amp;L. Other fees, GST, and broker interest are not part of this total.
        </div>
      )}

      {blocks.map(block => (
        <CategoryTable
          key={block.id}
          title={block.name}
          subtitle={block.ibkrId ? `IBKR ${block.ibkrId}` : undefined}
          lines={block.lines}
        />
      ))}
      {blocks.length > 1 && (
        <CategoryTable title="Combined" subtitle="All accounts in this app" lines={combined} />
      )}

      <div className="jr-mini-strip">
        <div className="jr-mini"><span className="label">Combined realised</span><b style={{ color: pnlColor(combinedTotals.all.total) }} data-fy-total={combinedTotals.all.total.toFixed(2)}>{fmtDollar(combinedTotals.all.total)}</b></div>
        <div className="jr-mini"><span className="label">Stocks</span><b style={{ color: pnlColor(combinedTotals.stocks.total) }}>{fmtDollar(combinedTotals.stocks.total)}</b></div>
        <div className="jr-mini"><span className="label">Options</span><b style={{ color: pnlColor(combinedTotals.options.total) }}>{fmtDollar(combinedTotals.options.total)}</b></div>
        <div className="jr-mini"><span className="label">Forex</span><b style={{ color: pnlColor(combinedTotals.forex.total) }}>{fmtDollar(combinedTotals.forex.total)}</b></div>
      </div>
      {aud != null && audUsd != null && (
        <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
          About <b style={{ color: pnlColor(aud) }}>A{fmtDollar(aud)}</b> at today's rate (1 AUD = {audUsd.toFixed(4)} USD). This is a live quote, not IBKR's historical FX.
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ fontWeight: 700, color: 'var(--text-1)' }}>Symbols</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="tl-filter-row" style={{ gap: 4 }}>
            <button className={`tl-filter-chip${scope === 'account' ? ' active' : ''}`} onClick={() => setScope('account')}>
              {active?.name ?? 'This account'}
            </button>
            <button className={`tl-filter-chip${scope === 'all' ? ' active' : ''}`} onClick={() => setScope('all')}>All accounts</button>
          </div>
          <button className={`tl-filter-chip${showZero ? ' active' : ''}`} onClick={() => setShowZero(v => !v)}>
            {showZero ? 'Hide $0 symbols' : 'Show $0 symbols'}
          </button>
        </div>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table className="trade-table jr-companies-table" style={{ width: '100%', fontSize: 13, minWidth: 720 }}>
          <thead>
            <tr>
              <th style={{ whiteSpace: 'nowrap' }}>Symbol</th>
              <th style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>S/T Profit</th>
              <th style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>S/T Loss</th>
              <th style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>L/T Profit</th>
              <th style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>L/T Loss</th>
              <th style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>Realized</th>
            </tr>
          </thead>
          <tbody>
            {symbolLines.map((line, i) => {
              const category = CATEGORIES.find(c => c.id === line.category)
              const showHeader = i === 0 || symbolLines[i - 1].category !== line.category
              return (
                <tr key={`${line.category}|${line.symbol}`}>
                  <td className="mono" style={{ whiteSpace: 'nowrap' }}>
                    {showHeader && category && <span style={{ display: 'block', fontSize: 10, letterSpacing: '0.04em', color: 'var(--text-4)', fontWeight: 700 }}>{category.label.toUpperCase()}</span>}
                    {line.symbol}
                  </td>
                  {[line.stProfit, line.stLoss, line.ltProfit, line.ltLoss, line.total].map((n, ci) => (
                    <td key={ci} className="mono" style={{ textAlign: 'right', fontWeight: ci === 4 ? 700 : 500, color: pnlColor(n), whiteSpace: 'nowrap' }}>{fmtDollar(n)}</td>
                  ))}
                </tr>
              )
            })}
            {symbolLines.length === 0 && (
              <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-5)', padding: 24 }}>No realised trades in {fyLabel(selected)}.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={{ fontSize: 11, color: 'var(--text-4)', lineHeight: 1.5, maxWidth: 760 }}>
        Long-term is split only when each closed lot has its open date and its own realised figure. Otherwise the whole trade stays short-term. The NVDA sale in the FY2025-26 statement is 227.97 short-term and 446.94 long-term, and the 16 Oct 2026 MSTR sale is a 19,179.53 long-term loss; those splits appear once the Flex closed lots carry the open dates. A transfer in keeps its IBKR cost basis. The 20 Aug 2026 MSTR transfer's $104.25 mark is not the lot that sale closed. Fees outside trades, such as Other Fees and broker interest, are not included.
      </div>
    </div>
  )
}
