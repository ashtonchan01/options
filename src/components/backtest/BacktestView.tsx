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

interface Trade {
  entryDate: string; exitDate: string
  entrySpx: number; exitSpx: number
  shortK: number; longK: number
  entryCredit: number; netCredit: number
  exitCost: number; contracts: number
  pnl: number; holdDays: number
  exitReason: string; won: boolean; entryVix: number
}

interface BacktestResult {
  trades: Trade[]
  numTrades: number; wins: number; losses: number; winRate: number
  totalPnl: number; avgPnl: number; avgWin: number; avgLoss: number
  profitFactor: number; maxDrawdown: number; maxDrawdownPct: number
  sharpe: number; maxConsecLoss: number; maxConsecWin: number
  avgHoldDays: number; returnPct: number; cagr: number; calmar: number
  startingCapital: number
}

type ExitRule = 'hold' | '50pct' | '90pct' | '30dte' | '50pct_30dte' | '90pct_30dte'
interface ComboResult {
  dayLabel: string; weekLabel: string; exitLabel: string; exitRule: ExitRule
  trades: Trade[]; numTrades: number; winRate: number
  totalPnl: number; avgPnl: number; avgWin: number; avgLoss: number
  profitFactor: number; maxDrawdown: number; sharpe: number
  maxConsecLoss: number; avgHoldDays: number
}

const RF = 0.045, MULTIPLIER = 100, SLIPPAGE = 0.15, COMMISSION = 0.50

const C = {
  cyan: '#00E5FF', cyanDim: 'rgba(0,229,255,0.12)', cyanGlow: 'rgba(0,229,255,0.06)',
  green: '#00D084', greenDim: 'rgba(0,208,132,0.12)',
  red: '#FF4757', redDim: 'rgba(255,71,87,0.12)',
  gold: '#F0B429', goldDim: 'rgba(240,180,41,0.12)',
  blue: '#3B9EFF', purple: '#A855F7',
}

const EXIT_RULES: ExitRule[] = ['hold', '50pct', '90pct', '30dte', '50pct_30dte', '90pct_30dte']
const EXIT_LABELS: Record<ExitRule, string> = {
  hold: 'Hold to Expiry', '50pct': '50% Profit', '90pct': '90% Profit',
  '30dte': 'Close @ 30 DTE', '50pct_30dte': '50% or 30 DTE', '90pct_30dte': '90% or 30 DTE',
}
const DAY_LABELS: Record<number, string> = { 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri' }
const WEEK_LABELS: Record<number, string> = { 1: 'W1', 2: 'W2', 3: 'W3', 4: 'W4' }

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
function fmtPct(n: number): string { return (n >= 0 ? '+' : '') + n.toFixed(1) + '%' }
function heatColor(pct: number): string {
  if (pct === 0) return 'transparent'
  const abs = Math.min(Math.abs(pct), 8)
  const o = 0.12 + (abs / 8) * 0.55
  return pct > 0 ? `rgba(0,208,132,${o.toFixed(2)})` : `rgba(255,71,87,${o.toFixed(2)})`
}

/* ═══════════════════════════════════════════════════════════════════════════
   ENGINE: SINGLE RUN
   ═══════════════════════════════════════════════════════════════════════════ */

function runSingle(cfg: {
  entryDay: number | null; entryWeek: number | null
  spreadWidth: number; targetDte: number; strikeOffset: number
  profitTarget: number | null; exitDte: number | null
  sizing: string; startingCapital: number
}): BacktestResult {
  const [sType, sVal] = cfg.sizing.split('-')
  const isScale = sType === 'scale'
  const fixedCts = isScale ? 1 : parseInt(sVal)
  const scalePct = isScale ? parseFloat(sVal) : 0
  const entrySlip = 2 * SLIPPAGE, exitSlip = 2 * SLIPPAGE
  const entryComm = 2 * COMMISSION, exitComm = 2 * COMMISSION

  let equity = cfg.startingCapital
  const trades: Trade[] = []

  for (let i = 0; i < SPX_DAILY.length; i++) {
    const [date, , , , close, vix] = SPX_DAILY[i]
    const dt = new Date(date), dow = dt.getDay()
    if (dow < 1 || dow > 5) continue
    if (cfg.entryDay !== null && dow !== cfg.entryDay) continue
    if (cfg.entryWeek !== null && weekOfMonth(date) !== cfg.entryWeek) continue

    const expiryMs = dt.getTime() + cfg.targetDte * 86_400_000
    let expiryIdx = -1
    for (let j = i + 1; j < SPX_DAILY.length; j++) {
      if (new Date(SPX_DAILY[j][0]).getTime() >= expiryMs) { expiryIdx = j; break }
    }
    if (expiryIdx === -1) continue

    const contracts = isScale
      ? Math.max(1, Math.floor(equity * scalePct / (cfg.spreadWidth * MULTIPLIER)))
      : fixedCts

    const iv = vix / 100, T = cfg.targetDte / 365
    const shortK = Math.round(close / 5) * 5 - cfg.strikeOffset
    const longK = shortK - cfg.spreadWidth
    const rawCredit = Math.round((bsmPut(close, shortK, T, RF, iv) - bsmPut(close, longK, T, RF, iv)) / 0.05) * 0.05
    const netCredit = rawCredit - entrySlip
    if (netCredit <= 0) continue

    let exitIdx = expiryIdx, exitReason = 'Expiry', exitCost = 0, closedEarly = false

    if (cfg.profitTarget !== null || cfg.exitDte !== null) {
      for (let j = i + 1; j < expiryIdx; j++) {
        const [, , , , c2, v2] = SPX_DAILY[j]
        const held = calDays(date, SPX_DAILY[j][0]), dteLeft = cfg.targetDte - held
        const Tj = Math.max(dteLeft / 365, 0.001)
        const curSpread = Math.round((bsmPut(c2, shortK, Tj, RF, v2 / 100) - bsmPut(c2, longK, Tj, RF, v2 / 100)) / 0.05) * 0.05
        const profitPct = (rawCredit - curSpread) / rawCredit
        let shouldExit = false, reason = ''
        if (cfg.profitTarget !== null && profitPct >= cfg.profitTarget) {
          shouldExit = true; reason = `${(cfg.profitTarget * 100).toFixed(0)}% Profit`
        } else if (cfg.exitDte !== null && dteLeft <= cfg.exitDte) {
          shouldExit = true; reason = `${cfg.exitDte} DTE Close`
        }
        if (shouldExit) { exitIdx = j; exitReason = reason; exitCost = curSpread + exitSlip; closedEarly = true; break }
      }
    }

    let pnl: number
    if (closedEarly) {
      pnl = (netCredit - exitCost) * MULTIPLIER * contracts - (entryComm + exitComm) * contracts
    } else {
      const finalS = SPX_DAILY[expiryIdx][4]
      exitCost = Math.max(shortK - finalS, 0) - Math.max(longK - finalS, 0)
      pnl = (netCredit - exitCost) * MULTIPLIER * contracts - entryComm * contracts
    }
    equity += pnl
    trades.push({
      entryDate: date, exitDate: SPX_DAILY[exitIdx][0],
      entrySpx: close, exitSpx: SPX_DAILY[exitIdx][4],
      shortK, longK, entryCredit: rawCredit, netCredit, exitCost,
      contracts, pnl, holdDays: calDays(date, SPX_DAILY[exitIdx][0]),
      exitReason, won: pnl > 0, entryVix: vix,
    })
  }

  return computeStats(trades, cfg.startingCapital)
}

function computeStats(trades: Trade[], startingCapital: number): BacktestResult {
  const n = trades.length
  if (n === 0) return { trades: [], numTrades: 0, wins: 0, losses: 0, winRate: 0, totalPnl: 0, avgPnl: 0, avgWin: 0, avgLoss: 0, profitFactor: 0, maxDrawdown: 0, maxDrawdownPct: 0, sharpe: 0, maxConsecLoss: 0, maxConsecWin: 0, avgHoldDays: 0, returnPct: 0, cagr: 0, calmar: 0, startingCapital }
  const wins = trades.filter(t => t.won), losses = trades.filter(t => !t.won)
  const totalPnl = trades.reduce((s, t) => s + t.pnl, 0), avgPnl = totalPnl / n
  const avgWin = wins.length ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0
  const avgLoss = losses.length ? losses.reduce((s, t) => s + t.pnl, 0) / losses.length : 0
  const grossWin = wins.reduce((s, t) => s + t.pnl, 0)
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0))
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? Infinity : 0)
  let eq = startingCapital, peak = startingCapital, maxDD = 0, maxDDPct = 0
  for (const t of trades) { eq += t.pnl; if (eq > peak) peak = eq; const dd = peak - eq; if (dd > maxDD) { maxDD = dd; maxDDPct = peak > 0 ? (dd / peak) * 100 : 0 } }
  const std = Math.sqrt(trades.map(t => t.pnl).reduce((s, p) => s + (p - avgPnl) ** 2, 0) / Math.max(n - 1, 1))
  const totalCalDays = calDays(SPX_DAILY[0][0], SPX_DAILY[SPX_DAILY.length - 1][0])
  const sharpe = std > 0 ? (avgPnl / std) * Math.sqrt(n / (totalCalDays / 365)) : 0
  let maxCL = 0, curCL = 0, maxCW = 0, curCW = 0
  for (const t of trades) { if (!t.won) { curCL++; maxCL = Math.max(maxCL, curCL); curCW = 0 } else { curCW++; maxCW = Math.max(maxCW, curCW); curCL = 0 } }
  const returnPct = (totalPnl / startingCapital) * 100
  const years = totalCalDays / 365.25
  const cagr = years > 0 ? (Math.pow(Math.max((startingCapital + totalPnl) / startingCapital, 0.001), 1 / years) - 1) * 100 : 0
  const calmar = maxDDPct > 0 ? cagr / maxDDPct : 0
  return { trades, numTrades: n, wins: wins.length, losses: losses.length, winRate: (wins.length / n) * 100, totalPnl, avgPnl, avgWin, avgLoss, profitFactor, maxDrawdown: maxDD, maxDrawdownPct: maxDDPct, sharpe, maxConsecLoss: maxCL, maxConsecWin: maxCW, avgHoldDays: trades.reduce((s, t) => s + t.holdDays, 0) / n, returnPct, cagr, calmar, startingCapital }
}

