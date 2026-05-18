import { useState, useMemo } from 'react'
import { Scan, AlertCircle, TrendingUp, Activity, Zap, Clock } from 'lucide-react'
import type { AppState, ScanResult, ScanFlag } from '../../types'
import { scanAllTickersCboe } from '../../services/cboe'
import { scanAllTickers } from '../../services/yahoo'

interface Props { state: AppState }

type FilterType = 'all' | 'csp' | 'covered_call'
type FlagFilter = 'all' | ScanFlag
type SortKey = 'score' | 'annualizedYield' | 'delta' | 'dte' | 'iv' | 'volume' | 'openInterest' | 'volumeOiRatio' | 'gamma' | 'theta' | 'ivRank'

const STRATEGY_LABEL: Record<ScanResult['strategyType'], string> = {
  csp: 'CSP',
  covered_call: 'CC',
}

const STRATEGY_COLOR: Record<ScanResult['strategyType'], string> = {
  csp: '#f43f5e',
  covered_call: '#3b82f6',
}

const FLAG_CONFIG: Record<ScanFlag, { label: string; color: string; icon: typeof TrendingUp }> = {
  HIGH_VOL:   { label: 'HIGH VOL',  color: '#00E5FF', icon: TrendingUp },
  HIGH_V_OI:  { label: 'V/OI',      color: '#f59e0b', icon: Activity },
  IV_SPIKE:   { label: 'IV SPIKE',  color: '#a855f7', icon: Zap },
  NEAR_TERM:  { label: 'NEAR',      color: '#10b981', icon: Clock },
}

