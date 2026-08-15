import { useState, useMemo, useEffect } from 'react'
import { Scan, AlertCircle, Activity, ChevronDown, ChevronUp } from 'lucide-react'
import type { AppState, ScanResult, ScanFlag } from '../../types'
import { scanAllTickersCboe } from '../../services/cboe'
import { fetchEarningsDates } from '../../services/earnings'
import { fetchFomcDates } from '../../services/fomc'

interface Props { state: AppState }

// ─── Scan filter params (user-adjusted, no preset modes) ─────────────────────

interface ModeConfig {
  deltaMin: number; deltaMax: number
  dteMin: number;   dteMax: number
  minBid: number
}

const CUSTOM_CFG_KEY = 'options:custom_cfg'
const DEFAULT_CUSTOM: ModeConfig = { deltaMin: 0.10, deltaMax: 0.25, dteMin: 7, dteMax: 21, minBid: 0.05 }

function loadCustomCfg(): ModeConfig {
  try { return JSON.parse(localStorage.getItem(CUSTOM_CFG_KEY) || 'null') ?? DEFAULT_CUSTOM } catch { return DEFAULT_CUSTOM }
}

function filterByMode(results: ScanResult[], cfg: ModeConfig): ScanResult[] {
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
/** 'YYYYMMDD' -> 'YYYY-MM-DD' so it's directly comparable to earnings dates. */
function normalizeExpiry(s: string): string {
  const m = s.match(/^(\d{4})(\d{2})(\d{2})$/)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : s
}
function todayYMD(): string {
  return new Date().toISOString().slice(0, 10)
}
/** Nearest upcoming earnings date for a ticker, or null if none known. */
function nextEarningsFor(sym: string, earningsMap: Record<string, string[]>): string | null {
  const dates = earningsMap[sym]
  if (!dates?.length) return null
  const today = todayYMD()
  const upcoming = dates.filter(d => d >= today).sort()
  return upcoming[0] ?? null
}
/** Monday–Sunday range (as 'YYYY-MM-DD') containing the given date. */
function weekRange(dateStr: string): { start: string; end: string } {
  const d = new Date(`${dateStr}T12:00:00`)
  const dow = d.getDay() || 7 // Mon=1 … Sun=7
  const monday = new Date(d); monday.setDate(d.getDate() - (dow - 1))
  const sunday = new Date(d); sunday.setDate(d.getDate() + (7 - dow))
  const toYMD = (x: Date) => x.toISOString().slice(0, 10)
  return { start: toYMD(monday), end: toYMD(sunday) }
}
/** True if this option's expiry falls in the same Mon–Sun week as the ticker's next earnings date. */
function expiryInEarningsWeek(expiry: string, nextEarnings: string | null): boolean {
  if (nextEarnings === null) return false
  const exp = normalizeExpiry(expiry)
  const { start, end } = weekRange(nextEarnings)
  return exp >= start && exp <= end
}
/** True if this option's expiry falls in the same Mon–Sun week as any upcoming FOMC
 * rate-decision date — those weeks see outsized index/vol moves regardless of ticker. */
function expiryInFomcWeek(expiry: string, fomcDates: string[]): boolean {
  const exp = normalizeExpiry(expiry)
  return fomcDates.some(d => {
    const { start, end } = weekRange(d)
    return exp >= start && exp <= end
  })
}
const MONTH_ABBR = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC']
function fmtEr(d: string): string {
  const [, m, day] = d.split('-')
  return `${MONTH_ABBR[parseInt(m) - 1]} ${parseInt(day)}`
}
function scoreColor(s: number)  { return s >= 70 ? '#10b981' : s >= 40 ? '#f59e0b' : 'var(--text-4)' }
function deltaColor(d: number)  { const a = Math.abs(d); return a < 0.15 ? 'var(--text-3)' : a > 0.40 ? '#f59e0b' : '#10b981' }
function tradeYield(r: ScanResult) { return r.annualizedYield * r.dte / 365 }
/** Breakeven price after the premium received: strike minus credit for a CSP
 * (effective cost basis if assigned), current price minus credit for a covered call. */
function breakeven(r: ScanResult) { return r.strategyType === 'csp' ? r.strike - r.mid : r.stockPrice - r.mid }

// ─── Card width ───────────────────────────────────────────────────────────────

const CARD_W = 'min(400px, 100%)'
// No default watchlist — blank slate. The scanner only ever looks at
// tickers the user has typed in themselves (persisted per browser).
const CUSTOM_TICKERS_KEY = 'options:custom_tickers'
function loadCustomTickers(): string[] { try { return JSON.parse(localStorage.getItem(CUSTOM_TICKERS_KEY) || '[]') } catch { return [] } }
function saveCustomTickers(t: string[]) { localStorage.setItem(CUSTOM_TICKERS_KEY, JSON.stringify(t)) }

// ─── Ticker card data ─────────────────────────────────────────────────────────

interface TickerCard {
  symbol: string; price: number; bestScore: number; avgIv: number
  totalContracts: number; topCsp: ScanResult[]; topCc: ScanResult[]
  nextEarnings: string | null
}

function buildCards(results: ScanResult[], tickers: string[], earningsMap: Record<string, string[]>): TickerCard[] {
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
      nextEarnings: nextEarningsFor(symbol, earningsMap),
    })
  }
  return cards.sort((a, b) => b.bestScore - a.bestScore)
}

