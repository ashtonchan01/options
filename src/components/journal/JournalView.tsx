/**
 * Trade Journal building blocks — Edgewonk-style journal & analytics over IBKR
 * Flex data. Exports OverviewTab (KPIs, equity curve, Edge Finder, breakdowns)
 * and JournalTab (per-position setup/mistake/rating/notes), both rendered as
 * columns on the Portfolio tab (see PortfolioView.tsx).
 */
import { useMemo, useState } from 'react'
import {
  computeStats, equityCurve, breakdown, openPremiumTotal,
  byUnderlying, byStrategy, byMonth, byDteBucket, byHoldBucket,
  edgeInsights,
  type JournalPosition, type EquityPoint, type BreakdownRow,
} from '../../engine/journal'
import { MISTAKES, type JournalEntry } from '../../store/journalStore'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt$(n: number, d = 0) {
  const sign = n < 0 ? '-' : ''
  return `${sign}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`
}

function fmtDate(s: string) {
  const d = new Date(s)
  return isNaN(d.getTime()) ? s : d.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: '2-digit' })
}

/** IBKR's raw "YYYYMMDD" dates (no separators) fail `new Date()` silently —
 * it returns Invalid Date rather than throwing, so callers that don't guard
 * for it end up printing the raw digit string untouched. Normalize first. */
function fmtMonthYear(s: string) {
  const iso = /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : s
  const d = new Date(iso)
  return isNaN(d.getTime()) ? s : d.toLocaleDateString('en-AU', { month: 'short', year: 'numeric' })
}

function fmtMonth(ym: string) {
  const d = new Date(`${ym}-01`)
  return isNaN(d.getTime()) ? ym : d.toLocaleDateString('en-AU', { month: 'short', year: '2-digit' })
}

function pnlCls(n: number) { return n > 0 ? 'pos' : n < 0 ? 'neg' : 'neu' }
function pnlColor(n: number) { return n > 0 ? '#10b981' : n < 0 ? '#ef4444' : 'var(--text-4)' }

const TODAY_JR = new Date(); TODAY_JR.setHours(0, 0, 0, 0)

/** Days left until expiry (can be negative once past it). */
function dte(expiry: string): number | null {
  if (!expiry) return null
  const s = /^\d{8}$/.test(expiry) ? `${expiry.slice(0, 4)}-${expiry.slice(4, 6)}-${expiry.slice(6, 8)}` : expiry
  const d = new Date(s)
  if (isNaN(d.getTime())) return null
  return Math.round((d.getTime() - TODAY_JR.getTime()) / 86_400_000)
}

const LABEL_SHORT: Record<string, string> = {
  covered_calls: 'CC', csp: 'CSP', leap: 'LEAP', spx: 'SPX', rotation: 'ROT',
  ptos: 'PTOS', dcas: 'DCAS', profit_taking: 'PT', lilo: 'LILO',
  arb_cloud: 'ARB', tabi: 'TABI', forex: 'FX', assignment: 'ASGN', unlabelled: '—',
  put_spread: 'BPS', shares: 'SHARES',
}

const LABEL_COLORS: Record<string, string> = {
  covered_calls: '#3b82f6', csp: '#10b981', leap: '#a78bfa', spx: '#f59e0b',
  rotation: '#f472b6', ptos: '#60a5fa', profit_taking: '#34d399',
  put_spread: '#fb923c', shares: '#38bdf8',
}

function StratBadge({ strategy }: { strategy?: string }) {
  const key = strategy ?? 'unlabelled'
  const color = LABEL_COLORS[key] ?? 'var(--text-4)'
  return (
    <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', letterSpacing: '0.06em',
      color, background: `${strategy ? color + '14' : 'transparent'}`,
      border: `1px solid ${strategy ? color + '40' : 'var(--border)'}` }}>
      {LABEL_SHORT[key] ?? key.toUpperCase().slice(0, 4)}
    </span>
  )
}

// ─── KPI strip ────────────────────────────────────────────────────────────────

