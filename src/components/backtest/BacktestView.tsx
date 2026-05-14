import { useState, useMemo, useCallback } from 'react'
import { Play, RotateCcw } from 'lucide-react'
import type { AppState } from '../../types'
import { SPX_DAILY } from '../../data/spxDaily'

/* ═══════════════════════════════════════════════════════════════════════════
   BSM PRICING
   ═══════════════════════════════════════════════════════════════════════════ */

function normCDF(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x))
  const d = 0.3989422802 * Math.exp(-0.5 * x * x)
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.7814779 + t * (-1.821256 + t * 1.3302744))))
  return x > 0 ? 1 - p : p
}

function bsmPut(S: number, K: number, T: number, r: number, iv: number): number {
  if (T <= 0.0001) return Math.max(K - S, 0)
  const d1 = (Math.log(S / K) + (r + 0.5 * iv * iv) * T) / (iv * Math.sqrt(T))
  const d2 = d1 - iv * Math.sqrt(T)
  return K * Math.exp(-r * T) * normCDF(-d2) - S * normCDF(-d1)
}

/* ═══════════════════════════════════════════════════════════════════════════
   TYPES & CONSTANTS
   ═══════════════════════════════════════════════════════════════════════════ */

type ExitRule = 'hold' | '50pct' | '90pct' | '30day' | '50pct_30day' | '90pct_30day'

const EXIT_LABELS: Record<ExitRule, string> = {
  hold:         'Hold to Expiry',
  '50pct':      '50% Profit',
  '90pct':      '90% Profit',
  '30day':      'Close @ 30 DTE',
  '50pct_30day':'50% or 30 DTE',
  '90pct_30day':'90% or 30 DTE',
}
const EXIT_RULES: ExitRule[] = ['hold', '50pct', '90pct', '30day', '50pct_30day', '90pct_30day']
const DAY_LABELS: Record<number, string> = { 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri' }
const WEEK_LABELS: Record<number, string> = { 1: 'W1', 2: 'W2', 3: 'W3', 4: 'W4' }

const RF = 0.045
const MULTIPLIER = 100
const SLIPPAGE_PER_LEG = 0.15   // points
const COMMISSION_PER_LEG = 0.50 // dollars

interface Trade {
  entryDate: string;  exitDate: string
  entrySpx: number;   exitSpx: number
  shortK: number;     longK: number
  entryCredit: number  // raw BSM credit in points
  netCredit: number    // after entry slippage
  exitCost: number     // debit to close (including slippage) or settlement
  pnl: number          // dollars per 1 spread
  holdDays: number;    exitReason: string
  won: boolean;        entryVix: number
}

interface ComboResult {
  dayLabel: string;  weekLabel: string;  exitLabel: string
  exitRule: ExitRule
  trades: Trade[]
  numTrades: number;  winRate: number
  totalPnl: number;   avgPnl: number
  avgWin: number;     avgLoss: number
  profitFactor: number
  maxDrawdown: number
  sharpe: number
  maxConsecLoss: number
  avgHoldDays: number
}

/* ═══════════════════════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════════════════════ */

function calDays(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000)
}

function weekOfMonth(d: string): number {
  const dom = new Date(d).getDate()
  return dom <= 7 ? 1 : dom <= 14 ? 2 : dom <= 21 ? 3 : 4
}

function fmt$(n: number, d = 0): string {
  return (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: d, maximumFractionDigits: d,
  })
}

/* ═══════════════════════════════════════════════════════════════════════════
   BACKTEST ENGINE — 65 DTE ATM BULL PUT SPREAD
   ═══════════════════════════════════════════════════════════════════════════ */

