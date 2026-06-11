/**
 * Trade Journal — Edgewonk-style journal & analytics over IBKR Flex data.
 * Three sub-views: Overview (KPIs, equity curve, Edge Finder, breakdowns),
 * Journal (per-position setup/mistake/rating/notes), Psych Lab (Tiltmeter,
 * mistake cost, discipline edge).
 */
import { useMemo, useState } from 'react'
import type { AppState } from '../../types'
import type { TradeLabels } from '../../App'
import {
  buildJournalPositions, closedByDate, computeStats, equityCurve, breakdown,
  byUnderlying, byStrategy, byWeekday, byMonth, byDteBucket, byHoldBucket,
  edgeInsights,
  type JournalPosition, type EquityPoint, type BreakdownRow,
} from '../../engine/journal'
import { useJournalStore, MISTAKES, type JournalEntry } from '../../store/journalStore'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt$(n: number, d = 0) {
  const sign = n < 0 ? '-' : ''
  return `${sign}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`
}

function fmtDate(s: string) {
  const d = new Date(s)
  return isNaN(d.getTime()) ? s : d.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: '2-digit' })
}

function fmtMonth(ym: string) {
  const d = new Date(`${ym}-01`)
  return isNaN(d.getTime()) ? ym : d.toLocaleDateString('en-AU', { month: 'short', year: '2-digit' })
}

function pnlCls(n: number) { return n > 0 ? 'pos' : n < 0 ? 'neg' : 'neu' }
function pnlColor(n: number) { return n > 0 ? '#2bd97c' : n < 0 ? '#ff4655' : 'var(--text-4)' }

const LABEL_SHORT: Record<string, string> = {
  covered_calls: 'CC', csp: 'CSP', leap: 'LEAP', spx: 'SPX', rotation: 'ROT',
  ptos: 'PTOS', dcas: 'DCAS', profit_taking: 'PT', lilo: 'LILO',
  arb_cloud: 'ARB', tabi: 'TABI', forex: 'FX', assignment: 'ASGN', unlabelled: '—',
}

