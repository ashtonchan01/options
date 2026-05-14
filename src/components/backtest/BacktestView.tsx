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
const SLIPPAGE_PER_LEG = 0.15
const COMMISSION_PER_LEG = 0.50

// Scanner palette
const C = {
  cyan: '#00E5FF', cyanDim: 'rgba(0,229,255,0.12)', cyanGlow: 'rgba(0,229,255,0.06)',
  green: '#00D084', greenDim: 'rgba(0,208,132,0.12)',
  red: '#FF4757', redDim: 'rgba(255,71,87,0.12)',
  gold: '#F0B429', goldDim: 'rgba(240,180,41,0.12)',
  blue: '#3B9EFF', purple: '#A855F7',
}

interface Trade {
  entryDate: string;  exitDate: string
  entrySpx: number;   exitSpx: number
  shortK: number;     longK: number
  entryCredit: number; netCredit: number
  exitCost: number;   pnl: number
  holdDays: number;   exitReason: string
  won: boolean;       entryVix: number
}

interface ComboResult {
  dayLabel: string;  weekLabel: string;  exitLabel: string
  exitRule: ExitRule; trades: Trade[]
  numTrades: number;  winRate: number
  totalPnl: number;   avgPnl: number
  avgWin: number;     avgLoss: number
  profitFactor: number; maxDrawdown: number
  sharpe: number; maxConsecLoss: number; avgHoldDays: number
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
   BACKTEST ENGINE
   ═══════════════════════════════════════════════════════════════════════════ */

function runCombo(entryDow: number | null, entryWeek: number | null, exitRule: ExitRule, spreadWidth: number, targetDte: number): ComboResult {
  const trades: Trade[] = []
  const entrySlip = 2 * SLIPPAGE_PER_LEG
  const exitSlip  = 2 * SLIPPAGE_PER_LEG
  const entryComm = 2 * COMMISSION_PER_LEG
  const exitComm  = 2 * COMMISSION_PER_LEG

  for (let i = 0; i < SPX_DAILY.length; i++) {
    const [date, , , , close, vix] = SPX_DAILY[i]
    const dt = new Date(date), dow = dt.getDay()
    if (dow < 1 || dow > 5) continue
    if (entryDow !== null && dow !== entryDow) continue
    if (entryWeek !== null && weekOfMonth(date) !== entryWeek) continue

    const expiryMs = dt.getTime() + targetDte * 86_400_000
    let expiryIdx = -1
    for (let j = i + 1; j < SPX_DAILY.length; j++) {
      if (new Date(SPX_DAILY[j][0]).getTime() >= expiryMs) { expiryIdx = j; break }
    }
    if (expiryIdx === -1) continue

    const iv = vix / 100, T = targetDte / 365
    const shortK = Math.round(close / 5) * 5
    const longK  = shortK - spreadWidth
    const rawCredit = Math.round((bsmPut(close, shortK, T, RF, iv) - bsmPut(close, longK, T, RF, iv)) / 0.05) * 0.05
    const netCredit = rawCredit - entrySlip
    if (netCredit <= 0) continue

    let exitIdx = expiryIdx, exitReason = 'Expiry', exitCost = 0, closedEarly = false

    if (exitRule !== 'hold') {
      for (let j = i + 1; j < expiryIdx; j++) {
        const [d2, , , , c2, v2] = SPX_DAILY[j]
        const held = calDays(date, d2), dteLeft = targetDte - held
        const Tj = Math.max(dteLeft / 365, 0.001)
        const curSpread = Math.round((bsmPut(c2, shortK, Tj, RF, v2/100) - bsmPut(c2, longK, Tj, RF, v2/100)) / 0.05) * 0.05
        const profitPct = (rawCredit - curSpread) / rawCredit
        let shouldExit = false, reason = ''
        switch (exitRule) {
          case '50pct': if (profitPct >= 0.50) { shouldExit = true; reason = '50% Profit' } break
          case '90pct': if (profitPct >= 0.90) { shouldExit = true; reason = '90% Profit' } break
          case '30day': if (dteLeft <= 30) { shouldExit = true; reason = '30 DTE Close' } break
          case '50pct_30day':
            if (profitPct >= 0.50) { shouldExit = true; reason = '50% Profit' }
            else if (dteLeft <= 30) { shouldExit = true; reason = '30 DTE Close' } break
          case '90pct_30day':
            if (profitPct >= 0.90) { shouldExit = true; reason = '90% Profit' }
            else if (dteLeft <= 30) { shouldExit = true; reason = '30 DTE Close' } break
        }
        if (shouldExit) { exitIdx = j; exitReason = reason; exitCost = curSpread + exitSlip; closedEarly = true; break }
      }
    }

    let pnl: number
    if (closedEarly) { pnl = (netCredit - exitCost) * MULTIPLIER - (entryComm + exitComm) }
    else {
      const finalS = SPX_DAILY[expiryIdx][4]
      exitCost = Math.max(shortK - finalS, 0) - Math.max(longK - finalS, 0)
      pnl = (netCredit - exitCost) * MULTIPLIER - entryComm
    }
    trades.push({ entryDate: date, exitDate: SPX_DAILY[exitIdx][0], entrySpx: close, exitSpx: SPX_DAILY[exitIdx][4], shortK, longK, entryCredit: rawCredit, netCredit, exitCost, pnl, holdDays: calDays(date, SPX_DAILY[exitIdx][0]), exitReason, won: pnl > 0, entryVix: vix })
  }

  const n = trades.length
  if (n === 0) return { dayLabel: entryDow === null ? 'Any' : DAY_LABELS[entryDow], weekLabel: entryWeek === null ? 'Any' : WEEK_LABELS[entryWeek], exitLabel: EXIT_LABELS[exitRule], exitRule, trades: [], numTrades: 0, winRate: 0, totalPnl: 0, avgPnl: 0, avgWin: 0, avgLoss: 0, profitFactor: 0, maxDrawdown: 0, sharpe: 0, maxConsecLoss: 0, avgHoldDays: 0 }

  const wins = trades.filter(t => t.won), losses = trades.filter(t => !t.won)
  const totalPnl = trades.reduce((s, t) => s + t.pnl, 0), avgPnl = totalPnl / n
  const avgWin = wins.length ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0
  const avgLoss = losses.length ? losses.reduce((s, t) => s + t.pnl, 0) / losses.length : 0
  const grossWin = wins.reduce((s, t) => s + t.pnl, 0)
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0))
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? Infinity : 0)

  const sorted = [...trades].sort((a, b) => a.exitDate.localeCompare(b.exitDate))
  let cumPnl = 0, peak = 0, maxDD = 0
  for (const t of sorted) { cumPnl += t.pnl; if (cumPnl > peak) peak = cumPnl; const dd = peak - cumPnl; if (dd > maxDD) maxDD = dd }

  const std = Math.sqrt(trades.map(t => t.pnl).reduce((s, p) => s + (p - avgPnl) ** 2, 0) / Math.max(n - 1, 1))
  const totalCalDays = calDays(SPX_DAILY[0][0], SPX_DAILY[SPX_DAILY.length - 1][0])
  const sharpe = std > 0 ? (avgPnl / std) * Math.sqrt(n / (totalCalDays / 365)) : 0

  let maxCL = 0, curCL = 0
  for (const t of trades) { if (!t.won) { curCL++; maxCL = Math.max(maxCL, curCL) } else curCL = 0 }

  return { dayLabel: entryDow === null ? 'Any' : DAY_LABELS[entryDow], weekLabel: entryWeek === null ? 'Any' : WEEK_LABELS[entryWeek], exitLabel: EXIT_LABELS[exitRule], exitRule, trades, numTrades: n, winRate: (wins.length / n) * 100, totalPnl, avgPnl, avgWin, avgLoss, profitFactor, maxDrawdown: maxDD, sharpe, maxConsecLoss: maxCL, avgHoldDays: trades.reduce((s, t) => s + t.holdDays, 0) / n }
}

