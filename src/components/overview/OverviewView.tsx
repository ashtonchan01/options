/**
 * Overview tab — the account's landing page. Key summary stats (moved here
 * from Journal Overview), the Flex Web Service sync + statement upload
 * controls (moved here from Reports), and a metrics/charts strip: the old
 * Journal KPI row (win rate, profit factor, avg win/loss, max drawdown,
 * streak, etc.), an equity curve, a monthly realized-P&L bar chart, and the
 * current portfolio allocation pie.
 */
import { useMemo } from 'react'
import type { AppState } from '../../types'
import type { Account } from '../../store/accountsStore'
import { buildJournalPositions, buildStockPositions, closedByDate, computeStats, openPremiumTotal, equityCurve, type EquityPoint } from '../../engine/journal'
import { PortfolioSummaryCard } from '../analytics/AnalyticsView'
import { PortfolioPie, currentAllocationSlices, fmt$ as fmtAllocation } from '../allocation/PortfolioAllocationView'
import AccountUploadBar from '../shared/AccountUploadBar'
import FlexSyncBar from '../shared/FlexSyncBar'

function fmtDollar(n: number): string {
  const sign = n < 0 ? '-' : ''
  return `${sign}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}
function fmt(n: number): string {
  return Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

/** IBKR dates come as raw "YYYYMMDD" — plain string slicing is enough, no Date parsing needed. */
function monthKey(dateStr: string): string {
  const d = /^\d{8}$/.test(dateStr) ? dateStr : dateStr.replace(/-/g, '')
  return /^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}` : ''
}
function fmtMonthShort(ym: string) {
  const [y, m] = ym.split('-')
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${MONTHS[parseInt(m, 10) - 1] ?? m} ${y.slice(2)}`
}
function fmtMonthFull(ym: string) {
  const [y, m] = ym.split('-')
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  return `${MONTHS[parseInt(m, 10) - 1] ?? ym} ${y}`
}

// Every label on every chart on this page (Equity Curve, Monthly P&L) is
// plain HTML overlaid on top of a text-free SVG (axis lines/bars/area only),
// positioned by percentage. An SVG <text> node's font-size is just another
// viewBox unit, so it scales up or down with however wide or tall the panel
// happens to render — which is exactly why the same nominal font size read
// as "too big" in one panel and "too small" in another once the charts
// stopped being a fixed size. HTML text ignores the SVG's viewBox entirely,
// so one fixed CSS font size actually looks the same size everywhere,
// regardless of how big any chart's panel grows.
// Matches the KPI strip immediately above these charts (.label class is
// 10px, its bold value spans are fontSize 12.5) — chart text at any other
// size read as inconsistent with the metrics bar right next to it.
const AXIS_LABEL_SIZE = 10
const VALUE_LABEL_SIZE = 12.5

/** Realized P&L by close month, most recent 8 months — same bar-chart shape
 * as the old Monthly Cash Flow chart, but driven off actual closed-position
 * P&L (buildJournalPositions/buildStockPositions) rather than raw trade cash
 * flow, so it agrees with the Win Rate/Reports numbers next to it. */
function MonthlyPnlChart({ state }: { state: AppState }) {
  const closed = [
    ...buildJournalPositions(state.sync.trades, {}),
    ...buildStockPositions(state.sync.trades, {}),
  ].filter(p => p.status !== 'Active' && p.pnl != null && p.dateClosed)

  const byMonth = new Map<string, number>()
  for (const p of closed) {
    const key = monthKey(p.dateClosed!)
    if (!key) continue
    byMonth.set(key, (byMonth.get(key) ?? 0) + p.pnl!)
  }
  const rows = [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-8)
  if (rows.length === 0) return <div className="db-empty-msg" style={{ minHeight: 140 }}>No closed trades yet</div>

  const W = 100, H = 100, PL = 12, PR = 1, PT = 10, PB = 12
  const maxAbs = Math.max(...rows.map(([, v]) => Math.abs(v)), 1)
  const y0 = PT + (H - PT - PB) / 2
  const LABEL_ROOM = 9
  const halfHeight = (H - PT - PB) / 2 - LABEL_ROOM
  const scale = halfHeight / maxAbs
  const bw = (W - PL - PR) / rows.length
  const total = rows.reduce((s, [, v]) => s + v, 0)

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '0 4px 2px', fontFamily: 'Inter, sans-serif', flex: '0 0 auto' }}>
        <span style={{ fontSize: AXIS_LABEL_SIZE, color: 'var(--text-4)' }}>Last {rows.length} months</span>
        <span style={{ fontSize: VALUE_LABEL_SIZE, fontWeight: 700, color: total >= 0 ? '#10b981' : '#ef4444' }}>
          Net {total >= 0 ? '+' : ''}{fmtDollar(total)}
        </span>
      </div>
      <div style={{ position: 'relative', flex: '1 1 0', minHeight: 0 }}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: '100%', display: 'block' }}>
          <line x1={PL} x2={W - PR} y1={PT} y2={PT} stroke="var(--border-light)" strokeWidth="0.15" strokeDasharray="0.6,0.6" />
          <line x1={PL} x2={W - PR} y1={y0} y2={y0} stroke="var(--border-light)" strokeWidth="0.3" />
          <line x1={PL} x2={W - PR} y1={H - PB} y2={H - PB} stroke="var(--border-light)" strokeWidth="0.15" strokeDasharray="0.6,0.6" />
          {rows.map(([key, val], i) => {
            const h = Math.abs(val) * scale
            const bx = PL + i * bw + bw * 0.2
            const by = val >= 0 ? y0 - h : y0
            return (
              <rect key={key} x={bx} y={by} width={bw * 0.6} height={Math.max(h, 0.3)} rx={0.3}
                fill={val >= 0 ? '#10b981' : '#ef4444'} opacity={0.85} vectorEffect="non-scaling-stroke">
                <title>{fmtMonthFull(key)}: {val >= 0 ? '+' : ''}{fmtDollar(val)}</title>
              </rect>
            )
          })}
        </svg>
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', fontFamily: 'Inter, sans-serif' }}>
          <span style={{ position: 'absolute', left: 2, top: `${(PT / H) * 100}%`, transform: 'translateY(-50%)', fontSize: AXIS_LABEL_SIZE, color: 'var(--text-4)' }}>{fmtDollar(maxAbs)}</span>
          <span style={{ position: 'absolute', left: 2, top: `${(y0 / H) * 100}%`, transform: 'translateY(-50%)', fontSize: AXIS_LABEL_SIZE, color: 'var(--text-4)' }}>$0</span>
          <span style={{ position: 'absolute', left: 2, top: `${((H - PB) / H) * 100}%`, transform: 'translateY(-50%)', fontSize: AXIS_LABEL_SIZE, color: 'var(--text-4)' }}>-{fmtDollar(maxAbs)}</span>
          {rows.map(([key, val], i) => {
            const h = Math.abs(val) * scale
            const bx = PL + i * bw + bw * 0.2
            const by = val >= 0 ? y0 - h : y0
            const labelTop = val >= 0 ? by - 2.5 : by + h + 2.5
            return (
              <span key={key} style={{
                position: 'absolute',
                left: `${((bx + bw * 0.3) / W) * 100}%`, top: `${(labelTop / H) * 100}%`,
                transform: `translate(-50%, ${val >= 0 ? '-100%' : '0%'})`,
                fontSize: VALUE_LABEL_SIZE, fontWeight: 600, color: val >= 0 ? '#10b981' : '#ef4444', whiteSpace: 'nowrap',
              }}>
                {val >= 0 ? '+' : '-'}{fmt(Math.abs(val))}
              </span>
            )
          })}
          {rows.map(([key], i) => {
            const bx = PL + i * bw + bw * 0.2
            return (
              <span key={key} style={{
                position: 'absolute', left: `${((bx + bw * 0.3) / W) * 100}%`, top: `${((H - PB + 3) / H) * 100}%`,
                transform: 'translate(-50%, 0)', fontSize: AXIS_LABEL_SIZE, color: 'var(--text-4)', whiteSpace: 'nowrap',
              }}>
                {fmtMonthShort(key)}
              </span>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function pnlColor(n: number) { return n > 0 ? '#10b981' : n < 0 ? '#ef4444' : 'var(--text-4)' }

/** The old Journal Overview KPI row — Net P&L, Win Rate, Profit Factor, Avg
 * Win/Loss, Max Drawdown, Open Premium, Closed trade count, and current
 * Streak — restored here since it moved off the Journal tab. */
function KpiStrip({ state }: { state: AppState }) {
  const positions = useMemo(() => [
    ...buildJournalPositions(state.sync.trades, {}),
    ...buildStockPositions(state.sync.trades, {}),
  ], [state.sync.trades])
  const closed = useMemo(() => closedByDate(positions), [positions])
  const s = useMemo(() => computeStats(closed), [closed])
  const openPremium = useMemo(() => openPremiumTotal(positions), [positions])
  const pf = s.profitFactor === Infinity ? '∞' : s.profitFactor.toFixed(2)

  const stats = [
    { label: 'Net P&L',       value: fmtDollar(s.netPnl),       color: pnlColor(s.netPnl) },
    { label: 'Win Rate',      value: s.trades ? `${s.winRate.toFixed(0)}%` : '—',
      color: s.winRate >= 65 ? '#10b981' : s.winRate >= 50 ? '#f59e0b' : '#ef4444' },
    { label: 'Profit Factor', value: s.trades ? pf : '—', color: s.profitFactor >= 1.5 ? '#10b981' : s.profitFactor >= 1 ? '#f59e0b' : '#ef4444' },
    { label: 'Avg Win',       value: fmtDollar(s.avgWin),       color: '#10b981' },
    { label: 'Avg Loss',      value: fmtDollar(s.avgLoss),      color: '#ef4444' },
    { label: 'Max DD',        value: fmtDollar(-s.maxDrawdown), color: '#f59e0b' },
    { label: 'Open Premium',  value: fmtDollar(openPremium),    color: 'var(--text-1)' },
    { label: 'Closed',        value: String(s.trades),          color: 'var(--text-1)' },
    { label: 'Streak',        value: s.currentStreak === 0 ? '—' : `${s.currentStreak > 0 ? 'W' : 'L'}${Math.abs(s.currentStreak)}`, color: 'var(--text-1)' },
  ]

  return (
    <div className="jr-mini-strip">
      {stats.map(c => (
        <div key={c.label} className="jr-mini">
          <span className="label">{c.label}</span>
          <b style={{ fontSize: 12.5, color: c.color }}>{c.value}</b>
        </div>
      ))}
    </div>
  )
}

function fmtDateShort(s: string) {
  const iso = /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : s
  const d = new Date(iso)
  return isNaN(d.getTime()) ? s : d.toLocaleDateString('en-AU', { month: 'short', year: '2-digit' })
}

/** Cumulative realized P&L across every closed position, oldest to newest. */
function EquityChart({ points }: { points: EquityPoint[] }) {
  if (points.length < 2) {
    return <div className="db-empty-msg" style={{ minHeight: 140 }}>Need at least 2 closed trades to draw the curve</div>
  }
  const W = 100, H = 100, PL = 8, PR = 1.5, PT = 8, PB = 12
  const min = Math.min(0, ...points.map(p => p.equity))
  const max = Math.max(1, ...points.map(p => p.equity))
  const x = (i: number) => PL + (i / (points.length - 1)) * (W - PL - PR)
  const y = (v: number) => PT + (1 - (v - min) / (max - min)) * (H - PT - PB)
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(2)},${y(p.equity).toFixed(2)}`).join(' ')
  const y0 = y(0)
  const area = `${line} L${x(points.length - 1).toFixed(2)},${y0.toFixed(2)} L${x(0).toFixed(2)},${y0.toFixed(2)} Z`
  const gridVals = [0, 0.25, 0.5, 0.75, 1].map(f => min + f * (max - min))
  const last = points[points.length - 1]
  const mid = points[Math.floor(points.length / 2)]

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: '100%', display: 'block' }}>
        <defs>
          <linearGradient id="ov-eq-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#10b981" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#10b981" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {gridVals.map((v, i) => (
          <line key={i} x1={PL} x2={W - PR} y1={y(v)} y2={y(v)} stroke="rgba(16,185,129,0.08)" strokeWidth="0.15" vectorEffect="non-scaling-stroke" />
        ))}
        {min < 0 && <line x1={PL} x2={W - PR} y1={y0} y2={y0} stroke="rgba(239,68,68,0.35)" strokeWidth="0.15" strokeDasharray="1.2 0.9" vectorEffect="non-scaling-stroke" />}
        <path d={area} fill="url(#ov-eq-fill)" />
        <path d={line} fill="none" stroke="#10b981" strokeWidth="0.5" vectorEffect="non-scaling-stroke" style={{ filter: 'drop-shadow(0 0 6px rgba(16,185,129,0.45))' }} />
        <circle cx={x(points.length - 1)} cy={y(last.equity)} r="1" fill="#10b981" vectorEffect="non-scaling-stroke" />
      </svg>
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', fontFamily: 'Inter, sans-serif' }}>
        {gridVals.map((v, i) => (
          <span key={i} style={{ position: 'absolute', left: 2, top: `${(y(v) / H) * 100}%`, transform: 'translateY(-50%)', fontSize: AXIS_LABEL_SIZE, color: 'var(--text-4)' }}>
            {fmtDollar(v)}
          </span>
        ))}
        {/* Pinned to a fixed corner instead of tracking the curve's actual
            last point — anchoring it at the point itself clipped off-panel
            whenever the series ended near the very top or right edge. */}
        <span style={{ position: 'absolute', top: 2, right: 4, fontSize: VALUE_LABEL_SIZE, fontWeight: 700, color: '#10b981' }}>
          {fmtDollar(last.equity)}
        </span>
        {/* Dedupe by index — with few points (e.g. only 2-3 closed trades) the
            "middle" and/or first/last indices can coincide, which used to
            render the same date label twice on top of itself at the same x
            position. */}
        {[...new Map([
          [0, points[0]],
          [Math.floor(points.length / 2), mid],
          [points.length - 1, last],
        ]).entries()].map(([idx, p]) => (
          <span key={idx} style={{
            position: 'absolute', top: `${((H - PB + 3) / H) * 100}%`,
            left: idx === points.length - 1 ? undefined : `${(x(idx) / W) * 100}%`,
            right: idx === points.length - 1 ? `${PR}%` : undefined,
            transform: idx === 0 ? 'translate(0, 0)' : idx === points.length - 1 ? undefined : 'translate(-50%, 0)',
            fontSize: AXIS_LABEL_SIZE, color: 'var(--text-4)', whiteSpace: 'nowrap',
          }}>
            {fmtDateShort(p.date)}
          </span>
        ))}
      </div>
    </div>
  )
}

