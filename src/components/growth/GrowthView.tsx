import { useMemo } from 'react'
import type { AppState, RawTrade } from '../../types'
import EmptyState from '../shared/EmptyState'

interface Props { state: AppState }

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt$(n: number, d = 0) {
  return (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
}

function monthKey(dateStr: string): string {
  // YYYYMMDD → YYYY-MM
  if (dateStr.length === 8) return `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}`
  return dateStr.slice(0, 7)
}

function monthLabel(key: string): string {
  const [y, m] = key.split('-')
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
}

// ─── Wheel phase ─────────────────────────────────────────────────────────────

type WheelPhase = 'csp' | 'assigned' | 'covered_call' | 'called_away' | 'idle'

const PHASE_CONFIG: Record<WheelPhase, { label: string; color: string; desc: string }> = {
  csp:          { label: 'Selling CSP',     color: '#f43f5e', desc: 'Cash-secured put — collecting premium, neutral to bullish' },
  assigned:     { label: 'Assigned',        color: '#f59e0b', desc: 'Put exercised — shares acquired at strike, ready for CC' },
  covered_call: { label: 'Selling CC',      color: '#3b82f6', desc: 'Covered call — collecting premium while holding shares' },
  called_away:  { label: 'Called Away',     color: '#10b981', desc: 'Shares called away — back to cash, ready to restart' },
  idle:         { label: 'Idle',            color: '#333',    desc: 'No active position' },
}

function derivePhase(underlying: string, strategies: AppState['strategies'], positions: AppState['sync']['positions']): WheelPhase {
  const hasCC  = strategies.some(s => s.type === 'covered_call' && s.underlying === underlying)
  const hasCSP = strategies.some(s => s.type === 'csp' && s.underlying === underlying)
  const hasStk = positions.some(p => p.assetClass === 'STK' && p.symbol === underlying && p.quantity > 0)

  if (hasCC) return 'covered_call'
  if (hasCSP) return 'csp'
  if (hasStk) return 'assigned'
  return 'idle'
}

// ─── Monthly P&L from trades ──────────────────────────────────────────────────

interface MonthData {
  key: string
  label: string
  optionPnL: number
  stockPnL: number
  total: number
  tradeCount: number
}

function buildMonthlyData(trades: RawTrade[]): MonthData[] {
  const map = new Map<string, MonthData>()

  for (const t of trades) {
    if (!t.tradeDate) continue
    const key = monthKey(t.tradeDate)
    if (!map.has(key)) map.set(key, { key, label: monthLabel(key), optionPnL: 0, stockPnL: 0, total: 0, tradeCount: 0 })
    const m = map.get(key)!
    const net = t.netCash
    if (t.assetClass === 'OPT') m.optionPnL += net
    else m.stockPnL += net
    m.total += net
    m.tradeCount++
  }

  return [...map.values()].sort((a, b) => a.key.localeCompare(b.key))
}

// ─── Bar chart ────────────────────────────────────────────────────────────────

function BarChart({ months }: { months: MonthData[] }) {
  if (!months.length) return null

  const maxAbs = Math.max(...months.map(m => Math.abs(m.total)), 1)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#2a2a2a', letterSpacing: '0.08em' }}>MONTHLY NET P&L</div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 120, paddingBottom: 24, position: 'relative' }}>
        {/* Zero line */}
        <div style={{ position: 'absolute', bottom: 24, left: 0, right: 0, height: 1, background: '#1a1a1a' }} />

        {months.map(m => {
          const pct = Math.abs(m.total) / maxAbs
          const isPos = m.total >= 0
          const barH = Math.max(pct * 90, 2)

          return (
            <div key={m.key} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%', position: 'relative' }}
              title={`${m.label}: ${fmt$(m.total)} (${m.tradeCount} trades)`}
            >
              <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end', width: '100%', paddingBottom: 0 }}>
                {isPos ? (
                  <div style={{ width: '100%', height: barH, background: '#10b981', borderRadius: '1px 1px 0 0', opacity: 0.85 }} />
                ) : (
                  <div style={{ width: '100%', height: barH, background: '#f43f5e', borderRadius: '1px 1px 0 0', opacity: 0.85, alignSelf: 'flex-start', marginTop: 'auto' }} />
                )}
              </div>
              <div style={{ position: 'absolute', bottom: 4, left: '50%', transform: 'translateX(-50%)', fontSize: 9, color: '#2a2a2a', fontFamily: 'IBM Plex Mono, monospace', whiteSpace: 'nowrap' }}>
                {m.label}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Wheel phase tracker ──────────────────────────────────────────────────────

function WheelTracker({ state }: { state: AppState }) {
  const underlyings = useMemo(() => {
    const set = new Set<string>()
    for (const p of state.sync.positions) {
      const sym = p.underlyingSymbol ?? (p.assetClass === 'STK' ? p.symbol : null)
      if (sym) set.add(sym)
    }
    for (const s of state.strategies) set.add(s.underlying)
    return [...set].sort()
  }, [state])

  if (!underlyings.length) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#2a2a2a', letterSpacing: '0.08em' }}>WHEEL PHASE</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {underlyings.map(sym => {
          const phase = derivePhase(sym, state.strategies, state.sync.positions)
          const cfg   = PHASE_CONFIG[phase]
          const stk   = state.sync.positions.find(p => p.assetClass === 'STK' && p.symbol === sym)
          const cc    = state.strategies.find(s => s.type === 'covered_call' && s.underlying === sym)
          const csp   = state.strategies.find(s => s.type === 'csp' && s.underlying === sym)
          const active = cc ?? csp

          return (
            <div key={sym} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: '#0d0d0d', border: '1px solid #111' }}>
              <span style={{ fontWeight: 700, color: '#ccc', fontFamily: 'IBM Plex Mono, monospace', fontSize: 13, minWidth: 60 }}>
                {sym}
              </span>
              <span style={{
                padding: '2px 8px', fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
                color: cfg.color, background: `${cfg.color}14`, border: `1px solid ${cfg.color}30`,
                flexShrink: 0,
              }}>
                {cfg.label}
              </span>
              <span style={{ fontSize: 11, color: '#333', flex: 1 }}>{cfg.desc}</span>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                {stk && (
                  <div style={{ fontSize: 11, fontFamily: 'IBM Plex Mono, monospace', color: '#555' }}>
                    {stk.quantity} shares
                  </div>
                )}
                {active && (
                  <div style={{ fontSize: 11, fontFamily: 'IBM Plex Mono, monospace', color: active.unrealizedPnL >= 0 ? '#10b981' : '#f43f5e' }}>
                    {active.unrealizedPnL >= 0 ? '+' : ''}{fmt$(active.unrealizedPnL)}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Main ────────────────────────────────────────────────────────────────────

export default function GrowthView({ state }: Props) {
  const { trades } = state.sync

  if (!state.strategies.length && !trades.length) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <EmptyState title="No data" message="Sync your IBKR portfolio to track premium income and growth." showUpload />
      </div>
    )
  }

  const months   = useMemo(() => buildMonthlyData(trades), [trades])
  const optTrades = trades.filter(t => t.assetClass === 'OPT')
  const totalPremiumCollected = optTrades.filter(t => t.quantity < 0 && t.netCash > 0).reduce((s, t) => s + t.netCash, 0)
  const totalRealizedPnL      = trades.reduce((s, t) => s + t.netCash, 0)
  const totalCommissions      = trades.reduce((s, t) => s + t.commissions, 0)
  const monthsWithData        = months.filter(m => m.total !== 0)
  const avgMonthlyIncome      = monthsWithData.length ? monthsWithData.reduce((s, m) => s + m.total, 0) / monthsWithData.length : 0
  const bestMonth             = months.reduce((best, m) => m.total > best.total ? m : best, months[0] ?? { total: 0, label: '—' })

  return (
    <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* ── Summary stats ─────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
        {[
          { label: 'PREMIUM COLLECTED', value: fmt$(totalPremiumCollected), color: '#10b981' },
          { label: 'TOTAL REALIZED P&L', value: fmt$(totalRealizedPnL), color: totalRealizedPnL >= 0 ? '#10b981' : '#f43f5e' },
          { label: 'AVG MONTHLY',  value: fmt$(avgMonthlyIncome), color: avgMonthlyIncome >= 0 ? '#10b981' : '#f43f5e' },
          { label: 'COMMISSIONS',  value: fmt$(Math.abs(totalCommissions)), color: '#f43f5e' },
          { label: 'BEST MONTH',   value: bestMonth ? fmt$(bestMonth.total) : '—', color: '#10b981' },
        ].map(({ label, value, color }) => (
          <div key={label} className="stat-card">
            <div className="stat-label">{label}</div>
            <div className="stat-value" style={{ color, fontSize: 24 }}>{value}</div>
          </div>
        ))}
      </div>

      {/* ── Monthly chart ─────────────────────────────────────────────────── */}
      {months.length > 0 && (
        <div style={{ background: '#0d0d0d', border: '1px solid #1a1a1a', padding: '16px 20px' }}>
          <BarChart months={months} />
        </div>
      )}

      {/* ── Monthly breakdown table ───────────────────────────────────────── */}
      {months.length > 0 && (
        <div style={{ background: '#0d0d0d', border: '1px solid #1a1a1a' }}>
          <div style={{ padding: '10px 16px', borderBottom: '1px solid #111', fontSize: 11, fontWeight: 700, color: '#2a2a2a', letterSpacing: '0.08em' }}>
            MONTHLY BREAKDOWN
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #111' }}>
                {['MONTH', 'OPTION P&L', 'STOCK P&L', 'NET', 'TRADES'].map(h => (
                  <th key={h} style={{ padding: '8px 16px', fontSize: 10, fontWeight: 700, color: '#2a2a2a', letterSpacing: '0.06em', textAlign: h === 'MONTH' ? 'left' : 'right' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...months].reverse().map((m, i) => (
                <tr key={m.key} style={{ borderBottom: '1px solid #0f0f0f', background: i % 2 ? '#0a0a0a' : 'transparent' }}>
                  <td style={{ padding: '9px 16px', fontFamily: 'IBM Plex Mono, monospace', color: '#666' }}>{m.label}</td>
                  <td style={{ padding: '9px 16px', textAlign: 'right', fontFamily: 'IBM Plex Mono, monospace', color: m.optionPnL >= 0 ? '#10b981' : '#f43f5e' }}>{fmt$(m.optionPnL)}</td>
                  <td style={{ padding: '9px 16px', textAlign: 'right', fontFamily: 'IBM Plex Mono, monospace', color: m.stockPnL >= 0 ? '#10b981' : '#f43f5e' }}>{fmt$(m.stockPnL)}</td>
                  <td style={{ padding: '9px 16px', textAlign: 'right', fontFamily: 'IBM Plex Mono, monospace', fontWeight: 600, color: m.total >= 0 ? '#10b981' : '#f43f5e' }}>{fmt$(m.total)}</td>
                  <td style={{ padding: '9px 16px', textAlign: 'right', fontFamily: 'IBM Plex Mono, monospace', color: '#333' }}>{m.tradeCount}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: '1px solid #1a1a1a' }}>
                <td style={{ padding: '10px 16px', fontFamily: 'IBM Plex Mono, monospace', color: '#444', fontWeight: 700 }}>TOTAL</td>
                <td style={{ padding: '10px 16px', textAlign: 'right', fontFamily: 'IBM Plex Mono, monospace', fontWeight: 600, color: months.reduce((s,m)=>s+m.optionPnL,0) >= 0 ? '#10b981' : '#f43f5e' }}>
                  {fmt$(months.reduce((s,m)=>s+m.optionPnL,0))}
                </td>
                <td style={{ padding: '10px 16px', textAlign: 'right', fontFamily: 'IBM Plex Mono, monospace', fontWeight: 600, color: months.reduce((s,m)=>s+m.stockPnL,0) >= 0 ? '#10b981' : '#f43f5e' }}>
                  {fmt$(months.reduce((s,m)=>s+m.stockPnL,0))}
                </td>
                <td style={{ padding: '10px 16px', textAlign: 'right', fontFamily: 'IBM Plex Mono, monospace', fontWeight: 700, color: totalRealizedPnL >= 0 ? '#10b981' : '#f43f5e' }}>
                  {fmt$(totalRealizedPnL)}
                </td>
                <td style={{ padding: '10px 16px', textAlign: 'right', fontFamily: 'IBM Plex Mono, monospace', color: '#444' }}>
                  {months.reduce((s,m)=>s+m.tradeCount,0)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* ── Wheel phase tracker ───────────────────────────────────────────── */}
      <WheelTracker state={state} />
    </div>
  )
}
