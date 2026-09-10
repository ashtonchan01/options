/**
 * Dashboard widget version of the Watchlist page's own live quote table
 * (Last, Change, Volume, 52-week range, RSI, Next Earnings + mean-reversion
 * Signal) — scoped to just the active watchlist, with no list-management UI
 * (add/rename/delete lists), since this is a glanceable dashboard panel, not
 * the full Watchlist page.
 */
import { useEffect, useMemo, useState } from 'react'
import { ListChecks, RefreshCw } from 'lucide-react'
import { fetchQuotes, type Quote } from '../../../services/quotes'
import { fetchRSI, type RsiData } from '../../../services/rsi'
import { fetchEarningsDates } from '../../../services/earnings'
import { meanReversionSignal, SIGNAL_STYLE } from '../../../services/signal'

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

export default function WatchlistPanel({ tickers }: { tickers: string[] }) {
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

  return (
    <div className="dash-panel">
      <div className="dash-panel-header">
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <ListChecks size={13} style={{ color: 'var(--accent)' }} />
          Watchlist
        </span>
        <button onClick={load} disabled={loading} title="Refresh" style={{
          display: 'inline-flex', alignItems: 'center', background: 'none', border: 'none',
          color: 'var(--text-4)', cursor: loading ? 'not-allowed' : 'pointer', padding: 2,
        }}>
          <RefreshCw size={12} style={{ animation: loading ? 'spin 1.5s linear infinite' : 'none' }} />
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <table className="trade-table" style={{ width: '100%', fontSize: 11 }}>
          <thead>
            <tr>
              <th>Ticker</th>
              <th style={{ textAlign: 'center' }} title="Mean-reversion read on RSI(14): oversold (<=30) suggests a bounce, overbought (>=70) suggests a pullback">Signal</th>
              <th style={{ textAlign: 'right' }}>Last</th>
              <th style={{ textAlign: 'right' }}>Change %</th>
              <th style={{ textAlign: 'right' }}>Volume</th>
              <th style={{ textAlign: 'right' }}>RSI(14)</th>
              <th style={{ textAlign: 'right' }}>Next Earnings</th>
            </tr>
          </thead>
          <tbody>
            {tickers.length === 0 && (
              <tr><td colSpan={7} style={{ padding: '12px 14px', color: 'var(--text-4)' }}>No tickers in the active watchlist.</td></tr>
            )}
            {tickers.map(sym => {
              const q = quotes[sym]
              const change = q?.prevClose ? q.price - q.prevClose : null
              const changePct = q?.prevClose ? (change! / q.prevClose) * 100 : null
              const ne = nextEarnings(earnings[sym])
              const r = rsi[sym]?.rsi ?? null
              const signal = meanReversionSignal(r)
              return (
                <tr key={sym}>
                  <td className="mono" style={{ fontWeight: 700, color: 'var(--text-1)', whiteSpace: 'nowrap' }}>{sym}</td>
                  <td style={{ textAlign: 'center' }}>
                    {signal ? (
                      <span style={{
                        display: 'inline-block', padding: '1px 6px', fontSize: 9, fontWeight: 700,
                        letterSpacing: '0.03em', borderRadius: 3,
                        color: SIGNAL_STYLE[signal].color, background: SIGNAL_STYLE[signal].bg,
                        border: `1px solid ${SIGNAL_STYLE[signal].border}`,
                      }}>
                        {SIGNAL_STYLE[signal].label}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="mono" style={{ textAlign: 'right' }}>{q ? fmt$(q.price) : loading ? '…' : '—'}</td>
                  <td className={`mono ${changePct != null && changePct > 0 ? 'pos' : changePct != null && changePct < 0 ? 'neg' : 'neu'}`} style={{ textAlign: 'right' }}>
                    {changePct != null ? `${changePct > 0 ? '+' : ''}${changePct.toFixed(2)}%` : '—'}
                  </td>
                  <td className="mono" style={{ textAlign: 'right' }}>{fmtVol(q?.volume ?? null)}</td>
                  <td className="mono" style={{ textAlign: 'right', color: rsiColor(r), fontWeight: 600 }}>{r != null ? r.toFixed(0) : '—'}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>
                    {ne ? <span title={ne} style={{ padding: '1px 5px', fontSize: 9, fontWeight: 700, background: '#F0B42915', border: '1px solid #F0B42940', color: '#F0B429' }}>{fmtEarnings(ne)}</span> : '—'}
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
