import type { AppState, Strategy, StrategyType, OptionLeg } from '../../types'
import type { StrategyPage } from '../../App'
import CoveredCallsView from './CoveredCallsView'
import StrategyTradeLog from './StrategyTradeLog'

interface Props { state: AppState; stratPage?: StrategyPage }

// ─── Strategy page configs ────────────────────────────────────────────────────

const STRAT_CONFIGS = {
  csp: {
    id: 'CSP', label: 'Cash Secured Puts', color: '#f43f5e',
    description: 'Trade log — put option legs',
    filter: (t: import('../../types').RawTrade) => t.assetClass === 'OPT' && t.putCall === 'P',
  },
  leap: {
    id: 'LEAP', label: 'LEAP', color: '#10b981',
    description: 'Trade log — LEAP & risk reversal legs (long-dated options)',
    filter: (t: import('../../types').RawTrade) => {
      if (t.assetClass !== 'OPT') return false
      // Risk reversals appear here too; identify by expiry > ~9 months out if available
      // Fallback: include all option trades not already covered by CC/CSP heuristics
      return true
    },
  },
  spx: {
    id: 'SPX', label: 'SPX', color: '#8b5cf6',
    description: 'Trade log — SPX / SPXW index trades',
    filter: (t: import('../../types').RawTrade) =>
      /^SPX|^SPXW/.test(t.underlyingSymbol ?? t.symbol),
  },
  rotation: {
    id: 'ROT', label: 'Rotation Model', color: '#f59e0b',
    description: 'Trade log — sector rotation trades (stocks)',
    filter: (t: import('../../types').RawTrade) => t.assetClass === 'STK',
  },
  ptos: {
    id: 'PTOS', label: 'PTOS', color: '#06b6d4',
    description: 'Trade log — PTOS strategy',
    filter: (t: import('../../types').RawTrade) => t.assetClass === 'OPT' && t.putCall === 'P' && (t.quantity ?? 0) > 0,
  },
  dcas: {
    id: 'DCAS', label: 'DCAS', color: '#ec4899',
    description: 'Trade log — dollar-cost average accumulation (stock buys)',
    filter: (t: import('../../types').RawTrade) => t.assetClass === 'STK' && (t.quantity ?? 0) > 0,
  },
  profit_taking: {
    id: 'PT', label: 'Profit Taking', color: '#84cc16',
    description: 'Trade log — closing trades with net positive cash',
    filter: (t: import('../../types').RawTrade) => t.netCash > 0 && (t.openClose === 'C'),
  },
  lilo: {
    id: 'LILO', label: 'LILO', color: '#f97316',
    description: 'Trade log — LILO strategy trades',
    filter: (t: import('../../types').RawTrade) => t.assetClass === 'OPT',
  },
  arb_cloud: {
    id: 'ARB', label: 'ARB Cloud', color: '#a78bfa',
    description: 'Trade log — ARB Cloud trades',
    filter: (t: import('../../types').RawTrade) => t.assetClass === 'OPT' && t.putCall === 'C' && (t.quantity ?? 0) > 0,
  },
  tabi: {
    id: 'TABI', label: 'TABI', color: '#34d399',
    description: 'Trade log — TABI strategy trades',
    filter: (t: import('../../types').RawTrade) => t.assetClass === 'OPT',
  },
} as const

// ─── Constants ───────────────────────────────────────────────────────────────

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

const STRAT_LABEL: Record<StrategyType, string> = {
  csp:           'CSP',
  covered_call:  'Covered Call',
  pmcc:          'PMCC',
  risk_reversal: 'Risk Reversal',
  put_spread:    'Put Spread',
  call_spread:   'Call Spread',
  leap:          'LEAP',
  other:         'Other',
}

