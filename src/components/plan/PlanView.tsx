import { useMemo } from 'react'
import type { AppState, RawTrade } from '../../types'
import EmptyState from '../shared/EmptyState'

interface Props { state: AppState }

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt$(n: number, d = 0) {
  return (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
}
function fmtK(n: number) {
  return Math.abs(n) >= 1000 ? (n < 0 ? '-' : '') + '$' + (Math.abs(n) / 1000).toFixed(0) + 'k' : fmt$(n)
}
function monthKey(ds: string) { return ds.length === 8 ? `${ds.slice(0,4)}-${ds.slice(4,6)}` : ds.slice(0,7) }
function monthLabel(k: string) {
  const [y, m] = k.split('-')
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
}

// ─── Plan constants ──────────────────────────────────────────────────────────

const PORTFOLIO_TOTAL = 300_000
const ALLOC = [
  { label: 'TSLA (500 sh)', amount: 150_000, pct: 50, color: '#f43f5e', desc: 'Long-term hold, do NOT sell' },
  { label: 'Rotation (MSTR/PLTR → IA13)', amount: 50_000, pct: 17, color: '#3b82f6', desc: 'Rotate into dips + sell covered calls' },
  { label: 'SPX Cash (Put Credit Spreads)', amount: 100_000, pct: 33, color: '#10b981', desc: 'Weekly/monthly SPX put credit spreads' },
]

const MONTHLY_TARGET_MIN = 4000
const MONTHLY_TARGET_MAX = 8000
const INTEREST_PAYMENT = 2000

const SPX_RULES = {
  title: 'SPX PUT CREDIT SPREADS',
  color: '#10b981',
  rules: [
    { label: 'Capital', value: '$100k cash' },
    { label: 'DTE', value: '30–45 days' },
    { label: 'Short delta', value: '0.10–0.15' },
    { label: 'Width', value: '25–50 pts' },
    { label: 'Max risk/trade', value: '1–2% ($1k–$2k)' },
    { label: 'Target credit', value: '⅓ of width' },
    { label: 'Close at', value: '50% profit or 21 DTE' },
    { label: 'Stop loss', value: '2× credit received' },
    { label: 'Max open', value: '3–4 spreads' },
    { label: 'Avoid', value: 'FOMC, CPI, NFP week' },
  ],
}

const CC_RULES = {
  title: 'COVERED CALLS',
  color: '#3b82f6',
  rules: [
    { label: 'Underlyings', value: 'MSTR, PLTR + IA13 rotation' },
    { label: 'DTE', value: '14–45 days' },
    { label: 'Strike delta', value: '0.20–0.30' },
    { label: 'Min premium', value: '1% of stock price' },
    { label: 'Roll when', value: '<7 DTE if ITM' },
    { label: 'Close at', value: '50–80% profit' },
    { label: 'Never sell CC on', value: 'TSLA (long-term hold)' },
  ],
}

const ROTATION_RULES = {
  title: 'IA13 DIP ROTATION',
  color: '#f59e0b',
  rules: [
    { label: 'Buy trigger', value: 'Price ≤ ATR2 level' },
    { label: 'Size', value: '100 shares per entry' },
    { label: 'Sell trigger', value: 'Rotate out above ATR1' },
    { label: 'Then', value: 'Sell CCs until called away' },
    { label: 'Source', value: 'Funded from $50k rotation bucket' },
  ],
}

const WEEKLY_ROUTINE = [
  { day: 'MON', tasks: ['Review SPX weekly levels & VIX', 'Check open positions P&L', 'Set weekly income target'], color: '#3b82f6' },
  { day: 'TUE', tasks: ['Open SPX put credit spreads (primary day)', 'Scan CC opportunities on rotation stocks'], color: '#10b981' },
  { day: 'WED', tasks: ['Monitor positions, adjust stops', 'Check IA13 tickers vs ATR levels for dip buys'], color: '#f59e0b' },
  { day: 'THU', tasks: ['Second SPX entry if VIX spike', 'Roll CCs if needed (<7 DTE + ITM)'], color: '#6366F1' },
  { day: 'FRI', tasks: ['Close winners at 50%+ profit', 'Log all trades, update P&L', 'Plan next week'], color: '#f43f5e' },
]

const RISK_RULES = [
  'Max 1–2% of total portfolio risk per trade ($3k–$6k)',
  'Max 5% portfolio risk across ALL open positions',
  'No more than 3–4 SPX spreads open simultaneously',
  'Always use defined-risk strategies (spreads, not naked)',
  'Cut losses at 2× credit received — no exceptions',
  'No trading during major macro events (FOMC, CPI, NFP)',
  'If monthly loss exceeds $4k, pause trading for 1 week',
  'Never risk TSLA 500 shares — long-term core holding',
]

const SCALING_PLAN = [
  { capital: '$300k', monthly: '$4k–$6k', contracts: '3–4 SPX + 2 CC', note: 'Current phase' },
  { capital: '$400k', monthly: '$6k–$8k', contracts: '4–5 SPX + 3 CC', note: 'Add 1 more underlying' },
  { capital: '$500k', monthly: '$8k–$12k', contracts: '5–6 SPX + 4 CC', note: 'Wider spreads, more premium' },
  { capital: '$750k+', monthly: '$12k–$20k', contracts: '6–8 SPX + 5 CC', note: 'Income machine' },
]

const MONTHLY_REVIEW = [
  'Total net P&L vs $4k–$8k target',
  'Win rate on SPX spreads (target >70%)',
  'Average credit collected per spread',
  'Max drawdown — flag if >$4k loss month',
  'Interest payment covered? ($2k minimum)',
  'Income allocation: reinvest vs personal',
  'Review rotation stocks — rebalance if needed',
  'Adjust strike selection if IV environment changed',
]

// ─── $1M Roadmap — SPX 65 DTE ────────────────────────────────────────────────

const RM_START_CAPITAL = 100_000
const RM_TARGET_CAPITAL = 1_000_000
const RM_WIN_RATE = 80          // % — 10-year backtest result
const RM_DTE = 65
const RM_START_CONTRACTS = 10
const RM_MONTHLY_RETURN_PCT = 2.5  // net avg monthly return after losses, on deployed capital

// Model: 50-pt SPX spread, ~$700 credit, close at 50% profit or 2× credit stop
// EV/contract = 0.80 × $350 (50% profit) − 0.20 × $700 (stop) = $140 net
// 10 contracts → $1,400/mo on $100k = 1.4%; with multiple open positions → ~2.5% net

const RM_MILESTONES = [
  { capital: 100_000,   phase: 'LAUNCH',      color: '#6366F1' },
  { capital: 150_000,   phase: 'SCALE 1',     color: '#3b82f6' },
  { capital: 200_000,   phase: 'DOUBLED',     color: '#10b981' },
  { capital: 300_000,   phase: 'SCALE 2',     color: '#10b981' },
  { capital: 500_000,   phase: 'HALFWAY',     color: '#f59e0b' },
  { capital: 750_000,   phase: 'FINAL PUSH',  color: '#f59e0b' },
  { capital: 1_000_000, phase: 'THE GOAL',    color: '#f43f5e' },
]

const RM_SCALING_RULES = [
  { trigger: '+$10k capital',    action: 'Add 1 contract',         detail: 'Keeps max risk ≤ 10% at all times' },
  { trigger: '20% drawdown',     action: 'Pause & reduce by 50%',  detail: 'Resume after 1 clean winning trade' },
  { trigger: 'VIX > 30',        action: 'Widen strikes or sit out', detail: 'Preserve capital in extreme vol' },
  { trigger: '3 losses in a row', action: 'Cut to half size',       detail: 'Reset discipline before scaling back' },
]

function buildRoadmapMilestones() {
  const rate = RM_MONTHLY_RETURN_PCT / 100
  return RM_MILESTONES.map(m => {
    const months = m.capital === RM_START_CAPITAL
      ? 0
      : Math.round(Math.log(m.capital / RM_START_CAPITAL) / Math.log(1 + rate))
    const contracts = Math.floor(m.capital / 10_000)
    const monthlyIncome = Math.round(m.capital * rate)
    const years = Math.floor(months / 12)
    const remMo = months % 12
    const timeLabel = months === 0
      ? 'Day 1'
      : years > 0
        ? `Yr ${years}${remMo > 0 ? ` Mo ${remMo}` : ''}`
        : `Mo ${months}`
    return { ...m, months, contracts, monthlyIncome, timeLabel }
  })
}

function buildRoadmapCurve() {
  const rate = RM_MONTHLY_RETURN_PCT / 100
  const pts: { month: number; capital: number }[] = []
  for (let m = 0; m <= 96; m += 2) {
    pts.push({ month: m, capital: Math.round(RM_START_CAPITAL * Math.pow(1 + rate, m)) })
  }
  return pts
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const tile: React.CSSProperties = {
  background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10,
  overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0,
}
const tileHdr: React.CSSProperties = {
  padding: '10px 16px', borderBottom: '1px solid var(--border)',
  fontSize: 11, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.1em', flexShrink: 0,
}

// ─── Monthly data ────────────────────────────────────────────────────────────

interface MonthData {
  key: string; label: string; optionPnL: number; stockPnL: number; total: number; tradeCount: number
}

function buildMonthlyData(trades: RawTrade[]): MonthData[] {
  const map = new Map<string, MonthData>()
  for (const t of trades) {
    if (!t.tradeDate) continue
    const key = monthKey(t.tradeDate)
    if (!map.has(key)) map.set(key, { key, label: monthLabel(key), optionPnL: 0, stockPnL: 0, total: 0, tradeCount: 0 })
    const m = map.get(key)!
    if (t.assetClass === 'OPT') m.optionPnL += t.netCash
    else m.stockPnL += t.netCash
    m.total += t.netCash
    m.tradeCount++
  }
  return [...map.values()].sort((a, b) => a.key.localeCompare(b.key))
}

// ─── Wheel phase ─────────────────────────────────────────────────────────────

type WheelPhase = 'csp' | 'assigned' | 'covered_call' | 'called_away' | 'idle'
const PHASE_CFG: Record<WheelPhase, { label: string; color: string }> = {
  csp: { label: 'Selling CSP', color: '#f43f5e' },
  assigned: { label: 'Assigned', color: '#f59e0b' },
  covered_call: { label: 'Selling CC', color: '#3b82f6' },
  called_away: { label: 'Called Away', color: '#10b981' },
  idle: { label: 'Idle', color: 'var(--text-5)' },
}

function derivePhase(sym: string, strategies: AppState['strategies'], positions: AppState['sync']['positions']): WheelPhase {
  if (strategies.some(s => s.type === 'covered_call' && s.underlying === sym)) return 'covered_call'
  if (strategies.some(s => s.type === 'csp' && s.underlying === sym)) return 'csp'
  if (positions.some(p => p.assetClass === 'STK' && p.symbol === sym && p.quantity > 0)) return 'assigned'
  return 'idle'
}

// ─── Projection ──────────────────────────────────────────────────────────────

function projectGrowth(start: number, moRate: number, months: number) {
  const pts = [{ month: 0, capital: start }]
  let c = start
  for (let m = 1; m <= months; m++) {
    c += c * (moRate / 100)
    pts.push({ month: m, capital: c })
  }
  return pts
}

// ─── Bar chart ───────────────────────────────────────────────────────────────

function BarChart({ months }: { months: MonthData[] }) {
  if (!months.length) return null
  const maxAbs = Math.max(...months.map(m => Math.abs(m.total)), 1)
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: '100%', minHeight: 80, paddingBottom: 20, position: 'relative' }}>
      <div style={{ position: 'absolute', bottom: 20, left: 0, right: 0, height: 1, background: 'var(--border)' }} />
      {months.map(m => {
        const pct = Math.abs(m.total) / maxAbs
        const barH = Math.max(pct * 90, 2)
        return (
          <div key={m.key} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%', position: 'relative' }}
            title={`${m.label}: ${fmt$(m.total)} (${m.tradeCount} trades)`}>
            <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end', width: '100%' }}>
              <div style={{ width: '100%', height: barH, background: m.total >= 0 ? '#10b981' : '#f43f5e', borderRadius: '2px 2px 0 0', opacity: 0.85 }} />
            </div>
            <div style={{ position: 'absolute', bottom: 2, fontSize: 9, color: 'var(--text-4)', fontFamily: 'IBM Plex Mono, monospace', whiteSpace: 'nowrap' }}>{m.label}</div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Main component ──────────────────────────────────────────────────────────

export default function PlanView({ state }: Props) {
  const { trades, cashBalance, netLiquidation: ibkrNetLiq } = state.sync
  const capital = ibkrNetLiq ?? (state.sync.positions.reduce((s, p) => s + p.positionValue, 0) + cashBalance)

  const months = useMemo(() => buildMonthlyData(trades), [trades])
  const optTrades = trades.filter(t => t.assetClass === 'OPT')
  const totalPremium = optTrades.filter(t => t.quantity < 0 && t.netCash > 0).reduce((s, t) => s + t.netCash, 0)
  const totalPnL = trades.reduce((s, t) => s + t.netCash, 0)
  const monthsWithData = months.filter(m => m.total !== 0)
  const avgMonthly = monthsWithData.length ? monthsWithData.reduce((s, m) => s + m.total, 0) / monthsWithData.length : 0
  const bestMonth = months.reduce((best, m) => m.total > best.total ? m : best, months[0] ?? { total: 0, label: '—' })

  const underlyings = useMemo(() => {
    const set = new Set<string>()
    for (const p of state.sync.positions) { const sym = p.underlyingSymbol ?? (p.assetClass === 'STK' ? p.symbol : null); if (sym) set.add(sym) }
    for (const s of state.strategies) set.add(s.underlying)
    return [...set].sort()
  }, [state])

  const moReturnPct = capital > 0 ? (avgMonthly / capital) * 100 : 2
  const projections = useMemo(() => [
    { label: 'Conservative', rate: 1.5, data: projectGrowth(capital || PORTFOLIO_TOTAL, 1.5, 60), color: 'var(--text-3)' },
    { label: 'Current', rate: moReturnPct, data: projectGrowth(capital || PORTFOLIO_TOTAL, moReturnPct || 2, 60), color: '#6366F1' },
    { label: 'Aggressive', rate: 3.5, data: projectGrowth(capital || PORTFOLIO_TOTAL, 3.5, 60), color: '#f59e0b' },
  ], [capital, moReturnPct])

  const onTrack = avgMonthly >= MONTHLY_TARGET_MIN
  const interestCovered = avgMonthly >= INTEREST_PAYMENT

  if (!state.strategies.length && !trades.length) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <EmptyState title="Trading Plan" message="Sync your IBKR portfolio to see your plan alongside real performance data." showUpload />
      </div>
    )
  }

  return (
    <div style={{ padding: 16, height: '100%', overflow: 'auto' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 1400 }}>

        {/* ── Row 1: Stats ─────────────────────────────────────────────── */}
        <div className="plan-stats" style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8 }}>
          {[
            { label: 'NET LIQUIDATION', value: capital > 0 ? fmt$(capital) : '—', color: 'var(--text-1)' },
            { label: 'MONTHLY TARGET', value: `${fmtK(MONTHLY_TARGET_MIN)}–${fmtK(MONTHLY_TARGET_MAX)}`, color: '#6366F1' },
            { label: 'ACTUAL MONTHLY', value: fmt$(avgMonthly), color: onTrack ? '#10b981' : '#f59e0b' },
            { label: 'PREMIUM COLLECTED', value: fmt$(totalPremium), color: '#10b981' },
            { label: 'REALIZED P&L', value: fmt$(totalPnL), color: totalPnL >= 0 ? '#10b981' : '#f43f5e' },
            { label: 'BEST MONTH', value: bestMonth ? fmt$(bestMonth.total) : '—', color: '#10b981' },
          ].map(s => (
            <div key={s.label} className="stat-card">
              <div className="stat-label">{s.label}</div>
              <div className="stat-value" style={{ color: s.color, fontSize: 22 }}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* ── Row 2: Allocation + Income Split ────────────────────────── */}
        <div className="plan-2col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>

          {/* Portfolio allocation */}
          <div style={tile}>
            <div style={tileHdr}>PORTFOLIO ALLOCATION — {fmt$(PORTFOLIO_TOTAL)}</div>
            <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {/* Allocation bar */}
              <div style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', gap: 2 }}>
                {ALLOC.map(a => (
                  <div key={a.label} style={{ flex: a.pct, background: a.color, borderRadius: 3 }} title={`${a.label}: ${fmt$(a.amount)} (${a.pct}%)`} />
                ))}
              </div>
              {ALLOC.map(a => (
                <div key={a.label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 8, height: 8, borderRadius: 2, background: a.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)', minWidth: 200 }}>{a.label}</span>
                  <span style={{ fontSize: 13, fontFamily: 'IBM Plex Mono, monospace', color: a.color, fontWeight: 700 }}>{fmt$(a.amount)}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-4)', marginLeft: 4 }}>{a.pct}%</span>
                  <div style={{ flex: 1 }} />
                  <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{a.desc}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Income allocation */}
          <div style={tile}>
            <div style={tileHdr}>MONTHLY INCOME ALLOCATION</div>
            <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: 'var(--text-3)', letterSpacing: 1, marginBottom: 4 }}>TARGET INCOME</div>
                  <div style={{ fontSize: 28, fontWeight: 700, color: '#6366F1', fontFamily: 'IBM Plex Mono, monospace' }}>
                    {fmtK(MONTHLY_TARGET_MIN)}–{fmtK(MONTHLY_TARGET_MAX)}/mo
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-3)', letterSpacing: 1, marginBottom: 4 }}>ACTUAL AVG</div>
                  <div style={{ fontSize: 28, fontWeight: 700, color: onTrack ? '#10b981' : '#f59e0b', fontFamily: 'IBM Plex Mono, monospace' }}>
                    {fmt$(avgMonthly)}/mo
                  </div>
                </div>
              </div>
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {[
                  { label: '1. Interest Repayment', amount: INTEREST_PAYMENT, color: '#f43f5e', status: interestCovered ? '✓ Covered' : '✗ Short' },
                  { label: '2. Personal Income', amount: null, color: '#3b82f6', status: '50% of remainder' },
                  { label: '3. Reinvestment', amount: null, color: '#10b981', status: '50% of remainder' },
                ].map(r => (
                  <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: r.color, flexShrink: 0 }} />
                    <span style={{ fontSize: 13, color: 'var(--text-1)', fontWeight: 600, flex: 1 }}>{r.label}</span>
                    {r.amount && <span style={{ fontSize: 13, fontFamily: 'IBM Plex Mono, monospace', color: r.color, fontWeight: 700 }}>{fmt$(r.amount)}/mo</span>}
                    <span style={{ fontSize: 12, color: r.status.startsWith('✓') ? '#10b981' : r.status.startsWith('✗') ? '#f43f5e' : 'var(--text-3)' }}>{r.status}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ── Row 3: Strategy Rules ───────────────────────────────────── */}
        <div className="plan-3col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          {[SPX_RULES, CC_RULES, ROTATION_RULES].map(strat => (
            <div key={strat.title} style={{ ...tile, borderTop: `3px solid ${strat.color}` }}>
              <div style={{ ...tileHdr, color: strat.color }}>{strat.title}</div>
              <div style={{ padding: '8px 14px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                {strat.rules.map(r => (
                  <div key={r.label} style={{ display: 'flex', gap: 8, fontSize: 12, lineHeight: 1.5 }}>
                    <span style={{ color: 'var(--text-3)', minWidth: 80, flexShrink: 0 }}>{r.label}</span>
                    <span style={{ color: 'var(--text-1)', fontWeight: 500 }}>{r.value}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* ── Row 4: Weekly Routine ───────────────────────────────────── */}
        <div style={tile}>
          <div style={tileHdr}>WEEKLY ROUTINE</div>
          <div className="plan-routine" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 0 }}>
            {WEEKLY_ROUTINE.map((d, i) => (
              <div key={d.day} style={{
                padding: '12px 14px',
                borderRight: i < 4 ? '1px solid var(--border)' : 'none',
              }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: d.color, letterSpacing: 2, marginBottom: 8 }}>{d.day}</div>
                {d.tasks.map((task, j) => (
                  <div key={j} style={{ display: 'flex', gap: 6, marginBottom: 4, fontSize: 12, color: 'var(--text-2)', lineHeight: 1.4 }}>
                    <span style={{ color: 'var(--text-4)', flexShrink: 0 }}>•</span>
                    {task}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* ── Row 5: Performance (Chart + Wheel Phase) ────────────────── */}
        <div className="plan-performance" style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 12 }}>
          <div style={{ ...tile, minHeight: 200 }}>
            <div style={tileHdr}>MONTHLY NET P&L</div>
            <div style={{ flex: 1, padding: '10px 14px', minHeight: 120 }}>
              <BarChart months={months} />
            </div>
          </div>

          <div style={tile}>
            <div style={tileHdr}>WHEEL PHASE</div>
            <div style={{ flex: 1, overflow: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 3 }}>
              {underlyings.map(sym => {
                const phase = derivePhase(sym, state.strategies, state.sync.positions)
                const cfg = PHASE_CFG[phase]
                const stk = state.sync.positions.find(p => p.assetClass === 'STK' && p.symbol === sym)
                return (
                  <div key={sym} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'var(--bg-elevated)', borderRadius: 6 }}>
                    <span style={{ fontWeight: 700, color: 'var(--text-1)', fontFamily: 'IBM Plex Mono, monospace', fontSize: 13, minWidth: 48 }}>{sym}</span>
                    <span style={{ padding: '1px 6px', fontSize: 10, fontWeight: 700, color: cfg.color, background: `${cfg.color}14`, border: `1px solid ${cfg.color}30`, letterSpacing: '0.04em' }}>{cfg.label}</span>
                    <div style={{ flex: 1 }} />
                    {stk && <span style={{ fontSize: 12, fontFamily: 'IBM Plex Mono, monospace', color: 'var(--text-3)' }}>{stk.quantity} sh</span>}
                  </div>
                )
              })}
              {!underlyings.length && <div style={{ fontSize: 12, color: 'var(--text-4)', padding: 12 }}>No active positions</div>}
            </div>
          </div>
        </div>

        {/* ── Row 6: Monthly breakdown table ───────────────────────────── */}
        {months.length > 0 && (
          <div style={{ ...tile, maxHeight: 260 }}>
            <div style={tileHdr}>MONTHLY BREAKDOWN</div>
            <div style={{ overflow: 'auto', flex: 1 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    {['MONTH', 'OPTION P&L', 'STOCK P&L', 'NET', 'VS TARGET', 'TRADES'].map(h => (
                      <th key={h} style={{ padding: '8px 14px', fontSize: 11, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.06em', textAlign: h === 'MONTH' ? 'left' : 'right' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...months].reverse().map((m, i) => {
                    const vsTarget = m.total >= MONTHLY_TARGET_MIN ? 'ON TRACK' : m.total >= INTEREST_PAYMENT ? 'MIN MET' : 'BELOW'
                    const vsColor = m.total >= MONTHLY_TARGET_MIN ? '#10b981' : m.total >= INTEREST_PAYMENT ? '#f59e0b' : '#f43f5e'
                    return (
                      <tr key={m.key} style={{ borderBottom: '1px solid var(--border-light)', background: i % 2 ? 'var(--bg-page)' : 'transparent' }}>
                        <td style={{ padding: '8px 14px', fontFamily: 'IBM Plex Mono, monospace', color: 'var(--text-3)' }}>{m.label}</td>
                        <td style={{ padding: '8px 14px', textAlign: 'right', fontFamily: 'IBM Plex Mono, monospace', color: m.optionPnL >= 0 ? '#10b981' : '#f43f5e' }}>{fmt$(m.optionPnL)}</td>
                        <td style={{ padding: '8px 14px', textAlign: 'right', fontFamily: 'IBM Plex Mono, monospace', color: m.stockPnL >= 0 ? '#10b981' : '#f43f5e' }}>{fmt$(m.stockPnL)}</td>
                        <td style={{ padding: '8px 14px', textAlign: 'right', fontFamily: 'IBM Plex Mono, monospace', fontWeight: 600, color: m.total >= 0 ? '#10b981' : '#f43f5e' }}>{fmt$(m.total)}</td>
                        <td style={{ padding: '8px 14px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: vsColor, letterSpacing: 1 }}>{vsTarget}</td>
                        <td style={{ padding: '8px 14px', textAlign: 'right', fontFamily: 'IBM Plex Mono, monospace', color: 'var(--text-5)' }}>{m.tradeCount}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Row 7: Risk + Scaling + Projections ─────────────────────── */}
        <div className="plan-3col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>

          {/* Risk management */}
          <div style={{ ...tile, borderTop: '3px solid #f43f5e' }}>
            <div style={{ ...tileHdr, color: '#f43f5e' }}>RISK MANAGEMENT</div>
            <div style={{ padding: '8px 14px', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {RISK_RULES.map((r, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, fontSize: 12, lineHeight: 1.5 }}>
                  <span style={{ color: '#f43f5e', flexShrink: 0, fontWeight: 700 }}>{i + 1}.</span>
                  <span style={{ color: 'var(--text-2)' }}>{r}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Scaling plan */}
          <div style={{ ...tile, borderTop: '3px solid #6366F1' }}>
            <div style={{ ...tileHdr, color: '#6366F1' }}>SCALING PLAN</div>
            <div style={{ padding: '8px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {SCALING_PLAN.map((s, i) => (
                <div key={i} style={{
                  padding: '8px 10px', borderRadius: 6,
                  background: i === 0 ? 'var(--bg-elevated)' : 'transparent',
                  border: i === 0 ? '1px solid #6366F140' : '1px solid var(--border-light)',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: i === 0 ? '#6366F1' : 'var(--text-2)' }}>{s.capital}</span>
                    <span style={{ fontSize: 13, fontFamily: 'IBM Plex Mono, monospace', color: '#10b981', fontWeight: 600 }}>{s.monthly}/mo</span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{s.contracts} — {s.note}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Projections */}
          <div style={{ ...tile, borderTop: '3px solid #f59e0b' }}>
            <div style={{ ...tileHdr, color: '#f59e0b' }}>5-YEAR PROJECTIONS</div>
            <div style={{ padding: '8px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {projections.map(p => {
                const final = p.data[p.data.length - 1]
                const maxCap = Math.max(...p.data.map(d => d.capital))
                return (
                  <div key={p.label}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 11, color: 'var(--text-3)', letterSpacing: 1 }}>{p.label.toUpperCase()} ({p.rate.toFixed(1)}%/mo)</span>
                      <span style={{ fontSize: 14, fontWeight: 700, color: p.color, fontFamily: 'IBM Plex Mono, monospace' }}>{fmtK(final.capital)}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 1, height: 30 }}>
                      {p.data.filter((_, i) => i % 6 === 0 || i === p.data.length - 1).map((d, i) => (
                        <div key={i} style={{
                          flex: 1, background: p.color,
                          height: `${(d.capital / maxCap) * 100}%`, minHeight: 2,
                          borderRadius: '1px 1px 0 0', opacity: i === 0 ? 1 : 0.6,
                        }} />
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* ── Roadmap to $1M ────────────────────────────────────────────── */}
        {(() => {
          const milestones = buildRoadmapMilestones()
          const curve = buildRoadmapCurve()
          const maxCurve = curve[curve.length - 1].capital
          return (
            <>
              {/* Banner */}
              <div style={{ ...tile, borderTop: '3px solid #f59e0b' }}>
                <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#f59e0b', letterSpacing: '0.14em', marginBottom: 4 }}>ROAD MAP — SPX {RM_DTE} DTE PUT CREDIT SPREADS</div>
                    <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--text-1)', fontFamily: 'IBM Plex Mono, monospace', lineHeight: 1.1 }}>$100k → $1,000,000</div>
                    <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 6 }}>
                      {RM_WIN_RATE}% win rate · 10-yr backtest · {RM_MONTHLY_RETURN_PCT}% avg monthly return · fully compounded · 10% max risk/trade
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                    {[
                      { label: 'DTE',       value: `${RM_DTE}`,              sub: 'days to expiry' },
                      { label: 'WIN RATE',  value: `${RM_WIN_RATE}%`,        sub: '10yr backtest' },
                      { label: 'START',     value: `${RM_START_CONTRACTS} cts`, sub: '$100k capital' },
                      { label: 'TIMELINE',  value: '~7.7 yrs',               sub: 'compounded' },
                    ].map(s => (
                      <div key={s.label} style={{ textAlign: 'center', padding: '8px 14px', background: 'var(--bg-elevated)', borderRadius: 8, border: '1px solid var(--border)' }}>
                        <div style={{ fontSize: 10, color: 'var(--text-4)', letterSpacing: '0.08em', marginBottom: 2 }}>{s.label}</div>
                        <div style={{ fontSize: 18, fontWeight: 700, color: '#f59e0b', fontFamily: 'IBM Plex Mono, monospace' }}>{s.value}</div>
                        <div style={{ fontSize: 10, color: 'var(--text-4)' }}>{s.sub}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Milestone timeline */}
              <div style={tile}>
                <div style={tileHdr}>MILESTONE PROGRESSION</div>
                <div style={{ padding: '20px 16px 16px', overflowX: 'auto' }}>
                  <div style={{ display: 'flex', gap: 0, minWidth: 660, position: 'relative' }}>
                    {/* connector line */}
                    <div style={{ position: 'absolute', top: 11, left: '5%', right: '5%', height: 2, background: 'linear-gradient(90deg, #6366F1 0%, #10b981 60%, #f59e0b 85%, #f43f5e 100%)', zIndex: 0 }} />
                    {milestones.map((m, i) => (
                      <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative', zIndex: 1 }}>
                        <div style={{
                          width: m.capital === RM_TARGET_CAPITAL ? 26 : 22,
                          height: m.capital === RM_TARGET_CAPITAL ? 26 : 22,
                          borderRadius: '50%',
                          background: m.color,
                          border: '3px solid var(--bg-card)',
                          boxShadow: `0 0 0 2px ${m.color}`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                        }}>
                          {m.capital === RM_TARGET_CAPITAL && <span style={{ fontSize: 11, lineHeight: 1 }}>★</span>}
                        </div>
                        <div style={{ marginTop: 10, textAlign: 'center', padding: '0 2px' }}>
                          <div style={{ fontSize: 12, fontWeight: 800, color: m.color, fontFamily: 'IBM Plex Mono, monospace' }}>
                            {m.capital >= 1_000_000 ? '$1M' : m.capital >= 1000 ? `$${m.capital / 1000}k` : `$${m.capital}`}
                          </div>
                          <div style={{ fontSize: 10, color: 'var(--text-4)', letterSpacing: '0.06em', marginTop: 1 }}>{m.phase}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'IBM Plex Mono, monospace', marginTop: 3, fontWeight: 600 }}>{m.timeLabel}</div>
                          <div style={{ fontSize: 11, color: '#10b981', fontFamily: 'IBM Plex Mono, monospace', marginTop: 1 }}>{m.contracts} cts</div>
                          <div style={{ fontSize: 10, color: 'var(--text-4)', marginTop: 1 }}>${(m.monthlyIncome / 1000).toFixed(1)}k/mo</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Growth curve + scaling rules */}
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>

                {/* Compounding curve */}
                <div style={{ ...tile, minHeight: 200 }}>
                  <div style={tileHdr}>COMPOUNDING GROWTH CURVE — 2.5%/mo FULLY REINVESTED</div>
                  <div style={{ flex: 1, padding: '12px 16px 8px', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end', gap: 1.5, paddingBottom: 22, position: 'relative', minHeight: 130 }}>
                      <div style={{ position: 'absolute', bottom: 22, left: 0, right: 0, height: 1, background: 'var(--border)' }} />
                      {curve.map((pt, i) => {
                        const barH = Math.max((pt.capital / maxCurve) * 100, 1)
                        const color = pt.capital >= RM_TARGET_CAPITAL ? '#f43f5e' : pt.capital >= 500_000 ? '#f59e0b' : pt.capital >= 200_000 ? '#10b981' : '#6366F1'
                        return (
                          <div key={i}
                            title={`Mo ${pt.month}: ${fmtK(pt.capital)}`}
                            style={{ flex: 1, height: `${barH}%`, background: color, borderRadius: '2px 2px 0 0', opacity: 0.85, minHeight: 2, cursor: 'default' }}
                          />
                        )
                      })}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--text-4)', fontFamily: 'IBM Plex Mono, monospace' }}>
                      {['Mo 0', 'Mo 16', 'Mo 32', 'Mo 48', 'Mo 64', 'Mo 80', 'Mo 93'].map(l => <span key={l}>{l}</span>)}
                    </div>
                    <div style={{ display: 'flex', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
                      {[
                        { color: '#6366F1', label: '$100k–$200k' },
                        { color: '#10b981', label: '$200k–$500k' },
                        { color: '#f59e0b', label: '$500k–$1M' },
                        { color: '#f43f5e', label: '$1M+ reached' },
                      ].map(l => (
                        <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--text-3)' }}>
                          <div style={{ width: 8, height: 8, borderRadius: 2, background: l.color }} />
                          {l.label}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Scaling rules */}
                <div style={{ ...tile, borderTop: '3px solid #f43f5e' }}>
                  <div style={{ ...tileHdr, color: '#f43f5e' }}>SCALING RULES</div>
                  <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {RM_SCALING_RULES.map((r, i) => (
                      <div key={i} style={{ padding: '8px 10px', background: 'var(--bg-elevated)', borderRadius: 6, borderLeft: '3px solid #f43f5e' }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: '#f59e0b', letterSpacing: '0.06em', marginBottom: 2 }}>WHEN: {r.trigger}</div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)' }}>{r.action}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-4)', marginTop: 2 }}>{r.detail}</div>
                      </div>
                    ))}
                    <div style={{ marginTop: 4, padding: '8px 10px', background: 'var(--bg-elevated)', borderRadius: 6, border: '1px solid var(--border)' }}>
                      <div style={{ fontSize: 10, color: 'var(--text-4)', marginBottom: 4, letterSpacing: '0.06em', fontWeight: 700 }}>CONTRACT SCALING</div>
                      <div style={{ fontSize: 11, color: 'var(--text-2)', lineHeight: 1.6 }}>
                        1 contract per $10k capital<br />
                        10 cts → $100k · 20 cts → $200k<br />
                        50 cts → $500k · 100 cts → $1M
                      </div>
                    </div>
                  </div>
                </div>

              </div>
            </>
          )
        })()}

        {/* ── Row 8: Monthly Review Checklist ──────────────────────────── */}
        <div style={tile}>
          <div style={tileHdr}>MONTHLY REVIEW CHECKLIST</div>
          <div className="plan-review" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 0, padding: '8px 0' }}>
            {MONTHLY_REVIEW.map((item, i) => (
              <div key={i} style={{ padding: '6px 14px', display: 'flex', gap: 8, fontSize: 12, color: 'var(--text-2)', lineHeight: 1.4 }}>
                <span style={{ color: 'var(--text-4)', flexShrink: 0 }}>☐</span>
                {item}
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  )
}
