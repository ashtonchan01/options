import type { AppState, Strategy, StrategyType } from '../../types'
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
    filter: (t: import('../../types').RawTrade) => /^SPX|^SPXW/.test(t.underlyingSymbol ?? t.symbol),
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
  covered_call:  'CC',
  pmcc:          'PMCC',
  risk_reversal: 'RR',
  put_spread:    'PUT SPD',
  call_spread:   'CALL SPD',
  leap:          'LEAP',
  other:         'OTHER',
}

const TYPE_ORDER: StrategyType[] = [
  'covered_call', 'pmcc', 'csp', 'risk_reversal',
  'put_spread', 'call_spread', 'leap', 'other',
]

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt$(n: number, d = 0) {
  return (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
}

function fmtExpiry(s: string) {
  const m = s.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (!m) return s
  return `${parseInt(m[3])} ${MONTHS[parseInt(m[2]) - 1]} '${m[1].slice(2)}`
}

function pnlColor(n: number) { return n > 0 ? '#34c98a' : n < 0 ? '#e05070' : 'var(--text-4)' }

function statusOf(s: Strategy): { label: string; color: string } {
  const premium = Math.abs(s.netPremiumReceived)
  const pnl = s.unrealizedPnL
  const minDte = s.legs.length ? Math.min(...s.legs.map(l => l.dte)) : Infinity
  if (pnl < 0 && premium > 0 && Math.abs(pnl) > premium * 0.5)
    return { label: 'URGENT', color: '#e05070' }
  if (minDte <= 21 || (premium > 0 && pnl / premium >= 0.5))
    return { label: 'MANAGE', color: '#d4a843' }
  return { label: 'OK', color: '#34c98a' }
}

function profitPct(s: Strategy): number | null {
  if (!s.netPremiumReceived || s.netPremiumReceived <= 0) return null
  return Math.min(Math.max(s.unrealizedPnL / s.netPremiumReceived, -1), 1)
}

/** Short legs formatted as "$340P 21Jun25 ×1" */
function legLine(s: Strategy): string {
  const shorts = s.legs.filter(l => l.quantity < 0)
  if (!shorts.length) return '—'
  return shorts.map(l => `$${l.strike}${l.putCall} ${fmtExpiry(l.expiry)}`).join('  ·  ')
}

// ─── Strategy row ─────────────────────────────────────────────────────────────

function StratRow({ s, isLast }: { s: Strategy; isLast: boolean }) {
  const color  = STRAT_COLOR[s.type]
  const status = statusOf(s)
  const pct    = profitPct(s)
  const minDte = s.legs.length ? Math.min(...s.legs.map(l => l.dte)) : null
  const dteColor = minDte === null ? 'var(--text-4)'
    : minDte <= 7  ? '#e05070'
    : minDte <= 21 ? '#d4a843'
    : 'var(--text-3)'

  return (
    <tr style={{ borderBottom: isLast ? 'none' : '1px solid var(--border)' }}>
      {/* Ticker */}
      <td style={{ padding: '9px 14px', whiteSpace: 'nowrap' }}>
        <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontWeight: 700, fontSize: 13, color: 'var(--text-1)' }}>
          {s.underlying}
        </span>
        {s.shares && (
          <span style={{ fontSize: 10, color: 'var(--text-4)', marginLeft: 6 }}>
            {s.shares.quantity}sh
          </span>
        )}
      </td>

      {/* Type badge */}
      <td style={{ padding: '9px 8px', whiteSpace: 'nowrap' }}>
        <span style={{
          fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
          color, background: `${color}18`, border: `1px solid ${color}35`,
          borderRadius: 3, padding: '2px 6px',
        }}>
          {STRAT_LABEL[s.type]}
        </span>
      </td>

      {/* Status */}
      <td style={{ padding: '9px 8px', whiteSpace: 'nowrap' }}>
        <span style={{
          fontSize: 10, fontWeight: 700, letterSpacing: '0.05em',
          color: status.color, background: `${status.color}12`,
          border: `1px solid ${status.color}30`,
          borderRadius: 3, padding: '2px 6px',
        }}>
          {status.label}
        </span>
      </td>

      {/* Short legs */}
      <td style={{ padding: '9px 8px' }}>
        <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 12, color: 'var(--text-2)' }}>
          {legLine(s)}
        </span>
      </td>

      {/* DTE */}
      <td style={{ padding: '9px 8px', textAlign: 'right', whiteSpace: 'nowrap' }}>
        {minDte !== null && (
          <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 12, fontWeight: 600, color: dteColor }}>
            {minDte}d
          </span>
        )}
      </td>

      {/* Premium */}
      <td style={{ padding: '9px 8px', textAlign: 'right', whiteSpace: 'nowrap' }}>
        {s.netPremiumReceived > 0 && (
          <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 12, color: 'var(--text-3)' }}>
            {fmt$(s.netPremiumReceived)}
          </span>
        )}
      </td>

      {/* P&L */}
      <td style={{ padding: '9px 14px', textAlign: 'right', whiteSpace: 'nowrap' }}>
        <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 13, fontWeight: 600, color: pnlColor(s.unrealizedPnL) }}>
          {fmt$(s.unrealizedPnL)}
        </span>
      </td>

      {/* % captured */}
      <td style={{ padding: '9px 14px', width: 80 }}>
        {pct !== null && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ flex: 1, height: 3, background: 'var(--border)', borderRadius: 2, overflow: 'hidden', minWidth: 40 }}>
              <div style={{
                height: '100%', width: `${Math.abs(pct) * 100}%`,
                background: pct >= 0 ? (pct >= 0.5 ? '#34c98a' : '#38bcd4') : '#e05070',
                borderRadius: 2,
              }} />
            </div>
            <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 10, color: pct >= 0 ? '#34c98a' : '#e05070', minWidth: 28, textAlign: 'right' }}>
              {(Math.abs(pct) * 100).toFixed(0)}%
            </span>
          </div>
        )}
      </td>
    </tr>
  )
}

