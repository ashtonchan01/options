import { useState, useMemo } from 'react'
import { Scan, AlertCircle, Activity, ChevronDown, ChevronUp } from 'lucide-react'
import type { AppState, ScanResult, ScanFlag } from '../../types'
import { scanAllTickersCboe } from '../../services/cboe'
import { WATCHLIST } from '../../data/watchlist'

interface Props { state: AppState }

// ─── PutHouse strategy modes ──────────────────────────────────────────────────

type PutHouseMode = 'selective' | 'bold' | 'custom' | 'all'

interface ModeConfig {
  deltaMin: number; deltaMax: number
  dteMin: number;   dteMax: number
  minBid: number
  targetMonthlyPct: [number, number]
}

const MODE_CFG: Record<'selective' | 'bold', ModeConfig> = {
  selective: { deltaMin: 0.05, deltaMax: 0.10, dteMin: 7,  dteMax: 10, minBid: 0.05, targetMonthlyPct: [1, 2] },
  bold:      { deltaMin: 0.15, deltaMax: 0.25, dteMin: 7,  dteMax: 14, minBid: 0.10, targetMonthlyPct: [2, 3] },
}

const MODE_META: Record<PutHouseMode, { label: string; sub: string; color: string }> = {
  selective: { label: 'SELECTIVE', sub: 'Δ 0.05–0.10 · 7–10d · Conservative', color: '#10b981' },
  bold:      { label: 'BOLD',      sub: 'Δ 0.15–0.25 · 7–14d · Higher yield',  color: '#f59e0b' },
  custom:    { label: 'CUSTOM',    sub: 'User-defined parameters',               color: '#a855f7' },
  all:       { label: 'ALL',       sub: 'Δ 0.05–0.55 · 7–60d · Unfiltered',    color: '#00E5FF' },
}

const MODE_KEY       = 'options:puthouse_mode'
const CUSTOM_CFG_KEY = 'options:custom_cfg'
const DEFAULT_CUSTOM: ModeConfig = { deltaMin: 0.10, deltaMax: 0.25, dteMin: 7, dteMax: 21, minBid: 0.05, targetMonthlyPct: [1, 3] }

function loadMode(): PutHouseMode { return (localStorage.getItem(MODE_KEY) as PutHouseMode) ?? 'all' }
function loadCustomCfg(): ModeConfig {
  try { return JSON.parse(localStorage.getItem(CUSTOM_CFG_KEY) || 'null') ?? DEFAULT_CUSTOM } catch { return DEFAULT_CUSTOM }
}

function filterByMode(results: ScanResult[], mode: PutHouseMode, custom: ModeConfig): ScanResult[] {
  if (mode === 'all') return results
  const cfg: ModeConfig = mode === 'custom' ? custom : MODE_CFG[mode as 'selective' | 'bold']
  return results.filter(r => {
    const d = Math.abs(r.delta)
    return d >= cfg.deltaMin && d <= cfg.deltaMax && r.dte >= cfg.dteMin && r.dte <= cfg.dteMax && r.bid >= cfg.minBid
  })
}

// ─── Flags ────────────────────────────────────────────────────────────────────

