/**
 * Watchlist — the single place a user builds their ticker list. Feeds both
 * the Scanner (which tickers get scanned) and the Calendar (which tickers'
 * earnings dates get pulled), so adding AAPL here is enough to see it in
 * both places instead of typing it into each separately.
 */
import { useState } from 'react'
import { ListChecks, Plus, X } from 'lucide-react'

export default function WatchlistView({ tickers, onAdd, onRemove }: {
  tickers: string[]
  onAdd: (symbol: string) => void
  onRemove: (symbol: string) => void
}) {
  const [input, setInput] = useState('')

  function submit() {
    if (input.trim()) { onAdd(input); setInput('') }
  }

  return (
    <div className="jr-root">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <ListChecks size={16} style={{ color: 'var(--accent)' }} />
        <div className="cc-section-title" style={{ padding: 0 }}>Watchlist</div>
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

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
        {tickers.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--text-4)' }}>No tickers yet — add one above.</div>
        )}
        {tickers.map(sym => (
          <div key={sym} style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px 6px 12px',
            background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6,
          }}>
            <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 700, fontSize: 13, color: 'var(--text-1)' }}>{sym}</span>
            <button onClick={() => onRemove(sym)} title="Remove" style={{
              background: 'none', border: 'none', color: 'var(--text-4)', cursor: 'pointer', display: 'flex', padding: 2,
            }}>
              <X size={13} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
