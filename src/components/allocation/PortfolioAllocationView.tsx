/**
 * Portfolio Allocation — generic version. Current Allocation is always
 * derived automatically from this account's trades (net shares + avg cost
 * per ticker, no live quotes needed). Target Allocation is entirely
 * user-defined: add a ticker, specify it by number of shares, % of
 * portfolio, or a flat $ amount, and it's compared against what's actually
 * held. Persisted per account so it survives reloads.
 */
import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import type { AppState, RawTrade } from '../../types'

function fmt$(n: number): string {
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`
  return `${sign}$${abs.toFixed(0)}`
}

function tickerColor(i: number): string {
  const hue = (i * 47) % 360
  return `hsl(${hue}, 62%, 55%)`
}

interface Holding { symbol: string; shares: number; avgCost: number; value: number }

/** Net open shares + weighted avg cost per stock ticker, straight from raw
 * trade history — no live quote dependency, so "current allocation" works
 * for any uploaded statement without an extra API round-trip. Value is the
 * remaining cost basis (what's actually invested), not a live mark. */
function currentHoldings(trades: RawTrade[]): Holding[] {
  const bySymbol = new Map<string, { shares: number; costBasis: number }>()
  for (const t of trades) {
    if (t.assetClass !== 'STK') continue
    const e = bySymbol.get(t.symbol) ?? { shares: 0, costBasis: 0 }
    if (t.quantity > 0) {
      e.costBasis += t.quantity * t.tradePrice
    } else {
      const avgCost = e.shares > 0 ? e.costBasis / e.shares : 0
      e.costBasis += t.quantity * avgCost
    }
    e.shares += t.quantity
    bySymbol.set(t.symbol, e)
  }
  return [...bySymbol.entries()]
    .filter(([, e]) => Math.abs(e.shares) > 1e-6)
    .map(([symbol, e]) => ({ symbol, shares: e.shares, avgCost: e.shares !== 0 ? e.costBasis / e.shares : 0, value: e.costBasis }))
    .sort((a, b) => b.value - a.value)
}

type TargetMode = 'shares' | 'pct' | 'amount'
interface TargetRow { id: string; ticker: string; mode: TargetMode; value: number }
interface TargetsState { totalValue: number; rows: TargetRow[] }

function targetsKey(accountId: string): string {
  return `options:targets:${accountId}`
}
function loadTargets(accountId: string): TargetsState {
  try {
    const raw = localStorage.getItem(targetsKey(accountId))
    return raw ? JSON.parse(raw) as TargetsState : { totalValue: 0, rows: [] }
  } catch {
    return { totalValue: 0, rows: [] }
  }
}
function saveTargets(accountId: string, state: TargetsState) {
  try { localStorage.setItem(targetsKey(accountId), JSON.stringify(state)) } catch { /* ignore */ }
}

interface Slice { label: string; value: number; color: string }

/** Google-Sheets-style pie: labels sit outside the circle with a bent leader
 * line back to the wedge, instead of a separate legend list. */
function PortfolioPie({ slices, centerLabel, centerValue }: { slices: Slice[]; centerLabel: string; centerValue: string }) {
  const total = slices.reduce((s, x) => s + x.value, 0)
  const W = 440, H = 260, CX = 220, CY = 130, R = 68
  const LABEL_ROW_H = 15
  const ELBOW_R = R + 10
  const OUTER_X = R + 42

  if (total <= 0) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: H, color: 'var(--text-4)', fontSize: 12 }}>No data</div>
  }

  let angle = -90
  const wedges = slices.filter(s => s.value > 0).map(s => {
    const frac = s.value / total
    const start = angle
    const end = angle + frac * 360
    const mid = (start + end) / 2
    angle = end
    const p0 = { x: CX + R * Math.cos(start * Math.PI / 180), y: CY + R * Math.sin(start * Math.PI / 180) }
    const p1 = { x: CX + R * Math.cos(end * Math.PI / 180), y: CY + R * Math.sin(end * Math.PI / 180) }
    const largeArc = end - start > 180 ? 1 : 0
    const midRad = mid * Math.PI / 180
    const edge = { x: CX + R * Math.cos(midRad), y: CY + R * Math.sin(midRad) }
    const elbow = { x: CX + ELBOW_R * Math.cos(midRad), y: CY + ELBOW_R * Math.sin(midRad) }
    const side: 'left' | 'right' = Math.cos(midRad) >= 0 ? 'right' : 'left'
    return {
      ...s, frac,
      path: `M${CX},${CY} L${p0.x},${p0.y} A${R},${R} 0 ${largeArc} 1 ${p1.x},${p1.y} Z`,
      edge, elbow, side, idealY: elbow.y,
    }
  })

  const labeled = wedges.filter(w => w.frac >= 0.012)
  for (const side of ['left', 'right'] as const) {
    const group = labeled.filter(w => w.side === side).sort((a, b) => a.idealY - b.idealY)
    for (let i = 1; i < group.length; i++) {
      const min = group[i - 1].idealY + LABEL_ROW_H
      if (group[i].idealY < min) group[i].idealY = min
    }
    const overflow = group.length > 0 ? group[group.length - 1].idealY - (H - 12) : 0
    if (overflow > 0) for (const w of group) w.idealY -= overflow
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: 440, display: 'block', margin: '0 auto', overflow: 'visible' }}>
      {wedges.map((w, i) => <path key={i} d={w.path} fill={w.color} stroke="var(--bg-card)" strokeWidth={1.5} />)}
      <circle cx={CX} cy={CY} r={30} fill="var(--bg-card)" />
      <text x={CX} y={CY - 5} textAnchor="middle" fontSize="8" fill="var(--text-4)" fontFamily="Inter, sans-serif" letterSpacing="1px">
        {centerLabel.toUpperCase()}
      </text>
      <text x={CX} y={CY + 9} textAnchor="middle" fontSize="12" fontWeight="700" fill="var(--text-1)" fontFamily="Inter, sans-serif">
        {centerValue}
      </text>
      {labeled.map((w, i) => {
        const outX = w.side === 'right' ? CX + OUTER_X : CX - OUTER_X
        const textX = w.side === 'right' ? outX + 4 : outX - 4
        return (
          <g key={i}>
            <polyline
              points={`${w.edge.x},${w.edge.y} ${w.elbow.x},${w.elbow.y} ${outX},${w.idealY}`}
              fill="none" stroke="var(--text-5)" strokeWidth={0.75}
            />
            <text x={textX} y={w.idealY} dy={3} textAnchor={w.side === 'right' ? 'start' : 'end'}
              fontSize="10" fontFamily="Inter, sans-serif" fontWeight={600} fill="var(--text-2)">
              {w.label}
              <tspan fill="var(--text-4)" fontWeight={400}> {(w.frac * 100).toFixed(1)}%</tspan>
            </text>
          </g>
        )
      })}
    </svg>
  )
}

const MODE_LABEL: Record<TargetMode, string> = { shares: 'Shares', pct: '% of portfolio', amount: '$ amount' }

export default function PortfolioAllocationView({ state, accountId }: { state: AppState; accountId: string }) {
  const holdings = currentHoldings(state.sync.trades)
  const currentTotal = holdings.reduce((s, h) => s + h.value, 0)

  const [targets, setTargets] = useState<TargetsState>(() => loadTargets(accountId))
  const [newTicker, setNewTicker] = useState('')
  const [newMode, setNewMode] = useState<TargetMode>('pct')
  const [newValue, setNewValue] = useState('')

  function persist(next: TargetsState) {
    setTargets(next)
    saveTargets(accountId, next)
  }

  function setTotalValue(v: number) {
    persist({ ...targets, totalValue: v })
  }

  function addRow() {
    const ticker = newTicker.trim().toUpperCase()
    const value = parseFloat(newValue)
    if (!ticker || !Number.isFinite(value) || value <= 0) return
    const row: TargetRow = { id: `t_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, ticker, mode: newMode, value }
    persist({ ...targets, rows: [...targets.rows, row] })
    setNewTicker(''); setNewValue('')
  }

  function removeRow(id: string) {
    persist({ ...targets, rows: targets.rows.filter(r => r.id !== id) })
  }

  /** Resolve a target row's $ value — shares needs a per-share price, which
   * comes from this account's own current avg cost if it holds the ticker
   * (best available reference without a live quotes fetch); with no
   * holding to reference, a shares-mode row just can't be priced yet. */
  function rowDollarValue(row: TargetRow): number | null {
    if (row.mode === 'amount') return row.value
    if (row.mode === 'pct') return targets.totalValue > 0 ? row.value / 100 * targets.totalValue : null
    const held = holdings.find(h => h.symbol === row.ticker)
    return held && held.avgCost > 0 ? row.value * held.avgCost : null
  }

  const targetRowsResolved = targets.rows.map((r, i) => ({
    ...r,
    dollarValue: rowDollarValue(r),
    color: tickerColor(i),
  }))
  const targetAllocatedTotal = targetRowsResolved.reduce((s, r) => s + (r.dollarValue ?? 0), 0)

  const currentSlices: Slice[] = holdings.map((h, i) => ({ label: h.symbol, value: h.value, color: tickerColor(i) }))
  const targetSlices: Slice[] = targetRowsResolved
    .filter(r => (r.dollarValue ?? 0) > 0)
    .map(r => ({ label: r.ticker, value: r.dollarValue!, color: r.color }))

  return (
    <div className="jr-root">
      <div>
        <div className="cc-section-title" style={{ padding: 0 }}>Portfolio Allocation</div>
        <div style={{ fontSize: 11, color: 'var(--text-4)', marginTop: 3 }}>Current holdings vs a target you set yourself</div>
      </div>

      {/* ── Current vs Target pies ────────────────────────────────────────── */}
      <div className="jr-2col">
        <div className="panel" style={{ padding: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-4)', letterSpacing: '0.08em', marginBottom: 10 }}>
            CURRENT ALLOCATION
          </div>
          <PortfolioPie slices={currentSlices} centerLabel="Current" centerValue={fmt$(currentTotal)} />
        </div>
        <div className="panel" style={{ padding: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-4)', letterSpacing: '0.08em', marginBottom: 10 }}>
            TARGET ALLOCATION
          </div>
          <PortfolioPie slices={targetSlices} centerLabel="Target" centerValue={fmt$(targetAllocatedTotal)} />
        </div>
      </div>

      {/* ── Current holdings table ───────────────────────────────────────── */}
      <div className="panel" style={{ padding: 0 }}>
        <div style={{ padding: '12px 18px 8px', fontSize: 11, fontWeight: 700, color: 'var(--text-4)', letterSpacing: '0.08em' }}>
          CURRENT HOLDINGS
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="trade-table" style={{ width: '100%', fontSize: 12 }}>
            <thead>
              <tr>
                <th>Ticker</th>
                <th style={{ textAlign: 'right' }}>Shares</th>
                <th style={{ textAlign: 'right' }}>Avg Cost</th>
                <th style={{ textAlign: 'right' }}>Value</th>
                <th style={{ textAlign: 'right' }}>% of Current</th>
              </tr>
            </thead>
            <tbody>
              {holdings.length === 0 && (
                <tr><td colSpan={5} style={{ padding: '16px 18px', color: 'var(--text-4)' }}>No stock trades yet — upload a statement to populate this.</td></tr>
              )}
              {holdings.map((h, i) => (
                <tr key={h.symbol}>
                  <td className="mono" style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                    <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: tickerColor(i), marginRight: 6 }} />
                    {h.symbol}
                  </td>
                  <td className="mono" style={{ textAlign: 'right' }}>{h.shares.toLocaleString()}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>${h.avgCost.toFixed(2)}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{fmt$(h.value)}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{currentTotal > 0 ? `${(h.value / currentTotal * 100).toFixed(1)}%` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Target allocation editor ─────────────────────────────────────── */}
      <div className="panel" style={{ padding: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 18px 8px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-4)', letterSpacing: '0.08em' }}>TARGET ALLOCATION</span>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-3)', marginLeft: 'auto' }}>
            Total target portfolio value
            <input
              type="number" min={0} value={targets.totalValue || ''}
              onChange={e => setTotalValue(parseFloat(e.target.value) || 0)}
              placeholder="e.g. 1000000"
              style={{ width: 120, padding: '4px 8px', fontSize: 12, borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-1)' }}
            />
          </label>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 18px 12px', flexWrap: 'wrap' }}>
          <input
            value={newTicker} onChange={e => setNewTicker(e.target.value.toUpperCase())}
            placeholder="Ticker" style={{ width: 90, padding: '5px 8px', fontSize: 12, borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-1)' }}
          />
          <select value={newMode} onChange={e => setNewMode(e.target.value as TargetMode)}
            style={{ padding: '5px 8px', fontSize: 12, borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-1)' }}>
            {(['pct', 'shares', 'amount'] as TargetMode[]).map(m => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}
          </select>
          <input
            type="number" min={0} value={newValue} onChange={e => setNewValue(e.target.value)}
            placeholder={newMode === 'pct' ? '%' : newMode === 'shares' ? '# shares' : '$'}
            style={{ width: 100, padding: '5px 8px', fontSize: 12, borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-1)' }}
          />
          <button onClick={addRow} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 12px', fontSize: 11, fontWeight: 600, background: 'var(--accent-dim)', border: '1px solid var(--accent-border)', color: 'var(--accent)', cursor: 'pointer', borderRadius: 4 }}>
            <Plus size={12} /> Add
          </button>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className="trade-table" style={{ width: '100%', fontSize: 12 }}>
            <thead>
              <tr>
                <th>Ticker</th>
                <th style={{ textAlign: 'right' }}>Set as</th>
                <th style={{ textAlign: 'right' }}>Target $</th>
                <th style={{ textAlign: 'right' }}>Target %</th>
                <th style={{ textAlign: 'right' }}>Current $</th>
                <th style={{ textAlign: 'right' }}>Gap $</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {targetRowsResolved.length === 0 && (
                <tr><td colSpan={7} style={{ padding: '16px 18px', color: 'var(--text-4)' }}>No targets set yet — add a ticker above.</td></tr>
              )}
              {targetRowsResolved.map(r => {
                const currentValue = holdings.find(h => h.symbol === r.ticker)?.value ?? 0
                const gap = r.dollarValue != null ? r.dollarValue - currentValue : null
                return (
                  <tr key={r.id}>
                    <td className="mono" style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                      <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: r.color, marginRight: 6 }} />
                      {r.ticker}
                    </td>
                    <td className="mono" style={{ textAlign: 'right', color: 'var(--text-3)' }}>{r.value.toLocaleString()} {r.mode === 'pct' ? '%' : r.mode === 'shares' ? 'sh' : '$'}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{r.dollarValue != null ? fmt$(r.dollarValue) : '—'}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{r.dollarValue != null && targetAllocatedTotal > 0 ? `${(r.dollarValue / targetAllocatedTotal * 100).toFixed(1)}%` : '—'}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{fmt$(currentValue)}</td>
                    <td className={`mono ${gap != null && gap > 0 ? 'pos' : gap != null && gap < 0 ? 'neg' : 'neu'}`} style={{ textAlign: 'right', fontWeight: 700 }}>
                      {gap != null ? fmt$(gap) : '—'}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button onClick={() => removeRow(r.id)} title="Remove" style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-4)', cursor: 'pointer', padding: '3px 6px', borderRadius: 4 }}>
                        <Trash2 size={11} />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div style={{ padding: '8px 18px', fontSize: 10.5, color: 'var(--text-4)' }}>
          Shares-based targets need this account to already hold that ticker (uses its avg cost as the reference price) — set a total portfolio value above to use %-based targets.
        </div>
      </div>
    </div>
  )
}
