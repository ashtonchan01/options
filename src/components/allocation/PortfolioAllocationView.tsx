/**
 * Portfolio Allocation — generic version. Current Allocation is always
 * derived automatically from this account's trades (net shares + avg cost
 * per ticker, no live quotes needed). Target Allocation is entirely
 * user-defined: add a ticker and a number of shares — a live quote prices
 * each row, and every row's % is derived automatically from its share of
 * the total (always adds up to 100%, no separate %/$-amount inputs to keep
 * in sync by hand). Persisted per account, mirrored to the server
 * (/api/user-data) when signed in so targets follow the user across
 * browsers/devices, same as watchlists/trade labels/journal entries.
 */
import { useEffect, useMemo, useState } from 'react'
import { Plus, Trash2, Pencil, Check, X } from 'lucide-react'
import type { AppState, RawPosition, RawTrade } from '../../types'
import { fetchQuotes, type Quote } from '../../services/quotes'
import { fetchRSI, type RsiData } from '../../services/rsi'
import { loadUserData, saveUserData } from '../../services/userData'
import { meanReversionSignal, SIGNAL_STYLE } from '../../services/signal'

export function fmt$(n: number): string {
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`
  return `${sign}$${abs.toFixed(0)}`
}

export function tickerColor(i: number): string {
  const hue = (i * 47) % 360
  return `hsl(${hue}, 62%, 55%)`
}

interface Holding { symbol: string; shares: number; avgCost: number; value: number; optionsValue: number }

/** Live mark-to-market holdings, straight from the account's actual XML/
 * Flex positions snapshot — real market value (positionValue), not a cost
 * basis estimate, so this lines up with IBKR's own numbers.
 *
 * Each ticker's slice folds in the option positions written against its own
 * shares (grouped by underlyingSymbol) — a covered call or CSP's mark value
 * is a real liability/asset sitting against that same ticker's net exposure,
 * and IBKR's own positionValue already carries the correct sign for it
 * (negative quantity × markPrice for a short leg comes out negative, i.e. a
 * drag on net worth, exactly like an ITM short call/put should show).
 * Previously that entire effect was invisible — buried in a single
 * undifferentiated "Other" catch-all instead of attributed to the ticker
 * actually driving it.
 *
 * Naked options (no underlying shares held at all — a pure income play, not
 * a stock position) don't get their own slice here: a pie can't render a
 * negative wedge, and inventing one only for tickers you don't actually
 * hold would misrepresent "portfolio allocation" as owning something you
 * don't. Their combined mark value is returned separately so the caller can
 * fold it into cash instead — the premium collected/paid for them already
 * lives in cash, so that's where their current gain/loss actually sits. */
export function holdingsFromPositions(positions: RawPosition[]): { holdings: Holding[]; nakedOptionsValue: number } {
  const stkSymbols = new Set(
    positions.filter(p => p.assetClass === 'STK' && Math.abs(p.quantity) > 1e-6).map(p => p.symbol),
  )
  const byUnderlying = new Map<string, { shares: number; avgCost: number; stockValue: number; optionsValue: number }>()
  let nakedOptionsValue = 0

  // Options on an underlying with no shares held are usually a pure income
  // play (naked CSP) — no real exposure to attribute a pie slice to, so they
  // fold into cash below same as before. But a long call + short put on the
  // same underlying with no shares is a risk reversal / synthetic long (a
  // LEAP-style stock substitute, typically >1yr out) — that combo *is* real
  // directional exposure to the underlying, just built from options instead
  // of shares, so it earns its own slice (netting both legs' mark value
  // together) instead of disappearing into the cash bucket.
  const nakedOptsByUnderlying = new Map<string, RawPosition[]>()
  for (const p of positions) {
    if (p.assetClass !== 'OPT' || Math.abs(p.quantity) < 1e-6) continue
    const under = p.underlyingSymbol || p.symbol
    if (stkSymbols.has(under)) continue
    if (!nakedOptsByUnderlying.has(under)) nakedOptsByUnderlying.set(under, [])
    nakedOptsByUnderlying.get(under)!.push(p)
  }
  // A pie can't render a negative wedge — only break a risk reversal out of
  // the cash bucket when its two legs actually net to positive exposure;
  // otherwise leave it folded into cash same as any other naked option.
  const riskReversalUnderlyings = new Set(
    [...nakedOptsByUnderlying.entries()]
      .filter(([, opts]) =>
        opts.some(o => o.quantity > 0 && o.putCall === 'C') &&
        opts.some(o => o.quantity < 0 && o.putCall === 'P') &&
        opts.reduce((s, o) => s + o.positionValue, 0) > 0)
      .map(([under]) => under),
  )

  for (const p of positions) {
    if (Math.abs(p.quantity) < 1e-6) continue
    if (p.assetClass === 'STK') {
      const e = byUnderlying.get(p.symbol) ?? { shares: 0, avgCost: 0, stockValue: 0, optionsValue: 0 }
      e.shares += p.quantity
      e.avgCost = p.costBasisPrice
      e.stockValue += p.positionValue
      byUnderlying.set(p.symbol, e)
    } else if (p.assetClass === 'OPT') {
      const under = p.underlyingSymbol || p.symbol
      if (!stkSymbols.has(under)) {
        if (!riskReversalUnderlyings.has(under)) { nakedOptionsValue += p.positionValue; continue }
        const e = byUnderlying.get(under) ?? { shares: 0, avgCost: 0, stockValue: 0, optionsValue: 0 }
        e.optionsValue += p.positionValue
        byUnderlying.set(under, e)
        continue
      }
      const e = byUnderlying.get(under) ?? { shares: 0, avgCost: 0, stockValue: 0, optionsValue: 0 }
      e.optionsValue += p.positionValue
      byUnderlying.set(under, e)
    }
  }

  const holdings = [...byUnderlying.entries()]
    .map(([symbol, e]) => ({ symbol, shares: e.shares, avgCost: e.avgCost, value: e.stockValue + e.optionsValue, optionsValue: e.optionsValue }))
    .sort((a, b) => b.value - a.value)
  return { holdings, nakedOptionsValue }
}

/** Net open shares + weighted avg cost per stock ticker, straight from raw
 * trade history — no live quote dependency, so this still works for a
 * generic .csv/.xlsx/.pdf statement upload that has no positions snapshot.
 * Value is the remaining cost basis (what's actually invested), not a live
 * mark — used only as a fallback when there's no real positions data. */
export function holdingsFromTrades(trades: RawTrade[]): Holding[] {
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
    .map(([symbol, e]) => ({ symbol, shares: e.shares, avgCost: e.shares !== 0 ? e.costBasis / e.shares : 0, value: e.costBasis, optionsValue: 0 }))
    .sort((a, b) => b.value - a.value)
}

interface TargetRow { id: string; ticker: string; shares: number }
interface TargetsState { rows: TargetRow[] }

// All accounts' targets live in one blob (Record<accountId, TargetsState>),
// same "one map, keyed by id" shape journalEntries already uses (keyed by
// position id there, by account id here) — the generic /api/user-data store
// is one blob per data_key, not one row per account, so a single account's
// targets can't be synced independently; every save round-trips the whole
// map.
const TARGETS_LS_KEY = 'options:targetAllocations'

function loadAllTargets(): Record<string, TargetsState> {
  try {
    const raw = localStorage.getItem(TARGETS_LS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, { rows?: Array<{ id: string; ticker: string; shares?: number }> }>
    const out: Record<string, TargetsState> = {}
    for (const [accountId, state] of Object.entries(parsed)) {
      // Old shape had pct/amount rows too — those can't be priced without a
      // shares count, so they're dropped on load rather than shown broken.
      out[accountId] = { rows: (state.rows ?? []).filter((r): r is TargetRow => typeof r.shares === 'number') }
    }
    return out
  } catch {
    return {}
  }
}
function saveAllTargets(map: Record<string, TargetsState>) {
  try { localStorage.setItem(TARGETS_LS_KEY, JSON.stringify(map)) } catch { /* ignore */ }
}

/** Old shape was one localStorage key per account (`options:targets:${id}`),
 * local-only, never synced. Folded into the new one-blob-per-user map on
 * first read so accounts that already had targets saved don't lose them. */
function migrateOldPerAccountTargets(accountId: string): TargetsState | null {
  try {
    const raw = localStorage.getItem(`options:targets:${accountId}`)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { rows?: Array<{ id: string; ticker: string; shares?: number }> }
    const rows = (parsed.rows ?? []).filter((r): r is TargetRow => typeof r.shares === 'number')
    return rows.length > 0 ? { rows } : null
  } catch {
    return null
  }
}

export interface Slice { label: string; value: number; color: string; shares?: number }

export type LabelMode = 'pct' | 'dollar'

/** Same "Current Allocation" slice set the Allocation tab's pie uses — real
 * mark-to-market holdings (stocks + their own written options folded in),
 * cash (including naked options' mark value), and an "Other" catch-all so
 * the pie's total always reconciles to net liquidation instead of silently
 * falling short of it. Exported so other pages (e.g. Overview) show the
 * exact same allocation breakdown instead of a different, narrower one. */
export function currentAllocationSlices(state: { sync: { positions: RawPosition[]; trades: RawTrade[]; cashBalance?: number; netLiquidation?: number } }): { slices: Slice[]; total: number } {
  const { holdings, nakedOptionsValue } = state.sync.positions.length > 0
    ? holdingsFromPositions(state.sync.positions)
    : { holdings: holdingsFromTrades(state.sync.trades), nakedOptionsValue: 0 }
  const holdingsValue = holdings.reduce((s, h) => s + h.value, 0)
  const cashBalance = (state.sync.cashBalance ?? 0) + nakedOptionsValue
  const total = state.sync.netLiquidation ?? (holdingsValue + cashBalance)
  const otherValue = Math.max(0, total - holdingsValue - cashBalance)
  const slices: Slice[] = [
    ...holdings.map((h, i) => ({ label: h.symbol, value: h.value, color: tickerColor(i), shares: h.shares })),
    ...(cashBalance > 0 ? [{ label: 'CASH', value: cashBalance, color: '#10b981' }] : []),
    ...(otherValue > 0 ? [{ label: 'OTHER', value: otherValue, color: 'var(--text-5)' }] : []),
  ]
  return { slices, total }
}

/** Google-Sheets-style pie: labels sit outside the circle with a bent leader
 * line back to the wedge, instead of a separate legend list. */
function annulusPath(cx: number, cy: number, r0: number, r1: number, startDeg: number, endDeg: number): string {
  const pt = (r: number, deg: number) => ({ x: cx + r * Math.cos(deg * Math.PI / 180), y: cy + r * Math.sin(deg * Math.PI / 180) })
  const largeArc = endDeg - startDeg > 180 ? 1 : 0
  const o0 = pt(r1, startDeg), o1 = pt(r1, endDeg)
  const i0 = pt(r0, startDeg), i1 = pt(r0, endDeg)
  return `M${o0.x},${o0.y} A${r1},${r1} 0 ${largeArc} 1 ${o1.x},${o1.y} L${i1.x},${i1.y} A${r0},${r0} 0 ${largeArc} 0 ${i0.x},${i0.y} Z`
}

/** Measures its own container (ResizeObserver) instead of assuming a fixed
 * canvas size, so the donut actually grows/shrinks to fill whatever cell
 * it's placed in — a fixed W/H canvas capped at its own native size left a
 * visible gap around the disc in any panel bigger than that native size. */
function useElementSize<T extends HTMLElement>() {
  const ref = useState<T | null>(null)
  const [node, setNode] = ref
  const [size, setSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    if (!node) return
    const ro = new ResizeObserver(entries => {
      const box = entries[0]?.contentBoxSize?.[0]
      if (box) setSize({ width: box.inlineSize, height: box.blockSize })
      else setSize({ width: node.clientWidth, height: node.clientHeight })
    })
    ro.observe(node)
    setSize({ width: node.clientWidth, height: node.clientHeight })
    return () => ro.disconnect()
  }, [node])
  return [setNode, size] as const
}

export function PortfolioPie({ slices, centerLabel, centerValue, labelMode }: { slices: Slice[]; centerLabel: string; centerValue: string; labelMode: LabelMode }) {
  const total = slices.reduce((s, x) => s + x.value, 0)
  const [setNode, measured] = useElementSize<HTMLDivElement>()
  // Fixed font sizes below are in the same units as W/H/R — since the SVG's
  // viewBox is set to the container's own measured pixel size (not some
  // arbitrary fixed canvas scaled to fit), 1 viewBox unit is always 1 real
  // pixel, so growing the donut to fill its cell never drags the label
  // text size along with it.
  // No fallback to a fixed desktop size here — a truthy-but-wrong fallback
  // (e.g. 440) would still pass the `W > 0 && H > 0` render guard below, so
  // on any container narrower than that fallback the SVG's own explicit
  // width/height would render literally wider than its actual box until the
  // real measurement landed (verified: the Allocation page's fixed-height
  // pie wrapper showed a full desktop-sized ring overflowing off a phone
  // screen). 0 means "not measured yet" and genuinely skips rendering.
  const W = measured.width, H = measured.height
  const CX = W / 2, CY = H / 2
  const LABEL_ROW_H = 17
  // The ring's own radius is a flat fraction of the container's shorter
  // side — simple and predictable at any container size — instead of
  // "whatever's left after subtracting a label margin," which could
  // degenerate to the emergency floor (a barely-visible ring) whenever the
  // margin math and the container's actual W:H ratio didn't line up. Label
  // placement derives FROM the ring afterward, not the other way around.
  // Below ~340px wide there usually isn't room for a share-count suffix
  // alongside the ticker/percentage without running into the container's
  // own edge — drop it there rather than risk clipping.
  const tightLabels = W < 340
  // Label text is right-anchored on the left side, so it extends LEFTWARD
  // from its start x — with no guaranteed margin reserved for that, a
  // narrow phone-width container could compute a start x too close to the
  // ring for the actual label string (ticker + percentage) to fit before
  // hitting x=0, so it got clipped by the page rather than the SVG (whose
  // own overflow:visible doesn't help once the parent page has nothing
  // left to give). LABEL_MARGIN is a width-only floor (not min(W,H), which
  // caused the exact aspect-ratio degeneration this used to avoid) on how
  // much of each side's margin the ring is allowed to eat into.
  const LABEL_MARGIN = tightLabels ? 46 : 58
  const outerR = Math.max(28, Math.min(Math.min(W, H) * 0.32, W / 2 - 22 - LABEL_MARGIN))
  // A thin ring with a big open hole — was a near-solid disc before, which
  // left almost no room for the center value once the disc grew to fill
  // its panel. 0.62 keeps the hole roomy at any size.
  const innerR = outerR * 0.62
  const ELBOW_R = outerR + 8
  const OUTER_X = outerR + 22

  if (total <= 0) {
    return <div ref={setNode} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', width: '100%', color: 'var(--text-4)', fontSize: 12 }}>No data</div>
  }

  let angle = -90
  const wedges = [...slices].filter(s => s.value > 0).sort((a, b) => {
    if (a.label === 'CASH') return 1
    if (b.label === 'CASH') return -1
    return b.value - a.value
  }).map(s => {
    const frac = s.value / total
    const start = angle
    const end = angle + frac * 360
    const mid = (start + end) / 2
    angle = end
    const midRad = mid * Math.PI / 180
    const edge = { x: CX + outerR * Math.cos(midRad), y: CY + outerR * Math.sin(midRad) }
    const elbow = { x: CX + ELBOW_R * Math.cos(midRad), y: CY + ELBOW_R * Math.sin(midRad) }
    const side: 'left' | 'right' = Math.cos(midRad) >= 0 ? 'right' : 'left'
    return {
      ...s, frac,
      path: annulusPath(CX, CY, innerR, outerR, start, end),
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
    <div ref={setNode} style={{ width: '100%', height: '100%' }}>
      {W > 0 && H > 0 && (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: '100%', display: 'block', overflow: 'visible' }}>
      {wedges.map((w, i) => <path key={i} d={w.path} fill={w.color} stroke="var(--bg-card)" strokeWidth={1.5} />)}
      <text x={CX} y={CY - 6} textAnchor="middle" fontSize="9.5" fill="var(--text-4)" fontFamily="Inter, sans-serif" letterSpacing="1px">
        {centerLabel.toUpperCase()}
      </text>
      <text x={CX} y={CY + 11} textAnchor="middle" fontSize="12.5" fontWeight="700" fill="var(--text-1)" fontFamily="Inter, sans-serif">
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
              fontSize="12.5" fontFamily="Inter, sans-serif" fontWeight={600} fill="var(--text-2)">
              {w.label}
              <tspan fill="var(--text-4)" fontWeight={400}> {labelMode === 'pct' ? `${(w.frac * 100).toFixed(1)}%` : fmt$(w.value)}</tspan>
              {!tightLabels && w.shares != null && w.shares !== 0 && (
                <tspan fill="var(--text-5)" fontWeight={400}> ({w.shares.toLocaleString()}sh)</tspan>
              )}
            </text>
          </g>
        )
      })}
    </svg>
      )}
    </div>
  )
}

export default function PortfolioAllocationView({ state, accountId, sessionKey }: { state: AppState; accountId: string; sessionKey?: string | null }) {
  // Prefer the real XML/Flex positions snapshot (live mark-to-market) —
  // only fall back to trade-derived cost basis for a generic .csv/.xlsx/
  // .pdf statement, which has no positions snapshot at all.
  const { holdings, nakedOptionsValue } = state.sync.positions.length > 0
    ? holdingsFromPositions(state.sync.positions)
    : { holdings: holdingsFromTrades(state.sync.trades), nakedOptionsValue: 0 }
  // Each holding's value already folds in that underlying's own option mark
  // value (see holdingsFromPositions), so this is stocks + options combined
  // — genuinely "how much of net worth this ticker accounts for," not just
  // its raw share value.
  const holdingsValue = holdings.reduce((s, h) => s + h.value, 0)
  // Options with no underlying shares (a pure income play, nothing to
  // attribute their mark value to as a "holding") get folded into cash
  // instead — that's literally where their current gain/loss sits, since
  // the premium collected/paid for them lives in the cash balance.
  const cashBalance = (state.sync.cashBalance ?? 0) + nakedOptionsValue
  // Net liquidation (IBKR's own total-account-value figure) is the source
  // of truth when we have it — it includes everything, not just what this
  // page breaks out per-ticker. Whatever's left over (margin financing,
  // small fx/timing differences) falls into an "Other" slice instead of
  // silently vanishing, so the pie's total always reconciles to the real
  // IBKR number instead of just summing the ticker + cash rows.
  const currentTotal = state.sync.netLiquidation ?? (holdingsValue + cashBalance)
  const otherValue = Math.max(0, currentTotal - holdingsValue - cashBalance)

  const [labelMode, setLabelMode] = useState<LabelMode>('pct')
  const [allTargets, setAllTargets] = useState<Record<string, TargetsState>>(() => {
    const map = loadAllTargets()
    if (!map[accountId]) {
      const migrated = migrateOldPerAccountTargets(accountId)
      if (migrated) { map[accountId] = migrated; saveAllTargets(map) }
    }
    return map
  })
  const targets = allTargets[accountId] ?? { rows: [] }
  const [newTicker, setNewTicker] = useState('')
  const [newShares, setNewShares] = useState('')
  const [quotes, setQuotes] = useState<Record<string, Quote>>({})
  const [rsi, setRsi] = useState<Record<string, RsiData>>({})
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTicker, setEditTicker] = useState('')
  const [editShares, setEditShares] = useState('')

  // Server copy wins once it lands — same "localStorage paints instantly,
  // server reconciles after" pattern accountsStore/watchlistStore use, so
  // targets follow the signed-in user across browsers/devices instead of
  // being stuck on whichever one they were typed into.
  useEffect(() => {
    if (!sessionKey) return
    let cancelled = false
    loadUserData<Record<string, TargetsState>>('targetAllocations').then(remote => {
      if (cancelled) return
      if (remote && Object.keys(remote).length > 0) {
        setAllTargets(remote)
        saveAllTargets(remote)
      } else {
        // Server has nothing yet but this device already has targets
        // (set up before server sync existed) — push them up so other
        // devices can see them too.
        setAllTargets(prev => {
          if (Object.keys(prev).length > 0) saveUserData('targetAllocations', prev)
          return prev
        })
      }
    })
    return () => { cancelled = true }
  }, [sessionKey])

  function persist(next: TargetsState) {
    setAllTargets(prev => {
      const map = { ...prev, [accountId]: next }
      saveAllTargets(map)
      if (sessionKey) saveUserData('targetAllocations', map)
      return map
    })
  }

  function addRow() {
    const ticker = newTicker.trim().toUpperCase()
    const shares = parseFloat(newShares)
    if (!ticker || !Number.isFinite(shares) || shares <= 0) return
    const row: TargetRow = { id: `t_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, ticker, shares }
    persist({ rows: [...targets.rows, row] })
    setNewTicker(''); setNewShares('')
  }

  function removeRow(id: string) {
    persist({ rows: targets.rows.filter(r => r.id !== id) })
    if (editingId === id) setEditingId(null)
  }

  function startEdit(row: TargetRow) {
    setEditingId(row.id)
    setEditTicker(row.ticker)
    setEditShares(String(row.shares))
  }

  function cancelEdit() {
    setEditingId(null)
  }

  function saveEdit(id: string) {
    const ticker = editTicker.trim().toUpperCase()
    const shares = parseFloat(editShares)
    if (!ticker || !Number.isFinite(shares) || shares <= 0) return
    persist({ rows: targets.rows.map(r => r.id === id ? { ...r, ticker, shares } : r) })
    setEditingId(null)
  }

  // Live price per target ticker — a target needs a real current price to
  // turn "N shares" into a $ value and a %, not just whatever this account
  // happens to already hold (most target tickers won't be held yet, that's
  // the point of a target). Falls back to this account's own avg cost only
  // if the live quote fetch comes up empty for that symbol.
  function rowPrice(ticker: string): number | null {
    // CASH has no market price — a "CASH" target row's shares field is
    // just entered directly as a dollar amount, so $1/"share" makes that
    // fall out of the same shares*price math every other row already uses.
    if (ticker === 'CASH') return 1
    const live = quotes[ticker]?.price
    if (live && live > 0) return live
    const held = holdings.find(h => h.symbol === ticker)
    return held && held.avgCost > 0 ? held.avgCost : null
  }

  const targetRowsResolved = targets.rows.map((r, i) => {
    const price = rowPrice(r.ticker)
    return { ...r, price, dollarValue: price != null ? r.shares * price : null, color: r.ticker === 'CASH' ? '#10b981' : tickerColor(i) }
  })
  const targetAllocatedTotal = targetRowsResolved.reduce((s, r) => s + (r.dollarValue ?? 0), 0)

  // A synthetic "holding" so CASH can flow through the same merged-row
  // rendering as every stock ticker instead of needing its own separate
  // hardcoded row.
  const cashHolding: Holding | null = cashBalance > 0
    ? { symbol: 'CASH', shares: 0, avgCost: 0, value: cashBalance, optionsValue: nakedOptionsValue }
    : null
  function holdingFor(ticker: string): Holding | null {
    return ticker === 'CASH' ? cashHolding : holdings.find(h => h.symbol === ticker) ?? null
  }

  // One row per ticker held and/or targeted — union of both, so a ticker
  // that's only held (no target set) or only targeted (not held yet) still
  // gets a row, with the other side's columns blank instead of needing two
  // separate tables the eye has to cross-reference by ticker.
  const mergedTickers = [...new Set([
    ...holdings.map(h => h.symbol),
    ...targetRowsResolved.map(r => r.ticker),
    ...(cashHolding ? ['CASH'] : []),
  ])].sort((a, b) => a === 'CASH' ? 1 : b === 'CASH' ? -1 : a.localeCompare(b))
  const mergedRows = mergedTickers.map(ticker => ({
    ticker,
    holding: holdingFor(ticker),
    target: targetRowsResolved.find(r => r.ticker === ticker) ?? null,
  }))

  // Live quote per ticker — every held-or-targeted ticker now, not just
  // target rows, so a plain holding with no target set still gets a real
  // Market Price instead of only ever showing its avg cost.
  const quoteTickersKey = useMemo(() => mergedTickers.filter(t => t !== 'CASH').sort().join(','), [mergedTickers.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const tickers = quoteTickersKey ? quoteTickersKey.split(',') : []
    if (tickers.length === 0) { setQuotes({}); return }
    let cancelled = false
    fetchQuotes(tickers).then(q => { if (!cancelled) setQuotes(q) })
    return () => { cancelled = true }
  }, [quoteTickersKey])

  // RSI(14) per ticker for the same mean-reversion Buy/Sell/Hold Signal the
  // Watchlist shows — CASH has no RSI, so it's excluded from the fetch.
  const rsiTickersKey = useMemo(() => mergedTickers.filter(t => t !== 'CASH').sort().join(','), [mergedTickers.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const rsiTickers = rsiTickersKey ? rsiTickersKey.split(',') : []
    if (rsiTickers.length === 0) { setRsi({}); return }
    let cancelled = false
    fetchRSI(rsiTickers).then(r => { if (!cancelled) setRsi(r) })
    return () => { cancelled = true }
  }, [rsiTickersKey])

  const currentSlices: Slice[] = [
    ...holdings.map((h, i) => ({ label: h.symbol, value: h.value, color: tickerColor(i), shares: h.shares })),
    ...(cashBalance > 0 ? [{ label: 'CASH', value: cashBalance, color: '#10b981' }] : []),
    ...(otherValue > 0 ? [{ label: 'OTHER', value: otherValue, color: 'var(--text-5)' }] : []),
  ]
  const targetSlices: Slice[] = targetRowsResolved
    .filter(r => (r.dollarValue ?? 0) > 0)
    .map(r => ({ label: r.ticker, value: r.dollarValue!, color: r.color }))

  return (
    <div className="jr-root">
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div className="cc-section-title" style={{ padding: 0 }}>Portfolio Allocation</div>
          <div style={{ fontSize: 11, color: 'var(--text-4)', marginTop: 3 }}>Current holdings vs a target you set yourself</div>
        </div>
        <div style={{ display: 'inline-flex', border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
          {(['pct', 'dollar'] as LabelMode[]).map(m => (
            <button
              key={m}
              onClick={() => setLabelMode(m)}
              style={{
                padding: '5px 12px', fontSize: 11, fontWeight: 600, cursor: 'pointer', border: 'none',
                background: labelMode === m ? 'var(--accent-dim)' : 'transparent',
                color: labelMode === m ? 'var(--accent)' : 'var(--text-4)',
              }}
            >
              {m === 'pct' ? '%' : '$'}
            </button>
          ))}
        </div>
      </div>

      {/* ── Current vs Target pies ────────────────────────────────────────── */}
      <div className="jr-2col">
        <div className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-4)', letterSpacing: '0.08em', marginBottom: 10 }}>
            CURRENT ALLOCATION
          </div>
          {/* aspectRatio (not a fixed height) — a fixed height paired with a
              fluid width meant the ring's own size math (which balances
              against both dimensions) could land on a badly mismatched
              W:H ratio depending on the viewport, at worst floor-clamping
              to a barely-visible ring. Keeping height proportional to
              width keeps that math sane at any screen size. */}
          <div style={{ width: '100%', aspectRatio: '4 / 3', overflow: 'hidden' }}>
            <PortfolioPie slices={currentSlices} centerLabel="Current" centerValue={fmt$(currentTotal)} labelMode={labelMode} />
          </div>
        </div>
        <div className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-4)', letterSpacing: '0.08em', marginBottom: 10 }}>
            TARGET ALLOCATION
          </div>
          {/* aspectRatio (not a fixed height) — a fixed height paired with a
              fluid width meant the ring's own size math (which balances
              against both dimensions) could land on a badly mismatched
              W:H ratio depending on the viewport, at worst floor-clamping
              to a barely-visible ring. Keeping height proportional to
              width keeps that math sane at any screen size. */}
          <div style={{ width: '100%', aspectRatio: '4 / 3', overflow: 'hidden' }}>
            <PortfolioPie slices={targetSlices} centerLabel="Target" centerValue={fmt$(targetAllocatedTotal)} labelMode={labelMode} />
          </div>
        </div>
      </div>

      {/* ── Holdings vs Target table ─────────────────────────────────────── */}
      <div className="panel" style={{ padding: 0 }}>
        <div style={{ padding: '12px 18px 8px', fontSize: 11, fontWeight: 700, color: 'var(--text-4)', letterSpacing: '0.08em' }}>
          HOLDINGS vs TARGET
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 18px 12px', flexWrap: 'wrap' }}>
          <input
            value={newTicker} onChange={e => setNewTicker(e.target.value.toUpperCase())}
            placeholder="Ticker" style={{ width: 90, padding: '5px 8px', fontSize: 12, borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-1)' }}
          />
          <input
            type="number" min={0} value={newShares} onChange={e => setNewShares(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addRow()}
            placeholder="# target shares"
            style={{ width: 120, padding: '5px 8px', fontSize: 12, borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-1)' }}
          />
          <button onClick={addRow} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 12px', fontSize: 11, fontWeight: 600, background: 'var(--accent-dim)', border: '1px solid var(--accent-border)', color: 'var(--accent)', cursor: 'pointer', borderRadius: 4 }}>
            <Plus size={12} /> Add target
          </button>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className="trade-table" style={{ width: '100%', fontSize: 12 }}>
            <thead>
              <tr>
                <th>Ticker</th>
                <th style={{ textAlign: 'center' }} title="Mean-reversion read on RSI(14): oversold (<=30) suggests a bounce, overbought (>=70) suggests a pullback">Signal</th>
                <th style={{ textAlign: 'right' }}>Shares</th>
                <th style={{ textAlign: 'right' }}>Market Price</th>
                <th style={{ textAlign: 'right' }}>Avg Cost</th>
                <th style={{ textAlign: 'right' }}>Current $</th>
                <th style={{ textAlign: 'right' }}>Current %</th>
                <th style={{ textAlign: 'right' }}>Target Shares</th>
                <th style={{ textAlign: 'right' }}>Target $</th>
                <th style={{ textAlign: 'right' }}>Target %</th>
                <th style={{ textAlign: 'right' }}>Gap $</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {mergedRows.length === 0 && cashBalance <= 0 && (
                <tr><td colSpan={12} style={{ padding: '16px 18px', color: 'var(--text-4)' }}>No stock trades or targets yet — upload a statement or add a ticker above.</td></tr>
              )}
              {mergedRows.map(({ ticker, holding: h, target: r }, i) => {
                const currentValue = h?.value ?? 0
                const gap = r?.dollarValue != null ? r.dollarValue - currentValue : null
                const isEditing = r != null && editingId === r.id
                const signal = ticker === 'CASH' ? null : meanReversionSignal(rsi[ticker]?.rsi ?? null)
                const marketPrice = ticker === 'CASH' ? null : quotes[ticker]?.price ?? null
                const avgCostColor = h && h.shares !== 0 && marketPrice != null && h.avgCost > marketPrice
                  ? '#ef4444'
                  : undefined
                if (isEditing && r) {
                  return (
                    <tr key={ticker}>
                      <td className="mono" style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{ticker}</td>
                      <td style={{ textAlign: 'center' }}>
                        {signal ? (
                          <span style={{
                            display: 'inline-block', padding: '1px 8px', fontSize: 10, fontWeight: 700,
                            letterSpacing: '0.03em', borderRadius: 3,
                            color: SIGNAL_STYLE[signal].color, background: SIGNAL_STYLE[signal].bg,
                            border: `1px solid ${SIGNAL_STYLE[signal].border}`,
                          }}>
                            {SIGNAL_STYLE[signal].label}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="mono" style={{ textAlign: 'right' }}>{h && h.shares !== 0 ? h.shares.toLocaleString() : '—'}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{marketPrice != null ? `$${marketPrice.toFixed(2)}` : '—'}</td>
                      <td className="mono" style={{ textAlign: 'right', color: avgCostColor, fontWeight: avgCostColor ? 700 : undefined }}>{h && h.shares !== 0 ? `$${h.avgCost.toFixed(2)}` : '—'}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{fmt$(currentValue)}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{currentTotal > 0 ? `${(currentValue / currentTotal * 100).toFixed(1)}%` : '—'}</td>
                      <td style={{ textAlign: 'right' }}>
                        <input
                          type="number" min={0} value={editShares} onChange={e => setEditShares(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') saveEdit(r.id); if (e.key === 'Escape') cancelEdit() }}
                          autoFocus
                          style={{ width: 80, padding: '3px 6px', fontSize: 12, textAlign: 'right', borderRadius: 4, border: '1px solid var(--accent-border)', background: 'var(--bg-elevated)', color: 'var(--text-1)' }}
                        />
                      </td>
                      <td colSpan={3}></td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', gap: 4 }}>
                          <button onClick={() => saveEdit(r.id)} title="Save" style={{ background: 'none', border: '1px solid var(--accent-border)', color: 'var(--accent)', cursor: 'pointer', padding: '3px 6px', borderRadius: 4 }}>
                            <Check size={11} />
                          </button>
                          <button onClick={cancelEdit} title="Cancel" style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-4)', cursor: 'pointer', padding: '3px 6px', borderRadius: 4 }}>
                            <X size={11} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                }
                return (
                  <tr key={ticker}>
                    <td className="mono" style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                      <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: ticker === 'CASH' ? '#10b981' : (r?.color ?? tickerColor(i)), marginRight: 6 }} />
                      {ticker}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {signal ? (
                        <span style={{
                          display: 'inline-block', padding: '1px 8px', fontSize: 10, fontWeight: 700,
                          letterSpacing: '0.03em', borderRadius: 3,
                          color: SIGNAL_STYLE[signal].color, background: SIGNAL_STYLE[signal].bg,
                          border: `1px solid ${SIGNAL_STYLE[signal].border}`,
                        }}>
                          {SIGNAL_STYLE[signal].label}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="mono" style={{ textAlign: 'right' }}>{h && h.shares !== 0 ? h.shares.toLocaleString() : '—'}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{marketPrice != null ? `$${marketPrice.toFixed(2)}` : '—'}</td>
                    <td className="mono" style={{ textAlign: 'right', color: avgCostColor, fontWeight: avgCostColor ? 700 : undefined }}>{h && h.shares !== 0 ? `$${h.avgCost.toFixed(2)}` : '—'}</td>
                    <td
                      className="mono"
                      style={{ textAlign: 'right' }}
                      title={h && h.optionsValue !== 0 ? `Includes ${fmt$(h.optionsValue)} from options mark value` : undefined}
                    >
                      {h ? fmt$(h.value) : '—'}{h && h.optionsValue !== 0 && <span style={{ color: h.optionsValue > 0 ? '#10b981' : '#f43f5e', fontSize: 10, marginLeft: 4 }}>({h.optionsValue > 0 ? '+' : ''}{fmt$(h.optionsValue)} opt)</span>}
                    </td>
                    <td className="mono" style={{ textAlign: 'right' }}>{h && currentTotal > 0 ? `${(h.value / currentTotal * 100).toFixed(1)}%` : '—'}</td>
                    <td className="mono" style={{ textAlign: 'right', color: 'var(--text-3)' }}>{r ? r.shares.toLocaleString() : '—'}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{r?.dollarValue != null ? fmt$(r.dollarValue) : '—'}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{r?.dollarValue != null && targetAllocatedTotal > 0 ? `${(r.dollarValue / targetAllocatedTotal * 100).toFixed(1)}%` : '—'}</td>
                    <td className={`mono ${gap != null && gap > 0 ? 'pos' : gap != null && gap < 0 ? 'neg' : 'neu'}`} style={{ textAlign: 'right', fontWeight: 700 }}>
                      {gap != null ? fmt$(gap) : '—'}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {r && (
                        <div style={{ display: 'inline-flex', gap: 4 }}>
                          <button onClick={() => startEdit(r)} title="Edit target" style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-4)', cursor: 'pointer', padding: '3px 6px', borderRadius: 4 }}>
                            <Pencil size={11} />
                          </button>
                          <button onClick={() => removeRow(r.id)} title="Remove target" style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-4)', cursor: 'pointer', padding: '3px 6px', borderRadius: 4 }}>
                            <Trash2 size={11} />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
              {(holdingsValue + cashBalance > 0 || targetAllocatedTotal > 0) && (
                <tr style={{ borderTop: '2px solid var(--border)' }}>
                  <td className="mono" style={{ fontWeight: 800, color: 'var(--text-1)' }}>Total</td>
                  <td colSpan={4}></td>
                  <td className="mono" style={{ textAlign: 'right', fontWeight: 800 }}>{fmt$(holdingsValue + cashBalance)}</td>
                  <td className="mono" style={{ textAlign: 'right', fontWeight: 800 }}>{currentTotal > 0 ? `${((holdingsValue + cashBalance) / currentTotal * 100).toFixed(1)}%` : '—'}</td>
                  <td></td>
                  <td className="mono" style={{ textAlign: 'right', fontWeight: 800 }}>{fmt$(targetAllocatedTotal)}</td>
                  <td className="mono" style={{ textAlign: 'right', fontWeight: 800 }}>{targetAllocatedTotal > 0 ? '100.0%' : '—'}</td>
                  <td></td>
                  <td></td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div style={{ padding: '8px 18px', fontSize: 10.5, color: 'var(--text-4)' }}>
          Target rows are priced off a live quote (falling back to this account's own avg cost if the quote fetch fails) — Target % is each target row's share of the total target, so it always adds up to 100%. Add a "CASH" target with the target $ amount entered as the shares field to include cash in your target mix.
        </div>
      </div>
    </div>
  )
}
