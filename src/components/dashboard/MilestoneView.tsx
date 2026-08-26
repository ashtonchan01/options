/**
 * Wealth Timeline — projects a compounding target (default: $500,000 AUD
 * growing at 30%/yr) year-by-year, alongside the actual live net worth
 * summed across every account (IBKR netLiquidation, falling back to cash
 * balance for a statement-only account with no live snapshot). Highlights
 * the year each of $1M/$5M/$10M is first crossed, breaks each year down
 * into the monthly dollar return the target implies, and shows the year's
 * tax bill + after-tax profit at a flat configurable rate.
 *
 * The target is modelled entirely in AUD (the config's own currency) since
 * that's the number the user actually typed in; the "Actual" figure is
 * summed straight off IBKR accounts, which are USD-denominated here. The
 * AUD/USD toggle only changes DISPLAY currency — it converts whichever of
 * the two isn't already in that currency, via a live AUDUSD=X quote, it
 * does not change what's stored.
 */
import { Fragment, useEffect, useMemo, useState } from 'react'
import type { Account } from '../../store/accountsStore'
import { fetchQuotes } from '../../services/quotes'

const MILESTONES = [
  { label: '$1M', value: 1_000_000 },
  { label: '$5M', value: 5_000_000 },
  { label: '$10M', value: 10_000_000 },
]

interface Config {
  startCapital: number
  /** Starting year of an Australian financial year (1 Jul–30 Jun) — the
   * $500,000 start capital is banked from 1 Jul of this year, not 1 Jan,
   * so every year below runs Jul→Jun and every "month 1" is July. */
  startYear: number
  targetPct: number
  taxRate: number
  numYears: number
}

/** The financial-year start year (1 Jul–30 Jun) that today falls in — July
 * onward belongs to the FY starting this calendar year, Jan–Jun belongs to
 * the FY that started the previous calendar year. Mirrors reportsShared's
 * own fyOf() bucketing used elsewhere in the app (Reports/Calendar). */
function currentFyStartYear(): number {
  const now = new Date()
  return now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1
}

function fyLabel(startYear: number): string {
  return `FY ${startYear}/${String((startYear + 1) % 100).padStart(2, '0')}`
}

const DEFAULT_CONFIG: Config = {
  startCapital: 500_000,
  startYear: currentFyStartYear(),
  targetPct: 30,
  taxRate: 25,
  numYears: 14,
}

const CONFIG_KEY = 'options:milestone-config'
const EXCLUDED_ACCOUNTS_KEY = 'options:milestone-excluded-accounts'

/** Which accounts are excluded from "Actual", from localStorage — or, on a
 * fresh load with no saved preference yet, any account that looks like a
 * non-IBKR broker (e.g. "Moomoo"), since the target/tax framework here is
 * built around the IBKR-denominated figure and a differently-currencied
 * account would silently skew the combined total. Purely a one-time
 * default — the chips let it be changed either way afterward. */
function loadExcludedAccounts(accounts: Account[]): Set<string> {
  try {
    const raw = localStorage.getItem(EXCLUDED_ACCOUNTS_KEY)
    if (raw) return new Set(JSON.parse(raw))
  } catch { /* fall through to the name-based default below */ }
  return new Set(accounts.filter(a => /moomoo/i.test(a.name)).map(a => a.id))
}

function loadConfig(): Config {
  try {
    const raw = localStorage.getItem(CONFIG_KEY)
    if (!raw) return DEFAULT_CONFIG
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) }
  } catch {
    return DEFAULT_CONFIG
  }
}

function monthlyRate(pct: number): number {
  return Math.pow(1 + pct / 100, 1 / 12) - 1
}

interface YearRow {
  year: number
  start: number
  end: number
  grossPnl: number
  tax: number
  netPnl: number
  crossed: string[]
}

function buildYears(cfg: Config): YearRow[] {
  const r = monthlyRate(cfg.targetPct)
  const rows: YearRow[] = []
  let balance = cfg.startCapital
  let prevMilestonesHit = new Set<string>()
  for (let i = 0; i < cfg.numYears; i++) {
    const start = balance
    const end = start * Math.pow(1 + r, 12)
    const grossPnl = end - start
    const tax = grossPnl > 0 ? grossPnl * (cfg.taxRate / 100) : 0
    const netPnl = grossPnl - tax
    const crossed: string[] = []
    for (const m of MILESTONES) {
      if (end >= m.value && !prevMilestonesHit.has(m.label)) {
        crossed.push(m.label)
        prevMilestonesHit = new Set(prevMilestonesHit).add(m.label)
      }
    }
    rows.push({ year: cfg.startYear + i, start, end, grossPnl, tax, netPnl, crossed })
    balance = end
  }
  return rows
}

