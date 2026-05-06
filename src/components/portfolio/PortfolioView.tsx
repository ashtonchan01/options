import type { AppState, Strategy, StrategyType } from '../../types'
import EmptyState from '../shared/EmptyState'

const STRAT_COLOR: Record<StrategyType, string> = {
  csp:          '#f43f5e',
  covered_call: '#818cf8',
  pmcc:         '#3b82f6',
  risk_reversal:'#38bdf8',
  put_spread:   '#fbbf24',
  call_spread:  '#fb923c',
  leap:         '#10b981',
  other:        '#555',
}

const STRAT_LABEL: Record<StrategyType, string> = {
  csp:          'CSP',
  covered_call: 'CC',
  pmcc:         'PMCC',
  risk_reversal:'RISK REV',
  put_spread:   'PUT SPD',
  call_spread:  'CALL SPD',
  leap:         'LEAP',
  other:        'OTHER',
}

function fmt$(n: number, digits = 0) {
  return (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}
function fmtPct(n: number) {
  return (n >= 0 ? '+' : '') + n.toFixed(2) + '%'
}
function pnlClass(n: number) {
  return n > 0 ? 'pos' : n < 0 ? 'neg' : 'neu'
}
function normalizeDate(raw: string): string {
  return raw.length === 8 ? `${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}` : raw
}
function fmtExpiry(raw: string): string {
  const d = new Date(normalizeDate(raw))
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
}

interface PortfolioViewProps { state: AppState }

export default function PortfolioView({ state }: PortfolioViewProps) {
  const { positions, trades, cashBalance } = state.sync
  const { strategies } = state

  const hasData = positions.length > 0 || strategies.length > 0

  if (!hasData) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <EmptyState
          title="No portfolio data"
          message="Upload an IBKR Flex XML or connect via Flex API to load your positions."
          showUpload
        />
      </div>
    )
  }

  const stocks = positions.filter(p => p.assetClass === 'STK')
  const totalStockValue = stocks.reduce((s, p) => s + p.positionValue, 0)
  const totalStockPnL   = stocks.reduce((s, p) => s + p.unrealizedPnL, 0)
  const totalOptionPnL  = strategies.reduce((s, st) => s + st.unrealizedPnL, 0)
  const totalPremium    = strategies.reduce((s, st) => s + st.netPremiumReceived, 0)
  const optionValue     = strategies.reduce((s, st) => s + st.legs.reduce((a, l) => a + l.markPrice * Math.abs(l.quantity) * 100 * Math.sign(l.quantity), 0), 0)
  const netLiq          = totalStockValue + optionValue + cashBalance
  const totalPnL        = totalStockPnL + totalOptionPnL

  // Group strategies by type
  const byType = strategies.reduce<Record<string, Strategy[]>>((acc, s) => {
    acc[s.type] = [...(acc[s.type] ?? []), s]
    return acc
  }, {})

  return (
    <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* ── Summary stats ─────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
        {[
          { label: 'NET LIQUIDATION', value: fmt$(netLiq), color: '#EEEEEE' },
          { label: 'CASH', value: fmt$(cashBalance), color: '#EEEEEE' },
          { label: 'UNREALIZED P&L', value: fmt$(totalPnL), color: totalPnL >= 0 ? '#00D084' : '#FF4757' },
          { label: 'STOCK VALUE', value: fmt$(totalStockValue), color: '#EEEEEE' },
          { label: 'PREMIUM COLLECTED', value: fmt$(totalPremium), color: totalPremium >= 0 ? '#00D084' : '#FF4757' },
        ].map(({ label, value, color }) => (
          <div key={label} className="stat-card">
            <div className="stat-label">{label}</div>
            <div className="stat-value" style={{ color, fontSize: 26 }}>{value}</div>
          </div>
        ))}
      </div>

      {/* ── Stock positions ───────────────────────────────────────────────── */}
      {stocks.length > 0 && (
        <section>
          <div className="label" style={{ marginBottom: 10 }}>EQUITY POSITIONS</div>
          <div className="panel" style={{ overflow: 'hidden' }}>
            <table className="trade-table" style={{ fontSize: 14 }}>
              <thead>
                <tr>
                  {['SYMBOL', 'QTY', 'AVG COST', 'MARK', 'VALUE', 'UNREAL P&L', 'RETURN'].map(h => (
                    <th key={h} style={{ fontSize: 11, padding: '12px 16px' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {stocks.map(p => {
                  const ret = p.costBasisPrice > 0 ? (p.markPrice - p.costBasisPrice) / p.costBasisPrice * 100 : 0
                  return (
                    <tr key={p.symbol}>
                      <td style={{ padding: '13px 16px', fontFamily: 'Chakra Petch, sans-serif', fontSize: 15, fontWeight: 600, color: '#EEEEEE' }}>{p.symbol}</td>
                      <td style={{ padding: '13px 16px' }} className="mono">{p.quantity.toLocaleString()}</td>
                      <td style={{ padding: '13px 16px' }} className="mono">{fmt$(p.costBasisPrice, 2)}</td>
                      <td style={{ padding: '13px 16px' }} className="mono">{fmt$(p.markPrice, 2)}</td>
                      <td style={{ padding: '13px 16px' }} className="mono">{fmt$(p.positionValue)}</td>
                      <td style={{ padding: '13px 16px' }} className={`mono ${pnlClass(p.unrealizedPnL)}`}>{fmt$(p.unrealizedPnL)}</td>
                      <td style={{ padding: '13px 16px' }} className={`mono ${pnlClass(ret)}`}>{fmtPct(ret)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── Options strategies ────────────────────────────────────────────── */}
      {strategies.length > 0 && (
        <section>
          <div className="label" style={{ marginBottom: 10 }}>OPTIONS STRATEGIES</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(Object.entries(byType) as [StrategyType, Strategy[]][]).map(([type, strats]) => (
              <StrategyGroup key={type} type={type} strategies={strats} />
            ))}
          </div>
        </section>
      )}

      {/* ── Recent trades ─────────────────────────────────────────────────── */}
      {trades.length > 0 && (
        <section>
          <div className="label" style={{ marginBottom: 10 }}>RECENT TRADES</div>
          <div className="panel" style={{ overflow: 'hidden' }}>
            <table className="trade-table" style={{ fontSize: 14 }}>
              <thead>
                <tr>
                  {['DATE', 'SYMBOL', 'TYPE', 'QTY', 'PRICE', 'PROCEEDS', 'NET CASH'].map(h => (
                    <th key={h} style={{ fontSize: 11, padding: '12px 16px' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {trades.slice(0, 20).map((t, i) => (
                  <tr key={i}>
                    <td style={{ padding: '12px 16px' }} className="mono" >{t.tradeDate}</td>
                    <td style={{ padding: '12px 16px', fontFamily: 'Chakra Petch, sans-serif', fontSize: 14, color: '#EEEEEE' }}>{t.underlyingSymbol ?? t.symbol}</td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{ fontSize: 10, letterSpacing: 1, padding: '2px 7px', border: '1px solid #2E2E2E', color: '#909090' }}>
                        {t.assetClass === 'OPT' ? `${t.putCall} ${t.strike}` : t.assetClass}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px' }} className={`mono ${t.quantity > 0 ? 'pos' : 'neg'}`}>{t.quantity > 0 ? '+' : ''}{t.quantity}</td>
                    <td style={{ padding: '12px 16px' }} className="mono">{fmt$(t.tradePrice, 2)}</td>
                    <td style={{ padding: '12px 16px' }} className={`mono ${pnlClass(t.proceeds)}`}>{fmt$(t.proceeds)}</td>
                    <td style={{ padding: '12px 16px' }} className={`mono ${pnlClass(t.netCash)}`}>{fmt$(t.netCash)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}

// ── Strategy group card ────────────────────────────────────────────────────────

function StrategyGroup({ type, strategies }: { type: StrategyType; strategies: Strategy[] }) {
  const color = STRAT_COLOR[type]
  const label = STRAT_LABEL[type]
  const totalPnL = strategies.reduce((s, st) => s + st.unrealizedPnL, 0)
  const totalPremium = strategies.reduce((s, st) => s + st.netPremiumReceived, 0)

  return (
    <div style={{ border: `1px solid #2E2E2E`, background: '#1A1A1A', borderLeft: `3px solid ${color}` }}>
      {/* Group header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '12px 18px', borderBottom: '1px solid #2E2E2E',
        background: '#202020',
      }}>
        <span className="display" style={{ color, fontSize: 13, fontWeight: 700, letterSpacing: 2 }}>{label}</span>
        <span style={{ fontSize: 11, color: '#606060' }}>{strategies.length} position{strategies.length !== 1 ? 's' : ''}</span>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: '#606060' }}>Premium</span>
        <span className={`mono ${totalPremium >= 0 ? 'pos' : 'neg'}`} style={{ fontSize: 14, minWidth: 90, textAlign: 'right' }}>{fmt$(totalPremium)}</span>
        <span style={{ fontSize: 12, color: '#606060', marginLeft: 16 }}>Unreal P&L</span>
        <span className={`mono ${totalPnL >= 0 ? 'pos' : 'neg'}`} style={{ fontSize: 14, minWidth: 90, textAlign: 'right' }}>{fmt$(totalPnL)}</span>
      </div>

      {/* Legs table */}
      <table className="trade-table" style={{ fontSize: 13 }}>
        <thead>
          <tr>
            {['UNDERLYING', 'LEG', 'STRIKE', 'EXPIRY', 'DTE', 'QTY', 'MARK', 'COST BASIS', 'UNREAL P&L'].map(h => (
              <th key={h} style={{ fontSize: 10, padding: '10px 16px' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {strategies.flatMap(s =>
            s.legs.map((leg, i) => (
              <tr key={`${s.id}-${i}`}>
                {i === 0 && (
                  <td
                    rowSpan={s.legs.length}
                    style={{ padding: '12px 16px', fontFamily: 'Chakra Petch, sans-serif', fontSize: 16, fontWeight: 700, color: '#EEEEEE', verticalAlign: 'middle' }}
                  >
                    {s.underlying}
                  </td>
                )}
                <td style={{ padding: '12px 16px' }}>
                  <span style={{
                    display: 'inline-block', fontSize: 11, letterSpacing: 1,
                    padding: '2px 8px', fontWeight: 600,
                    color: leg.putCall === 'C' ? '#3B9EFF' : '#FF4757',
                    border: `1px solid ${leg.putCall === 'C' ? '#0F3060' : '#6B0F1E'}`,
                    background: leg.putCall === 'C' ? 'rgba(59,158,255,0.08)' : 'rgba(255,71,87,0.08)',
                  }}>
                    {leg.quantity > 0 ? 'LONG' : 'SHORT'} {leg.putCall === 'C' ? 'CALL' : 'PUT'}
                  </span>
                </td>
                <td style={{ padding: '12px 16px', fontFamily: 'Chakra Petch, sans-serif', fontSize: 15 }} className="mono">{fmt$(leg.strike, 0)}</td>
                <td style={{ padding: '12px 16px' }} className="mono">{fmtExpiry(leg.expiry)}</td>
                <td style={{ padding: '12px 16px' }}>
                  <span style={{
                    fontSize: 12, fontWeight: 600,
                    color: leg.dte <= 7 ? '#FF4757' : leg.dte <= 21 ? '#F0B429' : '#C0C0C0',
                  }}>
                    {leg.dte}d
                  </span>
                </td>
                <td style={{ padding: '12px 16px' }} className={`mono ${leg.quantity > 0 ? 'pos' : 'neg'}`}>{leg.quantity > 0 ? '+' : ''}{leg.quantity}</td>
                <td style={{ padding: '12px 16px' }} className="mono">{fmt$(leg.markPrice, 2)}</td>
                <td style={{ padding: '12px 16px' }} className="mono">{fmt$(leg.costBasis)}</td>
                <td style={{ padding: '12px 16px' }} className={`mono ${pnlClass(leg.unrealizedPnL)}`}>{fmt$(leg.unrealizedPnL)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