// ─── Table components ─────────────────────────────────────────────────────────

// Column tracks sized to fit each header label at its own font/letter-spacing —
// previously several (DELTA, CREDIT, YIELD) were narrower than their own header
// text, so the header overflowed left past its column and never lined up with
// the right-aligned numbers below it.
const GRID = '16px minmax(48px,1fr) 46px 26px 36px 42px 42px 36px 26px'

function OptionRow({ r, rank, nextEarnings, fomcDates }: { r: ScanResult; rank: number; nextEarnings: string | null; fomcDates: string[] }) {
  const ty = tradeYield(r)
  const throughEarnings = expiryInEarningsWeek(r.expiry, nextEarnings)
  const throughFomc = !throughEarnings && expiryInFomcWeek(r.expiry, fomcDates)
  const flagColor = throughEarnings ? '#F0B429' : throughFomc ? '#8b5cf6' : undefined
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: GRID, gap: 3, alignItems: 'center', padding: '5px 4px', margin: '0 -4px',
      borderBottom: '1px solid var(--border)', fontSize: 11, fontFamily: 'Inter, sans-serif',
      background: flagColor ? `${flagColor}12` : 'transparent',
      borderLeft: flagColor ? `2px solid ${flagColor}` : '2px solid transparent',
    }}
      title={`Annualized: ${r.annualizedYield.toFixed(0)}% · OI: ${r.openInterest} · V/OI: ${r.volumeOiRatio.toFixed(2)}${throughEarnings ? ` · Expires the week of earnings (${fmtEr(nextEarnings!)})` : throughFomc ? ' · Expires an FOMC decision week' : ''}`}>
      <span style={{ color: 'var(--text-5)', fontSize: 10, textAlign: 'center' }}>{rank}</span>
      <span style={{ color: 'var(--text-1)', fontWeight: 600 }}>${r.strike}</span>
      <span style={{ color: flagColor ?? 'var(--text-3)', textAlign: 'right', fontWeight: flagColor ? 700 : 400, whiteSpace: 'nowrap' }}>
        {fmtExp(r.expiry)}{throughEarnings ? ' ⚡' : throughFomc ? ' 🏛' : ''}
      </span>
      <span style={{ color: 'var(--text-3)', textAlign: 'right' }}>{r.dte}d</span>
      <span style={{ color: deltaColor(r.delta), textAlign: 'right' }}>{r.delta.toFixed(2)}</span>
      <span style={{ color: '#10b981', textAlign: 'right' }}>${r.mid.toFixed(2)}</span>
      <span style={{ color: 'var(--text-2)', textAlign: 'right' }}>${breakeven(r).toFixed(2)}</span>
      <span style={{ color: ty >= 1 ? '#10b981' : 'var(--text-3)', fontWeight: 600, textAlign: 'right' }}>{ty.toFixed(1)}%</span>
      <span style={{ color: scoreColor(r.score), fontWeight: 700, fontFamily: "'Inter', sans-serif", textAlign: 'right' }}>{r.score}</span>
    </div>
  )
}

