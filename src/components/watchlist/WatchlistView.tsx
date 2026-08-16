/**
 * Watchlist — the single place a user builds their ticker list, shown as a
 * live quote table (the usual columns: last price, change, volume, 52-week
 * range, RSI, next earnings). Feeds both the Scanner (which tickers get
 * scanned) and the Calendar (which tickers' earnings dates get pulled), so
 * adding AAPL here is enough to see it in both places instead of typing it
 * into each separately.
 */
import { useEffect, useMemo, useState } from 'react'
import { ListChecks, Plus, X, RefreshCw } from 'lucide-react'
import { fetchQuotes, type Quote } from '../../services/quotes'
import { fetchRSI, type RsiData } from '../../services/rsi'
import { fetchEarningsDates } from '../../services/earnings'

function fmt$(n: number | null): string {
  if (n == null) return '—'
  return `$${n.toFixed(2)}`
}
function fmtVol(n: number | null): string {
  if (n == null) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}
function todayYMD(): string { return new Date().toISOString().slice(0, 10) }
function nextEarnings(dates: string[] | undefined): string | null {
  if (!dates?.length) return null
  const today = todayYMD()
  const upcoming = dates.filter(d => d >= today).sort()
  return upcoming[0] ?? null
}
function fmtEarnings(d: string): string {
  const [, m, day] = d.split('-')
  const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${MONTH_ABBR[parseInt(m) - 1]} ${parseInt(day)}`
}
function rsiColor(rsi: number | null): string {
  if (rsi == null) return 'var(--text-4)'
  if (rsi >= 70) return '#ef4444'
  if (rsi <= 30) return '#10b981'
  return 'var(--text-2)'
}

export default function WatchlistView({ tickers, onAdd, onRemove }: {
  tickers: string[]
  onAdd: (symbol: string) => void
  onRemove: (symbol: string) => void
}) {
  const [input, setInput] = useState('')
  const [quotes, setQuotes] = useState<Record<string, Quote>>({})
  const [rsi, setRsi] = useState<Record<string, RsiData>>({})
  const [earnings, setEarnings] = useState<Record<string, string[]>>({})
  const [loading, setLoading] = useState(false)

  const tickersKey = useMemo(() => [...tickers].sort().join(','), [tickers])

  async function load() {
    if (tickers.length === 0) { setQuotes({}); setRsi({}); setEarnings({}); return }
    setLoading(true)
    const [q, r, e] = await Promise.all([
      fetchQuotes(tickers),
      fetchRSI(tickers),
      fetchEarningsDates(tickers),
    ])
    setQuotes(q); setRsi(r); setEarnings(e)
    setLoading(false)
  }
  useEffect(() => { load() }, [tickersKey]) // eslint-disable-line react-hooks/exhaustive-deps

  function submit() {
    if (input.trim()) { onAdd(input); setInput('') }
  }

  return (
    <div className="jr-root">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <ListChecks size={16} style={{ color: 'var(--accent)' }} />
        <div className="cc-section-title" style={{ padding: 0 }}>Watchlist</div>
        <button onClick={load} disabled={loading} style={{
          marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px',
          fontSize: 11, fontWeight: 600, background: 'var(--accent-dim)', border: '1px solid var(--accent-border)',
          color: 'var(--accent)', cursor: loading ? 'not-allowed' : 'pointer', borderRadius: 4,
        }}>
          <RefreshCw size={12} style={{ animation: loading ? 'spin 1.5s linear infinite' : 'none' }} />
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-4)', marginTop: -8 }}>
        Tickers you add here populate the Scanner and show earnings dates on every account's Calendar.
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value.toUpperCase())}
          onKeyDown={e => e.key === 'Enter' && submit()}
          placeholder="Add ticker (e.g. AAPL)"
          autoCapitalize="characters" autoCorrect="off" autoComplete="off" spellCheck={false}
          style={{ width: 200, padding: '7px 10px', fontSize: 14, borderRadius: 5, border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-1)' }}
        />
        <button onClick={submit} style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', fontSize: 12, fontWeight: 600,
          background: 'var(--accent-dim)', border: '1px solid var(--accent-border)', color: 'var(--accent)',
          cursor: 'pointer', borderRadius: 5,
        }}>
          <Plus size={13} /> Add
        </button>
      </div>

      <div className="panel" style={{ padding: 0, flex: 1, minHeight: 0, overflow: 'auto' }}>
        <table className="trade-table" style={{ width: '100%', fontSize: 12 }}>
          <thead>
            <tr>
              <th>Ticker</th>
              <th style={{ textAlign: 'right' }}>Last</th>
              <th style={{ textAlign: 'right' }}>Change</th>
              <th style={{ textAlign: 'right' }}>Change %</th>
              <th style={{ textAlign: 'right' }}>Volume</th>
              <th style={{ textAlign: 'right' }}>Avg Vol</th>
              <th style={{ textAlign: 'right' }}>52W High</th>
              <th style={{ textAlign: 'right' }}>52W Low</th>
              <th style={{ textAlign: 'right' }}>RSI(14)</th>
              <th style={{ textAlign: 'right' }}>Next Earnings</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {tickers.length === 0 && (
              <tr><td colSpan={11} style={{ padding: '16px 18px', color: 'var(--text-4)' }}>No tickers yet — add one above.</td></tr>
            )}
            {tickers.map(sym => {
              const q = quotes[sym]
              const change = q?.prevClose ? q.price - q.prevClose : null
              const changePct = q?.prevClose ? (change! / q.prevClose) * 100 : null
              const ne = nextEarnings(earnings[sym])
              const r = rsi[sym]?.rsi ?? null
              return (
                <tr key={sym}>
                  <td className="mono" style={{ fontWeight: 700, color: 'var(--text-1)', whiteSpace: 'nowrap' }}>{sym}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{q ? fmt$(q.price) : loading ? '…' : '—'}</td>
                  <td className={`mono ${change != null && change > 0 ? 'pos' : change != null && change < 0 ? 'neg' : 'neu'}`} style={{ textAlign: 'right' }}>
                    {change != null ? `${change > 0 ? '+' : ''}${change.toFixed(2)}` : '—'}
                  </td>
                  <td className={`mono ${changePct != null && changePct > 0 ? 'pos' : changePct != null && changePct < 0 ? 'neg' : 'neu'}`} style={{ textAlign: 'right' }}>
                    {changePct != null ? `${changePct > 0 ? '+' : ''}${changePct.toFixed(2)}%` : '—'}
                  </td>
                  <td className="mono" style={{ textAlign: 'right' }}>{fmtVol(q?.volume ?? null)}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{fmtVol(q?.avgVolume ?? null)}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{fmt$(q?.high52 ?? null)}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{fmt$(q?.low52 ?? null)}</td>
                  <td className="mono" style={{ textAlign: 'right', color: rsiColor(r), fontWeight: 600 }}>{r != null ? r.toFixed(0) : '—'}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>
                    {ne ? <span title={ne} style={{ padding: '1px 5px', fontSize: 10, fontWeight: 700, background: '#F0B42915', border: '1px solid #F0B42940', color: '#F0B429' }}>{fmtEarnings(ne)}</span> : '—'}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button onClick={() => onRemove(sym)} title="Remove" style={{
                      background: 'none', border: '1px solid var(--border)', color: 'var(--text-4)',
                      cursor: 'pointer', padding: '3px 6px', borderRadius: 4, display: 'inline-flex',
                    }}>
                      <X size={11} />
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
