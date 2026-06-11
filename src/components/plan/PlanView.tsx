import { useMemo } from 'react'
import type { AppState, RawTrade } from '../../types'
import EmptyState from '../shared/EmptyState'

interface Props { state: AppState }

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

// ─── Plan constants ───────────────────────────────────────────────────────────

const MONTHLY_TARGET_MIN = 4000

const STRATEGIES = [
  {
    title: 'SPX PUT CREDIT SPREADS',
    color: '#10b981',
    rules: [
      { label: 'DTE',       value: '65 days' },
      { label: 'Delta',     value: '0.10–0.15 short put' },
      { label: 'Width',     value: '25–50 pts' },
      { label: 'Entry',     value: 'Tuesdays · VIX < 25' },
      { label: 'Max open',  value: '3–4 spreads' },
    ],
    exit: ['50% profit or 21 DTE', '2× credit stop loss'],
  },
  {
    title: 'COVERED CALLS',
    color: '#3b82f6',
    rules: [
      { label: 'Underlyings', value: 'MSTR · PLTR · IA13' },
      { label: 'DTE',         value: '14–45 days' },
      { label: 'Delta',       value: '0.20–0.30' },
      { label: 'Min premium', value: '1% of stock price' },
      { label: 'Never',       value: 'Sell CC on TSLA' },
    ],
    exit: ['50–80% profit', 'Roll < 7 DTE if ITM'],
  },
  {
    title: 'IA13 DIP ROTATION',
    color: '#f59e0b',
    rules: [
      { label: 'Buy trigger', value: 'Price ≤ ATR2' },
      { label: 'Size',        value: '100 shares / entry' },
      { label: 'Source',      value: '$50k rotation bucket' },
      { label: 'Then',        value: 'Sell CCs until called away' },
    ],
    exit: ['Rotate out above ATR1', 'Sell CCs → called away'],
  },
]

const WEEK = [
  { day: 'MON', color: '#3b82f6', tasks: ['Review SPX levels & VIX', 'Check open positions P&L'] },
  { day: 'TUE', color: '#10b981', tasks: ['Open spreads — primary entry day', 'Scan CC opportunities'] },
  { day: 'WED', color: '#f59e0b', tasks: ['Monitor positions', 'Check IA13 vs ATR levels'] },
  { day: 'THU', color: '#6366F1', tasks: ['2nd SPX entry on VIX spike', 'Roll CCs if < 7 DTE + ITM'] },
  { day: 'FRI', color: '#f43f5e', tasks: ['Close winners at 50%+ profit', 'Log trades & P&L'] },
]

// ─── $1M Roadmap — SPX 65 DTE ────────────────────────────────────────────────

const RM_START_CAPITAL  = 100_000
const RM_TARGET_CAPITAL = 1_000_000
const RM_WIN_RATE       = 80
const RM_DTE            = 65
const RM_MONTHLY_PCT    = 2.5

const RM_MILESTONES = [
  { capital: 100_000,   phase: 'LAUNCH',     color: '#6366F1' },
  { capital: 150_000,   phase: 'SCALE 1',    color: '#3b82f6' },
  { capital: 200_000,   phase: 'DOUBLED',    color: '#10b981' },
  { capital: 300_000,   phase: 'SCALE 2',    color: '#10b981' },
  { capital: 500_000,   phase: 'HALFWAY',    color: '#f59e0b' },
  { capital: 750_000,   phase: 'FINAL PUSH', color: '#f59e0b' },
  { capital: 1_000_000, phase: 'GOAL ★',     color: '#f43f5e' },
]

const RM_SCALING = [
  { when: '+$10k capital',      do: 'Add 1 contract',         why: 'Keeps max risk ≤ 10%' },
  { when: '20% drawdown',       do: 'Pause · cut size 50%',   why: 'Resume after 1 clean win' },
  { when: 'VIX > 30',          do: 'Widen strikes / sit out', why: 'Preserve capital in vol spikes' },
  { when: '3 losses in a row',  do: 'Half size',               why: 'Reset before scaling back' },
]