const TYPE_ORDER: StrategyType[] = [
  'covered_call', 'pmcc', 'csp', 'risk_reversal',
  'put_spread', 'call_spread', 'leap', 'other',
]

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt$(n: number, d = 0) {
  return (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
}

function fmtExpiry(s: string) {
  const m = s.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (!m) return s
  return new Date(`${m[1]}-${m[2]}-${m[3]}`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
}

function pnlColor(n: number) { return n >= 0 ? '#10b981' : '#f43f5e' }

function statusOf(s: Strategy): { label: string; color: string } {
  const maxPremium = Math.abs(s.netPremiumReceived)
  const profit = s.unrealizedPnL
  const minDte = Math.min(...s.legs.map(l => l.dte))

  if (profit < 0 && Math.abs(profit) > maxPremium * 0.5)
    return { label: 'URGENT', color: '#f43f5e' }
  if (minDte <= 21 || (maxPremium > 0 && profit / maxPremium >= 0.5))
    return { label: 'MANAGE', color: '#f59e0b' }
  return { label: 'ON TRACK', color: '#10b981' }
}

function profitPct(s: Strategy): number | null {
  if (!s.netPremiumReceived || s.netPremiumReceived <= 0) return null
  return Math.min(Math.max(s.unrealizedPnL / s.netPremiumReceived, -1), 1)
}

// ─── Tile styles ─────────────────────────────────────────────────────────────

const tile: React.CSSProperties = {
  background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10,
  overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0,
}
const tileHdr: React.CSSProperties = {
  padding: '12px 20px', borderBottom: '1px solid var(--border)',
  fontSize: 13, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.08em', flexShrink: 0,
}

// ─── Leg row ─────────────────────────────────────────────────────────────────

function LegRow({ leg }: { leg: OptionLeg }) {
  const isShort = leg.quantity < 0
  const isCall  = leg.putCall === 'C'
  const legColor = isCall ? '#3b82f6' : '#f43f5e'
  const dteColor = leg.dte <= 7 ? '#f43f5e' : leg.dte <= 21 ? '#f59e0b' : 'var(--text-3)'

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '110px 1fr 70px 90px 45px 45px 65px',
      alignItems: 'center',
      padding: '9px 16px',
      borderBottom: '1px solid var(--border-light)',
      fontSize: 13,
    }}>
      <span style={{
        padding: '2px 6px', fontSize: 11, fontWeight: 700,
        color: legColor, background: `${legColor}14`, border: `1px solid ${legColor}33`,
        fontFamily: 'IBM Plex Mono, monospace', display: 'inline-block', width: 'fit-content',
      }}>
        {isShort ? 'SHORT' : 'LONG'} {isCall ? 'CALL' : 'PUT'}
      </span>
      <span />
      <span style={{ fontFamily: 'IBM Plex Mono, monospace', color: 'var(--text-1)', textAlign: 'right' }}>
        ${leg.strike.toLocaleString()}
      </span>
      <span style={{ fontFamily: 'IBM Plex Mono, monospace', color: 'var(--text-3)', textAlign: 'right', fontSize: 12 }}>
        {fmtExpiry(leg.expiry)}
      </span>
      <span style={{ fontFamily: 'IBM Plex Mono, monospace', color: dteColor, textAlign: 'right', fontWeight: 600 }}>
        {leg.dte}d
      </span>
      <span style={{ fontFamily: 'IBM Plex Mono, monospace', color: isShort ? '#f43f5e' : '#10b981', textAlign: 'right' }}>
        {isShort ? '' : '+'}{leg.quantity}
      </span>
      <span style={{ fontFamily: 'IBM Plex Mono, monospace', color: pnlColor(leg.unrealizedPnL), textAlign: 'right' }}>
        {fmt$(leg.unrealizedPnL)}
      </span>
    </div>
  )
}

// ─── Strategy card ───────────────────────────────────────────────────────────

