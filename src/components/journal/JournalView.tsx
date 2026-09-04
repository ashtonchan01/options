/**
 * Trade Journal building blocks — Edgewonk-style journal & analytics over IBKR
 * Flex data. Exports JournalTab (per-position setup/mistake/rating/notes),
 * rendered alongside the Actions sidebar on the Journal tab (see
 * JournalPageView.tsx).
 */
import { useEffect, useMemo, useState } from 'react'
import { type JournalPosition } from '../../engine/journal'
import { MISTAKES, type JournalEntry } from '../../store/journalStore'
import { tradeId } from '../../store/tradeLabelsStore'
import { fetchQuotes } from '../../services/quotes'
import type { RawPosition, RawTrade } from '../../types'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt$(n: number, d = 0) {
  const sign = n < 0 ? '-' : ''
  return `${sign}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`
}

function fmtDate(s: string) {
  const d = new Date(s)
  return isNaN(d.getTime()) ? s : d.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: '2-digit' })
}

function pnlCls(n: number) { return n > 0 ? 'pos' : n < 0 ? 'neg' : 'neu' }
function pnlColor(n: number) { return n > 0 ? '#10b981' : n < 0 ? '#ef4444' : 'var(--text-4)' }

/** A LEAP/risk-reversal combo's breakeven, solved per payoff segment rather
 * than assuming `callStrike + netCost` (only correct when the root falls
 * above both strikes) — mirrors comboBreakevenPrice in OpportunitiesView.tsx.
 * Unlike a generic multi-strike position, a leap combo's two legs are
 * unambiguous BY DEFINITION (call bought, put sold), so which strike is
 * "the short one" doesn't need to survive leg aggregation the way it would
 * for an arbitrary vertical. */
function comboBreakeven(callStrike: number, putStrike: number, netCostPerShare: number): number {
  const lo = Math.min(callStrike, putStrike)
  const hi = Math.max(callStrike, putStrike)
  const belowRoot = putStrike + netCostPerShare
  if (belowRoot <= lo) return belowRoot
  const betweenRoot = (callStrike + putStrike + netCostPerShare) / 2
  if (betweenRoot >= lo && betweenRoot <= hi) return betweenRoot
  return callStrike + netCostPerShare
}

/** Underlying price at which this position neither gains nor loses, at
 * expiry. Long or short, the sign convention is the same either way — a
 * call's breakeven is always strike + premium/share, a put's is always
 * strike - premium/share (a debit payer needs the extra move to recoup what
 * they paid; a credit seller starts losing once the underlying erodes past
 * what they collected) — so this only needs the strike, putCall, and the
 * position's own (already signed) net premium, not separate long/short
 * branches.
 *
 * Resolved for: single-strike legs (CSP, covered call, any naked leg);
 * put_spread (always a bull put spread on SPX/SPXW per this app's own
 * classifier, so the higher/short strike is always strikes[0]); and leap
 * (a two-strike risk-reversal combo, where the call/put strikes are read
 * straight off strikeDisplay's "330C/340P" labels rather than the
 * order-ambiguous `strikes` array). Any other multi-strike vertical can
 * have its short leg on either side with no way to tell from the
 * aggregated position — guessing wrong there would be worse than not
 * showing a number. */
function breakeven(p: JournalPosition): number | null {
  if (p.strikeDisplay === 'SHARES') {
    return p.contracts > 0 ? Math.abs(p.netPremium) / p.contracts : null
  }
  if (p.strikes.length === 0 || p.contracts <= 0) return null
  if (p.strategy === 'leap' && p.strikes.length === 2) {
    const callMatch = p.strikeDisplay.match(/([\d.]+)C/)
    const putMatch = p.strikeDisplay.match(/([\d.]+)P/)
    if (!callMatch || !putMatch) return null
    const callStrike = parseFloat(callMatch[1])
    const putStrike = parseFloat(putMatch[1])
    const netCostPerShare = -p.netPremium / (p.contracts * 100)
    return comboBreakeven(callStrike, putStrike, netCostPerShare)
  }
  if (p.strikes.length > 1 && p.strategy !== 'put_spread') return null
  const anchor = p.strikes[0]
  const premiumPerShare = Math.abs(p.netPremium) / (p.contracts * 100)
  return p.putCall === 'C' ? anchor + premiumPerShare : anchor - premiumPerShare
}

const TODAY_JR = new Date(); TODAY_JR.setHours(0, 0, 0, 0)

/** Days left until expiry (can be negative once past it). */
function dte(expiry: string): number | null {
  if (!expiry) return null
  const s = /^\d{8}$/.test(expiry) ? `${expiry.slice(0, 4)}-${expiry.slice(4, 6)}-${expiry.slice(6, 8)}` : expiry
  const d = new Date(s)
  if (isNaN(d.getTime())) return null
  return Math.round((d.getTime() - TODAY_JR.getTime()) / 86_400_000)
}

const LABEL_SHORT: Record<string, string> = {
  covered_calls: 'CC', csp: 'CSP', leap: 'SYNL', spx: 'SPX', rotation: 'ROT',
  ptos: 'PTOS', dcas: 'DCAS', profit_taking: 'PT', lilo: 'LILO',
  arb_cloud: 'ARB', tabi: 'TABI', forex: 'FX', assignment: 'ASGN', unlabelled: '—',
  put_spread: 'BPS', shares: 'SHARES',
}