function buildMilestones() {
  const rate = RM_MONTHLY_PCT / 100
  return RM_MILESTONES.map(m => {
    const months = m.capital === RM_START_CAPITAL
      ? 0
      : Math.round(Math.log(m.capital / RM_START_CAPITAL) / Math.log(1 + rate))
    const yr = Math.floor(months / 12), mo = months % 12
    return {
      ...m,
      contracts: Math.floor(m.capital / 10_000),
      monthlyIncome: Math.round(m.capital * rate),
      timeLabel: months === 0 ? 'Day 1' : yr > 0 ? `Yr ${yr}${mo ? ` Mo ${mo}` : ''}` : `Mo ${months}`,
    }
  })
}

function buildCurve() {
  const rate = RM_MONTHLY_PCT / 100
  const pts: { month: number; capital: number }[] = []
  for (let m = 0; m <= 96; m += 2)
    pts.push({ month: m, capital: Math.round(RM_START_CAPITAL * Math.pow(1 + rate, m)) })
  return pts
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const tile: React.CSSProperties = {
  background: 'var(--bg-card)', border: '1px solid var(--border)',
  borderRadius: 10, overflow: 'hidden', display: 'flex', flexDirection: 'column',
}
const tileHdr: React.CSSProperties = {
  padding: '10px 16px', borderBottom: '1px solid var(--border)',
  fontSize: 11, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.1em', flexShrink: 0,
}
const mono: React.CSSProperties = { fontFamily: 'Share Tech Mono, monospace' }

// ─── Monthly data ─────────────────────────────────────────────────────────────

interface MonthData { key: string; label: string; total: number; tradeCount: number }

function buildMonthlyData(trades: RawTrade[]): MonthData[] {
  const map = new Map<string, MonthData>()
  for (const t of trades) {
    if (!t.tradeDate) continue
    const key = monthKey(t.tradeDate)
    if (!map.has(key)) map.set(key, { key, label: monthLabel(key), total: 0, tradeCount: 0 })
    const m = map.get(key)!
    m.total += t.netCash
    m.tradeCount++
  }
  return [...map.values()].sort((a, b) => a.key.localeCompare(b.key))
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function PlanView({ state }: Props) {
  const { trades, cashBalance, netLiquidation: ibkrNetLiq } = state.sync
  const capital = ibkrNetLiq ?? (state.sync.positions.reduce((s, p) => s + p.positionValue, 0) + cashBalance)

  const months      = useMemo(() => buildMonthlyData(trades), [trades])
  const totalPnL    = trades.reduce((s, t) => s + t.netCash, 0)
  const totalPremium = trades.filter(t => t.assetClass === 'OPT' && t.quantity < 0 && t.netCash > 0).reduce((s, t) => s + t.netCash, 0)
  const monthsWithData = months.filter(m => m.total !== 0)
  const avgMonthly  = monthsWithData.length ? monthsWithData.reduce((s, m) => s + m.total, 0) / monthsWithData.length : 0
  const onTrack     = avgMonthly >= MONTHLY_TARGET_MIN

  const milestones  = useMemo(buildMilestones, [])
  const curve       = useMemo(buildCurve, [])
  const maxCurve    = curve[curve.length - 1].capital
  const maxBar      = Math.max(...months.map(m => Math.abs(m.total)), 1)

  if (!state.strategies.length && !trades.length) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <EmptyState title="Trading Plan" message="Sync your IBKR portfolio to see your plan alongside real performance data." showUpload />
      </div>
    )
  }

  return (
    <div style={{ padding: 16, height: '100%', overflow: 'auto' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

        {/* ── Stats row ─────────────────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
          {[
            { label: 'NET LIQUIDATION',  value: capital > 0 ? fmt$(capital) : '—',  color: 'var(--text-1)' },
            { label: 'AVG MONTHLY',      value: fmt$(avgMonthly),                   color: onTrack ? '#10b981' : '#f59e0b' },
            { label: 'PREMIUM COLLECTED',value: fmt$(totalPremium),                 color: '#10b981' },
            { label: 'REALIZED P&L',     value: fmt$(totalPnL),                     color: totalPnL >= 0 ? '#10b981' : '#f43f5e' },
          ].map(s => (
            <div key={s.label} className="stat-card">
              <div className="stat-label">{s.label}</div>
              <div className="stat-value" style={{ color: s.color, fontSize: 22 }}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* ── $1M Roadmap ───────────────────────────────────────────────── */}
        <div style={{ ...tile, borderTop: '3px solid #f59e0b' }}>
          <div style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#f59e0b', letterSpacing: '0.14em', marginBottom: 4 }}>
                ROAD MAP · SPX {RM_DTE} DTE · {RM_WIN_RATE}% WIN RATE (10YR BACKTEST)
              </div>
              <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-1)', ...mono }}>$100k → $1,000,000</div>
              <div style={{ fontSize: 11, color: 'var(--text-4)', marginTop: 4 }}>
                {RM_MONTHLY_PCT}% avg monthly · 1 contract per $10k · 10% max risk · ~7.7 yrs fully compounded
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
              {[
                { label: 'DTE',      value: `${RM_DTE}` },
                { label: 'WIN RATE', value: `${RM_WIN_RATE}%` },
                { label: 'TIMELINE', value: '~7.7 yrs' },
              ].map(s => (
                <div key={s.label} style={{ textAlign: 'center', padding: '8px 16px', background: 'var(--bg-elevated)', borderRadius: 8 }}>
                  <div style={{ fontSize: 10, color: 'var(--text-4)', letterSpacing: '0.08em', marginBottom: 2 }}>{s.label}</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: '#f59e0b', ...mono }}>{s.value}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Milestones ────────────────────────────────────────────────── */}
        <div style={tile}>
          <div style={tileHdr}>MILESTONE PROGRESSION</div>
          <div style={{ padding: '20px 16px 16px', overflowX: 'auto' }}>
            <div style={{ display: 'flex', minWidth: 600, position: 'relative' }}>
              <div style={{ position: 'absolute', top: 11, left: '5%', right: '5%', height: 2, background: 'linear-gradient(90deg,#6366F1,#10b981 55%,#f59e0b 80%,#f43f5e)', zIndex: 0 }} />
              {milestones.map((m, i) => (
                <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative', zIndex: 1 }}>
                  <div style={{ width: 22, height: 22, borderRadius: '50%', background: m.color, border: '3px solid var(--bg-card)', boxShadow: `0 0 0 2px ${m.color}`, flexShrink: 0 }} />
                  <div style={{ marginTop: 10, textAlign: 'center' }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: m.color, ...mono }}>
                      {m.capital >= 1_000_000 ? '$1M' : `$${m.capital / 1000}k`}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-4)', letterSpacing: '0.05em', marginTop: 1 }}>{m.phase}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-3)', ...mono, marginTop: 3, fontWeight: 600 }}>{m.timeLabel}</div>
                    <div style={{ fontSize: 11, color: '#10b981', ...mono }}>{m.contracts} cts</div>
                    <div style={{ fontSize: 10, color: 'var(--text-4)' }}>${(m.monthlyIncome / 1000).toFixed(1)}k/mo</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Growth curve + scaling rules ──────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
          <div style={{ ...tile, minHeight: 180 }}>
            <div style={tileHdr}>COMPOUNDING GROWTH — 2.5%/mo REINVESTED</div>
            <div style={{ flex: 1, padding: '12px 16px 8px', display: 'flex', flexDirection: 'column' }}>
              <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end', gap: 1.5, paddingBottom: 20, position: 'relative', minHeight: 110 }}>
                <div style={{ position: 'absolute', bottom: 20, left: 0, right: 0, height: 1, background: 'var(--border)' }} />
                {curve.map((pt, i) => (
                  <div key={i} title={`Mo ${pt.month}: ${fmtK(pt.capital)}`}
                    style={{ flex: 1, height: `${Math.max((pt.capital / maxCurve) * 100, 1)}%`, borderRadius: '2px 2px 0 0', opacity: 0.85, minHeight: 2,
                      background: pt.capital >= RM_TARGET_CAPITAL ? '#f43f5e' : pt.capital >= 500_000 ? '#f59e0b' : pt.capital >= 200_000 ? '#10b981' : '#6366F1' }} />
                ))}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--text-4)', ...mono }}>
                {['Mo 0','Mo 16','Mo 32','Mo 48','Mo 64','Mo 80','Mo 93'].map(l => <span key={l}>{l}</span>)}
              </div>
              <div style={{ display: 'flex', gap: 14, marginTop: 8, flexWrap: 'wrap' }}>
                {[['#6366F1','$100k–$200k'],['#10b981','$200k–$500k'],['#f59e0b','$500k–$1M'],['#f43f5e','$1M reached']].map(([c,l]) => (
                  <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--text-3)' }}>
                    <div style={{ width: 8, height: 8, borderRadius: 2, background: c }} />{l}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div style={{ ...tile, borderTop: '3px solid #f43f5e' }}>
            <div style={{ ...tileHdr, color: '#f43f5e' }}>SCALING RULES</div>
            <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {RM_SCALING.map((r, i) => (
                <div key={i} style={{ padding: '8px 10px', background: 'var(--bg-elevated)', borderRadius: 6, borderLeft: '3px solid #f43f5e' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#f59e0b', letterSpacing: '0.06em', marginBottom: 2 }}>IF: {r.when}</div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-1)' }}>{r.do}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-4)', marginTop: 1 }}>{r.why}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Strategies ────────────────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          {STRATEGIES.map(s => (
            <div key={s.title} style={{ ...tile, borderTop: `3px solid ${s.color}` }}>
              <div style={{ ...tileHdr, color: s.color }}>{s.title}</div>
              <div style={{ padding: '10px 14px', flex: 1, display: 'flex', flexDirection: 'column', gap: 5 }}>
                {s.rules.map(r => (
                  <div key={r.label} style={{ display: 'flex', gap: 8, fontSize: 12, lineHeight: 1.5 }}>
                    <span style={{ color: 'var(--text-4)', minWidth: 90, flexShrink: 0 }}>{r.label}</span>
                    <span style={{ color: 'var(--text-1)', fontWeight: 500 }}>{r.value}</span>
                  </div>
                ))}
              </div>
              <div style={{ padding: '8px 14px', borderTop: '1px solid var(--border-light)', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {s.exit.map((e, i) => (
                  <span key={i} style={{ fontSize: 11, color: 'var(--text-3)' }}>
                    {i > 0 && <span style={{ marginRight: 8, color: 'var(--text-5)' }}>·</span>}{e}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* ── Monthly P&L chart ─────────────────────────────────────────── */}
        {months.length > 0 && (
          <div style={{ ...tile, minHeight: 160 }}>
            <div style={tileHdr}>MONTHLY NET P&L</div>
            <div style={{ flex: 1, padding: '10px 14px', minHeight: 120 }}>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: '100%', minHeight: 100, paddingBottom: 20, position: 'relative' }}>
                <div style={{ position: 'absolute', bottom: 20, left: 0, right: 0, height: 1, background: 'var(--border)' }} />
                {months.map(m => (
                  <div key={m.key} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%', position: 'relative' }}
                    title={`${m.label}: ${fmt$(m.total)} (${m.tradeCount} trades)`}>
                    <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end', width: '100%' }}>
                      <div style={{ width: '100%', height: Math.max((Math.abs(m.total) / maxBar) * 90, 2), background: m.total >= 0 ? '#10b981' : '#f43f5e', borderRadius: '2px 2px 0 0', opacity: 0.85 }} />
                    </div>
                    <div style={{ position: 'absolute', bottom: 2, fontSize: 9, color: 'var(--text-4)', ...mono, whiteSpace: 'nowrap' }}>{m.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Weekly routine ────────────────────────────────────────────── */}
        <div style={tile}>
          <div style={tileHdr}>WEEKLY ROUTINE</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)' }}>
            {WEEK.map((d, i) => (
              <div key={d.day} style={{ padding: '12px 14px', borderRight: i < 4 ? '1px solid var(--border)' : 'none' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: d.color, letterSpacing: 2, marginBottom: 8 }}>{d.day}</div>
                {d.tasks.map((t, j) => (
                  <div key={j} style={{ display: 'flex', gap: 6, marginBottom: 4, fontSize: 11, color: 'var(--text-2)', lineHeight: 1.4 }}>
                    <span style={{ color: 'var(--text-4)', flexShrink: 0 }}>·</span>{t}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  )
}