/* ═══════════════════════════════════════════════════════════════════════════
   ENGINE: SWEEP (per-contract, standard exit rules)
   ═══════════════════════════════════════════════════════════════════════════ */

function runCombo(entryDow: number | null, entryWeek: number | null, exitRule: ExitRule, spreadWidth: number, targetDte: number, strikeOffset: number): ComboResult {
  const entrySlip = 2 * SLIPPAGE, exitSlip = 2 * SLIPPAGE
  const entryComm = 2 * COMMISSION, exitComm = 2 * COMMISSION
  const trades: Trade[] = []
  for (let i = 0; i < SPX_DAILY.length; i++) {
    const [date, , , , close, vix] = SPX_DAILY[i]
    const dt = new Date(date), dow = dt.getDay()
    if (dow < 1 || dow > 5) continue
    if (entryDow !== null && dow !== entryDow) continue
    if (entryWeek !== null && weekOfMonth(date) !== entryWeek) continue
    const expiryMs = dt.getTime() + targetDte * 86_400_000
    let expiryIdx = -1
    for (let j = i + 1; j < SPX_DAILY.length; j++) { if (new Date(SPX_DAILY[j][0]).getTime() >= expiryMs) { expiryIdx = j; break } }
    if (expiryIdx === -1) continue
    const iv = vix / 100, T = targetDte / 365
    const shortK = Math.round(close / 5) * 5 - strikeOffset, longK = shortK - spreadWidth
    const rawCredit = Math.round((bsmPut(close, shortK, T, RF, iv) - bsmPut(close, longK, T, RF, iv)) / 0.05) * 0.05
    const netCredit = rawCredit - entrySlip
    if (netCredit <= 0) continue
    let exitIdx = expiryIdx, exitReason = 'Expiry', exitCost = 0, closedEarly = false
    if (exitRule !== 'hold') {
      for (let j = i + 1; j < expiryIdx; j++) {
        const [, , , , c2, v2] = SPX_DAILY[j]
        const held = calDays(date, SPX_DAILY[j][0]), dteLeft = targetDte - held
        const Tj = Math.max(dteLeft / 365, 0.001)
        const curSpread = Math.round((bsmPut(c2, shortK, Tj, RF, v2 / 100) - bsmPut(c2, longK, Tj, RF, v2 / 100)) / 0.05) * 0.05
        const profitPct = (rawCredit - curSpread) / rawCredit
        let shouldExit = false, reason = ''
        switch (exitRule) {
          case '50pct': if (profitPct >= 0.50) { shouldExit = true; reason = '50% Profit' } break
          case '90pct': if (profitPct >= 0.90) { shouldExit = true; reason = '90% Profit' } break
          case '30dte': if (dteLeft <= 30) { shouldExit = true; reason = '30 DTE Close' } break
          case '50pct_30dte': if (profitPct >= 0.50) { shouldExit = true; reason = '50% Profit' } else if (dteLeft <= 30) { shouldExit = true; reason = '30 DTE Close' } break
          case '90pct_30dte': if (profitPct >= 0.90) { shouldExit = true; reason = '90% Profit' } else if (dteLeft <= 30) { shouldExit = true; reason = '30 DTE Close' } break
        }
        if (shouldExit) { exitIdx = j; exitReason = reason; exitCost = curSpread + exitSlip; closedEarly = true; break }
      }
    }
    let pnl: number
    if (closedEarly) { pnl = (netCredit - exitCost) * MULTIPLIER - (entryComm + exitComm) }
    else { const finalS = SPX_DAILY[expiryIdx][4]; exitCost = Math.max(shortK - finalS, 0) - Math.max(longK - finalS, 0); pnl = (netCredit - exitCost) * MULTIPLIER - entryComm }
    trades.push({ entryDate: date, exitDate: SPX_DAILY[exitIdx][0], entrySpx: close, exitSpx: SPX_DAILY[exitIdx][4], shortK, longK, entryCredit: rawCredit, netCredit, exitCost, contracts: 1, pnl, holdDays: calDays(date, SPX_DAILY[exitIdx][0]), exitReason, won: pnl > 0, entryVix: vix })
  }
  const n = trades.length
  if (n === 0) return { dayLabel: entryDow === null ? 'Any' : DAY_LABELS[entryDow], weekLabel: entryWeek === null ? 'Any' : WEEK_LABELS[entryWeek], exitLabel: EXIT_LABELS[exitRule], exitRule, trades: [], numTrades: 0, winRate: 0, totalPnl: 0, avgPnl: 0, avgWin: 0, avgLoss: 0, profitFactor: 0, maxDrawdown: 0, sharpe: 0, maxConsecLoss: 0, avgHoldDays: 0 }
  const wins = trades.filter(t => t.won), losses = trades.filter(t => !t.won)
  const totalPnl = trades.reduce((s, t) => s + t.pnl, 0), avgPnl = totalPnl / n
  const avgWin = wins.length ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0
  const avgLoss = losses.length ? losses.reduce((s, t) => s + t.pnl, 0) / losses.length : 0
  const grossWin = wins.reduce((s, t) => s + t.pnl, 0), grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0))
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? Infinity : 0)
  let cumPnl = 0, peak = 0, maxDD = 0
  const sorted = [...trades].sort((a, b) => a.exitDate.localeCompare(b.exitDate))
  for (const t of sorted) { cumPnl += t.pnl; if (cumPnl > peak) peak = cumPnl; const dd = peak - cumPnl; if (dd > maxDD) maxDD = dd }
  const std = Math.sqrt(trades.map(t => t.pnl).reduce((s, p) => s + (p - avgPnl) ** 2, 0) / Math.max(n - 1, 1))
  const totalCalDays = calDays(SPX_DAILY[0][0], SPX_DAILY[SPX_DAILY.length - 1][0])
  const sharpe = std > 0 ? (avgPnl / std) * Math.sqrt(n / (totalCalDays / 365)) : 0
  let maxCL = 0, curCL = 0; for (const t of trades) { if (!t.won) { curCL++; maxCL = Math.max(maxCL, curCL) } else curCL = 0 }
  return { dayLabel: entryDow === null ? 'Any' : DAY_LABELS[entryDow], weekLabel: entryWeek === null ? 'Any' : WEEK_LABELS[entryWeek], exitLabel: EXIT_LABELS[exitRule], exitRule, trades, numTrades: n, winRate: (wins.length / n) * 100, totalPnl, avgPnl, avgWin, avgLoss, profitFactor, maxDrawdown: maxDD, sharpe, maxConsecLoss: maxCL, avgHoldDays: trades.reduce((s, t) => s + t.holdDays, 0) / n }
}