function KpiStrip({ closed, openPremium }: { closed: JournalPosition[]; openPremium: number }) {
  const s = useMemo(() => computeStats(closed), [closed])
  const pf = s.profitFactor === Infinity ? '∞' : s.profitFactor.toFixed(2)
  // Tried folding open-position net premium into this figure to match the
  // spreadsheet's per-row convention, but verified against real data it makes
  // the total wildly wrong (the spreadsheet's own weekly/monthly tally is
  // realized-P&L-only, despite showing raw premium in the per-position table)
  // — so Net P&L stays realized-only; open premium is a separate reference
  // stat below instead.
  const cards = [
    { label: 'Net P&L',       value: fmt$(s.netPnl),                 color: pnlColor(s.netPnl) },
    { label: 'Win Rate',      value: s.trades ? `${s.winRate.toFixed(0)}%` : '—',
      color: s.winRate >= 65 ? '#10b981' : s.winRate >= 50 ? '#f59e0b' : '#ef4444' },
    { label: 'Profit Factor', value: s.trades ? pf : '—',            color: s.profitFactor >= 1.5 ? '#10b981' : s.profitFactor >= 1 ? '#f59e0b' : '#ef4444' },
    { label: 'Expectancy',    value: fmt$(s.expectancy),             color: pnlColor(s.expectancy) },
    { label: 'Avg Win',       value: fmt$(s.avgWin),                 color: '#10b981' },
    { label: 'Avg Loss',      value: fmt$(s.avgLoss),                color: '#ef4444' },
    { label: 'Payoff Ratio',  value: s.payoff ? s.payoff.toFixed(2) : '—', color: 'var(--text-1)' },
    { label: 'Max Drawdown',  value: fmt$(-s.maxDrawdown),           color: '#f59e0b' },
  ]
  const minis = [
    { label: 'Realised P&L',  value: fmt$(s.netPnl) },
    { label: 'Open Premium',  value: fmt$(openPremium) },
    { label: 'Closed Trades', value: String(s.trades) },
    { label: 'Streak',        value: s.currentStreak === 0 ? '—' : `${s.currentStreak > 0 ? 'W' : 'L'}${Math.abs(s.currentStreak)}` },
    { label: 'Best Streak',   value: `W${s.longestWinStreak} / L${s.longestLossStreak}` },
    { label: 'Best Trade',    value: fmt$(s.bestTrade) },
    { label: 'Worst Trade',   value: fmt$(s.worstTrade) },
    { label: 'Avg Hold',      value: `${s.avgHoldDays.toFixed(1)}d` },
    { label: 'Total Fees',    value: fmt$(s.totalFees, 2) },
  ]
  return (
    <>
      <div className="jr-kpi-grid">
        {cards.map(c => (
          <div key={c.label} className="stat-card" style={{ padding: '10px 14px' }}>
            <div className="stat-label">{c.label}</div>
            <div className="stat-value" style={{ fontSize: 19, color: c.color }}>{c.value}</div>
          </div>
        ))}
      </div>
      <div className="jr-mini-strip">
        {minis.map(m => (
          <div key={m.label} className="jr-mini">
            <span className="label">{m.label}</span>
            <span className="mono" style={{ color: 'var(--text-1)', fontWeight: 600 }}>{m.value}</span>
          </div>
        ))}
      </div>
    </>
  )
}

// ─── Equity curve ─────────────────────────────────────────────────────────────

