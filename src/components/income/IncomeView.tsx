/**
 * Read-only income plan for the account currently open. Settings are
 * editable; nothing on this page places, closes, or rolls a trade.
 * Account ids and Flex tokens are not part of the props.
 * Charts are inline SVG, the same approach as the Milestone page.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { loadMilestoneConfig } from '../dashboard/milestoneYears'
import { CHART_THEME } from '../shared/chartTheme'
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
} from '../../income/incomeSeed'
import {
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

const labelStyle = (extra?: CSSProperties): CSSProperties => ({
  fontFamily: CHART_THEME.fontFamily,
  fontSize: CHART_THEME.fontSize,
  color: 'var(--text-4)',
  lineHeight: 1.2,
  ...extra,
})

function axisLabel(value: number, aud: boolean): string {
  const sign = value < 0 ? '-' : ''
  const abs = Math.abs(value)
  const body = abs >= 1_000_000
    ? `${(abs / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
    : abs >= 1_000
      ? `${(abs / 1_000).toFixed(abs >= 10_000 ? 0 : 1).replace(/\.0$/, '')}k`
      : String(Math.round(abs))
  return aud ? `${sign}A$${body}` : `${sign}${body}`
}

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

function Lines({ children }: { children: ReactNode }) {
  return <div className="income-lines">{children}</div>
}

function Line({ children, muted, title }: { children: ReactNode; muted?: boolean; title?: string }) {
  return <div className={`income-line${muted ? ' muted' : ''}`} title={title}>{children}</div>
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

function progressLabel(ratio: number | null): string {
  return ratio == null || !Number.isFinite(ratio) ? '—' : `${Math.round(ratio * 100)}%`
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

function IncomePair({ children, single }: { children: ReactNode; single?: boolean }) {
  return (
    <div className="ov-top-grid" style={{ display: 'grid', gridTemplateColumns: single ? '1fr' : '1fr 1fr', gap: 10, alignItems: 'stretch' }}>
      {children}
    </div>
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
      <div className="income-chips income-legend" style={{ fontFamily: CHART_THEME.fontFamily, fontSize: CHART_THEME.fontSize }}>
        {parts.map(part => <Chip key={part.label}>{`${part.label} ${moneyOrDash(part.value)}`}</Chip>)}
      </div>
    </div>
  )
}

/** ViewBox is 0–100 so an HTML label's percentage matches the stretched SVG. */
const PLOT = { l: 22, r: 3, t: 28, b: 18 }

function plotX(index: number, count: number): number {
  const right = 100 - PLOT.r
  if (count <= 1) return (PLOT.l + right) / 2
  return PLOT.l + (index / (count - 1)) * (right - PLOT.l)
}

function plotY(value: number, max: number): number {
  const bottom = 100 - PLOT.b
  return PLOT.t + (1 - value / (max || 1)) * (bottom - PLOT.t)
}

function seriesPoints(values: number[], max: number): string {
  return values.map((value, index) => `${plotX(index, values.length).toFixed(1)},${plotY(value, max).toFixed(1)}`).join(' ')
}

function usePlotWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setWidth(el.clientWidth)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return { ref, width }
}

function yearIndexes(count: number, width: number): number[] {
  if (count <= 0) return []
  const plotPx = Math.max(80, width) * (100 - PLOT.l - PLOT.r) / 100
  const fit = Math.max(2, Math.floor(plotPx / 40))
  const step = Math.max(1, Math.ceil((count - 1) / (fit - 1)))
  const shown: number[] = []
  for (let index = 0; index < count; index += step) shown.push(index)
  if (shown[shown.length - 1] !== count - 1) {
    if (shown.length > 1 && count - 1 - shown[shown.length - 1] < step) shown.pop()
    shown.push(count - 1)
  }
  return shown
}

function ChartFrame({ label, children, labels }: { label: string; children: ReactNode; labels: (width: number) => ReactNode }) {
  const { ref, width } = usePlotWidth()
  return (
    <div ref={ref} className="income-plot" style={{ height: CHART_THEME.plotHeight }}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label={label}>
        {children}
      </svg>
      <div className="income-plot-labels">{labels(width)}</div>
    </div>
  )
}

