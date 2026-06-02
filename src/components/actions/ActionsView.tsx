import type { AppState, Action, UrgencyLevel, StrategyType } from '../../types'
import EmptyState from '../shared/EmptyState'

interface Props { state: AppState }

// ─── Constants ───────────────────────────────────────────────────────────────

const URGENCY_CONFIG: Record<UrgencyLevel, { label: string; color: string; bg: string }> = {
  urgent:      { label: 'URGENT',      color: '#f43f5e', bg: '#f43f5e14' },
  manage:      { label: 'MANAGE',      color: '#f59e0b', bg: '#f59e0b14' },
  opportunity: { label: 'OPPORTUNITY', color: '#10b981', bg: '#10b98114' },
  watch:       { label: 'WATCH',       color: 'var(--text-3)', bg: '#5D658014' },
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
  other:         '#64748b',
}

const URGENCY_ORDER: UrgencyLevel[] = ['urgent', 'manage', 'opportunity', 'watch']

// ─── Tile styles ─────────────────────────────────────────────────────────────

const tile: React.CSSProperties = {
  background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10,
  overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0,
}

// ─── Action card ─────────────────────────────────────────────────────────────

function ActionCard({ a }: { a: Action }) {
  const urgency = URGENCY_CONFIG[a.urgency]
  const aColor  = ACTION_COLOR[a.actionType]
  const sColor  = STRAT_COLOR[a.strategyType]

  return (
    <div style={{
      background: 'var(--bg-elevated)',
      border: '1px solid var(--border)',
      borderLeft: `3px solid ${urgency.color}`,
      padding: '12px 14px',
      display: 'flex',
      gap: 10,
    }}>
      {/* Left: ticker + badges */}
      <div style={{ flexShrink: 0, minWidth: 80 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-1)', fontFamily: 'IBM Plex Mono, monospace', marginBottom: 4 }}>
          {a.underlying}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={{
            padding: '2px 6px', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
            color: sColor, background: `${sColor}14`, border: `1px solid ${sColor}30`,
            width: 'fit-content',
          }}>
            {STRAT_LABEL[a.strategyType]}
          </span>
          <span style={{
            padding: '2px 6px', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
            color: aColor, background: `${aColor}14`, border: `1px solid ${aColor}30`,
            width: 'fit-content',
          }}>
            {ACTION_LABEL[a.actionType]}
          </span>
        </div>
      </div>

      {/* Right: position ID + reason + details */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Position identifier — tells you exactly which position this is */}
        {a.legSummary && (
          <div style={{
            fontSize: 11, fontFamily: 'IBM Plex Mono, monospace',
            color: urgency.color, background: urgency.bg,
            border: `1px solid ${urgency.color}33`,
            padding: '2px 6px', marginBottom: 5, display: 'inline-block',
            letterSpacing: '0.04em', fontWeight: 600,
          }}>
            {a.legSummary}
          </div>
        )}
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)', marginBottom: 2, lineHeight: 1.4 }}>
          {a.reason}
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.4 }}>
          {a.details}
        </div>
        {(a.suggestedStrike || a.suggestedExpiry || a.estimatedCredit) && (
          <div style={{ display: 'flex', gap: 12, marginTop: 6, flexWrap: 'wrap' }}>
            {a.suggestedStrike && (
              <span style={{ fontSize: 12, fontFamily: 'IBM Plex Mono, monospace', color: 'var(--text-3)' }}>
                strike <span style={{ color: 'var(--text-2)' }}>${a.suggestedStrike}</span>
              </span>
            )}
            {a.suggestedDelta && (
              <span style={{ fontSize: 12, fontFamily: 'IBM Plex Mono, monospace', color: 'var(--text-3)' }}>
                delta <span style={{ color: 'var(--text-2)' }}>{a.suggestedDelta.toFixed(2)}</span>
              </span>
            )}
            {a.suggestedExpiry && (
              <span style={{ fontSize: 12, fontFamily: 'IBM Plex Mono, monospace', color: 'var(--text-3)' }}>
                exp <span style={{ color: 'var(--text-2)' }}>{a.suggestedExpiry}</span>
              </span>
            )}
            {a.estimatedCredit && (
              <span style={{ fontSize: 12, fontFamily: 'IBM Plex Mono, monospace', color: '#10b981' }}>
                est. ${a.estimatedCredit.toFixed(2)}
              </span>
            )}
          </div>
        )}
      </div>
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
    <div style={{ padding: 20, height: '100%', display: 'flex', flexDirection: 'column', gap: 14, overflow: 'hidden' }}>

      {/* ── Stats row ──────────────────────────────────────────────────── */}
      <div className="actions-stats" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, flexShrink: 0 }}>
        {[
          { label: 'URGENT',      value: urgent,      color: urgent > 0      ? '#f43f5e' : 'var(--text-5)' },
          { label: 'MANAGE',      value: manage,      color: manage > 0      ? '#f59e0b' : 'var(--text-5)' },
          { label: 'OPPORTUNITY', value: opportunity, color: opportunity > 0 ? '#10b981' : 'var(--text-5)' },
          { label: 'WATCH',       value: watch,       color: watch > 0       ? 'var(--text-3)' : 'var(--border)' },
        ].map(({ label, value, color }) => (
          <div key={label} className="stat-card">
            <div className="stat-label">{label}</div>
            <div className="stat-value" style={{ color, fontSize: 34 }}>{value}</div>
          </div>
        ))}
      </div>

      {/* ── No actions ─────────────────────────────────────────────────── */}
      {actions.length === 0 && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)', fontSize: 15 }}>
          All positions are within normal parameters. Nothing to action right now.
        </div>
      )}

      {/* ── 2×2 urgency grid ───────────────────────────────────────────── */}
      {actions.length > 0 && (
        <div className="actions-grid" style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr', gap: 12, minHeight: 0 }}>
          {URGENCY_ORDER.map(u => {
            const cfg = URGENCY_CONFIG[u]
            const items = byUrgency[u]
            return (
              <div key={u} style={{ ...tile, borderTop: `2px solid ${items.length > 0 ? cfg.color : 'var(--border)'}`, opacity: items.length > 0 ? 1 : 0.5 }}>
                <div style={{
                  padding: '10px 16px', borderBottom: '1px solid var(--border)',
                  fontSize: 13, fontWeight: 700, color: cfg.color, letterSpacing: '0.08em',
                  display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
                }}>
                  {cfg.label}
                  <span style={{
                    fontSize: 12, fontWeight: 700, fontFamily: 'IBM Plex Mono, monospace',
                    color: cfg.color, background: cfg.bg,
                    border: `1px solid ${cfg.color}33`,
                    padding: '1px 6px',
                  }}>
                    {items.length}
                  </span>
                </div>
                <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 4, padding: items.length > 0 ? 6 : 0 }}>
                  {items.length === 0 && (
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-5)', fontSize: 13 }}>
                      None
                    </div>
                  )}
                  {items.map(a => <ActionCard key={a.id} a={a} />)}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