// ─── Journal sub-view ─────────────────────────────────────────────────────────

type JFilter = 'all' | 'wins' | 'losses' | 'active' | 'unreviewed'

function isReviewed(e?: JournalEntry) {
  return !!(e && (e.setup || e.rating || e.note || (e.mistakes?.length ?? 0) > 0))
}

function RatingPicker({ value, onChange }: { value?: number; onChange: (n?: number) => void }) {
  return (
    <span style={{ display: 'inline-flex', gap: 2 }}>
      {[1, 2, 3, 4, 5].map(n => (
        <button key={n} onClick={e => { e.stopPropagation(); onChange(value === n ? undefined : n) }}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 13,
            color: (value ?? 0) >= n ? '#10b981' : 'var(--text-5)',
            textShadow: (value ?? 0) >= n ? '0 0 6px rgba(16,185,129,0.6)' : 'none' }}>
          ◆
        </button>
      ))}
    </span>
  )
}

function EntryEditor({ pos, entry, updateEntry, setups, addSetup }: {
  pos: JournalPosition
  entry: JournalEntry
  updateEntry: (id: string, patch: Partial<JournalEntry>) => void
  setups: string[]
  addSetup: (s: string) => void
}) {
  const mistakes = entry.mistakes ?? []
  function toggleMistake(m: string) {
    updateEntry(pos.id, { mistakes: mistakes.includes(m) ? mistakes.filter(x => x !== m) : [...mistakes, m] })
  }
  function onSetupChange(v: string) {
    if (v === '__add') {
      const name = window.prompt('New setup name')
      if (name?.trim()) { addSetup(name); updateEntry(pos.id, { setup: name.trim() }) }
    } else {
      updateEntry(pos.id, { setup: v || undefined })
    }
  }
  return (
    <div className="jr-editor">
      <div className="jr-editor-row">
        <div className="cc-control-group">
          <label className="cc-control-label">Setup</label>
          <select className="cc-select" style={{ minWidth: 180 }} value={entry.setup ?? ''} onChange={e => onSetupChange(e.target.value)}>
            <option value="">— none —</option>
            {setups.map(s => <option key={s} value={s}>{s}</option>)}
            <option value="__add">＋ Add custom…</option>
          </select>
        </div>
        <div className="cc-control-group">
          <label className="cc-control-label">Execution Grade</label>
          <RatingPicker value={entry.rating} onChange={n => updateEntry(pos.id, { rating: n })} />
        </div>
      </div>
      <div className="cc-control-group">
        <label className="cc-control-label">Mistakes</label>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {MISTAKES.map(m => {
            const on = mistakes.includes(m)
            return (
              <button key={m} className="tl-filter-chip" onClick={() => toggleMistake(m)}
                style={on ? { borderColor: '#ef4444', color: '#ef4444', background: 'rgba(239,68,68,0.10)' } : undefined}>
                {m}
              </button>
            )
          })}
        </div>
      </div>
      <div className="cc-control-group">
        <label className="cc-control-label">Notes</label>
        <textarea className="jr-note" rows={3} placeholder="What happened? What would you do differently?"
          value={entry.note ?? ''} onChange={e => updateEntry(pos.id, { note: e.target.value || undefined })} />
      </div>
    </div>
  )
}

/** Shown in place of the setup/mistakes/notes editor when a SHARES row is
 * expanded — a ticker's aggregate row hides exactly which trades built up
 * the position, so instead of freeform notes this lists every buy/sell
 * (including option assignments, which land in the Flex report as ordinary
 * STK trades with zero commission) that contributed to it, oldest first. */
