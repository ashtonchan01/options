import { useState, useMemo, useCallback } from 'react'
import { Play, RotateCcw } from 'lucide-react'
import type { AppState } from '../../types'

interface Props { state: AppState }

// ── BSM math ─────────────────────────────────────────────────────────────────

function normCDF(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x))
  const d = 0.3989422802 * Math.exp(-0.5 * x * x)
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.7814779 + t * (-1.821256 + t * 1.3302744))))
  return x > 0 ? 1 - p : p
}

function bsmPrice(S: number, K: number, T: number, r: number, sigma: number, type: 'put' | 'call'): number {
  if (T <= 0.00001) return Math.max(0, type === 'put' ? K - S : S - K)
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T))
  const d2 = d1 - sigma * Math.sqrt(T)
  return type === 'put'
    ? K * Math.exp(-r * T) * normCDF(-d2) - S * normCDF(-d1)
    : S * normCDF(d1) - K * Math.exp(-r * T) * normCDF(d2)
}

function bsmDelta(S: number, K: number, T: number, r: number, sigma: number, type: 'put' | 'call'): number {
  if (T <= 0.00001) return 0
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T))
  return type === 'put' ? normCDF(d1) - 1 : normCDF(d1)
}

function findStrike(S: number, iv: number, T: number, targetDelta: number, type: 'put' | 'call'): number {
  let lo = S * 0.5, hi = S * 1.5
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2
    const d = Math.abs(bsmDelta(S, mid, T, 0.045, iv, type))
    if (d > targetDelta) { type === 'put' ? (hi = mid) : (lo = mid) }
    else { type === 'put' ? (lo = mid) : (hi = mid) }
  }
  return Math.round((lo + hi) / 2)
}

// ── Backtest engine ──────────────────────────────────────────────────────────

interface BacktestParams {
  strategy: 'covered_call' | 'csp' | 'wheel'
  ticker: string
  startPrice: number
  iv: number
  delta: number
  dte: number
  weeks: number
  startCapital: number
  sharesPerLot: number
}

interface BacktestTrade {
  week: number
  action: string
  strike: number
  premium: number
  outcome: 'win' | 'loss' | 'assigned' | 'called'
  pnl: number
  capital: number
  stockPrice: number
}

interface BacktestResult {
  trades: BacktestTrade[]
  finalCapital: number
  totalPremium: number
  totalPnL: number
  winRate: number
  maxDrawdown: number
  sharpeApprox: number
  roi: number
  assignedCount: number
  calledCount: number
  avgPremiumPerCycle: number
}

