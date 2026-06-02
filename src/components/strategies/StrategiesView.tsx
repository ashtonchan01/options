import type { AppState, Strategy, StrategyType, OptionLeg } from '../../types'
import type { StrategyPage, TradeLabels } from '../../App'
import CoveredCallsView from './CoveredCallsView'
import StrategyTradeLog from './StrategyTradeLog'
import TradeLabellerView from './TradeLabellerView'
import { tradeId } from '../../store/tradeLabelsStore'

interface Props { state: AppState; stratPage?: StrategyPage; tradeLabels?: TradeLabels }

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
    filter: (t: import('../../types').RawTrade) => t.assetClass === 'OPT',
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
  pmcc:          '#818cf8',
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
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${parseInt(m[3])} ${months[parseInt(m[2]) - 1]} '${m[1].slice(2)}`
}

function pnlColor(n: number) { return n > 0 ? '#10b981' : n < 0 ? '#f43f5e' : 'var(--text-4)' }

function statusOf(s: Strategy): { label: string; color: string } {
  const maxPremium = Math.abs(s.netPremiumReceived)
  const profit = s.unrealizedPnL
  const minDte = s.legs.length ? Math.min(...s.legs.map(l => l.dte)) : Infinity
  if (profit < 0 && maxPremium > 0 && Math.abs(profit) > maxPremium * 0.5)
    return { label: 'URGENT', color: '#f43f5e' }
  if (minDte <= 21 || (maxPremium > 0 && profit / maxPremium >= 0.5))
    return { label: 'MANAGE', color: '#f59e0b' }
  return { label: 'ON TRACK', color: '#10b981' }
}

function profitPct(s: Strategy): number | null {
  if (!s.netPremiumReceived || s.netPremiumReceived <= 0) return null
  return Math.min(Math.max(s.unrealizedPnL / s.netPremiumReceived, -1), 1)
}

// ─── Leg pill ─────────────────────────────────────────────────────────────────

function LegPill({ leg }: { leg: OptionLeg }) {
  const isShort = leg.quantity < 0
  const isCall  = leg.putCall === 'C'
  const color   = isCall ? '#3b82f6' : '#f43f5e'
  const dteColor = leg.dte <= 7 ? '#f43f5e' : leg.dte <= 21 ? '#f59e0b' : 'var(--text-3)'

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      background: 'var(--bg-surface)',
      border: `1px solid ${color}28`,
      borderLeft: `2px solid ${color}`,
      borderRadius: 6,
      padding: '7px 12px',
      fontSize: 13,
    }}>
      {/* Side + type */}
      <span style={{
        fontSize: 10, fontWeight: 700, letterSpacing: '0.07em',
        color, background: `${color}18`,
        border: `1px solid ${color}40`,
        borderRadius: 4, padding: '2px 6px',
        flexShrink: 0,
      }}>
        {isShort ? '↓ SHORT' : '↑ LONG'} {isCall ? 'CALL' : 'PUT'}
      </span>

      {/* Strike */}
      <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontWeight: 700, color: 'var(--text-1)', fontSize: 14 }}>
        ${leg.strike.toLocaleString()}
      </span>

      {/* Expiry */}
      <span style={{ fontFamily: 'IBM Plex Mono, monospace', color: 'var(--text-3)', fontSize: 12 }}>
        {fmtExpiry(leg.expiry)}
      </span>

      {/* DTE */}
      <span style={{
        fontFamily: 'IBM Plex Mono, monospace', fontSize: 12,
        fontWeight: 600, color: dteColor,
        background: `${dteColor}14`, border: `1px solid ${dteColor}30`,
        borderRadius: 4, padding: '1px 6px',
      }}>
        {leg.dte}d
      </span>

      {/* Qty */}
      <span style={{ fontFamily: 'IBM Plex Mono, monospace', color: 'var(--text-4)', fontSize: 12 }}>
        ×{Math.abs(leg.quantity)}
      </span>

      <div style={{ flex: 1 }} />

      {/* Leg P&L */}
      <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 13, fontWeight: 600, color: pnlColor(leg.unrealizedPnL) }}>
        {fmt$(leg.unrealizedPnL)}
      </span>
    </div>
  )
}

// ─── Strategy card ────────────────────────────────────────────────────────────

