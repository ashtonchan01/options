import type { AppState, Strategy, StrategyType, OptionLeg } from '../../types'

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
  other:         '#3B4263',
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
  background: '#131726', border: '1px solid #1E2540', borderRadius: 10,
  overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0,
}
const tileHdr: React.CSSProperties = {
  padding: '10px 16px', borderBottom: '1px solid #1E2540',
  fontSize: 11, fontWeight: 700, color: '#5D6580', letterSpacing: '0.08em', flexShrink: 0,
}

// ─── Leg row ─────────────────────────────────────────────────────────────────

function LegRow({ leg }: { leg: OptionLeg }) {
  const isShort = leg.quantity < 0
  const isCall  = leg.putCall === 'C'
  const legColor = isCall ? '#3b82f6' : '#f43f5e'
  const dteColor = leg.dte <= 7 ? '#f43f5e' : leg.dte <= 21 ? '#f59e0b' : '#5D6580'

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '110px 1fr 70px 90px 45px 45px 65px',
      alignItems: 'center',
      padding: '7px 14px',
      borderBottom: '1px solid #1A1F35',
      fontSize: 11,
    }}>
      <span style={{
        padding: '2px 6px', fontSize: 9, fontWeight: 700,
        color: legColor, background: `${legColor}14`, border: `1px solid ${legColor}33`,
        fontFamily: 'IBM Plex Mono, monospace', display: 'inline-block', width: 'fit-content',
      }}>
        {isShort ? 'SHORT' : 'LONG'} {isCall ? 'CALL' : 'PUT'}
      </span>
      <span />
      <span style={{ fontFamily: 'IBM Plex Mono, monospace', color: '#EAEDF3', textAlign: 'right' }}>
        ${leg.strike.toLocaleString()}
      </span>
      <span style={{ fontFamily: 'IBM Plex Mono, monospace', color: '#5D6580', textAlign: 'right', fontSize: 10 }}>
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
    <div style={{ background: '#131726', border: '1px solid #1E2540', borderRadius: 10, borderLeft: `3px solid ${color}`, overflow: 'hidden' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderBottom: '1px solid #1E2540' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#EAEDF3', fontFamily: 'IBM Plex Mono, monospace', minWidth: 50 }}>
          {s.underlying}
        </span>
        <span style={{ padding: '2px 7px', fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', color, background: `${color}14`, border: `1px solid ${color}33` }}>
          {STRAT_LABEL[s.type]}
        </span>
        <span style={{ padding: '2px 7px', fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', color: status.color, background: `${status.color}14`, border: `1px solid ${status.color}33` }}>
          {status.label}
        </span>
        <span style={{ fontSize: 9, fontFamily: 'IBM Plex Mono, monospace', color: minDte <= 21 ? '#f59e0b' : '#2A3250' }}>
          {minDte}d
        </span>
        <div style={{ flex: 1 }} />
        {s.netPremiumReceived > 0 && (
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 9, color: '#5D6580', letterSpacing: '0.06em' }}>PREM</div>
            <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 12, color: '#5D6580' }}>{fmt$(s.netPremiumReceived)}</div>
          </div>
        )}
        <div style={{ textAlign: 'right', minWidth: 70 }}>
          <div style={{ fontSize: 9, color: '#5D6580', letterSpacing: '0.06em' }}>P&L</div>
          <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 12, fontWeight: 600, color: pnlColor(s.unrealizedPnL) }}>
            {fmt$(s.unrealizedPnL)}
          </div>
        </div>
      </div>

      {/* Shares row */}
      {s.shares && (
        <div style={{ display: 'flex', gap: 20, padding: '7px 14px', borderBottom: '1px solid #1A1F35', fontSize: 11 }}>
          <span style={{ fontFamily: 'IBM Plex Mono, monospace', color: '#2A3250', fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', alignSelf: 'center' }}>STOCK</span>
          <span style={{ fontFamily: 'IBM Plex Mono, monospace', color: '#9198AE' }}>{s.shares.quantity} sh</span>
          <span style={{ color: '#3B4263' }}>avg <span style={{ color: '#5D6580', fontFamily: 'IBM Plex Mono, monospace' }}>{fmt$(s.shares.avgCost, 2)}</span></span>
          <span style={{ marginLeft: 'auto', fontFamily: 'IBM Plex Mono, monospace', color: pnlColor(s.shares.unrealizedPnL) }}>{fmt$(s.shares.unrealizedPnL)}</span>
        </div>
      )}

      {/* Column headers */}
      <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr 70px 90px 45px 45px 65px', padding: '5px 14px', fontSize: 9, fontWeight: 600, color: '#5D6580', letterSpacing: '0.06em' }}>
        <span>LEG</span><span /><span style={{ textAlign: 'right' }}>STRIKE</span>
        <span style={{ textAlign: 'right' }}>EXPIRY</span><span style={{ textAlign: 'right' }}>DTE</span>
        <span style={{ textAlign: 'right' }}>QTY</span><span style={{ textAlign: 'right' }}>P&L</span>
      </div>
      {s.legs.map((leg, i) => <LegRow key={i} leg={leg} />)}

      {/* Progress bar */}
      {pct !== null && (
        <div style={{ padding: '8px 14px', borderTop: '1px solid #1A1F35', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 9, color: '#5D6580', letterSpacing: '0.06em', minWidth: 80 }}>PROFIT</span>
          <div style={{ flex: 1, height: 3, background: '#1E2540', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{
              height: '100%', width: `${Math.abs(pct) * 100}%`,
              background: pct >= 0 ? (pct >= 0.5 ? '#10b981' : '#3b82f6') : '#f43f5e',
              borderRadius: 2,
            }} />
          </div>
          <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 10, color: pct >= 0 ? '#10b981' : '#f43f5e', minWidth: 30, textAlign: 'right' }}>
            {(pct * 100).toFixed(0)}%
          </span>
        </div>
      )}
    </div>
  )
}

