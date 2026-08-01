import type { AppState, Action, UrgencyLevel, StrategyType, RawTrade } from '../../types'
import type { TradeLabels } from '../../App'
import { tradeId } from '../../store/tradeLabelsStore'

interface Props { state: AppState; tradeLabels?: TradeLabels }

// ─── Urgency config ───────────────────────────────────────────────────────────

const URGENCY_CONFIG: Record<UrgencyLevel, { label: string; color: string; bg: string }> = {
  urgent:      { label: 'URGENT',      color: '#f43f5e', bg: '#f43f5e14' },
  manage:      { label: 'MANAGE',      color: '#f59e0b', bg: '#f59e0b14' },
  opportunity: { label: 'OPPORTUNITY', color: '#10b981', bg: '#10b98114' },
  watch:       { label: 'WATCH',       color: '#818997', bg: '#5D658014' },
}

const URGENCY_ORDER: UrgencyLevel[] = ['urgent', 'manage', 'opportunity', 'watch']

const ACTION_LABEL: Record<Action['actionType'], string> = {
  close:  'CLOSE',
  roll:   'ROLL',
  open:   'OPEN',
  manage: 'REVIEW',
}

const ACTION_COLOR: Record<Action['actionType'], string> = {
  close:  '#f43f5e',
  roll:   '#f59e0b',
  open:   '#10b981',
  manage: '#38bdf8',
}

const STRAT_LABEL: Record<StrategyType, string> = {
  csp:           'CSP',
  covered_call:  'CC',
  pmcc:          'PMCC',
  risk_reversal: 'RR',
  put_spread:    'PUT SPD',
  call_spread:   'CALL SPD',
  leap:          'LEAP',
  other:         'OTHER',
}