/** Which month (1-indexed) within the year a milestone is first reached, or
 * null if it isn't reached that year at all — used to phrase "reached in
 * month 8" rather than just flagging the whole year. */
function crossingMonth(start: number, end: number, target: number, r: number): number | null {
  if (target < start || target > end) return null
  const t = Math.log(target / start) / Math.log(1 + r)
  return Math.max(1, Math.min(12, Math.ceil(t)))
}

// Month 1 of a financial-year row is July, not January.
const FY_MONTH_NAMES = ['Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun']

/** A 1-indexed FY month (1=Jul .. 12=Jun) falls in calendar year `fyStartYear`
 * for Jul–Dec (indices 1–6) or `fyStartYear + 1` for Jan–Jun (indices 7–12). */
function calendarYearForFyMonth(fyStartYear: number, month: number): number {
  return month <= 6 ? fyStartYear : fyStartYear + 1
}

function fmt$(n: number): string {
  const sign = n < 0 ? '-' : ''
  return `${sign}$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}

function fmtCompact(n: number): string {
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(0)}K`
  return `${sign}$${abs.toFixed(0)}`
}

const ACCOUNT_COLORS = ['#38bdf8', '#f59e0b', '#a78bfa', '#f472b6', '#34d399', '#fb923c']

interface AccountActual { name: string; display: number }

/** Horizontal timeline: monthly-resolution target curve on a log-value
 * y-axis (compounding growth would otherwise squash the early, still-small
 * years down near zero pixels next to an $11M+ later year on a linear
 * scale) with the actual net-worth-today figure plotted as its own marker
 * against where the target curve expects the portfolio to be at this exact
 * point in time — both the combined total across every account, and each
 * account's own figure as its own line/marker so e.g. Personal and
 * Business stay visually distinguishable instead of only ever appearing
 * pre-summed. */