const LABEL_COLORS: Record<string, string> = {
  covered_calls: '#00e5ff', csp: '#2bd97c', leap: '#a78bfa', spx: '#ffb300',
  rotation: '#f472b6', ptos: '#60a5fa', profit_taking: '#34d399',
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

function KpiStrip({ closed }: { closed: JournalPosition[] }) {
  const s = useMemo(() => computeStats(closed), [closed])
  const pf = s.profitFactor === Infinity ? '∞' : s.profitFactor.toFixed(2)
  const cards = [
    { label: 'Net P&L',       value: fmt$(s.netPnl),                 color: pnlColor(s.netPnl) },
    { label: 'Win Rate',      value: s.trades ? `${s.winRate.toFixed(0)}%` : '—',
      color: s.winRate >= 65 ? '#2bd97c' : s.winRate >= 50 ? '#ffb300' : '#ff4655' },
    { label: 'Profit Factor', value: s.trades ? pf : '—',            color: s.profitFactor >= 1.5 ? '#2bd97c' : s.profitFactor >= 1 ? '#ffb300' : '#ff4655' },
    { label: 'Expectancy',    value: fmt$(s.expectancy),             color: pnlColor(s.expectancy) },
    { label: 'Avg Win',       value: fmt$(s.avgWin),                 color: '#2bd97c' },
    { label: 'Avg Loss',      value: fmt$(s.avgLoss),                color: '#ff4655' },
    { label: 'Payoff Ratio',  value: s.payoff ? s.payoff.toFixed(2) : '—', color: 'var(--text-1)' },
    { label: 'Max Drawdown',  value: fmt$(-s.maxDrawdown),           color: '#ffb300' },
  ]
  const minis = [
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
          <stop offset="0%" stopColor="#00e5ff" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#00e5ff" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {gridVals.map((v, i) => (
        <g key={i}>
          <line x1={PL} x2={W - PR} y1={y(v)} y2={y(v)} stroke="rgba(0,229,255,0.08)" strokeWidth="1" />
          <text x={PL - 6} y={y(v) + 3} textAnchor="end" fill="var(--text-4)" fontSize="10" fontFamily="Share Tech Mono, monospace">
            {fmt$(v)}
          </text>
        </g>
      ))}
      {min < 0 && <line x1={PL} x2={W - PR} y1={y0} y2={y0} stroke="rgba(255,70,85,0.35)" strokeWidth="1" strokeDasharray="4 3" />}
      <path d={area} fill="url(#jr-eq-fill)" />
      <path d={line} fill="none" stroke="#00e5ff" strokeWidth="1.8" style={{ filter: 'drop-shadow(0 0 6px rgba(0,229,255,0.45))' }} />
      <circle cx={x(points.length - 1)} cy={y(last.equity)} r="3.5" fill="#00e5ff" />
      <text x={x(points.length - 1) - 6} y={y(last.equity) - 8} textAnchor="end" fill="#00e5ff" fontSize="11" fontWeight="700" fontFamily="Share Tech Mono, monospace">
        {fmt$(last.equity)}
      </text>
      {[points[0], mid, last].map((p, i) => (
        <text key={i} x={x(i === 0 ? 0 : i === 1 ? Math.floor(points.length / 2) : points.length - 1)} y={H - 8}
          textAnchor={i === 0 ? 'start' : i === 1 ? 'middle' : 'end'} fill="var(--text-4)" fontSize="10" fontFamily="Share Tech Mono, monospace">
          {fmtDate(p.date)}
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
      <line x1={PL} x2={W - PR} y1={y0} y2={y0} stroke="rgba(0,229,255,0.18)" strokeWidth="1" />
      <text x={PL - 5} y={y0 - maxAbs * scale + 4} textAnchor="end" fill="var(--text-4)" fontSize="9" fontFamily="Share Tech Mono, monospace">{fmt$(maxAbs)}</text>
      <text x={PL - 5} y={y0 + 3} textAnchor="end" fill="var(--text-4)" fontSize="9" fontFamily="Share Tech Mono, monospace">$0</text>
      {rows.map((r, i) => {
        const h = Math.abs(r.netPnl) * scale
        const bx = PL + i * bw + bw * 0.18
        const by = r.netPnl >= 0 ? y0 - h : y0
        return (
          <g key={r.key}>
            <rect x={bx} y={by} width={bw * 0.64} height={Math.max(h, 1)}
              fill={r.netPnl >= 0 ? 'rgba(43,217,124,0.75)' : 'rgba(255,70,85,0.75)'} />
            <text x={bx + bw * 0.32} y={H - 8} textAnchor="middle" fill="var(--text-4)" fontSize="8.5" fontFamily="Share Tech Mono, monospace">
              {fmtMonth(r.key)}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

// ─── Edge Finder panel ────────────────────────────────────────────────────────

const INSIGHT_COLOR = { strength: '#2bd97c', weakness: '#ff4655', info: '#00e5ff' }

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
      <div style={{ overflow: 'auto', maxHeight: 240 }}>
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
                <td className="mono" style={{ textAlign: 'right', color: r.winRate >= 65 ? '#2bd97c' : r.winRate >= 50 ? '#ffb300' : '#ff4655' }}>
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

function OverviewTab({ closed, entries }: { closed: JournalPosition[]; entries: Record<string, JournalEntry> }) {
  const curve = useMemo(() => equityCurve(closed), [closed])
  return (
    <>
      <KpiStrip closed={closed} />

      <div className="cc-section">
        <div className="cc-section-title" style={{ padding: 0 }}>Equity Curve — Realized P&L</div>
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
        <BreakTable title="By Entry Weekday" keyHeader="Day"    rows={breakdown(closed, byWeekday)} />
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
            color: (value ?? 0) >= n ? '#00e5ff' : 'var(--text-5)',
            textShadow: (value ?? 0) >= n ? '0 0 6px rgba(0,229,255,0.6)' : 'none' }}>
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
                style={on ? { borderColor: '#ff4655', color: '#ff4655', background: 'rgba(255,70,85,0.10)' } : undefined}>
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

function JournalTab({ positions, entries, updateEntry, setups, addSetup }: {
  positions: JournalPosition[]
  entries: Record<string, JournalEntry>
  updateEntry: (id: string, patch: Partial<JournalEntry>) => void
  setups: string[]
  addSetup: (s: string) => void
}) {
  const [filter, setFilter] = useState<JFilter>('all')
  const [expanded, setExpanded] = useState<string | null>(null)

  const rows = useMemo(() => {
    const sorted = [...positions].sort((a, b) => (b.dateClosed ?? b.dateOpen).localeCompare(a.dateClosed ?? a.dateOpen))
    switch (filter) {
      case 'wins':       return sorted.filter(p => (p.pnl ?? 0) > 0 && p.status !== 'Active')
      case 'losses':     return sorted.filter(p => (p.pnl ?? 0) < 0 && p.status !== 'Active')
      case 'active':     return sorted.filter(p => p.status === 'Active')
      case 'unreviewed': return sorted.filter(p => p.status !== 'Active' && !isReviewed(entries[p.id]))
      default:           return sorted
    }
  }, [positions, filter, entries])

  const counts = useMemo(() => ({
    all: positions.length,
    wins: positions.filter(p => (p.pnl ?? 0) > 0 && p.status !== 'Active').length,
    losses: positions.filter(p => (p.pnl ?? 0) < 0 && p.status !== 'Active').length,
    active: positions.filter(p => p.status === 'Active').length,
    unreviewed: positions.filter(p => p.status !== 'Active' && !isReviewed(entries[p.id])).length,
  }), [positions, entries])

  const FILTERS: { id: JFilter; label: string }[] = [
    { id: 'all', label: `All (${counts.all})` },
    { id: 'wins', label: `Wins (${counts.wins})` },
    { id: 'losses', label: `Losses (${counts.losses})` },
    { id: 'active', label: `Active (${counts.active})` },
    { id: 'unreviewed', label: `Unreviewed (${counts.unreviewed})` },
  ]

  const COLS = 10

  return (
    <>
      <div className="tl-filter-row">
        {FILTERS.map(f => (
          <button key={f.id} className={`tl-filter-chip${filter === f.id ? ' active' : ''}`} onClick={() => setFilter(f.id)}>
            {f.label}
          </button>
        ))}
      </div>

      <div className="cc-section cc-table-section" style={{ flexShrink: 1 }}>
        <div style={{ overflow: 'auto' }}>
          <table className="trade-table" style={{ fontSize: 12 }}>
            <thead>
              <tr>
                <th>Closed</th>
                <th>Ticker</th>
                <th style={{ textAlign: 'center' }}>Strat</th>
                <th style={{ textAlign: 'right' }}>Position</th>
                <th style={{ textAlign: 'center' }}>Status</th>
                <th style={{ textAlign: 'right' }}>Hold</th>
                <th style={{ textAlign: 'right' }}>P&L</th>
                <th>Setup</th>
                <th style={{ textAlign: 'center' }}>Grade</th>
                <th style={{ textAlign: 'center' }}>⚠</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(p => {
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

function Row({ pos: p, entry: e, open, cols, onToggle, editor }: {
  pos: JournalPosition; entry: JournalEntry; open: boolean; cols: number
  onToggle: () => void; editor: React.ReactNode
}) {
  const statusColor = p.status === 'Active' ? '#2bd97c' : p.status === 'Closed' ? '#ffb300' : 'var(--text-4)'
  return (
    <>
      <tr onClick={onToggle} style={{ cursor: 'pointer', background: open ? 'rgba(0,229,255,0.05)' : undefined }}>
        <td className="mono" style={{ whiteSpace: 'nowrap', color: 'var(--text-3)' }}>
          {p.dateClosed ? fmtDate(p.dateClosed) : `opened ${fmtDate(p.dateOpen)}`}
        </td>
        <td className="mono" style={{ fontWeight: 700, color: 'var(--text-1)' }}>{p.underlying}</td>
        <td style={{ textAlign: 'center' }}><StratBadge strategy={p.strategy} /></td>
        <td className="mono" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
          {p.contracts}× {p.strikeDisplay}{p.putCall}
        </td>
        <td style={{ textAlign: 'center' }}>
          <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', letterSpacing: '0.06em',
            color: statusColor, border: `1px solid ${statusColor}40` }}>
            {p.status}
          </span>
        </td>
        <td className="mono" style={{ textAlign: 'right', color: 'var(--text-3)' }}>{p.holdDays != null ? `${p.holdDays}d` : '—'}</td>
        <td className={`mono ${p.pnl != null ? pnlCls(p.pnl) : ''}`} style={{ textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' }}>
          {p.pnl != null ? fmt$(p.pnl, 2) : '—'}
        </td>
        <td style={{ fontSize: 11, color: e.setup ? 'var(--text-2)' : 'var(--text-5)', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {e.setup ?? '—'}
        </td>
        <td className="mono" style={{ textAlign: 'center', color: e.rating ? '#00e5ff' : 'var(--text-5)' }}>
          {e.rating ? '◆'.repeat(e.rating) : '—'}
        </td>
        <td className="mono" style={{ textAlign: 'center', color: (e.mistakes?.length ?? 0) > 0 ? '#ff4655' : 'var(--text-5)' }}>
          {e.mistakes?.length || (e.note ? '✎' : '—')}
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={cols} style={{ padding: 0, background: 'rgba(0,229,255,0.03)' }}>
            {editor}
          </td>
        </tr>
      )}
    </>
  )
}

// ─── Psych Lab sub-view ───────────────────────────────────────────────────────

function arcPath(cx: number, cy: number, r: number, a0: number, a1: number) {
  const rad = (a: number) => (a * Math.PI) / 180
  const x0 = cx + r * Math.cos(rad(a0)), y0 = cy - r * Math.sin(rad(a0))
  const x1 = cx + r * Math.cos(rad(a1)), y1 = cy - r * Math.sin(rad(a1))
  return `M${x0.toFixed(1)},${y0.toFixed(1)} A${r},${r} 0 0 1 ${x1.toFixed(1)},${y1.toFixed(1)}`
}

function Tiltmeter({ score }: { score: number | null }) {
  const cx = 130, cy = 120, r = 95
  const angle = score != null ? 180 - score * 1.8 : 90
  const rad = (angle * Math.PI) / 180
  const zone = score == null ? 'var(--text-4)' : score >= 70 ? '#2bd97c' : score >= 40 ? '#ffb300' : '#ff4655'
  return (
    <svg viewBox="0 0 260 150" style={{ width: '100%', maxWidth: 320, display: 'block', margin: '0 auto' }}>
      <path d={arcPath(cx, cy, r, 180, 108)} fill="none" stroke="rgba(255,70,85,0.55)" strokeWidth="9" />
      <path d={arcPath(cx, cy, r, 108, 54)}  fill="none" stroke="rgba(255,179,0,0.55)" strokeWidth="9" />
      <path d={arcPath(cx, cy, r, 54, 0)}    fill="none" stroke="rgba(43,217,124,0.55)" strokeWidth="9" />
      {score != null && (
        <line x1={cx} y1={cy} x2={cx + (r - 16) * Math.cos(rad)} y2={cy - (r - 16) * Math.sin(rad)}
          stroke="#00e5ff" strokeWidth="2.5" style={{ filter: 'drop-shadow(0 0 5px rgba(0,229,255,0.7))' }} />
      )}
      <circle cx={cx} cy={cy} r="5" fill="#00e5ff" />
      <text x={cx} y={cy - 26} textAnchor="middle" fill={zone} fontSize="26" fontWeight="700" fontFamily="Rajdhani, sans-serif">
        {score != null ? score.toFixed(0) : '—'}
      </text>
      <text x={cx} y={cy + 22} textAnchor="middle" fill="var(--text-4)" fontSize="9" letterSpacing="2" fontFamily="Share Tech Mono, monospace">
        {score == null ? 'RATE TRADES TO CALIBRATE' : score >= 70 ? 'IN CONTROL' : score >= 40 ? 'DRIFTING' : 'ON TILT'}
      </text>
    </svg>
  )
}

function PsychTab({ closed, entries }: { closed: JournalPosition[]; entries: Record<string, JournalEntry> }) {
  // Tiltmeter score: last 10 reviewed trades — avg grade scaled 0-100, minus 9 per mistake
  const score = useMemo(() => {
    const reviewed = closed.filter(p => entries[p.id]?.rating).slice(-10)
    if (reviewed.length === 0) return null
    const avgRating = reviewed.reduce((s, p) => s + (entries[p.id].rating ?? 0), 0) / reviewed.length
    const mistakes = reviewed.reduce((s, p) => s + (entries[p.id].mistakes?.length ?? 0), 0)
    return Math.max(0, Math.min(100, ((avgRating - 1) / 4) * 100 - mistakes * 9))
  }, [closed, entries])

  const mistakeRows = useMemo(() => {
    const m = new Map<string, { n: number; pnl: number }>()
    for (const p of closed) {
      for (const tag of entries[p.id]?.mistakes ?? []) {
        const cur = m.get(tag) ?? { n: 0, pnl: 0 }
        cur.n += 1; cur.pnl += p.pnl ?? 0
        m.set(tag, cur)
      }
    }
    return Array.from(m.entries()).sort((a, b) => a[1].pnl - b[1].pnl)
  }, [closed, entries])

  const ratingDist = useMemo(() => {
    const dist = [0, 0, 0, 0, 0]
    for (const p of closed) {
      const r = entries[p.id]?.rating
      if (r) dist[r - 1] += 1
    }
    return dist
  }, [closed, entries])
  const maxDist = Math.max(...ratingDist, 1)

  const discipline = useMemo(() => {
    const rated = closed.filter(p => entries[p.id]?.rating)
    const hi = rated.filter(p => (entries[p.id].rating ?? 0) >= 4)
    const lo = rated.filter(p => (entries[p.id].rating ?? 0) <= 2)
    return {
      hi: hi.length ? hi.reduce((s, p) => s + (p.pnl ?? 0), 0) / hi.length : null,
      lo: lo.length ? lo.reduce((s, p) => s + (p.pnl ?? 0), 0) / lo.length : null,
      hiN: hi.length, loN: lo.length,
    }
  }, [closed, entries])

  return (
    <div className="jr-2col" style={{ alignItems: 'start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <div className="cc-section-title" style={{ padding: 0 }}>Tiltmeter — last 10 graded trades</div>
          <div className="panel" style={{ padding: '16px 12px 8px' }}>
            <Tiltmeter score={score} />
          </div>
        </div>
        <div>
          <div className="cc-section-title" style={{ padding: 0 }}>Discipline Edge</div>
          <div className="jr-2col" style={{ gap: 10 }}>
            <div className="stat-card" style={{ padding: '10px 14px' }}>
              <div className="stat-label">Avg P&L · Grade ≥4 ({discipline.hiN})</div>
              <div className="stat-value" style={{ fontSize: 19, color: discipline.hi != null ? pnlColor(discipline.hi) : 'var(--text-5)' }}>
                {discipline.hi != null ? fmt$(discipline.hi) : '—'}
              </div>
            </div>
            <div className="stat-card" style={{ padding: '10px 14px' }}>
              <div className="stat-label">Avg P&L · Grade ≤2 ({discipline.loN})</div>
              <div className="stat-value" style={{ fontSize: 19, color: discipline.lo != null ? pnlColor(discipline.lo) : 'var(--text-5)' }}>
                {discipline.lo != null ? fmt$(discipline.lo) : '—'}
              </div>
            </div>
          </div>
        </div>
        <div>
          <div className="cc-section-title" style={{ padding: 0 }}>Grade Distribution</div>
          <div className="panel" style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {[5, 4, 3, 2, 1].map(r => (
              <div key={r} style={{ display: 'grid', gridTemplateColumns: '70px 1fr 30px', alignItems: 'center', gap: 8 }}>
                <span className="mono" style={{ fontSize: 11, color: '#00e5ff' }}>{'◆'.repeat(r)}</span>
                <div style={{ height: 6, background: 'rgba(0,229,255,0.08)' }}>
                  <div style={{ height: '100%', width: `${(ratingDist[r - 1] / maxDist) * 100}%`, background: 'rgba(0,229,255,0.6)' }} />
                </div>
                <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)', textAlign: 'right' }}>{ratingDist[r - 1]}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div>
        <div className="cc-section-title" style={{ padding: 0 }}>What Your Mistakes Cost</div>
        <div className="panel" style={{ overflow: 'hidden' }}>
          {mistakeRows.length === 0 ? (
            <div className="db-empty-msg" style={{ minHeight: 120, padding: 20 }}>
              No mistakes tagged yet — review trades in the Journal tab
            </div>
          ) : (
            <table className="trade-table" style={{ fontSize: 11 }}>
              <thead>
                <tr>
                  <th>Mistake</th>
                  <th style={{ textAlign: 'right' }}>Count</th>
                  <th style={{ textAlign: 'right' }}>Total P&L</th>
                  <th style={{ textAlign: 'right' }}>Avg</th>
                </tr>
              </thead>
              <tbody>
                {mistakeRows.map(([tag, { n, pnl }]) => (
                  <tr key={tag}>
                    <td style={{ color: '#ff4655', fontWeight: 600 }}>{tag}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{n}</td>
                    <td className={`mono ${pnlCls(pnl)}`} style={{ textAlign: 'right', fontWeight: 700 }}>{fmt$(pnl)}</td>
                    <td className={`mono ${pnlCls(pnl / n)}`} style={{ textAlign: 'right' }}>{fmt$(pnl / n)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

type SubTab = 'overview' | 'journal' | 'psych'

const SUBTABS: { id: SubTab; label: string }[] = [
  { id: 'overview', label: 'OVERVIEW' },
  { id: 'journal',  label: 'TRADE JOURNAL' },
  { id: 'psych',    label: 'PSYCH LAB' },
]

export default function JournalView({ state, tradeLabels }: { state: AppState; tradeLabels?: TradeLabels }) {
  const [tab, setTab] = useState<SubTab>('overview')
  const { entries, updateEntry, setups, addSetup } = useJournalStore()

  const positions = useMemo(
    () => buildJournalPositions(state.sync.trades, tradeLabels?.labels ?? {}),
    [state.sync.trades, tradeLabels?.labels],
  )
  const closed = useMemo(() => closedByDate(positions), [positions])

  if (state.sync.trades.length === 0) {
    return (
      <div className="jr-root">
        <div className="db-empty-msg" style={{ flex: 1 }}>
          No trade data — sync IBKR Flex or upload an XML to start journaling
        </div>
      </div>
    )
  }

  return (
    <div className="jr-root">
      <div className="cc-header">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="cc-title-badge" style={{ color: '#00e5ff', background: '#00e5ff14', border: '1px solid #00e5ff33' }}>JRNL</span>
            <h2 className="cc-title">Trade Journal</h2>
          </div>
          <div className="cc-subtitle">Performance analytics · journaling · psychology — built on IBKR Flex data</div>
        </div>
        <div className="tl-filter-row">
          {SUBTABS.map(s => (
            <button key={s.id} className={`tl-filter-chip${tab === s.id ? ' active' : ''}`} onClick={() => setTab(s.id)}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'overview' && <OverviewTab closed={closed} entries={entries} />}
      {tab === 'journal'  && <JournalTab positions={positions} entries={entries} updateEntry={updateEntry} setups={setups} addSetup={addSetup} />}
      {tab === 'psych'    && <PsychTab closed={closed} entries={entries} />}
    </div>
  )
}