// ─── Main ────────────────────────────────────────────────────────────────────

export default function StrategiesView({ state }: Props) {
  const { strategies } = state

  if (!strategies.length) {
    return (
      <div style={{ padding: '20px 24px' }}>
        <div style={{ color: '#f59e0b', fontWeight: 600, marginBottom: 16, fontSize: 12 }}>
          No strategies classified — showing raw position data for debugging:
        </div>
        <div style={{ background: '#131726', border: '1px solid #1E2540', borderRadius: 10, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, fontFamily: 'IBM Plex Mono, monospace' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #1E2540' }}>
                {['symbol','assetClass','putCall','strike','expiry','underlyingSymbol','qty','positionValue'].map(h => (
                  <th key={h} style={{ padding: '8px 12px', textAlign: 'left', color: '#9198AE', fontWeight: 700, letterSpacing: '0.06em', fontSize: 10 }}>{h.toUpperCase()}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {state.sync.positions.map((p, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #1A1F35', background: i % 2 ? '#0F1220' : 'transparent' }}>
                  <td style={{ padding: '7px 12px', color: '#EAEDF3' }}>{p.symbol}</td>
                  <td style={{ padding: '7px 12px', color: p.assetClass === 'OPT' ? '#10b981' : p.assetClass === 'STK' ? '#3b82f6' : '#f59e0b' }}>{p.assetClass}</td>
                  <td style={{ padding: '7px 12px', color: p.putCall ? '#10b981' : '#f43f5e' }}>{p.putCall ?? '—'}</td>
                  <td style={{ padding: '7px 12px', color: p.strike ? '#10b981' : '#f43f5e' }}>{p.strike ?? '—'}</td>
                  <td style={{ padding: '7px 12px', color: p.expiry ? '#10b981' : '#f43f5e' }}>{p.expiry ?? '—'}</td>
                  <td style={{ padding: '7px 12px', color: '#9198AE' }}>{p.underlyingSymbol ?? '—'}</td>
                  <td style={{ padding: '7px 12px', color: '#9198AE' }}>{p.quantity}</td>
                  <td style={{ padding: '7px 12px', color: p.positionValue > 0 ? '#10b981' : p.positionValue < 0 ? '#f43f5e' : '#5D6580' }}>{p.positionValue.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {state.sync.positions.length === 0 && (
            <div style={{ padding: 24, color: '#5D6580', textAlign: 'center' }}>No positions returned from sync.</div>
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
    <div style={{ padding: 16, height: '100%', display: 'flex', flexDirection: 'column', gap: 12, overflow: 'hidden' }}>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8, flexShrink: 0 }}>
        {[
          { label: 'STRATEGIES', value: String(strategies.length), color: '#EAEDF3' },
          { label: 'TOTAL PREMIUM', value: fmt$(totalPremium), color: '#EAEDF3' },
          { label: 'UNREALIZED P&L', value: fmt$(totalPnL), color: pnlColor(totalPnL) },
          { label: 'MANAGE', value: String(manage), color: manage > 0 ? '#f59e0b' : '#2A3250' },
          { label: 'URGENT', value: String(urgent), color: urgent > 0 ? '#f43f5e' : '#2A3250' },
        ].map(({ label, value, color }) => (
          <div key={label} className="stat-card">
            <div className="stat-label">{label}</div>
            <div className="stat-value" style={{ color, fontSize: 22 }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Strategy groups in 2-column layout */}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, minHeight: 0 }}>
        <div style={tile}>
          <div style={tileHdr}>{col1Types.map(t => STRAT_LABEL[t].toUpperCase()).join(' · ') || 'STRATEGIES'}</div>
          <div style={{ flex: 1, overflow: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {col1Types.map(t => (
              <div key={t}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: STRAT_COLOR[t], letterSpacing: '0.1em' }}>{STRAT_LABEL[t].toUpperCase()}</span>
                  <span style={{ fontSize: 10, color: '#5D6580' }}>{byType[t].length}</span>
                  <div style={{ flex: 1, height: 1, background: '#1E2540' }} />
                  <span style={{ fontSize: 11, fontFamily: 'IBM Plex Mono, monospace', color: pnlColor(byType[t].reduce((s, st) => s + st.unrealizedPnL, 0)), fontWeight: 600 }}>
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
                  <span style={{ fontSize: 10, fontWeight: 700, color: STRAT_COLOR[t], letterSpacing: '0.1em' }}>{STRAT_LABEL[t].toUpperCase()}</span>
                  <span style={{ fontSize: 10, color: '#5D6580' }}>{byType[t].length}</span>
                  <div style={{ flex: 1, height: 1, background: '#1E2540' }} />
                  <span style={{ fontSize: 11, fontFamily: 'IBM Plex Mono, monospace', color: pnlColor(byType[t].reduce((s, st) => s + st.unrealizedPnL, 0)), fontWeight: 600 }}>
                    {fmt$(byType[t].reduce((s, st) => s + st.unrealizedPnL, 0))}
                  </span>
                </div>
                {byType[t].map(s => <StrategyCard key={s.id} s={s} />)}
              </div>
            ))}
            {col2Types.length === 0 && (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#2A3250', fontSize: 12 }}>
                No additional strategy types
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