function StrategyCard({ s }: { s: Strategy }) {
  const color  = STRAT_COLOR[s.type]
  const status = statusOf(s)
  const pct    = profitPct(s)
  const minDte = s.legs.length ? Math.min(...s.legs.map(l => l.dte)) : null

  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border)',
      borderRadius: 10,
      borderLeft: `3px solid ${color}`,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>

      {/* ── Header row ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '12px 16px',
        borderBottom: '1px solid var(--border)',
        flexWrap: 'wrap',
      }}>
        <span style={{
          fontSize: 17, fontWeight: 800,
          fontFamily: 'IBM Plex Mono, monospace',
          color: 'var(--text-1)',
        }}>
          {s.underlying}
        </span>

        <span style={{
          fontSize: 11, fontWeight: 700, letterSpacing: '0.07em',
          color, background: `${color}18`,
          border: `1px solid ${color}40`, borderRadius: 4,
          padding: '2px 8px',
        }}>
          {STRAT_LABEL[s.type]}
        </span>

        <span style={{
          fontSize: 11, fontWeight: 700, letterSpacing: '0.06em',
          color: status.color, background: `${status.color}12`,
          border: `1px solid ${status.color}40`, borderRadius: 20,
          padding: '2px 8px',
        }}>
          {status.label}
        </span>

        {minDte !== null && (
          <span style={{
            fontSize: 11, fontFamily: 'IBM Plex Mono, monospace', fontWeight: 600,
            color: minDte <= 7 ? '#f43f5e' : minDte <= 21 ? '#f59e0b' : 'var(--text-4)',
          }}>
            {minDte}d
          </span>
        )}

        <div style={{ flex: 1 }} />

        {/* Premium + P&L */}
        <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
          {s.netPremiumReceived > 0 && (
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 10, color: 'var(--text-4)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Premium</div>
              <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 14, fontWeight: 600, color: 'var(--text-2)' }}>
                {fmt$(s.netPremiumReceived)}
              </div>
            </div>
          )}
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 10, color: 'var(--text-4)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Unr. P&L</div>
            <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 16, fontWeight: 700, color: pnlColor(s.unrealizedPnL) }}>
              {fmt$(s.unrealizedPnL)}
            </div>
          </div>
        </div>
      </div>

      {/* ── Stock row ── */}
      {s.shares && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '8px 16px',
          background: 'var(--bg-elevated)',
          borderBottom: '1px solid var(--border)',
          fontSize: 13,
        }}>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', color: '#3b82f6', background: '#3b82f618', border: '1px solid #3b82f640', borderRadius: 4, padding: '2px 6px' }}>
            STOCK
          </span>
          <span style={{ fontFamily: 'IBM Plex Mono, monospace', color: 'var(--text-2)', fontWeight: 600 }}>
            {s.shares.quantity} shares
          </span>
          <span style={{ color: 'var(--text-4)', fontSize: 12 }}>
            avg <span style={{ color: 'var(--text-3)', fontFamily: 'IBM Plex Mono, monospace' }}>{fmt$(s.shares.avgCost, 2)}</span>
          </span>
          <div style={{ flex: 1 }} />
          <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontWeight: 600, color: pnlColor(s.shares.unrealizedPnL) }}>
            {fmt$(s.shares.unrealizedPnL)}
          </span>
        </div>
      )}

      {/* ── Legs ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 14px' }}>
        {s.legs.map((leg, i) => <LegPill key={i} leg={leg} />)}
      </div>

      {/* ── Profit bar ── */}
      {pct !== null && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '8px 16px 12px',
        }}>
          <span style={{ fontSize: 11, color: 'var(--text-4)', letterSpacing: '0.06em', textTransform: 'uppercase', minWidth: 70 }}>
            {pct >= 0 ? 'Profit' : 'Loss'}
          </span>
          <div style={{ flex: 1, height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{
              height: '100%', width: `${Math.abs(pct) * 100}%`,
              background: pct >= 0 ? (pct >= 0.5 ? '#10b981' : '#3b82f6') : '#f43f5e',
              borderRadius: 2, transition: 'width 0.3s ease',
            }} />
          </div>
          <span style={{
            fontFamily: 'IBM Plex Mono, monospace', fontSize: 13, fontWeight: 700,
            color: pct >= 0 ? '#10b981' : '#f43f5e',
            minWidth: 38, textAlign: 'right',
          }}>
            {(Math.abs(pct) * 100).toFixed(0)}%
          </span>
        </div>
      )}
    </div>
  )
}

// ─── Section divider ──────────────────────────────────────────────────────────

function SectionHeader({ type, count, pnl }: { type: StrategyType; count: number; pnl: number }) {
  const color = STRAT_COLOR[type]
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0' }}>
      <div style={{ width: 10, height: 10, borderRadius: '50%', background: color, flexShrink: 0 }} />
      <span style={{ fontSize: 13, fontWeight: 700, color, letterSpacing: '0.07em', textTransform: 'uppercase' }}>
        {STRAT_LABEL[type]}
      </span>
      <span style={{
        fontSize: 12, fontWeight: 700, fontFamily: 'IBM Plex Mono, monospace',
        color, background: `${color}18`, border: `1px solid ${color}40`,
        borderRadius: 4, padding: '1px 7px',
      }}>
        {count}
      </span>
      <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
      <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 13, fontWeight: 600, color: pnlColor(pnl) }}>
        {fmt$(pnl)}
      </span>
    </div>
  )
}