function SharesTradesTable({ pos, tradesByKey }: { pos: JournalPosition; tradesByKey: Map<string, RawTrade> }) {
  const rows = pos.tradeIds
    .map(id => tradesByKey.get(id))
    .filter((t): t is RawTrade => t != null)
    .sort((a, b) => a.tradeDate.localeCompare(b.tradeDate))

  if (rows.length === 0) {
    return <div style={{ padding: '14px 16px', color: 'var(--text-4)', fontSize: 12 }}>No trade history found for this position.</div>
  }

  return (
    <div style={{ padding: '10px 16px' }}>
      <table className="mono" style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ color: 'var(--text-4)', textAlign: 'left' }}>
            <th style={{ fontWeight: 500, padding: '3px 8px 3px 0' }}>Date</th>
            <th style={{ fontWeight: 500, padding: '3px 8px' }}>Action</th>
            <th style={{ fontWeight: 500, padding: '3px 8px', textAlign: 'right' }}>Qty</th>
            <th style={{ fontWeight: 500, padding: '3px 8px', textAlign: 'right' }}>Price</th>
            <th style={{ fontWeight: 500, padding: '3px 8px', textAlign: 'right' }}>Fees</th>
            <th style={{ fontWeight: 500, padding: '3px 8px', textAlign: 'right' }}>Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t, i) => {
            const assigned = Math.abs(t.commissions ?? 0) < 0.005
            const action = `${t.quantity > 0 ? 'Buy' : 'Sell'}${assigned ? ' (assigned)' : ''}`
            return (
              <tr key={`${t.tradeDate}|${i}`} style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ padding: '4px 8px 4px 0', color: 'var(--text-3)', whiteSpace: 'nowrap' }}>{fmtDate(t.tradeDate)}</td>
                <td style={{ padding: '4px 8px', color: t.quantity > 0 ? '#10b981' : '#ef4444', fontWeight: 600 }}>{action}</td>
                <td style={{ padding: '4px 8px', textAlign: 'right' }}>{Math.abs(t.quantity)}</td>
                <td style={{ padding: '4px 8px', textAlign: 'right' }}>{fmt$(t.tradePrice, 2)}</td>
                <td style={{ padding: '4px 8px', textAlign: 'right', color: 'var(--text-4)' }}>{fmt$(Math.abs(t.commissions ?? 0), 2)}</td>
                <td style={{ padding: '4px 8px', textAlign: 'right', color: 'var(--text-2)' }}>{fmt$(Math.abs(t.quantity) * t.tradePrice, 2)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** Shown in place of the setup/mistakes/notes editor when a multi-leg spread
 * row (synthetic long / leap, bull put spread) is expanded — the aggregated
 * row only shows the combined strikes/premium, hiding which individual
 * option leg trades (and, for a leap combo scaled into over multiple fills,
 * which specific fills) built it up. Lists every leg trade that contributed,
 * oldest first, same spirit as SharesTradesTable above. */
function OptionLegsTable({ pos, tradesByKey }: { pos: JournalPosition; tradesByKey: Map<string, RawTrade> }) {
  const rows = pos.tradeIds
    .map(id => tradesByKey.get(id))
    .filter((t): t is RawTrade => t != null && t.assetClass === 'OPT')
    .sort((a, b) => a.tradeDate.localeCompare(b.tradeDate) || (a.strike ?? 0) - (b.strike ?? 0))

  if (rows.length === 0) {
    return <div style={{ padding: '14px 16px', color: 'var(--text-4)', fontSize: 12 }}>No trade history found for this position.</div>
  }

  return (
    <div style={{ padding: '10px 16px' }}>
      <table className="mono" style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ color: 'var(--text-4)', textAlign: 'left' }}>
            <th style={{ fontWeight: 500, padding: '3px 8px 3px 0' }}>Date</th>
            <th style={{ fontWeight: 500, padding: '3px 8px' }}>Action</th>
            <th style={{ fontWeight: 500, padding: '3px 8px' }}>Leg</th>
            <th style={{ fontWeight: 500, padding: '3px 8px', textAlign: 'right' }}>Qty</th>
            <th style={{ fontWeight: 500, padding: '3px 8px', textAlign: 'right' }}>Price</th>
            <th style={{ fontWeight: 500, padding: '3px 8px', textAlign: 'right' }}>Fees</th>
            <th style={{ fontWeight: 500, padding: '3px 8px', textAlign: 'right' }}>Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t, i) => {
            const action = t.quantity > 0 ? 'Buy' : 'Sell'
            const leg = `${t.strike ?? ''}${t.putCall ?? ''} ${fmtDate(t.expiry ?? '')}`.trim()
            return (
              <tr key={`${t.tradeDate}|${i}`} style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ padding: '4px 8px 4px 0', color: 'var(--text-3)', whiteSpace: 'nowrap' }}>{fmtDate(t.tradeDate)}</td>
                <td style={{ padding: '4px 8px', color: t.quantity > 0 ? '#10b981' : '#ef4444', fontWeight: 600 }}>{action}</td>
                <td style={{ padding: '4px 8px', color: 'var(--text-2)', whiteSpace: 'nowrap' }}>{leg}</td>
                <td style={{ padding: '4px 8px', textAlign: 'right' }}>{Math.abs(t.quantity)}</td>
                <td style={{ padding: '4px 8px', textAlign: 'right' }}>{fmt$(t.tradePrice, 2)}</td>
                <td style={{ padding: '4px 8px', textAlign: 'right', color: 'var(--text-4)' }}>{fmt$(Math.abs(t.commissions ?? 0), 2)}</td>
                <td style={{ padding: '4px 8px', textAlign: 'right', color: 'var(--text-2)' }}>{fmt$(Math.abs(t.quantity) * t.tradePrice * 100, 2)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** Collapses every SHARES lot (buy/sell FIFO-matched pairs plus any still-open
 * remainder — buildStockPositions emits one JournalPosition per lot) down to a
 * single display row per ticker, so a stock traded in and out repeatedly doesn't
 * flood the table with one row per lot. Realized P&L sums across closed lots;
 * an aggregate row is "Active" if any lot still holds shares. This is a display-
 * only merge — it doesn't touch the underlying per-lot data other tabs rely on.
 *
 * `livePositions`, when given, is IBKR's own current-holding snapshot (the
 * Flex report's <OpenPosition> rows) — the ground truth for how many shares
 * are actually held right now. The active share count is reconstructed
 * instead from the full trade history via FIFO/LIFO lot matching, which is
 * fragile against any historical data-quality issue (a duplicate, a missing,
 * or an out-of-window trade this account will never re-report) and can drift
 * from reality in a way no amount of resyncing fixes, since a resync only
 * ever replaces trades inside its own reporting window. Verified against a
 * real account: MSTR/NVDA both showed 100 more shares than IBKR's own
 * snapshot, persisting across multiple resyncs — the phantom trade predated
 * every Flex window this account could still fetch. Overriding the displayed
 * total with IBKR's live quantity (scaling cost basis by the same ratio,
 * since the true composition of which lots are phantom is unknowable) keeps
 * the Journal correct regardless of where in trade history the drift lives. */