function MiniHeader() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: GRID, gap: 3, padding: '3px 0 5px', borderBottom: '1px solid var(--border-light)', fontSize: 8, fontWeight: 600, color: 'var(--text-4)', letterSpacing: '0.5px' }}>
      <span style={{ textAlign: 'center' }}>#</span><span>STRIKE</span>
      <span style={{ textAlign: 'right' }}>EXP</span><span style={{ textAlign: 'right' }}>DTE</span>
      <span style={{ textAlign: 'right' }}>DELTA</span><span style={{ textAlign: 'right' }}>CREDIT</span>
      <span style={{ textAlign: 'right' }}>BEP</span>
      <span style={{ textAlign: 'right' }}>YIELD</span><span style={{ textAlign: 'right' }}>SCR</span>
    </div>
  )
}

function StrategySection({ label, color, items, nextEarnings, fomcDates }: { label: string; color: string; items: ScanResult[]; nextEarnings: string | null; fomcDates: string[] }) {
  if (!items.length) return null
  const flags = Array.from(new Set(items.flatMap(r => r.flags)))
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <span style={{ padding: '1px 6px', fontSize: 9, fontWeight: 700, background: `${color}15`, border: `1px solid ${color}40`, color, fontFamily: "'Inter', sans-serif", letterSpacing: '0.5px' }}>{label}</span>
        <span style={{ fontSize: 9, color: 'var(--text-4)', fontFamily: 'Inter, sans-serif' }}>TOP {items.length}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 3 }}>
          {flags.map(f => <span key={f} style={{ padding: '0 4px', fontSize: 8, fontWeight: 700, background: `${FLAG_COLORS[f]}12`, color: FLAG_COLORS[f], fontFamily: "'Inter', sans-serif" }}>{FLAG_LABELS[f]}</span>)}
        </div>
      </div>
      <MiniHeader />
      {items.map((r, i) => <OptionRow key={i} r={r} rank={i + 1} nextEarnings={nextEarnings} fomcDates={fomcDates} />)}
    </div>
  )
}

