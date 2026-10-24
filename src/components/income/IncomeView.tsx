/**
 * Read-only income plan. Settings are editable; nothing on this page
 * places, closes, or rolls a trade. Account ids and Flex tokens are not
 * part of the props.
 */
import { useEffect, useMemo, useState } from 'react'
import {
  SEED_BUSINESS_NOTE,
  SEED_BUSINESS_RISK,
  SEED_CALENDAR,
  SEED_CALLS,
  SEED_CALL_NOTE,
  SEED_CLOSE_LABEL,
  SEED_MARK_DATE,
  SEED_NEXT_ACTIONS,
  SEED_PAIRS,
  SEED_PERSONAL_REPAIR,
  SEED_PERSONAL_REPAIR_NOTE,
  SEED_PUTS,
  SEED_PUT_NOTE,
  SEED_SELLS,
  SEED_SNAPSHOT_RULES,
  type IncomeSettings,
} from '../../income/incomeSeed'
import {
  annualizedReturn,
  booksFor,
  callCover,
  callYield,
  elState,
  exitUpside,
  liveRules,
  pct,
  planPremium,
  putScreenRows,
  quoteFreshness,
  screenDays,
  usd0,
  type IncomeSource,
  type LiveBook,
} from '../../income/incomeLive'
import { fetchQuotes, type Quote } from '../../services/quotes'
import { useIncomePlan } from '../../store/incomePlanStore'

