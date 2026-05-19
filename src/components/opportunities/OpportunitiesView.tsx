import { useState, useMemo } from 'react'
import { Scan, AlertCircle, Activity, ChevronDown, ChevronUp } from 'lucide-react'
import type { AppState, ScanResult, ScanFlag } from '../../types'
import { scanAllTickersCboe } from '../../services/cboe'

interface Props { state: AppState }

const FLAG_COLORS: Record<ScanFlag, string> = {
  HIGH_VOL: '#00E5FF', HIGH_V_OI: '#f59e0b', IV_SPIKE: '#a855f7', NEAR_TERM: '#10b981',
}
const FLAG_LABELS: Record<ScanFlag, string> = {
  HIGH_VOL: 'VOL', HIGH_V_OI: 'V/OI', IV_SPIKE: 'IV', NEAR_TERM: 'NEAR',
}

function fmtExp(s: string): string {
  const m = s.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (!m) return s
  return `${parseInt(m[2])}/${parseInt(m[3])}`
}
function scoreColor(s: number): string {
  if (s >= 70) return '#10b981'
  if (s >= 40) return '#f59e0b'
  return 'var(--text-4)'
}
function deltaColor(d: number): string {
  const abs = Math.abs(d)
  if (abs < 0.15) return 'var(--text-3)'
  if (abs > 0.40) return '#f59e0b'
  return '#10b981'
}

// ─── Card width ──────────────────────────────────────────────────────────────

const CARD_W = 380

const CUSTOM_TICKERS_KEY = 'options:custom_tickers'
function loadCustomTickers(): string[] {
  try { return JSON.parse(localStorage.getItem(CUSTOM_TICKERS_KEY) || '[]') } catch { return [] }
}
function saveCustomTickers(t: string[]) {
  localStorage.setItem(CUSTOM_TICKERS_KEY, JSON.stringify(t))
}

// ─── Ticker card data ────────────────────────────────────────────────────────

interface TickerCard {
  symbol: string
  price: number
  bestScore: number
  avgIv: number
  totalContracts: number
  flagCount: number
  topCsp: ScanResult[]
  topCc: ScanResult[]
}

function buildCards(results: ScanResult[], tickers: string[]): TickerCard[] {
  const map = new Map<string, { results: ScanResult[]; price: number }>()
  for (const sym of tickers) map.set(sym, { results: [], price: 0 })
  for (const r of results) {
    const entry = map.get(r.underlying)
    if (entry) { entry.results.push(r); if (!entry.price) entry.price = r.stockPrice }
    else map.set(r.underlying, { results: [r], price: r.stockPrice })
  }
  const cards: TickerCard[] = []
  for (const [symbol, { results: rs, price }] of map) {
    const csps = rs.filter(r => r.strategyType === 'csp').sort((a, b) => b.score - a.score).slice(0, 5)
    const ccs = rs.filter(r => r.strategyType === 'covered_call').sort((a, b) => b.score - a.score).slice(0, 5)
    const bestScore = rs.length > 0 ? Math.max(...rs.map(r => r.score)) : 0
    const avgIv = rs.length > 0 ? rs.reduce((s, r) => s + r.iv, 0) / rs.length : 0
    const flagCount = rs.reduce((s, r) => s + r.flags.length, 0)
    cards.push({ symbol, price, bestScore, avgIv, totalContracts: rs.length, flagCount, topCsp: csps, topCc: ccs })
  }
  cards.sort((a, b) => b.bestScore - a.bestScore)
  return cards
}

// ─── Mini table components ───────────────────────────────────────────────────

const GRID_COLS = '18px 1fr 44px 34px 44px 40px 34px'

function OptionRow({ r, rank }: { r: ScanResult; rank: number }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: GRID_COLS,
      gap: 4, alignItems: 'center', padding: '5px 0',
      borderBottom: '1px solid var(--border)',
      fontSize: 11, fontFamily: 'IBM Plex Mono, monospace',
    }}>
      <span style={{ color: 'var(--text-5)', fontSize: 10, textAlign: 'center' }}>{rank}</span>
      <span style={{ color: 'var(--text-1)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        ${r.strike}
      </span>
      <span style={{ color: 'var(--text-3)', textAlign: 'right' }}>{fmtExp(r.expiry)}</span>
      <span style={{ color: 'var(--text-3)', textAlign: 'right' }}>{r.dte}d</span>
      <span style={{ color: deltaColor(r.delta), textAlign: 'right' }}>{r.delta.toFixed(2)}</span>
      <span style={{ color: '#10b981', fontWeight: 600, textAlign: 'right' }}>{r.annualizedYield.toFixed(0)}%</span>
      <span style={{ color: scoreColor(r.score), fontWeight: 700, fontFamily: "'Chakra Petch', sans-serif", textAlign: 'right' }}>{r.score}</span>
    </div>
  )
}