// fontSize must be >= 16px — below that, iOS Safari running as an installed
// home-screen app has a known bug where focusing the input never brings up
// the on-screen keyboard at all.
const inputStyle: React.CSSProperties = { width: 52, padding: '3px 6px', fontSize: 16, textAlign: 'right', background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-1)', fontFamily: 'Inter, sans-serif', outline: 'none', borderRadius: 3 }
const inputClassName = 'scanner-param-input'
const labelStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: 'var(--text-3)', fontFamily: 'Inter, sans-serif' }

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
  const [customCfg,     setCustomCfg]    = useState<ModeConfig>(loadCustomCfg)
  const [topCollapsed,  setTopCollapsed] = useState(false)
  const [strategyFilter, setStrategyFilter] = useState<'all' | 'csp' | 'cc'>('all')

  function handleResultsScroll(e: React.UIEvent<HTMLDivElement>) {
    setTopCollapsed(e.currentTarget.scrollTop > 24)
  }

  function updateCustom(patch: Partial<ModeConfig>) {
    setCustomCfg(prev => { const n = { ...prev, ...patch }; localStorage.setItem(CUSTOM_CFG_KEY, JSON.stringify(n)); return n })
  }

  const stocksHeld = useMemo(() => {
    const map: Record<string, number> = {}
    for (const p of state.sync.positions)
      if (p.assetClass === 'STK') map[p.symbol] = (map[p.symbol] ?? 0) + p.quantity
    return map
  }, [state.sync.positions])

  const tickers = useMemo(() => [...customTickers].sort(), [customTickers])

  const [earningsMap, setEarningsMap] = useState<Record<string, string[]>>({})
  useEffect(() => {
    fetchEarningsDates(tickers).then(setEarningsMap).catch(() => {})
  }, [tickers])

  const [fomcDates, setFomcDates] = useState<string[]>([])
  useEffect(() => {
    fetchFomcDates().then(setFomcDates).catch(() => {})
  }, [])

  const filtered = useMemo(() => filterByMode(results, customCfg), [results, customCfg])
  const cards    = useMemo(() => buildCards(filtered, tickers, earningsMap), [filtered, tickers, earningsMap])

  function toggleCollapse(sym: string) {
    setCollapsed(prev => { const n = new Set(prev); n.has(sym) ? n.delete(sym) : n.add(sym); return n })
  }
  function addTicker() {
    const sym = tickerInput.trim().toUpperCase()
    if (!sym) return
    if (!customTickers.includes(sym)) {
      const next = [...customTickers, sym]; setCustomTickers(next); saveCustomTickers(next)
    }
    setTickerInput('')
  }
  function removeTicker(sym: string) {
    const next = customTickers.filter(t => t !== sym); setCustomTickers(next); saveCustomTickers(next)
  }

  async function handleScan() {
    setScanning(true); setError(null); setResults([]); setScanProgress('')
    try {
      setScanProgress('Fetching chains…')
      const all = await scanAllTickersCboe(tickers, (sym, i, total) => setScanProgress(`${sym} (${i}/${total})`))
      if (!all.length && tickers.length) setError('No results — try again in 30s.')
      setResults(all); setScanned(true)
    } catch (e) { setError(String(e)) }
    finally { setScanning(false); setScanProgress('') }
  }

  return (
    <div style={{ padding: 16, height: '100%', display: 'flex', flexDirection: 'column', gap: 10, overflow: 'hidden' }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', flexShrink: 0 }}>
        <Activity size={16} style={{ color: 'var(--accent)', flexShrink: 0 }} />
        <span className="chakra" style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-1)', letterSpacing: '1px' }}>SCANNER</span>

        <button onClick={handleScan} disabled={scanning || tickers.length === 0} title={tickers.length === 0 ? 'Add a ticker first' : undefined} style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 14px', fontSize: 12, fontWeight: 600,
          background: scanning || tickers.length === 0 ? 'var(--bg-elevated)' : 'var(--accent-dim)',
          border: `1px solid ${scanning || tickers.length === 0 ? 'var(--border)' : 'var(--accent-border)'}`,
          color: scanning || tickers.length === 0 ? 'var(--text-3)' : 'var(--accent)', cursor: scanning || tickers.length === 0 ? 'not-allowed' : 'pointer',
          fontFamily: "'Inter', sans-serif", letterSpacing: '1px', textTransform: 'uppercase',
        }}>
          <Scan size={12} style={{ animation: scanning ? 'spin 1.5s linear infinite' : 'none' }} />
          {scanning ? 'Scanning…' : 'Scan'}
        </button>

        {/* fontSize must be >= 16px — below that, iOS Safari running as an
            installed home-screen app (apple-mobile-web-app-capable) has a
            known bug where focusing the input triggers its auto-zoom-to-16px
            behavior but the on-screen keyboard never actually appears. */}
        <input type="text" value={tickerInput}
          onChange={e => setTickerInput(e.target.value.toUpperCase())}
          onKeyDown={e => e.key === 'Enter' && addTicker()}
          placeholder="+ TICKER"
          autoCapitalize="characters" autoCorrect="off" autoComplete="off" spellCheck={false}
          className={inputClassName}
          style={{ width: 90, padding: '5px 8px', fontSize: 16, background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-1)', fontFamily: 'Inter, sans-serif', outline: 'none', borderRadius: 3 }}
        />

        {/* Strategy toggle — show CSP, CC, or both */}
        <div style={{ display: 'inline-flex', border: '1px solid var(--border)', borderRadius: 4, overflow: 'hidden' }}>
          {(['all', 'csp', 'cc'] as const).map(f => (
            <button key={f} onClick={() => setStrategyFilter(f)} style={{
              padding: '5px 10px', fontSize: 10, fontWeight: 700, letterSpacing: '0.5px',
              background: strategyFilter === f ? 'var(--accent-dim)' : 'var(--bg-elevated)',
              color: strategyFilter === f ? 'var(--accent)' : 'var(--text-3)',
              border: 'none', borderLeft: f !== 'all' ? '1px solid var(--border)' : 'none',
              cursor: 'pointer', fontFamily: "'Inter', sans-serif", textTransform: 'uppercase',
            }}>
              {f === 'all' ? 'All' : f}
            </button>
          ))}
        </div>

        {scanning && <span style={{ fontSize: 11, color: 'var(--accent)', fontFamily: 'Inter, sans-serif', animation: 'pulse 2s infinite' }}>{scanProgress || 'Initializing…'}</span>}

        {scanned && (
          <span style={{ fontSize: 11, color: 'var(--text-4)', marginLeft: 'auto', fontFamily: 'Inter, sans-serif' }}>
            {filtered.length} results · {cards.length} tickers
          </span>
        )}
      </div>

      {/* ── Collapsible: params + custom tickers (hides while scrolling results) ── */}
      <div style={{
        display: 'grid',
        gridTemplateRows: topCollapsed ? '0fr' : '1fr',
        transition: 'grid-template-rows 0.22s ease',
        flexShrink: 0,
      }}>
        <div style={{
          overflow: 'hidden',
          opacity: topCollapsed ? 0 : 1,
          transition: 'opacity 0.18s ease',
          display: 'flex', flexDirection: 'column', gap: 10,
          minHeight: 0,
        }}>
        {/* ── Scan params (manual) ────────────────────────────────────────────── */}
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', padding: '8px 14px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, flexShrink: 0, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--signature)', letterSpacing: 2, fontFamily: "'Inter', sans-serif" }}>PARAMS</span>
          <label style={labelStyle}>Δ min <input type="number" value={customCfg.deltaMin} step={0.01} min={0.01} max={0.49} onChange={e => updateCustom({ deltaMin: +e.target.value })} style={inputStyle} className={inputClassName} /></label>
          <label style={labelStyle}>Δ max <input type="number" value={customCfg.deltaMax} step={0.01} min={0.02} max={0.55} onChange={e => updateCustom({ deltaMax: +e.target.value })} style={inputStyle} className={inputClassName} /></label>
          <label style={labelStyle}>DTE min <input type="number" value={customCfg.dteMin} step={1} min={1} max={59} onChange={e => updateCustom({ dteMin: +e.target.value })} style={inputStyle} className={inputClassName} /></label>
          <label style={labelStyle}>DTE max <input type="number" value={customCfg.dteMax} step={1} min={2} max={90} onChange={e => updateCustom({ dteMax: +e.target.value })} style={inputStyle} className={inputClassName} /></label>
          <label style={labelStyle}>Min bid <input type="number" value={customCfg.minBid} step={0.01} min={0.01} max={5} onChange={e => updateCustom({ minBid: +e.target.value })} style={inputStyle} className={inputClassName} /></label>
        </div>

        {/* ── Tickers (add/remove) ────────────────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, flexShrink: 0, minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center', overflowX: 'auto', flexWrap: 'nowrap', paddingBottom: 2 }}>
            <span style={{ fontSize: 9, color: 'var(--text-5)', letterSpacing: 1.5, fontFamily: "'Inter', sans-serif", flexShrink: 0 }}>
              TICKERS ({tickers.length}):
            </span>
            {tickers.map(sym => (
              <button key={sym} onClick={() => removeTicker(sym)} title="Remove" style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 8px', fontSize: 10, fontWeight: 600, flexShrink: 0, whiteSpace: 'nowrap', background: 'var(--accent-dim)', border: '1px solid var(--accent-border)', color: 'var(--accent)', cursor: 'pointer', borderRadius: 3, fontFamily: 'Inter, sans-serif' }}>
                {sym} <span style={{ color: 'var(--text-4)', fontSize: 8 }}>&times;</span>
              </button>
            ))}
          </div>
        </div>
        </div>
      </div>

      {/* ── Error ───────────────────────────────────────────────────────────── */}
      {error && <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#f43f5e', fontSize: 12, flexShrink: 0 }}><AlertCircle size={13} />{error}</div>}

      {/* ── Empty states ────────────────────────────────────────────────────── */}
      {scanning && !scanned && (
        <div style={{ textAlign: 'center', paddingTop: 60 }}>
          <div className="chakra" style={{ fontSize: 15, color: 'var(--text-2)', letterSpacing: '1px' }}>SCANNING {tickers.length} TICKERS</div>
          <div style={{ fontSize: 11, color: 'var(--text-4)', marginTop: 6, fontFamily: 'Inter, sans-serif' }}>Parallel fetch · CBOE delayed quotes</div>
          <div style={{ width: 160, height: 3, background: 'var(--border)', borderRadius: 2, margin: '14px auto', overflow: 'hidden' }}>
            <div style={{ height: '100%', background: 'var(--accent)', animation: 'pulse 1.5s ease-in-out infinite', width: '60%', borderRadius: 2 }} />
          </div>
        </div>
      )}

      {!scanning && !scanned && !error && tickers.length === 0 && (
        <div style={{ textAlign: 'center', paddingTop: 60 }}>
          <Activity size={28} style={{ color: 'var(--text-5)', marginBottom: 10 }} />
          <div className="chakra" style={{ fontSize: 15, color: 'var(--text-2)', letterSpacing: '1px' }}>OPTIONS SCANNER</div>
          <div style={{ fontSize: 11, color: 'var(--text-4)', marginTop: 6, fontFamily: 'Inter, sans-serif', lineHeight: 1.8 }}>
            Type a ticker above and hit Enter to start building your watchlist
          </div>
        </div>
      )}

      {!scanning && !scanned && !error && tickers.length > 0 && (
        <div style={{ textAlign: 'center', paddingTop: 60 }}>
          <Activity size={28} style={{ color: 'var(--text-5)', marginBottom: 10 }} />
          <div className="chakra" style={{ fontSize: 15, color: 'var(--text-2)', letterSpacing: '1px' }}>OPTIONS SCANNER</div>
          <div style={{ fontSize: 11, color: 'var(--text-4)', marginTop: 6, fontFamily: 'Inter, sans-serif', lineHeight: 1.8 }}>
            {tickers.length} tickers · CSP &amp; CC
          </div>
          <div style={{ fontSize: 11, color: 'var(--signature)', marginTop: 2, fontFamily: 'Inter, sans-serif' }}>
            Δ {customCfg.deltaMin}–{customCfg.deltaMax} · {customCfg.dteMin}–{customCfg.dteMax}d · bid ≥ ${customCfg.minBid}
          </div>
          <button onClick={handleScan} style={{ marginTop: 16, padding: '8px 24px', fontSize: 13, fontWeight: 600, background: 'var(--accent-dim)', border: '1px solid var(--accent-border)', color: 'var(--accent)', cursor: 'pointer', fontFamily: "'Inter', sans-serif", letterSpacing: '1.5px', textTransform: 'uppercase' }}>
            START SCAN
          </button>
        </div>
      )}

      {scanned && !scanning && cards.length === 0 && (
        <div style={{ textAlign: 'center', paddingTop: 40 }}>
          <div className="chakra" style={{ fontSize: 13, color: 'var(--text-3)', letterSpacing: '1px' }}>NO RESULTS FOR CURRENT PARAMS</div>
          <div style={{ fontSize: 11, color: 'var(--text-5)', marginTop: 6, fontFamily: 'Inter, sans-serif' }}>
            Δ {customCfg.deltaMin}–{customCfg.deltaMax} · {customCfg.dteMin}–{customCfg.dteMax}d · bid ≥ ${customCfg.minBid} — widen above to see more
          </div>
        </div>
      )}

      {/* ── Card grid ───────────────────────────────────────────────────────── */}
      {scanned && cards.length > 0 && (
        <div onScroll={handleResultsScroll} style={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', flexWrap: 'wrap', gap: 10, alignContent: 'start', justifyContent: 'center' }}>
          {cards.map((card, idx) => {
            const isCollapsed = collapsed.has(card.symbol)
            const showCsp = strategyFilter !== 'cc' && card.topCsp.length > 0
            const showCc  = strategyFilter !== 'csp' && card.topCc.length > 0
            const hasData = showCsp || showCc
            const shares = stocksHeld[card.symbol] ?? 0
            return (
              <div key={card.symbol} style={{ width: CARD_W, minWidth: CARD_W, maxWidth: CARD_W, background: 'var(--bg-card)', border: `1px solid ${idx < 3 && hasData ? 'var(--accent-border)' : 'var(--border)'}`, borderRadius: 8, overflow: 'hidden', flexShrink: 0 }}>

                <div onClick={() => hasData && toggleCollapse(card.symbol)}
                  style={{ padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 8, cursor: hasData ? 'pointer' : 'default', background: 'var(--bg-surface)', borderBottom: isCollapsed || !hasData ? 'none' : '1px solid var(--border)', userSelect: 'none' }}>
                  {hasData && <span style={{ fontSize: 9, fontWeight: 700, color: idx < 3 ? 'var(--accent)' : 'var(--text-5)', fontFamily: "'Inter', sans-serif", minWidth: 16 }}>#{idx + 1}</span>}
                  <span style={{ fontFamily: "'Inter', sans-serif", fontSize: 15, fontWeight: 700, color: idx === 0 && hasData ? 'var(--accent)' : hasData ? 'var(--text-1)' : 'var(--text-4)', letterSpacing: '1px' }}>{card.symbol}</span>
                  {card.price > 0 && <span style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'Inter, sans-serif' }}>${card.price.toFixed(2)}</span>}
                  {shares > 0 && <span style={{ padding: '1px 5px', fontSize: 9, fontWeight: 700, background: '#3b82f615', border: '1px solid #3b82f640', color: '#3b82f6', fontFamily: "'Inter', sans-serif" }}>{shares} SHR</span>}
                  {card.nextEarnings && (
                    <span title={`Next earnings ${card.nextEarnings}`} style={{ padding: '1px 5px', fontSize: 9, fontWeight: 700, background: '#F0B42915', border: '1px solid #F0B42940', color: '#F0B429', fontFamily: "'Inter', sans-serif" }}>
                      ER {fmtEr(card.nextEarnings)}
                    </span>
                  )}
                  <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
                    {hasData ? (
                      <>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: 7, color: 'var(--text-4)', letterSpacing: '1px', fontWeight: 600 }}>SCORE</div>
                          <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 14, fontWeight: 700, color: scoreColor(card.bestScore) }}>{card.bestScore}</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: 7, color: 'var(--text-4)', letterSpacing: '1px', fontWeight: 600 }}>IV</div>
                          <div style={{ fontSize: 13, color: 'var(--text-2)', fontFamily: 'Inter, sans-serif' }}>{card.avgIv.toFixed(0)}%</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: 7, color: 'var(--text-4)', letterSpacing: '1px', fontWeight: 600 }}>OPTS</div>
                          <div style={{ fontSize: 13, color: 'var(--text-3)', fontFamily: 'Inter, sans-serif' }}>{card.totalContracts}</div>
                        </div>
                        {isCollapsed ? <ChevronDown size={14} style={{ color: 'var(--text-4)' }} /> : <ChevronUp size={14} style={{ color: 'var(--text-4)' }} />}
                      </>
                    ) : (
                      <span style={{ fontSize: 10, color: 'var(--text-5)', fontFamily: 'Inter, sans-serif' }}>NO DATA</span>
                    )}
                  </div>
                </div>

                {hasData && !isCollapsed && (
                  <div style={{ padding: '8px 12px 10px' }}>
                    {showCsp && <StrategySection label="CSP" color="#f43f5e" items={card.topCsp} nextEarnings={card.nextEarnings} fomcDates={fomcDates} />}
                    {showCc  && <StrategySection label="CC"  color="#3b82f6" items={card.topCc} nextEarnings={card.nextEarnings} fomcDates={fomcDates} />}
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