const STRAT_COLOR: Record<StrategyType, string> = {
  csp:           '#f43f5e',
  covered_call:  '#3b82f6',
  pmcc:          '#3b82f6',
  risk_reversal: '#38bdf8',
  put_spread:    '#fbbf24',
  call_spread:   '#fb923c',
  leap:          '#10b981',
  other:         '#64748b',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number, digits = 0): string {
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (abs >= 1_000)     return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

function fmtDollar(n: number): string {
  const sign = n < 0 ? '-' : ''
  return `${sign}$${fmt(Math.abs(n))}`
}



// ─── Actions Sidebar ──────────────────────────────────────────────────────────

function ActionsSidebar({ state }: { state: AppState }) {
  const { actions } = state

  const byUrgency = URGENCY_ORDER.reduce<Record<UrgencyLevel, Action[]>>((acc, u) => {
    acc[u] = actions.filter(a => a.urgency === u)
    return acc
  }, {} as Record<UrgencyLevel, Action[]>)

  return (
    <aside className="db-sidebar">
      <div className="db-sidebar-header" style={{ flexWrap: 'wrap', rowGap: 6, paddingBottom: actions.length > 0 ? 10 : 12 }}>
        <span>Actions &amp; To-Do</span>
        <div style={{ display: 'flex', gap: 5, marginLeft: 'auto' }}>
          {URGENCY_ORDER.map(u => {
            const n = byUrgency[u].length
            if (n === 0) return null
            const cfg = URGENCY_CONFIG[u]
            return (
              <span key={u} title={cfg.label} style={{
                display: 'inline-flex', alignItems: 'center', gap: 3,
                fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                color: cfg.color, background: cfg.bg, border: `1px solid ${cfg.color}33`,
                fontFamily: 'Inter, sans-serif',
              }}>
                {n}
              </span>
            )
          })}
        </div>
      </div>

      <div className="db-sidebar-body">
        {actions.length === 0 && (
          <div className="db-empty-msg" style={{ padding: '20px 12px' }}>
            No actions — all positions within normal parameters.
          </div>
        )}

        <div className="db-actions-grid">
          {URGENCY_ORDER.map(u => {
            const cfg   = URGENCY_CONFIG[u]
            const items = byUrgency[u]
            if (items.length === 0) return null
            return (
              <div key={u} className="db-urgency-group">
                <div className="db-urgency-label" style={{ color: cfg.color, borderBottom: `1px solid ${cfg.color}33` }}>
                  {cfg.label}
                  <span style={{ background: cfg.bg, border: `1px solid ${cfg.color}33`, padding: '0 5px', fontSize: 10, marginLeft: 6, borderRadius: 3 }}>
                    {items.length}
                  </span>
                </div>
                <div className="db-action-card-list">
                  {items.map(a => {
                    const aColor = ACTION_COLOR[a.actionType]
                    const sColor = STRAT_COLOR[a.strategyType]
                    return (
                      <div key={a.id} className="db-action-card" style={{ borderLeft: `3px solid ${cfg.color}`, background: `linear-gradient(90deg, ${cfg.color}09, var(--bg-card) 14%)` }}>
                        {/* Ticker + action badge + strategy */}
                        <div style={{ display: 'flex', gap: 6, marginBottom: 5, flexWrap: 'wrap', alignItems: 'center' }}>
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 9, fontWeight: 800, width: 20, height: 20, borderRadius: 5,
                            color: aColor, background: `${aColor}1c`, border: `1px solid ${aColor}40`, flexShrink: 0,
                          }}>
                            {a.actionType === 'close' ? '×' : a.actionType === 'roll' ? '↻' : a.actionType === 'open' ? '+' : '◎'}
                          </span>
                          <span style={{ fontSize: 13, fontWeight: 700, fontFamily: 'Inter, sans-serif', color: 'var(--text-1)' }}>
                            {a.underlying}
                          </span>
                          <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 5px', color: sColor, background: `${sColor}14`, border: `1px solid ${sColor}30`, borderRadius: 3 }}>
                            {STRAT_LABEL[a.strategyType]}
                          </span>
                          <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 5px', color: aColor, background: `${aColor}14`, border: `1px solid ${aColor}30`, borderRadius: 3, marginLeft: 'auto' }}>
                            {ACTION_LABEL[a.actionType]}
                          </span>
                        </div>
                        {/* Position identifier — which exact position */}
                        {a.legSummary && (
                          <div style={{
                            fontSize: 11, fontFamily: 'Inter, sans-serif', fontWeight: 600,
                            color: cfg.color, background: `${cfg.color}10`,
                            border: `1px solid ${cfg.color}28`, borderRadius: 4,
                            padding: '2px 6px', marginBottom: 5, display: 'inline-block',
                          }}>
                            {a.legSummary}
                          </div>
                        )}
                        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-1)', lineHeight: 1.4, marginBottom: 2 }}>
                          {a.reason}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.4 }}>
                          {a.details}
                        </div>
                        {/* Suggested params */}
                        {(a.suggestedStrike || a.suggestedExpiry || a.suggestedDelta || a.estimatedCredit != null) && (
                          <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap', paddingTop: 6, borderTop: '1px solid var(--border)' }}>
                            {a.suggestedStrike && (
                              <span style={{ fontSize: 10, fontFamily: 'Inter, sans-serif', color: 'var(--text-4)' }}>
                                strike <span style={{ color: 'var(--text-2)', fontWeight: 700 }}>${a.suggestedStrike}</span>
                              </span>
                            )}
                            {a.suggestedDelta && (
                              <span style={{ fontSize: 10, fontFamily: 'Inter, sans-serif', color: 'var(--text-4)' }}>
                                δ <span style={{ color: 'var(--text-2)', fontWeight: 700 }}>{a.suggestedDelta.toFixed(2)}</span>
                              </span>
                            )}
                            {a.suggestedExpiry && (
                              <span style={{ fontSize: 10, fontFamily: 'Inter, sans-serif', color: 'var(--text-4)' }}>
                                exp <span style={{ color: 'var(--text-2)', fontWeight: 700 }}>{a.suggestedExpiry}</span>
                              </span>
                            )}
                            {a.estimatedCredit != null && (
                              <span style={{ fontSize: 10, fontFamily: 'Inter, sans-serif', color: '#10b981', fontWeight: 700, marginLeft: 'auto' }}>
                                est. ${a.estimatedCredit.toFixed(2)}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </aside>
  )
}

// ─── Analytics: structure donut + monthly flow bars (exceltable-style) ────────

function parseTradeDate(s: string): Date | null {
  if (!s) return null
  const norm = /^\d{8}$/.test(s) ? `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}` : s
  const d = new Date(norm)
  return isNaN(d.getTime()) ? null : d
}
function monthKey(s: string): string | null {
  const d = parseTradeDate(s)
  if (!d) return null
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
function fmtMonthShort(ym: string) {
  const [, m] = ym.split('-')
  const MONTHS = ['J','F','M','A','M','J','J','A','S','O','N','D']
  return MONTHS[parseInt(m, 10) - 1] ?? ym
}

interface DonutSlice { label: string; value: number; color: string }

const PIE_W = 820, PIE_H = 520
const PIE_CX = 410, PIE_CY = 260, PIE_R = 150
const LABEL_COL_LEFT = 170, LABEL_COL_RIGHT = 650

function polar(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
}

/** Full pie (no donut hole) with external leader-line labels fanned left/right, like a
 * classic "exploded label" pie chart — each slice's name + % sits outside the circle,
 * connected back to its wedge by a line, instead of a swatch legend off to the side. */
function StructureDonut({ slices, centerLabel, centerValue }: { slices: DonutSlice[]; centerLabel: string; centerValue: string }) {
  const total = slices.reduce((s, x) => s + x.value, 0)
  if (total <= 0) return <div className="db-empty-msg" style={{ minHeight: 140 }}>No allocation data</div>

  let angle = 0
  const wedges = slices.filter(s => s.value > 0).map(s => {
    const frac = s.value / total
    const startAngle = angle
    const endAngle = angle + frac * 360
    angle = endAngle
    const midAngle = (startAngle + endAngle) / 2
    return { ...s, frac, startAngle, endAngle, midAngle }
  })

  // Path for each wedge (pie slice, not stroked arc)
  function wedgePath(startAngle: number, endAngle: number) {
    const p0 = polar(PIE_CX, PIE_CY, PIE_R, startAngle)
    const p1 = polar(PIE_CX, PIE_CY, PIE_R, endAngle)
    const largeArc = endAngle - startAngle > 180 ? 1 : 0
    return `M${PIE_CX},${PIE_CY} L${p0.x},${p0.y} A${PIE_R},${PIE_R} 0 ${largeArc} 1 ${p1.x},${p1.y} Z`
  }

  // Fan labels left/right of the pie, stacked top-to-bottom (by actual vertical position on
  // the circle, so leader lines don't cross), spread across the chart's full height so a
  // handful of slices don't bunch up near the vertical center.
  const edgeY = (w: (typeof wedges)[number]) => polar(PIE_CX, PIE_CY, PIE_R, w.midAngle).y
  const bySide = (cond: (w: (typeof wedges)[number]) => boolean) =>
    wedges.filter(cond).sort((a, b) => edgeY(a) - edgeY(b))
  const left = bySide(w => Math.cos(((w.midAngle - 90) * Math.PI) / 180) < 0)
  const right = bySide(w => Math.cos(((w.midAngle - 90) * Math.PI) / 180) >= 0)
  const MARGIN = 24
  const stackY = (group: typeof wedges) => {
    const slot = (PIE_H - 2 * MARGIN) / Math.max(group.length, 1)
    return new Map(group.map((w, i) => [w, MARGIN + slot * (i + 0.5)]))
  }
  const leftY = stackY(left)
  const rightY = stackY(right)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div>
        <span style={{ fontSize: 9, color: 'var(--text-4)', letterSpacing: '1px', textTransform: 'uppercase' }}>{centerLabel}</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)', fontFamily: 'Inter, sans-serif', marginLeft: 8 }}>{centerValue}</span>
      </div>
      <svg viewBox={`0 0 ${PIE_W} ${PIE_H}`} style={{ width: '100%', height: 'auto', maxWidth: PIE_W }}>
        {wedges.map((w, i) => (
          <path key={i} d={wedgePath(w.startAngle, w.endAngle)} fill={w.color} stroke="var(--bg-card)" strokeWidth={1.5} />
        ))}
        {wedges.map((w, i) => {
          const onLeft = leftY.has(w)
          const labelY = (onLeft ? leftY.get(w) : rightY.get(w))!
          const colX = onLeft ? LABEL_COL_LEFT : LABEL_COL_RIGHT
          const edge = polar(PIE_CX, PIE_CY, PIE_R, w.midAngle)
          const dotX = onLeft ? colX - 4 : colX + 4
          // Color swatch sits between the leader line and the text, so each label is
          // unambiguously color-coded back to its wedge without following the line.
          const SW = 8
          const swatchX = onLeft ? colX - SW - 2 : colX + 2
          const textX = onLeft ? swatchX - 4 : swatchX + SW + 4
          return (
            <g key={`label-${i}`}>
              <line x1={edge.x} y1={edge.y} x2={dotX} y2={labelY} stroke="var(--text-4)" strokeWidth={0.75} opacity={0.6} />
              <circle cx={edge.x} cy={edge.y} r={2} fill={w.color} />
              <rect x={swatchX} y={labelY - SW + 1} width={SW} height={SW} rx={2} fill={w.color} />
              <text x={textX} y={labelY - 3} textAnchor={onLeft ? 'end' : 'start'}
                fontSize={11} fontWeight={700} fontFamily="Inter, sans-serif" fill="var(--text-2)">
                {w.label}
              </text>
              <text x={textX} y={labelY + 10} textAnchor={onLeft ? 'end' : 'start'}
                fontSize={10} fontFamily="Inter, sans-serif" fill="var(--text-4)">
                {(w.frac * 100).toFixed(1)}%
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function MonthlyFlowBars({ trades }: { trades: RawTrade[] }) {
  const byMonth = new Map<string, number>()
  for (const t of trades) {
    const key = monthKey(t.tradeDate)
    if (!key) continue
    byMonth.set(key, (byMonth.get(key) ?? 0) + t.netCash)
  }
  const rows = [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-8)
  if (rows.length === 0) return <div className="db-empty-msg" style={{ minHeight: 140 }}>No trade history yet</div>

  const W = 380, H = 150, PL = 42, PR = 8, PT = 10, PB = 20
  const maxAbs = Math.max(...rows.map(([, v]) => Math.abs(v)), 1)
  const y0 = PT + (H - PT - PB) / 2
  const scale = (H - PT - PB) / 2 / maxAbs
  const bw = (W - PL - PR) / rows.length

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block' }}>
      <line x1={PL} x2={W - PR} y1={y0} y2={y0} stroke="var(--border-light)" strokeWidth="1" />
      <text x={PL - 6} y={PT + 8} textAnchor="end" fill="var(--text-4)" fontSize="9" fontFamily="Inter, sans-serif">{fmtDollar(maxAbs)}</text>
      <text x={PL - 6} y={y0 + 3} textAnchor="end" fill="var(--text-4)" fontSize="9" fontFamily="Inter, sans-serif">$0</text>
      {rows.map(([key, val], i) => {
        const h = Math.abs(val) * scale
        const bx = PL + i * bw + bw * 0.2
        const by = val >= 0 ? y0 - h : y0
        return (
          <g key={key}>
            <rect x={bx} y={by} width={bw * 0.6} height={Math.max(h, 1)} rx={2}
              fill={val >= 0 ? '#10b981' : '#ef4444'} opacity={0.85} />
            <text x={bx + bw * 0.3} y={H - 6} textAnchor="middle" fill="var(--text-4)" fontSize="9" fontFamily="Inter, sans-serif">
              {fmtMonthShort(key)}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

// ─── Actual Portfolio View ────────────────────────────────────────────────────

// ─── Income channel strip ─────────────────────────────────────────────────────

const INCOME_CHANNELS: Array<{ page: string; label: string; color: string }> = [
  { page: 'covered_calls', label: 'Covered Calls', color: '#3b82f6' },
  { page: 'csp',           label: 'CSP',           color: '#f43f5e' },
  { page: 'spx',           label: 'SPX',           color: '#8b5cf6' },
  { page: 'leap',          label: 'LEAP',          color: '#10b981' },
  { page: 'ptos',          label: 'PTOS',          color: '#06b6d4' },
  { page: 'lilo',          label: 'LILO',          color: '#f97316' },
  { page: 'arb_cloud',     label: 'ARB Cloud',     color: '#a78bfa' },
  { page: 'tabi',          label: 'TABI',          color: '#34d399' },
  { page: 'rotation',      label: 'Rotation',      color: '#f59e0b' },
  { page: 'dcas',          label: 'DCAS',          color: '#ec4899' },
  { page: 'profit_taking', label: 'Profit Taking', color: '#84cc16' },
  { page: 'other',         label: 'Other',         color: '#64748b' },
]

// Auto-classifier strategy type → income channel page, used as a fallback
// when the user hasn't manually labelled any trades yet.
const AUTO_STRAT_TO_CHANNEL: Record<string, string> = {
  covered_call:  'covered_calls',
  pmcc:          'covered_calls',
  csp:           'csp',
  leap:          'leap',
  risk_reversal: 'other',
  put_spread:    'other',
  call_spread:   'other',
  other:         'other',
}

const TODAY_DASH = new Date(); TODAY_DASH.setHours(0,0,0,0)

function parseExpiryDash(s: string): Date | null {
  if (!s) return null
  if (/^\d{8}$/.test(s)) s = `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d
}

function isExpiredDash(t: RawTrade): boolean {
  if (!t.expiry) return false
  const d = parseExpiryDash(t.expiry)
  return d !== null && d < TODAY_DASH
}

function IncomeChannelStrip({ trades, labels, symbolToStratType }: { trades: RawTrade[]; labels: Record<string, string>; symbolToStratType: Map<string, string> }) {
  const hasLabels = Object.keys(labels).length > 0

  // Fallback: when nothing has been manually labelled yet, derive channel
  // membership from the auto strategy classifier + the SPX/SPXW rule, so the
  // strip still shows something useful instead of disappearing entirely.
  const effectiveLabels: Record<string, string> = hasLabels ? labels : (() => {
    const auto: Record<string, string> = {}
    for (const t of trades) {
      const sym = t.symbol ?? ''
      if (/^SPXW?/.test(t.underlyingSymbol ?? sym)) {
        auto[tradeId(t)] = 'spx'
        continue
      }
      const stratType = symbolToStratType.get(sym)
      auto[tradeId(t)] = stratType ? (AUTO_STRAT_TO_CHANNEL[stratType] ?? 'other') : 'other'
    }
    return auto
  })()

  return (
    <div style={{ flexShrink: 0 }}>
      {!hasLabels && (
        <div style={{ padding: '4px 12px', fontSize: 10, color: 'var(--text-4)', background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border)' }}>
          Auto-classified (no manual labels yet) — label trades for more accurate grouping
        </div>
      )}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
        gap: 1,
        borderBottom: '1px solid var(--border)',
        background: 'var(--border)',
      }}>
      {INCOME_CHANNELS.map(ch => {
        const chTrades = trades.filter(t => effectiveLabels[tradeId(t)] === ch.page)
        if (chTrades.length === 0) return null

        const sells   = chTrades.filter(t => t.quantity < 0)
        const expired = chTrades.filter(t => isExpiredDash(t))
        const active  = chTrades.filter(t => !isExpiredDash(t))

        const openPrem  = active.filter(t => t.quantity < 0).reduce((s, t) => s + t.netCash, 0)
        const realizedPnL = expired.reduce((s, t) => s + t.netCash, 0)
        // Also add closed-out positions (buy-side on expired groups won't be here, but include any explicit closes)
        const totalPnL  = chTrades.reduce((s, t) => s + t.netCash, 0)
        const winRate   = sells.length ? (sells.filter(t => t.netCash > 0).length / sells.length) * 100 : 0

        return (
          <div key={ch.page} style={{
            background: 'var(--bg-surface)',
            padding: '10px 14px',
            borderLeft: `3px solid ${ch.color}`,
          }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: ch.color, textTransform: 'uppercase', marginBottom: 6 }}>
              {ch.label}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span style={{ fontSize: 10, color: 'var(--text-4)' }}>Open</span>
                <span style={{ fontSize: 12, fontFamily: 'Inter, sans-serif', fontWeight: 600, color: openPrem >= 0 ? '#10b981' : '#f43f5e' }}>
                  {fmtDollar(openPrem)}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span style={{ fontSize: 10, color: 'var(--text-4)' }}>Realized</span>
                <span style={{ fontSize: 12, fontFamily: 'Inter, sans-serif', fontWeight: 600, color: realizedPnL >= 0 ? '#10b981' : '#f43f5e' }}>
                  {fmtDollar(realizedPnL)}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span style={{ fontSize: 10, color: 'var(--text-4)' }}>Total</span>
                <span style={{ fontSize: 13, fontFamily: 'Inter, sans-serif', fontWeight: 700, color: totalPnL >= 0 ? '#10b981' : '#f43f5e' }}>
                  {fmtDollar(totalPnL)}
                </span>
              </div>
              {sells.length > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', borderTop: '1px solid var(--border)', paddingTop: 3, marginTop: 2 }}>
                  <span style={{ fontSize: 10, color: 'var(--text-4)' }}>Win</span>
                  <span style={{ fontSize: 11, fontFamily: 'Inter, sans-serif', color: winRate >= 70 ? '#10b981' : winRate >= 50 ? '#f59e0b' : '#f43f5e' }}>
                    {winRate.toFixed(0)}%
                  </span>
                </div>
              )}
            </div>
          </div>
        )
      })}
      </div>
    </div>
  )
}

// ─── Strategy meta ────────────────────────────────────────────────────────────

const STRAT_META: Record<string, { label: string; color: string; order: number }> = {
  covered_call:  { label: 'Covered Call',  color: '#3b82f6', order: 1 },
  pmcc:          { label: 'PMCC',          color: '#818cf8', order: 2 },
  risk_reversal: { label: 'Risk Reversal', color: '#38bdf8', order: 3 },
  put_spread:    { label: 'Put Spread',    color: '#fbbf24', order: 4 },
  call_spread:   { label: 'Call Spread',   color: '#fb923c', order: 5 },
  csp:           { label: 'CSP',           color: '#f43f5e', order: 6 },
  leap:          { label: 'LEAP',          color: '#10b981', order: 7 },
  other:         { label: 'Other',         color: '#64748b', order: 8 },
}

/** Categorical colors for per-ticker pie slices, cycling once a portfolio has more tickers than colors. */
const TICKER_PALETTE = [
  '#4a72d4', '#f43f5e', '#10b981', '#f59e0b', '#a855f7', '#06b6d4',
  '#eab308', '#ec4899', '#22c55e', '#6366f1', '#f97316', '#14b8a6',
  '#e11d48', '#84cc16', '#8b5cf6', '#0ea5e9',
]

function ibkrDesc(p: { underlyingSymbol?: string; symbol: string; expiry?: string; strike?: number; putCall?: string }) {
  const underlying = p.underlyingSymbol ?? p.symbol
  const expDesc = (() => {
    const s = p.expiry ?? ''
    const m = s.match(/^(\d{4})(\d{2})(\d{2})$/)
    if (!m) return s
    const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    return `${MONTHS[parseInt(m[2])-1]}${parseInt(m[3])}'${m[1].slice(2)}`
  })()
  const strikeDesc = p.strike != null
    ? (p.strike % 1 === 0 ? p.strike.toLocaleString() : p.strike.toFixed(2))
    : '—'
  return `${underlying} ${expDesc} ${strikeDesc} ${p.putCall === 'C' ? 'CALL' : p.putCall === 'P' ? 'PUT' : ''}`
}

function ActualPortfolio({ state, labels }: { state: AppState; labels: Record<string, string> }) {
  const { positions, trades, cashBalance, netLiquidation } = state.sync

  const stocks  = positions.filter(p => p.assetClass === 'STK')
  const options = positions.filter(p => p.assetClass === 'OPT')

  const stockMV  = stocks.reduce((s, p) => s + p.positionValue, 0)
  const stockPnL = stocks.reduce((s, p) => s + p.unrealizedPnL, 0)
  const stockCost= stocks.reduce((s, p) => s + p.costBasisMoney, 0)
  const optionMV = options.reduce((s, p) => s + p.positionValue, 0)
  const optionPnL = options.reduce((s, p) => s + p.unrealizedPnL, 0)
  // Realized P&L must only count expired/closed positions — summing netCash across
  // ALL trades (as before) wrongly included opening credit on still-open short options.
  const realizedPnL = trades
    .filter(t => t.assetClass === 'OPT' && isExpiredDash(t))
    .reduce((s, t) => s + t.netCash, 0)
  const netLiq   = netLiquidation ?? (stockMV + optionMV + cashBalance)
  // Full account unrealized P&L — stocks + options (was stock-only, undercounting badly)
  const totalUnrealized = stockPnL + optionPnL

  const pnlColor = (n: number) => n >= 0 ? '#10b981' : '#ef4444'

  // Build symbol → strategyType map from classifier output
  const symbolToStratType = new Map<string, string>()
  for (const strat of state.strategies) {
    for (const leg of strat.legs) {
      symbolToStratType.set(leg.symbol, strat.type)
    }
  }

  // Sort options by strategy order then by underlying
  const stratOrder = (sym: string) => STRAT_META[symbolToStratType.get(sym) ?? 'other']?.order ?? 8
  const sortedOptions = [...options].sort((a, b) => {
    const od = stratOrder(a.symbol) - stratOrder(b.symbol)
    if (od !== 0) return od
    return (a.underlyingSymbol ?? a.symbol).localeCompare(b.underlyingSymbol ?? b.symbol)
  })


  const TH: React.CSSProperties = {
    padding: '7px 12px', fontSize: 10, fontWeight: 700, letterSpacing: '1.5px',
    textTransform: 'uppercase', color: 'var(--text-4)', whiteSpace: 'nowrap',
    borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)',
    position: 'sticky', top: 0, zIndex: 2,
  }
  const TD: React.CSSProperties = {
    padding: '8px 12px', fontSize: 13, fontFamily: 'Inter, sans-serif',
    borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap',
  }
  const TDR = { ...TD, textAlign: 'right' as const }

  // Allocation structure for the pie: one slice per underlying ticker (stock value +
  // any options on it combined), so labels read as position names, not strategy buckets.
  const donutSlices: DonutSlice[] = (() => {
    const byTicker = new Map<string, number>()
    for (const p of stocks)  byTicker.set(p.symbol, (byTicker.get(p.symbol) ?? 0) + Math.abs(p.positionValue))
    for (const p of options) {
      const ticker = p.underlyingSymbol ?? p.symbol
      byTicker.set(ticker, (byTicker.get(ticker) ?? 0) + Math.abs(p.positionValue))
    }
    return [...byTicker.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([ticker, v], i) => ({ label: ticker, value: v, color: TICKER_PALETTE[i % TICKER_PALETTE.length] }))
  })()

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'auto', WebkitOverflowScrolling: 'touch' }}>

      {/* ── Key metrics ── */}
      <div className="db-keymetrics" style={{
        display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 0, flexShrink: 0, borderBottom: '1px solid var(--border)',
      }}>
        {[
          { label: 'Net Liquidation', value: fmtDollar(netLiq), color: 'var(--text-1)' },
          { label: 'Unrealized P&L',  value: fmtDollar(totalUnrealized), color: pnlColor(totalUnrealized) },
          { label: 'Realized P&L',    value: fmtDollar(realizedPnL), color: pnlColor(realizedPnL) },
          { label: 'Cash (Base)',      value: fmtDollar(cashBalance), color: 'var(--text-1)' },
        ].map(({ label, value, color }, i, arr) => (
          <div key={label} style={{
            padding: '12px 20px',
            borderRight: i < arr.length - 1 ? '1px solid var(--border)' : 'none',
          }}>
            <div style={{ fontSize: 10, color: 'var(--text-4)', letterSpacing: '0.1em', fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'Inter, sans-serif', color }}>{value}</div>
          </div>
        ))}
      </div>

      {/* ── Analytics: allocation structure + monthly flow ── */}
      <div style={{ display: 'flex', gap: 1, background: 'var(--border)', borderBottom: '1px solid var(--border)', flexWrap: 'wrap', flexShrink: 0 }}>
        <div style={{ flex: '2.2 1 460px', background: 'var(--bg-card)', padding: '12px 16px' }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '1.5px', color: 'var(--text-4)', textTransform: 'uppercase', marginBottom: 10 }}>
            Allocation by Position
          </div>
          <StructureDonut
            slices={donutSlices}
            centerLabel="Total"
            centerValue={fmtDollar(stockMV + Math.abs(optionMV))}
          />
        </div>
        <div style={{ flex: '1 1 260px', background: 'var(--bg-card)', padding: '12px 16px' }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '1.5px', color: 'var(--text-4)', textTransform: 'uppercase', marginBottom: 10 }}>
            Monthly Cash Flow
          </div>
          <MonthlyFlowBars trades={trades} />
        </div>
      </div>

      {/* ── Income channels ── */}
      <IncomeChannelStrip trades={trades} labels={labels} symbolToStratType={symbolToStratType} />

      {/* ── Content ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>

        {/* Stocks */}
        {stocks.length > 0 && (
          <div>
            <div style={{ padding: '8px 12px 4px', fontSize: 10, fontWeight: 700, letterSpacing: '2px', color: 'var(--accent)', textTransform: 'uppercase', borderBottom: '1px solid var(--border)', background: 'var(--bg-elevated)' }}>
              Stocks · {stocks.length} positions
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ ...TH, textAlign: 'left' }}>Ticker</th>
                  <th style={{ ...TH, textAlign: 'right' }}>Shares</th>
                  <th style={{ ...TH, textAlign: 'right' }}>Avg Cost</th>
                  <th style={{ ...TH, textAlign: 'right' }}>Last</th>
                  <th style={{ ...TH, textAlign: 'right' }}>Market Value</th>
                  <th style={{ ...TH, textAlign: 'right' }}>Unrealized P&L</th>
                  <th style={{ ...TH, textAlign: 'right' }}>%</th>
                </tr>
              </thead>
              <tbody>
                {stocks.map((p, i) => {
                  const unrealPct = p.costBasisMoney !== 0 ? p.unrealizedPnL / Math.abs(p.costBasisMoney) : 0
                  return (
                    <tr key={i} style={{ background: i % 2 ? 'var(--bg-surface)' : 'transparent' }}>
                      <td style={{ ...TD, fontWeight: 700, color: 'var(--text-1)' }}>{p.symbol}</td>
                      <td style={{ ...TDR, color: 'var(--text-2)' }}>{p.quantity.toLocaleString()}</td>
                      <td style={{ ...TDR, color: 'var(--text-3)' }}>{fmtDollar(p.costBasisPrice)}</td>
                      <td style={{ ...TDR, color: 'var(--text-1)', fontWeight: 600 }}>{fmtDollar(p.markPrice)}</td>
                      <td style={{ ...TDR, color: 'var(--text-1)' }}>{fmtDollar(p.positionValue)}</td>
                      <td style={{ ...TDR, color: pnlColor(p.unrealizedPnL), fontWeight: 600 }}>{fmtDollar(p.unrealizedPnL)}</td>
                      <td style={{ ...TDR, color: pnlColor(unrealPct), fontSize: 12 }}>{(unrealPct * 100).toFixed(1)}%</td>
                    </tr>
                  )
                })}
                {/* Totals */}
                <tr style={{ background: 'var(--bg-elevated)', borderTop: '1px solid var(--border)' }}>
                  <td style={{ ...TD, fontWeight: 700, color: 'var(--text-1)' }}>TOTAL</td>
                  <td style={TDR}></td>
                  <td style={TDR}></td>
                  <td style={TDR}></td>
                  <td style={{ ...TDR, fontWeight: 700, color: 'var(--text-1)' }}>{fmtDollar(stockMV)}</td>
                  <td style={{ ...TDR, fontWeight: 700, color: pnlColor(stockPnL) }}>{fmtDollar(stockPnL)}</td>
                  <td style={{ ...TDR, color: pnlColor(stockPnL / Math.abs(stockCost || 1)), fontSize: 12 }}>
                    {(stockPnL / Math.abs(stockCost || 1) * 100).toFixed(1)}%
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* Options */}
        {sortedOptions.length > 0 && (
          <div>
            <div style={{ padding: '8px 12px 4px', fontSize: 10, fontWeight: 700, letterSpacing: '2px', color: '#a855f7', textTransform: 'uppercase', borderBottom: '1px solid var(--border)', background: 'var(--bg-elevated)' }}>
              Options · {sortedOptions.length} legs
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ ...TH, textAlign: 'left' }}>Strategy</th>
                  <th style={{ ...TH, textAlign: 'left' }}>Description</th>
                  <th style={{ ...TH, textAlign: 'right' }}>Qty</th>
                  <th style={{ ...TH, textAlign: 'right' }}>Mark</th>
                  <th style={{ ...TH, textAlign: 'right' }}>Mkt Value</th>
                  <th style={{ ...TH, textAlign: 'right' }}>Cost Basis</th>
                  <th style={{ ...TH, textAlign: 'right' }}>Unrealized</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  let lastStratType = ''
                  return sortedOptions.map((p, i) => {
                    const stratType = symbolToStratType.get(p.symbol) ?? 'other'
                    const meta      = STRAT_META[stratType] ?? STRAT_META.other
                    const isShort   = p.quantity < 0
                    const isCall    = p.putCall === 'C'
                    const typeColor = isCall ? '#3b82f6' : '#f43f5e'
                    const description = ibkrDesc(p)
                    const showGroupHeader = stratType !== lastStratType
                    lastStratType = stratType
                    return (
                      <>
                        {showGroupHeader && (
                          <tr key={`grp-${stratType}-${i}`} style={{ background: `${meta.color}08` }}>
                            <td colSpan={7} style={{ ...TD, padding: '5px 12px', fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', color: meta.color, borderBottom: `1px solid ${meta.color}30` }}>
                              ── {meta.label.toUpperCase()}
                            </td>
                          </tr>
                        )}
                        <tr key={p.symbol} style={{ background: i % 2 ? 'var(--bg-surface)' : 'transparent' }}>
                          <td style={{ ...TD }}>
                            <span style={{ fontSize: 10, fontWeight: 700, color: meta.color, background: `${meta.color}14`, border: `1px solid ${meta.color}33`, borderRadius: 3, padding: '2px 6px', whiteSpace: 'nowrap' }}>
                              {meta.label}
                            </span>
                          </td>
                          <td style={{ ...TD }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ fontSize: 10, fontWeight: 700, color: typeColor, background: `${typeColor}18`, border: `1px solid ${typeColor}35`, borderRadius: 3, padding: '1px 5px', flexShrink: 0 }}>
                                {isShort ? '↓' : '↑'} {isCall ? 'CALL' : 'PUT'}
                              </span>
                              <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 600, color: 'var(--text-1)', fontSize: 13 }}>{description}</span>
                            </div>
                          </td>
                          <td style={{ ...TDR, color: isShort ? '#ef4444' : '#10b981', fontWeight: 600 }}>{p.quantity}</td>
                          <td style={{ ...TDR, color: 'var(--text-2)' }}>${p.markPrice.toFixed(2)}</td>
                          <td style={{ ...TDR, color: p.positionValue >= 0 ? 'var(--text-2)' : '#ef4444' }}>{fmtDollar(p.positionValue)}</td>
                          <td style={{ ...TDR, color: 'var(--text-3)' }}>{fmtDollar(p.costBasisMoney)}</td>
                          <td style={{ ...TDR, fontWeight: 600, color: pnlColor(p.unrealizedPnL) }}>{fmtDollar(p.unrealizedPnL)}</td>
                        </tr>
                      </>
                    )
                  })
                })()}
                {/* Options totals */}
                <tr style={{ background: 'var(--bg-elevated)', borderTop: '1px solid var(--border)' }}>
                  <td colSpan={4} style={{ ...TD, color: 'var(--text-4)' }}>TOTAL OPTIONS</td>
                  <td style={{ ...TDR, fontWeight: 700, color: optionMV >= 0 ? 'var(--text-1)' : '#ef4444' }}>{fmtDollar(optionMV)}</td>
                  <td style={TDR}></td>
                  <td style={{ ...TDR, fontWeight: 700, color: pnlColor(sortedOptions.reduce((s, p) => s + p.unrealizedPnL, 0)) }}>
                    {fmtDollar(sortedOptions.reduce((s, p) => s + p.unrealizedPnL, 0))}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* Cash */}
        <div>
          <div style={{ padding: '8px 12px 4px', fontSize: 10, fontWeight: 700, letterSpacing: '2px', color: '#10b981', textTransform: 'uppercase', borderBottom: '1px solid var(--border)', background: 'var(--bg-elevated)' }}>
            Cash
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              <tr>
                <td style={{ ...TD, color: 'var(--text-2)', width: 160 }}>Base (USD equiv.)</td>
                <td style={{ ...TDR, fontWeight: 700, color: '#10b981' }}>{fmtDollar(cashBalance)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Net Liquidation reconciliation */}
        <div style={{ padding: '12px 16px', background: 'var(--bg-elevated)', borderTop: '2px solid var(--border)', marginTop: 'auto' }}>
          <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap' }}>
            {[
              { label: 'Stocks', value: stockMV },
              { label: 'Options', value: optionMV },
              { label: 'Cash', value: cashBalance },
            ].map(({ label, value }) => (
              <div key={label}>
                <div style={{ fontSize: 10, color: 'var(--text-4)', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 2 }}>{label}</div>
                <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 600, color: value >= 0 ? 'var(--text-2)' : '#ef4444' }}>{fmtDollar(value)}</div>
              </div>
            ))}
            <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
              <div style={{ fontSize: 10, color: 'var(--text-4)', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 2 }}>Net Liquidation</div>
              <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 18, fontWeight: 700, color: 'var(--text-1)' }}>{fmtDollar(netLiq)}</div>
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}

// ─── Dashboard View ───────────────────────────────────────────────────────────

export default function DashboardView({ state, tradeLabels }: Props) {
  const labels = tradeLabels?.labels ?? {}
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
        <div className="db-root" style={{ flex: 1 }}>
          <div className="db-main" style={{ flex: 1 }}>
            <ActualPortfolio state={state} labels={labels} />
          </div>
          <ActionsSidebar state={state} />
        </div>
      </div>
    </div>
  )
}
