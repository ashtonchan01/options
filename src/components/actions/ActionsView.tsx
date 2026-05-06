import type { AppState, Action, UrgencyLevel, StrategyType } from '../../types'
import EmptyState from '../shared/EmptyState'

interface Props { state: AppState }

// ─── Constants ───────────────────────────────────────────────────────────────

const URGENCY_CONFIG: Record<UrgencyLevel, { label: string; color: string; bg: string }> = {
  urgent:      { label: 'URGENT',      color: '#f43f5e', bg: '#f43f5e14' },
  manage:      { label: 'MANAGE',      color: '#f59e0b', bg: '#f59e0b14' },
  opportunity: { label: 'OPPORTUNITY', color: '#10b981', bg: '#10b98114' },
  watch:       { label: 'WATCH',       color: '#555',    bg: '#55555514' },
}

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
  other:         '#444',
}

const URGENCY_ORDER: UrgencyLevel[] = ['urgent', 'manage', 'opportunity', 'watch']

// ─── Action card ─────────────────────────────────────────────────────────────

function ActionCard({ a }: { a: Action }) {
  const urgency = URGENCY_CONFIG[a.urgency]
  const aColor  = ACTION_COLOR[a.actionType]
  const sColor  = STRAT_COLOR[a.strategyType]

  return (
    <div style={{
      background: '#0d0d0d',
      border: '1px solid #1a1a1a',
      borderLeft: `3px solid ${urgency.color}`,
      padding: '14px 16px',
      display: 'flex',
      gap: 14,
    }}>
      {/* Left: ticker + badges */}
      <div style={{ flexShrink: 0, minWidth: 110 }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: '#e8e8e8', fontFamily: 'IBM Plex Mono, monospace', marginBottom: 6 }}>
          {a.underlying}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{
            padding: '2px 7px', fontSize: 9, fontWeight: 700, letterSpacing: '0.08em',
            color: sColor, background: `${sColor}14`, border: `1px solid ${sColor}30`,
            width: 'fit-content',
          }}>
            {STRAT_LABEL[a.strategyType]}
          </span>
          <span style={{
            padding: '2px 7px', fontSize: 9, fontWeight: 700, letterSpacing: '0.08em',
            color: aColor, background: `${aColor}14`, border: `1px solid ${aColor}30`,
            width: 'fit-content',
          }}>
            {ACTION_LABEL[a.actionType]}
          </span>
        </div>
      </div>

      {/* Right: reason + details */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#ccc', marginBottom: 4, lineHeight: 1.4 }}>
          {a.reason}
        </div>
        <div style={{ fontSize: 12, color: '#444', lineHeight: 1.5 }}>
          {a.details}
        </div>
        {(a.suggestedStrike || a.suggestedExpiry || a.estimatedCredit) && (
          <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
            {a.suggestedStrike && (
              <span style={{ fontSize: 11, fontFamily: 'IBM Plex Mono, monospace', color: '#555' }}>
                strike <span style={{ color: '#888' }}>${a.suggestedStrike}</span>
              </span>
            )}
            {a.suggestedDelta && (
              <span style={{ fontSize: 11, fontFamily: 'IBM Plex Mono, monospace', color: '#555' }}>
                delta <span style={{ color: '#888' }}>{a.suggestedDelta.toFixed(2)}</span>
              </span>
            )}
            {a.suggestedExpiry && (
              <span style={{ fontSize: 11, fontFamily: 'IBM Plex Mono, monospace', color: '#555' }}>
                expiry <span style={{ color: '#888' }}>{a.suggestedExpiry}</span>
              </span>
            )}
            {a.estimatedCredit && (
              <span style={{ fontSize: 11, fontFamily: 'IBM Plex Mono, monospace', color: '#10b981' }}>
                est. credit ${a.estimatedCredit.toFixed(2)}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Urgency group ────────────────────────────────────────────────────────────

function UrgencyGroup({ urgency, actions }: { urgency: UrgencyLevel; actions: Action[] }) {
  const cfg = URGENCY_CONFIG[urgency]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Section header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: cfg.color, letterSpacing: '0.1em' }}>
          {cfg.label}
        </span>
        <span style={{
          fontSize: 10, fontWeight: 700, fontFamily: 'IBM Plex Mono, monospace',
          color: cfg.color, background: cfg.bg,
          border: `1px solid ${cfg.color}33`,
          padding: '1px 6px',
        }}>
          {actions.length}
        </span>
        <div style={{ flex: 1, height: 1, background: '#111' }} />
      </div>
      {actions.map(a => <ActionCard key={a.id} a={a} />)}
    </div>
  )
}

// ─── Main view ────────────────────────────────────────────────────────────────

export default function ActionsView({ state }: Props) {
  const { actions } = state

  if (!state.strategies.length) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <EmptyState title="No actions" message="Sync your IBKR portfolio to generate trade recommendations." showUpload />
      </div>
    )
  }

  const byUrgency = URGENCY_ORDER.reduce<Record<UrgencyLevel, Action[]>>((acc, u) => {
    acc[u] = actions.filter(a => a.urgency === u)
    return acc
  }, {} as Record<UrgencyLevel, Action[]>)

  const urgent      = byUrgency.urgent.length
  const manage      = byUrgency.manage.length
  const opportunity = byUrgency.opportunity.length
  const watch       = byUrgency.watch.length

  return (
    <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* ── Summary ──────────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
        {[
          { label: 'URGENT',      value: urgent,      color: urgent > 0      ? '#f43f5e' : '#333' },
          { label: 'MANAGE',      value: manage,      color: manage > 0      ? '#f59e0b' : '#333' },
          { label: 'OPPORTUNITY', value: opportunity, color: opportunity > 0 ? '#10b981' : '#333' },
          { label: 'WATCH',       value: watch,       color: watch > 0       ? '#555'    : '#222' },
        ].map(({ label, value, color }) => (
          <div key={label} className="stat-card">
            <div className="stat-label">{label}</div>
            <div className="stat-value" style={{ color, fontSize: 32 }}>{value}</div>
          </div>
        ))}
      </div>

      {/* ── No actions ───────────────────────────────────────────────────── */}
      {actions.length === 0 && (
        <div style={{ color: '#2a2a2a', fontSize: 13, paddingTop: 40, textAlign: 'center' }}>
          All positions are within normal parameters. Nothing to action right now.
        </div>
      )}

      {/* ── Groups ───────────────────────────────────────────────────────── */}
      {URGENCY_ORDER
        .filter(u => byUrgency[u].length > 0)
        .map(u => <UrgencyGroup key={u} urgency={u} actions={byUrgency[u]} />)
      }
    </div>
  )
}
