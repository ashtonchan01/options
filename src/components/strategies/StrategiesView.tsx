import type { AppState, Strategy, StrategyType, OptionLeg } from '../../types'
import EmptyState from '../shared/EmptyState'

interface Props { state: AppState }

// ─── Constants ───────────────────────────────────────────────────────────────

const STRAT_COLOR: Record<StrategyType, string> = {
  csp:           '#f43f5e',
  covered_call:  '#3b82f6',
  pmcc:          '#3b82f6',
  risk_reversal: '#38bdf8',
  put_spread:    '#fbbf24',
  call_spread:   '#fb923c',
  leap:          '#10b981',
  other:         '#444',
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

// ─── Leg row ─────────────────────────────────────────────────────────────────

function LegRow({ leg }: { leg: OptionLeg }) {
  const isShort = leg.quantity < 0
  const isCall  = leg.putCall === 'C'
  const legColor = isCall ? '#3b82f6' : '#f43f5e'
  const dteColor = leg.dte <= 7 ? '#f43f5e' : leg.dte <= 21 ? '#f59e0b' : '#555'

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '130px 1fr 80px 110px 50px 55px 75px',
      alignItems: 'center',
      padding: '9px 16px',
      borderBottom: '1px solid #0f0f0f',
      fontSize: 12,
    }}>
      <span style={{
        padding: '2px 7px', fontSize: 10, fontWeight: 700,
        color: legColor, background: `${legColor}14`, border: `1px solid ${legColor}33`,
        fontFamily: 'IBM Plex Mono, monospace', display: 'inline-block', width: 'fit-content',
      }}>
        {isShort ? 'SHORT' : 'LONG'} {isCall ? 'CALL' : 'PUT'}
      </span>
      <span />
      <span style={{ fontFamily: 'IBM Plex Mono, monospace', color: '#ccc', textAlign: 'right' }}>
        ${leg.strike.toLocaleString()}
      </span>
      <span style={{ fontFamily: 'IBM Plex Mono, monospace', color: '#555', textAlign: 'right', fontSize: 11 }}>
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
    <div style={{ background: '#0d0d0d', border: '1px solid #1a1a1a', borderLeft: `3px solid ${color}` }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: '1px solid #111' }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: '#e8e8e8', fontFamily: 'IBM Plex Mono, monospace', minWidth: 56 }}>
          {s.underlying}
        </span>
        <span style={{ padding: '2px 8px', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color, background: `${color}14`, border: `1px solid ${color}33` }}>
          {STRAT_LABEL[s.type]}
        </span>
        <span style={{ padding: '2px 8px', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: status.color, background: `${status.color}14`, border: `1px solid ${status.color}33` }}>
          {status.label}
        </span>
        <span style={{ fontSize: 10, fontFamily: 'IBM Plex Mono, monospace', color: minDte <= 21 ? '#f59e0b' : '#333' }}>
          {minDte}d
        </span>
        <div style={{ flex: 1 }} />
        {s.netPremiumReceived > 0 && (
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 10, color: '#2a2a2a', letterSpacing: '0.06em' }}>PREMIUM</div>
            <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 13, color: '#666' }}>{fmt$(s.netPremiumReceived)}</div>
          </div>
        )}
        <div style={{ textAlign: 'right', minWidth: 80 }}>
          <div style={{ fontSize: 10, color: '#2a2a2a', letterSpacing: '0.06em' }}>UNREAL P&L</div>
          <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 13, fontWeight: 600, color: pnlColor(s.unrealizedPnL) }}>
            {fmt$(s.unrealizedPnL)}
          </div>
        </div>
      </div>

      {/* Shares row (covered call) */}
      {s.shares && (
        <div style={{ display: 'flex', gap: 24, padding: '9px 16px', borderBottom: '1px solid #0f0f0f', fontSize: 12 }}>
          <span style={{ fontFamily: 'IBM Plex Mono, monospace', color: '#333', fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', alignSelf: 'center' }}>STOCK</span>
          <span style={{ fontFamily: 'IBM Plex Mono, monospace', color: '#888' }}>{s.shares.quantity} shares</span>
          <span style={{ color: '#444' }}>avg <span style={{ color: '#666', fontFamily: 'IBM Plex Mono, monospace' }}>{fmt$(s.shares.avgCost, 2)}</span></span>
          <span style={{ color: '#444' }}>mark <span style={{ color: '#666', fontFamily: 'IBM Plex Mono, monospace' }}>{fmt$(s.shares.markPrice, 2)}</span></span>
          <span style={{ marginLeft: 'auto', fontFamily: 'IBM Plex Mono, monospace', color: pnlColor(s.shares.unrealizedPnL) }}>{fmt$(s.shares.unrealizedPnL)}</span>
        </div>
      )}

      {/* Column headers */}
      <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr 80px 110px 50px 55px 75px', padding: '6px 16px', fontSize: 10, fontWeight: 600, color: '#222', letterSpacing: '0.06em' }}>
        <span>LEG</span><span /><span style={{ textAlign: 'right' }}>STRIKE</span>
        <span style={{ textAlign: 'right' }}>EXPIRY</span><span style={{ textAlign: 'right' }}>DTE</span>
        <span style={{ textAlign: 'right' }}>QTY</span><span style={{ textAlign: 'right' }}>P&L</span>
      </div>
      {s.legs.map((leg, i) => <LegRow key={i} leg={leg} />)}

      {/* Progress bar */}
      {pct !== null && (
        <div style={{ padding: '10px 16px', borderTop: '1px solid #0f0f0f', display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 10, color: '#222', letterSpacing: '0.06em', minWidth: 100 }}>PROFIT PROGRESS</span>
          <div style={{ flex: 1, height: 3, background: '#111', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{
              height: '100%', width: `${Math.abs(pct) * 100}%`,
              background: pct >= 0 ? (pct >= 0.5 ? '#10b981' : '#3b82f6') : '#f43f5e',
              borderRadius: 2,
            }} />
          </div>
          <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 11, color: pct >= 0 ? '#10b981' : '#f43f5e', minWidth: 36, textAlign: 'right' }}>
            {(pct * 100).toFixed(0)}%
          </span>
        </div>
      )}
    </div>
  )
}

