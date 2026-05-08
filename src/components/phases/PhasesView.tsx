import { useMemo } from 'react'
import type { AppState, RawTrade } from '../../types'

interface Props { state: AppState }

// ── Phase definitions ────────────────────────────────────────────────────────

interface Phase {
  id: number
  label: string
  sublabel: string
  range: string
  color: string
  floor: number
  target: number
  contractRule: string
  weeklyTarget: number
  annualROI: string
  strategyMix: string
}

const PHASES: Phase[] = [
  { id: 1, label: 'PHASE 1', sublabel: 'Survival', range: '$0–$50k', color: '#10b981', floor: 0, target: 50000, contractRule: '1 contract per position', weeklyTarget: 500, annualROI: '50%+', strategyMix: 'CSPs on quality names, small CC lots' },
  { id: 2, label: 'PHASE 2', sublabel: 'Building', range: '$50k–$150k', color: '#3b82f6', floor: 50000, target: 150000, contractRule: '1–3 contracts, diversify', weeklyTarget: 1500, annualROI: '40%', strategyMix: 'Wheel strategy, 3–5 underlyings' },
  { id: 3, label: 'PHASE 3', sublabel: 'Acceleration', range: '$150k–$500k', color: '#f59e0b', floor: 150000, target: 500000, contractRule: '2–5 contracts, scale winners', weeklyTarget: 4000, annualROI: '30%', strategyMix: 'Wheel + PMCCs + spreads, 5–8 underlyings' },
  { id: 4, label: 'PHASE 4', sublabel: 'Income Machine', range: '$500k+', color: '#a855f7', floor: 500000, target: 1500000, contractRule: 'Size to 2% risk per position', weeklyTarget: 10000, annualROI: '20%', strategyMix: 'Full wheel + income portfolio, 8+ underlyings' },
]

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt$(n: number, d = 0) {
  return (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
}
function fmtK(n: number) {
  return Math.abs(n) >= 1000 ? (n < 0 ? '-' : '') + '$' + (Math.abs(n) / 1000).toFixed(1) + 'k' : fmt$(n)
}

function getPhase(capital: number): Phase {
  if (capital >= 500000) return PHASES[3]
  if (capital >= 150000) return PHASES[2]
  if (capital >= 50000) return PHASES[1]
  return PHASES[0]
}

function monthKey(dateStr: string): string {
  if (dateStr.length === 8) return `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}`
  return dateStr.slice(0, 7)
}

function monthLabel(key: string): string {
  const [y, m] = key.split('-')
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
}

// ── Projection engine ────────────────────────────────────────────────────────

interface ProjectionPoint { month: number; capital: number; phase: number; income: number }

function projectGrowth(startCapital: number, monthlyReturnPct: number, months: number): ProjectionPoint[] {
  const data: ProjectionPoint[] = [{ month: 0, capital: startCapital, phase: getPhase(startCapital).id, income: 0 }]
  let capital = startCapital
  for (let m = 1; m <= months; m++) {
    const income = capital * (monthlyReturnPct / 100)
    capital += income
    data.push({ month: m, capital, phase: getPhase(capital).id, income })
  }
  return data
}

// ── Monthly income from trades ───────────────────────────────────────────────

interface MonthIncome { key: string; label: string; optionIncome: number; total: number; trades: number }

function buildMonthlyIncome(trades: RawTrade[]): MonthIncome[] {
  const map = new Map<string, MonthIncome>()
  for (const t of trades) {
    if (!t.tradeDate) continue
    const key = monthKey(t.tradeDate)
    if (!map.has(key)) map.set(key, { key, label: monthLabel(key), optionIncome: 0, total: 0, trades: 0 })
    const m = map.get(key)!
    if (t.assetClass === 'OPT' && t.netCash > 0) m.optionIncome += t.netCash
    m.total += t.netCash
    m.trades++
  }
  return [...map.values()].sort((a, b) => a.key.localeCompare(b.key))
}

// ── Phase progress bar component ─────────────────────────────────────────────

function PhaseProgressBar({ capital }: { capital: number }) {
  const maxTarget = PHASES[3].target
  const overallPct = Math.min((capital / maxTarget) * 100, 100)

  return (
    <div>
      {/* Phase segments */}
      <div style={{ display: 'flex', gap: 2, marginBottom: 6 }}>
        {PHASES.map(p => {
          const segStart = p.floor
          const segEnd = p.target
          const segWidth = ((segEnd - segStart) / maxTarget) * 100
          const fillPct = capital >= segEnd ? 100 : capital <= segStart ? 0 : ((capital - segStart) / (segEnd - segStart)) * 100

          return (
            <div key={p.id} style={{ flex: segWidth, display: 'flex', flexDirection: 'column', gap: 3 }}>
              <div style={{ fontSize: 9, color: capital >= segStart ? p.color : '#2A3250', letterSpacing: 1, fontWeight: 600 }}>
                {p.label}
              </div>
              <div style={{ height: 8, background: '#1E2540', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{
                  height: '100%', width: `${fillPct}%`,
                  background: `linear-gradient(90deg, ${p.color}80, ${p.color})`,
                  borderRadius: 4, transition: 'width 0.5s',
                }} />
              </div>
              <div style={{ fontSize: 8, color: '#5D6580' }}>{fmtK(segEnd)}</div>
            </div>
          )
        })}
      </div>
      <div style={{ fontSize: 10, color: '#5D6580', fontFamily: 'IBM Plex Mono, monospace' }}>
        Overall: {overallPct.toFixed(1)}% to ${(maxTarget / 1000).toFixed(0)}k target
      </div>
    </div>
  )
}

// ── Projection chart (simple bar chart) ──────────────────────────────────────

function ProjectionChart({ data }: { data: ProjectionPoint[] }) {
  const maxCap = Math.max(...data.map(d => d.capital))
  const sampled = data.filter((_, i) => i % 3 === 0 || i === data.length - 1)

  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 140, padding: '0 4px' }}>
      {sampled.map((d, i) => {
        const pct = (d.capital / maxCap) * 100
        const phase = getPhase(d.capital)
        const isCurrent = i === 0
        return (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%', justifyContent: 'flex-end' }}
            title={`Month ${d.month}: ${fmtK(d.capital)} (${phase.label})`}>
            <div style={{
              width: '100%', height: `${pct}%`, minHeight: 2,
              background: isCurrent ? '#6366F1' : phase.color,
              opacity: isCurrent ? 1 : 0.7,
              borderRadius: '2px 2px 0 0',
            }} />
            {i % 2 === 0 && (
              <div style={{ fontSize: 8, color: '#5D6580', marginTop: 3, fontFamily: 'IBM Plex Mono, monospace' }}>
                {d.month === 0 ? 'Now' : `${d.month}m`}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Main view ────────────────────────────────────────────────────────────────

export default function PhasesView({ state }: Props) {
  const { trades, cashBalance, netLiquidation: ibkrNetLiq } = state.sync
  const { strategies, sync } = state

  const allPositionsValue = sync.positions.reduce((s, p) => s + p.positionValue, 0)
  const capital = ibkrNetLiq ?? (allPositionsValue + cashBalance)
  const phase = getPhase(capital)
  const toNext = phase.target - capital
  const phasePct = Math.min(((capital - phase.floor) / (phase.target - phase.floor)) * 100, 100)

  const monthlyIncome = useMemo(() => buildMonthlyIncome(trades), [trades])
  const avgMonthly = monthlyIncome.length ? monthlyIncome.reduce((s, m) => s + m.optionIncome, 0) / monthlyIncome.length : 0
  const totalOptionIncome = monthlyIncome.reduce((s, m) => s + m.optionIncome, 0)
  const monthlyReturnPct = capital > 0 ? (avgMonthly / capital) * 100 : 2.5

  // Projections at different return rates
  const projConservative = useMemo(() => projectGrowth(capital, 1.5, 60), [capital])
  const projModerate = useMemo(() => projectGrowth(capital, monthlyReturnPct || 2.5, 60), [capital, monthlyReturnPct])
  const projAggressive = useMemo(() => projectGrowth(capital, 4, 60), [capital])

  // Strategy income breakdown
  const stratByType = useMemo(() => {
    const map: Record<string, { count: number; pnl: number; premium: number }> = {}
    for (const s of strategies) {
      if (!map[s.type]) map[s.type] = { count: 0, pnl: 0, premium: 0 }
      map[s.type].count++
      map[s.type].pnl += s.unrealizedPnL
      map[s.type].premium += s.netPremiumReceived
    }
    return map
  }, [strategies])

  const STRAT_LABELS: Record<string, string> = {
    covered_call: 'Covered Calls', csp: 'Cash-Secured Puts', pmcc: 'PMCCs',
    risk_reversal: 'Risk Reversals', put_spread: 'Put Spreads', call_spread: 'Call Spreads',
    leap: 'LEAPs', other: 'Other',
  }

  return (
    <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* ── Phase header ────────────────────────────────────────────── */}
      <div style={{ background: '#131726', border: `1px solid ${phase.color}40`, borderTop: `3px solid ${phase.color}`, borderRadius: 10, padding: '20px 24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 10, color: phase.color, letterSpacing: 3, fontWeight: 700, marginBottom: 4 }}>
              {phase.label}: {phase.sublabel.toUpperCase()}
            </div>
            <div style={{ fontSize: 28, fontWeight: 700, color: '#EAEDF3', fontFamily: 'IBM Plex Mono, monospace' }}>
              {fmt$(capital)}
            </div>
            <div style={{ fontSize: 12, color: '#5D6580', marginTop: 4 }}>{phase.range}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 10, color: '#5D6580', letterSpacing: 2, marginBottom: 4 }}>TO NEXT PHASE</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: phase.color, fontFamily: 'IBM Plex Mono, monospace' }}>
              {fmtK(Math.max(toNext, 0))}
            </div>
            <div style={{ fontSize: 11, color: '#5D6580', marginTop: 2 }}>{phasePct.toFixed(0)}% through phase</div>
          </div>
        </div>

        {/* Phase progress bar */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ height: 8, background: '#1E2540', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{
              height: '100%', width: `${phasePct}%`,
              background: `linear-gradient(90deg, ${phase.color}80, ${phase.color})`,
              borderRadius: 4, transition: 'width 0.5s',
            }} />
          </div>
        </div>

        {/* Phase rules */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          {[
            { label: 'SIZING', value: phase.contractRule },
            { label: 'WEEKLY TARGET', value: fmtK(phase.weeklyTarget) },
            { label: 'TARGET ROI', value: phase.annualROI + ' annual' },
            { label: 'STRATEGY MIX', value: phase.strategyMix },
          ].map(r => (
            <div key={r.label}>
              <div style={{ fontSize: 9, color: '#5D6580', letterSpacing: 2, marginBottom: 4 }}>{r.label}</div>
              <div style={{ fontSize: 11, color: phase.color, fontWeight: 600 }}>{r.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Stats row ───────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
        {[
          { label: 'ACTIVE STRATEGIES', value: String(strategies.length), color: '#EAEDF3' },
          { label: 'OPTION INCOME', value: fmt$(totalOptionIncome), color: '#10b981' },
          { label: 'AVG MONTHLY', value: fmt$(avgMonthly), color: avgMonthly > 0 ? '#10b981' : '#5D6580' },
          { label: 'MONTHLY RETURN', value: monthlyReturnPct > 0 ? monthlyReturnPct.toFixed(1) + '%' : '--', color: '#3b82f6' },
          { label: 'UNDERLYINGS', value: String(new Set(strategies.map(s => s.underlying)).size), color: '#EAEDF3' },
        ].map(s => (
          <div key={s.label} className="stat-card">
            <div className="stat-label">{s.label}</div>
            <div className="stat-value" style={{ color: s.color, fontSize: 22 }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* ── Full phase progression ──────────────────────────────────── */}
      <div style={{ background: '#131726', border: '1px solid #1E2540', borderRadius: 10, padding: '20px 24px' }}>
        <div style={{ fontSize: 10, color: '#5D6580', letterSpacing: 2, marginBottom: 14, fontWeight: 700 }}>GROWTH ROADMAP</div>
        <PhaseProgressBar capital={capital} />
      </div>

      {/* ── Phase cards ─────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
        {PHASES.map(p => {
          const isCurrent = p.id === phase.id
          const isCompleted = capital >= p.target
          return (
            <div key={p.id} style={{
              background: isCurrent ? '#171C30' : '#131726',
              border: `1px solid ${isCurrent ? p.color + '60' : '#1E2540'}`,
              borderTop: `3px solid ${isCompleted ? p.color : isCurrent ? p.color : '#1E2540'}`,
              borderRadius: 10, padding: '16px',
              opacity: isCompleted || isCurrent ? 1 : 0.5,
            }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: p.color, letterSpacing: 2, marginBottom: 4 }}>
                {p.label} {isCompleted ? '  ' : isCurrent ? '  ' : ''}
              </div>
              <div style={{ fontSize: 13, color: '#EAEDF3', fontWeight: 600, marginBottom: 2 }}>{p.sublabel}</div>
              <div style={{ fontSize: 11, color: '#5D6580', marginBottom: 10 }}>{p.range}</div>
              <div style={{ fontSize: 10, color: '#9198AE', lineHeight: 1.6 }}>
                {p.contractRule}<br />
                Target: {fmtK(p.weeklyTarget)}/wk · {p.annualROI} ROI
              </div>
            </div>
          )
        })}
      </div>

      {/* ── Projections ─────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
        {[
          { label: 'CONSERVATIVE (1.5%/mo)', data: projConservative, color: '#5D6580' },
          { label: `CURRENT PACE (${(monthlyReturnPct || 2.5).toFixed(1)}%/mo)`, data: projModerate, color: '#6366F1' },
          { label: 'AGGRESSIVE (4%/mo)', data: projAggressive, color: '#f59e0b' },
        ].map(p => {
          const final = p.data[p.data.length - 1]
          return (
            <div key={p.label} style={{ background: '#131726', border: '1px solid #1E2540', borderRadius: 10, padding: '16px 20px' }}>
              <div style={{ fontSize: 9, color: '#5D6580', letterSpacing: 2, marginBottom: 8 }}>{p.label}</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: p.color, fontFamily: 'IBM Plex Mono, monospace', marginBottom: 4 }}>
                {fmtK(final.capital)}
              </div>
              <div style={{ fontSize: 10, color: '#5D6580', marginBottom: 10 }}>in 5 years ({final.phase === 4 ? 'Phase 4' : `Phase ${final.phase}`})</div>
              <ProjectionChart data={p.data} />
            </div>
          )
        })}
      </div>

      {/* ── Strategy income breakdown ───────────────────────────────── */}
      {Object.keys(stratByType).length > 0 && (
        <div style={{ background: '#131726', border: '1px solid #1E2540', borderRadius: 10, padding: '16px 20px' }}>
          <div style={{ fontSize: 10, color: '#5D6580', letterSpacing: 2, marginBottom: 12, fontWeight: 700 }}>INCOME BY STRATEGY TYPE</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {Object.entries(stratByType).sort((a, b) => b[1].premium - a[1].premium).map(([type, data]) => (
              <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', background: '#171C30', borderRadius: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#EAEDF3', minWidth: 130 }}>{STRAT_LABELS[type] ?? type}</span>
                <span style={{ fontSize: 11, color: '#5D6580' }}>{data.count} pos</span>
                <div style={{ flex: 1 }} />
                <span style={{ fontSize: 10, color: '#5D6580' }}>Premium</span>
                <span style={{ fontSize: 12, fontFamily: 'IBM Plex Mono, monospace', color: data.premium >= 0 ? '#10b981' : '#f43f5e', minWidth: 70, textAlign: 'right' }}>
                  {fmt$(data.premium)}
                </span>
                <span style={{ fontSize: 10, color: '#5D6580', marginLeft: 8 }}>P&L</span>
                <span style={{ fontSize: 12, fontFamily: 'IBM Plex Mono, monospace', color: data.pnl >= 0 ? '#10b981' : '#f43f5e', minWidth: 70, textAlign: 'right' }}>
                  {fmt$(data.pnl)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Monthly income bars ─────────────────────────────────────── */}
      {monthlyIncome.length > 0 && (
        <div style={{ background: '#131726', border: '1px solid #1E2540', borderRadius: 10, padding: '16px 20px' }}>
          <div style={{ fontSize: 10, color: '#5D6580', letterSpacing: 2, marginBottom: 12, fontWeight: 700 }}>MONTHLY OPTION INCOME</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 120 }}>
            {monthlyIncome.map(m => {
              const maxInc = Math.max(...monthlyIncome.map(x => Math.abs(x.optionIncome)), 1)
              const pct = Math.abs(m.optionIncome) / maxInc
              return (
                <div key={m.key} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%', justifyContent: 'flex-end' }}
                  title={`${m.label}: ${fmt$(m.optionIncome)} from ${m.trades} trades`}>
                  <div style={{
                    width: '100%', height: `${Math.max(pct * 100, 2)}%`, minHeight: 2,
                    background: m.optionIncome >= 0 ? '#10b981' : '#f43f5e',
                    borderRadius: '2px 2px 0 0', opacity: 0.8,
                  }} />
                  <div style={{ fontSize: 8, color: '#5D6580', marginTop: 3, fontFamily: 'IBM Plex Mono, monospace' }}>{m.label}</div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