function EquityChart({ points }: { points: EquityPoint[] }) {
  if (points.length < 2) {
    return <div className="db-empty-msg" style={{ minHeight: 140 }}>Need at least 2 closed trades to draw the curve</div>
  }
  const W = 1000, H = 230, PL = 58, PR = 14, PT = 16, PB = 26
  const min = Math.min(0, ...points.map(p => p.equity))
  const max = Math.max(1, ...points.map(p => p.equity))
  const x = (i: number) => PL + (i / (points.length - 1)) * (W - PL - PR)
  const y = (v: number) => PT + (1 - (v - min) / (max - min)) * (H - PT - PB)
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.equity).toFixed(1)}`).join(' ')
  const y0 = y(0)
  const area = `${line} L${x(points.length - 1).toFixed(1)},${y0.toFixed(1)} L${x(0).toFixed(1)},${y0.toFixed(1)} Z`
  const gridVals = [0, 0.25, 0.5, 0.75, 1].map(f => min + f * (max - min))
  const last = points[points.length - 1]
  const mid = points[Math.floor(points.length / 2)]

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block' }}>
      <defs>
        <linearGradient id="jr-eq-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#10b981" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#10b981" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {gridVals.map((v, i) => (
        <g key={i}>
          <line x1={PL} x2={W - PR} y1={y(v)} y2={y(v)} stroke="rgba(16,185,129,0.08)" strokeWidth="1" />
          <text x={PL - 6} y={y(v) + 3} textAnchor="end" fill="var(--text-4)" fontSize="10" fontFamily="Inter, sans-serif">
            {fmt$(v)}
          </text>
        </g>
      ))}
      {min < 0 && <line x1={PL} x2={W - PR} y1={y0} y2={y0} stroke="rgba(239,68,68,0.35)" strokeWidth="1" strokeDasharray="4 3" />}
      <path d={area} fill="url(#jr-eq-fill)" />
      <path d={line} fill="none" stroke="#10b981" strokeWidth="1.8" style={{ filter: 'drop-shadow(0 0 6px rgba(16,185,129,0.45))' }} />
      <circle cx={x(points.length - 1)} cy={y(last.equity)} r="3.5" fill="#10b981" />
      <text x={x(points.length - 1) - 6} y={y(last.equity) - 8} textAnchor="end" fill="#10b981" fontSize="11" fontWeight="700" fontFamily="Inter, sans-serif">
        {fmt$(last.equity)}
      </text>
      {[points[0], mid, last].map((p, i) => (
        <text key={i} x={x(i === 0 ? 0 : i === 1 ? Math.floor(points.length / 2) : points.length - 1)} y={H - 8}
          textAnchor={i === 0 ? 'start' : i === 1 ? 'middle' : 'end'} fill="var(--text-4)" fontSize="10" fontFamily="Inter, sans-serif">
          {fmtMonthYear(p.date)}
        </text>
      ))}
    </svg>
  )
}

// ─── Monthly P&L bars ─────────────────────────────────────────────────────────

function MonthlyBars({ closed }: { closed: JournalPosition[] }) {
  const rows = useMemo(
    () => breakdown(closed, byMonth).sort((a, b) => a.key.localeCompare(b.key)).slice(-12),
    [closed],
  )
  if (rows.length === 0) return <div className="db-empty-msg" style={{ minHeight: 120 }}>No closed trades yet</div>
  const W = 560, H = 190, PL = 50, PR = 8, PT = 12, PB = 24
  const maxAbs = Math.max(...rows.map(r => Math.abs(r.netPnl)), 1)
  const y0 = PT + (H - PT - PB) / 2
  const scale = (H - PT - PB) / 2 / maxAbs
  const bw = (W - PL - PR) / rows.length

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block' }}>
      <line x1={PL} x2={W - PR} y1={y0} y2={y0} stroke="rgba(16,185,129,0.18)" strokeWidth="1" />
      <text x={PL - 5} y={y0 - maxAbs * scale + 4} textAnchor="end" fill="var(--text-4)" fontSize="9" fontFamily="Inter, sans-serif">{fmt$(maxAbs)}</text>
      <text x={PL - 5} y={y0 + 3} textAnchor="end" fill="var(--text-4)" fontSize="9" fontFamily="Inter, sans-serif">$0</text>
      {rows.map((r, i) => {
        const h = Math.abs(r.netPnl) * scale
        const bx = PL + i * bw + bw * 0.18
        const by = r.netPnl >= 0 ? y0 - h : y0
        return (
          <g key={r.key}>
            <rect x={bx} y={by} width={bw * 0.64} height={Math.max(h, 1)}
              fill={r.netPnl >= 0 ? 'rgba(16,185,129,0.75)' : 'rgba(239,68,68,0.75)'} />
            <text x={bx + bw * 0.32} y={H - 8} textAnchor="middle" fill="var(--text-4)" fontSize="8.5" fontFamily="Inter, sans-serif">
              {fmtMonth(r.key)}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

// ─── Edge Finder panel ────────────────────────────────────────────────────────

const INSIGHT_COLOR = { strength: '#10b981', weakness: '#ef4444', info: '#10b981' }

function EdgeFinder({ closed, entries }: { closed: JournalPosition[]; entries: Record<string, JournalEntry> }) {
  const insights = useMemo(() => edgeInsights(closed, entries), [closed, entries])
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 14px' }}>
      {insights.map((ins, i) => (
        <div key={i} style={{ borderLeft: `2px solid ${INSIGHT_COLOR[ins.kind]}`, paddingLeft: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: INSIGHT_COLOR[ins.kind], letterSpacing: '0.04em' }}>
            {ins.kind === 'strength' ? '▲ ' : ins.kind === 'weakness' ? '▼ ' : '◈ '}{ins.title}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{ins.detail}</div>
        </div>
      ))}
    </div>
  )
}

// ─── Breakdown table ──────────────────────────────────────────────────────────

function BreakTable({ title, rows, keyHeader, fmtKey }: {
  title: string; rows: BreakdownRow[]; keyHeader: string; fmtKey?: (k: string) => string
}) {
  return (
    <div className="panel" style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div className="db-panel-header">{title}</div>
      {/* A fixed height (not maxHeight) means every card scrolls internally
          whenever it has more rows than fit, instead of relying on the outer
          page to have scrolled far enough to reveal a card that happened to
          sit right at the bottom of the viewport (By Entry DTE / By Hold
          Time's rows were getting cut off with no way to reach them). */}
      <div className="jr-break-table-scroll" style={{ overflow: 'auto', height: 200 }}>
        <table className="trade-table" style={{ fontSize: 11 }}>
          <thead>
            <tr>
              <th>{keyHeader}</th>
              <th style={{ textAlign: 'right' }}>Trades</th>
              <th style={{ textAlign: 'right' }}>Win%</th>
              <th style={{ textAlign: 'right' }}>Net P&L</th>
              <th style={{ textAlign: 'right' }}>Avg</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.key}>
                <td className="mono" style={{ color: 'var(--text-1)', fontWeight: 600 }}>{fmtKey ? fmtKey(r.key) : r.key}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{r.trades}</td>
                <td className="mono" style={{ textAlign: 'right', color: r.winRate >= 65 ? '#10b981' : r.winRate >= 50 ? '#f59e0b' : '#ef4444' }}>
                  {r.winRate.toFixed(0)}%
                </td>
                <td className={`mono ${pnlCls(r.netPnl)}`} style={{ textAlign: 'right', fontWeight: 700 }}>{fmt$(r.netPnl)}</td>
                <td className={`mono ${pnlCls(r.avgPnl)}`} style={{ textAlign: 'right' }}>{fmt$(r.avgPnl)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Overview sub-view ────────────────────────────────────────────────────────

export function OverviewTab({ closed, positions, entries }: {
  closed: JournalPosition[]; positions: JournalPosition[]; entries: Record<string, JournalEntry>
}) {
  const curve = useMemo(() => equityCurve(closed), [closed])
  const openPremium = useMemo(() => openPremiumTotal(positions), [positions])
  return (
    <>
      <KpiStrip closed={closed} openPremium={openPremium} />

      <div className="cc-section">
        <div className="cc-section-title" style={{ padding: 0 }}>Equity Curve — Realised P&L</div>
        <div className="panel" style={{ padding: '10px 12px 4px' }}>
          <EquityChart points={curve} />
        </div>
      </div>

      <div className="jr-2col">
        <div>
          <div className="cc-section-title" style={{ padding: 0 }}>Monthly P&L</div>
          <div className="panel" style={{ padding: '10px 12px 4px' }}>
            <MonthlyBars closed={closed} />
          </div>
        </div>
        <div>
          <div className="cc-section-title" style={{ padding: 0 }}>Edge Finder</div>
          <div className="panel">
            <EdgeFinder closed={closed} entries={entries} />
          </div>
        </div>
      </div>

      <div className="cc-section-title" style={{ padding: 0, marginBottom: 0 }}>Edge Breakdown</div>
      <div className="jr-break-grid">
        <BreakTable title="By Underlying"  keyHeader="Ticker"   rows={breakdown(closed, byUnderlying)} />
        <BreakTable title="By Strategy"    keyHeader="Strategy" rows={breakdown(closed, byStrategy)} fmtKey={k => LABEL_SHORT[k] ?? k} />
        <BreakTable title="By Entry DTE"   keyHeader="DTE"      rows={breakdown(closed, byDteBucket)} />
        <BreakTable title="By Hold Time"   keyHeader="Held"     rows={breakdown(closed, byHoldBucket)} />
      </div>
    </>
  )
}

// ─── Journal sub-view ─────────────────────────────────────────────────────────

type JFilter = 'all' | 'wins' | 'losses' | 'active' | 'unreviewed'

function isReviewed(e?: JournalEntry) {
  return !!(e && (e.setup || e.rating || e.note || (e.mistakes?.length ?? 0) > 0))
}

function RatingPicker({ value, onChange }: { value?: number; onChange: (n?: number) => void }) {
  return (
    <span style={{ display: 'inline-flex', gap: 2 }}>
      {[1, 2, 3, 4, 5].map(n => (
        <button key={n} onClick={e => { e.stopPropagation(); onChange(value === n ? undefined : n) }}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 13,
            color: (value ?? 0) >= n ? '#10b981' : 'var(--text-5)',
            textShadow: (value ?? 0) >= n ? '0 0 6px rgba(16,185,129,0.6)' : 'none' }}>
          ◆
        </button>
      ))}
    </span>
  )
}

function EntryEditor({ pos, entry, updateEntry, setups, addSetup }: {
  pos: JournalPosition
  entry: JournalEntry
  updateEntry: (id: string, patch: Partial<JournalEntry>) => void
  setups: string[]
  addSetup: (s: string) => void
}) {
  const mistakes = entry.mistakes ?? []
  function toggleMistake(m: string) {
    updateEntry(pos.id, { mistakes: mistakes.includes(m) ? mistakes.filter(x => x !== m) : [...mistakes, m] })
  }
  function onSetupChange(v: string) {
    if (v === '__add') {
      const name = window.prompt('New setup name')
      if (name?.trim()) { addSetup(name); updateEntry(pos.id, { setup: name.trim() }) }
    } else {
      updateEntry(pos.id, { setup: v || undefined })
    }
  }
  return (
    <div className="jr-editor">
      <div className="jr-editor-row">
        <div className="cc-control-group">
          <label className="cc-control-label">Setup</label>
          <select className="cc-select" style={{ minWidth: 180 }} value={entry.setup ?? ''} onChange={e => onSetupChange(e.target.value)}>
            <option value="">— none —</option>
            {setups.map(s => <option key={s} value={s}>{s}</option>)}
            <option value="__add">＋ Add custom…</option>
          </select>
        </div>
        <div className="cc-control-group">
          <label className="cc-control-label">Execution Grade</label>
          <RatingPicker value={entry.rating} onChange={n => updateEntry(pos.id, { rating: n })} />
        </div>
      </div>
      <div className="cc-control-group">
        <label className="cc-control-label">Mistakes</label>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {MISTAKES.map(m => {
            const on = mistakes.includes(m)
            return (
              <button key={m} className="tl-filter-chip" onClick={() => toggleMistake(m)}
                style={on ? { borderColor: '#ef4444', color: '#ef4444', background: 'rgba(239,68,68,0.10)' } : undefined}>
                {m}
              </button>
            )
          })}
        </div>
      </div>
      <div className="cc-control-group">
        <label className="cc-control-label">Notes</label>
        <textarea className="jr-note" rows={3} placeholder="What happened? What would you do differently?"
          value={entry.note ?? ''} onChange={e => updateEntry(pos.id, { note: e.target.value || undefined })} />
      </div>
    </div>
  )
}

/** Collapses every SHARES lot (buy/sell FIFO-matched pairs plus any still-open
 * remainder — buildStockPositions emits one JournalPosition per lot) down to a
 * single display row per ticker, so a stock traded in and out repeatedly doesn't
 * flood the table with one row per lot. Realized P&L sums across closed lots;
 * an aggregate row is "Active" if any lot still holds shares. This is a display-
 * only merge — it doesn't touch the underlying per-lot data other tabs rely on. */
function aggregateShares(positions: JournalPosition[]): JournalPosition[] {
  const shareLots = positions.filter(p => p.strikeDisplay === 'SHARES')
  const others = positions.filter(p => p.strikeDisplay !== 'SHARES')
  if (shareLots.length === 0) return positions

  const byTicker = new Map<string, JournalPosition[]>()
  for (const p of shareLots) {
    if (!byTicker.has(p.underlying)) byTicker.set(p.underlying, [])
    byTicker.get(p.underlying)!.push(p)
  }

  const merged: JournalPosition[] = []
  for (const [ticker, lots] of byTicker) {
    const activeLots = lots.filter(l => l.status === 'Active')
    const closedLots = lots.filter(l => l.status !== 'Active')
    const anyActive = activeLots.length > 0
    const totalContracts = (anyActive ? activeLots : lots).reduce((s, l) => s + l.contracts, 0)
    const hasClosedPnl = closedLots.some(l => l.pnl != null)
    merged.push({
      id: `shares-agg|${ticker}`,
      underlying: ticker,
      contracts: totalContracts,
      strikeDisplay: 'SHARES',
      putCall: '',
      expiry: '',
      dateOpen: lots.reduce((min, l) => (l.dateOpen < min ? l.dateOpen : min), lots[0].dateOpen),
      initialDTE: 0,
      openFees: lots.reduce((s, l) => s + l.openFees, 0),
      netPremium: lots.reduce((s, l) => s + l.netPremium, 0),
      status: anyActive ? 'Active' : 'Closed',
      strategy: 'shares',
      tradeIds: lots.flatMap(l => l.tradeIds),
      dateClosed: anyActive ? undefined : closedLots.reduce((max, l) => (l.dateClosed && l.dateClosed > max ? l.dateClosed : max), closedLots[0]?.dateClosed ?? ''),
      closeFees: closedLots.reduce((s, l) => s + (l.closeFees ?? 0), 0),
      pnl: hasClosedPnl ? closedLots.reduce((s, l) => s + (l.pnl ?? 0), 0) : undefined,
      holdDays: undefined,
    })
  }
  return [...others, ...merged]
}

const STRAT_GROUP_ORDER = [
  'leap', 'csp', 'covered_calls', 'put_spread', 'spx', 'shares',
  'rotation', 'ptos', 'dcas', 'profit_taking', 'lilo', 'arb_cloud', 'tabi', 'forex', 'assignment',
]
function stratGroupRank(strategy?: string) {
  const i = STRAT_GROUP_ORDER.indexOf(strategy ?? 'unlabelled')
  return i === -1 ? STRAT_GROUP_ORDER.length : i
}
function stratGroupLabel(strategy?: string) {
  const key = strategy ?? 'unlabelled'
  return LABEL_SHORT[key] ?? key.toUpperCase()
}

export function JournalTab({ positions, entries, updateEntry, setups, addSetup }: {
  positions: JournalPosition[]
  entries: Record<string, JournalEntry>
  updateEntry: (id: string, patch: Partial<JournalEntry>) => void
  setups: string[]
  addSetup: (s: string) => void
}) {
  const [filter, setFilter] = useState<JFilter>('all')
  const [hideClosed, setHideClosed] = useState(false)
  const [groupByStrategy, setGroupByStrategy] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)

  const displayPositions = useMemo(() => aggregateShares(positions), [positions])

  const rows = useMemo(() => {
    // Open positions first (most-recently-opened first within that group), then
    // closed positions most-recently-closed first.
    const sorted = [...displayPositions].sort((a, b) => {
      const aActive = a.status === 'Active' ? 0 : 1
      const bActive = b.status === 'Active' ? 0 : 1
      if (aActive !== bActive) return aActive - bActive
      return (b.dateClosed ?? b.dateOpen).localeCompare(a.dateClosed ?? a.dateOpen)
    })
    let filtered: JournalPosition[]
    switch (filter) {
      case 'wins':       filtered = sorted.filter(p => (p.pnl ?? 0) > 0 && p.status !== 'Active'); break
      case 'losses':     filtered = sorted.filter(p => (p.pnl ?? 0) < 0 && p.status !== 'Active'); break
      case 'active':     filtered = sorted.filter(p => p.status === 'Active'); break
      case 'unreviewed': filtered = sorted.filter(p => p.status !== 'Active' && !isReviewed(entries[p.id])); break
      default:           filtered = sorted
    }
    return hideClosed ? filtered.filter(p => p.status === 'Active') : filtered
  }, [displayPositions, filter, entries, hideClosed])

  const counts = useMemo(() => ({
    all: displayPositions.length,
    wins: displayPositions.filter(p => (p.pnl ?? 0) > 0 && p.status !== 'Active').length,
    losses: displayPositions.filter(p => (p.pnl ?? 0) < 0 && p.status !== 'Active').length,
    active: displayPositions.filter(p => p.status === 'Active').length,
    unreviewed: displayPositions.filter(p => p.status !== 'Active' && !isReviewed(entries[p.id])).length,
  }), [displayPositions, entries])

  const FILTERS: { id: JFilter; label: string }[] = [
    { id: 'all', label: `All (${counts.all})` },
    { id: 'wins', label: `Wins (${counts.wins})` },
    { id: 'losses', label: `Losses (${counts.losses})` },
    { id: 'active', label: `Active (${counts.active})` },
    { id: 'unreviewed', label: `Unreviewed (${counts.unreviewed})` },
  ]

  const groups = useMemo(() => {
    if (!groupByStrategy) return [{ label: null as string | null, rows }]
    const byStrat = new Map<string, JournalPosition[]>()
    for (const p of rows) {
      const key = p.strategy ?? 'unlabelled'
      if (!byStrat.has(key)) byStrat.set(key, [])
      byStrat.get(key)!.push(p)
    }
    return [...byStrat.entries()]
      .sort((a, b) => stratGroupRank(a[0]) - stratGroupRank(b[0]))
      .map(([key, groupRows]) => ({ label: stratGroupLabel(key), rows: groupRows }))
  }, [rows, groupByStrategy])

  const COLS = 8

  return (
    <>
      <div className="tl-filter-row" style={{ alignItems: 'center' }}>
        {FILTERS.map(f => (
          <button key={f.id} className={`tl-filter-chip${filter === f.id ? ' active' : ''}`} onClick={() => setFilter(f.id)}>
            {f.label}
          </button>
        ))}
        <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-3)', marginLeft: 8, cursor: 'pointer', fontFamily: 'Inter, sans-serif' }}>
          <input type="checkbox" checked={hideClosed} onChange={e => setHideClosed(e.target.checked)} />
          Hide closed
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-3)', marginLeft: 8, cursor: 'pointer', fontFamily: 'Inter, sans-serif' }}>
          <input type="checkbox" checked={groupByStrategy} onChange={e => setGroupByStrategy(e.target.checked)} />
          Group by strategy
        </label>
      </div>

      <div className="cc-section cc-table-section" style={{ flexShrink: 1 }}>
        <div className="jr-trade-table-scroll" style={{ overflow: 'auto' }}>
          <table className="trade-table" style={{ fontSize: 12 }}>
            <thead>
              <tr>
                <th className="jr-col-open">Open</th>
                <th className="jr-col-closed">Closed</th>
                <th>Ticker</th>
                <th style={{ textAlign: 'center' }}>Strat</th>
                <th style={{ textAlign: 'right', maxWidth: 80 }}>Position</th>
                <th className="jr-col-status" style={{ textAlign: 'center' }}>Status</th>
                <th className="jr-col-dte" style={{ textAlign: 'right' }}>DTE</th>
                <th style={{ textAlign: 'right' }}>P&L</th>
              </tr>
            </thead>
            <tbody>
              {groups.map(g => (
                <FragmentGroup key={g.label ?? 'all'}>
                  {g.label && (
                    <tr>
                      <td colSpan={COLS} style={{ padding: '5px 12px', fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--text-4)', background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border)' }}>
                        {g.label} · {g.rows.length}
                      </td>
                    </tr>
                  )}
                  {g.rows.map(p => {
                    const e = entries[p.id] ?? {}
                    const open = expanded === p.id
                    return (
                      <Row key={p.id} pos={p} entry={e} open={open} cols={COLS}
                        onToggle={() => setExpanded(open ? null : p.id)}
                        editor={
                          <EntryEditor pos={p} entry={e} updateEntry={updateEntry} setups={setups} addSetup={addSetup} />
                        } />
                    )
                  })}
                </FragmentGroup>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={COLS} style={{ textAlign: 'center', color: 'var(--text-5)', padding: 24 }}>Nothing here</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

// tbody can't nest a wrapping element other than <tr>/fragments — this just
// gives each group a stable React key without adding a DOM node.
function FragmentGroup({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}

function Row({ pos: p, open, cols, onToggle, editor }: {
  pos: JournalPosition; entry: JournalEntry; open: boolean; cols: number
  onToggle: () => void; editor: React.ReactNode
}) {
  const statusColor = p.status === 'Active' ? '#10b981' : p.status === 'Closed' ? '#f59e0b' : 'var(--text-4)'
  const daysLeft = dte(p.expiry)
  const urgent = p.status === 'Active' && daysLeft != null && daysLeft <= 7
  return (
    <>
      <tr onClick={onToggle} style={{ cursor: 'pointer', background: open ? 'rgba(16,185,129,0.05)' : urgent ? 'rgba(239,68,68,0.08)' : undefined }}>
        <td className="mono jr-col-open" style={{ whiteSpace: 'nowrap', color: 'var(--text-3)' }}>
          {fmtDate(p.dateOpen)}
        </td>
        <td className="mono jr-col-closed" style={{ whiteSpace: 'nowrap', color: 'var(--text-3)' }}>
          {p.dateClosed ? fmtDate(p.dateClosed) : '—'}
        </td>
        <td className="mono" style={{ fontWeight: 700, color: 'var(--text-1)' }}>{p.underlying}</td>
        <td style={{ textAlign: 'center' }}><StratBadge strategy={p.strategy} /></td>
        <td className="mono" style={{ textAlign: 'right', maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          title={p.strikeDisplay === 'SHARES' ? undefined : `${p.contracts}× ${p.strikeDisplay}`}>
          {p.strikeDisplay === 'SHARES' ? `${p.contracts} sh` : `${p.contracts}× ${p.strikeDisplay}`}
        </td>
        <td className="jr-col-status" style={{ textAlign: 'center' }}>
          <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', letterSpacing: '0.06em',
            color: statusColor, border: `1px solid ${statusColor}40` }}>
            {p.status}
          </span>
        </td>
        <td className="mono jr-col-dte" style={{ textAlign: 'right', color: urgent ? '#ef4444' : 'var(--text-3)', fontWeight: urgent ? 700 : 400 }}>
          {daysLeft != null ? `${daysLeft}d` : '—'}
        </td>
        <td className={`mono ${p.pnl != null ? pnlCls(p.pnl) : ''}`} style={{ textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' }}>
          {p.pnl != null ? fmt$(p.pnl, 2) : '—'}
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={cols} style={{ padding: 0, background: 'rgba(16,185,129,0.03)' }}>
            {editor}
          </td>
        </tr>
      )}
    </>
  )
}