function StrategyCard({ s }: { s: Strategy }) {
  const color  = STRAT_COLOR[s.type]
  const status = statusOf(s)
  const pct    = profitPct(s)
  const minDte = Math.min(...s.legs.map(l => l.dte))

  return (
    <div className="strategy-card" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, borderLeft: `3px solid ${color}`, overflow: 'hidden' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-1)', fontFamily: 'IBM Plex Mono, monospace', minWidth: 50 }}>
          {s.underlying}
        </span>
        <span style={{ padding: '2px 7px', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color, background: `${color}14`, border: `1px solid ${color}33` }}>
          {STRAT_LABEL[s.type]}
        </span>
        <span style={{ padding: '2px 7px', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: status.color, background: `${status.color}14`, border: `1px solid ${status.color}33` }}>
          {status.label}
        </span>
        <span style={{ fontSize: 11, fontFamily: 'IBM Plex Mono, monospace', color: minDte <= 21 ? '#f59e0b' : 'var(--text-5)' }}>
          {minDte}d
        </span>
        <div style={{ flex: 1 }} />
        {s.netPremiumReceived > 0 && (
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 11, color: 'var(--text-3)', letterSpacing: '0.06em' }}>PREM</div>
            <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 14, color: 'var(--text-3)' }}>{fmt$(s.netPremiumReceived)}</div>
          </div>
        )}
        <div style={{ textAlign: 'right', minWidth: 70 }}>
          <div style={{ fontSize: 11, color: 'var(--text-3)', letterSpacing: '0.06em' }}>P&L</div>
          <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 14, fontWeight: 600, color: pnlColor(s.unrealizedPnL) }}>
            {fmt$(s.unrealizedPnL)}
          </div>
        </div>
      </div>

      {/* Shares row */}
      {s.shares && (
        <div style={{ display: 'flex', gap: 20, padding: '9px 16px', borderBottom: '1px solid var(--border-light)', fontSize: 13 }}>
          <span style={{ fontFamily: 'IBM Plex Mono, monospace', color: 'var(--text-5)', fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', alignSelf: 'center' }}>STOCK</span>
          <span style={{ fontFamily: 'IBM Plex Mono, monospace', color: 'var(--text-2)' }}>{s.shares.quantity} sh</span>
          <span style={{ color: 'var(--text-4)' }}>avg <span style={{ color: 'var(--text-3)', fontFamily: 'IBM Plex Mono, monospace' }}>{fmt$(s.shares.avgCost, 2)}</span></span>
          <span style={{ marginLeft: 'auto', fontFamily: 'IBM Plex Mono, monospace', color: pnlColor(s.shares.unrealizedPnL) }}>{fmt$(s.shares.unrealizedPnL)}</span>
        </div>
      )}

      {/* Column headers */}
      <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr 70px 90px 45px 45px 65px', padding: '5px 14px', fontSize: 11, fontWeight: 600, color: 'var(--text-3)', letterSpacing: '0.06em' }}>
        <span>LEG</span><span /><span style={{ textAlign: 'right' }}>STRIKE</span>
        <span style={{ textAlign: 'right' }}>EXPIRY</span><span style={{ textAlign: 'right' }}>DTE</span>
        <span style={{ textAlign: 'right' }}>QTY</span><span style={{ textAlign: 'right' }}>P&L</span>
      </div>
      {s.legs.map((leg, i) => <LegRow key={i} leg={leg} />)}

      {/* Progress bar */}
      {pct !== null && (
        <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border-light)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 11, color: 'var(--text-3)', letterSpacing: '0.06em', minWidth: 80 }}>PROFIT</span>
          <div style={{ flex: 1, height: 3, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{
              height: '100%', width: `${Math.abs(pct) * 100}%`,
              background: pct >= 0 ? (pct >= 0.5 ? '#10b981' : '#3b82f6') : '#f43f5e',
              borderRadius: 2,
            }} />
          </div>
          <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 12, color: pct >= 0 ? '#10b981' : '#f43f5e', minWidth: 30, textAlign: 'right' }}>
            {(pct * 100).toFixed(0)}%
          </span>
        </div>
      )}
    </div>
  )
}

// ─── Main ────────────────────────────────────────────────────────────────────