function runSweep(width: number, dte: number, offset: number): ComboResult[] {
  const days: (number | null)[] = [null, 1, 2, 3, 4, 5], weeks: (number | null)[] = [null, 1, 2, 3, 4]
  const results: ComboResult[] = []
  for (const d of days) for (const w of weeks) for (const e of EXIT_RULES) {
    const r = runCombo(d, w, e, width, dte, offset)
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
}
const tileHdr: React.CSSProperties = {
  padding: '10px 14px', borderBottom: '1px solid var(--border)',
  fontSize: 10, fontWeight: 700, color: 'var(--text-4)', letterSpacing: '2px', flexShrink: 0,
}
const selectS: React.CSSProperties = {
  background: 'var(--bg-elevated)', border: '1px solid var(--border-light)',
  color: 'var(--text-1)', padding: '7px 10px', fontSize: 12, width: '100%',
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
  { key: 'numTrades', label: 'TRADES', fmt: v => String(v), w: 55 },
  { key: 'winRate', label: 'WIN %', fmt: v => v.toFixed(1) + '%', w: 55 },
  { key: 'totalPnl', label: 'TOTAL P/L', fmt: v => fmt$(v), w: 85 },
  { key: 'avgPnl', label: 'AVG P/L', fmt: v => fmt$(v), w: 75 },
  { key: 'profitFactor', label: 'PF', fmt: v => v === Infinity ? '∞' : v.toFixed(2), w: 45 },
  { key: 'maxDrawdown', label: 'MAX DD', fmt: v => fmt$(v), w: 75 },
  { key: 'sharpe', label: 'SHARPE', fmt: v => v.toFixed(2), w: 60 },
  { key: 'maxConsecLoss', label: 'STREAK', fmt: v => String(v) + 'L', w: 50 },
  { key: 'avgHoldDays', label: 'AVG DAYS', fmt: v => v.toFixed(0) + 'd', w: 60 },
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
   SUB-COMPONENTS
   ═══════════════════════════════════════════════════════════════════════════ */

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      padding: '4px 10px', fontSize: 11, fontWeight: active ? 600 : 400,
      background: active ? C.cyanDim : 'transparent',
      border: `1px solid ${active ? C.cyan : 'var(--border)'}`,
      color: active ? C.cyan : 'var(--text-3)', cursor: 'pointer', borderRadius: 3,
      fontFamily: "'Inter', sans-serif", transition: 'all 0.15s', letterSpacing: active ? 0.5 : 0,
    }}>{label}</button>
  )
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 9, color: 'var(--text-4)', letterSpacing: 2, marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  )
}