export default function OverviewView({ state, account, loading, error, onUpload, onClear, onSyncFlex }: {
  state: AppState
  account: Account
  loading: boolean
  error: string | null
  onUpload: (file: File) => void | Promise<void>
  onClear: () => void
  onSyncFlex: (token: string, queryId: string) => void
}) {
  const hasData = state.sync.trades.length > 0

  return (
    <div className="jr-root" style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, alignItems: 'stretch', flex: '0 0 auto' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <FlexSyncBar
            savedToken={account.flexToken}
            savedQueryId={account.flexQueryId}
            loading={loading}
            error={error}
            onSync={onSyncFlex}
          />
          <AccountUploadBar
            label={account.name}
            fileName={account.fileName}
            uploadedAt={account.uploadedAt}
            loading={loading}
            error={error}
            onUpload={onUpload}
            onClear={onClear}
          />
        </div>
        {hasData && <PortfolioSummaryCard state={state} />}
      </div>

      {!hasData ? (
        <div className="db-empty-msg" style={{ flex: 1 }}>
          No trade data — sync IBKR Flex or upload a statement to get started
        </div>
      ) : (
        <>
          <div style={{ flex: '0 0 auto' }}><KpiStrip state={state} /></div>
          {/* minHeight (not 0) on these three panels — without a real floor,
              flex-shrink happily squashes them down to nothing to keep
              everything inside the container's fixed height, instead of the
              container actually overflowing and letting .jr-root's
              overflow-y:auto do its job. Expanding the Flex setup
              instructions above adds real height that these panels have no
              business absorbing, so they now hold their size and the page
              scrolls for it instead. No maxHeight — both charts' labels are
              now fixed-size HTML overlaid on a text-free SVG (see
              AXIS_LABEL_SIZE/VALUE_LABEL_SIZE above), not SVG <text> that
              scales with the viewBox, so letting these panels grow to fill
              whatever vertical space the window actually has no longer
              inflates the text along with them. */}
          <div className="dash-panel" style={{ flex: '1.3 1 0', minHeight: 260 }}>
            <div className="dash-panel-header" style={{ flex: '0 0 auto' }}><span>Equity Curve</span></div>
            <div style={{ flex: '1 1 0', minHeight: 0, display: 'flex', alignItems: 'stretch' }}>
              <EquityChart points={equityCurve(closedByDate([
                ...buildJournalPositions(state.sync.trades, {}),
                ...buildStockPositions(state.sync.trades, {}),
              ]))} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.3fr', gap: 10, flex: '1 1 0', minHeight: 260 }}>
            <div className="dash-panel" style={{ minHeight: 0 }}>
              <div className="dash-panel-header" style={{ flex: '0 0 auto' }}><span>Monthly Realised P&amp;L</span></div>
              <div style={{ flex: '1 1 0', minHeight: 0, display: 'flex', alignItems: 'stretch' }}>
                <MonthlyPnlChart state={state} />
              </div>
            </div>
            <div className="dash-panel" style={{ minHeight: 0, overflow: 'hidden' }}>
              <div className="dash-panel-header" style={{ flex: '0 0 auto' }}><span>Allocation by Position</span></div>
              {/* PortfolioPie draws its outside labels with overflow:visible
                  (by design, for the Allocation tab's much wider column) —
                  in this narrower cell that spilled the pie and its labels
                  past the card's own edge instead of shrinking to fit.
                  Clipping here + capping the pie's own width keeps it inside
                  its cell. */}
              <div style={{ flex: '1 1 0', minHeight: 0, width: '100%', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ width: '100%', maxWidth: 380 }}>
                  {(() => {
                    const { slices, total } = currentAllocationSlices(state)
                    return <PortfolioPie slices={slices} centerLabel="Current" centerValue={fmtAllocation(total)} labelMode="pct" />
                  })()}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