export default function StrategiesView({ state, stratPage = 'overview' }: Props) {
  if (stratPage === 'covered_calls') return <CoveredCallsView state={state} />
  if (stratPage !== 'overview') {
    const cfg = STRAT_CONFIGS[stratPage as keyof typeof STRAT_CONFIGS]
    if (cfg) return <StrategyTradeLog state={state} config={cfg} />
  }

  const { strategies } = state

  if (!strategies.length) {
    return (
      <div style={{ padding: '20px 24px' }}>
        <div style={{ color: '#f59e0b', fontWeight: 600, marginBottom: 16, fontSize: 14 }}>
          No strategies classified — showing raw position data for debugging:
        </div>
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, fontFamily: 'IBM Plex Mono, monospace' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['symbol','assetClass','putCall','strike','expiry','underlyingSymbol','qty','positionValue'].map(h => (
                  <th key={h} style={{ padding: '10px 14px', textAlign: 'left', color: 'var(--text-2)', fontWeight: 700, letterSpacing: '0.06em', fontSize: 12 }}>{h.toUpperCase()}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {state.sync.positions.map((p, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--border-light)', background: i % 2 ? 'var(--bg-surface)' : 'transparent' }}>
                  <td style={{ padding: '9px 14px', color: 'var(--text-1)' }}>{p.symbol}</td>
                  <td style={{ padding: '9px 14px', color: p.assetClass === 'OPT' ? '#10b981' : p.assetClass === 'STK' ? '#3b82f6' : '#f59e0b' }}>{p.assetClass}</td>
                  <td style={{ padding: '9px 14px', color: p.putCall ? '#10b981' : '#f43f5e' }}>{p.putCall ?? '—'}</td>
                  <td style={{ padding: '9px 14px', color: p.strike ? '#10b981' : '#f43f5e' }}>{p.strike ?? '—'}</td>
                  <td style={{ padding: '9px 14px', color: p.expiry ? '#10b981' : '#f43f5e' }}>{p.expiry ?? '—'}</td>
                  <td style={{ padding: '9px 14px', color: 'var(--text-2)' }}>{p.underlyingSymbol ?? '—'}</td>
                  <td style={{ padding: '9px 14px', color: 'var(--text-2)' }}>{p.quantity}</td>
                  <td style={{ padding: '9px 14px', color: p.positionValue > 0 ? '#10b981' : p.positionValue < 0 ? '#f43f5e' : 'var(--text-3)' }}>{p.positionValue.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {state.sync.positions.length === 0 && (
            <div style={{ padding: 24, color: 'var(--text-3)', textAlign: 'center' }}>No positions returned from sync.</div>
          )}
        </div>
      </div>
    )
  }

  const byType = TYPE_ORDER.reduce<Record<StrategyType, Strategy[]>>((acc, t) => {
    acc[t] = strategies.filter(s => s.type === t)
    return acc
  }, {} as Record<StrategyType, Strategy[]>)

  const totalPnL     = strategies.reduce((s, st) => s + st.unrealizedPnL, 0)
  const totalPremium = strategies.reduce((s, st) => s + st.netPremiumReceived, 0)
  const urgent       = strategies.filter(s => statusOf(s).label === 'URGENT').length
  const manage       = strategies.filter(s => statusOf(s).label === 'MANAGE').length

  // Split groups into two columns
  const activeTypes = TYPE_ORDER.filter(t => byType[t].length > 0)
  const col1Types = activeTypes.filter((_, i) => i % 2 === 0)
  const col2Types = activeTypes.filter((_, i) => i % 2 === 1)

  return (
    <div style={{ padding: 20, height: '100%', display: 'flex', flexDirection: 'column', gap: 14, overflow: 'hidden' }}>

      {/* Stats */}
      <div className="strategies-stats" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8, flexShrink: 0 }}>
        {[
          { label: 'STRATEGIES', value: String(strategies.length), color: 'var(--text-1)' },
          { label: 'TOTAL PREMIUM', value: fmt$(totalPremium), color: 'var(--text-1)' },
          { label: 'UNREALIZED P&L', value: fmt$(totalPnL), color: pnlColor(totalPnL) },
          { label: 'MANAGE', value: String(manage), color: manage > 0 ? '#f59e0b' : 'var(--text-5)' },
          { label: 'URGENT', value: String(urgent), color: urgent > 0 ? '#f43f5e' : 'var(--text-5)' },
        ].map(({ label, value, color }) => (
          <div key={label} className="stat-card">
            <div className="stat-label">{label}</div>
            <div className="stat-value" style={{ color, fontSize: 28 }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Strategy groups in 2-column layout */}
      <div className="strategies-grid" style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, minHeight: 0 }}>
        <div style={tile}>
          <div style={tileHdr}>{col1Types.map(t => STRAT_LABEL[t].toUpperCase()).join(' · ') || 'STRATEGIES'}</div>
          <div style={{ flex: 1, overflow: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {col1Types.map(t => (
              <div key={t}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: STRAT_COLOR[t], letterSpacing: '0.1em' }}>{STRAT_LABEL[t].toUpperCase()}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{byType[t].length}</span>
                  <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                  <span style={{ fontSize: 13, fontFamily: 'IBM Plex Mono, monospace', color: pnlColor(byType[t].reduce((s, st) => s + st.unrealizedPnL, 0)), fontWeight: 600 }}>
                    {fmt$(byType[t].reduce((s, st) => s + st.unrealizedPnL, 0))}
                  </span>
                </div>
                {byType[t].map(s => <StrategyCard key={s.id} s={s} />)}
              </div>
            ))}
          </div>
        </div>

        <div style={tile}>
          <div style={tileHdr}>{col2Types.map(t => STRAT_LABEL[t].toUpperCase()).join(' · ') || 'STRATEGIES'}</div>
          <div style={{ flex: 1, overflow: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {col2Types.map(t => (
              <div key={t}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: STRAT_COLOR[t], letterSpacing: '0.1em' }}>{STRAT_LABEL[t].toUpperCase()}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{byType[t].length}</span>
                  <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                  <span style={{ fontSize: 13, fontFamily: 'IBM Plex Mono, monospace', color: pnlColor(byType[t].reduce((s, st) => s + st.unrealizedPnL, 0)), fontWeight: 600 }}>
                    {fmt$(byType[t].reduce((s, st) => s + st.unrealizedPnL, 0))}
                  </span>
                </div>
                {byType[t].map(s => <StrategyCard key={s.id} s={s} />)}
              </div>
            ))}
            {col2Types.length === 0 && (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-5)', fontSize: 14 }}>
                No additional strategy types
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