const FLAG_COLORS: Record<ScanFlag, string> = {
  HIGH_VOL: '#00E5FF', HIGH_V_OI: '#f59e0b', IV_SPIKE: '#a855f7', NEAR_TERM: '#10b981',
}
const FLAG_LABELS: Record<ScanFlag, string> = {
  HIGH_VOL: 'VOL', HIGH_V_OI: 'V/OI', IV_SPIKE: 'IV', NEAR_TERM: 'NEAR',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtExp(s: string): string {
  const m = s.match(/^(\d{4})(\d{2})(\d{2})$/)
  return m ? `${parseInt(m[2])}/${parseInt(m[3])}` : s
}
function scoreColor(s: number)  { return s >= 70 ? '#10b981' : s >= 40 ? '#f59e0b' : 'var(--text-4)' }
function deltaColor(d: number)  { const a = Math.abs(d); return a < 0.15 ? 'var(--text-3)' : a > 0.40 ? '#f59e0b' : '#10b981' }
function tradeYield(r: ScanResult) { return r.annualizedYield * r.dte / 365 }

// ─── Card width ───────────────────────────────────────────────────────────────

const CARD_W = 400
const CUSTOM_TICKERS_KEY = 'options:custom_tickers'
function loadCustomTickers(): string[] { try { return JSON.parse(localStorage.getItem(CUSTOM_TICKERS_KEY) || '[]') } catch { return [] } }
function saveCustomTickers(t: string[]) { localStorage.setItem(CUSTOM_TICKERS_KEY, JSON.stringify(t)) }

// ─── Ticker card data ─────────────────────────────────────────────────────────

interface TickerCard {
  symbol: string; price: number; bestScore: number; avgIv: number
  totalContracts: number; topCsp: ScanResult[]; topCc: ScanResult[]
}

function buildCards(results: ScanResult[], tickers: string[]): TickerCard[] {
  const map = new Map<string, { results: ScanResult[]; price: number }>()
  for (const sym of tickers) map.set(sym, { results: [], price: 0 })
  for (const r of results) {
    const e = map.get(r.underlying)
    if (e) { e.results.push(r); if (!e.price) e.price = r.stockPrice }
    else map.set(r.underlying, { results: [r], price: r.stockPrice })
  }
  const cards: TickerCard[] = []
  for (const [symbol, { results: rs, price }] of map) {
    if (!rs.length) continue
    cards.push({
      symbol, price,
      bestScore: Math.max(...rs.map(r => r.score)),
      avgIv: rs.reduce((s, r) => s + r.iv, 0) / rs.length,
      totalContracts: rs.length,
      topCsp: rs.filter(r => r.strategyType === 'csp').sort((a, b) => b.score - a.score).slice(0, 5),
      topCc:  rs.filter(r => r.strategyType === 'covered_call').sort((a, b) => b.score - a.score).slice(0, 5),
    })
  }
  return cards.sort((a, b) => b.bestScore - a.bestScore)
}

// ─── Table components ─────────────────────────────────────────────────────────

const GRID = '18px 1fr 44px 34px 44px 48px 40px 34px'

function OptionRow({ r, rank }: { r: ScanResult; rank: number }) {
  const ty = tradeYield(r)
  return (
    <div style={{ display: 'grid', gridTemplateColumns: GRID, gap: 4, alignItems: 'center', padding: '5px 0', borderBottom: '1px solid var(--border)', fontSize: 11, fontFamily: 'Share Tech Mono, monospace' }}
      title={`Annualized: ${r.annualizedYield.toFixed(0)}% · OI: ${r.openInterest} · V/OI: ${r.volumeOiRatio.toFixed(2)}`}>
      <span style={{ color: 'var(--text-5)', fontSize: 10, textAlign: 'center' }}>{rank}</span>
      <span style={{ color: 'var(--text-1)', fontWeight: 600 }}>${r.strike}</span>
      <span style={{ color: 'var(--text-3)', textAlign: 'right' }}>{fmtExp(r.expiry)}</span>
      <span style={{ color: 'var(--text-3)', textAlign: 'right' }}>{r.dte}d</span>
      <span style={{ color: deltaColor(r.delta), textAlign: 'right' }}>{r.delta.toFixed(2)}</span>
      <span style={{ color: '#10b981', textAlign: 'right' }}>${r.mid.toFixed(2)}</span>
      <span style={{ color: ty >= 1 ? '#10b981' : 'var(--text-3)', fontWeight: 600, textAlign: 'right' }}>{ty.toFixed(1)}%</span>
      <span style={{ color: scoreColor(r.score), fontWeight: 700, fontFamily: "'Rajdhani', sans-serif", textAlign: 'right' }}>{r.score}</span>
    </div>
  )
}

function MiniHeader() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: GRID, gap: 4, padding: '3px 0 5px', borderBottom: '1px solid var(--border-light)', fontSize: 8, fontWeight: 600, color: 'var(--text-4)', letterSpacing: '1px' }}>
      <span style={{ textAlign: 'center' }}>#</span><span>STRIKE</span>
      <span style={{ textAlign: 'right' }}>EXP</span><span style={{ textAlign: 'right' }}>DTE</span>
      <span style={{ textAlign: 'right' }}>DELTA</span><span style={{ textAlign: 'right' }}>CREDIT</span>
      <span style={{ textAlign: 'right' }}>YIELD</span><span style={{ textAlign: 'right' }}>SCR</span>
    </div>
  )
}