function fmtExpiry(s: string): string {
  const m = s.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (!m) return s
  return new Date(`${m[1]}-${m[2]}-${m[3]}`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function fmtK(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}

function deltaColor(d: number): string {
  const abs = Math.abs(d)
  if (abs < 0.15) return 'var(--text-3)'
  if (abs > 0.40) return '#f59e0b'
  return '#10b981'
}

function scoreColor(s: number): string {
  if (s >= 70) return '#10b981'
  if (s >= 40) return '#f59e0b'
  return 'var(--text-3)'
}

export default function OpportunitiesView({ state }: Props) {
  const [results, setResults]       = useState<ScanResult[]>([])
  const [scanning, setScanning]     = useState(false)
  const [error, setError]           = useState<string | null>(null)
  const [filter, setFilter]         = useState<FilterType>('all')
  const [flagFilter, setFlagFilter] = useState<FlagFilter>('all')
  const [sortKey, setSortKey]       = useState<SortKey>('score')
  const [sortAsc, setSortAsc]       = useState(false)
  const [scanned, setScanned]       = useState(false)
  const [scanProgress, setScanProgress] = useState('')

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

  const [dataSource, setDataSource] = useState<'cboe' | 'yahoo'>('cboe')

  async function handleScan() {
    setScanning(true)
    setError(null)
    setResults([])
    setScanProgress('')
    try {
      let all: ScanResult[] = []

      if (dataSource === 'cboe') {
        setScanProgress('CBOE — parallel fetch...')
        all = await scanAllTickersCboe(tickers, stocksHeld, (sym, i, total) => {
          setScanProgress(`${sym} (${i + 1}/${total})`)
        })
        // Fallback to Yahoo if CBOE returned nothing
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

      if (all.length === 0 && tickers.length > 0) {
        setError('No results — try again in 30s.')
      }
      setResults(all)
      setScanned(true)
    } catch (e) {
      setError(String(e))
    } finally {
      setScanning(false)
      setScanProgress('')
    }
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortAsc(a => !a)
    else { setSortKey(key); setSortAsc(false) }
  }

  const filtered = useMemo(() => {
    let base = filter === 'all' ? results : results.filter(r => r.strategyType === filter)
    if (flagFilter !== 'all') {
      base = base.filter(r => r.flags.includes(flagFilter))
    }
    return [...base].sort((a, b) => {
      const diff = (a[sortKey] as number) - (b[sortKey] as number)
      return sortAsc ? diff : -diff
    })
  }, [results, filter, flagFilter, sortKey, sortAsc])

  // Top 5 tickers by best score
  const top5 = useMemo(() => {
    if (results.length === 0) return []
    // Group by ticker, pick best score per ticker
    const byTicker = new Map<string, { bestScore: number; bestYield: number; avgIv: number; count: number; flagCount: number; price: number }>()
    for (const r of results) {
      const prev = byTicker.get(r.underlying)
      if (!prev) {
        byTicker.set(r.underlying, {
          bestScore: r.score,
          bestYield: r.annualizedYield,
          avgIv: r.iv,
          count: 1,
          flagCount: r.flags.length,
          price: r.stockPrice,
        })
      } else {
        if (r.score > prev.bestScore) { prev.bestScore = r.score; prev.bestYield = r.annualizedYield }
        prev.avgIv = (prev.avgIv * prev.count + r.iv) / (prev.count + 1)
        prev.count += 1
        prev.flagCount += r.flags.length
      }
    }
    return [...byTicker.entries()]
      .sort((a, b) => b[1].bestScore - a[1].bestScore)
      .slice(0, 5)
  }, [results])

  const sortIndicator = (key: SortKey) => sortKey === key ? (sortAsc ? ' ↑' : ' ↓') : ''

  const thStyle = (key?: SortKey): React.CSSProperties => ({
    padding: '10px 12px', fontSize: 10, fontWeight: 600,
    color: key && sortKey === key ? 'var(--accent)' : 'var(--text-4)',
    textAlign: 'right', cursor: key ? 'pointer' : 'default',
    userSelect: 'none', whiteSpace: 'nowrap', letterSpacing: '1.5px',
    textTransform: 'uppercase', background: 'var(--bg-surface)',
    borderBottom: '1px solid var(--border)',
  })

  const tdStyle: React.CSSProperties = {
    padding: '10px 12px', textAlign: 'right',
    fontFamily: 'IBM Plex Mono, monospace', fontSize: 13,
    color: 'var(--text-2)', borderBottom: '1px solid var(--border)',
  }

  return (
    <div style={{ padding: 20, height: '100%', display: 'flex', flexDirection: 'column', gap: 16, overflow: 'hidden' }}>

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Activity size={18} style={{ color: 'var(--accent)' }} />
          <span className="chakra" style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-1)', letterSpacing: '1px', textTransform: 'uppercase' }}>
            Options Scanner
          </span>
        </div>

        <button
          onClick={handleScan}
          disabled={scanning}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 7,
            padding: '7px 18px', fontSize: 13, fontWeight: 600,
            background: scanning ? 'var(--bg-elevated)' : 'var(--accent-dim)',
            border: `1px solid ${scanning ? 'var(--border)' : 'rgba(0,229,255,0.25)'}`,
            color: scanning ? 'var(--text-3)' : 'var(--accent)',
            cursor: scanning ? 'not-allowed' : 'pointer',
            fontFamily: "'Chakra Petch', sans-serif", letterSpacing: '1px',
            textTransform: 'uppercase',
          }}
        >
          <Scan size={13} style={{ animation: scanning ? 'spin 1.5s linear infinite' : 'none' }} />
          {scanning ? 'Scanning…' : 'Scan Now'}
        </button>

        {/* Data source toggle */}
        <div style={{ display: 'flex', gap: 2 }}>
          {(['cboe', 'yahoo'] as const).map(src => (
            <button key={src} onClick={() => setDataSource(src)} disabled={scanning} style={{
              padding: '5px 10px', fontSize: 10, fontWeight: 700,
              background: dataSource === src ? 'var(--accent-dim)' : 'transparent',
              border: `1px solid ${dataSource === src ? 'rgba(0,229,255,0.25)' : 'var(--border)'}`,
              color: dataSource === src ? 'var(--accent)' : 'var(--text-4)',
              cursor: scanning ? 'not-allowed' : 'pointer',
              fontFamily: "'Chakra Petch', sans-serif", letterSpacing: '1px',
              textTransform: 'uppercase',
            }}>
              {src === 'cboe' ? '⚡ CBOE' : '🐢 YAHOO'}
            </button>
          ))}
        </div>

        {scanning && (
          <span className="mono" style={{ fontSize: 12, color: 'var(--accent)', animation: 'pulse 2s infinite' }}>
            {scanProgress || 'Initializing…'}
          </span>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 5 }}>
          {tickers.map(sym => (
            <span key={sym} style={{
              padding: '2px 7px', fontSize: 11, fontWeight: 600,
              background: 'var(--bg-elevated)', border: '1px solid var(--border)',
              color: stocksHeld[sym] ? '#3b82f6' : 'var(--text-4)',
              fontFamily: 'IBM Plex Mono, monospace',
            }}>
              {sym}
            </span>
          ))}
        </div>
      </div>

      {/* ── Error ───────────────────────────────────────────────────────────── */}
      {error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#f43f5e', fontSize: 13 }}>
          <AlertCircle size={14} />{error}
        </div>
      )}

      {/* ── Top 5 Tickers ──────────────────────────────────────────────────── */}
      {top5.length > 0 && (
        <div style={{ display: 'flex', gap: 10 }}>
          {top5.map(([sym, d], i) => (
            <div key={sym} className="stat-card" style={{
              padding: '12px 16px', flex: '1 1 0', minWidth: 0,
              borderColor: i === 0 ? 'rgba(0,229,255,0.25)' : 'var(--border)',
              position: 'relative', overflow: 'hidden',
            }}>
              {/* Rank badge */}
              <div style={{
                position: 'absolute', top: 6, right: 8,
                fontSize: 10, fontWeight: 700, color: 'var(--text-5)',
                fontFamily: "'Chakra Petch', sans-serif",
              }}>
                #{i + 1}
              </div>
              {/* Ticker */}
              <div style={{
                fontFamily: "'Chakra Petch', sans-serif", fontSize: 18, fontWeight: 700,
                color: i === 0 ? 'var(--accent)' : 'var(--text-1)',
                letterSpacing: '1px', marginBottom: 4,
              }}>
                {sym}
              </div>
              {/* Price */}
              <div className="mono" style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 8 }}>
                ${d.price.toFixed(2)}
              </div>
              {/* Metrics */}
              <div style={{ display: 'flex', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 8, color: 'var(--text-4)', letterSpacing: '1.5px', fontWeight: 600, marginBottom: 2 }}>SCORE</div>
                  <div className="mono" style={{ fontSize: 15, fontWeight: 700, color: scoreColor(d.bestScore) }}>{d.bestScore}</div>
                </div>
                <div>
                  <div style={{ fontSize: 8, color: 'var(--text-4)', letterSpacing: '1.5px', fontWeight: 600, marginBottom: 2 }}>YIELD</div>
                  <div className="mono" style={{ fontSize: 15, fontWeight: 700, color: '#10b981' }}>{d.bestYield.toFixed(0)}%</div>
                </div>
                <div>
                  <div style={{ fontSize: 8, color: 'var(--text-4)', letterSpacing: '1.5px', fontWeight: 600, marginBottom: 2 }}>IV</div>
                  <div className="mono" style={{ fontSize: 15, color: 'var(--text-2)' }}>{d.avgIv.toFixed(0)}%</div>
                </div>
              </div>
              {/* Bottom */}
              <div className="mono" style={{ fontSize: 10, color: 'var(--text-4)', marginTop: 8, display: 'flex', justifyContent: 'space-between' }}>
                <span>{d.count} contracts</span>
                {d.flagCount > 0 && <span style={{ color: 'var(--accent)' }}>{d.flagCount} flags</span>}
              </div>
              {/* Score bar */}
              <div style={{ marginTop: 6, height: 2, background: 'var(--border)', borderRadius: 1, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${d.bestScore}%`, background: scoreColor(d.bestScore), borderRadius: 1 }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Filters ─────────────────────────────────────────────────────────── */}
      {scanned && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          {/* Strategy filter */}
          <div style={{ display: 'flex', gap: 4 }}>
            {(['all', 'csp', 'covered_call'] as FilterType[]).map(f => (
              <button key={f} onClick={() => setFilter(f)} style={{
                padding: '4px 12px', fontSize: 11, fontWeight: 600,
                background: filter === f ? 'var(--accent-dim)' : 'transparent',
                border: `1px solid ${filter === f ? 'rgba(0,229,255,0.25)' : 'var(--border)'}`,
                color: filter === f ? 'var(--accent)' : 'var(--text-4)',
                cursor: 'pointer', fontFamily: "'Chakra Petch', sans-serif",
                letterSpacing: '1px', textTransform: 'uppercase',
              }}>
                {f === 'all' ? 'ALL' : STRATEGY_LABEL[f as ScanResult['strategyType']]}
              </button>
            ))}
          </div>

          {/* Flag filter */}
          <div style={{ display: 'flex', gap: 4 }}>
            <button onClick={() => setFlagFilter('all')} style={{
              padding: '4px 10px', fontSize: 11, fontWeight: 600,
              background: flagFilter === 'all' ? 'var(--bg-active)' : 'transparent',
              border: `1px solid ${flagFilter === 'all' ? 'var(--border-light)' : 'var(--border)'}`,
              color: flagFilter === 'all' ? 'var(--text-2)' : 'var(--text-4)',
              cursor: 'pointer', fontFamily: "'Chakra Petch', sans-serif",
              letterSpacing: '1px', textTransform: 'uppercase',
            }}>
              ALL FLAGS
            </button>
            {(Object.keys(FLAG_CONFIG) as ScanFlag[]).map(f => {
              const cfg = FLAG_CONFIG[f]
              const count = results.filter(r => r.flags.includes(f)).length
              return (
                <button key={f} onClick={() => setFlagFilter(flagFilter === f ? 'all' : f)} style={{
                  padding: '4px 10px', fontSize: 11, fontWeight: 600,
                  background: flagFilter === f ? `${cfg.color}18` : 'transparent',
                  border: `1px solid ${flagFilter === f ? `${cfg.color}44` : 'var(--border)'}`,
                  color: flagFilter === f ? cfg.color : 'var(--text-4)',
                  cursor: 'pointer', fontFamily: "'Chakra Petch', sans-serif",
                  letterSpacing: '0.5px',
                }}>
                  {cfg.label} ({count})
                </button>
              )
            })}
          </div>

          <span className="mono" style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-4)' }}>
            {filtered.length} / {results.length} results
          </span>
        </div>
      )}

      {/* ── Empty States ────────────────────────────────────────────────────── */}
      {scanning && !scanned && (
        <div style={{ textAlign: 'center', paddingTop: 60 }}>
          <div className="chakra" style={{ fontSize: 16, color: 'var(--text-2)', letterSpacing: '1px' }}>
            SCANNING {tickers.length} TICKERS
          </div>
          <div className="mono" style={{ fontSize: 12, color: 'var(--text-4)', marginTop: 8 }}>
            {dataSource === 'cboe' ? 'Parallel fetch via CBOE delayed quotes' : 'Pacing requests to avoid rate limits · ~2s per ticker'}
          </div>
          <div style={{
            width: 200, height: 3, background: 'var(--border)', borderRadius: 2,
            margin: '16px auto', overflow: 'hidden',
          }}>
            <div style={{
              height: '100%', background: 'var(--accent)',
              animation: 'pulse 1.5s ease-in-out infinite',
              width: '60%', borderRadius: 2,
            }} />
          </div>
        </div>
      )}

      {!scanning && !scanned && !error && (
        <div style={{ textAlign: 'center', paddingTop: 80 }}>
          <Activity size={32} style={{ color: 'var(--text-5)', marginBottom: 12 }} />
          <div className="chakra" style={{ fontSize: 16, color: 'var(--text-2)', letterSpacing: '1px' }}>
            OPTIONS SCANNER
          </div>
          <div className="mono" style={{ fontSize: 12, color: 'var(--text-4)', marginTop: 8, lineHeight: 1.8 }}>
            Scan {tickers.length} tickers for CSP & CC opportunities<br />
            Filters: Delta 0.08–0.55 · DTE 7–60 · Volume &amp; IV rank<br />
            <span style={{ color: '#3b82f6' }}>Blue tickers</span> = shares held (eligible for covered calls)
          </div>
          <button
            onClick={handleScan}
            style={{
              marginTop: 20, padding: '10px 28px', fontSize: 14, fontWeight: 600,
              background: 'var(--accent-dim)', border: '1px solid rgba(0,229,255,0.25)',
              color: 'var(--accent)', cursor: 'pointer',
              fontFamily: "'Chakra Petch', sans-serif", letterSpacing: '1.5px',
              textTransform: 'uppercase',
            }}
          >
            <Scan size={14} style={{ verticalAlign: -2, marginRight: 8 }} />
            START SCAN
          </button>
        </div>
      )}

      {scanned && filtered.length === 0 && !scanning && (
        <div style={{ textAlign: 'center', paddingTop: 60, color: 'var(--text-3)', fontSize: 14 }}>
          No opportunities matched current filters.
        </div>
      )}

      {/* ── Results Table ───────────────────────────────────────────────────── */}
      {filtered.length > 0 && (
        <div className="panel" style={{ overflow: 'auto', flex: 1, minHeight: 0, borderRadius: 8 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ ...thStyle(), textAlign: 'left', paddingLeft: 14 }}>TICKER</th>
                <th style={{ ...thStyle(), textAlign: 'left' }}>TYPE</th>
                <th style={{ ...thStyle(), textAlign: 'left' }}>FLAGS</th>
                <th style={thStyle()}>PRICE</th>
                <th style={thStyle()}>STRIKE</th>
                <th style={thStyle()}>EXPIRY</th>
                <th style={thStyle('dte')} onClick={() => toggleSort('dte')}>DTE{sortIndicator('dte')}</th>
                <th style={thStyle('delta')} onClick={() => toggleSort('delta')}>Δ{sortIndicator('delta')}</th>
                <th style={thStyle('gamma')} onClick={() => toggleSort('gamma')}>Γ{sortIndicator('gamma')}</th>
                <th style={thStyle('theta')} onClick={() => toggleSort('theta')}>Θ{sortIndicator('theta')}</th>
                <th style={thStyle('iv')} onClick={() => toggleSort('iv')}>IV%{sortIndicator('iv')}</th>
                <th style={thStyle('ivRank')} onClick={() => toggleSort('ivRank')}>IVR{sortIndicator('ivRank')}</th>
                <th style={thStyle()}>BID/ASK</th>
                <th style={thStyle('volume')} onClick={() => toggleSort('volume')}>VOL{sortIndicator('volume')}</th>
                <th style={thStyle('openInterest')} onClick={() => toggleSort('openInterest')}>OI{sortIndicator('openInterest')}</th>
                <th style={thStyle('volumeOiRatio')} onClick={() => toggleSort('volumeOiRatio')}>V/OI{sortIndicator('volumeOiRatio')}</th>
                <th style={thStyle('annualizedYield')} onClick={() => toggleSort('annualizedYield')}>
                  YIELD{sortIndicator('annualizedYield')}
                </th>
                <th style={thStyle('score')} onClick={() => toggleSort('score')}>
                  SCORE{sortIndicator('score')}
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr key={i} style={{
                  background: i % 2 ? 'var(--bg-surface)' : 'transparent',
                  transition: 'background 0.1s',
                }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-elevated)' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = i % 2 ? 'var(--bg-surface)' : 'transparent' }}
                >
                  {/* Ticker */}
                  <td style={{ ...tdStyle, textAlign: 'left', paddingLeft: 14, fontWeight: 700, color: 'var(--text-1)', fontSize: 13 }}>
                    {r.underlying}
                  </td>

                  {/* Type badge */}
                  <td style={{ ...tdStyle, textAlign: 'left' }}>
                    <span style={{
                      padding: '2px 6px', fontSize: 10, fontWeight: 700,
                      background: `${STRATEGY_COLOR[r.strategyType]}15`,
                      border: `1px solid ${STRATEGY_COLOR[r.strategyType]}40`,
                      color: STRATEGY_COLOR[r.strategyType],
                      fontFamily: "'Chakra Petch', sans-serif", letterSpacing: '0.5px',
                    }}>
                      {STRATEGY_LABEL[r.strategyType]}
                    </span>
                  </td>

                  {/* Flags */}
                  <td style={{ ...tdStyle, textAlign: 'left' }}>
                    <div style={{ display: 'flex', gap: 3 }}>
                      {r.flags.map(f => {
                        const cfg = FLAG_CONFIG[f]
                        return (
                          <span key={f} style={{
                            padding: '1px 5px', fontSize: 9, fontWeight: 700,
                            background: `${cfg.color}15`, border: `1px solid ${cfg.color}35`,
                            color: cfg.color, letterSpacing: '0.3px',
                            fontFamily: "'Chakra Petch', sans-serif",
                          }}>
                            {cfg.label}
                          </span>
                        )
                      })}
                    </div>
                  </td>

                  {/* Price */}
                  <td style={{ ...tdStyle, color: 'var(--text-3)', fontSize: 12 }}>
                    ${r.stockPrice.toFixed(0)}
                  </td>

                  {/* Strike */}
                  <td style={{ ...tdStyle, color: 'var(--text-1)' }}>
                    ${r.strike.toLocaleString()}
                  </td>

                  {/* Expiry */}
                  <td style={{ ...tdStyle, color: 'var(--text-3)', fontSize: 12 }}>
                    {fmtExpiry(r.expiry)}
                  </td>

                  {/* DTE */}
                  <td style={{ ...tdStyle, color: r.dte <= 14 ? '#10b981' : 'var(--text-2)' }}>
                    {r.dte}
                  </td>

                  {/* Delta */}
                  <td style={{ ...tdStyle, color: deltaColor(r.delta) }}>
                    {r.delta.toFixed(2)}
                  </td>

                  {/* Gamma */}
                  <td style={{ ...tdStyle, color: 'var(--text-3)', fontSize: 12 }}>
                    {r.gamma.toFixed(4)}
                  </td>

                  {/* Theta */}
                  <td style={{ ...tdStyle, color: r.theta < 0 ? '#10b981' : '#f43f5e', fontSize: 12 }}>
                    {r.theta.toFixed(2)}
                  </td>

                  {/* IV */}
                  <td style={{ ...tdStyle }}>
                    {r.iv.toFixed(0)}%
                  </td>

                  {/* IV Rank */}
                  <td style={tdStyle}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
                      <div style={{ width: 28, height: 3, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
                        <div style={{
                          height: '100%', width: `${r.ivRank}%`,
                          background: r.ivRank >= 75 ? '#a855f7' : r.ivRank >= 50 ? '#f59e0b' : 'var(--text-4)',
                          borderRadius: 2,
                        }} />
                      </div>
                      <span style={{ fontSize: 12, color: r.ivRank >= 75 ? '#a855f7' : 'var(--text-3)' }}>
                        {r.ivRank}
                      </span>
                    </div>
                  </td>

                  {/* Bid/Ask */}
                  <td style={{ ...tdStyle, fontSize: 12 }}>
                    <span style={{ color: 'var(--text-2)' }}>${r.bid.toFixed(2)}</span>
                    <span style={{ color: 'var(--text-5)', margin: '0 2px' }}>/</span>
                    <span style={{ color: 'var(--text-3)' }}>${r.ask.toFixed(2)}</span>
                  </td>

                  {/* Volume */}
                  <td style={{ ...tdStyle, color: r.flags.includes('HIGH_VOL') ? 'var(--accent)' : 'var(--text-2)', fontWeight: r.flags.includes('HIGH_VOL') ? 600 : 400 }}>
                    {fmtK(r.volume)}
                  </td>

                  {/* OI */}
                  <td style={{ ...tdStyle, color: 'var(--text-3)' }}>
                    {fmtK(r.openInterest)}
                  </td>

                  {/* V/OI */}
                  <td style={{ ...tdStyle, color: r.volumeOiRatio > 1 ? '#f59e0b' : 'var(--text-3)', fontWeight: r.volumeOiRatio > 1 ? 600 : 400 }}>
                    {r.volumeOiRatio.toFixed(2)}
                  </td>

                  {/* Yield */}
                  <td style={{ ...tdStyle, color: '#10b981', fontWeight: 600 }}>
                    {r.annualizedYield.toFixed(0)}%
                  </td>

                  {/* Score */}
                  <td style={tdStyle}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
                      <div style={{ width: 36, height: 3, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
                        <div style={{
                          height: '100%', width: `${r.score}%`,
                          background: scoreColor(r.score),
                          borderRadius: 2,
                        }} />
                      </div>
                      <span style={{
                        fontFamily: "'Chakra Petch', sans-serif", fontWeight: 700,
                        fontSize: 13, color: scoreColor(r.score), minWidth: 24, textAlign: 'right',
                      }}>
                        {r.score}
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Footer */}
          <div style={{
            padding: '8px 14px', color: 'var(--text-4)', fontSize: 11,
            fontFamily: 'IBM Plex Mono, monospace',
            borderTop: '1px solid var(--border)',
            display: 'flex', justifyContent: 'space-between',
          }}>
            <span>{filtered.length} results · Δ 0.08–0.55 · DTE 7–60</span>
            <span>Score = Yield 30% + Vol 20% + Delta 20% + IV 20% + Spread 10%</span>
          </div>
        </div>
      )}
    </div>
  )
}
