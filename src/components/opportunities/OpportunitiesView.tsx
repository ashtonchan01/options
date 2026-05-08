import { useState, useMemo, useEffect } from 'react'
import { Scan, AlertCircle } from 'lucide-react'
import type { AppState, ScanResult } from '../../types'
import { scanTicker } from '../../services/yahoo'

interface Props { state: AppState }

type FilterType = 'all' | 'csp' | 'covered_call'
type SortKey = 'score' | 'annualizedYield' | 'delta' | 'dte' | 'iv'

const STRATEGY_LABEL: Record<ScanResult['strategyType'], string> = {
  csp: 'CSP',
  covered_call: 'CC',
}

const STRATEGY_COLOR: Record<ScanResult['strategyType'], string> = {
  csp: '#f43f5e',
  covered_call: '#3b82f6',
}

function fmtExpiry(s: string): string {
  const m = s.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (!m) return s
  return new Date(`${m[1]}-${m[2]}-${m[3]}`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function deltaColor(d: number): string {
  const abs = Math.abs(d)
  if (abs < 0.20) return '#9198AE'
  if (abs > 0.35) return '#f59e0b'
  return '#10b981'
}

const colHdr: React.CSSProperties = {
  padding: '10px 14px', fontSize: 11, fontWeight: 600,
  color: '#9198AE', textAlign: 'right', cursor: 'pointer',
  userSelect: 'none', whiteSpace: 'nowrap', letterSpacing: '0.06em',
}

export default function OpportunitiesView({ state }: Props) {
  const [results, setResults]   = useState<ScanResult[]>([])
  const [scanning, setScanning] = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [filter, setFilter]     = useState<FilterType>('all')
  const [sortKey, setSortKey]   = useState<SortKey>('annualizedYield')
  const [sortAsc, setSortAsc]   = useState(false)
  const [scanned, setScanned]   = useState(false)

  const stocksHeld = useMemo(() => {
    const map: Record<string, number> = {}
    for (const p of state.sync.positions) {
      if (p.assetClass === 'STK') map[p.symbol] = (map[p.symbol] ?? 0) + p.quantity
    }
    return map
  }, [state.sync.positions])

  const tickers = useMemo(() => {
    const set = new Set<string>()
    for (const p of state.sync.positions) {
      const sym = p.underlyingSymbol ?? (p.assetClass === 'STK' ? p.symbol : null)
      if (sym) set.add(sym)
    }
    if (set.size === 0) ['MSTR', 'NVDA', 'TSLA', 'PLTR', 'ALAB'].forEach(s => set.add(s))
    return [...set].sort()
  }, [state.sync.positions])

  async function handleScan() {
    setScanning(true)
    setError(null)
    setResults([])
    try {
      const all: ScanResult[] = []
      for (const sym of tickers) {
        try {
          const res = await scanTicker(sym, stocksHeld[sym] ?? 0)
          all.push(...res)
        } catch (e) {
          console.warn(`[Scan] ${sym} failed:`, e)
        }
      }
      if (all.length === 0 && tickers.length > 0) {
        setError('No results — Yahoo API may be rate-limiting. Try again in a moment.')
      }
      setResults(all)
      setScanned(true)
    } catch (e) {
      setError(String(e))
    } finally {
      setScanning(false)
    }
  }

  // Auto-scan on mount
  useEffect(() => {
    if (!scanned && !scanning && tickers.length > 0) {
      handleScan()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortAsc(a => !a)
    else { setSortKey(key); setSortAsc(false) }
  }

  const filtered = useMemo(() => {
    const base = filter === 'all' ? results : results.filter(r => r.strategyType === filter)
    return [...base].sort((a, b) => {
      const diff = (a[sortKey] as number) - (b[sortKey] as number)
      return sortAsc ? diff : -diff
    })
  }, [results, filter, sortKey, sortAsc])

  const sortIndicator = (key: SortKey) => sortKey === key ? (sortAsc ? ' ↑' : ' ↓') : ''

  return (
    <div style={{ padding: 16, height: '100%', display: 'flex', flexDirection: 'column', gap: 12, overflow: 'hidden' }}>

      {/* ── Toolbar ─────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>

        <button
          onClick={handleScan}
          disabled={scanning}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 7,
            padding: '8px 18px', fontSize: 13, fontWeight: 600,
            background: '#171C30', border: '1px solid #1E2540',
            color: scanning ? '#5D6580' : '#EAEDF3',
            cursor: scanning ? 'not-allowed' : 'pointer',
            fontFamily: 'inherit', flexShrink: 0,
          }}
        >
          <Scan size={14} style={{ animation: scanning ? 'spin 1.5s linear infinite' : 'none' }} />
          {scanning ? 'Scanning…' : 'Scan Now'}
        </button>

        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {tickers.map(sym => (
            <span key={sym} style={{
              padding: '3px 8px', fontSize: 11, fontWeight: 600,
              background: '#171C30', border: '1px solid #1E2540',
              color: stocksHeld[sym] ? '#3b82f6' : '#5D6580',
              fontFamily: 'IBM Plex Mono, monospace',
            }}>
              {sym}{stocksHeld[sym] ? ` ×${stocksHeld[sym]}` : ''}
            </span>
          ))}
        </div>

        {scanned && (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
            {(['all', 'csp', 'covered_call'] as FilterType[]).map(f => (
              <button key={f} onClick={() => setFilter(f)} style={{
                padding: '5px 12px', fontSize: 11, fontWeight: 600,
                background: filter === f ? '#1A1F35' : 'transparent',
                border: `1px solid ${filter === f ? '#2A3250' : '#1E2540'}`,
                color: filter === f ? '#EAEDF3' : '#5D6580',
                cursor: 'pointer', fontFamily: 'inherit',
              }}>
                {f === 'all' ? 'ALL' : STRATEGY_LABEL[f as ScanResult['strategyType']]}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Error ───────────────────────────────────────────────────────────── */}
      {error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#f43f5e', fontSize: 12 }}>
          <AlertCircle size={14} />{error}
        </div>
      )}

      {/* ── Loading ─────────────────────────────────────────────────────────── */}
      {scanning && (
        <div style={{ color: '#9198AE', fontSize: 13, paddingTop: 40, textAlign: 'center' }}>
          Scanning {tickers.length} tickers for options with annualized yield...
        </div>
      )}

      {/* ── Empty ───────────────────────────────────────────────────────────── */}
      {!scanning && !scanned && !error && (
        <div style={{ color: '#9198AE', fontSize: 13, paddingTop: 60, textAlign: 'center' }}>
          Press <span style={{ color: '#EAEDF3' }}>Scan Now</span> to fetch live option chains across your watchlist.
          <br />
          <span style={{ fontSize: 11, color: '#5D6580', marginTop: 6, display: 'block' }}>
            Blue tickers = shares held (eligible for covered calls)
          </span>
        </div>
      )}

      {scanned && filtered.length === 0 && !scanning && (
        <div style={{ color: '#9198AE', fontSize: 13, paddingTop: 40, textAlign: 'center' }}>
          No opportunities matched current filters (delta 0.12–0.45, DTE 14–60).
        </div>
      )}

      {/* ── Table ───────────────────────────────────────────────────────────── */}
      {filtered.length > 0 && (
        <div style={{ background: '#131726', border: '1px solid #1E2540', borderRadius: 10, overflow: 'auto', flex: 1, minHeight: 0 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #1E2540' }}>
                <th style={{ ...colHdr, textAlign: 'left', paddingLeft: 16 }}>TICKER</th>
                <th style={{ ...colHdr, textAlign: 'left' }}>TYPE</th>
                <th style={{ ...colHdr }}>STRIKE</th>
                <th style={{ ...colHdr }}>EXPIRY</th>
                <th style={{ ...colHdr }} onClick={() => toggleSort('dte')}>DTE{sortIndicator('dte')}</th>
                <th style={{ ...colHdr }} onClick={() => toggleSort('delta')}>DELTA{sortIndicator('delta')}</th>
                <th style={{ ...colHdr }} onClick={() => toggleSort('iv')}>IV%{sortIndicator('iv')}</th>
                <th style={{ ...colHdr }}>BID</th>
                <th style={{ ...colHdr }}>MID</th>
                <th style={{ ...colHdr, color: sortKey === 'annualizedYield' ? '#EAEDF3' : '#5D6580' }} onClick={() => toggleSort('annualizedYield')}>
                  YIELD/YR{sortIndicator('annualizedYield')}
                </th>
                <th style={{ ...colHdr, color: sortKey === 'score' ? '#EAEDF3' : '#5D6580' }} onClick={() => toggleSort('score')}>
                  SCORE{sortIndicator('score')}
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #1A1F35', background: i % 2 ? '#0F1220' : 'transparent' }}>
                  <td style={{ padding: '10px 14px 10px 16px', fontWeight: 700, color: '#EAEDF3', fontFamily: 'IBM Plex Mono, monospace', fontSize: 12 }}>
                    {r.underlying}
                  </td>
                  <td style={{ padding: '10px 14px' }}>
                    <span style={{
                      padding: '2px 7px', fontSize: 10, fontWeight: 700,
                      background: `${STRATEGY_COLOR[r.strategyType]}18`,
                      border: `1px solid ${STRATEGY_COLOR[r.strategyType]}44`,
                      color: STRATEGY_COLOR[r.strategyType],
                      fontFamily: 'IBM Plex Mono, monospace',
                    }}>
                      {STRATEGY_LABEL[r.strategyType]}
                    </span>
                  </td>
                  <td style={{ padding: '10px 14px', textAlign: 'right', fontFamily: 'IBM Plex Mono, monospace', color: '#EAEDF3' }}>
                    ${r.strike.toLocaleString()}
                  </td>
                  <td style={{ padding: '10px 14px', textAlign: 'right', fontFamily: 'IBM Plex Mono, monospace', color: '#9198AE', fontSize: 12 }}>
                    {fmtExpiry(r.expiry)}
                  </td>
                  <td style={{ padding: '10px 14px', textAlign: 'right', fontFamily: 'IBM Plex Mono, monospace', color: '#9198AE' }}>
                    {r.dte}
                  </td>
                  <td style={{ padding: '10px 14px', textAlign: 'right', fontFamily: 'IBM Plex Mono, monospace', color: deltaColor(r.delta) }}>
                    {r.delta.toFixed(2)}
                  </td>
                  <td style={{ padding: '10px 14px', textAlign: 'right', fontFamily: 'IBM Plex Mono, monospace', color: '#9198AE' }}>
                    {r.iv.toFixed(0)}%
                  </td>
                  <td style={{ padding: '10px 14px', textAlign: 'right', fontFamily: 'IBM Plex Mono, monospace', color: '#9198AE' }}>
                    ${r.bid.toFixed(2)}
                  </td>
                  <td style={{ padding: '10px 14px', textAlign: 'right', fontFamily: 'IBM Plex Mono, monospace', color: '#EAEDF3' }}>
                    ${r.mid.toFixed(2)}
                  </td>
                  <td style={{ padding: '10px 14px', textAlign: 'right', fontFamily: 'IBM Plex Mono, monospace', color: '#10b981', fontWeight: 600 }}>
                    {r.annualizedYield.toFixed(0)}%
                  </td>
                  <td style={{ padding: '10px 14px', textAlign: 'right' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
                      <div style={{ width: 40, height: 3, background: '#1E2540', borderRadius: 2, overflow: 'hidden' }}>
                        <div style={{
                          height: '100%', width: `${Math.min(r.score * 100, 100)}%`,
                          background: r.score > 0.6 ? '#10b981' : r.score > 0.3 ? '#f59e0b' : '#5D6580',
                          borderRadius: 2,
                        }} />
                      </div>
                      <span style={{ fontFamily: 'IBM Plex Mono, monospace', color: '#9198AE', fontSize: 11, minWidth: 28, textAlign: 'right' }}>
                        {(r.score * 100).toFixed(0)}
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ padding: '8px 16px', color: '#5D6580', fontSize: 11, fontFamily: 'IBM Plex Mono, monospace', borderTop: '1px solid #1E2540' }}>
            {filtered.length} results · sorted by annual yield · delta 0.12–0.45 · DTE 14–60
          </div>
        </div>
      )}
    </div>
  )
}