function MiniHeader() {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: GRID_COLS,
      gap: 4, padding: '3px 0 5px',
      borderBottom: '1px solid var(--border-light)',
      fontSize: 8, fontWeight: 600, color: 'var(--text-4)',
      letterSpacing: '1px', textTransform: 'uppercase',
    }}>
      <span style={{ textAlign: 'center' }}>#</span>
      <span>STRIKE</span>
      <span style={{ textAlign: 'right' }}>EXP</span>
      <span style={{ textAlign: 'right' }}>DTE</span>
      <span style={{ textAlign: 'right' }}>DELTA</span>
      <span style={{ textAlign: 'right' }}>YIELD</span>
      <span style={{ textAlign: 'right' }}>SCR</span>
    </div>
  )
}

function StrategySection({ label, color, items }: { label: string; color: string; items: ScanResult[] }) {
  if (items.length === 0) return null
  const uniqueFlags = Array.from(new Set(items.flatMap(r => r.flags)))
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <span style={{
          padding: '1px 6px', fontSize: 9, fontWeight: 700,
          background: `${color}15`, border: `1px solid ${color}40`, color,
          fontFamily: "'Chakra Petch', sans-serif", letterSpacing: '0.5px',
        }}>
          {label}
        </span>
        <span className="mono" style={{ fontSize: 9, color: 'var(--text-4)' }}>TOP {items.length}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 3 }}>
          {uniqueFlags.map(f => (
            <span key={f} style={{
              padding: '0 4px', fontSize: 8, fontWeight: 700,
              background: `${FLAG_COLORS[f]}12`, color: FLAG_COLORS[f],
              fontFamily: "'Chakra Petch', sans-serif",
            }}>
              {FLAG_LABELS[f]}
            </span>
          ))}
        </div>
      </div>
      <MiniHeader />
      {items.map((r, i) => <OptionRow key={i} r={r} rank={i + 1} />)}
    </div>
  )
}

// ─── Main component ──────────────────────────────────────────────────────────