function aggregateShares(positions: JournalPosition[], livePositions: RawPosition[] = []): JournalPosition[] {
  const shareLots = positions.filter(p => p.strikeDisplay === 'SHARES')
  const others = positions.filter(p => p.strikeDisplay !== 'SHARES')
  if (shareLots.length === 0) return positions

  const byTicker = new Map<string, JournalPosition[]>()
  for (const p of shareLots) {
    if (!byTicker.has(p.underlying)) byTicker.set(p.underlying, [])
    byTicker.get(p.underlying)!.push(p)
  }

  const merged: JournalPosition[] = []
  for (const [ticker, lots] of byTicker) {
    const activeLots = lots.filter(l => l.status === 'Active')
    const closedLots = lots.filter(l => l.status !== 'Active')
    const anyActive = activeLots.length > 0
    const computedContracts = (anyActive ? activeLots : lots).reduce((s, l) => s + l.contracts, 0)
    const liveQty = livePositions.find(lp => lp.assetClass === 'STK' && lp.symbol === ticker)?.quantity
    const totalContracts = anyActive && liveQty != null ? liveQty : computedContracts
    // Cost basis scales by the same ratio the share count was corrected by,
    // since which specific lots are phantom (vs. real but out-of-window) is
    // unknowable from trade history alone — an exact ratio when nothing was
    // wrong (computedContracts === liveQty) and a proportional best-effort
    // otherwise.
    const costScale = computedContracts > 0 ? totalContracts / computedContracts : 1
    const hasClosedPnl = closedLots.some(l => l.pnl != null)
    merged.push({
      id: `shares-agg|${ticker}`,
      underlying: ticker,
      contracts: totalContracts,
      strikeDisplay: 'SHARES',
      strikes: [],
      putCall: '',
      expiry: '',
      dateOpen: lots.reduce((min, l) => (l.dateOpen < min ? l.dateOpen : min), lots[0].dateOpen),
      initialDTE: 0,
      // Cost basis of a ticker still being held must reflect only the shares
      // still held — summing every lot's netPremium (including shares bought
      // and already sold off in earlier round-trips) inflated cost basis to
      // the total ever spent on the ticker, not what's actually in the
      // account now (verified: a real account's MSTR row showed $151,500
      // instead of IBKR's own $115,244 cost basis for the 500 shares actually
      // held). Once fully closed (nothing held), fall back to all lots so a
      // closed ticker still shows its real total cost.
      openFees: (anyActive ? activeLots : lots).reduce((s, l) => s + l.openFees, 0) * costScale,
      netPremium: (anyActive ? activeLots : lots).reduce((s, l) => s + l.netPremium, 0) * costScale,
      status: anyActive ? 'Active' : 'Closed',
      strategy: 'shares',
      tradeIds: lots.flatMap(l => l.tradeIds),
      dateClosed: anyActive ? undefined : closedLots.reduce((max, l) => (l.dateClosed && l.dateClosed > max ? l.dateClosed : max), closedLots[0]?.dateClosed ?? ''),
      closeFees: closedLots.reduce((s, l) => s + (l.closeFees ?? 0), 0),
      pnl: hasClosedPnl ? closedLots.reduce((s, l) => s + (l.pnl ?? 0), 0) : undefined,
      holdDays: undefined,
    })
  }
  return [...others, ...merged]
}

/** Multiple still-open positions at the exact same underlying/expiry/strikes
 * are the same logical trade scaled into over time (e.g. a 10-lot vertical
 * added to with another 10-lot at identical strikes weeks later) — collapses
 * them into one display row with the combined contract count and premium,
 * same spirit as aggregateShares above. Closed/Expired lots are left
 * itemized (their own dateClosed/pnl/holdDays are lot-specific and
 * shouldn't be blended together). */
function aggregateActiveOptionLots(positions: JournalPosition[]): JournalPosition[] {
  const isMergeable = (p: JournalPosition) => p.status === 'Active' && p.strikeDisplay !== 'SHARES'
  const activeOpts = positions.filter(isMergeable)
  const others = positions.filter(p => !isMergeable(p))
  if (activeOpts.length === 0) return positions

  const byKey = new Map<string, JournalPosition[]>()
  for (const p of activeOpts) {
    const key = `${p.underlying}|${p.expiry}|${p.strikeDisplay}`
    if (!byKey.has(key)) byKey.set(key, [])
    byKey.get(key)!.push(p)
  }

  const merged: JournalPosition[] = []
  for (const [key, lots] of byKey) {
    if (lots.length === 1) { merged.push(lots[0]); continue }
    const first = lots[0]
    merged.push({
      ...first,
      id: `opt-agg|${key}`,
      contracts: lots.reduce((s, l) => s + l.contracts, 0),
      dateOpen: lots.reduce((min, l) => (l.dateOpen < min ? l.dateOpen : min), first.dateOpen),
      initialDTE: Math.max(...lots.map(l => l.initialDTE)),
      openFees: lots.reduce((s, l) => s + l.openFees, 0),
      netPremium: lots.reduce((s, l) => s + l.netPremium, 0),
      tradeIds: lots.flatMap(l => l.tradeIds),
    })
  }
  return [...others, ...merged]
}