function TimelineChart({ cfg, r, toDisplayFromAud, actualDisplay, accountActuals, currentYear, monthsElapsed }: {
  cfg: Config; r: number; toDisplayFromAud: (v: number) => number
  actualDisplay: number; accountActuals: AccountActual[]; currentYear: number; monthsElapsed: number
}) {
  const totalMonths = cfg.numYears * 12
  const points = useMemo(() => {
    const pts: { t: number; value: number }[] = []
    for (let t = 0; t <= totalMonths; t++) {
      pts.push({ t, value: toDisplayFromAud(cfg.startCapital * Math.pow(1 + r, t)) })
    }
    return pts
  }, [cfg.startCapital, r, totalMonths, toDisplayFromAud])

  const actualT = (currentYear - cfg.startYear) + monthsElapsed / 12
  const actualInRange = actualT >= 0 && actualT <= totalMonths / 12

  // viewBox width is picked close to the chart's typical real rendered
  // width (desktop, sidebar expanded) rather than an arbitrary round number
  // — text/dot sizes are defined in user-space units that scale with
  // whatever the browser stretches this viewBox to, so a too-narrow viewBox
  // on a wide container scales everything up (this is what made "Actual
  // $269K" render nearly 2x its authored 10px size before).
  const W = 1800, H = 260, padL = 60, padR = 24, padT = 20, padB = 26
  const plotW = W - padL - padR, plotH = H - padT - padB

  const allValues = [
    ...points.map(p => p.value),
    ...(actualInRange ? [actualDisplay, ...accountActuals.map(a => a.display)] : []),
  ]
  const minV = Math.min(cfg.startCapital * 0.5, ...allValues)
  const maxV = Math.max(...allValues) * 1.08
  const logMin = Math.log10(Math.max(1, minV))
  const logMax = Math.log10(Math.max(10, maxV))

  const x = (tYears: number) => padL + (tYears / (totalMonths / 12)) * plotW
  const y = (v: number) => padT + plotH - ((Math.log10(Math.max(1, v)) - logMin) / (logMax - logMin)) * plotH

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.t / 12).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')

  const milestoneLines = MILESTONES
    .map(m => ({ ...m, display: toDisplayFromAud(m.value) }))
    .filter(m => m.display >= minV && m.display <= maxV)

  const yearTicks = Array.from({ length: cfg.numYears + 1 }, (_, i) => cfg.startYear + i)
    .filter((_, i) => cfg.numYears <= 10 || i % 2 === 0)

  const actualLabelRight = actualInRange && x(actualT) < W - 140

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      {milestoneLines.map(m => (
        <g key={m.label}>
          <line x1={padL} x2={W - padR} y1={y(m.display)} y2={y(m.display)}
            stroke="var(--text-5)" strokeOpacity={0.4} strokeDasharray="3,3" strokeWidth={1} />
          <text x={padL + 4} y={y(m.display) - 4} fontSize={9} fill="var(--text-4)" fontFamily="JetBrains Mono, monospace">
            {m.label}
          </text>
        </g>
      ))}

      <path d={linePath} fill="none" stroke="#10b981" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />

      {points.filter(p => p.t % 12 === 0).map(p => (
        <circle key={p.t} cx={x(p.t / 12)} cy={y(p.value)} r={1.8} fill="#10b981" />
      ))}

      {actualInRange && accountActuals.length > 1 && (
        <g>
          <circle cx={x(actualT)} cy={y(actualDisplay)} r={3.2} fill="#e5e7eb" stroke="var(--bg-card)" strokeWidth={1} />
          <text x={x(actualT) + (actualLabelRight ? 6 : -6)} y={y(actualDisplay) - 6} fontSize={9} fontWeight={700} fill="var(--text-1)"
            textAnchor={actualLabelRight ? 'start' : 'end'} fontFamily="JetBrains Mono, monospace">
            Combined {fmtCompact(actualDisplay)}
          </text>
        </g>
      )}

      {actualInRange && accountActuals.map((a, i) => {
        const color = ACCOUNT_COLORS[i % ACCOUNT_COLORS.length]
        // accountActuals.length === 1 means the combined dot above was
        // skipped (it'd sit exactly on top of this one account's own dot),
        // so this is the only marker on the chart in that case.
        const soloAccount = accountActuals.length === 1
        return (
          <g key={a.name}>
            <circle cx={x(actualT)} cy={y(a.display)} r={3} fill={color} stroke="var(--bg-card)" strokeWidth={1} />
            <text x={x(actualT) + (actualLabelRight ? 6 : -6)} y={y(a.display) - 6 + (soloAccount ? 0 : i % 2 === 0 ? -8 : 8)}
              fontSize={9} fontWeight={600} fill={color}
              textAnchor={actualLabelRight ? 'start' : 'end'} fontFamily="JetBrains Mono, monospace">
              {a.name} {fmtCompact(a.display)}
            </text>
          </g>
        )
      })}

      {yearTicks.map(yr => {
        const t = yr - cfg.startYear
        return (
          <text key={yr} x={x(t)} y={H - 8} fontSize={9} fill="var(--text-4)" textAnchor="middle" fontFamily="Inter, sans-serif">
            FY{String(yr).slice(-2)}
          </text>
        )
      })}
    </svg>
  )
}