function runFullSweep(width: number, dte: number): ComboResult[] {
  const days: (number | null)[] = [null, 1, 2, 3, 4, 5]
  const weeks: (number | null)[] = [null, 1, 2, 3, 4]
  const results: ComboResult[] = []
  for (const d of days) for (const w of weeks) for (const e of EXIT_RULES) {
    const r = runCombo(d, w, e, width, dte)
    if (r.numTrades > 0) results.push(r)
  }
  return results.sort((a, b) => b.sharpe - a.sharpe)
}

/* ═══════════════════════════════════════════════════════════════════════════
   STYLES
   ═══════════════════════════════════════════════════════════════════════════ */

const tile: React.CSSProperties = {
  background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6,
  overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0,
  transition: 'border-color 0.2s',
}
const tileHdr: React.CSSProperties = {
  padding: '10px 14px', borderBottom: '1px solid var(--border)',
  fontSize: 10, fontWeight: 700, color: 'var(--text-4)', letterSpacing: '2px', flexShrink: 0,
}
const selectS: React.CSSProperties = {
  background: 'var(--bg-elevated)', border: '1px solid var(--border-light)',
  color: 'var(--text-1)', padding: '7px 10px', fontSize: 12,
  fontFamily: "'IBM Plex Mono', monospace", outline: 'none', cursor: 'pointer',
  borderRadius: 3, transition: 'border-color 0.15s',
}
const thS: React.CSSProperties = {
  padding: '8px 8px', fontSize: 9, fontWeight: 700, letterSpacing: '1.5px',
  color: 'var(--text-4)', borderBottom: '1px solid var(--border)',
  textAlign: 'left', position: 'sticky', top: 0, background: 'var(--bg-card)', zIndex: 1,
  whiteSpace: 'nowrap',
}
const tdS: React.CSSProperties = {
  padding: '6px 8px', borderBottom: '1px solid var(--border)',
  whiteSpace: 'nowrap', color: 'var(--text-2)', fontSize: 12,
}