/** SHARES rows get their buy/sell history; multi-leg spreads (leap/synthetic
 * long, put_spread/bull put spread — anything with more than one strike)
 * get their individual leg trades; everything else keeps the freeform
 * setup/mistakes/notes editor. */
function pickEditor(p: JournalPosition, e: JournalEntry, tradesByKey: Map<string, RawTrade>,
  updateEntry: (id: string, patch: Partial<JournalEntry>) => void, setups: string[], addSetup: (s: string) => void) {
  if (p.strikeDisplay === 'SHARES') return <SharesTradesTable pos={p} tradesByKey={tradesByKey} />
  if (p.strikes.length > 1) return <OptionLegsTable pos={p} tradesByKey={tradesByKey} />
  return <EntryEditor pos={p} entry={e} updateEntry={updateEntry} setups={setups} addSetup={addSetup} />
}

const STRAT_GROUP_ORDER = [
  'shares', 'leap', 'put_spread', 'spx', 'csp', 'covered_calls',
  'rotation', 'ptos', 'dcas', 'profit_taking', 'lilo', 'arb_cloud', 'tabi', 'forex', 'assignment',
]
function stratGroupRank(strategy?: string) {
  const i = STRAT_GROUP_ORDER.indexOf(strategy ?? 'unlabelled')
  return i === -1 ? STRAT_GROUP_ORDER.length : i
}
function stratGroupLabel(strategy?: string) {
  const key = strategy ?? 'unlabelled'
  return LABEL_SHORT[key] ?? key.toUpperCase()
}