// ─── Group section ────────────────────────────────────────────────────────────

function StrategyGroup({ type, strategies }: { type: StrategyType; strategies: Strategy[] }) {
  const color        = STRAT_COLOR[type]
  const totalPnL     = strategies.reduce((s, st) => s + st.unrealizedPnL, 0)
  const totalPremium = strategies.reduce((s, st) => s + st.netPremiumReceived, 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color, letterSpacing: '0.1em' }}>{STRAT_LABEL[type].toUpperCase()}</span>
        <span style={{ fontSize: 11, color: '#2a2a2a' }}>{strategies.length}</span>
        <div style={{ flex: 1, height: 1, background: '#111' }} />
        {totalPremium > 0 && (
          <span style={{ fontSize: 11, fontFamily: 'IBM Plex Mono, monospace', color: '#333' }}>premium {fmt$(totalPremium)}</span>
        )}
        <span style={{ fontSize: 12, fontFamily: 'IBM Plex Mono, monospace', color: pnlColor(totalPnL), fontWeight: 600 }}>
          {totalPnL >= 0 ? '+' : ''}{fmt$(totalPnL)}
        </span>
      </div>
      {strategies.map(s => <StrategyCard key={s.id} s={s} />)}
    </div>
  )
}

// ─── Main ────────────────────────────────────────────────────────────────────

export default function StrategiesView({ state }: Props) {
  const { strategies } = state

  const hasPositions = state.sync.positions.length > 0
  const hasOptions   = state.sync.positions.some(p => p.assetClass === 'OPT')

  if (!strategies.length) {
    return (
      <div style={{ padding: '20px 24px' }}>
        <div style={{ color: '#f59e0b', fontWeight: 600, marginBottom: 16, fontSize: 12 }}>
          No strategies classified — showing raw position data for debugging:
        </div>
        <div style={{ background: '#0d0d0d', border: '1px solid #1a1a1a', overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, fontFamily: 'IBM Plex Mono, monospace' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #1a1a1a' }}>
                {['symbol','assetClass','putCall','strike','expiry','underlyingSymbol','qty','positionValue'].map(h => (
                  <th key={h} style={{ padding: '8px 12px', textAlign: 'left', color: '#333', fontWeight: 700, letterSpacing: '0.06em', fontSize: 10 }}>{h.toUpperCase()}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {state.sync.positions.map((p, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #111', background: i % 2 ? '#0a0a0a' : 'transparent' }}>
                  <td style={{ padding: '7px 12px', color: '#ccc' }}>{p.symbol}</td>
                  <td style={{ padding: '7px 12px', color: p.assetClass === 'OPT' ? '#10b981' : p.assetClass === 'STK' ? '#3b82f6' : '#f59e0b' }}>{p.assetClass}</td>
                  <td style={{ padding: '7px 12px', color: p.putCall ? '#10b981' : '#f43f5e' }}>{p.putCall ?? '—'}</td>
                  <td style={{ padding: '7px 12px', color: p.strike ? '#10b981' : '#f43f5e' }}>{p.strike ?? '—'}</td>
                  <td style={{ padding: '7px 12px', color: p.expiry ? '#10b981' : '#f43f5e' }}>{p.expiry ?? '—'}</td>
                  <td style={{ padding: '7px 12px', color: '#888' }}>{p.underlyingSymbol ?? '—'}</td>
                  <td style={{ padding: '7px 12px', color: '#888' }}>{p.quantity}</td>
                  <td style={{ padding: '7px 12px', color: p.positionValue > 0 ? '#10b981' : p.positionValue < 0 ? '#f43f5e' : '#555' }}>{p.positionValue.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {state.sync.positions.length === 0 && (
            <div style={{ padding: 24, color: '#333', textAlign: 'center' }}>No positions returned from sync.</div>
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

  return (
    <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
        {[
          { label: 'STRATEGIES', value: String(strategies.length), color: '#e8e8e8' },
          { label: 'TOTAL PREMIUM', value: fmt$(totalPremium), color: '#e8e8e8' },
          { label: 'UNREALIZED P&L', value: fmt$(totalPnL), color: pnlColor(totalPnL) },
          { label: 'MANAGE', value: String(manage), color: manage > 0 ? '#f59e0b' : '#333' },
          { label: 'URGENT', value: String(urgent), color: urgent > 0 ? '#f43f5e' : '#333' },
        ].map(({ label, value, color }) => (
          <div key={label} className="stat-card">
            <div className="stat-label">{label}</div>
            <div className="stat-value" style={{ color, fontSize: 26 }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Groups */}
      {TYPE_ORDER.filter(t => byType[t].length > 0).map(t => (
        <StrategyGroup key={t} type={t} strategies={byType[t]} />
      ))}
    </div>
  )
}