function YLabels({ max, aud }: { max: number; aud: boolean }) {
  return (
    <>
      {[max, max / 2, 0].map(tick => (
        <span key={tick} style={labelStyle({ position: 'absolute', left: 4, top: `${plotY(tick, max)}%`, transform: 'translateY(-50%)' })}>
          {axisLabel(tick, aud)}
        </span>
      ))}
    </>
  )
}

function YearLabels({ rows, xAt, width }: { rows: { year: number }[]; xAt: (index: number) => number; width: number }) {
  const indexes = yearIndexes(rows.length, width)
  return (
    <>
      {indexes.map(index => {
        const first = index === 0
        const last = index === rows.length - 1
        return (
          <span key={rows[index].year} style={labelStyle({
            position: 'absolute',
            left: last ? undefined : `${xAt(index)}%`,
            right: last ? 4 : undefined,
            top: `${100 - PLOT.b + 3}%`,
            transform: first || last ? undefined : 'translateX(-50%)',
            whiteSpace: 'nowrap',
          })}>
            {String(rows[index].year).slice(2)}
          </span>
        )
      })}
    </>
  )
}

function ChartLegend({ children }: { children: ReactNode }) {
  return <div className="income-chips income-legend" style={{ fontFamily: CHART_THEME.fontFamily, fontSize: CHART_THEME.fontSize }}>{children}</div>
}

