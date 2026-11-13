/**
 * Ideas, Puts, and Calls for the open account. Ideas are rebuilt from the
 * open book and the income rules. Puts and Calls are live bids that pass
 * the income screen: the configured expiry, the delta band, and a real bid,
 * ranked by premium / cash or by yield. A call is listed only when held
 * shares cover the contracts. Ticker rules are not applied here.
 * Nothing here places a trade.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Account } from '../../store/accountsStore'
import type { IncomeSettings } from '../../income/incomeSeed'
import {
  annualizedReturn,
  calendarIso,
  callPremiumRatio,
  daysBetween,
  ideaCopy,
  liveIdeas,
  pct,
  recommendCalls,
  recommendPuts,
  resolvedNetLiquidation,
  toLiveBook,
  usd0,
  type IncomeSource,
  type LiveIdea,
} from '../../income/incomeLive'
import {
  bidQuoteLabel,
  incomeScanSymbols,
  loadIncomeScreen,
  type IncomeLiveScreen,
} from '../../income/livePremium'
import { tickerColor } from '../../income/tickerColor'

function formatExpiry(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

function daysLeft(iso: string, today: Date): number | null {
  if (!iso) return null
  return daysBetween(calendarIso(today), iso.slice(0, 10))
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

function money(n: number): string {
  const sign = n < 0 ? '-' : ''
  return `${sign}$${usd0(Math.abs(n))}`
}

function IncomePanel({ emoji, title, extra, testId, children }: { emoji: string; title: string; extra?: ReactNode; testId?: string; children: ReactNode }) {
  return (
    <section className="dash-panel income-panel" data-testid={testId}>
      <div className="dash-panel-header">
        <EmojiTitle emoji={emoji}>{title}</EmojiTitle>
        {extra}
      </div>
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

function heldSymbols(account: Account): string[] {
  const symbols: string[] = []
  for (const position of account.positions ?? []) {
    if (position.assetClass !== 'STK' && position.assetClass !== 'OPT') continue
    if (!position.quantity) continue
    symbols.push(position.underlyingSymbol || position.symbol)
  }
  return symbols
}

function IdeaCells({ idea, today }: { idea: LiveIdea; today: string }) {
  const copy = ideaCopy(idea, today)
  return (
    <td title={copy.text}>
      {copy.before}{copy.qty}{copy.contract ? (
        <>
          <span className="income-kind">{idea.putCall === 'C' ? '📈' : '📉'}</span>
          <span className={`income-right ${idea.putCall === 'C' ? 'call' : 'put'}`}>{copy.contract}</span>
        </>
      ) : null}{copy.after}
    </td>
  )
}

function QuoteStamp({ quotedAt, stale }: { quotedAt: number | null; stale: boolean }) {
  return (
    <div className="income-quote" data-testid="premium-quote">
      <span>{bidQuoteLabel(quotedAt)}</span>
      {stale && <span className="income-flag warn">Stale</span>}
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

export default function PlanCards({ account, settings, today, liveScreen, symbols }: { account: Account; settings: IncomeSettings; today?: Date; liveScreen?: IncomeLiveScreen; symbols?: string[] }) {
  const now = useMemo(() => today ?? new Date(), [today])
  const todayIso = calendarIso(now)
  const focus = useMemo(() => toLiveBook(sourceFor(account), now), [account, now])
  const role = focus.role === 'personal' || focus.role === 'business' ? focus.role : null
  const ideas = useMemo(
    () => (role ? liveIdeas(focus, settings, now, heldSymbols(account)) : []),
    [account, focus, now, role, settings],
  )
  const days = daysBetween(todayIso, settings.screenExpiry)
  const holdings = useMemo(
    () => focus.shares.filter(row => row.quantity > 0).map(row => ({ symbol: row.symbol, shares: row.quantity })),
    [focus],
  )
  const universeKey = (symbols ?? []).map(symbol => symbol.trim().toUpperCase()).filter(Boolean).join(',')
  const universe = useMemo(
    () => incomeScanSymbols(universeKey ? universeKey.split(',') : [], holdings),
    [universeKey, holdings],
  )
  const [fetched, setFetched] = useState<IncomeLiveScreen | null>(liveScreen ?? null)
  useEffect(() => {
    if (liveScreen) {
      setFetched(liveScreen)
      return
    }
    let cancel = false
    loadIncomeScreen(holdings, universe.map(symbol => ({ symbol, note: '' })), settings, now)
      .then(screen => { if (!cancel) setFetched(screen) })
      .catch(() => { if (!cancel) setFetched({ calls: [], puts: [], putQuotedAt: {}, putStale: {}, loaded: true }) })
    return () => { cancel = true }
  }, [liveScreen, holdings, universe, settings, now])
  const screen = liveScreen ?? fetched
  const puts = screen ? recommendPuts(screen.puts, settings) : []
  const calls = screen ? recommendCalls(screen.calls, focus, settings) : []
  const putCredit = puts.reduce((sum, row) => sum + row.premium, 0)
  const callCredit = calls.reduce((sum, row) => sum + row.premium, 0)

  return (
    <div className="income-list-row ov-plan-row">
      {role && (
        <IncomePanel emoji="💡" title="Ideas" testId="ideas-panel">
          <ScanTable columns={[{ label: 'Ticker' }, { label: 'Idea' }, { label: 'Credit', align: 'n' }]}>
            {ideas.length === 0 && (
              <tr data-testid="idea-row" data-kind="none">
                <td>—</td>
                <td>No pending ideas</td>
                <td className="n">—</td>
              </tr>
            )}
            {ideas.map(idea => (
              <tr key={idea.key} data-testid="idea-row" data-kind={idea.kind} data-symbol={idea.symbol} data-strike={idea.strike ?? ''}>
                <td>{idea.symbol ? <TickerChip symbol={idea.symbol} /> : '—'}</td>
                <IdeaCells idea={idea} today={todayIso} />
                <td className="n">—</td>
              </tr>
            ))}
          </ScanTable>
        </IncomePanel>
      )}
      <IncomePanel
        emoji="📉"
        title={`Puts · ${formatExpiry(settings.screenExpiry)}`}
        extra={<span className="ov-credit-total" data-testid="puts-credit-total">Credit total <b>{money(putCredit)}</b></span>}
      >
        <ScanTable columns={[{ label: 'Ticker' }, { label: 'Contract' }, { label: 'Expiry' }, { label: 'Credit', align: 'n' }, { label: 'Yield', align: 'n' }, { label: 'Flag' }]}>
          {!screen && (
            <tr>
              <td colSpan={6}>Waiting for live bids</td>
            </tr>
          )}
          {screen && puts.length === 0 && (
            <tr>
              <td colSpan={6}>No strikes with a live bid</td>
            </tr>
          )}
          {puts.map(row => (
            <tr key={`${row.symbol}-${row.strike}`}>
              <td><TickerChip symbol={row.symbol} /></td>
              <td>
                <span className="income-kind">📉</span>
                <span className="income-right put">{`${row.strike}P`}</span>
              </td>
              <td><ExpiryCell iso={settings.screenExpiry} today={now} /></td>
              <td className="n">
                {usd0(row.premium)}
                <QuoteStamp quotedAt={screen?.putQuotedAt[row.symbol] ?? null} stale={screen?.putStale[row.symbol] ?? true} />
              </td>
              <td className="n">{pct(annualizedReturn(row.ratio, days))}</td>
              <td>—</td>
            </tr>
          ))}
        </ScanTable>
        <details className="income-fold">
          <summary><EmojiTitle emoji="📝">How this is calculated</EmojiTitle></summary>
          <ul className="income-actions">
            <li>One put per name on the active watchlist, expiry {formatExpiry(settings.screenExpiry)}. Credit is the live bid × 100. Strikes with no bid, or outside Δ {settings.deltaMin.toFixed(2)}–{settings.deltaMax.toFixed(2)}, are left off. Rank is that credit / cash secured over {days} days, using the live stock price. A stale bid stays listed and is marked.</li>
          </ul>
        </details>
      </IncomePanel>
      {role && (
        <IncomePanel
          emoji="📞"
          title="Calls"
          extra={<span className="ov-credit-total" data-testid="calls-credit-total">Credit total <b>{money(callCredit)}</b></span>}
        >
          <ScanTable columns={[{ label: 'Ticker' }, { label: 'Contract' }, { label: 'Expiry' }, { label: 'Qty', align: 'n' }, { label: 'Credit', align: 'n' }, { label: 'Yield', align: 'n' }, { label: 'Cover' }]}>
            {!screen && (
              <tr>
                <td colSpan={7}>Waiting for live bids</td>
              </tr>
            )}
            {screen && calls.length === 0 && (
              <tr>
                <td colSpan={7}>No strikes with a live bid</td>
              </tr>
            )}
            {calls.map(row => {
              const shares = focus.shares.find(holding => holding.symbol === row.symbol)?.quantity
              return (
                <tr key={`${row.symbol}-${row.strike}`}>
                  <td><TickerChip symbol={row.symbol} /></td>
                  <td>
                    <span className="income-kind">📈</span>
                    <span className="income-right call">{`${row.strike}C`}</span>
                  </td>
                  <td><ExpiryCell iso={settings.screenExpiry} today={now} /></td>
                  <td className="n">{qtyText(row.contracts)}</td>
                  <td className="n">
                    {usd0(row.premium)}
                    <QuoteStamp quotedAt={row.quotedAt} stale={row.stale} />
                  </td>
                  <td className="n">{pct(annualizedReturn(callPremiumRatio(row.premium, row.spot, row.contracts), days))}</td>
                  <td>{shares != null && shares > 0 ? <span>{`${Math.round(shares)} sh`}</span> : '—'}</td>
                </tr>
              )
            })}
          </ScanTable>
          <details className="income-fold">
            <summary><EmojiTitle emoji="🗒️">How this is calculated</EmojiTitle></summary>
            <ul className="income-actions">
              <li>One call per name whose shares cover the contracts. Credit is the live bid × 100 × contracts. The strike is the call in the delta band against the live stock price. Strikes with no bid are left off. Yield is that credit / (live spot × 100 × contracts), {days} days to {formatExpiry(settings.screenExpiry)}. A stale bid stays listed and is marked.</li>
            </ul>
          </details>
        </IncomePanel>
      )}
    </div>
  )
}