export function JournalTab({ positions, livePositions, trades, entries, updateEntry, setups, addSetup }: {
  positions: JournalPosition[]
  livePositions: RawPosition[]
  trades: RawTrade[]
  entries: Record<string, JournalEntry>
  updateEntry: (id: string, patch: Partial<JournalEntry>) => void
  setups: string[]
  addSetup: (s: string) => void
}) {
  const [filter, setFilter] = useState<JFilter>('all')
  const [hideClosed, setHideClosed] = useState(true)
  const [groupByStrategy, setGroupByStrategy] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)

  const displayPositions = useMemo(() => aggregateActiveOptionLots(aggregateShares(positions, livePositions)), [positions, livePositions])

  // Underlying's live stock price, shown in its own column — fetched
  // regardless of whether shares of that ticker are actually held, since a
  // naked CSP/covered call has no STK leg in livePositions to read a price
  // off (same gap the Actions sidebar had before it started fetching quotes
  // directly rather than relying on live IBKR STK positions).
  const [underlyingPrices, setUnderlyingPrices] = useState<Record<string, number>>({})
  const underlyingsKey = [...new Set(displayPositions.map(p => p.underlying))].sort().join(',')
  useEffect(() => {
    const underlyings = underlyingsKey ? underlyingsKey.split(',') : []
    if (underlyings.length === 0) { setUnderlyingPrices({}); return }
    let cancelled = false
    fetchQuotes(underlyings).then(quotes => {
      if (cancelled) return
      const prices: Record<string, number> = {}
      for (const [sym, q] of Object.entries(quotes)) prices[sym] = q.price
      setUnderlyingPrices(prices)
    })
    return () => { cancelled = true }
  }, [underlyingsKey])

  const tradesByKey = useMemo(() => {
    const m = new Map<string, RawTrade>()
    for (const t of trades) m.set(tradeId(t), t)
    return m
  }, [trades])

  // A single live IBKR leg (one strike) can be shared by two different
  // display rows — e.g. two verticals with different long strikes but the
  // SAME short strike (a 20-lot 7525/7520 and a 2-lot 7525/7500 both short
  // the same 7525P) — since IBKR only reports one combined -22 lot position
  // for that strike, not two. Attributing that whole leg's value/uPnL to
  // EACH row that references it (rather than splitting it by how many of
  // those contracts are actually this row's own) double- and triple-counts
  // it — verified against a real account where a 2-lot spread showed a
  // wildly wrong +11,797% unrealized because it was credited the FULL
  // -22-lot leg's P&L instead of its own 2/22 share. Split strictly by
  // contract count on that specific shared strike (not by spread width or
  // any other weighting) — every contract of the same option (same strike/
  // expiry) is marked at the exact same live price regardless of which
  // spread it's paired with, so the only economically correct split of a
  // blended live value is by how many of those actual contracts each row
  // holds. This map totals how many contracts, across every active row,
  // use each (underlying, expiry, strike) — Row divides its own contracts
  // by this total to get its rightful share of any leg it doesn't
  // exclusively own.
  const strikeUsage = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of displayPositions) {
      if (p.status !== 'Active' || p.strikeDisplay === 'SHARES') continue
      for (const strike of p.strikes) {
        const key = `${p.underlying}|${p.expiry}|${strike}`
        m.set(key, (m.get(key) ?? 0) + p.contracts)
      }
    }
    return m
  }, [displayPositions])

  const rows = useMemo(() => {
    // Open positions first (most-recently-opened first within that group), then
    // closed positions most-recently-closed first.
    const sorted = [...displayPositions].sort((a, b) => {
      const aActive = a.status === 'Active' ? 0 : 1
      const bActive = b.status === 'Active' ? 0 : 1
      if (aActive !== bActive) return aActive - bActive
      return (b.dateClosed ?? b.dateOpen).localeCompare(a.dateClosed ?? a.dateOpen)
    })
    let filtered: JournalPosition[]
    switch (filter) {
      case 'wins':       filtered = sorted.filter(p => (p.pnl ?? 0) > 0 && p.status !== 'Active'); break
      case 'losses':     filtered = sorted.filter(p => (p.pnl ?? 0) < 0 && p.status !== 'Active'); break
      case 'active':     filtered = sorted.filter(p => p.status === 'Active'); break
      case 'unreviewed': filtered = sorted.filter(p => p.status !== 'Active' && !isReviewed(entries[p.id])); break
      default:           filtered = sorted
    }
    return hideClosed ? filtered.filter(p => p.status === 'Active') : filtered
  }, [displayPositions, filter, entries, hideClosed])

  const counts = useMemo(() => ({
    all: displayPositions.length,
    wins: displayPositions.filter(p => (p.pnl ?? 0) > 0 && p.status !== 'Active').length,
    losses: displayPositions.filter(p => (p.pnl ?? 0) < 0 && p.status !== 'Active').length,
    active: displayPositions.filter(p => p.status === 'Active').length,
    unreviewed: displayPositions.filter(p => p.status !== 'Active' && !isReviewed(entries[p.id])).length,
  }), [displayPositions, entries])

  const FILTERS: { id: JFilter; label: string }[] = [
    { id: 'all', label: `All (${counts.all})` },
    { id: 'wins', label: `Wins (${counts.wins})` },
    { id: 'losses', label: `Losses (${counts.losses})` },
    { id: 'active', label: `Active (${counts.active})` },
    { id: 'unreviewed', label: `Unreviewed (${counts.unreviewed})` },
  ]

  const groups = useMemo(() => {
    if (!groupByStrategy) return [{ label: null as string | null, rows }]
    const byStrat = new Map<string, JournalPosition[]>()
    for (const p of rows) {
      const key = p.strategy ?? 'unlabelled'
      if (!byStrat.has(key)) byStrat.set(key, [])
      byStrat.get(key)!.push(p)
    }
    return [...byStrat.entries()]
      .sort((a, b) => stratGroupRank(a[0]) - stratGroupRank(b[0]))
      .map(([key, groupRows]) => ({ label: stratGroupLabel(key), rows: groupRows }))
  }, [rows, groupByStrategy])

  const COLS = 15

  return (
    <>
      <div className="tl-filter-row" style={{ alignItems: 'center' }}>
        <div className="cc-section-title" style={{ padding: 0, marginRight: 4, flexShrink: 0 }}>Trade Journal</div>
        {FILTERS.map(f => (
          <button key={f.id} className={`tl-filter-chip${filter === f.id ? ' active' : ''}`} onClick={() => setFilter(f.id)}>
            {f.label}
          </button>
        ))}
        <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-3)', marginLeft: 8, cursor: 'pointer', fontFamily: 'Inter, sans-serif' }}>
          <input type="checkbox" checked={hideClosed} onChange={e => setHideClosed(e.target.checked)} />
          Hide closed
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-3)', marginLeft: 8, cursor: 'pointer', fontFamily: 'Inter, sans-serif' }}>
          <input type="checkbox" checked={groupByStrategy} onChange={e => setGroupByStrategy(e.target.checked)} />
          Group by strategy
        </label>
      </div>

      {groupByStrategy ? (
        // One independently-scrollable cell per strategy — a flat list with
        // inline group headers meant scrolling past LEAP/CSP/CC just to reach
        // a strategy further down (e.g. SPX/BPS) buried near the bottom.
        // Each cell caps its own height so every strategy stays reachable at
        // a glance instead of one long shared scroll.
        <div className="jr-strategy-grid">
          {groups.map(g => (
            <div key={g.label} className="jr-strategy-cell">
              <div className="jr-strategy-cell-header">{g.label} · {g.rows.length}</div>
              <div className="jr-strategy-cell-scroll">
                <table className="trade-table" style={{ fontSize: 12 }}>
                  <TableHead />
                  <tbody>
                    {g.rows.map(p => {
                      const e = entries[p.id] ?? {}
                      const open = expanded === p.id
                      return (
                        <Row key={p.id} pos={p} livePositions={livePositions} strikeUsage={strikeUsage} underlyingPrice={underlyingPrices[p.underlying] ?? null} entry={e} open={open} cols={COLS}
                          onToggle={() => setExpanded(open ? null : p.id)}
                          editor={pickEditor(p, e, tradesByKey, updateEntry, setups, addSetup)} />
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
          {rows.length === 0 && <div style={{ textAlign: 'center', color: 'var(--text-5)', padding: 24 }}>Nothing here</div>}
        </div>
      ) : (
        <div className="cc-section cc-table-section" style={{ flexShrink: 1 }}>
          <div className="jr-trade-table-scroll" style={{ overflow: 'auto' }}>
            <table className="trade-table" style={{ fontSize: 12 }}>
              <TableHead />
              <tbody>
                {rows.map(p => {
                  const e = entries[p.id] ?? {}
                  const open = expanded === p.id
                  return (
                    <Row key={p.id} pos={p} livePositions={livePositions} strikeUsage={strikeUsage} underlyingPrice={underlyingPrices[p.underlying] ?? null} entry={e} open={open} cols={COLS}
                      onToggle={() => setExpanded(open ? null : p.id)}
                      editor={pickEditor(p, e, tradesByKey, updateEntry, setups, addSetup)} />
                  )
                })}
                {rows.length === 0 && (
                  <tr><td colSpan={COLS} style={{ textAlign: 'center', color: 'var(--text-5)', padding: 24 }}>Nothing here</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  )
}

function TableHead() {
  return (
    <thead>
      <tr>
        <th className="jr-col-open">Open</th>
        <th className="jr-col-closed">Closed</th>
        <th>Ticker</th>
        <th style={{ textAlign: 'right' }}>Stock Price</th>
        <th style={{ textAlign: 'right' }}>Position</th>
        <th style={{ textAlign: 'right' }}>Avg Price</th>
        <th style={{ textAlign: 'right' }}>Cost Basis</th>
        <th style={{ textAlign: 'right' }}>Breakeven</th>
        <th style={{ textAlign: 'right' }}>Market Price</th>
        <th style={{ textAlign: 'right' }}>Market Value</th>
        <th style={{ textAlign: 'right' }}>Unrealised</th>
        <th style={{ textAlign: 'right' }}>%</th>
        <th className="jr-col-dte" style={{ textAlign: 'right' }}>DTE</th>
        <th style={{ textAlign: 'right' }}>Fees</th>
        <th style={{ textAlign: 'right' }}>P&L</th>
      </tr>
    </thead>
  )
}

function Row({ pos: p, livePositions, strikeUsage, underlyingPrice, open, cols, onToggle, editor }: {
  pos: JournalPosition; livePositions: RawPosition[]; strikeUsage: Map<string, number>
  underlyingPrice: number | null
  entry: JournalEntry; open: boolean; cols: number
  onToggle: () => void; editor: React.ReactNode
}) {
  const daysLeft = dte(p.expiry)
  const urgent = p.status === 'Active' && daysLeft != null && daysLeft <= 7
  const isShares = p.strikeDisplay === 'SHARES'
  const units = isShares ? p.contracts : p.contracts * 100

  // Market price/value/unrealized/cost-basis only make sense for still-open
  // positions — matched against this sync's live IBKR snapshot by underlying/
  // expiry/strike. A leg's own positionValue/unrealizedPnL/costBasisMoney is
  // scaled by this row's share of that strike's total usage across all rows
  // (via strikeUsage) — IBKR reports one combined live position per strike,
  // so a strike shared by two different display rows (e.g. two verticals
  // with different long legs but the same short strike) must have that
  // leg's numbers split between them, not credited in full to each.
  const liveLegs = p.status !== 'Active' ? [] : isShares
    ? livePositions.filter(lp => lp.assetClass === 'STK' && lp.symbol === p.underlying)
    : livePositions.filter(lp => lp.assetClass === 'OPT'
        && (lp.underlyingSymbol ?? lp.symbol) === p.underlying
        && lp.expiry === p.expiry
        && p.strikes.includes(lp.strike ?? -1))
  const shareOf = (lp: RawPosition) => {
    if (isShares) return 1
    const total = strikeUsage.get(`${p.underlying}|${p.expiry}|${lp.strike}`) ?? p.contracts
    return total > 0 ? p.contracts / total : 1
  }
  const hasLive = liveLegs.length > 0
  // A strike this position shares with another active row (see strikeUsage
  // above) has no honest per-row split of IBKR's own blended cost basis —
  // proportioning by contract count assumes both rows entered at the same
  // price, which isn't generally true (verified: two SPX verticals sharing
  // a short 7525P strike, opened at different prices — splitting IBKR's
  // live combined cost basis by contract count gave -$5,096/-$558, while
  // the real per-combo entry economics were -$3,699/-$1,955, matching this
  // position's own recorded trade-history premium almost exactly). Only use
  // IBKR's live cost basis when every one of this position's strikes is
  // exclusively its own.
  const hasSharedStrike = !isShares && p.strikes.some(strike => {
    const total = strikeUsage.get(`${p.underlying}|${p.expiry}|${strike}`) ?? p.contracts
    return total > p.contracts
  })

  // IBKR's own live costBasisMoney/Price (already correctly signed — negative
  // for a short position, positive for a long one) is authoritative and used
  // whenever a live match exists and no strike is shared — it reflects
  // IBKR's actual cost-basis accounting (their default is average-cost, not
  // FIFO), which can legally diverge from a FIFO reconstruction off trade
  // history whenever a position has had a partial close along the way
  // (verified: a real MSTR share position with one partial sell in its
  // history showed a FIFO-derived $235.00 avg / $117,500 cost basis in this
  // app vs IBKR's own reported $230.49 avg / $115,244 average-cost basis —
  // same trades, different valid accounting method, and IBKR's own number is
  // the one that matters here). Falls back to this position's own recorded
  // premium when nothing live matches, or a strike is shared (see above).
  const liveCostBasis = hasLive && !hasSharedStrike ? liveLegs.reduce((s, lp) => s + lp.costBasisMoney * shareOf(lp), 0) : null
  const costBasis = liveCostBasis ?? -p.netPremium
  const avgPrice = units > 0 ? Math.abs(costBasis) / units : 0

  const breakevenPrice = breakeven(p)

  // Market value is built directly from each leg's live per-contract mark
  // price (markPrice) — identical for every contract of that strike whether
  // it's blended across several positions or not — times THIS position's
  // own contract count, rather than proportionally splitting IBKR's already-
  // aggregated dollar totals (positionValue/unrealizedPnL). A leg's sign
  // (long vs short) is safe to read directly off the live leg even when its
  // magnitude is blended with another position — every contract of one
  // option is held in the same direction account-wide, IBKR nets to a
  // single sign, only the quantity magnitude gets blended. This sidesteps
  // the whole "how do you split an aggregate" problem: verified against a
  // real account, this lines up with IBKR's own per-combo Market/Unrealised
  // columns almost exactly (a 2-lot 7525/7500 and a 20-lot 7525/7520 both
  // sharing the 7525P leg), whereas splitting the aggregate by any ratio
  // (contract count or otherwise) only ever gets the TOTAL across every
  // sharing position right, never each one's own number.
  const ownMarketValue = hasLive
    ? liveLegs.reduce((s, lp) => {
        const signedContracts = Math.sign(lp.quantity) * p.contracts
        return s + lp.markPrice * signedContracts * (lp.multiplier ?? 100)
      }, 0)
    : null
  const marketPrice = ownMarketValue != null && units > 0 ? Math.abs(ownMarketValue) / units : null
  const unrealized = ownMarketValue != null ? ownMarketValue - costBasis : null
  const unrealizedPct = unrealized != null && costBasis !== 0 ? (unrealized / Math.abs(costBasis)) * 100 : null

  return (
    <>
      <tr onClick={onToggle} style={{ cursor: 'pointer', background: open ? 'rgba(16,185,129,0.05)' : urgent ? 'rgba(239,68,68,0.08)' : undefined }}>
        <td className="mono jr-col-open" style={{ whiteSpace: 'nowrap', color: 'var(--text-3)' }}>
          {fmtDate(p.dateOpen)}
        </td>
        <td className="mono jr-col-closed" style={{ whiteSpace: 'nowrap', color: 'var(--text-3)' }}>
          {p.dateClosed ? fmtDate(p.dateClosed) : '—'}
        </td>
        <td className="mono" style={{ fontWeight: 700, color: 'var(--text-1)' }}>{p.underlying}</td>
        <td className="mono" style={{ textAlign: 'right', color: 'var(--text-2)', whiteSpace: 'nowrap' }}>
          {underlyingPrice != null ? fmt$(underlyingPrice, 2) : '—'}
        </td>
        <td className="mono" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
          {p.strikeDisplay === 'SHARES' ? `${p.contracts} sh` : `${p.contracts}× ${p.strikeDisplay}`}
        </td>
        <td className="mono" style={{ textAlign: 'right', color: 'var(--text-2)', whiteSpace: 'nowrap' }}>
          {fmt$(avgPrice, 2)}
        </td>
        <td className="mono" style={{ textAlign: 'right', color: costBasis < 0 ? '#10b981' : costBasis > 0 ? '#f59e0b' : 'var(--text-4)', whiteSpace: 'nowrap' }}>
          {fmt$(costBasis, 2)}
        </td>
        <td className="mono" style={{ textAlign: 'right', color: 'var(--text-3)', whiteSpace: 'nowrap' }}>
          {breakevenPrice != null ? fmt$(breakevenPrice, 2) : '—'}
        </td>
        <td className="mono" style={{ textAlign: 'right', color: 'var(--text-2)', whiteSpace: 'nowrap' }}>
          {marketPrice != null ? fmt$(marketPrice, 2) : '—'}
        </td>
        <td className="mono" style={{ textAlign: 'right', color: 'var(--text-2)', whiteSpace: 'nowrap' }}>
          {ownMarketValue != null ? fmt$(Math.abs(ownMarketValue), 2) : '—'}
        </td>
        <td className={`mono ${unrealized != null ? pnlCls(unrealized) : ''}`} style={{ textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap' }}>
          {unrealized != null ? fmt$(unrealized, 2) : '—'}
        </td>
        <td className="mono" style={{ textAlign: 'right', color: unrealizedPct != null ? pnlColor(unrealizedPct) : 'var(--text-4)', fontSize: 12, whiteSpace: 'nowrap' }}>
          {unrealizedPct != null ? `${unrealizedPct >= 0 ? '+' : ''}${unrealizedPct.toFixed(1)}%` : '—'}
        </td>
        <td className="mono jr-col-dte" style={{ textAlign: 'right', color: urgent ? '#ef4444' : 'var(--text-3)', fontWeight: urgent ? 700 : 400 }}>
          {daysLeft != null ? `${daysLeft}d` : '—'}
        </td>
        <td className="mono" style={{ textAlign: 'right', color: 'var(--text-4)', whiteSpace: 'nowrap' }}>
          {fmt$(p.openFees + (p.closeFees ?? 0), 2)}
        </td>
        <td className={`mono ${p.pnl != null ? pnlCls(p.pnl) : ''}`} style={{ textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' }}>
          {p.pnl != null ? fmt$(p.pnl, 2) : '—'}
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={cols} style={{ padding: 0, background: 'rgba(16,185,129,0.03)' }}>
            {editor}
          </td>
        </tr>
      )}
    </>
  )
}

