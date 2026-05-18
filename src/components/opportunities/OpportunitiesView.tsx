import { useState, useMemo } from 'react'
import { Scan, AlertCircle, Activity, ChevronDown, ChevronUp } from 'lucide-react'
import type { AppState, ScanResult, ScanFlag } from '../../types'
import { scanAllTickersCboe } from '../../services/cboe'
import { scanAllTickers } from '../../services/yahoo'

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

  // Ensure all tickers appear even if no results
  for (const sym of tickers) {
    map.set(sym, { results: [], price: 0 })
  }

  for (const r of results) {
    const entry = map.get(r.underlying)
    if (entry) {
      entry.results.push(r)
      if (!entry.price) entry.price = r.stockPrice
    } else {
      map.set(r.underlying, { results: [r], price: r.stockPrice })
    }
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

  // Sort by best score descending
  cards.sort((a, b) => b.bestScore - a.bestScore)
  return cards
}

// ─── Mini option row ─────────────────────────────────────────────────────────

function OptionRow({ r, rank }: { r: ScanResult; rank: number }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '16px 52px 42px 36px 40px 36px 36px',
      gap: 4, alignItems: 'center',
      padding: '4px 0',
      borderBottom: '1px solid var(--border)',
      fontSize: 11, fontFamily: 'IBM Plex Mono, monospace',
    }}>
      <span style={{ color: 'var(--text-5)', fontSize: 10 }}>{rank}</span>
      <span style={{ color: 'var(--text-1)', fontWeight: 600 }}>${r.strike}</span>
      <span style={{ color: 'var(--text-3)' }}>{fmtExp(r.expiry)}</span>
      <span style={{ color: 'var(--text-3)' }}>{r.dte}d</span>
      <span style={{ color: deltaColor(r.delta) }}>{r.delta.toFixed(2)}</span>
      <span style={{ color: '#10b981', fontWeight: 600 }}>{r.annualizedYield.toFixed(0)}%</span>
      <span style={{ color: scoreColor(r.score), fontWeight: 700, fontFamily: "'Chakra Petch', sans-serif" }}>{r.score}</span>
    </div>
  )
}