export default function MilestoneView({ accounts }: { accounts: Account[] }) {
  const [cfg, setCfg] = useState<Config>(loadConfig)
  // Defaults to USD, not AUD — the IBKR accounts that feed "Actual" are
  // USD-denominated, so USD is the currency their real numbers need no FX
  // round-trip to display in; AUD is only the currency the target/start
  // capital was configured in.
  const [currency, setCurrency] = useState<'AUD' | 'USD'>('USD')
  const [expandedYear, setExpandedYear] = useState<number | null>(null)
  const [audUsd, setAudUsd] = useState<number | null>(null)
  // Which accounts to leave OUT of "Actual" — e.g. a broker whose synced
  // balance isn't trustworthy/relevant yet. Defaults to none excluded;
  // toggled per-account via the chips below and remembered across reloads.
  const [excludedAccounts, setExcludedAccounts] = useState<Set<string>>(() => loadExcludedAccounts(accounts))

  useEffect(() => {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg))
  }, [cfg])

  useEffect(() => {
    localStorage.setItem(EXCLUDED_ACCOUNTS_KEY, JSON.stringify([...excludedAccounts]))
  }, [excludedAccounts])

  function toggleAccount(id: string) {
    setExcludedAccounts(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const includedAccounts = accounts.filter(a => !excludedAccounts.has(a.id))

  useEffect(() => {
    let cancelled = false
    fetchQuotes(['AUDUSD=X']).then(quotes => {
      if (!cancelled && quotes['AUDUSD=X']?.price) setAudUsd(quotes['AUDUSD=X'].price)
    })
    return () => { cancelled = true }
  }, [])

  const rate = audUsd ?? 0.65

  // Target is modelled in AUD; Actual is summed straight off USD-denominated
  // IBKR accounts. Convert whichever one isn't already in the selected
  // display currency.
  const toDisplayFromAud = (v: number) => currency === 'AUD' ? v : v * rate
  const toDisplayFromUsd = (v: number) => currency === 'USD' ? v : v / rate

  const years = useMemo(() => buildYears(cfg), [cfg])
  const r = monthlyRate(cfg.targetPct)

  const actualNetWorthUsd = useMemo(
    () => includedAccounts.reduce((s, a) => s + (a.netLiquidation ?? a.cashBalance ?? 0), 0),
    [includedAccounts],
  )
  const actualDisplay = toDisplayFromUsd(actualNetWorthUsd)

  const accountActuals: AccountActual[] = includedAccounts
    .filter(a => (a.netLiquidation ?? a.cashBalance ?? 0) !== 0)
    .map(a => ({ name: a.name, display: toDisplayFromUsd(a.netLiquidation ?? a.cashBalance ?? 0) }))

  const currentYear = currentFyStartYear()
  const currentRow = years.find(y => y.year === currentYear)
  // Months fully elapsed since 1 Jul of the current FY, not since 1 Jan —
  // e.g. August is 1 month into the FY that started the preceding July.
  const monthsElapsed = (new Date().getMonth() - 6 + 12) % 12
  const expectedToday = currentRow ? currentRow.start * Math.pow(1 + r, monthsElapsed) : null
  const expectedTodayDisplay = expectedToday != null ? toDisplayFromAud(expectedToday) : null
  const variance = expectedTodayDisplay != null ? actualDisplay - expectedTodayDisplay : null

  return (
    <div className="ms-wrap">
      <div className="dash-panel" style={{ flex: '0 0 auto' }}>
        <div className="dash-panel-header">
          <span>Wealth Timeline</span>
          <div className="ms-currency-toggle">
            {(['AUD', 'USD'] as const).map(c => (
              <button key={c} className={`ms-chip${currency === c ? ' active' : ''}`} onClick={() => setCurrency(c)}>{c}</button>
            ))}
          </div>
        </div>
        <div className="ms-config-row">
          <label>Start capital
            <input type="number" value={cfg.startCapital}
              onChange={e => setCfg({ ...cfg, startCapital: Number(e.target.value) || 0 })} />
          </label>
          <label>Start FY (1 Jul)
            <input type="number" value={cfg.startYear}
              onChange={e => setCfg({ ...cfg, startYear: Number(e.target.value) || DEFAULT_CONFIG.startYear })} />
          </label>
          <label>Target return %/yr
            <input type="number" value={cfg.targetPct}
              onChange={e => setCfg({ ...cfg, targetPct: Number(e.target.value) || 0 })} />
          </label>
          <label>Tax rate %
            <input type="number" value={cfg.taxRate}
              onChange={e => setCfg({ ...cfg, taxRate: Number(e.target.value) || 0 })} />
          </label>
          <label>Years to project
            <input type="number" value={cfg.numYears}
              onChange={e => setCfg({ ...cfg, numYears: Math.max(1, Number(e.target.value) || 1) })} />
          </label>
        </div>
        {accounts.length > 0 && (
          <div className="ms-config-row" style={{ paddingTop: 0 }}>
            <label>Include in Actual
              <div className="ms-currency-toggle" style={{ marginTop: 3 }}>
                {accounts.map(a => (
                  <button key={a.id} className={`ms-chip${!excludedAccounts.has(a.id) ? ' active' : ''}`}
                    onClick={() => toggleAccount(a.id)} title={a.name}>
                    {a.name}
                  </button>
                ))}
              </div>
            </label>
          </div>
        )}
      </div>

      <div className="ms-summary-row">
        <div className="dash-panel ms-summary-tile">
          <div className="dash-panel-sub">Actual Net Worth Today ({currency})</div>
          <div className="ms-summary-value">{fmt$(actualDisplay)}</div>
          {expectedTodayDisplay != null && variance != null && (
            <div className="ms-summary-sub" style={{ color: variance >= 0 ? '#10b981' : '#ef4444' }}>
              {variance >= 0 ? '+' : ''}{fmt$(variance)} vs target pace
            </div>
          )}
        </div>
        {MILESTONES.map(m => {
          const row = years.find(y => y.crossed.includes(m.label))
          const alreadyActual = actualNetWorthUsd >= m.value * rate
          return (
            <div key={m.label} className={`dash-panel ms-summary-tile ms-milestone-tile${row ? ' hit' : ''}`}>
              <div className="dash-panel-sub">{m.label} Target</div>
              <div className="ms-summary-value">
                {row ? fyLabel(row.year) : '—'}
              </div>
              {row && (() => {
                const month = crossingMonth(row.start, row.end, m.value, r)
                if (!month) return null
                return <div className="ms-summary-sub">{FY_MONTH_NAMES[month - 1]} {calendarYearForFyMonth(row.year, month)}</div>
              })()}
              {alreadyActual && <div className="ms-summary-sub" style={{ color: '#10b981' }}>Already reached (actual)</div>}
            </div>
          )
        })}
      </div>

      <div className="dash-panel ms-timeline-panel">
        <div className="dash-panel-header"><span>Timeline</span></div>
        <TimelineChart cfg={cfg} r={r} toDisplayFromAud={toDisplayFromAud}
          actualDisplay={actualDisplay} accountActuals={accountActuals} currentYear={currentYear} monthsElapsed={monthsElapsed} />
        <div className="ms-timeline-scroll">
          {years.map(y => (
            <div key={y.year} className={`ms-timeline-year${y.crossed.length ? ' hit' : ''}${y.year === currentYear ? ' current' : ''}`}>
              <div className="ms-timeline-year-label">{fyLabel(y.year)}</div>
              <div className="ms-timeline-year-value">{fmt$(toDisplayFromAud(y.end))}</div>
              {y.crossed.map(c => <div key={c} className="ms-timeline-badge">{c}</div>)}
            </div>
          ))}
        </div>
      </div>

      <div className="dash-panel ms-table-panel">
        <div className="dash-panel-header"><span>Yearly Breakdown</span></div>
        <div className="ms-table-scroll">
          <table className="trade-table ms-table">
            <thead>
              <tr>
                <th></th>
                <th>Year</th>
                <th style={{ textAlign: 'right' }}>Start</th>
                <th style={{ textAlign: 'right' }}>End (Target)</th>
                <th style={{ textAlign: 'right' }}>Gross P&amp;L</th>
                <th style={{ textAlign: 'right' }}>Tax ({cfg.taxRate}%)</th>
                <th style={{ textAlign: 'right' }}>Net P&amp;L (after tax)</th>
                <th>Milestone</th>
              </tr>
            </thead>
            <tbody>
              {years.map(y => {
                const open = expandedYear === y.year
                return (
                  <Fragment key={y.year}>
                    <tr onClick={() => setExpandedYear(open ? null : y.year)} style={{ cursor: 'pointer' }}>
                      <td className="mono" style={{ color: 'var(--text-4)' }}>{open ? '▾' : '▸'}</td>
                      <td className="mono" style={{ fontWeight: 700 }}>{fyLabel(y.year)}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{fmt$(toDisplayFromAud(y.start))}</td>
                      <td className="mono" style={{ textAlign: 'right', fontWeight: 600 }}>{fmt$(toDisplayFromAud(y.end))}</td>
                      <td className="mono" style={{ textAlign: 'right', color: '#10b981' }}>{fmt$(toDisplayFromAud(y.grossPnl))}</td>
                      <td className="mono" style={{ textAlign: 'right', color: '#ef4444' }}>{fmt$(toDisplayFromAud(y.tax))}</td>
                      <td className="mono" style={{ textAlign: 'right', fontWeight: 600 }}>{fmt$(toDisplayFromAud(y.netPnl))}</td>
                      <td>{y.crossed.join(', ')}</td>
                    </tr>
                    {open && (
                      <tr>
                        <td colSpan={8} style={{ padding: 0 }}>
                          <div className="ms-month-grid">
                            {Array.from({ length: 12 }, (_, i) => {
                              const monthStart = y.start * Math.pow(1 + r, i)
                              const required = monthStart * r
                              return (
                                <div key={i} className="ms-month-cell">
                                  <div className="ms-month-label">{FY_MONTH_NAMES[i]}</div>
                                  <div className="ms-month-value">{fmt$(toDisplayFromAud(required))}</div>
                                </div>
                              )
                            })}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
