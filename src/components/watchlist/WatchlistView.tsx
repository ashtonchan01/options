/**
 * Watchlist — multiple named ticker lists, each shown as a live quote table
 * (Last, Change, Volume, 52-week range, RSI, Next Earnings). Exactly one
 * list is "active" (starred) — that's the one whose tickers feed the
 * Scanner and the Calendar's earnings dates, so you can keep e.g. an
 * "Earnings Plays" list around without it flooding the Scanner unless you
 * switch to it.
 */
import { useEffect, useMemo, useState } from 'react'
import { ListChecks, Plus, X, RefreshCw, Star, Pencil, Trash2 } from 'lucide-react'
import type { Watchlist } from '../../store/watchlistStore'
import { fetchQuotes, type Quote } from '../../services/quotes'
import { fetchRSI, type RsiData } from '../../services/rsi'
import { fetchEarningsDates } from '../../services/earnings'
import { meanReversionSignal, SIGNAL_STYLE } from '../../services/signal'

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

export default function WatchlistView({ lists, activeId, onSetActive, onAddList, onRemoveList, onRenameList, onAddTicker, onRemoveTicker }: {
  lists: Watchlist[]
  activeId: string
  onSetActive: (id: string) => void
  onAddList: (name: string) => string
  onRemoveList: (id: string) => void
  onRenameList: (id: string, name: string) => void
  onAddTicker: (listId: string, symbol: string) => void
  onRemoveTicker: (listId: string, symbol: string) => void
}) {
  const [selectedId, setSelectedId] = useState<string>(lists[0]?.id ?? '')
  const [input, setInput] = useState('')
  const [addingList, setAddingList] = useState(false)
  const [newListName, setNewListName] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  useEffect(() => {
    if (!lists.some(l => l.id === selectedId)) setSelectedId(lists[0]?.id ?? '')
  }, [lists, selectedId])

  const selected = lists.find(l => l.id === selectedId) ?? null
  const tickers = selected?.tickers ?? []

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

  function submitTicker() {
    if (input.trim() && selected) { onAddTicker(selected.id, input); setInput('') }
  }

  function confirmAddList() {
    const name = newListName.trim()
    if (name) {
      const id = onAddList(name)
      setSelectedId(id)
    }
    setAddingList(false); setNewListName('')
  }

  function confirmRename() {
    const name = renameValue.trim()
    if (renamingId && name) onRenameList(renamingId, name)
    setRenamingId(null); setRenameValue('')
  }

  return (
    <div className="jr-root">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <ListChecks size={16} style={{ color: 'var(--accent)' }} />
        <div className="cc-section-title" style={{ padding: 0 }}>Watchlists</div>
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
        The starred watchlist populates the Scanner and shows earnings dates on every account's Calendar. Switch the star to change which one.
      </div>

      {/* ── List tabs ──────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {lists.map(l => {
          const isActive = l.id === activeId
          const isSelected = l.id === selectedId
          return renamingId === l.id ? (
            <input key={l.id} autoFocus value={renameValue} onChange={e => setRenameValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') confirmRename(); if (e.key === 'Escape') setRenamingId(null) }}
              onBlur={confirmRename}
              style={{ width: 130, padding: '5px 8px', fontSize: 12, borderRadius: 5, border: '1px solid var(--accent-border)', background: 'var(--bg-elevated)', color: 'var(--text-1)' }}
            />
          ) : (
            <div key={l.id} onClick={() => setSelectedId(l.id)} style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 6, cursor: 'pointer',
              background: isSelected ? 'var(--accent-dim)' : 'var(--bg-card)',
              border: `1px solid ${isSelected ? 'var(--accent-border)' : 'var(--border)'}`,
            }}>
              <button onClick={e => { e.stopPropagation(); onSetActive(l.id) }} title={isActive ? 'Active watchlist' : 'Make active'} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', padding: 0 }}>
                <Star size={13} fill={isActive ? '#f59e0b' : 'none'} color={isActive ? '#f59e0b' : 'var(--text-4)'} />
              </button>
              <span style={{ fontSize: 12, fontWeight: 600, color: isSelected ? 'var(--accent)' : 'var(--text-2)' }}>{l.name}</span>
              <span style={{ fontSize: 10, color: 'var(--text-4)' }}>({l.tickers.length})</span>
              <button onClick={e => { e.stopPropagation(); setRenamingId(l.id); setRenameValue(l.name) }} title="Rename" style={{ background: 'none', border: 'none', color: 'var(--text-4)', cursor: 'pointer', display: 'flex', padding: 1 }}>
                <Pencil size={11} />
              </button>
              <button onClick={e => { e.stopPropagation(); onRemoveList(l.id) }} title="Delete watchlist" style={{ background: 'none', border: 'none', color: 'var(--text-4)', cursor: 'pointer', display: 'flex', padding: 1 }}>
                <Trash2 size={11} />
              </button>
            </div>
          )
        })}

        {addingList ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <input autoFocus value={newListName} onChange={e => setNewListName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') confirmAddList(); if (e.key === 'Escape') setAddingList(false) }}
              placeholder="Watchlist name"
              style={{ width: 140, padding: '5px 8px', fontSize: 12, borderRadius: 5, border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-1)' }}
            />
            <button onClick={confirmAddList} className="ew-icon-btn" style={{ width: 26, height: 26 }}><Plus size={13} /></button>
            <button onClick={() => setAddingList(false)} className="ew-icon-btn" style={{ width: 26, height: 26 }}><X size={13} /></button>
          </div>
        ) : (
          <button onClick={() => setAddingList(true)} style={{
            display: 'inline-flex', alignItems: 'center', gap: 4, padding: '6px 10px', fontSize: 12, fontWeight: 600,
            background: 'none', border: '1px dashed var(--border-light)', color: 'var(--text-4)', cursor: 'pointer', borderRadius: 6,
          }}>
            <Plus size={12} /> New watchlist
          </button>
        )}
      </div>

      {!selected ? (
        <div style={{ fontSize: 12, color: 'var(--text-4)' }}>No watchlists yet — create one above.</div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              value={input}
              onChange={e => setInput(e.target.value.toUpperCase())}
              onKeyDown={e => e.key === 'Enter' && submitTicker()}
              placeholder="Add ticker (e.g. AAPL)"
              autoCapitalize="characters" autoCorrect="off" autoComplete="off" spellCheck={false}
              style={{ width: 200, padding: '7px 10px', fontSize: 14, borderRadius: 5, border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-1)' }}
            />
            <button onClick={submitTicker} style={{
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
                  <th style={{ textAlign: 'center' }} title="Mean-reversion read on RSI(14): oversold (<=30) suggests a bounce, overbought (>=70) suggests a pullback">Signal</th>
                  <th style={{ textAlign: 'right' }}>Last</th>
                  <th style={{ textAlign: 'right' }}>Change</th>
                  <th style={{ textAlign: 'right' }}>Change %</th>
                  <th style={{ textAlign: 'right' }}>Volume</th>
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
                  const signal = meanReversionSignal(r)
                  return (
                    <tr key={sym}>
                      <td className="mono" style={{ fontWeight: 700, color: 'var(--text-1)', whiteSpace: 'nowrap' }}>{sym}</td>
                      <td style={{ textAlign: 'center' }}>
                        {signal ? (
                          <span style={{
                            display: 'inline-block', padding: '1px 8px', fontSize: 10, fontWeight: 700,
                            letterSpacing: '0.03em', borderRadius: 3,
                            color: SIGNAL_STYLE[signal].color, background: SIGNAL_STYLE[signal].bg,
                            border: `1px solid ${SIGNAL_STYLE[signal].border}`,
                          }}>
                            {SIGNAL_STYLE[signal].label}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="mono" style={{ textAlign: 'right' }}>{q ? fmt$(q.price) : loading ? '…' : '—'}</td>
                      <td className={`mono ${change != null && change > 0 ? 'pos' : change != null && change < 0 ? 'neg' : 'neu'}`} style={{ textAlign: 'right' }}>
                        {change != null ? `${change > 0 ? '+' : ''}${change.toFixed(2)}` : '—'}
                      </td>
                      <td className={`mono ${changePct != null && changePct > 0 ? 'pos' : changePct != null && changePct < 0 ? 'neg' : 'neu'}`} style={{ textAlign: 'right' }}>
                        {changePct != null ? `${changePct > 0 ? '+' : ''}${changePct.toFixed(2)}%` : '—'}
                      </td>
                      <td className="mono" style={{ textAlign: 'right' }}>{fmtVol(q?.volume ?? null)}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{fmt$(q?.high52 ?? null)}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{fmt$(q?.low52 ?? null)}</td>
                      <td className="mono" style={{ textAlign: 'right', color: rsiColor(r), fontWeight: 600 }}>{r != null ? r.toFixed(0) : '—'}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>
                        {ne ? <span title={ne} style={{ padding: '1px 5px', fontSize: 10, fontWeight: 700, background: '#F0B42915', border: '1px solid #F0B42940', color: '#F0B429' }}>{fmtEarnings(ne)}</span> : '—'}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <button onClick={() => onRemoveTicker(selected.id, sym)} title="Remove" style={{
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
        </>
      )}
    </div>
  )
}
