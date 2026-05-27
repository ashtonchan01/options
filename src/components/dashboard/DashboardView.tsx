import type { AppState, Action, UrgencyLevel, StrategyType } from '../../types'

interface Props { state: AppState }

// ─── Strategy channel definitions ────────────────────────────────────────────

const INCOME_CHANNELS = [
  { id: 'covered_calls',  label: 'Covered Calls',    short: 'CC',    color: '#3b82f6', glow: '#3b82f620' },
  { id: 'csp',            label: 'Cash Secured Puts', short: 'CSP',   color: '#f43f5e', glow: '#f43f5e20' },
  { id: 'leap',           label: 'LEAP',             short: 'LEAP',  color: '#10b981', glow: '#10b98120' },
  { id: 'spx',            label: 'SPX',              short: 'SPX',   color: '#8b5cf6', glow: '#8b5cf620' },
  { id: 'rotation',       label: 'Rotation Model',   short: 'ROT',   color: '#f59e0b', glow: '#f59e0b20' },
  { id: 'ptos',           label: 'PTOS',             short: 'PTOS',  color: '#06b6d4', glow: '#06b6d420' },
  { id: 'dcas',           label: 'DCAS',             short: 'DCAS',  color: '#ec4899', glow: '#ec489920' },
  { id: 'profit_taking',  label: 'Profit Taking',    short: 'PT',    color: '#84cc16', glow: '#84cc1620' },
  { id: 'lilo',           label: 'LILO',             short: 'LILO',  color: '#f97316', glow: '#f9731620' },
  { id: 'arb_cloud',      label: 'ARB Cloud',        short: 'ARB',   color: '#a78bfa', glow: '#a78bfa20' },
  { id: 'tabi',           label: 'TABI',             short: 'TABI',  color: '#34d399', glow: '#34d39920' },
] as const

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

function pnlClass(n: number) {
  if (n > 0) return 'pos'
  if (n < 0) return 'neg'
  return 'neu'
}

function formatExpiry(yyyymmdd: string): string {
  if (!yyyymmdd || yyyymmdd.length !== 8) return yyyymmdd
  return `${yyyymmdd.slice(4, 6)}/${yyyymmdd.slice(6, 8)}/${yyyymmdd.slice(0, 4)}`
}

// ─── P&L Strip ────────────────────────────────────────────────────────────────