function StrategySection({ label, color, items }: { label: string; color: string; items: ScanResult[] }) {
  if (!items.length) return null
  const flags = Array.from(new Set(items.flatMap(r => r.flags)))
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <span style={{ padding: '1px 6px', fontSize: 9, fontWeight: 700, background: `${color}15`, border: `1px solid ${color}40`, color, fontFamily: "'Rajdhani', sans-serif", letterSpacing: '0.5px' }}>{label}</span>
        <span style={{ fontSize: 9, color: 'var(--text-4)', fontFamily: 'Share Tech Mono, monospace' }}>TOP {items.length}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 3 }}>
          {flags.map(f => <span key={f} style={{ padding: '0 4px', fontSize: 8, fontWeight: 700, background: `${FLAG_COLORS[f]}12`, color: FLAG_COLORS[f], fontFamily: "'Rajdhani', sans-serif" }}>{FLAG_LABELS[f]}</span>)}
        </div>
      </div>
      <MiniHeader />
      {items.map((r, i) => <OptionRow key={i} r={r} rank={i + 1} />)}
    </div>
  )
}

const inputStyle: React.CSSProperties = { width: 54, padding: '3px 6px', fontSize: 11, textAlign: 'right', background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-1)', fontFamily: 'Share Tech Mono, monospace', outline: 'none', borderRadius: 3 }
const labelStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: 'var(--text-3)', fontFamily: 'Share Tech Mono, monospace' }

// ─── Main component ───────────────────────────────────────────────────────────

