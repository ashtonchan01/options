/**
 * Trending tickers / top gainers / top losers / most active stocks —
 * mirrors the sidebar on Yahoo Finance's markets pages. Tab-switched
 * rather than four stacked lists, since each is a top-10 table and
 * showing all four at once would dwarf every other Dashboard panel.
 */
import { useEffect, useState } from 'react'
import { Flame } from 'lucide-react'
import { fetchMovers, type MoverQuote, type MoversData } from '../../../services/movers'

const REFRESH_MS = 5 * 60_000

const TABS: { key: keyof MoversData; label: string }[] = [
  { key: 'trending', label: 'Trending' },
  { key: 'gainers', label: 'Gainers' },
  { key: 'losers', label: 'Losers' },
  { key: 'actives', label: 'Most Active' },
]

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

export default function MarketMoversPanel() {
  const [data, setData] = useState<MoversData | null>(null)
  const [tab, setTab] = useState<keyof MoversData>('trending')

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

  const rows = data?.[tab] ?? []

  return (
    <div className="dash-panel">
      <div className="dash-panel-header" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Flame size={13} style={{ color: 'var(--accent)' }} />
        <span>Market Movers</span>
      </div>
      <div style={{ display: 'flex', gap: 4, padding: '2px 2px 6px', flexShrink: 0 }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{
              flex: 1, padding: '4px 0', fontSize: 10.5, fontWeight: 600, border: 'none', borderRadius: 4, cursor: 'pointer',
              background: tab === t.key ? 'var(--accent-dim)' : 'transparent',
              color: tab === t.key ? 'var(--accent)' : 'var(--text-4)',
            }}>
            {t.label}
          </button>
        ))}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '0 2px' }}>
        {!data ? (
          <div style={{ fontSize: 12, color: 'var(--text-4)', padding: '8px 2px' }}>Loading movers…</div>
        ) : rows.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text-4)', padding: '8px 2px' }}>No data</div>
        ) : rows.map(q => <MoverRow key={q.symbol} q={q} />)}
      </div>
    </div>
  )
}