function MiniHeader() {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '16px 52px 42px 36px 40px 36px 36px',
      gap: 4, padding: '2px 0 4px',
      borderBottom: '1px solid var(--border-light)',
      fontSize: 8, fontWeight: 600, color: 'var(--text-4)',
      letterSpacing: '1px', textTransform: 'uppercase',
    }}>
      <span>#</span>
      <span>STRIKE</span>
      <span>EXP</span>
      <span>DTE</span>
      <span>DELTA</span>
      <span>YIELD</span>
      <span>SCR</span>
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
  const [dataSource, setDataSource] = useState<'cboe' | 'yahoo'>('cboe')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const stocksHeld = useMemo(() => {
    const map: Record<string, number> = {}
    for (const p of state.sync.positions) {
      if (p.assetClass === 'STK') map[p.symbol] = (map[p.symbol] ?? 0) + p.quantity
    }
    return map
  }, [state.sync.positions])

  const WATCHLIST = ['TSLA','MSTR','AMD','ALAB','ARM','ASML','AVGO','GOOG','MRVL','MU','NVDA','PLTR','TSM']

  const tickers = useMemo(() => {
    const set = new Set<string>(WATCHLIST)
    const SKIP = new Set(['SPX','SPY','QQQ','IWM','DIA','VIX'])
    for (const p of state.sync.positions) {
      const sym = p.underlyingSymbol ?? (p.assetClass === 'STK' ? p.symbol : null)
      if (sym && !SKIP.has(sym)) set.add(sym)
    }
    return [...set].sort()
  }, [state.sync.positions])

  const cards = useMemo(() => buildCards(results, tickers), [results, tickers])

  function toggleCollapse(sym: string) {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(sym)) next.delete(sym); else next.add(sym)
      return next
    })
  }

  async function handleScan() {
    setScanning(true); setError(null); setResults([]); setScanProgress('')
    try {
      let all: ScanResult[] = []
      if (dataSource === 'cboe') {
        setScanProgress('CBOE — parallel fetch...')
        all = await scanAllTickersCboe(tickers, stocksHeld, (sym, i, total) => {
          setScanProgress(`${sym} (${i + 1}/${total})`)
        })
        if (all.length === 0) {
          setScanProgress('CBOE returned 0 — falling back to Yahoo...')
          all = await scanAllTickers(tickers, stocksHeld, (sym, i, total) => {
            setScanProgress(`Yahoo: ${sym} (${i + 1}/${total})`)
          })
        }
      } else {
        all = await scanAllTickers(tickers, stocksHeld, (sym, i, total) => {
          setScanProgress(`${sym} (${i + 1}/${total})`)
        })
      }
      if (all.length === 0 && tickers.length > 0) setError('No results — try again in 30s.')
      setResults(all); setScanned(true)
    } catch (e) { setError(String(e)) }
    finally { setScanning(false); setScanProgress('') }
  }

  // Summary stats
  const totalResults = results.length
  const totalFlagged = results.filter(r => r.flags.length > 0).length

  return (
    <div style={{ padding: '16px', height: '100%', display: 'flex', flexDirection: 'column', gap: 12, overflow: 'hidden' }}>

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
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

        <div style={{ display: 'flex', gap: 2 }}>
          {(['cboe', 'yahoo'] as const).map(src => (
            <button key={src} onClick={() => setDataSource(src)} disabled={scanning} style={{
              padding: '4px 8px', fontSize: 9, fontWeight: 700,
              background: dataSource === src ? 'var(--accent-dim)' : 'transparent',
              border: `1px solid ${dataSource === src ? 'rgba(0,229,255,0.25)' : 'var(--border)'}`,
              color: dataSource === src ? 'var(--accent)' : 'var(--text-4)',
              cursor: scanning ? 'not-allowed' : 'pointer',
              fontFamily: "'Chakra Petch', sans-serif", letterSpacing: '1px', textTransform: 'uppercase',
            }}>
              {src === 'cboe' ? '⚡ CBOE' : '🐢 YAHOO'}
            </button>
          ))}
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

      {/* ── Error ───────────────────────────────────────────────────────────── */}
      {error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#f43f5e', fontSize: 12 }}>
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
            {dataSource === 'cboe' ? 'Parallel fetch via CBOE' : 'Pacing requests · ~2s per ticker'}
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
        <div style={{
          flex: 1, minHeight: 0, overflow: 'auto',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 360px), 1fr))',
          gap: 10, alignContent: 'start',
        }}>
          {cards.map((card, cardIdx) => {
            const isCollapsed = collapsed.has(card.symbol)
            const hasData = card.topCsp.length > 0 || card.topCc.length > 0
            const shares = stocksHeld[card.symbol] ?? 0

            return (
              <div key={card.symbol} style={{
                background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8,
                overflow: 'hidden', display: 'flex', flexDirection: 'column',
                borderColor: cardIdx < 3 && hasData ? 'rgba(0,229,255,0.15)' : 'var(--border)',
              }}>

                {/* ── Card Header ─────────────────────────────────────────── */}
                <div
                  onClick={() => hasData && toggleCollapse(card.symbol)}
                  style={{
                    padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10,
                    cursor: hasData ? 'pointer' : 'default',
                    background: 'var(--bg-surface)',
                    borderBottom: isCollapsed || !hasData ? 'none' : '1px solid var(--border)',
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
                    fontFamily: "'Chakra Petch', sans-serif", fontSize: 16, fontWeight: 700,
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

                  {/* Spacer + right side metrics */}
                  <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
                    {hasData && (
                      <>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: 7, color: 'var(--text-4)', letterSpacing: '1px', fontWeight: 600 }}>SCORE</div>
                          <div style={{ fontFamily: "'Chakra Petch', sans-serif", fontSize: 14, fontWeight: 700, color: scoreColor(card.bestScore) }}>
                            {card.bestScore}
                          </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: 7, color: 'var(--text-4)', letterSpacing: '1px', fontWeight: 600 }}>IV</div>
                          <div className="mono" style={{ fontSize: 13, color: 'var(--text-2)' }}>
                            {card.avgIv.toFixed(0)}%
                          </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: 7, color: 'var(--text-4)', letterSpacing: '1px', fontWeight: 600 }}>OPTS</div>
                          <div className="mono" style={{ fontSize: 13, color: 'var(--text-3)' }}>
                            {card.totalContracts}
                          </div>
                        </div>
                        {hasData && (
                          isCollapsed
                            ? <ChevronDown size={14} style={{ color: 'var(--text-4)' }} />
                            : <ChevronUp size={14} style={{ color: 'var(--text-4)' }} />
                        )}
                      </>
                    )}
                    {!hasData && (
                      <span className="mono" style={{ fontSize: 10, color: 'var(--text-5)' }}>NO DATA</span>
                    )}
                  </div>
                </div>

                {/* ── Card Body ────────────────────────────────────────────── */}
                {hasData && !isCollapsed && (
                  <div style={{ padding: '8px 14px 12px' }}>

                    {/* CSP section */}
                    {card.topCsp.length > 0 && (
                      <div style={{ marginBottom: card.topCc.length > 0 ? 12 : 0 }}>
                        <div style={{
                          display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6,
                        }}>
                          <span style={{
                            padding: '1px 6px', fontSize: 9, fontWeight: 700,
                            background: '#f43f5e15', border: '1px solid #f43f5e40', color: '#f43f5e',
                            fontFamily: "'Chakra Petch', sans-serif", letterSpacing: '0.5px',
                          }}>
                            CSP
                          </span>
                          <span className="mono" style={{ fontSize: 9, color: 'var(--text-4)' }}>
                            TOP {card.topCsp.length}
                          </span>
                          {/* Flags summary */}
                          <div style={{ marginLeft: 'auto', display: 'flex', gap: 3 }}>
                            {Array.from(new Set(card.topCsp.flatMap(r => r.flags))).map(f => (
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
                        {card.topCsp.map((r, i) => <OptionRow key={i} r={r} rank={i + 1} />)}
                      </div>
                    )}

                    {/* CC section */}
                    {card.topCc.length > 0 && (
                      <div>
                        <div style={{
                          display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6,
                        }}>
                          <span style={{
                            padding: '1px 6px', fontSize: 9, fontWeight: 700,
                            background: '#3b82f615', border: '1px solid #3b82f640', color: '#3b82f6',
                            fontFamily: "'Chakra Petch', sans-serif", letterSpacing: '0.5px',
                          }}>
                            CC
                          </span>
                          <span className="mono" style={{ fontSize: 9, color: 'var(--text-4)' }}>
                            TOP {card.topCc.length}
                          </span>
                          <div style={{ marginLeft: 'auto', display: 'flex', gap: 3 }}>
                            {Array.from(new Set(card.topCc.flatMap(r => r.flags))).map(f => (
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
                        {card.topCc.map((r, i) => <OptionRow key={i} r={r} rank={i + 1} />)}
                      </div>
                    )}
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
