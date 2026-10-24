/**
 * Read-only income plan for the account currently open. Settings are
 * editable; nothing on this page places, closes, or rolls a trade.
 * Account ids and Flex tokens are not part of the props.
 * Charts are inline SVG, the same approach as the Milestone page.
 */
import { useEffect, useMemo, useState } from 'react'
import { Activity, Banknote, CircleDollarSign, ShieldAlert, Target, Wallet } from 'lucide-react'
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
  type BtcCap,
  type IncomeSource,
  type LiveBook,
  type MilestoneIncome,
} from '../../income/incomeLive'
import { fetchQuotes, type Quote } from '../../services/quotes'
import { useIncomePlan } from '../../store/incomePlanStore'

function formatExpiry(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
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

function Chip({ children, kind }: { children: string; kind?: 'live' | 'snapshot' | 'stale' | 'ok' | 'bad' | 'warn' }) {
  return <span className={kind ? `income-flag ${kind}` : 'income-chip'}>{children}</span>
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

function snapshotFor(role: AccountRole) {
  if (role === 'other') return []
  return SEED_SNAPSHOT_RULES.filter(rule => {
    if (rule.rule.startsWith('BTC beta')) return false
    if (role === 'personal' && (rule.rule.startsWith('Business') || rule.rule.startsWith('No ETF'))) return false
    if (role === 'business' && (rule.rule.startsWith('Personal') || rule.rule.startsWith('Every personal') || rule.rule.startsWith('Two or three personal'))) return false
    return true
  })
}

function legTarget(role: AccountRole, personal: number | null, business: number | null): number | null {
  if (role === 'personal') return personal
  if (role === 'business') return business
  return null
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

function ProgressRing({ ratio }: { ratio: number | null }) {
  const r = 15
  const c = 2 * Math.PI * r
  const clamped = ratio == null || !Number.isFinite(ratio) ? 0 : Math.max(0, Math.min(1, ratio))
  const label = ratio == null || !Number.isFinite(ratio) ? '—' : `${Math.round(ratio * 100)}%`
  return (
    <svg className="income-ring" viewBox="0 0 40 40" role="img" aria-label={`Progress ${label}`}>
      <circle className="track" cx="20" cy="20" r={r} />
      <circle className="value" cx="20" cy="20" r={r} strokeDasharray={`${c * clamped} ${c}`} />
      <text x="20" y="21.5">{label}</text>
    </svg>
  )
}

function Meter({ ratio }: { ratio: number | null }) {
  const clamped = ratio == null || !Number.isFinite(ratio) ? 0 : Math.max(0, Math.min(1, ratio))
  return (
    <div className="income-meter" role="img" aria-label="Realised versus monthly target">
      <span style={{ width: `${clamped * 100}%` }} />
    </div>
  )
}

function StackedBar({ parts }: { parts: { label: string; value: number | null; tone: 'base' | 'tax' | 'interest' }[] }) {
  const known = parts.flatMap(part => (part.value != null && part.value > 0 ? [{ ...part, value: part.value }] : []))
  const total = known.reduce((sum, part) => sum + part.value, 0)
  const title = parts.map(part => `${part.label} ${moneyOrDash(part.value)}`).join(' · ')
  return (
    <div>
      <div className="income-stack" title={title}>
        {total > 0 ? known.map(part => (
          <span key={part.label} className={part.tone} style={{ width: `${(part.value / total) * 100}%` }} />
        )) : <span className="empty" />}
      </div>
      <div className="income-chips">
        {parts.map(part => <Chip key={part.label}>{`${part.label} ${moneyOrDash(part.value)}`}</Chip>)}
      </div>
    </div>
  )
}

function seriesPoints(values: number[], width: number, height: number, max: number): string {
  const span = max || 1
  return values.map((value, index) => {
    const x = values.length === 1 ? width / 2 : (index / (values.length - 1)) * width
    const y = height - (value / span) * height
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
}

function MilestoneChart({ rows, combinedNlv, audUsd }: { rows: MilestoneIncome['rows']; combinedNlv: number | null; audUsd: number | null }) {
  const usd = audUsd != null && audUsd > 0 && rows.every(row => row.decEndUsd != null)
  const dec = rows.map(row => (usd ? row.decEndAud * audUsd : row.decEndAud))
  const fy = rows.map(row => (usd ? row.fyEndAud * audUsd : row.fyEndAud))
  const capital = usd ? combinedNlv : null
  const max = Math.max(1, ...dec, ...fy, capital ?? 0)
  const w = 300
  const h = 108
  const capitalY = capital == null ? null : h - (capital / max) * h
  return (
    <svg className="income-svg" viewBox={`0 0 ${w} ${h + 16}`} role="img" aria-label="31 Dec milestone path versus current capital">
      {capitalY != null && <line className="capital" x1="0" x2={w} y1={capitalY} y2={capitalY} />}
      <polyline className="fy" points={seriesPoints(fy, w, h, max)} />
      <polyline className="dec" points={seriesPoints(dec, w, h, max)} />
      {rows.map((row, index) => {
        const x = rows.length === 1 ? w / 2 : (index / (rows.length - 1)) * w
        if (index !== 0 && index !== rows.length - 1 && index % 3 !== 0) return null
        return <text key={row.year} x={x} y={h + 12} textAnchor={index === 0 ? 'start' : index === rows.length - 1 ? 'end' : 'middle'}>{String(row.year).slice(2)}</text>
      })}
    </svg>
  )
}

function YearBars({ rows, role }: { rows: MilestoneIncome['rows']; role: AccountRole }) {
  const values = rows.map(row => legTarget(role, row.personalTarget, row.businessTarget))
  const max = Math.max(1, ...values.flatMap(value => (value != null && value > 0 ? [value] : [])))
  const w = 300
  const h = 108
  const slot = rows.length > 0 ? w / rows.length : w
  return (
    <svg className="income-svg" viewBox={`0 0 ${w} ${h + 16}`} role="img" aria-label="Monthly target by year">
      {rows.map((row, index) => {
        const value = values[index]
        const bar = value != null && value > 0 ? (value / max) * h : 0
        const x = index * slot + slot * 0.18
        return <rect key={row.year} className={index === 0 ? 'now' : 'later'} x={x} y={h - bar} width={slot * 0.64} height={bar}><title>{`${row.year} ${moneyOrDash(value)}`}</title></rect>
      })}
      {rows.map((row, index) => {
        if (index !== 0 && index !== rows.length - 1 && index % 3 !== 0) return null
        const x = index * slot + slot / 2
        return <text key={row.year} x={x} y={h + 12} textAnchor="middle">{String(row.year).slice(2)}</text>
      })}
    </svg>
  )
}

function BtcGauge({ cap }: { cap: BtcCap }) {
  const width = cap.noBooks ? '0%' : cap.over ? '100%' : '6%'
  return (
    <section className="income-panel">
      <h2>BTC cap</h2>
      <div className="income-gauge" data-testid="income-btc" title={cap.detail}>
        <div className="income-gauge-track">
          <span className={cap.noBooks ? 'unknown' : cap.over ? 'over' : 'ok'} style={{ width }} />
        </div>
        <div className="income-chips">
          <Chip kind={cap.noBooks ? undefined : cap.over ? 'bad' : 'ok'}>{cap.noBooks ? 'Unknown' : cap.over ? 'Over' : 'Inside'}</Chip>
          <Chip>{`MSTR ${Math.round(cap.mstrShares).toLocaleString('en-US')} sh`}</Chip>
          <Chip>{`MSTR puts ${cap.mstrPutContracts}`}</Chip>
          <Chip>{`BSOL puts ${cap.bsolPutContracts}`}</Chip>
          {cap.bsolShares !== 0 && <Chip kind="bad">{`BSOL ${Math.round(cap.bsolShares).toLocaleString('en-US')} sh`}</Chip>}
        </div>
      </div>
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
  const progress = needed != null && needed > 0 ? focus.realisedThisMonth / needed : null
  const days = screenDays(settings.screenExpiry)
  const puts = putScreenRows(SEED_PUTS, settings)
  const calls = role ? SEED_CALLS.filter(row => row.account === role) : []
  const sells = role ? SEED_SELLS.filter(sell => sell.account === role) : []
  const snapshotRules = snapshotFor(focus.role)
  const el = elState(focus.excessLiquidity, settings.elFloor)
  const elGap = focus.excessLiquidity == null ? null : Math.abs(focus.excessLiquidity - settings.elFloor)
  const share = focus.role === 'business' ? plan.businessShare : focus.role === 'personal' ? plan.personalShare : null
  const tax = focus.role === 'business' ? settings.businessTaxRate : settings.personalTaxRate
  const interestAud = focus.role === 'business' ? settings.businessInterestAud : settings.personalInterestAud
  const baseShare = plan.current?.monthlyBaseUsd != null && share != null ? plan.current.monthlyBaseUsd * share : null
  const gross = baseShare != null && !plan.taxNote ? baseShare / (1 - tax) : null
  const grossUp = gross != null && baseShare != null ? gross - baseShare : null
  const interestUsd = plan.audUsd != null && role ? interestAud * plan.audUsd : null
  const exitPrice = (symbol: string) => settings.exits.find(exit => exit.symbol === symbol)?.price
  const usdSeries = plan.rows.length > 0 && plan.rows.every(row => row.decEndUsd != null)

  return (
    <div className="income-root" data-testid="income-root">
      <header className="income-head">
        <h1>Income · {focus.name}</h1>
        <div className="income-chips">
          <Chip kind="snapshot">{SEED_CLOSE_LABEL}</Chip>
          {quotes.stale && <span data-testid="income-stale"><Chip kind="stale">{quotes.label}</Chip></span>}
          {focus.role === 'other' && <Chip kind="warn">Outside split</Chip>}
          {plan.nlvNote && <Chip kind="warn" >NLV missing</Chip>}
          {plan.fxNote && <Chip kind="warn">FX missing</Chip>}
          {plan.splitNote && <Chip kind="warn">Split unavailable</Chip>}
          {plan.taxNote && <Chip kind="warn">Tax rate</Chip>}
        </div>
      </header>

      <section className={`income-account${el === 'below' ? ' short' : ''}`} data-testid={`income-account-${focus.role}`}>
        <div className="income-kpis">
          <article className="income-kpi">
            <header><Target size={13} /> Monthly target</header>
            <strong data-testid="income-needed">{moneyOrDash(needed)}</strong>
            <span>US$ this year</span>
          </article>
          <article className="income-kpi">
            <header><Activity size={13} /> Realised</header>
            <strong className={focus.realisedThisMonth < 0 ? 'neg' : undefined}>{usd0(focus.realisedThisMonth)}</strong>
            <span>This month</span>
          </article>
          <article className="income-kpi ring">
            <header>Progress</header>
            <ProgressRing ratio={progress} />
            <span>Realised / target</span>
          </article>
          <article className="income-kpi">
            <header><Wallet size={13} /> Net liq</header>
            <strong>{moneyOrDash(focus.netLiquidation)}</strong>
            <span>US$</span>
          </article>
          <article className="income-kpi">
            <header><Banknote size={13} /> Cash</header>
            <strong>{moneyOrDash(focus.cash)}</strong>
            <span>US$</span>
          </article>
          <article className={`income-kpi${el === 'below' ? ' short' : ''}`}>
            <header><ShieldAlert size={13} /> Excess liquidity</header>
            <strong data-testid={`income-el-${focus.role}`}>{el === 'unknown' ? '—' : usd0(focus.excessLiquidity ?? 0)}</strong>
            <span className={el === 'below' ? 'bad' : el === 'ok' ? 'good' : undefined}>
              {el === 'unknown' && 'Not in snapshot'}
              {el === 'below' && `${usd0(elGap ?? 0)} below ${usd0(settings.elFloor)}`}
              {el === 'ok' && `${usd0(elGap ?? 0)} above ${usd0(settings.elFloor)}`}
            </span>
          </article>
        </div>
        <Meter ratio={progress} />
        <div className="income-chips">
          <Chip>{`Plan now ${moneyOrDash(planNow)}`}</Chip>
          <Chip>{`After repair ${moneyOrDash(planAfter)}`}</Chip>
          <Chip kind="warn">{`Gap ${moneyOrDash(gap)}`}</Chip>
          <Chip>{`Open short ${usd0(focus.openShortCloseCost)}`}</Chip>
          {quotes.stale && <Chip kind="stale">{`${quotes.label} · statement mark`}</Chip>}
        </div>
      </section>

      <div className="income-charts">
        <section className="income-panel">
          <h2>Milestone path</h2>
          {plan.rows.length > 0 ? <MilestoneChart rows={plan.rows} combinedNlv={plan.combinedNlv} audUsd={plan.audUsd} /> : <span className="income-hint">No 31 Dec ahead</span>}
          <div className="income-chips">
            <Chip kind="live">{usdSeries ? '31 Dec US$' : '31 Dec A$'}</Chip>
            <Chip>FY end</Chip>
            {usdSeries && plan.combinedNlv != null && <Chip>Capital</Chip>}
            {plan.audUsd != null && <Chip kind={quotes.fxFresh?.stale ? 'stale' : 'live'}>{`AUDUSD ${fxText(plan.audUsd)}`}</Chip>}
          </div>
        </section>
        <section className="income-panel">
          <h2>Monthly target</h2>
          {plan.rows.length > 0 ? <YearBars rows={plan.rows} role={focus.role} /> : <span className="income-hint">—</span>}
          <div className="income-chips">
            <Chip kind="live">This year</Chip>
            <Chip>Later years</Chip>
          </div>
        </section>
      </div>

      <section className="income-panel">
        <h2><CircleDollarSign size={13} /> Target build</h2>
        <StackedBar parts={[
          { label: 'Base', value: baseShare, tone: 'base' },
          { label: 'Tax', value: grossUp, tone: 'tax' },
          { label: 'Interest', value: interestUsd, tone: 'interest' },
        ]} />
        <details className="income-fold">
          <summary>How this is calculated</summary>
          <ul className="income-actions">
            <li>Milestone start {aud0(milestone.startCapital)} at {milestone.targetPct}% a year. Income reads that curve.</li>
            <li>Monthly base = max(0, 31 Dec target − combined net liq) / months left. Later years: gap between 31 Dec targets / 12.</li>
            <li>A gap below zero is clamped, so the target falls to interest only.</li>
            <li>{settings.targetNote}</li>
            {plan.current && <li>End of Dec {plan.current.year}: {aud0(plan.current.decEndAud)}{plan.current.decEndUsd != null ? ` · US$${usd0(plan.current.decEndUsd)}` : ''}. Months {monthsText(plan.current.months)}. Base {moneyOrDash(plan.current.monthlyBaseUsd)}.</li>}
            <li>Combined net liq {moneyOrDash(plan.combinedNlv)}. Personal {plan.personalShare == null ? '—' : pct(plan.personalShare)} ({moneyOrDash(plan.personalNlv)}). Business {plan.businessShare == null ? '—' : pct(plan.businessShare)} ({moneyOrDash(plan.businessNlv)}). Split {settings.splitMode === 'fixed' ? 'fixed' : 'by capital'}.</li>
            {role && <li>This account: base × share / (1 − {pct(tax)}) = {moneyOrDash(gross)}, plus interest {aud0(interestAud)}{interestUsd != null ? ` → US$${usd0(interestUsd)}` : ''}. Needed {moneyOrDash(needed)}.</li>}
            {plan.nlvNote && <li>{plan.nlvNote}</li>}
            {plan.fxNote && <li>{plan.fxNote}</li>}
            {plan.splitNote && <li>{plan.splitNote}</li>}
            {plan.taxNote && <li>{plan.taxNote}</li>}
            {focus.role === 'other' && <li>This account isn’t in the Personal / Business split, so it has no share of the monthly target.</li>}
            <li>Ideas only. This page does not place a trade. Marks are the {SEED_CLOSE_LABEL}, pulled {SEED_MARK_DATE}.</li>
          </ul>
          {plan.rows.length > 0 && (
            <table className="income-table">
              <thead>
                <tr>
                  <th>31 Dec</th>
                  <th className="n">End of Dec</th>
                  <th className="n">US$</th>
                  <th className="n">End (Target)</th>
                  <th className="n">Months</th>
                  <th className="n">Base</th>
                  <th className="n">This account</th>
                </tr>
              </thead>
              <tbody>
                {plan.rows.map((row, index) => (
                  <tr key={row.year} className={index === 0 ? 'tot' : undefined}>
                    <td>{row.year}</td>
                    <td className="n">{aud0(row.decEndAud)}</td>
                    <td className="n">{moneyOrDash(row.decEndUsd)}</td>
                    <td className="n">{aud0(row.fyEndAud)}</td>
                    <td className="n">{monthsText(row.months)}</td>
                    <td className="n">{moneyOrDash(row.monthlyBaseUsd)}</td>
                    <td className="n">{moneyOrDash(legTarget(focus.role, row.personalTarget, row.businessTarget))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </details>
      </section>

      <BtcGauge cap={cap} />

      {role && (
        <section className="income-panel">
          <h2>Ideas</h2>
          <ul className="income-actions">
            {SEED_NEXT_ACTIONS[role].map(step => <li key={step}>{step}</li>)}
          </ul>
          <div className="income-board">
            {sells.map(sell => (
              <article key={sell.label} className="income-mini">
                <strong>{sell.label}</strong>
                <div className="income-chips">
                  <Chip>{usd0(sell.premium)}</Chip>
                  <Chip>{sell.phase === 'now' ? 'Now' : 'After repair'}</Chip>
                  <Chip kind="snapshot">{sell.cover}</Chip>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {focus.shortOptions.length > 0 && (
        <section className="income-panel">
          <h2>Open shorts</h2>
          <div className="income-board">
            {focus.shortOptions.map(option => (
              <article key={`${option.underlying}-${option.putCall}-${option.strike}-${option.expiry}`} className="income-mini">
                <strong>{option.underlying}</strong>
                <div className="income-chips">
                  <Chip>{`${option.strike}${option.putCall}`}</Chip>
                  <Chip>{option.expiry || '—'}</Chip>
                  <Chip>{`Qty ${option.quantity}`}</Chip>
                  <Chip>{`Mark ${option.mark.toFixed(2)}`}</Chip>
                  <Chip>{`Close ${usd0(option.closeCost)}`}</Chip>
                  <Chip kind="stale">{quotes.stale ? quotes.label : 'Statement mark'}</Chip>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="income-panel">
        <h2>Puts · {formatExpiry(settings.screenExpiry)}</h2>
        <div className="income-chips">
          <Chip>{`Δ ${settings.deltaMin.toFixed(2)}–${settings.deltaMax.toFixed(2)}`}</Chip>
          <Chip>Premium / cash</Chip>
          <Chip>{`${days}d`}</Chip>
          {quotes.stale && <Chip kind="stale">{quotes.label}</Chip>}
        </div>
        <div className="income-board">
          {puts.map(row => (
            <article key={`${row.symbol}-${row.strike}`} className={`income-mini${row.excluded || row.blockedMstr ? ' muted' : ''}`}>
              <strong>{row.symbol}</strong>
              <div className="income-chips">
                <Chip>{`${row.strike}P`}</Chip>
                <Chip>{formatExpiry(settings.screenExpiry)}</Chip>
                <Chip kind={row.band === 'out' ? 'warn' : undefined}>{row.delta == null ? 'Δ n/a' : `Δ ${row.delta.toFixed(2)}`}</Chip>
                <Chip>{usd0(row.premium)}</Chip>
                <Chip>{pct(annualizedReturn(row.ratio, days))}</Chip>
                <Chip>{`Spot ${row.spot.toFixed(2)}`}</Chip>
                {quotes.quotes[row.symbol] && <Chip kind="stale">{quotes.quotes[row.symbol].price.toFixed(2)}</Chip>}
                <Chip kind="snapshot">{`${row.mid.toFixed(2)} (${row.bid.toFixed(2)}/${row.ask.toFixed(2)})`}</Chip>
                <Chip>{row.iv == null ? 'IV n/a' : `IV ${pct(row.iv)}`}</Chip>
                <Chip>{`Cash ${usd0(row.cash)}`}</Chip>
                <Chip>{pct(row.ratio)}</Chip>
                {row.excluded && <Chip kind="bad">Excluded</Chip>}
                {row.blockedMstr && <Chip kind="bad">No new MSTR puts</Chip>}
                {row.band === 'out' && <Chip kind="warn">Outside band</Chip>}
              </div>
              <span className="income-hint">{row.note}</span>
            </article>
          ))}
        </div>
        <details className="income-fold">
          <summary>How this is calculated</summary>
          <ul className="income-actions">
            <li>{SEED_PUT_NOTE}</li>
            <li>Rank is premium / cash secured, {days} days from {SEED_MARK_DATE} to {formatExpiry(settings.screenExpiry)}.</li>
          </ul>
        </details>
      </section>

      {calls.length > 0 && (
        <section className="income-panel">
          <h2>Calls</h2>
          <div className="income-board">
            {calls.map(row => {
              const cover = row.symbol === 'TSLA' && settings.tslaCallsCoveredOnly ? callCover(focus, 'TSLA', row.contracts) : null
              const shares = focus.shares.find(holding => holding.symbol === row.symbol)?.quantity
              return (
                <article key={row.label} className="income-mini">
                  <strong>{row.label}</strong>
                  <div className="income-chips">
                    <Chip>{row.delta == null ? 'Δ n/a' : `Δ ${row.delta.toFixed(2)}`}</Chip>
                    <Chip>{usd0(row.premium)}</Chip>
                    <Chip>{pct(callYield(row.premium, row.spot, row.contracts))}</Chip>
                    <Chip>{`Spot ${row.spot.toFixed(2)}`}</Chip>
                    <Chip kind="snapshot">{`${row.mid.toFixed(2)} (${row.bid.toFixed(2)}/${row.ask.toFixed(2)})`}</Chip>
                    {cover === 'covered' && <Chip kind="ok">{`Covered · ${usd0(shares ?? 0)} sh`}</Chip>}
                    {cover === 'short' && <Chip kind="bad">{`Uncovered · ${usd0(shares ?? 0)} sh`}</Chip>}
                    {cover === 'unknown' && <Chip kind="warn">Cover unknown</Chip>}
                    {cover == null && shares != null && <Chip>{`${usd0(shares)} sh`}</Chip>}
                  </div>
                </article>
              )
            })}
          </div>
          <details className="income-fold">
            <summary>How this is calculated</summary>
            <ul className="income-actions"><li>{SEED_CALL_NOTE}</li></ul>
          </details>
        </section>
      )}

      {focus.role === 'personal' && (
        <section className="income-panel">
          <h2>Repair</h2>
          <div className="income-board">
            {SEED_PERSONAL_REPAIR.map(row => (
              <article key={row.label} className="income-mini">
                <strong>{row.label}</strong>
                <div className="income-chips">
                  <Chip>{`Qty ${row.qty}`}</Chip>
                  <Chip>{`Mark ${row.mark}`}</Chip>
                  <Chip>{`Close ${row.closeCost}`}</Chip>
                  <Chip>{`Spot ${row.spot}`}</Chip>
                  <Chip>{row.state}</Chip>
                  <Chip kind="stale">{SEED_CLOSE_LABEL}</Chip>
                </div>
                <span className="income-hint">{row.idea}</span>
              </article>
            ))}
          </div>
          <details className="income-fold">
            <summary>How this is calculated</summary>
            <ul className="income-actions">
              <li>{SEED_PERSONAL_REPAIR_NOTE}</li>
              <li>Buying power and leverage are from this snapshot only.</li>
            </ul>
          </details>
        </section>
      )}

      {focus.role === 'business' && (
        <section className="income-panel">
          <h2>Pairs and exits</h2>
          <div className="income-board">
            {SEED_PAIRS.map(row => {
              const exit = row.exitSymbol ? exitPrice(row.exitSymbol) : undefined
              return (
                <article key={row.label} className="income-mini">
                  <strong>{row.label}</strong>
                  <div className="income-chips">
                    <Chip>{`Qty ${row.qty}`}</Chip>
                    <Chip>{`Spot ${row.spot.toFixed(2)}`}</Chip>
                    <Chip>{row.marks}</Chip>
                    <Chip kind={row.net.startsWith('-') ? 'warn' : 'ok'}>{row.net}</Chip>
                    <Chip>{row.shares}</Chip>
                    {exit != null
                      ? <Chip kind="warn">{`Exit ${usd0(exit)} · ${pct(exitUpside(row.spot, exit))}`}</Chip>
                      : row.cash ? <Chip>{`Cash ${row.cash}`}</Chip> : null}
                    <Chip kind="stale">{SEED_CLOSE_LABEL}</Chip>
                  </div>
                </article>
              )
            })}
            {SEED_BUSINESS_RISK.map(row => (
              <article key={row.label} className="income-mini">
                <strong>{row.label}</strong>
                <div className="income-chips">
                  <Chip>{`Qty ${row.qty}`}</Chip>
                  <Chip>{`Mark ${row.mark}`}</Chip>
                  <Chip>{`Close ${row.closeCost}`}</Chip>
                  <Chip>{`Spot ${row.spot}`}</Chip>
                  <Chip>{row.state}</Chip>
                </div>
                <span className="income-hint">{row.idea}</span>
              </article>
            ))}
          </div>
          <details className="income-fold">
            <summary>How this is calculated</summary>
            <ul className="income-actions"><li>{SEED_BUSINESS_NOTE}</li></ul>
          </details>
        </section>
      )}

      <section className="income-panel">
        <h2>Calendar</h2>
        <ol className="income-timeline">
          {SEED_CALENDAR.map(row => (
            <li key={row.date}>
              <strong>{row.date}</strong>
              <span>{row.event}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="income-panel">
        <h2>Rules</h2>
        <div className="income-rules">
          {rules.map(rule => (
            <div key={rule.id} className="income-rule" title={rule.detail}>
              <Chip kind={rule.status === 'yes' ? 'ok' : rule.status === 'no' ? 'bad' : 'warn'}>{rule.status === 'yes' ? 'Yes' : rule.status === 'no' ? 'No' : '?'}</Chip>
              <span>{rule.rule}</span>
            </div>
          ))}
          {snapshotRules.map(rule => (
            <div key={rule.rule} className="income-rule" title={rule.now}>
              <Chip kind={rule.status === 'Yes' ? 'ok' : 'bad'}>{rule.status}</Chip>
              <span>{rule.rule}</span>
              <Chip kind="snapshot">24 Oct</Chip>
            </div>
          ))}
        </div>
      </section>

      <details className="income-fold">
        <summary>Settings</summary>
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
            TSLA calls covered by shares
          </label>
        </div>
      </details>
    </div>
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