type SortKey = 'winRate' | 'totalPnl' | 'avgPnl' | 'profitFactor' | 'maxDrawdown' | 'sharpe' | 'numTrades' | 'maxConsecLoss' | 'avgHoldDays'

const COLUMNS: { key: SortKey; label: string; fmt: (v: number) => string; w: number }[] = [
  { key: 'numTrades',     label: 'TRADES',  fmt: v => String(v),                            w: 55 },
  { key: 'winRate',       label: 'WIN %',   fmt: v => v.toFixed(1) + '%',                   w: 55 },
  { key: 'totalPnl',      label: 'TOTAL P/L', fmt: v => fmt$(v),                            w: 85 },
  { key: 'avgPnl',        label: 'AVG P/L', fmt: v => fmt$(v),                              w: 75 },
  { key: 'profitFactor',  label: 'PF',      fmt: v => v === Infinity ? '∞' : v.toFixed(2),  w: 45 },
  { key: 'maxDrawdown',   label: 'MAX DD',  fmt: v => fmt$(v),                              w: 75 },
  { key: 'sharpe',        label: 'SHARPE',  fmt: v => v.toFixed(2),                         w: 60 },
  { key: 'maxConsecLoss', label: 'STREAK',  fmt: v => String(v) + 'L',                      w: 50 },
  { key: 'avgHoldDays',   label: 'AVG DAYS',fmt: v => v.toFixed(0) + 'd',                   w: 60 },
]

function cellColor(key: SortKey, v: number): string {
  if (key === 'totalPnl' || key === 'avgPnl') return v >= 0 ? C.green : C.red
  if (key === 'winRate') return v >= 70 ? C.green : v >= 50 ? C.gold : C.red
  if (key === 'profitFactor') return v >= 1.5 ? C.green : v >= 1.0 ? C.gold : C.red
  if (key === 'sharpe') return v >= 1.0 ? C.green : v >= 0.5 ? C.gold : C.red
  if (key === 'maxDrawdown') return v > 10000 ? C.red : C.gold
  return 'var(--text-2)'
}

/* ═══════════════════════════════════════════════════════════════════════════
   COMPONENT
   ═══════════════════════════════════════════════════════════════════════════ */

