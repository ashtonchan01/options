import { useMemo } from 'react'
import type { AppState, RawTrade } from '../../types'
import EmptyState from '../shared/EmptyState'

interface Props { state: AppState }

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt$(n: number, d = 0) {
  return (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
}

function monthKey(dateStr: string): string {
  if (dateStr.length === 8) return `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}`
  return dateStr.slice(0, 7)
}

function monthLabel(key: string): string {
  const [y, m] = key.split('-')
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
}

// ─── Tile styles ─────────────────────────────────────────────────────────────

const tile: React.CSSProperties = {
  background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10,
  overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0,
}
const tileHdr: React.CSSProperties = {
  padding: '12px 20px', borderBottom: '1px solid var(--border)',
  fontSize: 13, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.08em', flexShrink: 0,
}

// ─── Wheel phase ─────────────────────────────────────────────────────────────

type WheelPhase = 'csp' | 'assigned' | 'covered_call' | 'called_away' | 'idle'

const PHASE_CONFIG: Record<WheelPhase, { label: string; color: string; desc: string }> = {
  csp:          { label: 'Selling CSP',     color: '#f43f5e', desc: 'Cash-secured put — collecting premium' },
  assigned:     { label: 'Assigned',        color: '#f59e0b', desc: 'Put exercised — shares acquired' },
  covered_call: { label: 'Selling CC',      color: '#3b82f6', desc: 'Covered call — premium + shares' },
  called_away:  { label: 'Called Away',     color: '#10b981', desc: 'Shares called — back to cash' },
  idle:         { label: 'Idle',            color: 'var(--text-5)', desc: 'No active position' },
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
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: '100%', minHeight: 80, paddingBottom: 24, position: 'relative' }}>
      {/* Zero line */}
      <div style={{ position: 'absolute', bottom: 24, left: 0, right: 0, height: 1, background: 'var(--border)' }} />

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
            <div style={{ position: 'absolute', bottom: 4, left: '50%', transform: 'translateX(-50%)', fontSize: 11, color: 'var(--text-3)', fontFamily: 'Share Tech Mono, monospace', whiteSpace: 'nowrap' }}>
              {m.label}
            </div>
          </div>
        )
      })}
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, overflow: 'auto', flex: 1, padding: '0 4px' }}>
      {underlyings.map(sym => {
        const phase = derivePhase(sym, state.strategies, state.sync.positions)
        const cfg   = PHASE_CONFIG[phase]
        const stk   = state.sync.positions.find(p => p.assetClass === 'STK' && p.symbol === sym)
        const cc    = state.strategies.find(s => s.type === 'covered_call' && s.underlying === sym)
        const csp   = state.strategies.find(s => s.type === 'csp' && s.underlying === sym)
        const active = cc ?? csp

        return (
          <div key={sym} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--bg-elevated)', borderRadius: 8 }}>
            <span style={{ fontWeight: 700, color: 'var(--text-1)', fontFamily: 'Share Tech Mono, monospace', fontSize: 14, minWidth: 50 }}>
              {sym}
            </span>
            <span style={{
              padding: '2px 7px', fontSize: 11, fontWeight: 700, letterSpacing: '0.06em',
              color: cfg.color, background: `${cfg.color}14`, border: `1px solid ${cfg.color}30`,
              flexShrink: 0,
            }}>
              {cfg.label}
            </span>
            <span style={{ fontSize: 12, color: 'var(--text-3)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cfg.desc}</span>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              {stk && (
                <div style={{ fontSize: 12, fontFamily: 'Share Tech Mono, monospace', color: 'var(--text-3)' }}>
                  {stk.quantity} sh
                </div>
              )}
              {active && (
                <div style={{ fontSize: 12, fontFamily: 'Share Tech Mono, monospace', color: active.unrealizedPnL >= 0 ? '#10b981' : '#f43f5e' }}>
                  {active.unrealizedPnL >= 0 ? '+' : ''}{fmt$(active.unrealizedPnL)}
                </div>
              )}
            </div>
          </div>
        )
      })}
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
    <div style={{ padding: 20, height: '100%', display: 'flex', flexDirection: 'column', gap: 14, overflow: 'hidden' }}>

      {/* ── Stats row ──────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8, flexShrink: 0 }}>
        {[
          { label: 'PREMIUM COLLECTED', value: fmt$(totalPremiumCollected), color: '#10b981' },
          { label: 'REALIZED P&L', value: fmt$(totalRealizedPnL), color: totalRealizedPnL >= 0 ? '#10b981' : '#f43f5e' },
          { label: 'AVG MONTHLY', value: fmt$(avgMonthlyIncome), color: avgMonthlyIncome >= 0 ? '#10b981' : '#f43f5e' },
          { label: 'COMMISSIONS', value: fmt$(Math.abs(totalCommissions)), color: '#f43f5e' },
          { label: 'BEST MONTH', value: bestMonth ? fmt$(bestMonth.total) : '—', color: '#10b981' },
        ].map(({ label, value, color }) => (
          <div key={label} className="stat-card">
            <div className="stat-label">{label}</div>
            <div className="stat-value" style={{ color, fontSize: 28 }}>{value}</div>
          </div>
        ))}
      </div>

      {/* ── Main tiles (chart left, wheel right) ───────────────────────── */}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 12, minHeight: 0 }}>

        {/* Monthly P&L chart tile */}
        <div style={tile}>
          <div style={tileHdr}>MONTHLY NET P&L</div>
          <div style={{ flex: 1, padding: '12px 16px', overflow: 'hidden' }}>
            <BarChart months={months} />
          </div>
        </div>

        {/* Wheel phase tile */}
        <div style={tile}>
          <div style={tileHdr}>WHEEL PHASE</div>
          <div style={{ flex: 1, overflow: 'auto', padding: 8 }}>
            <WheelTracker state={state} />
          </div>
        </div>
      </div>

      {/* ── Monthly breakdown tile (bottom) ────────────────────────────── */}
      {months.length > 0 && (
        <div style={{ ...tile, maxHeight: 220, flexShrink: 0 }}>
          <div style={tileHdr}>MONTHLY BREAKDOWN</div>
          <div style={{ overflow: 'auto', flex: 1 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['MONTH', 'OPTION P&L', 'STOCK P&L', 'NET', 'TRADES'].map(h => (
                    <th key={h} style={{ padding: '10px 16px', fontSize: 12, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.06em', textAlign: h === 'MONTH' ? 'left' : 'right' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...months].reverse().map((m, i) => (
                  <tr key={m.key} style={{ borderBottom: '1px solid var(--border-light)', background: i % 2 ? 'var(--bg-page)' : 'transparent' }}>
                    <td style={{ padding: '10px 16px', fontFamily: 'Share Tech Mono, monospace', color: 'var(--text-3)' }}>{m.label}</td>
                    <td style={{ padding: '10px 16px', textAlign: 'right', fontFamily: 'Share Tech Mono, monospace', color: m.optionPnL >= 0 ? '#10b981' : '#f43f5e' }}>{fmt$(m.optionPnL)}</td>
                    <td style={{ padding: '10px 16px', textAlign: 'right', fontFamily: 'Share Tech Mono, monospace', color: m.stockPnL >= 0 ? '#10b981' : '#f43f5e' }}>{fmt$(m.stockPnL)}</td>
                    <td style={{ padding: '10px 16px', textAlign: 'right', fontFamily: 'Share Tech Mono, monospace', fontWeight: 600, color: m.total >= 0 ? '#10b981' : '#f43f5e' }}>{fmt$(m.total)}</td>
                    <td style={{ padding: '10px 16px', textAlign: 'right', fontFamily: 'Share Tech Mono, monospace', color: 'var(--text-5)' }}>{m.tradeCount}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '10px 16px', fontFamily: 'Share Tech Mono, monospace', color: 'var(--text-4)', fontWeight: 700 }}>TOTAL</td>
                  <td style={{ padding: '10px 16px', textAlign: 'right', fontFamily: 'Share Tech Mono, monospace', fontWeight: 600, color: months.reduce((s,m)=>s+m.optionPnL,0) >= 0 ? '#10b981' : '#f43f5e' }}>
                    {fmt$(months.reduce((s,m)=>s+m.optionPnL,0))}
                  </td>
                  <td style={{ padding: '10px 16px', textAlign: 'right', fontFamily: 'Share Tech Mono, monospace', fontWeight: 600, color: months.reduce((s,m)=>s+m.stockPnL,0) >= 0 ? '#10b981' : '#f43f5e' }}>
                    {fmt$(months.reduce((s,m)=>s+m.stockPnL,0))}
                  </td>
                  <td style={{ padding: '10px 16px', textAlign: 'right', fontFamily: 'Share Tech Mono, monospace', fontWeight: 700, color: totalRealizedPnL >= 0 ? '#10b981' : '#f43f5e' }}>
                    {fmt$(totalRealizedPnL)}
                  </td>
                  <td style={{ padding: '10px 16px', textAlign: 'right', fontFamily: 'Share Tech Mono, monospace', color: 'var(--text-4)' }}>
                    {months.reduce((s,m)=>s+m.tradeCount,0)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
