/**
 * Trending tickers / top gainers / top losers / most active stocks — four
 * separate widgets (mirroring the sidebar on Yahoo Finance's markets pages),
 * not one tab-switched panel, so each shows up as its own card on the
 * Dashboard the way the rest of the panels do. useMovers() shares a single
 * fetch/poll across all four instead of each panel hitting the API on its
 * own timer.
 */
import { useEffect, useState } from 'react'
import { Flame, TrendingUp, TrendingDown, Activity } from 'lucide-react'
import { fetchMovers, type MoverQuote, type MoversData } from '../../../services/movers'

const REFRESH_MS = 5 * 60_000

function fmtPrice(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtVolume(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return n.toLocaleString('en-US')
}

function MoverRow({ q }: { q: MoverQuote }) {
  const color = q.change >= 0 ? '#10b981' : '#f43f5e'
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 68px 64px 56px', gap: 6, alignItems: 'center', padding: '4px 2px', fontSize: 11.5 }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 700, color: 'var(--text-1)', fontFamily: 'Inter, sans-serif' }}>{q.symbol}</div>
        <div style={{ fontSize: 9.5, color: 'var(--text-4)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{q.name}</div>
      </div>
      <span style={{ textAlign: 'right', fontFamily: 'Inter, sans-serif', color: 'var(--text-2)' }}>{fmtPrice(q.price)}</span>
      <span style={{ textAlign: 'right', fontFamily: 'Inter, sans-serif', fontWeight: 600, color }}>
        {q.change >= 0 ? '+' : ''}{q.changePercent.toFixed(2)}%
      </span>
      <span style={{ textAlign: 'right', fontFamily: 'Inter, sans-serif', color: 'var(--text-4)', fontSize: 10.5 }}>
        {q.volume != null ? fmtVolume(q.volume) : '—'}
      </span>
    </div>
  )
}

/** Shared fetch/poll for all four mover widgets — one interval, one API
 * call, instead of each panel independently hitting /api/movers on its
 * own timer. */
export function useMovers(): MoversData | null {
  const [data, setData] = useState<MoversData | null>(null)
  useEffect(() => {
    let cancelled = false
    async function load() {
      const d = await fetchMovers()
      if (!cancelled) setData(d)
    }
    load()
    const id = setInterval(load, REFRESH_MS)
    return () => { cancelled = true; clearInterval(id) }
  }, [])
  return data
}

function MoverListPanel({ title, icon, rows }: { title: string; icon: React.ReactNode; rows: MoverQuote[] | undefined }) {
  return (
    <div className="dash-panel">
      <div className="dash-panel-header" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {icon}
        <span>{title}</span>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '0 2px' }}>
        {rows == null ? (
          <div style={{ fontSize: 12, color: 'var(--text-4)', padding: '8px 2px' }}>Loading…</div>
        ) : rows.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text-4)', padding: '8px 2px' }}>No data</div>
        ) : rows.map(q => <MoverRow key={q.symbol} q={q} />)}
      </div>
    </div>
  )
}

export function TrendingTickersPanel({ data }: { data: MoversData | null }) {
  return <MoverListPanel title="Trending Tickers" icon={<Flame size={13} style={{ color: 'var(--accent)' }} />} rows={data?.trending} />
}
export function TopGainersPanel({ data }: { data: MoversData | null }) {
  return <MoverListPanel title="Top Gainers" icon={<TrendingUp size={13} style={{ color: '#10b981' }} />} rows={data?.gainers} />
}
export function TopLosersPanel({ data }: { data: MoversData | null }) {
  return <MoverListPanel title="Top Losers" icon={<TrendingDown size={13} style={{ color: '#f43f5e' }} />} rows={data?.losers} />
}
export function MostActivePanel({ data }: { data: MoversData | null }) {
  return <MoverListPanel title="Most Active" icon={<Activity size={13} style={{ color: 'var(--accent)' }} />} rows={data?.actives} />
}