export default function OpportunitiesView({ state }: Props) {
  const [results, setResults]   = useState<ScanResult[]>([])
  const [scanning, setScanning] = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [scanned, setScanned]   = useState(false)
  const [scanProgress, setScanProgress] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [customTickers, setCustomTickers] = useState<string[]>(loadCustomTickers)
  const [tickerInput, setTickerInput] = useState('')

  const stocksHeld = useMemo(() => {
    const map: Record<string, number> = {}
    for (const p of state.sync.positions) {
      if (p.assetClass === 'STK') map[p.symbol] = (map[p.symbol] ?? 0) + p.quantity
    }
    return map
  }, [state.sync.positions])

  const WATCHLIST = ['TSLA','MSTR','AMD','ALAB','ARM','ASML','AVGO','GOOG','MRVL','MU','NVDA','PLTR','TSM']

  const tickers = useMemo(() => {
    const set = new Set<string>([...WATCHLIST, ...customTickers])
    const SKIP = new Set(['SPX','SPY','QQQ','IWM','DIA','VIX'])
    for (const p of state.sync.positions) {
      const sym = p.underlyingSymbol ?? (p.assetClass === 'STK' ? p.symbol : null)
      if (sym && !SKIP.has(sym)) set.add(sym)
    }
    return [...set].sort()
  }, [state.sync.positions, customTickers])

  const cards = useMemo(() => buildCards(results, tickers), [results, tickers])

  function toggleCollapse(sym: string) {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(sym)) next.delete(sym); else next.add(sym)
      return next
    })
  }

  function addTicker() {
    const sym = tickerInput.trim().toUpperCase()
    if (!sym || customTickers.includes(sym) || WATCHLIST.includes(sym)) return
    const next = [...customTickers, sym]
    setCustomTickers(next)
    saveCustomTickers(next)
    setTickerInput('')
  }

  function removeTicker(sym: string) {
    const next = customTickers.filter(t => t !== sym)
    setCustomTickers(next)
    saveCustomTickers(next)
  }

  async function handleScan() {
    setScanning(true); setError(null); setResults([]); setScanProgress('')
    try {
      setScanProgress('CBOE — parallel fetch...')
      const all = await scanAllTickersCboe(tickers, stocksHeld, (sym, i, total) => {
        setScanProgress(`${sym} (${i + 1}/${total})`)
      })
      if (all.length === 0 && tickers.length > 0) setError('No results — try again in 30s.')
      setResults(all); setScanned(true)
    } catch (e) { setError(String(e)) }
    finally { setScanning(false); setScanProgress('') }
  }

  const totalResults = results.length
  const totalFlagged = results.filter(r => r.flags.length > 0).length

  return (
    <div style={{ padding: '16px', height: '100%', display: 'flex', flexDirection: 'column', gap: 12, overflow: 'hidden' }}>

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', flexShrink: 0 }}>
        <Activity size={16} style={{ color: 'var(--accent)', flexShrink: 0 }} />
        <span className="chakra" style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-1)', letterSpacing: '1px', textTransform: 'uppercase' }}>
          Scanner
        </span>

        <button onClick={handleScan} disabled={scanning} style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '6px 14px', fontSize: 12, fontWeight: 600,
          background: scanning ? 'var(--bg-elevated)' : 'var(--accent-dim)',
          border: `1px solid ${scanning ? 'var(--border)' : 'rgba(0,229,255,0.25)'}`,
          color: scanning ? 'var(--text-3)' : 'var(--accent)',
          cursor: scanning ? 'not-allowed' : 'pointer',
          fontFamily: "'Chakra Petch', sans-serif", letterSpacing: '1px', textTransform: 'uppercase',
        }}>
          <Scan size={12} style={{ animation: scanning ? 'spin 1.5s linear infinite' : 'none' }} />
          {scanning ? 'Scanning…' : 'Scan'}
        </button>

        {/* Add ticker */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <input
            type="text"
            value={tickerInput}
            onChange={e => setTickerInput(e.target.value.toUpperCase())}
            onKeyDown={e => e.key === 'Enter' && addTicker()}
            placeholder="+ TICKER"
            style={{
              width: 80, padding: '5px 8px', fontSize: 11,
              background: 'var(--bg-elevated)', border: '1px solid var(--border)',
              color: 'var(--text-1)', fontFamily: 'IBM Plex Mono, monospace',
              outline: 'none', borderRadius: 3,
            }}
          />
        </div>

        {scanning && (
          <span className="mono" style={{ fontSize: 11, color: 'var(--accent)', animation: 'pulse 2s infinite' }}>
            {scanProgress || 'Initializing…'}
          </span>
        )}

        {scanned && (
          <span className="mono" style={{ fontSize: 11, color: 'var(--text-4)', marginLeft: 'auto' }}>
            {totalResults} results · {totalFlagged} flagged · {cards.length} tickers
          </span>
        )}
      </div>

      {/* ── Custom tickers ─────────────────────────────────────────────────── */}
      {customTickers.length > 0 && (
        <div className="scanner-tickers" style={{ display: 'flex', gap: 4, flexWrap: 'wrap', flexShrink: 0, alignItems: 'center' }}>
          <span style={{ fontSize: 9, color: 'var(--text-5)', letterSpacing: 1.5 }}>CUSTOM:</span>
          {customTickers.map(sym => (
            <button key={sym} onClick={() => removeTicker(sym)} title="Remove" style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '2px 8px', fontSize: 10, fontWeight: 600,
              background: 'var(--accent-dim)', border: '1px solid rgba(0,229,255,0.2)',
              color: 'var(--accent)', cursor: 'pointer', borderRadius: 3,
              fontFamily: "'IBM Plex Mono', monospace",
            }}>
              {sym} <span style={{ color: 'var(--text-4)', fontSize: 8 }}>&times;</span>
            </button>
          ))}
        </div>
      )}

      {/* ── Error ───────────────────────────────────────────────────────────── */}
      {error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#f43f5e', fontSize: 12, flexShrink: 0 }}>
          <AlertCircle size={13} />{error}
        </div>
      )}

      {/* ── Empty States ────────────────────────────────────────────────────── */}
      {scanning && !scanned && (
        <div style={{ textAlign: 'center', paddingTop: 60 }}>
          <div className="chakra" style={{ fontSize: 15, color: 'var(--text-2)', letterSpacing: '1px' }}>
            SCANNING {tickers.length} TICKERS
          </div>
          <div className="mono" style={{ fontSize: 11, color: 'var(--text-4)', marginTop: 6 }}>
            Parallel fetch via CBOE delayed quotes
          </div>
          <div style={{ width: 160, height: 3, background: 'var(--border)', borderRadius: 2, margin: '14px auto', overflow: 'hidden' }}>
            <div style={{ height: '100%', background: 'var(--accent)', animation: 'pulse 1.5s ease-in-out infinite', width: '60%', borderRadius: 2 }} />
          </div>
        </div>
      )}

      {!scanning && !scanned && !error && (
        <div style={{ textAlign: 'center', paddingTop: 60 }}>
          <Activity size={28} style={{ color: 'var(--text-5)', marginBottom: 10 }} />
          <div className="chakra" style={{ fontSize: 15, color: 'var(--text-2)', letterSpacing: '1px' }}>OPTIONS SCANNER</div>
          <div className="mono" style={{ fontSize: 11, color: 'var(--text-4)', marginTop: 6, lineHeight: 1.8 }}>
            {tickers.length} tickers · CSP &amp; CC · Delta 0.08–0.55 · DTE 7–60
          </div>
          <button onClick={handleScan} style={{
            marginTop: 16, padding: '8px 24px', fontSize: 13, fontWeight: 600,
            background: 'var(--accent-dim)', border: '1px solid rgba(0,229,255,0.25)',
            color: 'var(--accent)', cursor: 'pointer',
            fontFamily: "'Chakra Petch', sans-serif", letterSpacing: '1.5px', textTransform: 'uppercase',
          }}>
            START SCAN
          </button>
        </div>
      )}

      {/* ── Card Grid ───────────────────────────────────────────────────────── */}
      {scanned && cards.length > 0 && (
        <div className="scanner-grid" style={{
          flex: 1, minHeight: 0, overflow: 'auto',
          display: 'flex', flexWrap: 'wrap',
          gap: 10, alignContent: 'start',
          justifyContent: 'center',
        }}>
          {cards.map((card, cardIdx) => {
            const isCollapsed = collapsed.has(card.symbol)
            const hasData = card.topCsp.length > 0 || card.topCc.length > 0
            const shares = stocksHeld[card.symbol] ?? 0

            return (
              <div key={card.symbol} className="scanner-card" style={{
                width: CARD_W, minWidth: CARD_W, maxWidth: CARD_W,
                background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8,
                overflow: 'hidden', flexShrink: 0,
                borderColor: cardIdx < 3 && hasData ? 'rgba(0,229,255,0.15)' : 'var(--border)',
              }}>

                {/* ── Card Header ─────────────────────────────────────────── */}
                <div
                  className="scanner-header"
                  onClick={() => hasData && toggleCollapse(card.symbol)}
                  style={{
                    padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 8,
                    cursor: hasData ? 'pointer' : 'default',
                    background: 'var(--bg-surface)',
                    borderBottom: isCollapsed || !hasData ? 'none' : '1px solid var(--border)',
                    userSelect: 'none',
                  }}
                >
                  {/* Rank */}
                  {hasData && (
                    <span style={{
                      fontSize: 9, fontWeight: 700, color: cardIdx < 3 ? 'var(--accent)' : 'var(--text-5)',
                      fontFamily: "'Chakra Petch', sans-serif", minWidth: 16,
                    }}>
                      #{cardIdx + 1}
                    </span>
                  )}

                  {/* Ticker */}
                  <span style={{
                    fontFamily: "'Chakra Petch', sans-serif", fontSize: 15, fontWeight: 700,
                    color: cardIdx === 0 && hasData ? 'var(--accent)' : hasData ? 'var(--text-1)' : 'var(--text-4)',
                    letterSpacing: '1px',
                  }}>
                    {card.symbol}
                  </span>

                  {/* Price */}
                  {card.price > 0 && (
                    <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>
                      ${card.price.toFixed(2)}
                    </span>
                  )}

                  {/* Shares badge */}
                  {shares > 0 && (
                    <span style={{
                      padding: '1px 5px', fontSize: 9, fontWeight: 700,
                      background: '#3b82f615', border: '1px solid #3b82f640', color: '#3b82f6',
                      fontFamily: "'Chakra Petch', sans-serif",
                    }}>
                      {shares} SHR
                    </span>
                  )}

                  {/* Right side */}
                  <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
                    {hasData ? (
                      <>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: 7, color: 'var(--text-4)', letterSpacing: '1px', fontWeight: 600 }}>SCORE</div>
                          <div style={{ fontFamily: "'Chakra Petch', sans-serif", fontSize: 14, fontWeight: 700, color: scoreColor(card.bestScore) }}>
                            {card.bestScore}
                          </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: 7, color: 'var(--text-4)', letterSpacing: '1px', fontWeight: 600 }}>IV</div>
                          <div className="mono" style={{ fontSize: 13, color: 'var(--text-2)' }}>{card.avgIv.toFixed(0)}%</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: 7, color: 'var(--text-4)', letterSpacing: '1px', fontWeight: 600 }}>OPTS</div>
                          <div className="mono" style={{ fontSize: 13, color: 'var(--text-3)' }}>{card.totalContracts}</div>
                        </div>
                        {isCollapsed
                          ? <ChevronDown size={14} style={{ color: 'var(--text-4)', flexShrink: 0 }} />
                          : <ChevronUp size={14} style={{ color: 'var(--text-4)', flexShrink: 0 }} />}
                      </>
                    ) : (
                      <span className="mono" style={{ fontSize: 10, color: 'var(--text-5)' }}>NO DATA</span>
                    )}
                  </div>
                </div>

                {/* ── Card Body ────────────────────────────────────────────── */}
                {hasData && !isCollapsed && (
                  <div style={{ padding: '8px 12px 10px' }}>
                    <StrategySection label="CSP" color="#f43f5e" items={card.topCsp} />
                    <StrategySection label="CC" color="#3b82f6" items={card.topCc} />
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