function runCombo(
  entryDow: number | null,
  entryWeek: number | null,
  exitRule: ExitRule,
  spreadWidth: number,
  targetDte: number,
): ComboResult {
  const trades: Trade[] = []
  const entrySlip = 2 * SLIPPAGE_PER_LEG   // 0.30 points
  const exitSlip  = 2 * SLIPPAGE_PER_LEG
  const entryComm = 2 * COMMISSION_PER_LEG  // $1.00
  const exitComm  = 2 * COMMISSION_PER_LEG

  for (let i = 0; i < SPX_DAILY.length; i++) {
    const [date, , , , close, vix] = SPX_DAILY[i]
    const dt  = new Date(date)
    const dow = dt.getDay()

    if (dow < 1 || dow > 5) continue
    if (entryDow !== null && dow !== entryDow) continue
    if (entryWeek !== null && weekOfMonth(date) !== entryWeek) continue

    // Find expiry bar (first bar >= targetDte calendar days out)
    const expiryMs = dt.getTime() + targetDte * 86_400_000
    let expiryIdx = -1
    for (let j = i + 1; j < SPX_DAILY.length; j++) {
      if (new Date(SPX_DAILY[j][0]).getTime() >= expiryMs) { expiryIdx = j; break }
    }
    if (expiryIdx === -1) continue

    // Price spread at entry
    const iv = vix / 100
    const T  = targetDte / 365
    const shortK = Math.round(close / 5) * 5          // ATM, 5-pt strikes
    const longK  = shortK - spreadWidth

    const shortPut = bsmPut(close, shortK, T, RF, iv)
    const longPut  = bsmPut(close, longK,  T, RF, iv)
    const rawCredit = shortPut - longPut
    const netCredit = rawCredit - entrySlip
    if (netCredit <= 0) continue

    // Track through hold period, check exit conditions
    let exitIdx = expiryIdx
    let exitReason = 'Expiry'
    let exitCost = 0
    let closedEarly = false

    if (exitRule !== 'hold') {
      for (let j = i + 1; j < expiryIdx; j++) {
        const [d2, , , , c2, v2] = SPX_DAILY[j]
        const held = calDays(date, d2)
        const dteLeft = targetDte - held
        const Tj  = Math.max(dteLeft / 365, 0.001)
        const ivj = v2 / 100

        const curShort = bsmPut(c2, shortK, Tj, RF, ivj)
        const curLong  = bsmPut(c2, longK,  Tj, RF, ivj)
        const curSpread = curShort - curLong
        const profitPct = (rawCredit - curSpread) / rawCredit  // fraction of max profit captured

        let shouldExit = false
        let reason = ''

        switch (exitRule) {
          case '50pct':
            if (profitPct >= 0.50) { shouldExit = true; reason = '50% Profit' }
            break
          case '90pct':
            if (profitPct >= 0.90) { shouldExit = true; reason = '90% Profit' }
            break
          case '30day':
            if (dteLeft <= 30) { shouldExit = true; reason = '30 DTE Close' }
            break
          case '50pct_30day':
            if (profitPct >= 0.50) { shouldExit = true; reason = '50% Profit' }
            else if (dteLeft <= 30) { shouldExit = true; reason = '30 DTE Close' }
            break
          case '90pct_30day':
            if (profitPct >= 0.90) { shouldExit = true; reason = '90% Profit' }
            else if (dteLeft <= 30) { shouldExit = true; reason = '30 DTE Close' }
            break
        }

        if (shouldExit) {
          exitIdx = j
          exitReason = reason
          exitCost = curSpread + exitSlip
          closedEarly = true
          break
        }
      }
    }

    // Compute final P/L
    let pnl: number
    if (closedEarly) {
      pnl = (netCredit - exitCost) * MULTIPLIER - (entryComm + exitComm)
    } else {
      // Cash-settled at expiry
      const finalS = SPX_DAILY[expiryIdx][4]
      const shortIntrinsic = Math.max(shortK - finalS, 0)
      const longIntrinsic  = Math.max(longK  - finalS, 0)
      exitCost = shortIntrinsic - longIntrinsic
      pnl = (netCredit - exitCost) * MULTIPLIER - entryComm
    }

    trades.push({
      entryDate: date,
      exitDate:  SPX_DAILY[exitIdx][0],
      entrySpx:  close,
      exitSpx:   SPX_DAILY[exitIdx][4],
      shortK, longK,
      entryCredit: rawCredit,
      netCredit,
      exitCost,
      pnl,
      holdDays: calDays(date, SPX_DAILY[exitIdx][0]),
      exitReason,
      won: pnl > 0,
      entryVix: vix,
    })
  }

  // ── Compute statistics ────────────────────────────────────────────────────

  const n = trades.length
  if (n === 0) {
    return {
      dayLabel:  entryDow  === null ? 'Any' : DAY_LABELS[entryDow],
      weekLabel: entryWeek === null ? 'Any' : WEEK_LABELS[entryWeek],
      exitLabel: EXIT_LABELS[exitRule],
      exitRule,
      trades: [], numTrades: 0, winRate: 0,
      totalPnl: 0, avgPnl: 0, avgWin: 0, avgLoss: 0,
      profitFactor: 0, maxDrawdown: 0, sharpe: 0,
      maxConsecLoss: 0, avgHoldDays: 0,
    }
  }

  const wins   = trades.filter(t => t.won)
  const losses = trades.filter(t => !t.won)
  const totalPnl = trades.reduce((s, t) => s + t.pnl, 0)
  const avgPnl   = totalPnl / n
  const avgWin   = wins.length   ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length     : 0
  const avgLoss  = losses.length ? losses.reduce((s, t) => s + t.pnl, 0) / losses.length  : 0

  const grossWin  = wins.reduce((s, t) => s + t.pnl, 0)
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0))
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? Infinity : 0)

  // Max drawdown on cumulative P/L (sorted by exit date)
  const sorted = [...trades].sort((a, b) => a.exitDate.localeCompare(b.exitDate))
  let cumPnl = 0, peak = 0, maxDD = 0
  for (const t of sorted) {
    cumPnl += t.pnl
    if (cumPnl > peak) peak = cumPnl
    const dd = peak - cumPnl
    if (dd > maxDD) maxDD = dd
  }

  // Sharpe (annualized from per-trade)
  const pnls = trades.map(t => t.pnl)
  const std  = Math.sqrt(pnls.reduce((s, p) => s + (p - avgPnl) ** 2, 0) / Math.max(n - 1, 1))
  const totalCalDays = calDays(SPX_DAILY[0][0], SPX_DAILY[SPX_DAILY.length - 1][0])
  const tradesPerYear = n / (totalCalDays / 365)
  const sharpe = std > 0 ? (avgPnl / std) * Math.sqrt(tradesPerYear) : 0

  // Max consecutive losses
  let maxCL = 0, curCL = 0
  for (const t of trades) {
    if (!t.won) { curCL++; maxCL = Math.max(maxCL, curCL) } else curCL = 0
  }

  const avgHoldDays = trades.reduce((s, t) => s + t.holdDays, 0) / n

  return {
    dayLabel:  entryDow  === null ? 'Any' : DAY_LABELS[entryDow],
    weekLabel: entryWeek === null ? 'Any' : WEEK_LABELS[entryWeek],
    exitLabel: EXIT_LABELS[exitRule],
    exitRule, trades,
    numTrades: n, winRate: (wins.length / n) * 100,
    totalPnl, avgPnl, avgWin, avgLoss,
    profitFactor, maxDrawdown: maxDD,
    sharpe, maxConsecLoss: maxCL, avgHoldDays,
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   FULL SWEEP
   ═══════════════════════════════════════════════════════════════════════════ */

function runFullSweep(width: number, dte: number): ComboResult[] {
  const days:  (number | null)[] = [null, 1, 2, 3, 4, 5]
  const weeks: (number | null)[] = [null, 1, 2, 3, 4]
  const results: ComboResult[] = []

  for (const d of days)
    for (const w of weeks)
      for (const e of EXIT_RULES) {
        const r = runCombo(d, w, e, width, dte)
        if (r.numTrades > 0) results.push(r)
      }

  return results.sort((a, b) => b.sharpe - a.sharpe)
}

/* ═══════════════════════════════════════════════════════════════════════════
   STYLES
   ═══════════════════════════════════════════════════════════════════════════ */

const tile: React.CSSProperties = {
  background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10,
  overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0,
}
const tileHdr: React.CSSProperties = {
  padding: '10px 16px', borderBottom: '1px solid var(--border)',
  fontSize: 12, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.08em', flexShrink: 0,
}

type SortKey = 'winRate' | 'totalPnl' | 'avgPnl' | 'profitFactor' | 'maxDrawdown' | 'sharpe' | 'numTrades' | 'maxConsecLoss' | 'avgHoldDays'

const COLUMNS: { key: SortKey; label: string; fmt: (v: number) => string; better: 'high' | 'low'; w: number }[] = [
  { key: 'numTrades',    label: 'TRADES',  fmt: v => String(v),                         better: 'high', w: 60 },
  { key: 'winRate',      label: 'WIN %',   fmt: v => v.toFixed(1) + '%',                better: 'high', w: 60 },
  { key: 'totalPnl',     label: 'TOTAL P/L', fmt: v => fmt$(v),                         better: 'high', w: 90 },
  { key: 'avgPnl',       label: 'AVG P/L', fmt: v => fmt$(v),                           better: 'high', w: 80 },
  { key: 'profitFactor', label: 'PF',      fmt: v => v === Infinity ? '∞' : v.toFixed(2), better: 'high', w: 50 },
  { key: 'maxDrawdown',  label: 'MAX DD',  fmt: v => fmt$(v),                           better: 'low',  w: 80 },
  { key: 'sharpe',       label: 'SHARPE',  fmt: v => v.toFixed(2),                      better: 'high', w: 65 },
  { key: 'maxConsecLoss',label: 'STREAK',  fmt: v => String(v) + 'L',                   better: 'low',  w: 55 },
  { key: 'avgHoldDays',  label: 'AVG DAYS',fmt: v => v.toFixed(0) + 'd',                better: 'low',  w: 65 },
]

/* ═══════════════════════════════════════════════════════════════════════════
   COMPONENT
   ═══════════════════════════════════════════════════════════════════════════ */

export default function BacktestView({ }: { state: AppState }) {
  const [results, setResults]       = useState<ComboResult[] | null>(null)
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [sortKey, setSortKey]       = useState<SortKey>('sharpe')
  const [sortAsc, setSortAsc]       = useState(false)
  const [running, setRunning]       = useState(false)
  const [spreadWidth, setSpreadWidth] = useState(30)
  const [targetDte, setTargetDte]   = useState(65)

  const handleRun = useCallback(() => {
    setRunning(true)
    // defer to next frame so spinner renders
    requestAnimationFrame(() => {
      setTimeout(() => {
        const r = runFullSweep(spreadWidth, targetDte)
        setResults(r)
        setSelectedIdx(0)
        setRunning(false)
      }, 20)
    })
  }, [spreadWidth, targetDte])

  const sorted = useMemo(() => {
    if (!results) return []
    return [...results].sort((a, b) => {
      const av = a[sortKey] as number
      const bv = b[sortKey] as number
      if (av === bv) return 0
      return sortAsc ? av - bv : bv - av
    })
  }, [results, sortKey, sortAsc])

  const selected = sorted[selectedIdx] ?? null

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(p => !p)
    else { setSortKey(key); setSortAsc(false) }
  }

  const inputStyle: React.CSSProperties = {
    background: 'var(--bg-page)', border: '1px solid var(--border)', borderRadius: 6,
    color: 'var(--text-1)', padding: '8px 12px', fontSize: 14,
    fontFamily: 'IBM Plex Mono, monospace', outline: 'none', cursor: 'pointer',
  }

  const dataRange = `${SPX_DAILY[0][0]} → ${SPX_DAILY[SPX_DAILY.length - 1][0]}`

  return (
    <div style={{ padding: 16, height: '100%', display: 'flex', flexDirection: 'column', gap: 10, overflow: 'hidden' }}>

      {/* ── Config bar ──────────────────────────────────────────────── */}
      <div style={{
        background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10,
        padding: '12px 20px', flexShrink: 0,
        display: 'flex', alignItems: 'center', gap: 20, justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-1)', letterSpacing: 1 }}>
            SPX 65 DTE · ATM BULL PUT SPREAD
          </span>
          <span style={{ fontSize: 12, color: 'var(--text-3)', fontFamily: 'IBM Plex Mono, monospace' }}>
            {dataRange} · {SPX_DAILY.length} bars
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 11, color: 'var(--text-3)', letterSpacing: 1 }}>WIDTH</span>
            <select value={spreadWidth} onChange={e => setSpreadWidth(+e.target.value)} style={inputStyle}>
              {[20, 25, 30, 40, 50].map(w => <option key={w} value={w}>{w}pt</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 11, color: 'var(--text-3)', letterSpacing: 1 }}>DTE</span>
            <select value={targetDte} onChange={e => setTargetDte(+e.target.value)} style={inputStyle}>
              {[30, 45, 60, 65, 75, 90].map(d => <option key={d} value={d}>{d}d</option>)}
            </select>
          </div>
          <button onClick={handleRun} disabled={running} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '8px 20px', background: '#6366F1', border: 'none', borderRadius: 6,
            color: '#fff', fontSize: 14, fontWeight: 600, cursor: running ? 'wait' : 'pointer',
            fontFamily: 'inherit', opacity: running ? 0.7 : 1,
          }}>
            <Play size={13} style={{ animation: running ? 'spin 1s linear infinite' : 'none' }} />
            {running ? 'Running…' : 'Run Sweep'}
          </button>
          {results && (
            <button onClick={() => { setResults(null); setSelectedIdx(0) }} style={{
              padding: '8px 10px', background: 'var(--bg-page)', border: '1px solid var(--border)',
              borderRadius: 6, color: 'var(--text-3)', cursor: 'pointer', display: 'flex', alignItems: 'center',
            }}>
              <RotateCcw size={13} />
            </button>
          )}
        </div>
      </div>

      {/* ── Results ─────────────────────────────────────────────────── */}
      {results && results.length > 0 && (
        <>
          {/* Summary stat cards for selected combo */}
          {selected && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 6, flexShrink: 0 }}>
              {[
                { label: 'SELECTED', value: `${selected.dayLabel} · ${selected.weekLabel} · ${selected.exitLabel}`, color: '#818cf8', mono: false },
                { label: 'WIN RATE', value: selected.winRate.toFixed(1) + '%', color: selected.winRate >= 70 ? '#10b981' : '#f59e0b', mono: true },
                { label: 'TOTAL P/L', value: fmt$(selected.totalPnl), color: selected.totalPnl >= 0 ? '#10b981' : '#f43f5e', mono: true },
                { label: 'AVG P/L', value: fmt$(selected.avgPnl), color: selected.avgPnl >= 0 ? '#10b981' : '#f43f5e', mono: true },
                { label: 'PROFIT FACTOR', value: selected.profitFactor === Infinity ? '∞' : selected.profitFactor.toFixed(2), color: selected.profitFactor >= 1.5 ? '#10b981' : '#f59e0b', mono: true },
                { label: 'MAX DD', value: fmt$(selected.maxDrawdown), color: '#f43f5e', mono: true },
                { label: 'SHARPE', value: selected.sharpe.toFixed(2), color: selected.sharpe >= 1.0 ? '#10b981' : '#f59e0b', mono: true },
                { label: 'AVG HOLD', value: selected.avgHoldDays.toFixed(0) + ' days', color: 'var(--text-2)', mono: true },
              ].map(s => (
                <div key={s.label} style={{
                  background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8,
                  padding: '8px 12px', textAlign: 'center',
                }}>
                  <div style={{ fontSize: 10, color: 'var(--text-4)', letterSpacing: 1, marginBottom: 2 }}>{s.label}</div>
                  <div style={{
                    fontSize: s.mono ? 18 : 11, fontWeight: 700, color: s.color,
                    fontFamily: s.mono ? 'IBM Plex Mono, monospace' : 'inherit',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>{s.value}</div>
                </div>
              ))}
            </div>
          )}

          {/* Main grid: ranking table + equity + trades */}
          <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr', gap: 8, minHeight: 0 }}>

            {/* ── Ranking table ─────────────────────────────────────── */}
            <div style={{ ...tile, gridRow: '1 / 3' }}>
              <div style={tileHdr}>
                RANKING · {sorted.length} COMBINATIONS
                <span style={{ float: 'right', fontWeight: 400, color: 'var(--text-4)', fontSize: 11, letterSpacing: 0 }}>
                  click row to inspect
                </span>
              </div>
              <div style={{ flex: 1, overflow: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr>
                      <th style={thS}>#</th>
                      <th style={thS}>DAY</th>
                      <th style={thS}>WEEK</th>
                      <th style={thS}>EXIT RULE</th>
                      {COLUMNS.map(c => (
                        <th key={c.key} onClick={() => toggleSort(c.key)} style={{
                          ...thS, cursor: 'pointer', userSelect: 'none', width: c.w,
                          color: sortKey === c.key ? '#818cf8' : 'var(--text-3)',
                        }}>
                          {c.label} {sortKey === c.key ? (sortAsc ? '▲' : '▼') : ''}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((r, i) => {
                      const isSelected = i === selectedIdx
                      return (
                        <tr
                          key={i}
                          onClick={() => setSelectedIdx(i)}
                          style={{
                            cursor: 'pointer',
                            background: isSelected ? 'var(--bg-active)' : i % 2 === 0 ? 'transparent' : 'var(--bg-page)',
                            borderLeft: isSelected ? '2px solid #6366F1' : '2px solid transparent',
                          }}
                          onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = 'var(--bg-active)' }}
                          onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = i % 2 === 0 ? 'transparent' : 'var(--bg-page)' }}
                        >
                          <td style={tdS}>{i + 1}</td>
                          <td style={tdS}>{r.dayLabel}</td>
                          <td style={tdS}>{r.weekLabel}</td>
                          <td style={{ ...tdS, fontSize: 11 }}>{r.exitLabel}</td>
                          {COLUMNS.map(c => {
                            const v = r[c.key] as number
                            let color = 'var(--text-2)'
                            if (c.key === 'totalPnl' || c.key === 'avgPnl') color = v >= 0 ? '#10b981' : '#f43f5e'
                            if (c.key === 'winRate') color = v >= 70 ? '#10b981' : v >= 50 ? '#f59e0b' : '#f43f5e'
                            if (c.key === 'profitFactor') color = v >= 1.5 ? '#10b981' : v >= 1.0 ? '#f59e0b' : '#f43f5e'
                            if (c.key === 'sharpe') color = v >= 1.0 ? '#10b981' : v >= 0.5 ? '#f59e0b' : '#f43f5e'
                            return (
                              <td key={c.key} style={{ ...tdS, color, fontFamily: 'IBM Plex Mono, monospace' }}>
                                {c.fmt(v)}
                              </td>
                            )
                          })}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* ── Equity curve ──────────────────────────────────────── */}
            {selected && (
              <div style={tile}>
                <div style={tileHdr}>EQUITY CURVE · {selected.numTrades} TRADES</div>
                <div style={{ flex: 1, padding: '10px 12px', overflow: 'hidden' }}>
                  <EquityCurve trades={selected.trades} />
                </div>
              </div>
            )}

            {/* ── Trade log ─────────────────────────────────────────── */}
            {selected && (
              <div style={tile}>
                <div style={tileHdr}>
                  TRADE LOG
                  <span style={{ float: 'right', fontWeight: 400, color: 'var(--text-4)', fontSize: 11, letterSpacing: 0 }}>
                    avg win {fmt$(selected.avgWin)} · avg loss {fmt$(selected.avgLoss)}
                  </span>
                </div>
                <div style={{ flex: 1, overflow: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr>
                        {['ENTRY', 'EXIT', 'SPX', 'SHORT K', 'CREDIT', 'EXIT $', 'P/L', 'DAYS', 'REASON'].map(h => (
                          <th key={h} style={thS}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {selected.trades.map((t, i) => (
                        <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : 'var(--bg-page)' }}>
                          <td style={{ ...tdS, fontSize: 11 }}>{t.entryDate.slice(5)}</td>
                          <td style={{ ...tdS, fontSize: 11 }}>{t.exitDate.slice(5)}</td>
                          <td style={{ ...tdS, fontFamily: 'IBM Plex Mono, monospace' }}>
                            {t.entrySpx.toFixed(0)}→{t.exitSpx.toFixed(0)}
                          </td>
                          <td style={{ ...tdS, fontFamily: 'IBM Plex Mono, monospace' }}>
                            {t.shortK}/{t.longK}
                          </td>
                          <td style={{ ...tdS, fontFamily: 'IBM Plex Mono, monospace', color: '#10b981' }}>
                            {t.netCredit.toFixed(2)}
                          </td>
                          <td style={{ ...tdS, fontFamily: 'IBM Plex Mono, monospace', color: '#f59e0b' }}>
                            {t.exitCost.toFixed(2)}
                          </td>
                          <td style={{
                            ...tdS, fontFamily: 'IBM Plex Mono, monospace', fontWeight: 600,
                            color: t.pnl >= 0 ? '#10b981' : '#f43f5e',
                          }}>
                            {fmt$(t.pnl)}
                          </td>
                          <td style={{ ...tdS, fontFamily: 'IBM Plex Mono, monospace', color: 'var(--text-3)' }}>
                            {t.holdDays}
                          </td>
                          <td style={{
                            ...tdS, fontSize: 11,
                            color: t.exitReason.includes('Profit') ? '#10b981'
                              : t.exitReason === 'Expiry' ? '#818cf8'
                              : '#f59e0b',
                          }}>
                            {t.exitReason}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Empty state ─────────────────────────────────────────────── */}
      {!results && !running && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)' }}>
          <div style={{ textAlign: 'center', maxWidth: 500 }}>
            <div style={{ fontSize: 17, marginBottom: 10, color: 'var(--text-2)' }}>
              SPX Bull Put Spread Backtest
            </div>
            <div style={{ fontSize: 14, lineHeight: 1.7 }}>
              Tests all combinations of <span style={{ color: '#818cf8' }}>entry day</span> (Mon–Fri),{' '}
              <span style={{ color: '#818cf8' }}>entry week</span> (W1–W4), and{' '}
              <span style={{ color: '#818cf8' }}>exit rule</span> (hold / 50% / 90% / 30 DTE / combos)
              <br />
              using {SPX_DAILY.length} days of real SPX + VIX data with BSM pricing.
              <br />
              <span style={{ fontSize: 12, color: 'var(--text-4)' }}>
                Costs: ${COMMISSION_PER_LEG.toFixed(2)}/contract + ${SLIPPAGE_PER_LEG.toFixed(2)} slippage/leg
              </span>
            </div>
            <button onClick={handleRun} style={{
              marginTop: 20, padding: '12px 32px', background: '#6366F1', border: 'none', borderRadius: 8,
              color: '#fff', fontSize: 15, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              display: 'inline-flex', alignItems: 'center', gap: 8,
            }}>
              <Play size={14} /> Run Full Sweep
            </button>
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin { from { transform:rotate(0deg); } to { transform:rotate(360deg); } }
      `}</style>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   EQUITY CURVE (SVG)
   ═══════════════════════════════════════════════════════════════════════════ */

function EquityCurve({ trades }: { trades: Trade[] }) {
  const sorted = useMemo(() =>
    [...trades].sort((a, b) => a.exitDate.localeCompare(b.exitDate)),
    [trades],
  )

  const points = useMemo(() => {
    let cum = 0
    return sorted.map(t => { cum += t.pnl; return { date: t.exitDate, cum, won: t.won } })
  }, [sorted])

  if (points.length < 2) return <div style={{ color: 'var(--text-4)', fontSize: 13, padding: 20 }}>Not enough trades to chart</div>

  const maxY = Math.max(...points.map(p => p.cum), 0)
  const minY = Math.min(...points.map(p => p.cum), 0)
  const rangeY = maxY - minY || 1
  const W = 500, H = 180, PAD = 30

  const scaleX = (i: number) => PAD + (i / (points.length - 1)) * (W - 2 * PAD)
  const scaleY = (v: number) => PAD + (1 - (v - minY) / rangeY) * (H - 2 * PAD)

  const linePath = points.map((p, i) =>
    `${i === 0 ? 'M' : 'L'}${scaleX(i).toFixed(1)},${scaleY(p.cum).toFixed(1)}`
  ).join(' ')

  // Fill under the line
  const fillPath = linePath +
    ` L${scaleX(points.length - 1).toFixed(1)},${scaleY(0).toFixed(1)}` +
    ` L${scaleX(0).toFixed(1)},${scaleY(0).toFixed(1)} Z`

  const zeroY = scaleY(0)
  const finalPnl = points[points.length - 1].cum

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: '100%' }}>
      {/* Zero line */}
      <line x1={PAD} y1={zeroY} x2={W - PAD} y2={zeroY} stroke="var(--border)" strokeDasharray="4 2" />

      {/* Fill */}
      <path d={fillPath} fill={finalPnl >= 0 ? 'rgba(16,185,129,0.08)' : 'rgba(244,63,94,0.08)'} />

      {/* Line */}
      <path d={linePath} fill="none" stroke={finalPnl >= 0 ? '#10b981' : '#f43f5e'} strokeWidth="1.5" />

      {/* Dots for losses */}
      {points.map((p, i) => !p.won && (
        <circle key={i} cx={scaleX(i)} cy={scaleY(p.cum)} r="2" fill="#f43f5e" opacity="0.7" />
      ))}

      {/* Labels */}
      <text x={PAD - 3} y={scaleY(maxY) + 4} fill="var(--text-3)" fontSize="9" textAnchor="end" fontFamily="IBM Plex Mono, monospace">
        {fmt$(maxY)}
      </text>
      <text x={PAD - 3} y={scaleY(minY) + 4} fill="var(--text-3)" fontSize="9" textAnchor="end" fontFamily="IBM Plex Mono, monospace">
        {fmt$(minY)}
      </text>
      <text x={PAD} y={H - 5} fill="var(--text-4)" fontSize="8" fontFamily="IBM Plex Mono, monospace">
        {sorted[0]?.date.slice(5)}
      </text>
      <text x={W - PAD} y={H - 5} fill="var(--text-4)" fontSize="8" textAnchor="end" fontFamily="IBM Plex Mono, monospace">
        {sorted[sorted.length - 1]?.date.slice(5)}
      </text>

      {/* Final value */}
      <text x={W - PAD + 3} y={scaleY(finalPnl) + 4} fill={finalPnl >= 0 ? '#10b981' : '#f43f5e'}
        fontSize="10" fontWeight="700" fontFamily="IBM Plex Mono, monospace">
        {fmt$(finalPnl)}
      </text>
    </svg>
  )
}

/* ── Table cell styles ──────────────────────────────────────────────────── */

const thS: React.CSSProperties = {
  padding: '8px 8px', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
  color: 'var(--text-3)', borderBottom: '1px solid var(--border)',
  textAlign: 'left', position: 'sticky', top: 0, background: 'var(--bg-card)', zIndex: 1,
  whiteSpace: 'nowrap',
}

const tdS: React.CSSProperties = {
  padding: '6px 8px', borderBottom: '1px solid var(--border)',
  whiteSpace: 'nowrap', color: 'var(--text-2)',
}