function formatExpiry(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

function moneyOrDash(value: number | undefined): string {
  return value == null ? '—' : usd0(value)
}

function Source({ kind }: { kind: 'live' | 'snapshot' }) {
  return <span className={`income-flag ${kind}`}>{kind === 'live' ? 'Live' : `${SEED_CLOSE_LABEL} snapshot`}</span>
}

function Stale({ label }: { label: string }) {
  return <span className="income-flag stale">{label}</span>
}

function NumField({ label, value, onCommit, testId }: { label: string; value: number; onCommit: (n: number) => void; testId?: string }) {
  return (
    <label className="income-field">
      <span>{label}</span>
      <input
        data-testid={testId}
        defaultValue={String(value)}
        key={String(value)}
        inputMode="decimal"
        onBlur={e => {
          const next = Number(e.target.value.replace(/,/g, ''))
          if (Number.isFinite(next)) onCommit(next)
        }}
      />
    </label>
  )
}

function bookFor(books: LiveBook[], role: 'personal' | 'business'): LiveBook | undefined {
  return books.find(book => book.role === role)
}

function ElLine({ book, floor }: { book: LiveBook; floor: number }) {
  const state = elState(book.excessLiquidity, floor)
  if (state === 'unknown') {
    return <p className="income-el unknown">Excess liquidity is not in the Flex snapshot.</p>
  }
  const gap = Math.abs((book.excessLiquidity ?? 0) - floor)
  if (state === 'below') {
    return <p className="income-el below" data-testid={`income-el-${book.role}`}>EL {usd0(book.excessLiquidity ?? 0)} — {usd0(gap)} below the US${usd0(floor)} floor</p>
  }
  return <p className="income-el ok" data-testid={`income-el-${book.role}`}>EL {usd0(book.excessLiquidity ?? 0)} — {usd0(gap)} above the US${usd0(floor)} floor</p>
}

function AccountCard({ book, settings, freshLabel, stale }: { book: LiveBook; settings: IncomeSettings; freshLabel: string; stale: boolean }) {
  const role = book.role === 'business' ? 'business' : book.role === 'personal' ? 'personal' : null
  const state = elState(book.excessLiquidity, settings.elFloor)
  const sells = role ? SEED_SELLS.filter(sell => sell.account === role) : []
  const nowPremium = role ? planPremium(SEED_SELLS, role, 'now') : 0
  const afterPremium = role ? planPremium(SEED_SELLS, role, 'after') : 0
  return (
    <section className={`income-account${state === 'below' ? ' short' : ''}`} data-testid={`income-account-${book.role}`}>
      <header>
        <h2>{book.name}</h2>
        <Source kind="live" />
      </header>
      <p className="income-stat">
        Net liq {moneyOrDash(book.netLiquidation)}
        {book.cash != null ? ` · Cash ${usd0(book.cash)}` : ''}
      </p>
      <ElLine book={book} floor={settings.elFloor} />
      <p className="income-stat">
        Realised this month {usd0(book.realisedThisMonth)}
        <span className="income-hint"> IBKR fifo on closes</span>
      </p>
      <p className="income-stat">
        Open short mark {usd0(book.openShortCloseCost)}
        {stale ? <> <Stale label={`${freshLabel} · statement mark`} /></> : <Stale label="Statement mark" />}
      </p>
      {role && (
        <>
          <p className="income-kicker">Plan notes <Source kind="snapshot" /></p>
          <ol className="income-actions">
            {SEED_NEXT_ACTIONS[role].map(step => <li key={step}>{step}</li>)}
          </ol>
          <table className="income-table">
            <thead>
              <tr><th>Idea</th><th>When</th><th className="n">Premium</th></tr>
            </thead>
            <tbody>
              {sells.map(sell => (
                <tr key={sell.label}>
                  <td>{sell.label}</td>
                  <td>{sell.cover}</td>
                  <td className="n">{usd0(sell.premium)}</td>
                </tr>
              ))}
              <tr className="tot">
                <td>Monthly income</td>
                <td>{role === 'personal' ? 'Now / after repair' : 'Fits today'}</td>
                <td className="n">{role === 'personal' ? `${usd0(nowPremium)} / ${usd0(afterPremium)}` : usd0(nowPremium)}</td>
              </tr>
            </tbody>
          </table>
        </>
      )}
      {book.shortOptions.length > 0 && (
        <table className="income-table">
          <thead>
            <tr>
              <th>Open short <Source kind="live" /></th>
              <th className="n">Qty</th>
              <th className="n">Mark</th>
              <th className="n">Close cost</th>
            </tr>
          </thead>
          <tbody>
            {book.shortOptions.map(option => (
              <tr key={`${option.underlying}-${option.putCall}-${option.strike}-${option.expiry}`}>
                <td>{option.underlying} {option.strike}{option.putCall} {option.expiry}</td>
                <td className="n">{option.quantity}</td>
                <td className="n">{option.mark.toFixed(2)} <Stale label={stale ? freshLabel : 'Statement mark'} /></td>
                <td className="n">{usd0(option.closeCost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

export default function IncomeView({ accounts, sessionKey }: { accounts: IncomeSource[]; sessionKey: string | null }) {
  const { settings, update } = useIncomePlan(sessionKey)
  const books = useMemo(() => booksFor(accounts, new Date()), [accounts])
  const freshness = useQuoteFreshness(books)
  const personal = bookFor(books, 'personal')
  const business = bookFor(books, 'business')
  const personalNow = planPremium(SEED_SELLS, 'personal', 'now')
  const personalAfter = planPremium(SEED_SELLS, 'personal', 'after')
  const businessNow = planPremium(SEED_SELLS, 'business', 'now')
  const businessAfter = planPremium(SEED_SELLS, 'business', 'after')
  const needed = settings.personalTarget + settings.businessTarget
  const planNow = personalNow + businessNow
  const planAfter = personalAfter + businessAfter
  const days = screenDays(settings.screenExpiry)
  const puts = putScreenRows(SEED_PUTS, settings)
  const rules = liveRules(books, settings)
  const exitPrice = (symbol: string) => settings.exits.find(exit => exit.symbol === symbol)?.price

  return (
    <div className="income-root" data-testid="income-root">
      <header className="income-head">
        <h1>Income plan</h1>
        <p>
          Marks in the idea tables are the Friday {SEED_CLOSE_LABEL}, pulled {SEED_MARK_DATE}, and stay stale until the next regular session.
          Ideas only. This page does not place a trade. US$.
        </p>
      </header>

      {freshness.stale && (
        <div className="income-banner" data-testid="income-stale">
          <Stale label={freshness.label} />
          <span>Stock quotes and Flex position marks are not a regular-session print. Option mids below are the {SEED_CLOSE_LABEL}.</span>
        </div>
      )}

      <section className="income-card">
        <h2>Target vs plan <span className="income-hint">per month</span></h2>
        <table className="income-table">
          <thead>
            <tr>
              <th>Account</th>
              <th className="n">Needed</th>
              <th className="n">Plan now</th>
              <th className="n">After repair</th>
              <th className="n">Gap</th>
              <th className="n">Realised this month</th>
              <th className="n">Open short mark</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Personal <span className="income-hint">({settings.personalTaxNote})</span></td>
              <td className="n">{usd0(settings.personalTarget)}</td>
              <td className="n">{usd0(personalNow)} <Source kind="snapshot" /></td>
              <td className="n">{usd0(personalAfter)}</td>
              <td className="n gap">{usd0(settings.personalTarget - personalNow)}</td>
              <td className="n">{personal ? usd0(personal.realisedThisMonth) : '—'} <Source kind="live" /></td>
              <td className="n">{personal ? usd0(personal.openShortCloseCost) : '—'}</td>
            </tr>
            <tr>
              <td>Business <span className="income-hint">({settings.businessTaxNote})</span></td>
              <td className="n">{usd0(settings.businessTarget)}</td>
              <td className="n">{usd0(businessNow)} <Source kind="snapshot" /></td>
              <td className="n">{usd0(businessAfter)}</td>
              <td className="n gap">{usd0(settings.businessTarget - businessNow)}</td>
              <td className="n">{business ? usd0(business.realisedThisMonth) : '—'} <Source kind="live" /></td>
              <td className="n">{business ? usd0(business.openShortCloseCost) : '—'}</td>
            </tr>
            <tr className="tot">
              <td>Total</td>
              <td className="n">{usd0(needed)}</td>
              <td className="n">{usd0(planNow)}</td>
              <td className="n">{usd0(planAfter)}</td>
              <td className="n gap">{usd0(needed - planNow)}</td>
              <td className="n">{usd0(books.reduce((sum, book) => sum + book.realisedThisMonth, 0))}</td>
              <td className="n">{usd0(books.reduce((sum, book) => sum + book.openShortCloseCost, 0))}</td>
            </tr>
          </tbody>
        </table>
        <p className="income-note">{settings.targetNote} Gap is needed minus plan now.</p>
      </section>

      <div className="income-cols">
        {books.map(book => (
          <AccountCard key={`${book.role}-${book.name}`} book={book} settings={settings} freshLabel={freshness.label} stale={freshness.stale} />
        ))}
      </div>

      <details className="income-fold" open>
        <summary>Screen and floor settings</summary>
        <div className="income-settings">
          <NumField label="EL floor (US$)" value={settings.elFloor} testId="income-el-floor" onCommit={elFloor => update({ elFloor })} />
          <NumField label="Personal needed / mo" value={settings.personalTarget} onCommit={personalTarget => update({ personalTarget })} />
          <NumField label="Business needed / mo" value={settings.businessTarget} onCommit={businessTarget => update({ businessTarget })} />
          <label className="income-field">
            <span>Put expiry</span>
            <input type="date" value={settings.screenExpiry} onChange={e => update({ screenExpiry: e.target.value })} />
          </label>
          <NumField label="Delta min" value={settings.deltaMin} onCommit={deltaMin => update({ deltaMin })} />
          <NumField label="Delta max" value={settings.deltaMax} onCommit={deltaMax => update({ deltaMax })} />
          <label className="income-field wide">
            <span>Exclude symbols</span>
            <input
              defaultValue={settings.excludeSymbols.join(', ')}
              key={settings.excludeSymbols.join(',')}
              onBlur={e => update({ excludeSymbols: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
            />
          </label>
          <label className="income-field wide">
            <span>ETF symbols</span>
            <input
              defaultValue={settings.etfSymbols.join(', ')}
              key={settings.etfSymbols.join(',')}
              onBlur={e => update({ etfSymbols: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
            />
          </label>
          {settings.exits.map(exit => (
            <NumField
              key={exit.symbol}
              label={`${exit.symbol} exit`}
              value={exit.price}
              onCommit={price => update({ exits: settings.exits.map(row => row.symbol === exit.symbol ? { ...row, price } : row) })}
            />
          ))}
          <label className="income-check">
            <input type="checkbox" checked={settings.noNewMstrPuts} onChange={e => update({ noNewMstrPuts: e.target.checked })} />
            No new MSTR puts
          </label>
          <label className="income-check">
            <input type="checkbox" checked={settings.tslaCallsCoveredOnly} onChange={e => update({ tslaCallsCoveredOnly: e.target.checked })} />
            TSLA calls only covered by held shares
          </label>
          <p className="income-note">Rank is premium / cash secured. {days} days from {SEED_MARK_DATE} to {formatExpiry(settings.screenExpiry)}.</p>
        </div>
      </details>

      <details className="income-fold" open>
        <summary>Put screen ({formatExpiry(settings.screenExpiry)}) <Source kind="snapshot" /> {freshness.stale && <Stale label={freshness.label} />}</summary>
        <div>
          <p className="income-note">
            Delta {settings.deltaMin.toFixed(2)}–{settings.deltaMax.toFixed(2)}, ranked by premium / cash secured
            {days > 0 ? ` over ${days} days` : ''}. A wide spread should be re-quoted at the next open.
          </p>
          <table className="income-table">
            <thead>
              <tr>
                <th>Put</th>
                <th className="n">Spot</th>
                <th className="n">Mid (bid/ask)</th>
                <th className="n">Delta</th>
                <th className="n">IV</th>
                <th className="n">Premium</th>
                <th className="n">Cash</th>
                <th className="n">Return</th>
                <th className="n">Ann.</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {puts.map(row => (
                <tr key={`${row.symbol}-${row.strike}`} className={row.excluded || row.blockedMstr ? 'blocked' : undefined}>
                  <td>{row.symbol} {row.strike}P</td>
                  <td className="n">
                    {row.spot.toFixed(2)}
                    {freshness.quotes[row.symbol] && (
                      <div className="income-sub">{freshness.quotes[row.symbol].price.toFixed(2)} <Stale label={freshness.label} /></div>
                    )}
                  </td>
                  <td className="n">{row.mid.toFixed(2)} ({row.bid.toFixed(2)}/{row.ask.toFixed(2)}) <Stale label={SEED_CLOSE_LABEL} /></td>
                  <td className={`n${row.band === 'out' ? ' warn' : ''}`}>{row.delta == null ? 'n/a' : row.delta.toFixed(2)}</td>
                  <td className="n">{row.iv == null ? 'n/a' : pct(row.iv)}</td>
                  <td className="n">{usd0(row.premium)}</td>
                  <td className="n">{usd0(row.cash)}</td>
                  <td className="n">{pct(row.ratio)}</td>
                  <td className="n">{pct(annualizedReturn(row.ratio, days))}</td>
                  <td>
                    {row.note}
                    {row.excluded ? ' · Excluded' : ''}
                    {row.blockedMstr ? ' · No new MSTR puts' : ''}
                    {row.band === 'out' ? ' · Outside delta band' : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="income-note">{SEED_PUT_NOTE}</p>
        </div>
      </details>

      <details className="income-fold" open>
        <summary>Call detail ({formatExpiry(settings.screenExpiry)}) <Source kind="snapshot" /></summary>
        <div>
          <table className="income-table">
            <thead>
              <tr>
                <th>Account</th>
                <th>Call</th>
                <th className="n">Spot</th>
                <th className="n">Mid (bid/ask)</th>
                <th className="n">Delta</th>
                <th className="n">Premium</th>
                <th className="n">Yield</th>
                <th>Share cover</th>
              </tr>
            </thead>
            <tbody>
              {SEED_CALLS.map(row => {
                const book = bookFor(books, row.account)
                const cover = row.symbol === 'TSLA' && settings.tslaCallsCoveredOnly ? callCover(book, 'TSLA', row.contracts) : null
                const shares = book?.shares.find(holding => holding.symbol === row.symbol)?.quantity
                return (
                  <tr key={`${row.account}-${row.label}`}>
                    <td>{row.account === 'personal' ? 'Personal' : 'Business'}</td>
                    <td>{row.label}</td>
                    <td className="n">{row.spot.toFixed(2)}</td>
                    <td className="n">{row.mid.toFixed(2)} ({row.bid.toFixed(2)}/{row.ask.toFixed(2)}) <Stale label={SEED_CLOSE_LABEL} /></td>
                    <td className="n">{row.delta == null ? 'n/a' : row.delta.toFixed(2)}</td>
                    <td className="n">{usd0(row.premium)}</td>
                    <td className="n">{pct(callYield(row.premium, row.spot, row.contracts))}</td>
                    <td>
                      {cover == null && (shares == null ? '—' : `${usd0(shares)} sh held`)}
                      {cover === 'covered' && <span className="pos">{usd0(shares ?? 0)} sh cover {row.contracts * 100}</span>}
                      {cover === 'short' && <span className="neg">{usd0(shares ?? 0)} sh, short of {row.contracts * 100}</span>}
                      {cover === 'unknown' && 'Share count not in this snapshot'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="income-note">{SEED_CALL_NOTE}</p>
        </div>
      </details>

      <details className="income-fold" open>
        <summary>Personal repair detail <Source kind="snapshot" /></summary>
        <div>
          <RepairTable rows={SEED_PERSONAL_REPAIR} />
          <p className="income-note">{SEED_PERSONAL_REPAIR_NOTE} Buying power and leverage are from this snapshot only; they are not in the Flex parse.</p>
        </div>
      </details>

      <details className="income-fold" open>
        <summary>Business pairs, exits, and other risk <Source kind="snapshot" /></summary>
        <div>
          <table className="income-table">
            <thead>
              <tr>
                <th>Pair (call / put)</th>
                <th className="n">Qty</th>
                <th className="n">Spot</th>
                <th className="n">Call / put mark</th>
                <th className="n">Net /sh</th>
                <th className="n">Shares</th>
                <th className="n">Cash for shares</th>
              </tr>
            </thead>
            <tbody>
              {SEED_PAIRS.map(row => {
                const exit = row.exitSymbol ? exitPrice(row.exitSymbol) : undefined
                return (
                  <tr key={row.label}>
                    <td>{row.label}</td>
                    <td className="n">{row.qty}</td>
                    <td className="n">{row.spot.toFixed(2)} <Stale label={SEED_CLOSE_LABEL} /></td>
                    <td className="n">{row.marks}</td>
                    <td className={`n${row.net.startsWith('-') ? ' warn' : ''}`}>{row.net}</td>
                    <td className="n">{row.shares}</td>
                    <td className="n">{exit != null ? `Sell at ${usd0(exit)} (${pct(exitUpside(row.spot, exit))})` : row.cash}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <RepairTable rows={SEED_BUSINESS_RISK} />
          <p className="income-note">{SEED_BUSINESS_NOTE}</p>
        </div>
      </details>

      <details className="income-fold" open>
        <summary>Risk rules</summary>
        <div>
          <p className="income-kicker">From the open book <Source kind="live" /></p>
          <table className="income-table">
            <thead>
              <tr><th>Rule</th><th>Status</th><th>Now</th></tr>
            </thead>
            <tbody>
              {rules.map(rule => (
                <tr key={rule.id}>
                  <td>{rule.rule}</td>
                  <td className={rule.status === 'yes' ? 'pos' : rule.status === 'no' ? 'neg' : ''}>{rule.status === 'yes' ? 'Yes' : rule.status === 'no' ? 'No' : 'Unknown'}</td>
                  <td>{rule.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="income-kicker">24 Oct snapshot <Source kind="snapshot" /></p>
          <table className="income-table">
            <thead>
              <tr><th>Rule</th><th>Status</th><th>Then</th></tr>
            </thead>
            <tbody>
              {SEED_SNAPSHOT_RULES.map(rule => (
                <tr key={rule.rule}>
                  <td>{rule.rule}</td>
                  <td className={rule.status === 'Yes' ? 'pos' : 'neg'}>{rule.status}</td>
                  <td>{rule.now}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <details className="income-fold" open>
        <summary>Calendar <Source kind="snapshot" /></summary>
        <table className="income-table">
          <thead>
            <tr><th>Date</th><th>Event</th></tr>
          </thead>
          <tbody>
            {SEED_CALENDAR.map(row => (
              <tr key={row.date}><td>{row.date}</td><td>{row.event}</td></tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  )
}

function RepairTable({ rows }: { rows: { label: string; qty: string; mark: string; closeCost: string; spot: string; state: string; idea: string }[] }) {
  return (
    <table className="income-table">
      <thead>
        <tr>
          <th>Position</th>
          <th className="n">Qty</th>
          <th className="n">Mark</th>
          <th className="n">Close cost</th>
          <th className="n">Spot</th>
          <th>State</th>
          <th>Idea</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(row => (
          <tr key={row.label}>
            <td>{row.label}</td>
            <td className="n">{row.qty}</td>
            <td className="n">{row.mark} <Stale label={SEED_CLOSE_LABEL} /></td>
            <td className="n">{row.closeCost}</td>
            <td className="n">{row.spot}</td>
            <td>{row.state}</td>
            <td>{row.idea}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function useQuoteFreshness(books: LiveBook[]) {
  const symbols = useMemo(
    () => [...new Set(books.flatMap(book => [...book.shares.map(row => row.symbol), ...book.shortOptions.map(option => option.underlying)]))].sort(),
    [books],
  )
  const [quotes, setQuotes] = useState<Record<string, Quote>>({})
  const symbolKey = symbols.join(',')
  useEffect(() => {
    if (!symbolKey) return
    let cancelled = false
    fetchQuotes(symbolKey.split(',')).then(next => {
      if (!cancelled) setQuotes(next)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [symbolKey])
  const marketState = Object.values(quotes).find(quote => quote.marketState && quote.marketState.toUpperCase() !== 'REGULAR')?.marketState
    ?? Object.values(quotes).find(quote => quote.marketState)?.marketState
  const freshness = quoteFreshness({ marketState, now: new Date() })
  return { ...freshness, quotes }
}