export default function BacktestView({ }: { state: AppState }) {
  const [results, setResults]         = useState<ComboResult[] | null>(null)
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [sortKey, setSortKey]         = useState<SortKey>('sharpe')
  const [sortAsc, setSortAsc]         = useState(false)
  const [running, setRunning]         = useState(false)
  const [spreadWidth, setSpreadWidth] = useState(30)
  const [targetDte, setTargetDte]     = useState(65)

  const handleRun = useCallback(() => {
    setRunning(true)
    requestAnimationFrame(() => { setTimeout(() => {
      setResults(runFullSweep(spreadWidth, targetDte))
      setSelectedIdx(0); setRunning(false)
    }, 20) })
  }, [spreadWidth, targetDte])

  const sorted = useMemo(() => {
    if (!results) return []
    return [...results].sort((a, b) => {
      const av = a[sortKey] as number, bv = b[sortKey] as number
      return sortAsc ? av - bv : bv - av
    })
  }, [results, sortKey, sortAsc])

  const selected = sorted[selectedIdx] ?? null

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(p => !p)
    else { setSortKey(key); setSortAsc(false) }
  }

  return (
    <div style={{ padding: 14, height: '100%', display: 'flex', flexDirection: 'column', gap: 8, overflow: 'hidden' }}>

      {/* ── CONFIG PANEL ─────────────────────────────────────────── */}
      <div style={{
        background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6,
        padding: '14px 18px', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 10, color: 'var(--text-4)', letterSpacing: 2, marginBottom: 2 }}>STRATEGY</div>
            <div style={{ fontFamily: "'Chakra Petch', sans-serif", fontSize: 18, fontWeight: 700, color: 'var(--text-1)', letterSpacing: 1 }}>
              SPX ATM BULL PUT SPREAD
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 10, color: 'var(--text-4)', letterSpacing: 2, marginBottom: 2 }}>DATA RANGE</div>
            <div style={{ fontSize: 12, color: 'var(--text-3)', fontFamily: "'IBM Plex Mono', monospace" }}>
              {SPX_DAILY[0][0]} → {SPX_DAILY[SPX_DAILY.length - 1][0]} · {SPX_DAILY.length} bars
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 10, alignItems: 'end' }}>
          <FormField label="SPREAD WIDTH">
            <select value={spreadWidth} onChange={e => setSpreadWidth(+e.target.value)} style={selectS}>
              {[20, 25, 30, 40, 50].map(w => <option key={w} value={w}>{w} pt</option>)}
            </select>
          </FormField>
          <FormField label="TARGET DTE">
            <select value={targetDte} onChange={e => setTargetDte(+e.target.value)} style={selectS}>
              {[30, 45, 60, 65, 75, 90].map(d => <option key={d} value={d}>{d} days</option>)}
            </select>
          </FormField>
          <FormField label="COMMISSION">
            <div style={{ ...selectS, cursor: 'default', color: 'var(--text-3)' }}>$0.50/leg</div>
          </FormField>
          <FormField label="SLIPPAGE">
            <div style={{ ...selectS, cursor: 'default', color: 'var(--text-3)' }}>$0.15/leg</div>
          </FormField>
          <FormField label="TICK SIZE">
            <div style={{ ...selectS, cursor: 'default', color: 'var(--text-3)' }}>$0.05</div>
          </FormField>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={handleRun} disabled={running} style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              padding: '8px 16px', background: running ? 'var(--bg-elevated)' : C.cyan,
              border: `1px solid ${running ? 'var(--border-light)' : C.cyan}`, borderRadius: 3,
              color: running ? 'var(--text-3)' : '#0a0e14', fontSize: 11, fontWeight: 700,
              letterSpacing: 1, cursor: running ? 'wait' : 'pointer',
              fontFamily: "'Inter', sans-serif", transition: 'all 0.15s',
            }}>
              <Play size={11} style={{ animation: running ? 'spin 1s linear infinite' : 'none' }} />
              {running ? 'RUNNING…' : 'RUN SWEEP'}
            </button>
            {results && (
              <button onClick={() => { setResults(null); setSelectedIdx(0) }} style={{
                padding: '8px 10px', background: 'transparent', border: '1px solid var(--border)',
                borderRadius: 3, color: 'var(--text-4)', cursor: 'pointer',
                display: 'flex', alignItems: 'center', transition: 'all 0.15s',
              }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--border-light)'; e.currentTarget.style.color = 'var(--text-2)' }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-4)' }}
              >
                <RotateCcw size={12} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── RESULTS ──────────────────────────────────────────────── */}
      {results && results.length > 0 && selected && (
        <>
          {/* Stat cards row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 6, flexShrink: 0 }}>
            {[
              { label: 'COMBO', value: `${selected.dayLabel} · ${selected.weekLabel}`, sub: selected.exitLabel, color: C.cyan },
              { label: 'WIN RATE', value: selected.winRate.toFixed(1) + '%', color: selected.winRate >= 70 ? C.green : C.gold },
              { label: 'TOTAL P/L', value: fmt$(selected.totalPnl), color: selected.totalPnl >= 0 ? C.green : C.red },
              { label: 'AVG P/L', value: fmt$(selected.avgPnl), color: selected.avgPnl >= 0 ? C.green : C.red },
              { label: 'PROFIT FACTOR', value: selected.profitFactor === Infinity ? '∞' : selected.profitFactor.toFixed(2), color: selected.profitFactor >= 1.5 ? C.green : C.gold },
              { label: 'MAX DD', value: fmt$(selected.maxDrawdown), color: C.red },
              { label: 'SHARPE', value: selected.sharpe.toFixed(2), color: selected.sharpe >= 1.0 ? C.green : C.gold },
              { label: 'AVG HOLD', value: selected.avgHoldDays.toFixed(0) + 'd', color: C.blue },
            ].map(s => (
              <div key={s.label} style={{
                background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 4,
                padding: '10px 12px', textAlign: 'center',
                transition: 'border-color 0.2s, box-shadow 0.2s',
              }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--border-light)'; e.currentTarget.style.boxShadow = `0 0 16px ${C.cyanGlow}` }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.boxShadow = 'none' }}
              >
                <div style={{ fontSize: 9, color: 'var(--text-4)', letterSpacing: 2, marginBottom: 4 }}>{s.label}</div>
                <div style={{
                  fontFamily: "'Chakra Petch', sans-serif", fontSize: 20, fontWeight: 700,
                  color: s.color, lineHeight: 1,
                }}>{s.value}</div>
                {'sub' in s && s.sub && (
                  <div style={{ fontSize: 9, color: 'var(--text-4)', marginTop: 2, letterSpacing: 0.5 }}>{s.sub}</div>
                )}
              </div>
            ))}
          </div>

          {/* Main grid */}
          <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr', gap: 6, minHeight: 0 }}>

            {/* Ranking table */}
            <div style={{ ...tile, gridRow: '1 / 3' }}>
              <div style={tileHdr}>
                RANKING · {sorted.length} COMBINATIONS
                <span style={{ float: 'right', fontWeight: 400, color: 'var(--text-5)', fontSize: 10, letterSpacing: 0 }}>
                  click row to inspect
                </span>
              </div>
              <div style={{ flex: 1, overflow: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={thS}>#</th>
                      <th style={thS}>DAY</th>
                      <th style={thS}>WEEK</th>
                      <th style={thS}>EXIT</th>
                      {COLUMNS.map(c => (
                        <th key={c.key} onClick={() => toggleSort(c.key)} style={{
                          ...thS, cursor: 'pointer', userSelect: 'none', width: c.w,
                          color: sortKey === c.key ? C.cyan : 'var(--text-4)',
                        }}>
                          {c.label} {sortKey === c.key ? (sortAsc ? '▲' : '▼') : ''}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((r, i) => {
                      const isSel = i === selectedIdx
                      return (
                        <tr key={i} onClick={() => setSelectedIdx(i)}
                          style={{
                            cursor: 'pointer',
                            background: isSel ? C.cyanDim : i % 2 === 0 ? 'transparent' : 'var(--bg-surface)',
                            borderLeft: isSel ? `2px solid ${C.cyan}` : '2px solid transparent',
                            transition: 'background 0.1s',
                          }}
                          onMouseEnter={e => { if (!isSel) e.currentTarget.style.background = 'var(--bg-elevated)' }}
                          onMouseLeave={e => { if (!isSel) e.currentTarget.style.background = i % 2 === 0 ? 'transparent' : 'var(--bg-surface)' }}
                        >
                          <td style={{ ...tdS, color: isSel ? C.cyan : 'var(--text-4)', fontWeight: isSel ? 700 : 400 }}>{i + 1}</td>
                          <td style={tdS}>{r.dayLabel}</td>
                          <td style={tdS}>{r.weekLabel}</td>
                          <td style={{ ...tdS, fontSize: 10 }}>{r.exitLabel}</td>
                          {COLUMNS.map(c => (
                            <td key={c.key} style={{ ...tdS, color: cellColor(c.key, r[c.key] as number), fontFamily: "'IBM Plex Mono', monospace", fontSize: 11 }}>
                              {c.fmt(r[c.key] as number)}
                            </td>
                          ))}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Equity curve */}
            <div style={tile}>
              <div style={tileHdr}>EQUITY CURVE · {selected.numTrades} TRADES</div>
              <div style={{ flex: 1, padding: '10px 12px', overflow: 'hidden' }}>
                <EquityCurve trades={selected.trades} />
              </div>
            </div>

            {/* Trade log */}
            <div style={tile}>
              <div style={tileHdr}>
                TRADE LOG
                <span style={{ float: 'right', fontWeight: 400, color: 'var(--text-5)', fontSize: 10, letterSpacing: 0 }}>
                  avg win {fmt$(selected.avgWin)} · avg loss {fmt$(selected.avgLoss)}
                </span>
              </div>
              <div style={{ flex: 1, overflow: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      {['ENTRY', 'EXIT', 'SPX', 'STRIKES', 'CREDIT', 'DEBIT', 'P/L', 'DAYS', 'EXIT'].map(h => (
                        <th key={h} style={thS}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {selected.trades.map((t, i) => (
                      <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : 'var(--bg-surface)' }}>
                        <td style={{ ...tdS, fontSize: 10, color: 'var(--text-3)' }}>{t.entryDate.slice(5)}</td>
                        <td style={{ ...tdS, fontSize: 10, color: 'var(--text-3)' }}>{t.exitDate.slice(5)}</td>
                        <td style={{ ...tdS, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11 }}>
                          {t.entrySpx.toFixed(0)}<span style={{ color: 'var(--text-4)' }}>→</span>{t.exitSpx.toFixed(0)}
                        </td>
                        <td style={{ ...tdS, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--text-3)' }}>
                          {t.shortK}/{t.longK}
                        </td>
                        <td style={{ ...tdS, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: C.green }}>
                          {t.netCredit.toFixed(2)}
                        </td>
                        <td style={{ ...tdS, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: C.gold }}>
                          {t.exitCost.toFixed(2)}
                        </td>
                        <td style={{ ...tdS, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, fontWeight: 700, color: t.pnl >= 0 ? C.green : C.red }}>
                          {fmt$(t.pnl)}
                        </td>
                        <td style={{ ...tdS, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--text-4)' }}>
                          {t.holdDays}
                        </td>
                        <td style={{ ...tdS, fontSize: 10, color: t.exitReason.includes('Profit') ? C.green : t.exitReason === 'Expiry' ? C.blue : C.gold }}>
                          {t.exitReason}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── EMPTY STATE ──────────────────────────────────────────── */}
      {!results && !running && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ textAlign: 'center', maxWidth: 480 }}>
            <div style={{ fontFamily: "'Chakra Petch', sans-serif", fontSize: 22, fontWeight: 700, color: 'var(--text-1)', letterSpacing: 1, marginBottom: 8 }}>
              SPX BULL PUT SPREAD
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.8, color: 'var(--text-3)' }}>
              Full parameter sweep across <span style={{ color: C.cyan, fontWeight: 600 }}>entry day</span> (Mon–Fri),{' '}
              <span style={{ color: C.cyan, fontWeight: 600 }}>entry week</span> (W1–W4), and{' '}
              <span style={{ color: C.cyan, fontWeight: 600 }}>exit rule</span> (hold / 50% / 90% / 30 DTE / combos)
              <br />
              using {SPX_DAILY.length} days of real SPX + VIX data with BSM pricing.
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-4)', marginTop: 8, letterSpacing: 1 }}>
              COSTS: ${COMMISSION_PER_LEG.toFixed(2)}/CONTRACT + ${SLIPPAGE_PER_LEG.toFixed(2)} SLIPPAGE/LEG · $0.05 TICK
            </div>
            <button onClick={handleRun} style={{
              marginTop: 24, padding: '10px 28px', background: C.cyan, border: `1px solid ${C.cyan}`,
              borderRadius: 3, color: '#0a0e14', fontSize: 12, fontWeight: 700, letterSpacing: 1.5,
              cursor: 'pointer', fontFamily: "'Inter', sans-serif",
              display: 'inline-flex', alignItems: 'center', gap: 8,
              transition: 'all 0.15s',
              boxShadow: `0 0 20px ${C.cyanGlow}`,
            }}
              onMouseEnter={e => { e.currentTarget.style.boxShadow = `0 0 30px rgba(0,229,255,0.2)` }}
              onMouseLeave={e => { e.currentTarget.style.boxShadow = `0 0 20px ${C.cyanGlow}` }}
            >
              <Play size={12} /> RUN FULL SWEEP
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   FORM FIELD
   ═══════════════════════════════════════════════════════════════════════════ */

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 9, color: 'var(--text-4)', letterSpacing: 2, marginBottom: 4 }}>{label}</div>
      {children}
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

  if (points.length < 2) return <div style={{ color: 'var(--text-4)', fontSize: 12, padding: 20 }}>Not enough trades</div>

  const maxY = Math.max(...points.map(p => p.cum), 0)
  const minY = Math.min(...points.map(p => p.cum), 0)
  const rangeY = maxY - minY || 1
  const W = 500, H = 180, PL = 40, PR = 50, PT = 12, PB = 20

  const scaleX = (i: number) => PL + (i / (points.length - 1)) * (W - PL - PR)
  const scaleY = (v: number) => PT + (1 - (v - minY) / rangeY) * (H - PT - PB)

  const linePath = points.map((p, i) =>
    `${i === 0 ? 'M' : 'L'}${scaleX(i).toFixed(1)},${scaleY(p.cum).toFixed(1)}`
  ).join(' ')

  const areaPath = linePath +
    ` L${scaleX(points.length - 1).toFixed(1)},${scaleY(0).toFixed(1)}` +
    ` L${scaleX(0).toFixed(1)},${scaleY(0).toFixed(1)} Z`

  const zeroY = scaleY(0)
  const finalPnl = points[points.length - 1].cum
  const isUp = finalPnl >= 0
  const lineColor = isUp ? C.green : C.red
  // Grid lines
  const gridCount = 4
  const gridLines = Array.from({ length: gridCount + 1 }, (_, i) => {
    const v = minY + (rangeY * i) / gridCount
    return { y: scaleY(v), label: fmt$(v) }
  })

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: '100%' }}>
      <defs>
        <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={lineColor} stopOpacity="0.15" />
          <stop offset="100%" stopColor={lineColor} stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Grid lines */}
      {gridLines.map((g, i) => (
        <g key={i}>
          <line x1={PL} y1={g.y} x2={W - PR} y2={g.y} stroke="var(--border)" strokeWidth="0.5" strokeDasharray={i === 0 || i === gridCount ? 'none' : '2 4'} />
          <text x={PL - 4} y={g.y + 3} fill="var(--text-4)" fontSize="8" textAnchor="end" fontFamily="IBM Plex Mono, monospace">
            {g.label}
          </text>
        </g>
      ))}

      {/* Zero line (brighter) */}
      <line x1={PL} y1={zeroY} x2={W - PR} y2={zeroY} stroke="var(--border-light)" strokeWidth="1" />

      {/* Area fill */}
      <path d={areaPath} fill="url(#eqGrad)" />

      {/* Main line */}
      <path d={linePath} fill="none" stroke={lineColor} strokeWidth="1.5" strokeLinejoin="round" />

      {/* Loss dots */}
      {points.map((p, i) => !p.won && (
        <circle key={i} cx={scaleX(i)} cy={scaleY(p.cum)} r="2" fill={C.red} opacity="0.6" />
      ))}

      {/* X-axis labels */}
      <text x={PL} y={H - 4} fill="var(--text-4)" fontSize="8" fontFamily="IBM Plex Mono, monospace">
        {points[0]?.date.slice(5)}
      </text>
      <text x={W - PR} y={H - 4} fill="var(--text-4)" fontSize="8" textAnchor="end" fontFamily="IBM Plex Mono, monospace">
        {points[points.length - 1]?.date.slice(5)}
      </text>

      {/* Final value callout */}
      <text x={W - PR + 6} y={scaleY(finalPnl) + 4} fill={lineColor}
        fontSize="11" fontWeight="700" fontFamily="Chakra Petch, sans-serif">
        {fmt$(finalPnl)}
      </text>
    </svg>
  )
}
