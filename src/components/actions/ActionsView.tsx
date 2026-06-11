import type { AppState, Action, UrgencyLevel, StrategyType } from '../../types'
import EmptyState from '../shared/EmptyState'

interface Props { state: AppState }

// ─── Config ───────────────────────────────────────────────────────────────────

const URGENCY: Record<UrgencyLevel, { label: string; color: string; dot: string }> = {
  urgent:      { label: 'Urgent',      color: '#f43f5e', dot: '🔴' },
  manage:      { label: 'Manage',      color: '#f59e0b', dot: '🟡' },
  opportunity: { label: 'Opportunity', color: '#10b981', dot: '🟢' },
  watch:       { label: 'Watch',       color: '#94a3b8', dot: '⚪' },
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

const URGENCY_ORDER: UrgencyLevel[] = ['urgent', 'manage', 'opportunity', 'watch']

// ─── Summary bar ─────────────────────────────────────────────────────────────

function SummaryBar({ actions }: { actions: Action[] }) {
  return (
    <div style={{
      display: 'flex', gap: 8, flexWrap: 'wrap', flexShrink: 0,
    }}>
      {URGENCY_ORDER.map(u => {
        const cfg = URGENCY[u]
        const count = actions.filter(a => a.urgency === u).length
        return (
          <div key={u} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: count > 0 ? `${cfg.color}12` : 'var(--bg-card)',
            border: `1px solid ${count > 0 ? `${cfg.color}40` : 'var(--border)'}`,
            borderRadius: 8, padding: '6px 12px',
            opacity: count === 0 ? 0.45 : 1,
          }}>
            <div style={{
              width: 8, height: 8, borderRadius: '50%',
              background: count > 0 ? cfg.color : 'var(--border)',
              flexShrink: 0,
            }} />
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-3)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
              {cfg.label}
            </span>
            <span style={{
              fontSize: 15, fontWeight: 700, fontFamily: 'Inter, sans-serif',
              color: count > 0 ? cfg.color : 'var(--text-5)',
            }}>
              {count}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ─── Action card ─────────────────────────────────────────────────────────────

function ActionCard({ a }: { a: Action }) {
  const urg = URGENCY[a.urgency]
  const aColor = ACTION_COLOR[a.actionType]

  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border)',
      borderRadius: 10,
      borderLeft: `3px solid ${urg.color}`,
      padding: '14px 16px',
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
    }}>

      {/* ── Row 1: ticker + strategy + action + urgency ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{
          fontSize: 17, fontWeight: 800, fontFamily: 'Inter, sans-serif',
          color: 'var(--text-1)', marginRight: 2,
        }}>
          {a.underlying}
        </span>

        {/* Strategy badge */}
        <span style={{
          fontSize: 11, fontWeight: 700, letterSpacing: '0.07em',
          color: 'var(--text-2)', background: 'var(--bg-elevated)',
          border: '1px solid var(--border)', borderRadius: 4,
          padding: '2px 7px',
        }}>
          {STRAT_LABEL[a.strategyType]}
        </span>

        {/* Action badge */}
        <span style={{
          fontSize: 11, fontWeight: 700, letterSpacing: '0.07em',
          color: aColor, background: `${aColor}18`,
          border: `1px solid ${aColor}40`, borderRadius: 4,
          padding: '2px 7px',
        }}>
          {ACTION_LABEL[a.actionType]}
        </span>

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Urgency pill — right aligned */}
        <span style={{
          fontSize: 11, fontWeight: 700, letterSpacing: '0.06em',
          color: urg.color, background: `${urg.color}12`,
          border: `1px solid ${urg.color}40`, borderRadius: 20,
          padding: '2px 10px',
        }}>
          {urg.label.toUpperCase()}
        </span>
      </div>

      {/* ── Row 2: position identifier (which exact position) ── */}
      {a.legSummary && (
        <div style={{
          fontSize: 12, fontFamily: 'Inter, sans-serif',
          fontWeight: 600, color: urg.color,
          background: `${urg.color}0e`,
          border: `1px solid ${urg.color}28`,
          borderRadius: 5, padding: '4px 10px',
          display: 'inline-flex', alignItems: 'center', gap: 6,
          alignSelf: 'flex-start',
        }}>
          <span style={{ color: 'var(--text-4)', fontWeight: 400 }}>Position</span>
          {a.legSummary}
        </div>
      )}

      {/* ── Row 3: reason (short headline) ── */}
      <div style={{
        fontSize: 14, fontWeight: 600, color: 'var(--text-1)', lineHeight: 1.4,
      }}>
        {a.reason}
      </div>

      {/* ── Row 4: recommendation text ── */}
      <div style={{
        fontSize: 13, color: 'var(--text-2)', lineHeight: 1.55,
        padding: '8px 10px',
        background: 'var(--bg-elevated)',
        borderRadius: 6,
        borderLeft: `2px solid var(--border)`,
      }}>
        {a.details}
      </div>

      {/* ── Row 5: suggested params ── */}
      {(a.suggestedStrike || a.suggestedExpiry || a.suggestedDelta || a.estimatedCredit) && (
        <div style={{
          display: 'flex', gap: 16, flexWrap: 'wrap',
          paddingTop: 4,
          borderTop: '1px solid var(--border)',
        }}>
          {a.suggestedStrike && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <span style={{ fontSize: 10, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Suggested Strike</span>
              <span style={{ fontSize: 14, fontWeight: 700, fontFamily: 'Inter, sans-serif', color: 'var(--text-1)' }}>${a.suggestedStrike}</span>
            </div>
          )}
          {a.suggestedDelta && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <span style={{ fontSize: 10, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Target Delta</span>
              <span style={{ fontSize: 14, fontWeight: 700, fontFamily: 'Inter, sans-serif', color: 'var(--text-1)' }}>{a.suggestedDelta.toFixed(2)}</span>
            </div>
          )}
          {a.suggestedExpiry && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <span style={{ fontSize: 10, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Suggested Expiry</span>
              <span style={{ fontSize: 14, fontWeight: 700, fontFamily: 'Inter, sans-serif', color: 'var(--text-1)' }}>{a.suggestedExpiry}</span>
            </div>
          )}
          {a.estimatedCredit && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <span style={{ fontSize: 10, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Est. Credit</span>
              <span style={{ fontSize: 14, fontWeight: 700, fontFamily: 'Inter, sans-serif', color: '#10b981' }}>${a.estimatedCredit.toFixed(2)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Section header ───────────────────────────────────────────────────────────

function SectionHeader({ urgency, count }: { urgency: UrgencyLevel; count: number }) {
  const cfg = URGENCY[urgency]
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '4px 0',
    }}>
      <div style={{ width: 10, height: 10, borderRadius: '50%', background: cfg.color, flexShrink: 0 }} />
      <span style={{ fontSize: 13, fontWeight: 700, color: cfg.color, letterSpacing: '0.07em', textTransform: 'uppercase' }}>
        {cfg.label}
      </span>
      <span style={{
        fontSize: 12, fontWeight: 700, fontFamily: 'Inter, sans-serif',
        color: cfg.color, background: `${cfg.color}18`,
        border: `1px solid ${cfg.color}40`,
        borderRadius: 4, padding: '1px 7px',
      }}>
        {count}
      </span>
      <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
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
      <SummaryBar actions={actions} />

      {/* ── All-clear ── */}
      {actions.length === 0 && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)', fontSize: 15 }}>
          All positions within normal parameters — nothing to action.
        </div>
      )}

      {/* ── Scrollable action list ── */}
      {actions.length > 0 && (
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 20, paddingBottom: 8 }}>
          {URGENCY_ORDER.map(u => {
            const items = byUrgency[u]
            if (!items.length) return null
            return (
              <div key={u} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <SectionHeader urgency={u} count={items.length} />
                {items.map(a => <ActionCard key={a.id} a={a} />)}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