// ─── Summary bar ─────────────────────────────────────────────────────────────

function SummaryBar({ strategies }: { strategies: Strategy[] }) {
  const totalPnL     = strategies.reduce((s, st) => s + st.unrealizedPnL, 0)
  const totalPremium = strategies.reduce((s, st) => s + st.netPremiumReceived, 0)
  const urgent       = strategies.filter(s => statusOf(s).label === 'URGENT').length
  const manage       = strategies.filter(s => statusOf(s).label === 'MANAGE').length

  const stats = [
    { label: 'Positions', value: String(strategies.length), color: 'var(--text-1)' },
    { label: 'Total Premium', value: fmt$(totalPremium), color: 'var(--text-1)' },
    { label: 'Unrealized P&L', value: fmt$(totalPnL), color: pnlColor(totalPnL) },
    { label: 'Manage', value: String(manage), color: manage > 0 ? '#f59e0b' : 'var(--text-4)' },
    { label: 'Urgent', value: String(urgent), color: urgent > 0 ? '#f43f5e' : 'var(--text-4)' },
  ]

  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', flexShrink: 0 }}>
      {stats.map(({ label, value, color }) => (
        <div key={label} style={{
          display: 'flex', flexDirection: 'column', gap: 2,
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          borderRadius: 8, padding: '8px 14px', flex: '1 1 80px', minWidth: 80,
        }}>
          <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-4)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            {label}
          </span>
          <span style={{ fontSize: 18, fontWeight: 700, fontFamily: 'IBM Plex Mono, monospace', color }}>
            {value}
          </span>
        </div>
      ))}
    </div>
  )
}

// ─── Main ────────────────────────────────────────────────────────────────────

export default function StrategiesView({ state, stratPage = 'overview', tradeLabels }: Props) {
  const labels = tradeLabels?.labels ?? {}

  function labelFilter(page: string) {
    return (t: import('../../types').RawTrade) => labels[tradeId(t)] === page
  }

  if (stratPage === 'label_trades' && tradeLabels) {
    return <TradeLabellerView state={state} {...tradeLabels} />
  }
  if (stratPage === 'covered_calls') {
    return <CoveredCallsView state={state} labelFilter={labelFilter('covered_calls')} hasLabels={Object.keys(labels).length > 0} />
  }
  if (stratPage !== 'overview') {
    const base = STRAT_CONFIGS[stratPage as keyof typeof STRAT_CONFIGS]
    if (base) {
      const cfg = {
        ...base,
        filter: Object.keys(labels).length > 0 ? labelFilter(stratPage) : base.filter,
        description: Object.keys(labels).length > 0
          ? `Trade log — labelled as ${base.label}`
          : base.description + ' (auto-detected — label trades for accuracy)',
      }
      return <StrategyTradeLog state={state} config={cfg} />
    }
  }

  const { strategies } = state

  // ── No data: show raw positions debug table ──────────────────────────────
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
                  <td style={{ padding: '9px 14px' }}>{p.putCall ?? '—'}</td>
                  <td style={{ padding: '9px 14px' }}>{p.strike ?? '—'}</td>
                  <td style={{ padding: '9px 14px' }}>{p.expiry ?? '—'}</td>
                  <td style={{ padding: '9px 14px', color: 'var(--text-2)' }}>{p.underlyingSymbol ?? '—'}</td>
                  <td style={{ padding: '9px 14px' }}>{p.quantity}</td>
                  <td style={{ padding: '9px 14px', color: pnlColor(p.positionValue) }}>{p.positionValue.toLocaleString()}</td>
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

  const activeTypes = TYPE_ORDER.filter(t => byType[t].length > 0)

  return (
    <div style={{
      padding: '16px 20px',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      gap: 14,
      overflow: 'hidden',
    }}>

      {/* ── Summary bar ── */}
      <SummaryBar strategies={strategies} />

      {/* ── Scrollable strategy list ── */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 20, paddingBottom: 8 }}>
        {activeTypes.map(t => {
          const items = byType[t]
          const groupPnl = items.reduce((s, st) => s + st.unrealizedPnL, 0)
          return (
            <div key={t} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <SectionHeader type={t} count={items.length} pnl={groupPnl} />
              {items.map(s => <StrategyCard key={s.id} s={s} />)}
            </div>
          )
        })}
      </div>
    </div>
  )
}
