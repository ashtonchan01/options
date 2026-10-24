/**
 * Read-only income plan for the account currently open. Settings are
 * editable; nothing on this page places, closes, or rolls a trade.
 * Account ids and Flex tokens are not part of the props.
 */
import { useEffect, useMemo, useState } from 'react'
import { loadMilestoneConfig } from '../dashboard/milestoneYears'
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
  accountRules,
  annualizedReturn,
  booksFor,
  btcCap,
  callCover,
  callYield,
  elState,
  exitUpside,
  milestoneIncome,
  pct,
  planPremium,
  putScreenRows,
  quoteFreshness,
  screenDays,
  toLiveBook,
  usd0,
  type AccountRole,
  type IncomeSource,
  type LiveBook,
  type MilestoneIncome,
} from '../../income/incomeLive'
import { fetchQuotes, type Quote } from '../../services/quotes'
import { useIncomePlan } from '../../store/incomePlanStore'

function formatExpiry(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

function moneyOrDash(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? '—' : usd0(value)
}

function aud0(n: number): string {
  return `A$${Math.round(n).toLocaleString('en-US')}`
}

function fxText(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 })
}

function monthsText(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 })
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

function nlvFor(books: LiveBook[], role: 'personal' | 'business'): number | undefined {
  const rows = books.filter(book => book.role === role)
  if (rows.length === 0) return undefined
  let sum = 0
  for (const book of rows) {
    if (book.netLiquidation == null || !Number.isFinite(book.netLiquidation)) return undefined
    sum += book.netLiquidation
  }
  return sum
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

function snapshotFor(role: AccountRole) {
  if (role === 'other') return []
  return SEED_SNAPSHOT_RULES.filter(rule => {
    if (rule.rule.startsWith('BTC beta')) return false
    if (role === 'personal' && (rule.rule.startsWith('Business') || rule.rule.startsWith('No ETF'))) return false
    if (role === 'business' && (rule.rule.startsWith('Personal') || rule.rule.startsWith('Every personal') || rule.rule.startsWith('Two or three personal'))) return false
    return true
  })
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
      {book.role === 'other' && (
        <p className="income-note">This account isn’t part of the Personal / Business split. Live balances only — no seeded plan.</p>
      )}
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

export default function IncomeView({ account, accounts, sessionKey }: { account: IncomeSource; accounts: IncomeSource[]; sessionKey: string | null }) {
  const { settings, update } = useIncomePlan(sessionKey)
  const milestone = useMemo(() => loadMilestoneConfig(), [])
  const now = useMemo(() => new Date(), [])
  const focus = useMemo(() => toLiveBook(account, now), [account, now])
  const books = useMemo(() => booksFor(accounts, now), [accounts, now])
  const quotes = useIncomeQuotes(focus)
  const role = focus.role === 'business' ? 'business' : focus.role === 'personal' ? 'personal' : null
  const plan = useMemo(() => milestoneIncome({
    config: milestone,
    today: now,
    personalNlv: nlvFor(books, 'personal'),
    businessNlv: nlvFor(books, 'business'),
    otherNlv: books.filter(book => book.role === 'other' && book.netLiquidation != null && Number.isFinite(book.netLiquidation)).map(book => book.netLiquidation as number),
    audUsd: quotes.audUsd,
    splitMode: settings.splitMode,
    personalSplitPct: settings.personalSplitPct,
    personalTaxRate: settings.personalTaxRate,
    businessTaxRate: settings.businessTaxRate,
    personalInterestAud: settings.personalInterestAud,
    businessInterestAud: settings.businessInterestAud,
  }), [milestone, now, books, quotes.audUsd, settings])
  const cap = useMemo(() => btcCap(books), [books])
  const rules = useMemo(() => accountRules(focus, settings), [focus, settings])
  const needed = role === 'personal' ? plan.current?.personalTarget ?? null : role === 'business' ? plan.current?.businessTarget ?? null : null
  const planNow = role ? planPremium(SEED_SELLS, role, 'now') : null
  const planAfter = role ? planPremium(SEED_SELLS, role, 'after') : null
  const gap = needed != null && planNow != null ? needed - planNow : null
  const days = screenDays(settings.screenExpiry)
  const puts = putScreenRows(SEED_PUTS, settings)
  const exitPrice = (symbol: string) => settings.exits.find(exit => exit.symbol === symbol)?.price
  const calls = role ? SEED_CALLS.filter(row => row.account === role) : []
  const snapshotRules = snapshotFor(focus.role)

  return (
    <div className="income-root" data-testid="income-root">
      <header className="income-head">
        <h1>Income plan · {focus.name}</h1>
        <p>
          Marks in the idea tables are the Friday {SEED_CLOSE_LABEL}, pulled {SEED_MARK_DATE}, and stay stale until the next regular session.
          Ideas only. This page does not place a trade. Milestone targets are AUD; the monthly figure is US$.
        </p>
      </header>

      {quotes.stale && (
        <div className="income-banner" data-testid="income-stale">
          <Stale label={quotes.label} />
          <span>Stock quotes and Flex position marks are not a regular-session print. Option mids below are the {SEED_CLOSE_LABEL}.</span>
        </div>
      )}

      <section className="income-card">
        <h2>Target vs plan <span className="income-hint">this account, per month</span></h2>
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
              <td>{focus.name}</td>
              <td className="n" data-testid="income-needed">{moneyOrDash(needed)}</td>
              <td className="n">{planNow == null ? '—' : <>{usd0(planNow)} <Source kind="snapshot" /></>}</td>
              <td className="n">{moneyOrDash(planAfter)}</td>
              <td className="n gap">{moneyOrDash(gap)}</td>
              <td className="n">{usd0(focus.realisedThisMonth)} <Source kind="live" /></td>
              <td className="n">{usd0(focus.openShortCloseCost)}</td>
            </tr>
          </tbody>
        </table>
        <p className="income-note">{settings.targetNote} Gap is needed minus plan now. The needed figure is this year’s target only.</p>
        {focus.role === 'other' && <p className="income-note">This account isn’t in the Personal / Business split, so it has no share of the monthly target.</p>}
        <p className={cap.noBooks ? 'income-note' : cap.over ? 'income-el below' : 'income-el ok'} data-testid="income-btc">
          {cap.noBooks ? 'BTC cap unknown. ' : cap.over ? 'BTC cap: over. ' : 'BTC cap: inside. '}
          {cap.detail}
        </p>
      </section>

      <TargetBreakdown plan={plan} milestoneStart={milestone.startCapital} milestoneRate={milestone.targetPct} role={focus.role} fxStale={quotes.fxFresh} settings={settings} />

      <AccountCard book={focus} settings={settings} freshLabel={quotes.label} stale={quotes.stale} />

      <details className="income-fold" open>
        <summary>Screen and floor settings</summary>
        <div className="income-settings">
          <NumField label="EL floor (US$)" value={settings.elFloor} testId="income-el-floor" onCommit={elFloor => update({ elFloor })} />
          <label className="income-field">
            <span>Split</span>
            <select value={settings.splitMode} onChange={e => update({ splitMode: e.target.value === 'fixed' ? 'fixed' : 'capital' })}>
              <option value="capital">By capital (live NLV)</option>
              <option value="fixed">Fixed %</option>
            </select>
          </label>
          <NumField label="Personal share % (fixed split)" value={settings.personalSplitPct} onCommit={personalSplitPct => update({ personalSplitPct })} />
          <NumField label="Personal tax %" value={Math.round(settings.personalTaxRate * 1000) / 10} onCommit={personalTaxRate => update({ personalTaxRate })} />
          <NumField label="Business tax %" value={Math.round(settings.businessTaxRate * 1000) / 10} onCommit={businessTaxRate => update({ businessTaxRate })} />
          <NumField label="Personal interest (A$/mo)" value={settings.personalInterestAud} onCommit={personalInterestAud => update({ personalInterestAud })} />
          <NumField label="Business interest (A$/mo)" value={settings.businessInterestAud} onCommit={businessInterestAud => update({ businessInterestAud })} />
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
          {focus.role === 'business' && settings.exits.map(exit => (
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
          <p className="income-note">Rank is premium / cash secured. {days} days from {SEED_MARK_DATE} to {formatExpiry(settings.screenExpiry)}. Tax and interest are settings for the split; the Milestone page still owns the year-end curve.</p>
        </div>
      </details>

      <details className="income-fold" open>
        <summary>Put screen ({formatExpiry(settings.screenExpiry)}) <Source kind="snapshot" /> {quotes.stale && <Stale label={quotes.label} />}</summary>
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
                    {quotes.quotes[row.symbol] && (
                      <div className="income-sub">{quotes.quotes[row.symbol].price.toFixed(2)} <Stale label={quotes.label} /></div>
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

      {calls.length > 0 && (
        <details className="income-fold" open>
          <summary>Call detail ({formatExpiry(settings.screenExpiry)}) <Source kind="snapshot" /></summary>
          <div>
            <table className="income-table">
              <thead>
                <tr>
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
                {calls.map(row => {
                  const cover = row.symbol === 'TSLA' && settings.tslaCallsCoveredOnly ? callCover(focus, 'TSLA', row.contracts) : null
                  const shares = focus.shares.find(holding => holding.symbol === row.symbol)?.quantity
                  return (
                    <tr key={row.label}>
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
      )}

      {focus.role === 'personal' && (
        <details className="income-fold" open>
          <summary>Personal repair detail <Source kind="snapshot" /></summary>
          <div>
            <RepairTable rows={SEED_PERSONAL_REPAIR} />
            <p className="income-note">{SEED_PERSONAL_REPAIR_NOTE} Buying power and leverage are from this snapshot only; they are not in the Flex parse.</p>
          </div>
        </details>
      )}

      {focus.role === 'business' && (
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
      )}

      <details className="income-fold" open>
        <summary>Risk rules</summary>
        <div>
          <p className="income-kicker">From this account <Source kind="live" /></p>
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
          {snapshotRules.length > 0 && (
            <>
              <p className="income-kicker">24 Oct snapshot <Source kind="snapshot" /></p>
              <table className="income-table">
                <thead>
                  <tr><th>Rule</th><th>Status</th><th>Then</th></tr>
                </thead>
                <tbody>
                  {snapshotRules.map(rule => (
                    <tr key={rule.rule}>
                      <td>{rule.rule}</td>
                      <td className={rule.status === 'Yes' ? 'pos' : 'neg'}>{rule.status}</td>
                      <td>{rule.now}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
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

function TargetBreakdown({ plan, milestoneStart, milestoneRate, role, fxStale, settings }: {
  plan: MilestoneIncome
  milestoneStart: number
  milestoneRate: number
  role: AccountRole
  fxStale: { stale: boolean; label: string } | null
  settings: IncomeSettings
}) {
  const current = plan.current
  const rawGap = current?.decEndUsd != null && plan.combinedNlv != null ? current.decEndUsd - plan.combinedNlv : null
  const clampedGap = rawGap == null ? null : Math.max(0, rawGap)
  const share = role === 'business' ? plan.businessShare : role === 'personal' ? plan.personalShare : null
  const tax = role === 'business' ? settings.businessTaxRate : settings.personalTaxRate
  const interestAud = role === 'business' ? settings.businessInterestAud : settings.personalInterestAud
  const accountTarget = role === 'business' ? current?.businessTarget : role === 'personal' ? current?.personalTarget : null
  const gross = current?.monthlyBaseUsd != null && share != null && !plan.taxNote ? (current.monthlyBaseUsd * share) / (1 - tax) : null
  const interestUsd = plan.audUsd != null ? interestAud * plan.audUsd : null
  return (
    <details className="income-fold" open>
      <summary>How this target is built</summary>
      <div>
        <p className="income-note">
          Milestone start {aud0(milestoneStart)} at {milestoneRate}% a year, from the Milestone page. This table uses each 31 Dec on that curve. End (Target) is the financial-year end, before the wealth tax. A negative gap to the milestone is clamped at zero, so the monthly base falls to interest only once capital is already above the checkpoint.
        </p>
        {current == null && <p className="income-note">No 31 Dec target is still ahead, so a monthly income target can’t be computed.</p>}
        {plan.nlvNote && <p className="income-note">{plan.nlvNote}</p>}
        {plan.fxNote && <p className="income-note">{plan.fxNote}</p>}
        {plan.splitNote && <p className="income-note">{plan.splitNote}</p>}
        {plan.taxNote && <p className="income-note">{plan.taxNote}</p>}
        {current && (
          <p className="income-note">
            End of Dec {current.year}: {aud0(current.decEndAud)}
            {current.decEndUsd != null ? ` · US$${usd0(current.decEndUsd)}` : ''}
            {plan.audUsd != null ? ` at ${fxText(plan.audUsd)} USD per AUD` : ''}
            {fxStale?.stale ? <> <Stale label={fxStale.label} /></> : plan.audUsd != null ? ' (live)' : ''}.
            {' '}Combined net liquidation {moneyOrDash(plan.combinedNlv)}.
            {' '}Clamped gap {moneyOrDash(clampedGap)}
            {rawGap != null && rawGap < 0 ? ' — capital is already above this checkpoint' : ''}.
            {' '}Months left {monthsText(current.months)}. Monthly base {moneyOrDash(current.monthlyBaseUsd)}.
            {' '}Split {settings.splitMode === 'fixed' ? 'fixed' : 'by capital'}: Personal {plan.personalShare == null ? '—' : pct(plan.personalShare)} (NLV {moneyOrDash(plan.personalNlv)}) · Business {plan.businessShare == null ? '—' : pct(plan.businessShare)} (NLV {moneyOrDash(plan.businessNlv)}).
            {role !== 'other' && (
              <>
                {' '}This account: base × share / (1 − {pct(tax)}) = {moneyOrDash(gross)}, plus interest {aud0(interestAud)}
                {interestUsd != null ? ` → US$${usd0(interestUsd)}` : ''}. Needed {moneyOrDash(accountTarget)}.
              </>
            )}
          </p>
        )}
        {plan.rows.length > 0 && (
          <table className="income-table">
            <thead>
              <tr>
                <th>31 Dec</th>
                <th className="n">End of Dec</th>
                <th className="n">End of Dec US$</th>
                <th className="n">End (Target)</th>
                <th className="n">Months</th>
                <th className="n">Monthly base</th>
                <th className="n">This account</th>
              </tr>
            </thead>
            <tbody>
              {plan.rows.map((row, index) => {
                const target = role === 'business' ? row.businessTarget : role === 'personal' ? row.personalTarget : null
                return (
                  <tr key={row.year} className={index === 0 ? 'tot' : undefined}>
                    <td>{row.year}{index === 0 ? ' · this year' : ''}</td>
                    <td className="n">{aud0(row.decEndAud)}</td>
                    <td className="n">{moneyOrDash(row.decEndUsd)}</td>
                    <td className="n">{aud0(row.fyEndAud)}</td>
                    <td className="n">{monthsText(row.months)}</td>
                    <td className="n">{moneyOrDash(row.monthlyBaseUsd)}</td>
                    <td className="n">{moneyOrDash(target)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </details>
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

function useIncomeQuotes(book: LiveBook) {
  const symbols = useMemo(() => {
    const set = new Set<string>(['AUDUSD=X'])
    for (const row of book.shares) set.add(row.symbol)
    for (const option of book.shortOptions) set.add(option.underlying)
    return [...set].sort()
  }, [book])
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
  const equity = Object.entries(quotes).filter(([symbol]) => symbol !== 'AUDUSD=X').map(([, quote]) => quote)
  const marketState = equity.find(quote => quote.marketState && quote.marketState.toUpperCase() !== 'REGULAR')?.marketState
    ?? equity.find(quote => quote.marketState)?.marketState
  const freshness = quoteFreshness({ marketState, now: new Date() })
  const fxQuote = quotes['AUDUSD=X']
  const audUsd = fxQuote && Number.isFinite(fxQuote.price) && fxQuote.price > 0 ? fxQuote.price : null
  const fxFresh = audUsd != null ? quoteFreshness({ marketState: fxQuote?.marketState, now: new Date() }) : null
  return { ...freshness, quotes, audUsd, fxFresh }
}