// ─── Main ────────────────────────────────────────────────────────────────────

export default function StrategiesView({ state, stratPage = 'overview', tradeLabels }: Props) {
  const labels = tradeLabels?.labels ?? {}

  function labelFilter(page: string) {
    return (t: import('../../types').RawTrade) => labels[tradeId(t)] === page
  }

  if (stratPage === 'label_trades' && tradeLabels) return <TradeLabellerView state={state} {...tradeLabels} />
  if (stratPage === 'covered_calls') return <CoveredCallsView state={state} labelFilter={labelFilter('covered_calls')} hasLabels={Object.keys(labels).length > 0} />
  if (stratPage !== 'overview') {
    const base = STRAT_CONFIGS[stratPage as keyof typeof STRAT_CONFIGS]
    if (base) {
      const cfg = {
        ...base,
        filter: Object.keys(labels).length > 0 ? labelFilter(stratPage) : base.filter,
        description: Object.keys(labels).length > 0 ? `Trade log — labelled as ${base.label}` : base.description + ' (auto-detected)',
      }
      return <StrategyTradeLog state={state} config={cfg} />
    }
  }

  const { strategies } = state

  // ── No data: raw position debug table ───────────────────────────────────────
  if (!strategies.length) {
    return (
      <div style={{ padding: '20px 24px' }}>
        <div style={{ color: '#d4a843', fontWeight: 600, marginBottom: 12, fontSize: 13 }}>
          No strategies classified — raw positions:
        </div>
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontFamily: 'IBM Plex Mono, monospace' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)' }}>
                {['SYMBOL','CLASS','P/C','STRIKE','EXPIRY','UNDERLYING','QTY','VALUE'].map(h => (
                  <th key={h} style={{ padding: '8px 12px', textAlign: 'left', color: 'var(--text-4)', fontWeight: 700, letterSpacing: '0.06em', fontSize: 10 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {state.sync.positions.map((p, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '7px 12px', color: 'var(--text-1)' }}>{p.symbol}</td>
                  <td style={{ padding: '7px 12px', color: p.assetClass === 'OPT' ? '#10b981' : '#3b82f6' }}>{p.assetClass}</td>
                  <td style={{ padding: '7px 12px' }}>{p.putCall ?? '—'}</td>
                  <td style={{ padding: '7px 12px' }}>{p.strike ?? '—'}</td>
                  <td style={{ padding: '7px 12px' }}>{p.expiry ?? '—'}</td>
                  <td style={{ padding: '7px 12px', color: 'var(--text-2)' }}>{p.underlyingSymbol ?? '—'}</td>
                  <td style={{ padding: '7px 12px' }}>{p.quantity}</td>
                  <td style={{ padding: '7px 12px', color: pnlColor(p.positionValue) }}>{p.positionValue.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  const byType = TYPE_ORDER.reduce<Record<StrategyType, Strategy[]>>((acc, t) => {
    acc[t] = strategies.filter(s => s.type === t)
    return acc
  }, {} as Record<StrategyType, Strategy[]>)

  const activeTypes = TYPE_ORDER.filter(t => byType[t].length > 0)

  const totalPnL     = strategies.reduce((s, st) => s + st.unrealizedPnL, 0)
  const totalPremium = strategies.reduce((s, st) => s + st.netPremiumReceived, 0)
  const urgent       = strategies.filter(s => statusOf(s).label === 'URGENT').length
  const manage       = strategies.filter(s => statusOf(s).label === 'MANAGE').length

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* ── Summary strip ── */}
      <div style={{
        display: 'flex', gap: 0, flexShrink: 0,
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg-surface)',
      }}>
        {[
          { label: 'POSITIONS',     value: String(strategies.length), color: 'var(--text-1)' },
          { label: 'PREMIUM',       value: fmt$(totalPremium),        color: 'var(--text-1)' },
          { label: 'UNREALIZED P&L',value: fmt$(totalPnL),            color: pnlColor(totalPnL) },
          { label: 'MANAGE',        value: String(manage),            color: manage > 0 ? '#d4a843' : 'var(--text-4)' },
          { label: 'URGENT',        value: String(urgent),            color: urgent > 0 ? '#e05070' : 'var(--text-4)' },
        ].map(({ label, value, color }, i, arr) => (
          <div key={label} style={{
            flex: 1, padding: '10px 16px',
            borderRight: i < arr.length - 1 ? '1px solid var(--border)' : 'none',
          }}>
            <div style={{ fontSize: 10, color: 'var(--text-4)', letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: 3 }}>
              {label}
            </div>
            <div style={{ fontFamily: 'Chakra Petch, sans-serif', fontSize: 16, fontWeight: 700, color }}>
              {value}
            </div>
          </div>
        ))}
      </div>

      {/* ── Strategy table ── */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, zIndex: 1 }}>
              <th style={TH}>TICKER</th>
              <th style={TH}>TYPE</th>
              <th style={TH}>STATUS</th>
              <th style={TH}>LEGS</th>
              <th style={{ ...TH, textAlign: 'right' }}>DTE</th>
              <th style={{ ...TH, textAlign: 'right' }}>PREMIUM</th>
              <th style={{ ...TH, textAlign: 'right' }}>P&L</th>
              <th style={{ ...TH, textAlign: 'right' }}>CAPTURED</th>
            </tr>
          </thead>
          <tbody>
            {activeTypes.map(type => {
              const items = byType[type]
              const color = STRAT_COLOR[type]
              const groupPnl = items.reduce((s, st) => s + st.unrealizedPnL, 0)
              return (
                <>
                  {/* Group header row */}
                  <tr key={`hdr-${type}`} style={{ background: 'var(--bg-elevated)', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}>
                    <td colSpan={6} style={{ padding: '5px 14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
                        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color }}>
                          {STRAT_LABEL[type]}
                        </span>
                        <span style={{
                          fontSize: 10, fontFamily: 'IBM Plex Mono, monospace', fontWeight: 700,
                          color, background: `${color}18`, border: `1px solid ${color}30`,
                          borderRadius: 3, padding: '0px 5px',
                        }}>
                          {items.length}
                        </span>
                      </div>
                    </td>
                    <td colSpan={2} style={{ padding: '5px 14px', textAlign: 'right' }}>
                      <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 12, fontWeight: 600, color: pnlColor(groupPnl) }}>
                        {fmt$(groupPnl)}
                      </span>
                    </td>
                  </tr>
                  {/* Strategy rows */}
                  {items.map((s, i) => (
                    <StratRow key={s.id} s={s} isLast={i === items.length - 1} />
                  ))}
                </>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const TH: React.CSSProperties = {
  padding: '7px 8px 7px 14px',
  textAlign: 'left',
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '1.5px',
  textTransform: 'uppercase',
  color: 'var(--text-4)',
  fontFamily: 'Inter, sans-serif',
  whiteSpace: 'nowrap',
}