export default function OpportunitiesView({ state }: Props) {
  const [results,       setResults]      = useState<ScanResult[]>([])
  const [scanning,      setScanning]     = useState(false)
  const [error,         setError]        = useState<string | null>(null)
  const [scanned,       setScanned]      = useState(false)
  const [scanProgress,  setScanProgress] = useState('')
  const [collapsed,     setCollapsed]    = useState<Set<string>>(new Set())
  const [customTickers, setCustomTickers]= useState<string[]>(loadCustomTickers)
  const [tickerInput,   setTickerInput]  = useState('')
  const [mode,          setModeState]    = useState<PutHouseMode>(loadMode)
  const [customCfg,     setCustomCfg]    = useState<ModeConfig>(loadCustomCfg)

  function saveMode(m: PutHouseMode) { setModeState(m); localStorage.setItem(MODE_KEY, m) }
  function updateCustom(patch: Partial<ModeConfig>) {
    setCustomCfg(prev => { const n = { ...prev, ...patch }; localStorage.setItem(CUSTOM_CFG_KEY, JSON.stringify(n)); return n })
  }

  const stocksHeld = useMemo(() => {
    const map: Record<string, number> = {}
    for (const p of state.sync.positions)
      if (p.assetClass === 'STK') map[p.symbol] = (map[p.symbol] ?? 0) + p.quantity
    return map
  }, [state.sync.positions])

  const tickers = useMemo(() => {
    const set = new Set<string>([...WATCHLIST, ...customTickers])
    const SKIP = new Set(['SPX','SPY','QQQ','IWM','DIA','VIX'])
    for (const p of state.sync.positions) {
      const sym = p.underlyingSymbol ?? (p.assetClass === 'STK' ? p.symbol : null)
      if (sym && !SKIP.has(sym)) set.add(sym)
    }
    return [...set].sort()
  }, [state.sync.positions, customTickers])

  const filtered = useMemo(() => filterByMode(results, mode, customCfg), [results, mode, customCfg])
  const cards    = useMemo(() => buildCards(filtered, tickers),           [filtered, tickers])

  function toggleCollapse(sym: string) {
    setCollapsed(prev => { const n = new Set(prev); n.has(sym) ? n.delete(sym) : n.add(sym); return n })
  }
  function addTicker() {
    const sym = tickerInput.trim().toUpperCase()
    if (!sym || customTickers.includes(sym) || (WATCHLIST as readonly string[]).includes(sym)) return
    const next = [...customTickers, sym]; setCustomTickers(next); saveCustomTickers(next); setTickerInput('')
  }
  function removeTicker(sym: string) {
    const next = customTickers.filter(t => t !== sym); setCustomTickers(next); saveCustomTickers(next)
  }

  async function handleScan() {
    setScanning(true); setError(null); setResults([]); setScanProgress('')
    try {
      setScanProgress('Fetching chains…')
      const all = await scanAllTickersCboe(tickers, stocksHeld, (sym, i, total) => setScanProgress(`${sym} (${i}/${total})`))
      if (!all.length && tickers.length) setError('No results — try again in 30s.')
      setResults(all); setScanned(true)
    } catch (e) { setError(String(e)) }
    finally { setScanning(false); setScanProgress('') }
  }

  const meta       = MODE_META[mode]
  const activeCfg  = mode === 'selective' || mode === 'bold' ? MODE_CFG[mode] : mode === 'custom' ? customCfg : null

  return (
    <div style={{ padding: 16, height: '100%', display: 'flex', flexDirection: 'column', gap: 10, overflow: 'hidden' }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', flexShrink: 0 }}>
        <Activity size={16} style={{ color: 'var(--accent)', flexShrink: 0 }} />
        <span className="chakra" style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-1)', letterSpacing: '1px' }}>SCANNER</span>

        <button onClick={handleScan} disabled={scanning} style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 14px', fontSize: 12, fontWeight: 600,
          background: scanning ? 'var(--bg-elevated)' : 'var(--accent-dim)',
          border: `1px solid ${scanning ? 'var(--border)' : 'rgba(0,229,255,0.25)'}`,
          color: scanning ? 'var(--text-3)' : 'var(--accent)', cursor: scanning ? 'not-allowed' : 'pointer',
          fontFamily: "'Rajdhani', sans-serif", letterSpacing: '1px', textTransform: 'uppercase',
        }}>
          <Scan size={12} style={{ animation: scanning ? 'spin 1.5s linear infinite' : 'none' }} />
          {scanning ? 'Scanning…' : 'Scan'}
        </button>

        <input type="text" value={tickerInput}
          onChange={e => setTickerInput(e.target.value.toUpperCase())}
          onKeyDown={e => e.key === 'Enter' && addTicker()}
          placeholder="+ TICKER"
          style={{ width: 80, padding: '5px 8px', fontSize: 11, background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-1)', fontFamily: 'Share Tech Mono, monospace', outline: 'none', borderRadius: 3 }}
        />

        {scanning && <span style={{ fontSize: 11, color: 'var(--accent)', fontFamily: 'Share Tech Mono, monospace', animation: 'pulse 2s infinite' }}>{scanProgress || 'Initializing…'}</span>}

        {scanned && (
          <span style={{ fontSize: 11, color: 'var(--text-4)', marginLeft: 'auto', fontFamily: 'Share Tech Mono, monospace' }}>
            {filtered.length} results · {cards.length} tickers{mode !== 'all' ? ` · ${meta.label}` : ''}
          </span>
        )}
      </div>

      {/* ── PutHouse mode picker ────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 6, flexShrink: 0, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 9, color: 'var(--text-5)', letterSpacing: 2, fontFamily: "'Rajdhani', sans-serif", marginRight: 2 }}>PUTHOUSE</span>
        {(Object.keys(MODE_META) as PutHouseMode[]).map(id => {
          const m = MODE_META[id]; const active = mode === id
          return (
            <button key={id} onClick={() => saveMode(id)} style={{
              padding: '5px 12px', borderRadius: 4, cursor: 'pointer', textAlign: 'left',
              border: `1px solid ${active ? m.color : 'var(--border)'}`,
              background: active ? `${m.color}18` : 'var(--bg-elevated)',
              fontFamily: "'Rajdhani', sans-serif", textTransform: 'uppercase',
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.5px', color: active ? m.color : 'var(--text-3)' }}>{m.label}</div>
              <div style={{ fontSize: 9, marginTop: 1, color: active ? m.color + 'aa' : 'var(--text-5)' }}>{m.sub}</div>
            </button>
          )
        })}
        {activeCfg && mode !== 'custom' && (
          <span style={{ marginLeft: 6, fontSize: 11, color: meta.color, fontFamily: 'Share Tech Mono, monospace', fontWeight: 600 }}>
            {activeCfg.targetMonthlyPct[0]}–{activeCfg.targetMonthlyPct[1]}%/mo target
          </span>
        )}
      </div>

      {/* ── Custom controls ─────────────────────────────────────────────────── */}
      {mode === 'custom' && (
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', padding: '8px 14px', background: 'var(--bg-elevated)', border: '1px solid #a855f740', borderRadius: 6, flexShrink: 0, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: '#a855f7', letterSpacing: 2, fontFamily: "'Rajdhani', sans-serif" }}>PARAMS</span>
          <label style={labelStyle}>Δ min <input type="number" value={customCfg.deltaMin} step={0.01} min={0.01} max={0.49} onChange={e => updateCustom({ deltaMin: +e.target.value })} style={inputStyle} /></label>
          <label style={labelStyle}>Δ max <input type="number" value={customCfg.deltaMax} step={0.01} min={0.02} max={0.55} onChange={e => updateCustom({ deltaMax: +e.target.value })} style={inputStyle} /></label>
          <label style={labelStyle}>DTE min <input type="number" value={customCfg.dteMin} step={1} min={1} max={59} onChange={e => updateCustom({ dteMin: +e.target.value })} style={inputStyle} /></label>
          <label style={labelStyle}>DTE max <input type="number" value={customCfg.dteMax} step={1} min={2} max={90} onChange={e => updateCustom({ dteMax: +e.target.value })} style={inputStyle} /></label>
          <label style={labelStyle}>Min bid <input type="number" value={customCfg.minBid} step={0.01} min={0.01} max={5} onChange={e => updateCustom({ minBid: +e.target.value })} style={inputStyle} /></label>
        </div>
      )}

      {/* ── Custom tickers ──────────────────────────────────────────────────── */}
      {customTickers.length > 0 && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', flexShrink: 0, alignItems: 'center' }}>
          <span style={{ fontSize: 9, color: 'var(--text-5)', letterSpacing: 1.5, fontFamily: "'Rajdhani', sans-serif" }}>CUSTOM:</span>
          {customTickers.map(sym => (
            <button key={sym} onClick={() => removeTicker(sym)} title="Remove" style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 8px', fontSize: 10, fontWeight: 600, background: 'var(--accent-dim)', border: '1px solid rgba(0,229,255,0.2)', color: 'var(--accent)', cursor: 'pointer', borderRadius: 3, fontFamily: 'Share Tech Mono, monospace' }}>
              {sym} <span style={{ color: 'var(--text-4)', fontSize: 8 }}>&times;</span>
            </button>
          ))}
        </div>
      )}

      {/* ── Error ───────────────────────────────────────────────────────────── */}
      {error && <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#f43f5e', fontSize: 12, flexShrink: 0 }}><AlertCircle size={13} />{error}</div>}

      {/* ── Empty states ────────────────────────────────────────────────────── */}
      {scanning && !scanned && (
        <div style={{ textAlign: 'center', paddingTop: 60 }}>
          <div className="chakra" style={{ fontSize: 15, color: 'var(--text-2)', letterSpacing: '1px' }}>SCANNING {tickers.length} TICKERS</div>
          <div style={{ fontSize: 11, color: 'var(--text-4)', marginTop: 6, fontFamily: 'Share Tech Mono, monospace' }}>Parallel fetch · CBOE delayed quotes</div>
          <div style={{ width: 160, height: 3, background: 'var(--border)', borderRadius: 2, margin: '14px auto', overflow: 'hidden' }}>
            <div style={{ height: '100%', background: 'var(--accent)', animation: 'pulse 1.5s ease-in-out infinite', width: '60%', borderRadius: 2 }} />
          </div>
        </div>
      )}

      {!scanning && !scanned && !error && (
        <div style={{ textAlign: 'center', paddingTop: 60 }}>
          <Activity size={28} style={{ color: 'var(--text-5)', marginBottom: 10 }} />
          <div className="chakra" style={{ fontSize: 15, color: 'var(--text-2)', letterSpacing: '1px' }}>OPTIONS SCANNER</div>
          <div style={{ fontSize: 11, color: 'var(--text-4)', marginTop: 6, fontFamily: 'Share Tech Mono, monospace', lineHeight: 1.8 }}>
            {tickers.length} tickers · CSP &amp; CC · Mode: {meta.label}
          </div>
          <div style={{ fontSize: 11, color: meta.color, marginTop: 2, fontFamily: 'Share Tech Mono, monospace' }}>{meta.sub}</div>
          <button onClick={handleScan} style={{ marginTop: 16, padding: '8px 24px', fontSize: 13, fontWeight: 600, background: 'var(--accent-dim)', border: '1px solid rgba(0,229,255,0.25)', color: 'var(--accent)', cursor: 'pointer', fontFamily: "'Rajdhani', sans-serif", letterSpacing: '1.5px', textTransform: 'uppercase' }}>
            START SCAN
          </button>
        </div>
      )}

      {scanned && !scanning && cards.length === 0 && (
        <div style={{ textAlign: 'center', paddingTop: 40 }}>
          <div className="chakra" style={{ fontSize: 13, color: 'var(--text-3)', letterSpacing: '1px' }}>NO RESULTS FOR {meta.label}</div>
          <div style={{ fontSize: 11, color: 'var(--text-5)', marginTop: 6, fontFamily: 'Share Tech Mono, monospace' }}>{meta.sub}</div>
          <button onClick={() => saveMode('all')} style={{ marginTop: 12, padding: '5px 14px', fontSize: 11, background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-3)', cursor: 'pointer', fontFamily: "'Rajdhani', sans-serif" }}>
            SWITCH TO ALL
          </button>
        </div>
      )}

      {/* ── Card grid ───────────────────────────────────────────────────────── */}
      {scanned && cards.length > 0 && (
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', flexWrap: 'wrap', gap: 10, alignContent: 'start', justifyContent: 'center' }}>
          {cards.map((card, idx) => {
            const isCollapsed = collapsed.has(card.symbol)
            const hasData = card.topCsp.length > 0 || card.topCc.length > 0
            const shares = stocksHeld[card.symbol] ?? 0
            return (
              <div key={card.symbol} style={{ width: CARD_W, minWidth: CARD_W, maxWidth: CARD_W, background: 'var(--bg-card)', border: `1px solid ${idx < 3 && hasData ? 'rgba(0,229,255,0.15)' : 'var(--border)'}`, borderRadius: 8, overflow: 'hidden', flexShrink: 0 }}>

                <div onClick={() => hasData && toggleCollapse(card.symbol)}
                  style={{ padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 8, cursor: hasData ? 'pointer' : 'default', background: 'var(--bg-surface)', borderBottom: isCollapsed || !hasData ? 'none' : '1px solid var(--border)', userSelect: 'none' }}>
                  {hasData && <span style={{ fontSize: 9, fontWeight: 700, color: idx < 3 ? 'var(--accent)' : 'var(--text-5)', fontFamily: "'Rajdhani', sans-serif", minWidth: 16 }}>#{idx + 1}</span>}
                  <span style={{ fontFamily: "'Rajdhani', sans-serif", fontSize: 15, fontWeight: 700, color: idx === 0 && hasData ? 'var(--accent)' : hasData ? 'var(--text-1)' : 'var(--text-4)', letterSpacing: '1px' }}>{card.symbol}</span>
                  {card.price > 0 && <span style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'Share Tech Mono, monospace' }}>${card.price.toFixed(2)}</span>}
                  {shares > 0 && <span style={{ padding: '1px 5px', fontSize: 9, fontWeight: 700, background: '#3b82f615', border: '1px solid #3b82f640', color: '#3b82f6', fontFamily: "'Rajdhani', sans-serif" }}>{shares} SHR</span>}
                  <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
                    {hasData ? (
                      <>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: 7, color: 'var(--text-4)', letterSpacing: '1px', fontWeight: 600 }}>SCORE</div>
                          <div style={{ fontFamily: "'Rajdhani', sans-serif", fontSize: 14, fontWeight: 700, color: scoreColor(card.bestScore) }}>{card.bestScore}</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: 7, color: 'var(--text-4)', letterSpacing: '1px', fontWeight: 600 }}>IV</div>
                          <div style={{ fontSize: 13, color: 'var(--text-2)', fontFamily: 'Share Tech Mono, monospace' }}>{card.avgIv.toFixed(0)}%</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: 7, color: 'var(--text-4)', letterSpacing: '1px', fontWeight: 600 }}>OPTS</div>
                          <div style={{ fontSize: 13, color: 'var(--text-3)', fontFamily: 'Share Tech Mono, monospace' }}>{card.totalContracts}</div>
                        </div>
                        {isCollapsed ? <ChevronDown size={14} style={{ color: 'var(--text-4)' }} /> : <ChevronUp size={14} style={{ color: 'var(--text-4)' }} />}
                      </>
                    ) : (
                      <span style={{ fontSize: 10, color: 'var(--text-5)', fontFamily: 'Share Tech Mono, monospace' }}>NO DATA</span>
                    )}
                  </div>
                </div>

                {hasData && !isCollapsed && (
                  <div style={{ padding: '8px 12px 10px' }}>
                    <StrategySection label="CSP" color="#f43f5e" items={card.topCsp} />
                    <StrategySection label="CC"  color="#3b82f6" items={card.topCc} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