function EquityCurve({ trades }: { trades: Trade[] }) {
  const points = useMemo(() => {
    const sorted = [...trades].sort((a, b) => a.exitDate.localeCompare(b.exitDate))
    let cum = 0
    return sorted.map(t => { cum += t.pnl; return { date: t.exitDate, cum, won: t.won } })
  }, [trades])

  if (points.length < 2) return <div style={{ color: 'var(--text-4)', fontSize: 12, padding: 20, textAlign: 'center' }}>Not enough trades</div>

  const maxY = Math.max(...points.map(p => p.cum), 0)
  const minY = Math.min(...points.map(p => p.cum), 0)
  const rangeY = maxY - minY || 1
  const W = 600, H = 200, PL = 55, PR = 55, PT = 12, PB = 25

  const scaleX = (i: number) => PL + (i / (points.length - 1)) * (W - PL - PR)
  const scaleY = (v: number) => PT + (1 - (v - minY) / rangeY) * (H - PT - PB)

  const linePath = points.map((p, i) =>
    `${i === 0 ? 'M' : 'L'}${scaleX(i).toFixed(1)},${scaleY(p.cum).toFixed(1)}`
  ).join(' ')
  const areaPath = linePath +
    ` L${scaleX(points.length - 1).toFixed(1)},${scaleY(0).toFixed(1)}` +
    ` L${scaleX(0).toFixed(1)},${scaleY(0).toFixed(1)} Z`
  const finalPnl = points[points.length - 1].cum
  const lineColor = finalPnl >= 0 ? C.green : C.red

  const gridCount = 5
  const gridLines = Array.from({ length: gridCount + 1 }, (_, i) => {
    const v = minY + (rangeY * i) / gridCount
    return { y: scaleY(v), label: fmt$(v) }
  })
  const dateLabels = [0, 0.25, 0.5, 0.75, 1].map(f => {
    const idx = Math.min(Math.round(f * (points.length - 1)), points.length - 1)
    return { x: scaleX(idx), label: points[idx].date.slice(2, 7) }
  })

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: '100%' }}>
      <defs>
        <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={lineColor} stopOpacity="0.18" />
          <stop offset="100%" stopColor={lineColor} stopOpacity="0" />
        </linearGradient>
      </defs>
      {gridLines.map((g, i) => (
        <g key={i}>
          <line x1={PL} y1={g.y} x2={W - PR} y2={g.y} stroke="var(--border)" strokeWidth="0.5" strokeDasharray={i === 0 || i === gridCount ? 'none' : '2 4'} />
          <text x={PL - 6} y={g.y + 3} fill="var(--text-4)" fontSize="8" textAnchor="end" fontFamily="IBM Plex Mono, monospace">{g.label}</text>
        </g>
      ))}
      <line x1={PL} y1={scaleY(0)} x2={W - PR} y2={scaleY(0)} stroke="var(--border-light)" strokeWidth="1" />
      <path d={areaPath} fill="url(#eqGrad)" />
      <path d={linePath} fill="none" stroke={lineColor} strokeWidth="1.5" strokeLinejoin="round" />
      {points.map((p, i) => !p.won && (
        <circle key={i} cx={scaleX(i)} cy={scaleY(p.cum)} r="2" fill={C.red} opacity="0.6" />
      ))}
      {dateLabels.map((d, i) => (
        <text key={i} x={d.x} y={H - 6} fill="var(--text-4)" fontSize="8" textAnchor="middle" fontFamily="IBM Plex Mono, monospace">{d.label}</text>
      ))}
      <text x={W - PR + 6} y={scaleY(finalPnl) + 4} fill={lineColor} fontSize="11" fontWeight="700" fontFamily="Chakra Petch, sans-serif">{fmt$(finalPnl)}</text>
    </svg>
  )
}

function DrawdownChart({ trades, startingCapital }: { trades: Trade[]; startingCapital: number }) {
  const data = useMemo(() => {
    const sorted = [...trades].sort((a, b) => a.exitDate.localeCompare(b.exitDate))
    let eq = startingCapital, peak = startingCapital
    return sorted.map(t => {
      eq += t.pnl; if (eq > peak) peak = eq
      return { date: t.exitDate, ddPct: peak > 0 ? ((peak - eq) / peak) * 100 : 0 }
    })
  }, [trades, startingCapital])

  if (data.length < 2) return <div style={{ color: 'var(--text-4)', fontSize: 12, padding: 20, textAlign: 'center' }}>Not enough data</div>

  const maxDD = Math.max(...data.map(d => d.ddPct), 0.5)
  const W = 500, H = 160, PL = 45, PR = 10, PT = 8, PB = 22
  const scaleX = (i: number) => PL + (i / (data.length - 1)) * (W - PL - PR)
  const scaleY = (dd: number) => PT + (dd / maxDD) * (H - PT - PB)

  const linePath = data.map((d, i) =>
    `${i === 0 ? 'M' : 'L'}${scaleX(i).toFixed(1)},${scaleY(d.ddPct).toFixed(1)}`
  ).join(' ')
  const areaPath = linePath +
    ` L${scaleX(data.length - 1).toFixed(1)},${scaleY(0).toFixed(1)}` +
    ` L${scaleX(0).toFixed(1)},${scaleY(0).toFixed(1)} Z`

  const gridCount = 4
  const gridLines = Array.from({ length: gridCount + 1 }, (_, i) => {
    const v = (maxDD * i) / gridCount
    return { y: scaleY(v), label: i === 0 ? '0%' : `-${v.toFixed(1)}%` }
  })
  const maxIdx = data.reduce((best, d, i) => d.ddPct > data[best].ddPct ? i : best, 0)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: '100%' }}>
      <defs>
        <linearGradient id="ddGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={C.red} stopOpacity="0.35" />
          <stop offset="100%" stopColor={C.red} stopOpacity="0.05" />
        </linearGradient>
      </defs>
      {gridLines.map((g, i) => (
        <g key={i}>
          <line x1={PL} y1={g.y} x2={W - PR} y2={g.y} stroke="var(--border)" strokeWidth="0.5" strokeDasharray="2 4" />
          <text x={PL - 4} y={g.y + 3} fill="var(--text-4)" fontSize="8" textAnchor="end" fontFamily="IBM Plex Mono, monospace">{g.label}</text>
        </g>
      ))}
      <path d={areaPath} fill="url(#ddGrad)" />
      <path d={linePath} fill="none" stroke={C.red} strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx={scaleX(maxIdx)} cy={scaleY(data[maxIdx].ddPct)} r="3" fill={C.red} />
      <text x={scaleX(maxIdx) + 6} y={scaleY(data[maxIdx].ddPct) + 3} fill={C.red} fontSize="9" fontWeight="700" fontFamily="IBM Plex Mono, monospace">
        -{data[maxIdx].ddPct.toFixed(1)}%
      </text>
      <text x={PL} y={H - 4} fill="var(--text-4)" fontSize="8" fontFamily="IBM Plex Mono, monospace">{data[0].date.slice(2, 7)}</text>
      <text x={W - PR} y={H - 4} fill="var(--text-4)" fontSize="8" textAnchor="end" fontFamily="IBM Plex Mono, monospace">{data[data.length - 1].date.slice(2, 7)}</text>
    </svg>
  )
}

