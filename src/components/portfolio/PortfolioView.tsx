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

// ── Tile styles for bento grid ──────────────────────────────────────────────────

const tile: React.CSSProperties = {
  background: '#131726', border: '1px solid #1E2540', borderRadius: 10,
  overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0,
}
const tileHdr: React.CSSProperties = {
  padding: '12px 20px', borderBottom: '1px solid #1E2540',
  fontSize: 13, fontWeight: 700, color: '#5D6580', letterSpacing: '0.08em', flexShrink: 0,
}

interface PortfolioViewProps { state: AppState }

export default function PortfolioView({ state }: PortfolioViewProps) {
  const { positions, trades, cashBalance, netLiquidation: ibkrNetLiq } = state.sync
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
  const allPositionsValue = positions.reduce((s, p) => s + p.positionValue, 0)
  const computedNetLiq    = allPositionsValue + cashBalance
  const netLiq            = ibkrNetLiq ?? computedNetLiq
  const totalPnL          = totalStockPnL + totalOptionPnL

  const byType = strategies.reduce<Record<string, Strategy[]>>((acc, s) => {
    acc[s.type] = [...(acc[s.type] ?? []), s]
    return acc
  }, {})

  const hasStocks = stocks.length > 0
  const hasStrats = strategies.length > 0
  const hasTrades = trades.length > 0
  const gridCols = hasStocks && hasStrats ? '2fr 3fr' : '1fr'

  return (
    <div style={{ padding: 20, height: '100%', display: 'flex', flexDirection: 'column', gap: 14, overflow: 'hidden' }}>

      {/* ── Stats row ──────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8, flexShrink: 0 }}>
        {[
          { label: 'NET LIQUIDATION', value: fmt$(netLiq), color: '#EAEDF3' },
          { label: 'CASH', value: fmt$(cashBalance), color: '#EAEDF3' },
          { label: 'UNREALIZED P&L', value: fmt$(totalPnL), color: totalPnL >= 0 ? '#10b981' : '#f43f5e' },
          { label: 'STOCK VALUE', value: fmt$(totalStockValue), color: '#EAEDF3' },
          { label: 'PREMIUM', value: fmt$(totalPremium), color: totalPremium >= 0 ? '#10b981' : '#f43f5e' },
        ].map(({ label, value, color }) => (
          <div key={label} className="stat-card">
            <div className="stat-label">{label}</div>
            <div className="stat-value" style={{ color, fontSize: 28 }}>{value}</div>
          </div>
        ))}
      </div>

      {/* ── Main tiles (equity left, strategies right) ─────────────────── */}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: gridCols, gap: 12, minHeight: 0 }}>

        {hasStocks && (
          <div style={tile}>
            <div style={tileHdr}>EQUITY POSITIONS</div>
            <div style={{ overflow: 'auto', flex: 1 }}>
              <table className="trade-table" style={{ fontSize: 14 }}>
                <thead>
                  <tr>
                    {['SYMBOL', 'QTY', 'AVG COST', 'MARK', 'VALUE', 'P&L', 'RETURN'].map(h => (
                      <th key={h} style={{ fontSize: 12, padding: '12px 16px' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {stocks.map(p => {
                    const ret = p.costBasisPrice > 0 ? (p.markPrice - p.costBasisPrice) / p.costBasisPrice * 100 : 0
                    return (
                      <tr key={p.symbol}>
                        <td style={{ padding: '12px 16px', fontFamily: 'IBM Plex Mono, monospace', fontSize: 14, fontWeight: 600, color: '#EAEDF3' }}>{p.symbol}</td>
                        <td style={{ padding: '12px 16px' }} className="mono">{p.quantity.toLocaleString()}</td>
                        <td style={{ padding: '12px 16px' }} className="mono">{fmt$(p.costBasisPrice, 2)}</td>
                        <td style={{ padding: '12px 16px' }} className="mono">{fmt$(p.markPrice, 2)}</td>
                        <td style={{ padding: '12px 16px' }} className="mono">{fmt$(p.positionValue)}</td>
                        <td style={{ padding: '12px 16px' }} className={`mono ${pnlClass(p.unrealizedPnL)}`}>{fmt$(p.unrealizedPnL)}</td>
                        <td style={{ padding: '12px 16px' }} className={`mono ${pnlClass(ret)}`}>{fmtPct(ret)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {hasStrats && (
          <div style={tile}>
            <div style={tileHdr}>OPTIONS STRATEGIES</div>
            <div style={{ overflow: 'auto', flex: 1, padding: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(Object.entries(byType) as [StrategyType, Strategy[]][]).map(([type, strats]) => (
                <StrategyGroup key={type} type={type} strategies={strats} />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Recent trades tile (bottom) ────────────────────────────────── */}
      {hasTrades && (
        <div style={{ ...tile, maxHeight: 220, flexShrink: 0 }}>
          <div style={tileHdr}>RECENT TRADES</div>
          <div style={{ overflow: 'auto', flex: 1 }}>
            <table className="trade-table" style={{ fontSize: 14 }}>
              <thead>
                <tr>
                  {['DATE', 'SYMBOL', 'TYPE', 'QTY', 'PRICE', 'PROCEEDS', 'NET'].map(h => (
                    <th key={h} style={{ fontSize: 12, padding: '12px 16px' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {trades.slice(0, 20).map((t, i) => (
                  <tr key={i}>
                    <td style={{ padding: '10px 16px' }} className="mono">{t.tradeDate}</td>
                    <td style={{ padding: '10px 16px', fontFamily: 'IBM Plex Mono, monospace', fontSize: 14, color: '#EAEDF3' }}>{t.underlyingSymbol ?? t.symbol}</td>
                    <td style={{ padding: '10px 16px' }}>
                      <span style={{ fontSize: 11, letterSpacing: 1, padding: '2px 6px', border: '1px solid #1E2540', borderRadius: 4, color: '#9198AE' }}>
                        {t.assetClass === 'OPT' ? `${t.putCall} ${t.strike}` : t.assetClass}
                      </span>
                    </td>
                    <td style={{ padding: '10px 16px' }} className={`mono ${t.quantity > 0 ? 'pos' : 'neg'}`}>{t.quantity > 0 ? '+' : ''}{t.quantity}</td>
                    <td style={{ padding: '10px 16px' }} className="mono">{fmt$(t.tradePrice, 2)}</td>
                    <td style={{ padding: '10px 16px' }} className={`mono ${pnlClass(t.proceeds)}`}>{fmt$(t.proceeds)}</td>
                    <td style={{ padding: '10px 16px' }} className={`mono ${pnlClass(t.netCash)}`}>{fmt$(t.netCash)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
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
    <div style={{ border: `1px solid #1E2540`, background: '#131726', borderRadius: 10, borderLeft: `3px solid ${color}`, overflow: 'hidden' }}>
      {/* Group header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '12px 16px', borderBottom: '1px solid #1E2540',
        background: '#171C30',
      }}>
        <span className="display" style={{ color, fontSize: 14, fontWeight: 700, letterSpacing: 2 }}>{label}</span>
        <span style={{ fontSize: 12, color: '#5D6580' }}>{strategies.length}</span>
        <span style={{ marginLeft: 'auto', fontSize: 13, color: '#5D6580' }}>Prem</span>
        <span className={`mono ${totalPremium >= 0 ? 'pos' : 'neg'}`} style={{ fontSize: 14, minWidth: 70, textAlign: 'right' }}>{fmt$(totalPremium)}</span>
        <span style={{ fontSize: 13, color: '#5D6580', marginLeft: 8 }}>P&L</span>
        <span className={`mono ${totalPnL >= 0 ? 'pos' : 'neg'}`} style={{ fontSize: 14, minWidth: 70, textAlign: 'right' }}>{fmt$(totalPnL)}</span>
      </div>

      {/* Legs table */}
      <table className="trade-table" style={{ fontSize: 14 }}>
        <thead>
          <tr>
            {['UNDERLYING', 'LEG', 'STRIKE', 'EXPIRY', 'DTE', 'QTY', 'MARK', 'COST', 'P&L'].map(h => (
              <th key={h} style={{ fontSize: 11, padding: '8px 12px' }}>{h}</th>
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
                    style={{ padding: '12px 14px', fontFamily: 'IBM Plex Mono, monospace', fontSize: 14, fontWeight: 700, color: '#EAEDF3', verticalAlign: 'middle' }}
                  >
                    {s.underlying}
                  </td>
                )}
                <td style={{ padding: '12px 14px' }}>
                  <span style={{
                    display: 'inline-block', fontSize: 12, letterSpacing: 1,
                    padding: '2px 6px', fontWeight: 600,
                    color: leg.putCall === 'C' ? '#818cf8' : '#f43f5e',
                    border: `1px solid ${leg.putCall === 'C' ? '#312e81' : '#5b1a28'}`,
                    background: leg.putCall === 'C' ? 'rgba(129,140,248,0.08)' : 'rgba(244,63,94,0.08)',
                  }}>
                    {leg.quantity > 0 ? 'LONG' : 'SHORT'} {leg.putCall === 'C' ? 'CALL' : 'PUT'}
                  </span>
                </td>
                <td style={{ padding: '12px 14px', fontFamily: 'IBM Plex Mono, monospace', fontSize: 14 }} className="mono">{fmt$(leg.strike, 0)}</td>
                <td style={{ padding: '12px 14px' }} className="mono">{fmtExpiry(leg.expiry)}</td>
                <td style={{ padding: '12px 14px' }}>
                  <span style={{
                    fontSize: 13, fontWeight: 600,
                    color: leg.dte <= 7 ? '#f43f5e' : leg.dte <= 21 ? '#f59e0b' : '#9198AE',
                  }}>
                    {leg.dte}d
                  </span>
                </td>
                <td style={{ padding: '12px 14px' }} className={`mono ${leg.quantity > 0 ? 'pos' : 'neg'}`}>{leg.quantity > 0 ? '+' : ''}{leg.quantity}</td>
                <td style={{ padding: '12px 14px' }} className="mono">{fmt$(leg.markPrice, 2)}</td>
                <td style={{ padding: '12px 14px' }} className="mono">{fmt$(leg.costBasis)}</td>
                <td style={{ padding: '12px 14px' }} className={`mono ${pnlClass(leg.unrealizedPnL)}`}>{fmt$(leg.unrealizedPnL)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