function MilestoneChart({ rows, combinedNlv, audUsd }: { rows: MilestoneIncome['rows']; combinedNlv: number | null; audUsd: number | null }) {
  const usd = audUsd != null && audUsd > 0 && rows.every(row => row.decEndUsd != null)
  const dec = rows.map(row => (usd ? row.decEndAud * audUsd : row.decEndAud))
  const fy = rows.map(row => (usd ? row.fyEndAud * audUsd : row.fyEndAud))
  const capital = usd ? combinedNlv : null
  const max = Math.max(1, ...dec, ...fy, capital ?? 0)
  const capitalY = capital == null ? null : plotY(capital, max)
  const right = 100 - PLOT.r
  return (
    <ChartFrame label="31 Dec milestone path versus current capital" labels={width => (
      <>
        <YLabels max={max} aud={!usd} />
        <YearLabels rows={rows} width={width} xAt={index => plotX(index, rows.length)} />
        {dec.length > 0 && (
          <span style={labelStyle({ position: 'absolute', top: 2, right: 6, fontWeight: 700, color: '#10b981' })}>
            {axisLabel(dec[dec.length - 1], !usd)}
          </span>
        )}
        {capital != null && (
          <span style={labelStyle({ position: 'absolute', top: 18, right: 6, fontWeight: 600 })}>
            {axisLabel(capital, false)}
          </span>
        )}
      </>
    )}>
      {[max, max / 2, 0].map(tick => (
        tick !== 0 && <line key={tick} x1={PLOT.l} x2={right} y1={plotY(tick, max)} y2={plotY(tick, max)} stroke="rgba(16,185,129,0.18)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      ))}
      {capitalY != null && <line x1={PLOT.l} x2={right} y1={capitalY} y2={capitalY} stroke="var(--text-3)" strokeWidth="1" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />}
      <polyline points={seriesPoints(fy, max)} fill="none" stroke="#f59e0b" strokeWidth="1.5" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
      <polyline points={seriesPoints(dec, max)} fill="none" stroke="#10b981" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </ChartFrame>
  )
}

function MonthLabels({ labels, years, xAt, width }: { labels: string[]; years: number[]; xAt: (index: number) => number; width: number }) {
  const indexes = yearIndexes(labels.length, width)
  return (
    <>
      {indexes.map((index, shown) => {
        const first = index === 0
        const last = index === labels.length - 1
        const yearChanged = shown === 0 || years[index] !== years[indexes[shown - 1]]
        const text = yearChanged ? `${labels[index]} '${String(years[index]).slice(2)}` : labels[index]
        return (
          <span key={`${years[index]}-${labels[index]}-${index}`} style={labelStyle({
            position: 'absolute',
            left: last ? undefined : `${xAt(index)}%`,
            right: last ? 4 : undefined,
            top: `${100 - PLOT.b + 3}%`,
            transform: first || last ? undefined : 'translateX(-50%)',
            whiteSpace: 'nowrap',
          })}>
            {text}
          </span>
        )
      })}
    </>
  )
}

/** Next twelve calendar months. Each month uses that calendar year's monthly
 * target from the milestone path — the same leg target the year table shows. */
function MonthlyBars({ rows, role, today }: { rows: MilestoneIncome['rows']; role: AccountRole; today: Date }) {
  const byYear = new Map(rows.map(row => [row.year, row]))
  const months = Array.from({ length: 12 }, (_, index) => {
    const date = new Date(today.getFullYear(), today.getMonth() + index, 1)
    const row = byYear.get(date.getFullYear())
    const value = row ? legTarget(role, row.personalTarget, row.businessTarget) : null
    const label = date.toLocaleDateString('en-US', { month: 'short' })
    return { key: `${date.getFullYear()}-${date.getMonth()}`, label, year: date.getFullYear(), value, current: index === 0 }
  })
  const max = Math.max(1, ...months.flatMap(month => (month.value != null && month.value > 0 ? [month.value] : [])))
  const slot = (100 - PLOT.l - PLOT.r) / months.length
  const slotX = (index: number) => PLOT.l + index * slot + slot / 2
  const first = months[0]?.value
  const right = 100 - PLOT.r
  return (
    <ChartFrame label="Monthly target for the next twelve months" labels={width => (
      <>
        <YLabels max={max} aud={false} />
        <MonthLabels labels={months.map(month => month.label)} years={months.map(month => month.year)} width={width} xAt={slotX} />
        {first != null && first > 0 && (
          <span style={labelStyle({ position: 'absolute', top: 2, right: 6, fontWeight: 700, color: '#10b981' })}>
            {axisLabel(first, false)}
          </span>
        )}
      </>
    )}>
      {[max, max / 2, 0].map(tick => (
        tick !== 0 && <line key={tick} x1={PLOT.l} x2={right} y1={plotY(tick, max)} y2={plotY(tick, max)} stroke="rgba(16,185,129,0.18)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      ))}
      {months.map((month, index) => {
        const top = month.value != null && month.value > 0 ? plotY(month.value, max) : plotY(0, max)
        const barH = Math.max(0, plotY(0, max) - top)
        const x = PLOT.l + index * slot + slot * 0.22
        return <rect key={month.key} x={x} y={top} width={slot * 0.56} height={barH} fill={month.current ? '#10b981' : '#f59e0b'} opacity={month.current ? 1 : 0.85}><title>{`${month.label} ${month.year} ${moneyOrDash(month.value)}`}</title></rect>
      })}
    </ChartFrame>
  )
}

const CRYPTO_COLOR = {
  BTC: '#f7931a',
  MSTR: '#a78bfa',
  BSOL: '#14f195',
} as const

function CryptoChip({ color, children, kind }: { color: string; children: string; kind?: 'live' | 'snapshot' | 'stale' | 'ok' | 'bad' | 'warn' }) {
  return (
    <span className="income-crypto">
      <span className="income-swatch" style={{ background: color }} aria-hidden="true" />
      <Chip kind={kind}>{children}</Chip>
    </span>
  )
}

function BtcGauge({ cap }: { cap: BtcCap }) {
  const width = cap.noBooks ? '0%' : cap.over ? '100%' : '6%'
  return (
    <IncomePanel emoji="₿" title="Crypto gauge">
      <div className="income-gauge" data-testid="income-btc" title={cap.detail}>
        <div className="income-gauge-track">
          <span className={cap.noBooks ? 'unknown' : cap.over ? 'over' : 'ok'} style={{ width }} />
        </div>
        <div className="income-chips">
          <Chip kind={cap.noBooks ? undefined : cap.over ? 'bad' : 'ok'}>{cap.noBooks ? 'Unknown' : cap.over ? 'Over' : 'Inside'}</Chip>
          <CryptoChip color={CRYPTO_COLOR.MSTR}>{`MSTR ${Math.round(cap.mstrShares).toLocaleString('en-US')} sh`}</CryptoChip>
          <CryptoChip color={CRYPTO_COLOR.MSTR}>{`MSTR puts ${cap.mstrPutContracts}`}</CryptoChip>
          <CryptoChip color={CRYPTO_COLOR.BSOL}>{`BSOL puts ${cap.bsolPutContracts}`}</CryptoChip>
          {cap.bsolShares !== 0 && <CryptoChip color={CRYPTO_COLOR.BSOL} kind="bad">{`BSOL ${Math.round(cap.bsolShares).toLocaleString('en-US')} sh`}</CryptoChip>}
        </div>
        <div className="income-chips income-legend" aria-label="Crypto colours">
          <CryptoChip color={CRYPTO_COLOR.BTC}>BTC</CryptoChip>
          <CryptoChip color={CRYPTO_COLOR.MSTR}>MSTR</CryptoChip>
          <CryptoChip color={CRYPTO_COLOR.BSOL}>BSOL</CryptoChip>
        </div>
      </div>
    </IncomePanel>
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
  const needed = role === 'personal' ? plan.current?.personalTarget ?? null : role === 'business' ? plan.current?.businessTarget ?? null : null
  const planNow = role ? planPremium(SEED_SELLS, role, 'now') : null
  const planAfter = role ? planPremium(SEED_SELLS, role, 'after') : null
  const gap = needed != null && planNow != null ? needed - planNow : null
  const progress = needed != null && needed > 0 ? focus.realisedThisMonth / needed : null
  const days = screenDays(settings.screenExpiry)
  const puts = putScreenRows(SEED_PUTS, settings)
  const calls = role ? SEED_CALLS.filter(row => row.account === role) : []
  const sells = role ? SEED_SELLS.filter(sell => sell.account === role) : []
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
    <div className="jr-root income-root" data-testid="income-root" style={{ height: 'auto', overflow: 'visible', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <section className="dash-panel income-panel">
        <div className="dash-panel-header">
          <EmojiTitle emoji="💸">Income · {focus.name}</EmojiTitle>
          <div className="income-chips">
            <Chip kind="snapshot">{SEED_CLOSE_LABEL}</Chip>
            {quotes.stale && <span data-testid="income-stale"><Chip kind="stale">{quotes.label}</Chip></span>}
            {focus.role === 'other' && <Chip kind="warn">Outside split</Chip>}
            {plan.nlvNote && <Chip kind="warn">NLV missing</Chip>}
            {plan.fxNote && <Chip kind="warn">FX missing</Chip>}
            {plan.splitNote && <Chip kind="warn">Split unavailable</Chip>}
            {plan.taxNote && <Chip kind="warn">Tax rate</Chip>}
          </div>
        </div>
        <details className="income-fold income-settings-fold">
          <summary><EmojiTitle emoji="⚙️">Settings</EmojiTitle></summary>
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
      </section>

      <section className="dash-panel income-panel" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="income-kpis" data-testid={`income-account-${focus.role}`}>
          <article className="income-kpi">
            <div className="income-kpi-label"><EmojiTitle emoji="🎯">Target</EmojiTitle></div>
            <div className="income-kpi-value" data-testid="income-needed">{moneyOrDash(needed)}</div>
            <div className="income-kpi-sub">US$ this year</div>
          </article>
          <article className="income-kpi">
            <div className="income-kpi-label"><EmojiTitle emoji="💵">Realised</EmojiTitle></div>
            <div className={`income-kpi-value${focus.realisedThisMonth < 0 ? ' neg' : ''}`}>{usd0(focus.realisedThisMonth)}</div>
            <div className="income-kpi-sub">This month</div>
          </article>
          <article className="income-kpi">
            <div className="income-kpi-label"><EmojiTitle emoji="📈">Progress</EmojiTitle></div>
            <div className="income-kpi-value">{progressLabel(progress)}</div>
            <div className="income-kpi-sub">Realised / target</div>
          </article>
          <article className="income-kpi">
            <div className="income-kpi-label"><EmojiTitle emoji="💼">Net liq</EmojiTitle></div>
            <div className="income-kpi-value">{moneyOrDash(focus.netLiquidation)}</div>
            <div className="income-kpi-sub">US$</div>
          </article>
          <article className="income-kpi">
            <div className="income-kpi-label"><EmojiTitle emoji="🪙">Cash</EmojiTitle></div>
            <div className="income-kpi-value">{moneyOrDash(focus.cash)}</div>
            <div className="income-kpi-sub">US$</div>
          </article>
          <article className={`income-kpi income-account${el === 'below' ? ' short' : ''}`}>
            <div className="income-kpi-label"><EmojiTitle emoji="🛡️">Excess liquidity</EmojiTitle></div>
            <div className="income-kpi-value" data-testid={`income-el-${focus.role}`}>{el === 'unknown' ? '—' : usd0(focus.excessLiquidity ?? 0)}</div>
            <div className={`income-kpi-sub${el === 'below' ? ' bad' : el === 'ok' ? ' good' : ''}`}>
              {el === 'unknown' && 'Not in snapshot'}
              {el === 'below' && `${usd0(elGap ?? 0)} below ${usd0(settings.elFloor)}`}
              {el === 'ok' && `${usd0(elGap ?? 0)} above ${usd0(settings.elFloor)}`}
            </div>
          </article>
        </div>
      </section>

      <IncomePair>
        <IncomePanel emoji="📊" title="This month">
          <Meter ratio={progress} />
          <div className="income-chips">
            <Chip>{`Plan now ${moneyOrDash(planNow)}`}</Chip>
            <Chip>{`After repair ${moneyOrDash(planAfter)}`}</Chip>
            <Chip kind="warn">{`Gap ${moneyOrDash(gap)}`}</Chip>
            <Chip>{`Open short ${usd0(focus.openShortCloseCost)}`}</Chip>
            {quotes.stale && <Chip kind="stale">{`${quotes.label} · statement mark`}</Chip>}
          </div>
        </IncomePanel>
        <IncomePanel emoji="🧮" title="Target breakdown">
        <div className="dash-panel-sub"><EmojiTitle emoji="🏦">Interest {aud0(interestAud)}{interestUsd != null ? ` · US$${usd0(interestUsd)}` : ''}</EmojiTitle></div>
        <StackedBar parts={[
          { label: 'Base', value: baseShare, tone: 'base' },
          { label: 'Tax', value: grossUp, tone: 'tax' },
          { label: 'Interest', value: interestUsd, tone: 'interest' },
        ]} />
        <details className="income-fold">
          <summary><EmojiTitle emoji="ℹ️">How this is calculated</EmojiTitle></summary>
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
        </IncomePanel>
      </IncomePair>

      <IncomePair>
        <IncomePanel emoji="🗺️" title="Milestone path">
          {plan.rows.length > 0 ? <MilestoneChart rows={plan.rows} combinedNlv={plan.combinedNlv} audUsd={plan.audUsd} /> : <span className="income-hint">No 31 Dec ahead</span>}
          <ChartLegend>
            <Chip kind="live">{usdSeries ? '31 Dec US$' : '31 Dec A$'}</Chip>
            <Chip>FY end</Chip>
            {usdSeries && plan.combinedNlv != null && <Chip>Capital</Chip>}
            {plan.audUsd != null && <Chip kind={quotes.fxFresh?.stale ? 'stale' : 'live'}>{`AUDUSD ${fxText(plan.audUsd)}`}</Chip>}
          </ChartLegend>
        </IncomePanel>
        <IncomePanel emoji="📅" title="Monthly targets">
          {plan.rows.length > 0 ? <MonthlyBars rows={plan.rows} role={focus.role} today={now} /> : <span className="income-hint">—</span>}
          <ChartLegend>
            <Chip kind="live">This month</Chip>
            <Chip>Later months</Chip>
          </ChartLegend>
        </IncomePanel>
      </IncomePair>

      {(focus.shortOptions.length > 0 || role) && (
        <IncomePair single={!(focus.shortOptions.length > 0 && role)}>
          {focus.shortOptions.length > 0 && (
            <IncomePanel emoji="💰" title="Open shorts">
              <Lines>
                {focus.shortOptions.map(option => (
                  <Line key={`${option.underlying}-${option.putCall}-${option.strike}-${option.expiry}`}>
                    <strong>{option.underlying}</strong>
                    <span>{`${option.strike}${option.putCall}`}</span>
                    <span>{option.expiry || '—'}</span>
                    <span>{`Qty ${option.quantity}`}</span>
                    <span>{`Mark ${option.mark.toFixed(2)}`}</span>
                    <span>{`Close ${usd0(option.closeCost)}`}</span>
                    <span className="income-hint">{quotes.stale ? quotes.label : 'Statement mark'}</span>
                  </Line>
                ))}
              </Lines>
            </IncomePanel>
          )}
          {role && (
            <IncomePanel emoji="💡" title="Ideas">
              <Lines>
                {SEED_NEXT_ACTIONS[role].map(step => (
                  <Line key={step} title={step}>{step}</Line>
                ))}
                {sells.map(sell => (
                  <Line key={sell.label} title={sell.cover}>
                    <strong>{sell.label}</strong>
                    <span>{usd0(sell.premium)}</span>
                    <span>{sell.phase === 'now' ? 'Now' : 'After repair'}</span>
                    <span>{sell.cover}</span>
                  </Line>
                ))}
              </Lines>
            </IncomePanel>
          )}
        </IncomePair>
      )}

      <div className="income-trio">
      <IncomePanel emoji="📉" title={`Puts · ${formatExpiry(settings.screenExpiry)}`}>
        <div className="income-chips">
          <Chip>{`Δ ${settings.deltaMin.toFixed(2)}–${settings.deltaMax.toFixed(2)}`}</Chip>
          <Chip>Premium / cash</Chip>
          <Chip>{`${days}d`}</Chip>
          {quotes.stale && <Chip kind="stale">{quotes.label}</Chip>}
        </div>
        <Lines>
          {puts.map(row => (
            <Line key={`${row.symbol}-${row.strike}`} muted={row.excluded || row.blockedMstr} title={row.note}>
              <strong>{row.symbol}</strong>
              <span>{`${row.strike}P`}</span>
              <span>{formatExpiry(settings.screenExpiry)}</span>
              <span>{row.delta == null ? 'Δ n/a' : `Δ ${row.delta.toFixed(2)}`}</span>
              <span>{usd0(row.premium)}</span>
              <span>{pct(annualizedReturn(row.ratio, days))}</span>
              <span>{`Spot ${row.spot.toFixed(2)}`}</span>
              {quotes.quotes[row.symbol] && <span>{quotes.quotes[row.symbol].price.toFixed(2)}</span>}
              <span>{`${row.mid.toFixed(2)} (${row.bid.toFixed(2)}/${row.ask.toFixed(2)})`}</span>
              <span>{row.iv == null ? 'IV n/a' : `IV ${pct(row.iv)}`}</span>
              <span>{`Cash ${usd0(row.cash)}`}</span>
              <span>{pct(row.ratio)}</span>
              {row.excluded && <span>Excluded</span>}
              {row.blockedMstr && <span>No new MSTR puts</span>}
              {row.band === 'out' && <span>Outside band</span>}
            </Line>
          ))}
        </Lines>
        <details className="income-fold">
          <summary><EmojiTitle emoji="📝">How this is calculated</EmojiTitle></summary>
          <ul className="income-actions">
            <li>{SEED_PUT_NOTE}</li>
            <li>Rank is premium / cash secured, {days} days from {SEED_MARK_DATE} to {formatExpiry(settings.screenExpiry)}.</li>
          </ul>
        </details>
      </IncomePanel>

      {calls.length > 0 && (
        <IncomePanel emoji="📞" title="Calls">
          <Lines>
            {calls.map(row => {
              const cover = row.symbol === 'TSLA' && settings.tslaCallsCoveredOnly ? callCover(focus, 'TSLA', row.contracts) : null
              const shares = focus.shares.find(holding => holding.symbol === row.symbol)?.quantity
              return (
                <Line key={row.label}>
                  <strong>{row.label}</strong>
                  <span>{row.delta == null ? 'Δ n/a' : `Δ ${row.delta.toFixed(2)}`}</span>
                  <span>{usd0(row.premium)}</span>
                  <span>{pct(callYield(row.premium, row.spot, row.contracts))}</span>
                  <span>{`Spot ${row.spot.toFixed(2)}`}</span>
                  <span>{`${row.mid.toFixed(2)} (${row.bid.toFixed(2)}/${row.ask.toFixed(2)})`}</span>
                  {cover === 'covered' && <span>{`Covered · ${usd0(shares ?? 0)} sh`}</span>}
                  {cover === 'short' && <span>{`Uncovered · ${usd0(shares ?? 0)} sh`}</span>}
                  {cover === 'unknown' && <span>Cover unknown</span>}
                  {cover == null && shares != null && <span>{`${usd0(shares)} sh`}</span>}
                </Line>
              )
            })}
          </Lines>
          <details className="income-fold">
            <summary><EmojiTitle emoji="🗒️">How this is calculated</EmojiTitle></summary>
            <ul className="income-actions"><li>{SEED_CALL_NOTE}</li></ul>
          </details>
        </IncomePanel>
      )}

      {focus.role === 'business' && (
        <IncomePanel emoji="⚖️" title="Pair exits">
          <Lines>
            {SEED_PAIRS.map(row => {
              const exit = row.exitSymbol ? exitPrice(row.exitSymbol) : undefined
              return (
                <Line key={row.label}>
                  <strong>{row.label}</strong>
                  <span>{`Qty ${row.qty}`}</span>
                  <span>{`Spot ${row.spot.toFixed(2)}`}</span>
                  <span>{row.marks}</span>
                  <span>{row.net}</span>
                  <span>{row.shares}</span>
                  {exit != null
                    ? <span>{`Exit ${usd0(exit)} · ${pct(exitUpside(row.spot, exit))}`}</span>
                    : row.cash ? <span>{`Cash ${row.cash}`}</span> : null}
                  <span className="income-hint">{SEED_CLOSE_LABEL}</span>
                </Line>
              )
            })}
            {SEED_BUSINESS_RISK.map(row => (
              <Line key={row.label} title={row.idea}>
                <strong>{row.label}</strong>
                <span>{`Qty ${row.qty}`}</span>
                <span>{`Mark ${row.mark}`}</span>
                <span>{`Close ${row.closeCost}`}</span>
                <span>{`Spot ${row.spot}`}</span>
                <span>{row.state}</span>
                <span>{row.idea}</span>
              </Line>
            ))}
          </Lines>
          <details className="income-fold">
            <summary><EmojiTitle emoji="📃">How this is calculated</EmojiTitle></summary>
            <ul className="income-actions"><li>{SEED_BUSINESS_NOTE}</li></ul>
          </details>
        </IncomePanel>
      )}
      </div>

      {focus.role === 'personal' && (
        <IncomePanel emoji="🔧" title="Repair">
          <Lines>
            {SEED_PERSONAL_REPAIR.map(row => (
              <Line key={row.label} title={row.idea}>
                <strong>{row.label}</strong>
                <span>{`Qty ${row.qty}`}</span>
                <span>{`Mark ${row.mark}`}</span>
                <span>{`Close ${row.closeCost}`}</span>
                <span>{`Spot ${row.spot}`}</span>
                <span>{row.state}</span>
                <span>{row.idea}</span>
              </Line>
            ))}
          </Lines>
          <details className="income-fold">
            <summary><EmojiTitle emoji="📄">How this is calculated</EmojiTitle></summary>
            <ul className="income-actions">
              <li>{SEED_PERSONAL_REPAIR_NOTE}</li>
              <li>Buying power and leverage are from this snapshot only.</li>
            </ul>
          </details>
        </IncomePanel>
      )}

      <IncomePair>
        <IncomePanel emoji="⏳" title="Expiry timeline">
          <ol className="income-timeline">
            {SEED_CALENDAR.map(row => (
              <li key={row.date}>
                <strong>{row.date}</strong>
                <span>{row.event}</span>
              </li>
            ))}
          </ol>
        </IncomePanel>
        <BtcGauge cap={cap} />
      </IncomePair>

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