function runBacktest(params: BacktestParams): BacktestResult {
  const { strategy, startPrice, iv, delta, dte, weeks, startCapital, sharesPerLot } = params
  const r = 0.045
  const T = dte / 365
  const weeklyDrift = 0.0015
  const weeklyVol = iv / Math.sqrt(52)

  const trades: BacktestTrade[] = []
  let capital = startCapital
  let maxCapital = capital
  let maxDrawdown = 0
  let holdingShares = strategy === 'covered_call'
  let costBasis = startPrice
  let price = startPrice
  let totalPremium = 0
  let assignedCount = 0
  let calledCount = 0

  let seed = 42
  const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
  const normalRand = () => {
    const u1 = rand(), u2 = rand()
    return Math.sqrt(-2 * Math.log(Math.max(u1, 0.0001))) * Math.cos(2 * Math.PI * u2)
  }

  for (let w = 0; w < weeks; w += Math.ceil(dte / 7)) {
    const priceReturn = weeklyDrift * (dte / 7) + weeklyVol * Math.sqrt(dte / 7) * normalRand()
    const newPrice = price * (1 + priceReturn)

    if (strategy === 'csp' || (strategy === 'wheel' && !holdingShares)) {
      const strike = findStrike(price, iv, T, delta, 'put')
      const premium = bsmPrice(price, strike, T, r, iv, 'put') * sharesPerLot
      totalPremium += premium

      if (newPrice < strike) {
        holdingShares = strategy === 'wheel'
        costBasis = strike - premium / sharesPerLot
        const loss = (strike - newPrice) * sharesPerLot - premium
        capital -= loss
        assignedCount++
        trades.push({ week: w, action: 'CSP', strike, premium, outcome: 'assigned', pnl: -loss, capital, stockPrice: newPrice })
      } else {
        capital += premium
        trades.push({ week: w, action: 'CSP', strike, premium, outcome: 'win', pnl: premium, capital, stockPrice: newPrice })
      }

    } else if (strategy === 'covered_call' || (strategy === 'wheel' && holdingShares)) {
      const strike = findStrike(price, iv, T, delta, 'call')
      const premium = bsmPrice(price, strike, T, r, iv, 'call') * sharesPerLot
      totalPremium += premium

      const stockPnL = (newPrice - price) * sharesPerLot

      if (newPrice > strike) {
        const gain = (strike - costBasis) * sharesPerLot + premium
        capital += gain + stockPnL
        holdingShares = strategy !== 'wheel'
        calledCount++
        trades.push({ week: w, action: 'CC', strike, premium, outcome: 'called', pnl: gain, capital, stockPrice: newPrice })
        if (strategy === 'wheel') costBasis = newPrice
      } else {
        capital += premium + stockPnL
        trades.push({ week: w, action: 'CC', strike, premium, outcome: 'win', pnl: premium + stockPnL, capital, stockPrice: newPrice })
      }
    }

    price = newPrice
    if (capital > maxCapital) maxCapital = capital
    const dd = (maxCapital - capital) / maxCapital
    if (dd > maxDrawdown) maxDrawdown = dd
  }

  const wins = trades.filter(t => t.outcome === 'win' || t.outcome === 'called')
  const pnls = trades.map(t => t.pnl)
  const avgPnl = pnls.length ? pnls.reduce((a, b) => a + b, 0) / pnls.length : 0
  const stdPnl = Math.sqrt(pnls.reduce((s, p) => s + (p - avgPnl) ** 2, 0) / Math.max(pnls.length - 1, 1))

  return {
    trades,
    finalCapital: capital,
    totalPremium,
    totalPnL: capital - startCapital,
    winRate: trades.length ? (wins.length / trades.length) * 100 : 0,
    maxDrawdown: maxDrawdown * 100,
    sharpeApprox: stdPnl > 0 ? (avgPnl / stdPnl) * Math.sqrt(52 / Math.ceil(dte / 7)) : 0,
    roi: ((capital - startCapital) / startCapital) * 100,
    assignedCount,
    calledCount,
    avgPremiumPerCycle: trades.length ? totalPremium / trades.length : 0,
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt$(n: number, d = 0) {
  return (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
}

// ── Tile styles ──────────────────────────────────────────────────────────────

const tile: React.CSSProperties = {
  background: '#131726', border: '1px solid #1E2540', borderRadius: 10,
  overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0,
}
const tileHdr: React.CSSProperties = {
  padding: '12px 20px', borderBottom: '1px solid #1E2540',
  fontSize: 13, fontWeight: 700, color: '#5D6580', letterSpacing: '0.08em', flexShrink: 0,
}

// ── Main view ────────────────────────────────────────────────────────────────

// IA13 watchlist
const DEFAULT_TICKERS = ['ALAB','AMD','ARM','ASML','AVGO','GOOG','MRVL','MU','NVDA','PLTR','TSLA','TSM','MSTR']
const DEFAULT_PRICES: Record<string, number> = {
  ALAB: 90, AMD: 160, ARM: 170, ASML: 700, AVGO: 200,
  GOOG: 170, MRVL: 80, MU: 100, NVDA: 120, PLTR: 120,
  TSLA: 280, TSM: 190, MSTR: 400,
}
const DEFAULT_IVS: Record<string, number> = {
  ALAB: 0.60, AMD: 0.40, ARM: 0.55, ASML: 0.35, AVGO: 0.40,
  GOOG: 0.30, MRVL: 0.50, MU: 0.45, NVDA: 0.45, PLTR: 0.50,
  TSLA: 0.55, TSM: 0.35, MSTR: 0.80,
}

export default function BacktestView({ state }: Props) {
  const [ticker, setTicker] = useState('NVDA')
  const [strategy, setStrategy] = useState<'covered_call' | 'csp' | 'wheel'>('wheel')
  const [delta, setDelta] = useState(0.20)
  const [dte, setDte] = useState(30)
  const [weeks, setWeeks] = useState(104)
  const [startCap, setStartCap] = useState(50000)
  const [result, setResult] = useState<BacktestResult | null>(null)

  const tickers = useMemo(() => {
    const set = new Set<string>()
    for (const p of state.sync.positions) {
      const sym = p.underlyingSymbol ?? (p.assetClass === 'STK' ? p.symbol : null)
      if (sym) set.add(sym)
    }
    if (set.size === 0) DEFAULT_TICKERS.forEach(s => set.add(s))
    return [...set].sort()
  }, [state.sync.positions])

  const handleRun = useCallback(() => {
    const price = DEFAULT_PRICES[ticker] ?? 100
    const iv = DEFAULT_IVS[ticker] ?? 0.50
    const r = runBacktest({ strategy, ticker, startPrice: price, iv, delta, dte, weeks, startCapital: startCap, sharesPerLot: 100 })
    setResult(r)
  }, [ticker, strategy, delta, dte, weeks, startCap])

  const inputStyle: React.CSSProperties = {
    background: '#0B0E18', border: '1px solid #1E2540', borderRadius: 6,
    color: '#EAEDF3', padding: '9px 12px', fontSize: 14,
    fontFamily: 'IBM Plex Mono, monospace', outline: 'none', width: '100%',
  }

  const selectStyle: React.CSSProperties = { ...inputStyle, cursor: 'pointer' }

  return (
    <div style={{ padding: 20, height: '100%', display: 'flex', flexDirection: 'column', gap: 14, overflow: 'hidden' }}>

      {/* ── Parameters bar ──────────────────────────────────────────────── */}
      <div style={{ background: '#131726', border: '1px solid #1E2540', borderRadius: 10, padding: '14px 20px', flexShrink: 0 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 10, alignItems: 'end' }}>
          <div>
            <div style={{ fontSize: 11, color: '#5D6580', letterSpacing: 1, marginBottom: 3 }}>TICKER</div>
            <select value={ticker} onChange={e => setTicker(e.target.value)} style={selectStyle}>
              {tickers.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#5D6580', letterSpacing: 1, marginBottom: 3 }}>STRATEGY</div>
            <select value={strategy} onChange={e => setStrategy(e.target.value as typeof strategy)} style={selectStyle}>
              <option value="wheel">Wheel</option>
              <option value="covered_call">Covered Call</option>
              <option value="csp">Cash-Secured Put</option>
            </select>
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#5D6580', letterSpacing: 1, marginBottom: 3 }}>DELTA</div>
            <select value={delta} onChange={e => setDelta(Number(e.target.value))} style={selectStyle}>
              {[0.10, 0.15, 0.20, 0.25, 0.30].map(d => <option key={d} value={d}>{d.toFixed(2)}</option>)}
            </select>
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#5D6580', letterSpacing: 1, marginBottom: 3 }}>DTE</div>
            <select value={dte} onChange={e => setDte(Number(e.target.value))} style={selectStyle}>
              {[7, 14, 21, 30, 45].map(d => <option key={d} value={d}>{d}d</option>)}
            </select>
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#5D6580', letterSpacing: 1, marginBottom: 3 }}>DURATION</div>
            <select value={weeks} onChange={e => setWeeks(Number(e.target.value))} style={selectStyle}>
              <option value={52}>1Y</option>
              <option value={104}>2Y</option>
              <option value={156}>3Y</option>
            </select>
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#5D6580', letterSpacing: 1, marginBottom: 3 }}>CAPITAL</div>
            <input type="number" value={startCap} onChange={e => setStartCap(Number(e.target.value))} style={inputStyle} />
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={handleRun} style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
              padding: '10px 16px', background: '#6366F1', border: 'none', borderRadius: 6,
              color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
            }}>
              <Play size={12} /> Run
            </button>
            <button onClick={() => setResult(null)} style={{
              padding: '8px 10px', background: '#131726', border: '1px solid #1E2540', borderRadius: 6,
              color: '#5D6580', cursor: 'pointer', display: 'flex', alignItems: 'center',
            }}>
              <RotateCcw size={12} />
            </button>
          </div>
        </div>
      </div>

      {/* ── Results ─────────────────────────────────────────────────────── */}
      {result && (
        <>
          {/* Stats row */}
          <div style={{ display: 'grid', gridTemplateColumns: strategy === 'wheel' ? 'repeat(9, 1fr)' : 'repeat(6, 1fr)', gap: 8, flexShrink: 0 }}>
            {[
              { label: 'FINAL', value: fmt$(result.finalCapital), color: '#EAEDF3' },
              { label: 'ROI', value: result.roi.toFixed(1) + '%', color: result.roi >= 0 ? '#10b981' : '#f43f5e' },
              { label: 'WIN RATE', value: result.winRate.toFixed(0) + '%', color: result.winRate >= 70 ? '#10b981' : '#f59e0b' },
              { label: 'MAX DD', value: result.maxDrawdown.toFixed(1) + '%', color: result.maxDrawdown < 15 ? '#10b981' : '#f43f5e' },
              { label: 'PREMIUM', value: fmt$(result.totalPremium), color: '#10b981' },
              { label: 'AVG/CYCLE', value: fmt$(result.avgPremiumPerCycle), color: '#3b82f6' },
              ...(strategy === 'wheel' ? [
                { label: 'ASSIGNED', value: String(result.assignedCount), color: '#f59e0b' },
                { label: 'CALLED', value: String(result.calledCount), color: '#3b82f6' },
                { label: 'CYCLES', value: String(Math.min(result.assignedCount, result.calledCount)), color: '#10b981' },
              ] : []),
            ].map(s => (
              <div key={s.label} className="stat-card">
                <div className="stat-label">{s.label}</div>
                <div className="stat-value" style={{ color: s.color, fontSize: 22 }}>{s.value}</div>
              </div>
            ))}
          </div>

          {/* Equity curve + Trade log side by side */}
          <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, minHeight: 0 }}>

            {/* Equity curve tile */}
            <div style={tile}>
              <div style={tileHdr}>EQUITY CURVE</div>
              <div style={{ flex: 1, padding: '12px 16px', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 1, flex: 1, minHeight: 0 }}>
                  {result.trades.map((t, i) => {
                    const maxCap = Math.max(...result.trades.map(x => x.capital), startCap)
                    const minCap = Math.min(...result.trades.map(x => x.capital), startCap)
                    const range = maxCap - minCap || 1
                    const pct = ((t.capital - minCap) / range) * 100
                    return (
                      <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', justifyContent: 'flex-end' }}
                        title={`Wk ${t.week}: ${fmt$(t.capital)} · ${t.action} ${t.outcome}`}>
                        <div style={{
                          width: '100%', height: `${Math.max(pct, 2)}%`, minHeight: 2,
                          background: t.outcome === 'win' ? '#10b981' : t.outcome === 'called' ? '#3b82f6' : t.outcome === 'assigned' ? '#f59e0b' : '#f43f5e',
                          borderRadius: '1px 1px 0 0', opacity: 0.8,
                        }} />
                      </div>
                    )
                  })}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 11, color: '#5D6580', fontFamily: 'IBM Plex Mono, monospace', flexShrink: 0 }}>
                  <span>Wk 0</span>
                  <span style={{ display: 'flex', gap: 10 }}>
                    <span><span style={{ color: '#10b981' }}>|</span> Win</span>
                    <span><span style={{ color: '#3b82f6' }}>|</span> Called</span>
                    <span><span style={{ color: '#f59e0b' }}>|</span> Assigned</span>
                    <span><span style={{ color: '#f43f5e' }}>|</span> Loss</span>
                  </span>
                  <span>Wk {result.trades[result.trades.length - 1]?.week ?? 0}</span>
                </div>
              </div>
            </div>

            {/* Trade log tile */}
            <div style={tile}>
              <div style={tileHdr}>TRADE LOG ({result.trades.length})</div>
              <div style={{ flex: 1, overflow: 'auto' }}>
                <table className="trade-table" style={{ fontSize: 13 }}>
                  <thead>
                    <tr>
                      {['WK', 'TYPE', 'STRIKE', 'STOCK', 'PREM', 'RESULT', 'P&L', 'CAPITAL'].map(h => (
                        <th key={h} style={{ padding: '9px 12px', fontSize: 11 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.trades.slice(0, 50).map((t, i) => {
                      const oc = t.outcome === 'win' ? '#10b981' : t.outcome === 'called' ? '#3b82f6' : t.outcome === 'assigned' ? '#f59e0b' : '#f43f5e'
                      return (
                        <tr key={i}>
                          <td className="mono" style={{ padding: '8px 12px', color: '#5D6580' }}>{t.week}</td>
                          <td style={{ padding: '8px 12px' }}>
                            <span style={{ fontSize: 11, fontWeight: 600, padding: '1px 5px', border: `1px solid ${t.action === 'CC' ? '#3b82f620' : '#f43f5e20'}`, color: t.action === 'CC' ? '#818cf8' : '#f43f5e' }}>
                              {t.action}
                            </span>
                          </td>
                          <td className="mono" style={{ padding: '8px 12px', color: '#EAEDF3' }}>{fmt$(t.strike)}</td>
                          <td className="mono" style={{ padding: '8px 12px', color: '#9198AE' }}>{fmt$(t.stockPrice, 2)}</td>
                          <td className="mono" style={{ padding: '8px 12px', color: '#10b981' }}>{fmt$(t.premium)}</td>
                          <td style={{ padding: '8px 12px' }}>
                            <span style={{ fontSize: 11, fontWeight: 700, color: oc, letterSpacing: 1 }}>{t.outcome.toUpperCase()}</span>
                          </td>
                          <td className="mono" style={{ padding: '8px 12px', color: t.pnl >= 0 ? '#10b981' : '#f43f5e' }}>{fmt$(t.pnl)}</td>
                          <td className="mono" style={{ padding: '8px 12px', color: '#EAEDF3', fontWeight: 600 }}>{fmt$(t.capital)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                {result.trades.length > 50 && (
                  <div style={{ padding: '6px 16px', color: '#5D6580', fontSize: 12, borderTop: '1px solid #1E2540' }}>
                    First 50 of {result.trades.length}
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── Empty state ─────────────────────────────────────────────────── */}
      {!result && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#5D6580' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 16, marginBottom: 8 }}>Configure parameters above and press <span style={{ color: '#6366F1', fontWeight: 600 }}>Run</span></div>
            <div style={{ fontSize: 14 }}>
              BSM-priced wheel/CC/CSP simulation with geometric Brownian motion
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