function PnlStrip({ state }: { state: AppState }) {
  const { sync } = state

  const netLiq      = sync.netLiquidation ?? 0
  const cashBal     = sync.cashBalance
  const unrealized  = sync.positions.reduce((s, p) => s + (p.unrealizedPnL ?? 0), 0)
  const realized    = sync.trades.reduce((s, t) => s + t.netCash, 0)
  const totalPnl    = realized + unrealized
  const optionIncome = sync.trades
    .filter(t => t.assetClass === 'OPT' && t.netCash > 0)
    .reduce((s, t) => s + t.netCash, 0)

  const cards = [
    { label: 'Net Liquidation', value: fmtDollar(netLiq),     pnl: false },
    { label: 'Total P&L',       value: fmtDollar(totalPnl),   pnl: true,  n: totalPnl    },
    { label: 'Realized P&L',    value: fmtDollar(realized),   pnl: true,  n: realized    },
    { label: 'Unrealized P&L',  value: fmtDollar(unrealized), pnl: true,  n: unrealized  },
    { label: 'Options Income',  value: fmtDollar(optionIncome), pnl: false, accent: true  },
    { label: 'Cash Balance',    value: fmtDollar(cashBal),    pnl: false },
  ]

  return (
    <div className="db-pnl-strip">
      {cards.map(c => (
        <div key={c.label} className="db-pnl-card">
          <div className="stat-label">{c.label}</div>
          <div className={`stat-value db-pnl-value ${c.pnl ? pnlClass(c.n ?? 0) : c.accent ? 'db-accent-val' : ''}`}>
            {c.value}
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Income Channel Card ──────────────────────────────────────────────────────

function ChannelCard({ ch, state }: { ch: typeof INCOME_CHANNELS[number]; state: AppState }) {
  // Map channel id to strategy type where possible
  const typeMap: Record<string, StrategyType> = {
    covered_calls: 'covered_call',
    csp:           'csp',
    leap:          'leap',
  }
  const stype = typeMap[ch.id]

  const relatedStrats = stype
    ? state.strategies.filter(s => s.type === stype)
    : []

  const income  = relatedStrats.reduce((s, st) => s + st.netPremiumReceived, 0)
  const pnl     = relatedStrats.reduce((s, st) => s + st.unrealizedPnL, 0)
  const count   = relatedStrats.length
  const hasData = count > 0

  return (
    <div className="db-channel-card" style={{ borderTop: `3px solid ${ch.color}`, boxShadow: hasData ? `0 0 12px ${ch.glow}` : undefined }}>
      <div className="db-channel-header">
        <span className="db-channel-badge" style={{ color: ch.color, background: ch.glow, border: `1px solid ${ch.color}33` }}>
          {ch.short}
        </span>
        <span className="db-channel-label">{ch.label}</span>
      </div>
      <div className="db-channel-body">
        {hasData ? (
          <>
            <div className="db-channel-stat">
              <span className="label">Positions</span>
              <span style={{ color: ch.color, fontFamily: 'IBM Plex Mono, monospace', fontWeight: 700 }}>{count}</span>
            </div>
            <div className="db-channel-stat">
              <span className="label">Income</span>
              <span className="pos mono" style={{ fontSize: 13, fontWeight: 600 }}>{fmtDollar(income)}</span>
            </div>
            <div className="db-channel-stat">
              <span className="label">P&amp;L</span>
              <span className={`${pnlClass(pnl)} mono`} style={{ fontSize: 12 }}>{fmtDollar(pnl)}</span>
            </div>
          </>
        ) : (
          <div className="db-channel-empty">No positions</div>
        )}
      </div>
    </div>
  )
}

// ─── Portfolio Snapshot ───────────────────────────────────────────────────────

function PortfolioSnapshot({ state }: { state: AppState }) {
  const { positions } = state.sync
  const stocks  = positions.filter(p => p.assetClass === 'STK')
  const options = positions.filter(p => p.assetClass === 'OPT')

  return (
    <div className="db-snapshot-grid">
      <div className="db-snapshot-card">
        <div className="stat-label">Total Positions</div>
        <div className="stat-value" style={{ fontSize: 28 }}>{positions.length}</div>
      </div>
      <div className="db-snapshot-card">
        <div className="stat-label">Stock Positions</div>
        <div className="stat-value" style={{ fontSize: 28 }}>{stocks.length}</div>
      </div>
      <div className="db-snapshot-card">
        <div className="stat-label">Option Legs</div>
        <div className="stat-value" style={{ fontSize: 28 }}>{options.length}</div>
      </div>
      <div className="db-snapshot-card">
        <div className="stat-label">Open Strategies</div>
        <div className="stat-value" style={{ fontSize: 28 }}>{state.strategies.length}</div>
      </div>
    </div>
  )
}

// ─── Recent Trades ────────────────────────────────────────────────────────────

function RecentTrades({ state }: { state: AppState }) {
  const recent = [...state.sync.trades]
    .sort((a, b) => b.tradeDate.localeCompare(a.tradeDate))
    .slice(0, 20)

  return (
    <div className="db-bottom-panel">
      <div className="db-panel-header">Recent Trades</div>
      {recent.length === 0 ? (
        <div className="db-empty-msg">No trades loaded</div>
      ) : (
        <div style={{ overflow: 'auto', flex: 1 }}>
          <table className="trade-table" style={{ fontSize: 12 }}>
            <thead>
              <tr>
                <th>Date</th>
                <th>Symbol</th>
                <th>Type</th>
                <th style={{ textAlign: 'right' }}>Qty</th>
                <th style={{ textAlign: 'right' }}>Price</th>
                <th style={{ textAlign: 'right' }}>Net $</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((t, i) => (
                <tr key={i}>
                  <td className="mono" style={{ color: 'var(--text-3)', whiteSpace: 'nowrap' }}>{t.tradeDate}</td>
                  <td style={{ fontWeight: 600, color: 'var(--text-1)', fontFamily: 'IBM Plex Mono, monospace' }}>{t.symbol}</td>
                  <td>
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '1px 5px',
                      color: t.assetClass === 'OPT' ? '#8b5cf6' : '#38bdf8',
                      background: t.assetClass === 'OPT' ? '#8b5cf614' : '#38bdf814',
                      border: `1px solid ${t.assetClass === 'OPT' ? '#8b5cf630' : '#38bdf830'}`,
                    }}>
                      {t.assetClass}
                    </span>
                  </td>
                  <td className="mono" style={{ textAlign: 'right', color: t.quantity < 0 ? '#f43f5e' : '#10b981' }}>
                    {t.quantity > 0 ? '+' : ''}{t.quantity}
                  </td>
                  <td className="mono" style={{ textAlign: 'right', color: 'var(--text-2)' }}>
                    ${t.tradePrice.toFixed(2)}
                  </td>
                  <td className={`mono ${pnlClass(t.netCash)}`} style={{ textAlign: 'right', fontWeight: 600 }}>
                    {fmtDollar(t.netCash)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── Calendar Highlights ──────────────────────────────────────────────────────

function CalendarHighlights({ state }: { state: AppState }) {
  const today = new Date()
  const soon  = new Date(today.getTime() + 30 * 86400_000)

  // Gather expiring options
  const expiring = state.sync.positions
    .filter(p => p.assetClass === 'OPT' && p.expiry)
    .map(p => ({ symbol: p.symbol, expiry: p.expiry!, underlying: p.underlyingSymbol ?? p.symbol, qty: p.quantity }))
    .filter(p => {
      const exp = new Date(`${p.expiry.slice(0, 4)}-${p.expiry.slice(4, 6)}-${p.expiry.slice(6, 8)}`)
      return exp <= soon
    })
    .sort((a, b) => a.expiry.localeCompare(b.expiry))
    .slice(0, 12)

  // Open strategies with expiry
  const stratExps = state.strategies
    .flatMap(s => s.legs.map(l => ({ id: s.id, type: s.type, underlying: s.underlying, expiry: l.expiry, dte: l.dte })))
    .filter(l => l.dte <= 30)
    .sort((a, b) => a.dte - b.dte)
    .slice(0, 8)

  return (
    <div className="db-bottom-panel">
      <div className="db-panel-header">Calendar Highlights</div>
      <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 12, padding: '8px 0' }}>

        {/* Expiring options */}
        {expiring.length > 0 && (
          <div>
            <div style={{ fontSize: 10, color: 'var(--text-4)', letterSpacing: '1.5px', textTransform: 'uppercase', padding: '0 12px', marginBottom: 6 }}>
              Expiring within 30 days
            </div>
            {expiring.map((p, i) => (
              <div key={i} className="db-cal-row">
                <span className="mono" style={{ color: 'var(--text-1)', fontWeight: 600, minWidth: 80 }}>{p.underlying}</span>
                <span style={{ fontSize: 11, color: 'var(--text-3)', flex: 1 }}>{p.symbol}</span>
                <span className="mono" style={{ fontSize: 11, color: '#f59e0b' }}>{formatExpiry(p.expiry)}</span>
              </div>
            ))}
          </div>
        )}

        {/* Strategies expiring soon */}
        {stratExps.length > 0 && (
          <div>
            <div style={{ fontSize: 10, color: 'var(--text-4)', letterSpacing: '1.5px', textTransform: 'uppercase', padding: '0 12px', marginBottom: 6 }}>
              Open strategies — expiring
            </div>
            {stratExps.map((l, i) => {
              const scolor = STRAT_COLOR[l.type]
              return (
                <div key={i} className="db-cal-row">
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: '1px 5px',
                    color: scolor, background: `${scolor}14`, border: `1px solid ${scolor}30`,
                    minWidth: 56, textAlign: 'center',
                  }}>
                    {STRAT_LABEL[l.type]}
                  </span>
                  <span className="mono" style={{ color: 'var(--text-1)', fontWeight: 600, minWidth: 60 }}>{l.underlying}</span>
                  <span className={`mono`} style={{ fontSize: 11, color: l.dte <= 7 ? '#f43f5e' : l.dte <= 14 ? '#f59e0b' : 'var(--text-3)' }}>
                    {l.dte}d
                  </span>
                  <span className="mono" style={{ fontSize: 11, color: 'var(--text-4)' }}>{formatExpiry(l.expiry)}</span>
                </div>
              )
            })}
          </div>
        )}

        {expiring.length === 0 && stratExps.length === 0 && (
          <div className="db-empty-msg">No upcoming expirations</div>
        )}
      </div>
    </div>
  )
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
      <div className="db-sidebar-header">
        Actions &amp; To-Do
        {actions.length > 0 && (
          <span className="top-nav-badge" style={{ marginLeft: 6 }}>
            {actions.length > 9 ? '9+' : actions.length}
          </span>
        )}
      </div>

      <div className="db-sidebar-body">
        {actions.length === 0 && (
          <div className="db-empty-msg" style={{ padding: '20px 12px' }}>
            No actions — all positions within normal parameters.
          </div>
        )}

        {URGENCY_ORDER.map(u => {
          const cfg   = URGENCY_CONFIG[u]
          const items = byUrgency[u]
          if (items.length === 0) return null
          return (
            <div key={u} className="db-urgency-group">
              <div className="db-urgency-label" style={{ color: cfg.color, borderBottom: `1px solid ${cfg.color}33` }}>
                {cfg.label}
                <span style={{ background: cfg.bg, border: `1px solid ${cfg.color}33`, padding: '0 5px', fontSize: 10, marginLeft: 6 }}>
                  {items.length}
                </span>
              </div>
              {items.map(a => {
                const aColor = ACTION_COLOR[a.actionType]
                const sColor = STRAT_COLOR[a.strategyType]
                return (
                  <div key={a.id} className="db-action-card" style={{ borderLeft: `3px solid ${cfg.color}` }}>
                    <div style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, fontFamily: 'IBM Plex Mono, monospace', color: 'var(--text-1)' }}>
                        {a.underlying}
                      </span>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 5px', color: sColor, background: `${sColor}14`, border: `1px solid ${sColor}30` }}>
                        {STRAT_LABEL[a.strategyType]}
                      </span>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 5px', color: aColor, background: `${aColor}14`, border: `1px solid ${aColor}30` }}>
                        {ACTION_LABEL[a.actionType]}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-1)', lineHeight: 1.4, marginBottom: 2 }}>
                      {a.reason}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.4 }}>
                      {a.details}
                    </div>
                    {a.estimatedCredit != null && (
                      <div style={{ fontSize: 11, color: '#10b981', marginTop: 4, fontFamily: 'IBM Plex Mono, monospace' }}>
                        est. ${a.estimatedCredit.toFixed(2)}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </aside>
  )
}

// ─── Dashboard View ───────────────────────────────────────────────────────────

export default function DashboardView({ state }: Props) {
  return (
    <div className="db-root">
      {/* ── Main content area ───────────────────────────────────────────── */}
      <div className="db-main">

        {/* P&L Strip */}
        <PnlStrip state={state} />

        {/* Income Channels */}
        <section>
          <div className="db-section-title">Income Channels</div>
          <div className="db-channels-grid">
            {INCOME_CHANNELS.map(ch => (
              <ChannelCard key={ch.id} ch={ch} state={state} />
            ))}
          </div>
        </section>

        {/* Portfolio Snapshot */}
        <section>
          <div className="db-section-title">Portfolio Snapshot</div>
          <PortfolioSnapshot state={state} />
        </section>

        {/* Bottom row */}
        <div className="db-bottom-row">
          <RecentTrades state={state} />
          <CalendarHighlights state={state} />
        </div>
      </div>

      {/* ── Right Sidebar ────────────────────────────────────────────────── */}
      <ActionsSidebar state={state} />
    </div>
  )
}