function MonthlyHeatmap({ trades, startingCapital }: { trades: Trade[]; startingCapital: number }) {
  const { years, map } = useMemo(() => {
    const m: Record<string, number> = {}
    for (const t of trades) { const k = t.exitDate.slice(0, 7); m[k] = (m[k] || 0) + t.pnl }
    const keys = Object.keys(m).sort()
    if (keys.length === 0) return { years: [] as number[], map: m }
    const y0 = parseInt(keys[0].slice(0, 4)), y1 = parseInt(keys[keys.length - 1].slice(0, 4))
    return { years: Array.from({ length: y1 - y0 + 1 }, (_, i) => y0 + i), map: m }
  }, [trades])

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  if (years.length === 0) return <div style={{ color: 'var(--text-4)', padding: 20, textAlign: 'center' }}>No data</div>

  const hmTh: React.CSSProperties = { padding: '5px 3px', fontSize: 9, fontWeight: 700, letterSpacing: 1, color: 'var(--text-4)', textAlign: 'center', borderBottom: '1px solid var(--border)' }
  const hmTd: React.CSSProperties = { padding: '5px 3px', fontSize: 10, textAlign: 'center', borderBottom: '1px solid var(--border)', fontFamily: "'IBM Plex Mono', monospace" }

  return (
    <div style={{ overflow: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={hmTh}>YEAR</th>
            {MONTHS.map(m => <th key={m} style={hmTh}>{m.slice(0, 3).toUpperCase()}</th>)}
            <th style={hmTh}>TOTAL</th>
          </tr>
        </thead>
        <tbody>
          {years.map(y => {
            let yearTotal = 0
            return (
              <tr key={y}>
                <td style={{ ...hmTd, fontWeight: 600, color: 'var(--text-2)' }}>{y}</td>
                {Array.from({ length: 12 }, (_, m) => {
                  const key = `${y}-${String(m + 1).padStart(2, '0')}`
                  const pnl = map[key] || 0
                  yearTotal += pnl
                  const pct = startingCapital > 0 ? (pnl / startingCapital) * 100 : 0
                  const has = key in map
                  return (
                    <td key={m} style={{
                      ...hmTd, background: has ? heatColor(pct) : 'transparent',
                      color: has ? (pnl >= 0 ? C.green : C.red) : 'var(--text-5)',
                    }}>
                      {has ? fmtPct(pct) : '–'}
                    </td>
                  )
                })}
                <td style={{ ...hmTd, fontWeight: 700, color: yearTotal >= 0 ? C.green : C.red }}>
                  {fmt$(yearTotal)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════════════════════ */

export default function BacktestView({ }: { state: AppState }) {
  const [running, setRunning] = useState(false)
  const [activeView, setActiveView] = useState<'none' | 'single' | 'sweep'>('none')

  // Config state
  const [entryDay, setEntryDay] = useState<number | null>(null)
  const [entryWeek, setEntryWeek] = useState<number | null>(null)
  const [spreadWidth, setSpreadWidth] = useState(30)
  const [targetDte, setTargetDte] = useState(65)
  const [strikeOffset, setStrikeOffset] = useState(0)
  const [profitTarget, setProfitTarget] = useState<string>('')
  const [exitDte, setExitDte] = useState<string>('')
  const [sizing, setSizing] = useState('fixed-1')
  const [startingCapital, setStartingCapital] = useState(100000)

  // Results
  const [singleResult, setSingleResult] = useState<BacktestResult | null>(null)
  const [sweepResults, setSweepResults] = useState<ComboResult[] | null>(null)
  const [sweepIdx, setSweepIdx] = useState(0)
  const [sortKey, setSortKey] = useState<SortKey>('sharpe')
  const [sortAsc, setSortAsc] = useState(false)

  const handleRunSingle = useCallback(() => {
    setRunning(true)
    requestAnimationFrame(() => { setTimeout(() => {
      setSingleResult(runSingle({
        entryDay, entryWeek, spreadWidth, targetDte, strikeOffset,
        profitTarget: profitTarget ? parseFloat(profitTarget) : null,
        exitDte: exitDte ? parseInt(exitDte) : null,
        sizing, startingCapital,
      }))
      setActiveView('single'); setRunning(false)
    }, 20) })
  }, [entryDay, entryWeek, spreadWidth, targetDte, strikeOffset, profitTarget, exitDte, sizing, startingCapital])

  const handleRunSweep = useCallback(() => {
    setRunning(true)
    requestAnimationFrame(() => { setTimeout(() => {
      setSweepResults(runSweep(spreadWidth, targetDte, strikeOffset))
      setSweepIdx(0); setActiveView('sweep'); setRunning(false)
    }, 20) })
  }, [spreadWidth, targetDte, strikeOffset])

  const handleReset = () => { setSingleResult(null); setSweepResults(null); setActiveView('none') }

  const sortedSweep = useMemo(() => {
    if (!sweepResults) return []
    return [...sweepResults].sort((a, b) => {
      const av = a[sortKey] as number, bv = b[sortKey] as number
      return sortAsc ? av - bv : bv - av
    })
  }, [sweepResults, sortKey, sortAsc])

  const selectedSweep = sortedSweep[sweepIdx] ?? null
  const toggleSort = (key: SortKey) => { if (sortKey === key) setSortAsc(p => !p); else { setSortKey(key); setSortAsc(false) } }

  return (
    <div style={{ padding: 14, height: '100%', display: 'flex', flexDirection: 'column', gap: 8, overflow: 'hidden' }}>

      {/* ── CONFIG PANEL ──────────────────────────────────────────────── */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6, padding: '14px 18px', flexShrink: 0 }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 10, color: 'var(--text-4)', letterSpacing: 2, marginBottom: 2 }}>STRATEGY</div>
            <div style={{ fontFamily: "'Chakra Petch', sans-serif", fontSize: 18, fontWeight: 700, color: 'var(--text-1)', letterSpacing: 1 }}>
              SPX BULL PUT SPREAD
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 10, color: 'var(--text-4)', letterSpacing: 2, marginBottom: 2 }}>DATA RANGE</div>
            <div style={{ fontSize: 12, color: 'var(--text-3)', fontFamily: "'IBM Plex Mono', monospace" }}>
              {SPX_DAILY[0][0]} → {SPX_DAILY[SPX_DAILY.length - 1][0]} · {SPX_DAILY.length} bars
            </div>
          </div>
        </div>

        {/* Entry chips */}
        <div style={{ display: 'flex', gap: 24, marginBottom: 12, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 9, color: 'var(--text-4)', letterSpacing: 2, marginBottom: 5 }}>ENTRY DAY</div>
            <div style={{ display: 'flex', gap: 4 }}>
              <Chip label="Any" active={entryDay === null} onClick={() => setEntryDay(null)} />
              {([1, 2, 3, 4, 5] as const).map(d => (
                <Chip key={d} label={DAY_LABELS[d]} active={entryDay === d} onClick={() => setEntryDay(d)} />
              ))}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 9, color: 'var(--text-4)', letterSpacing: 2, marginBottom: 5 }}>ENTRY WEEK</div>
            <div style={{ display: 'flex', gap: 4 }}>
              <Chip label="Any" active={entryWeek === null} onClick={() => setEntryWeek(null)} />
              {([1, 2, 3, 4] as const).map(w => (
                <Chip key={w} label={WEEK_LABELS[w]} active={entryWeek === w} onClick={() => setEntryWeek(w)} />
              ))}
            </div>
          </div>
        </div>

        {/* Params grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(115px, 1fr))', gap: 10, alignItems: 'end' }}>
          <FormField label="SPREAD WIDTH">
            <select value={spreadWidth} onChange={e => setSpreadWidth(+e.target.value)} style={selectS}>
              {[5, 10, 15, 20, 25, 30, 40, 50].map(w => <option key={w} value={w}>{w} pt</option>)}
            </select>
          </FormField>
          <FormField label="TARGET DTE">
            <select value={targetDte} onChange={e => setTargetDte(+e.target.value)} style={selectS}>
              {[30, 45, 60, 65, 75, 90, 120].map(d => <option key={d} value={d}>{d} days</option>)}
            </select>
          </FormField>
          <FormField label="STRIKE">
            <select value={strikeOffset} onChange={e => setStrikeOffset(+e.target.value)} style={selectS}>
              <option value={0}>ATM</option>
              {[5, 10, 15, 20].map(o => <option key={o} value={o}>{o}pt OTM</option>)}
            </select>
          </FormField>
          <FormField label="PROFIT TARGET">
            <select value={profitTarget} onChange={e => setProfitTarget(e.target.value)} style={selectS}>
              <option value="">None</option>
              {[25, 50, 75, 90].map(p => <option key={p} value={p / 100}>{p}%</option>)}
            </select>
          </FormField>
          <FormField label="EXIT DTE">
            <select value={exitDte} onChange={e => setExitDte(e.target.value)} style={selectS}>
              <option value="">Hold to Expiry</option>
              {[7, 14, 21, 30, 45].map(d => <option key={d} value={d}>{d} DTE</option>)}
            </select>
          </FormField>
          <FormField label="POSITION SIZE">
            <select value={sizing} onChange={e => setSizing(e.target.value)} style={selectS}>
              {[1, 2, 3, 5, 10].map(n => <option key={n} value={`fixed-${n}`}>{n} ct</option>)}
              {[1, 2, 5].map(p => <option key={p} value={`scale-${p / 100}`}>{p}% risk</option>)}
            </select>
          </FormField>
          <FormField label="STARTING CAPITAL">
            <select value={startingCapital} onChange={e => setStartingCapital(+e.target.value)} style={selectS}>
              {[10000, 25000, 50000, 100000, 250000, 500000].map(c => (
                <option key={c} value={c}>${(c / 1000).toFixed(0)}K</option>
              ))}
            </select>
          </FormField>
          <div style={{ display: 'flex', gap: 4, alignItems: 'end' }}>
            <button onClick={handleRunSingle} disabled={running} style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              padding: '8px 12px', background: running ? 'var(--bg-elevated)' : C.cyan,
              border: `1px solid ${running ? 'var(--border-light)' : C.cyan}`, borderRadius: 3,
              color: running ? 'var(--text-3)' : '#0a0e14', fontSize: 10, fontWeight: 700,
              letterSpacing: 1, cursor: running ? 'wait' : 'pointer',
              fontFamily: "'Inter', sans-serif", transition: 'all 0.15s',
            }}>
              <Play size={10} style={{ animation: running ? 'spin 1s linear infinite' : 'none' }} />
              RUN
            </button>
            <button onClick={handleRunSweep} disabled={running} title="Sweep all day/week/exit combos" style={{
              padding: '8px 10px', background: 'transparent',
              border: '1px solid var(--border)', borderRadius: 3,
              color: running ? 'var(--text-5)' : C.gold, fontSize: 10, fontWeight: 700,
              letterSpacing: 0.5, cursor: running ? 'wait' : 'pointer',
              fontFamily: "'Inter', sans-serif", transition: 'all 0.15s',
            }}>SWEEP</button>
            {activeView !== 'none' && (
              <button onClick={handleReset} style={{
                padding: '8px 8px', background: 'transparent', border: '1px solid var(--border)',
                borderRadius: 3, color: 'var(--text-4)', cursor: 'pointer', display: 'flex', alignItems: 'center',
              }}><RotateCcw size={11} /></button>
            )}
          </div>
        </div>
      </div>

      {/* ── SINGLE RESULTS ──────────────────────────────────────────── */}
      {activeView === 'single' && singleResult && singleResult.numTrades > 0 && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6, overflow: 'auto', minHeight: 0 }}>
          {/* Stat cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 6, flexShrink: 0 }}>
            {[
              { label: 'TRADES', value: String(singleResult.numTrades), sub: `${singleResult.wins}W ${singleResult.losses}L`, color: C.cyan },
              { label: 'WIN RATE', value: singleResult.winRate.toFixed(1) + '%', color: singleResult.winRate >= 70 ? C.green : C.gold },
              { label: 'TOTAL P/L', value: fmt$(singleResult.totalPnl), sub: fmtPct(singleResult.returnPct), color: singleResult.totalPnl >= 0 ? C.green : C.red },
              { label: 'CAGR', value: fmtPct(singleResult.cagr), color: singleResult.cagr >= 10 ? C.green : singleResult.cagr >= 0 ? C.gold : C.red },
              { label: 'PROFIT FACTOR', value: singleResult.profitFactor === Infinity ? '∞' : singleResult.profitFactor.toFixed(2), color: singleResult.profitFactor >= 1.5 ? C.green : C.gold },
              { label: 'MAX DRAWDOWN', value: fmt$(singleResult.maxDrawdown), sub: `-${singleResult.maxDrawdownPct.toFixed(1)}%`, color: C.red },
              { label: 'SHARPE', value: singleResult.sharpe.toFixed(2), sub: `Calmar ${singleResult.calmar.toFixed(2)}`, color: singleResult.sharpe >= 1.0 ? C.green : C.gold },
              { label: 'AVG HOLD', value: singleResult.avgHoldDays.toFixed(0) + 'd', sub: `W${fmt$(singleResult.avgWin)} L${fmt$(singleResult.avgLoss)}`, color: C.blue },
            ].map(s => (
              <div key={s.label} style={{
                background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 4,
                padding: '10px 8px', textAlign: 'center', transition: 'border-color 0.2s, box-shadow 0.2s',
              }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--border-light)'; e.currentTarget.style.boxShadow = `0 0 16px ${C.cyanGlow}` }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.boxShadow = 'none' }}
              >
                <div style={{ fontSize: 9, color: 'var(--text-4)', letterSpacing: 1.5, marginBottom: 3 }}>{s.label}</div>
                <div style={{ fontFamily: "'Chakra Petch', sans-serif", fontSize: 18, fontWeight: 700, color: s.color, lineHeight: 1 }}>{s.value}</div>
                {s.sub && <div style={{ fontSize: 9, color: 'var(--text-4)', marginTop: 2 }}>{s.sub}</div>}
              </div>
            ))}
          </div>

          {/* Equity curve - full width */}
          <div style={{ ...tile, minHeight: 220, flexShrink: 0 }}>
            <div style={tileHdr}>EQUITY CURVE · {singleResult.numTrades} TRADES</div>
            <div style={{ flex: 1, padding: '8px 10px', overflow: 'hidden' }}>
              <EquityCurve trades={singleResult.trades} />
            </div>
          </div>

          {/* Drawdown + Monthly */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, flexShrink: 0 }}>
            <div style={{ ...tile, minHeight: 180 }}>
              <div style={tileHdr}>DRAWDOWN</div>
              <div style={{ flex: 1, padding: '6px 8px', overflow: 'hidden' }}>
                <DrawdownChart trades={singleResult.trades} startingCapital={startingCapital} />
              </div>
            </div>
            <div style={{ ...tile, minHeight: 180 }}>
              <div style={tileHdr}>MONTHLY RETURNS · % OF CAPITAL</div>
              <div style={{ flex: 1, padding: '6px 8px', overflow: 'auto' }}>
                <MonthlyHeatmap trades={singleResult.trades} startingCapital={startingCapital} />
              </div>
            </div>
          </div>

          {/* Trade log */}
          <div style={{ ...tile, flex: 1, minHeight: 200 }}>
            <div style={tileHdr}>
              TRADE LOG
              <span style={{ float: 'right', fontWeight: 400, color: 'var(--text-5)', fontSize: 10, letterSpacing: 0 }}>
                avg win {fmt$(singleResult.avgWin)} · avg loss {fmt$(singleResult.avgLoss)} · streak {singleResult.maxConsecLoss}L / {singleResult.maxConsecWin}W
              </span>
            </div>
            <div style={{ flex: 1, overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {['ENTRY', 'EXIT', 'SPX', 'STRIKES', 'CT', 'CREDIT', 'DEBIT', 'P/L', 'DAYS', 'EXIT'].map(h => (
                      <th key={h} style={thS}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {singleResult.trades.map((t, i) => (
                    <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : 'var(--bg-surface)' }}>
                      <td style={{ ...tdS, fontSize: 10, color: 'var(--text-3)' }}>{t.entryDate.slice(5)}</td>
                      <td style={{ ...tdS, fontSize: 10, color: 'var(--text-3)' }}>{t.exitDate.slice(5)}</td>
                      <td style={{ ...tdS, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11 }}>
                        {t.entrySpx.toFixed(0)}<span style={{ color: 'var(--text-4)' }}>→</span>{t.exitSpx.toFixed(0)}
                      </td>
                      <td style={{ ...tdS, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--text-3)' }}>{t.shortK}/{t.longK}</td>
                      <td style={{ ...tdS, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: C.cyan }}>{t.contracts}</td>
                      <td style={{ ...tdS, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: C.green }}>{t.netCredit.toFixed(2)}</td>
                      <td style={{ ...tdS, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: C.gold }}>{t.exitCost.toFixed(2)}</td>
                      <td style={{ ...tdS, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, fontWeight: 700, color: t.pnl >= 0 ? C.green : C.red }}>{fmt$(t.pnl)}</td>
                      <td style={{ ...tdS, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--text-4)' }}>{t.holdDays}</td>
                      <td style={{ ...tdS, fontSize: 10, color: t.exitReason.includes('Profit') ? C.green : t.exitReason === 'Expiry' ? C.blue : C.gold }}>{t.exitReason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Single: no trades */}
      {activeView === 'single' && singleResult && singleResult.numTrades === 0 && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ textAlign: 'center', color: 'var(--text-3)', fontSize: 14 }}>
            <div style={{ fontFamily: "'Chakra Petch', sans-serif", fontSize: 20, fontWeight: 700, color: 'var(--text-1)', marginBottom: 8 }}>NO TRADES FOUND</div>
            <div>Try relaxing your filters (entry day, week, or DTE range).</div>
          </div>
        </div>
      )}

      {/* ── SWEEP RESULTS ───────────────────────────────────────────── */}
      {activeView === 'sweep' && sweepResults && sweepResults.length > 0 && selectedSweep && (
        <>
          {/* Stat cards for selected combo */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 6, flexShrink: 0 }}>
            {[
              { label: 'COMBO', value: `${selectedSweep.dayLabel} · ${selectedSweep.weekLabel}`, sub: selectedSweep.exitLabel, color: C.cyan },
              { label: 'WIN RATE', value: selectedSweep.winRate.toFixed(1) + '%', color: selectedSweep.winRate >= 70 ? C.green : C.gold },
              { label: 'TOTAL P/L', value: fmt$(selectedSweep.totalPnl), color: selectedSweep.totalPnl >= 0 ? C.green : C.red },
              { label: 'AVG P/L', value: fmt$(selectedSweep.avgPnl), color: selectedSweep.avgPnl >= 0 ? C.green : C.red },
              { label: 'PROFIT FACTOR', value: selectedSweep.profitFactor === Infinity ? '∞' : selectedSweep.profitFactor.toFixed(2), color: selectedSweep.profitFactor >= 1.5 ? C.green : C.gold },
              { label: 'MAX DD', value: fmt$(selectedSweep.maxDrawdown), color: C.red },
              { label: 'SHARPE', value: selectedSweep.sharpe.toFixed(2), color: selectedSweep.sharpe >= 1.0 ? C.green : C.gold },
              { label: 'AVG HOLD', value: selectedSweep.avgHoldDays.toFixed(0) + 'd', color: C.blue },
            ].map(s => (
              <div key={s.label} style={{
                background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 4,
                padding: '10px 8px', textAlign: 'center', transition: 'border-color 0.2s, box-shadow 0.2s',
              }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--border-light)'; e.currentTarget.style.boxShadow = `0 0 16px ${C.cyanGlow}` }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.boxShadow = 'none' }}
              >
                <div style={{ fontSize: 9, color: 'var(--text-4)', letterSpacing: 1.5, marginBottom: 3 }}>{s.label}</div>
                <div style={{ fontFamily: "'Chakra Petch', sans-serif", fontSize: 18, fontWeight: 700, color: s.color, lineHeight: 1 }}>{s.value}</div>
                {s.sub && <div style={{ fontSize: 9, color: 'var(--text-4)', marginTop: 2 }}>{s.sub}</div>}
              </div>
            ))}
          </div>

          {/* Sweep grid: ranking + charts */}
          <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr', gap: 6, minHeight: 0 }}>
            {/* Ranking table */}
            <div style={{ ...tile, gridRow: '1 / 3' }}>
              <div style={tileHdr}>
                RANKING · {sortedSweep.length} COMBINATIONS
                <span style={{ float: 'right', fontWeight: 400, color: 'var(--text-5)', fontSize: 10, letterSpacing: 0 }}>per contract · click row to inspect</span>
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
                        }}>{c.label} {sortKey === c.key ? (sortAsc ? '▲' : '▼') : ''}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedSweep.map((r, i) => {
                      const isSel = i === sweepIdx
                      return (
                        <tr key={i} onClick={() => setSweepIdx(i)}
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

            {/* Equity curve for selected combo */}
            <div style={tile}>
              <div style={tileHdr}>EQUITY CURVE · {selectedSweep.numTrades} TRADES</div>
              <div style={{ flex: 1, padding: '8px 10px', overflow: 'hidden' }}>
                <EquityCurve trades={selectedSweep.trades} />
              </div>
            </div>

            {/* Trade log for selected combo */}
            <div style={tile}>
              <div style={tileHdr}>
                TRADE LOG
                <span style={{ float: 'right', fontWeight: 400, color: 'var(--text-5)', fontSize: 10, letterSpacing: 0 }}>
                  avg win {fmt$(selectedSweep.avgWin)} · avg loss {fmt$(selectedSweep.avgLoss)}
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
                    {selectedSweep.trades.map((t, i) => (
                      <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : 'var(--bg-surface)' }}>
                        <td style={{ ...tdS, fontSize: 10, color: 'var(--text-3)' }}>{t.entryDate.slice(5)}</td>
                        <td style={{ ...tdS, fontSize: 10, color: 'var(--text-3)' }}>{t.exitDate.slice(5)}</td>
                        <td style={{ ...tdS, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11 }}>
                          {t.entrySpx.toFixed(0)}<span style={{ color: 'var(--text-4)' }}>→</span>{t.exitSpx.toFixed(0)}
                        </td>
                        <td style={{ ...tdS, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--text-3)' }}>{t.shortK}/{t.longK}</td>
                        <td style={{ ...tdS, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: C.green }}>{t.netCredit.toFixed(2)}</td>
                        <td style={{ ...tdS, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: C.gold }}>{t.exitCost.toFixed(2)}</td>
                        <td style={{ ...tdS, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, fontWeight: 700, color: t.pnl >= 0 ? C.green : C.red }}>{fmt$(t.pnl)}</td>
                        <td style={{ ...tdS, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--text-4)' }}>{t.holdDays}</td>
                        <td style={{ ...tdS, fontSize: 10, color: t.exitReason.includes('Profit') ? C.green : t.exitReason === 'Expiry' ? C.blue : C.gold }}>{t.exitReason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── EMPTY STATE ──────────────────────────────────────────────── */}
      {activeView === 'none' && !running && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ textAlign: 'center', maxWidth: 520 }}>
            <div style={{ fontFamily: "'Chakra Petch', sans-serif", fontSize: 22, fontWeight: 700, color: 'var(--text-1)', letterSpacing: 1, marginBottom: 8 }}>
              SPX BULL PUT SPREAD BACKTEST
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.8, color: 'var(--text-3)' }}>
              Configure your strategy above and click <span style={{ color: C.cyan, fontWeight: 600 }}>RUN</span> for a single backtest with full stats,
              or <span style={{ color: C.gold, fontWeight: 600 }}>SWEEP</span> to test all{' '}
              <span style={{ color: C.cyan, fontWeight: 600 }}>entry day</span> ×{' '}
              <span style={{ color: C.cyan, fontWeight: 600 }}>entry week</span> ×{' '}
              <span style={{ color: C.cyan, fontWeight: 600 }}>exit rule</span> combinations.
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-4)', marginTop: 10, letterSpacing: 1, lineHeight: 1.8 }}>
              {SPX_DAILY.length} BARS · BSM PRICING · VIX AS IV PROXY · $0.05 TICK ROUNDING<br />
              COSTS: ${COMMISSION.toFixed(2)}/LEG + ${SLIPPAGE.toFixed(2)} SLIPPAGE/LEG
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 24 }}>
              <button onClick={handleRunSingle} style={{
                padding: '10px 24px', background: C.cyan, border: `1px solid ${C.cyan}`,
                borderRadius: 3, color: '#0a0e14', fontSize: 12, fontWeight: 700, letterSpacing: 1.5,
                cursor: 'pointer', fontFamily: "'Inter', sans-serif",
                display: 'inline-flex', alignItems: 'center', gap: 8,
                boxShadow: `0 0 20px ${C.cyanGlow}`, transition: 'all 0.15s',
              }}
                onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 0 30px rgba(0,229,255,0.2)' }}
                onMouseLeave={e => { e.currentTarget.style.boxShadow = `0 0 20px ${C.cyanGlow}` }}
              >
                <Play size={12} /> RUN BACKTEST
              </button>
              <button onClick={handleRunSweep} style={{
                padding: '10px 24px', background: 'transparent', border: `1px solid ${C.gold}`,
                borderRadius: 3, color: C.gold, fontSize: 12, fontWeight: 700, letterSpacing: 1.5,
                cursor: 'pointer', fontFamily: "'Inter', sans-serif",
                display: 'inline-flex', alignItems: 'center', gap: 8,
                transition: 'all 0.15s',
              }}
                onMouseEnter={e => { e.currentTarget.style.background = C.goldDim }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
              >
                <Play size={12} /> FULL SWEEP
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Loading */}
      {running && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ textAlign: 'center', color: 'var(--text-3)' }}>
            <div style={{ fontFamily: "'Chakra Petch', sans-serif", fontSize: 18, fontWeight: 700, color: C.cyan, animation: 'pulse 1s ease-in-out infinite' }}>
              COMPUTING…
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
