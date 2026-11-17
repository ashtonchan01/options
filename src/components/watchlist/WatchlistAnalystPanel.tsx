import { useCallback, useState } from 'react'
import { ChevronDown, ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react'
import {
  type AnalystPriceTarget,
  type AnalystTargetInput,
  type AnalystTickerBundle,
  createAnalystTarget,
  deleteAnalystTarget,
  upsidePct,
  updateAnalystTarget,
} from '../../services/analystTargets'

const ACTIONS = ['Assigned', 'Reiterated', 'Raised', 'Lowered', 'Initiated'] as const
const RATINGS = ['BUY', 'HOLD', 'SELL'] as const

function fmt$(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return `$${n.toFixed(n >= 100 ? 0 : 2)}`
}

function fmtPct(n: number | null): string {
  if (n == null) return '—'
  return `${n > 0 ? '+' : ''}${n.toFixed(1)}%`
}

function pctClass(n: number | null): string {
  if (n == null) return 'neu'
  if (n > 0) return 'pos'
  if (n < 0) return 'neg'
  return 'neu'
}

function emptyForm(ticker: string): AnalystTargetInput {
  return {
    ticker,
    analystName: '',
    firm: '',
    starRating: null,
    rating: 'BUY',
    priceTarget: 0,
    previousTarget: null,
    action: 'Reiterated',
    date: new Date().toISOString().slice(0, 10),
    sourceNote: '',
  }
}

export function WatchlistAnalystSummary({
  price,
  bundle,
  expanded,
  onToggle,
}: {
  sym: string
  price: number | null
  bundle: AnalystTickerBundle | undefined
  expanded: boolean
  onToggle: () => void
}) {
  const s = bundle?.summary
  const hasData = (s?.count ?? 0) > 0 || (bundle?.rows?.length ?? 0) > 0
  const upside = upsidePct(price, s?.median ?? NaN)

  return (
    <button
      type="button"
      onClick={onToggle}
      title="Analyst price targets"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 6px',
        background: expanded ? 'var(--accent-dim)' : 'transparent',
        border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer', maxWidth: '100%',
      }}
    >
      {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      <span style={{ fontSize: 10, color: 'var(--text-4)' }}>PT</span>
      {hasData ? (
        <span className="mono" style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-2)' }}>
          {fmt$(s?.median)} · {fmtPct(upside)} · {s?.count ?? bundle?.rows.length ?? 0}
        </span>
      ) : (
        <span style={{ fontSize: 10, color: 'var(--text-4)' }}>—</span>
      )}
    </button>
  )
}

export function WatchlistAnalystExpanded({
  sym,
  price,
  bundle,
  onChanged,
  onEnsureTicker,
}: {
  sym: string
  price: number | null
  bundle: AnalystTickerBundle | undefined
  onChanged: () => void
  onEnsureTicker: (ticker: string) => void
}) {
  const [editing, setEditing] = useState<AnalystTargetInput | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const s = bundle?.summary
  const rows = bundle?.rows ?? []

  const startAdd = useCallback(() => {
    setEditId(null)
    setEditing(emptyForm(sym))
  }, [sym])

  const startEdit = useCallback((row: AnalystPriceTarget) => {
    if (!row.isManual) return
    setEditId(row.id)
    setEditing({
      ticker: row.ticker,
      analystName: row.analystName,
      firm: row.firm,
      starRating: row.starRating,
      rating: row.rating,
      priceTarget: row.priceTarget,
      previousTarget: row.previousTarget,
      action: row.action,
      date: row.date,
      sourceNote: row.sourceNote,
    })
  }, [])

  async function save() {
    if (!editing) return
    if (!editing.firm?.trim() || !editing.priceTarget) return
    setSaving(true)
    onEnsureTicker(editing.ticker)
    const payload = { ...editing, ticker: sym }
    const ok = editId
      ? await updateAnalystTarget(editId, payload)
      : await createAnalystTarget(payload)
    setSaving(false)
    if (ok) { setEditing(null); setEditId(null); onChanged() }
  }

  async function remove(id: string) {
    if (!id || !id.match(/^[0-9a-f-]{36}$/i)) return
    if (await deleteAnalystTarget(id)) onChanged()
  }

  return (
    <div style={{ padding: '10px 14px', background: 'var(--bg-elevated)', borderTop: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 16px', fontSize: 11, marginBottom: 8 }}>
        <span><span style={{ color: 'var(--text-4)' }}>Median </span><span className="mono" style={{ fontWeight: 700 }}>{fmt$(s?.median)}</span></span>
        <span><span style={{ color: 'var(--text-4)' }}>High </span><span className="mono">{fmt$(s?.high)}</span></span>
        <span><span style={{ color: 'var(--text-4)' }}>Low </span><span className="mono">{fmt$(s?.low)}</span></span>
        <span><span style={{ color: 'var(--text-4)' }}>Analysts </span><span className="mono">{s?.count ?? '—'}</span></span>
        <span><span style={{ color: 'var(--text-4)' }}>Upside </span>
          <span className={`mono ${pctClass(upsidePct(price, s?.median ?? NaN))}`} style={{ fontWeight: 700 }}>
            {fmtPct(upsidePct(price, s?.median ?? NaN))}
          </span>
        </span>
        {bundle?.dataSource && (
          <span style={{ color: 'var(--text-4)', fontSize: 10 }}>{bundle.dataSource === 'live' ? 'Yahoo live' : bundle.dataSource}</span>
        )}
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ color: 'var(--text-4)', textAlign: 'left' }}>
              <th style={{ padding: '4px 6px' }}>Firm</th>
              <th style={{ padding: '4px 6px' }}>Analyst</th>
              <th style={{ padding: '4px 6px', textAlign: 'right' }}>Target</th>
              <th style={{ padding: '4px 6px', textAlign: 'right' }}>Upside</th>
              <th style={{ padding: '4px 6px' }}>Action</th>
              <th style={{ padding: '4px 6px' }}>Date</th>
              <th style={{ padding: '4px 6px' }}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.id} style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ padding: '4px 6px', fontWeight: 600 }}>{row.firm || '—'}</td>
                <td style={{ padding: '4px 6px' }}>{row.analystName || '—'}</td>
                <td className="mono" style={{ padding: '4px 6px', textAlign: 'right' }}>
                  {fmt$(row.priceTarget)}
                  {row.previousTarget != null && (
                    <span style={{ color: 'var(--text-4)', fontSize: 10 }}> ← {fmt$(row.previousTarget)}</span>
                  )}
                </td>
                <td className={`mono ${pctClass(upsidePct(price, row.priceTarget))}`} style={{ padding: '4px 6px', textAlign: 'right' }}>
                  {fmtPct(upsidePct(price, row.priceTarget))}
                </td>
                <td style={{ padding: '4px 6px' }}>{row.action}{row.rating ? ` · ${row.rating}` : ''}</td>
                <td className="mono" style={{ padding: '4px 6px' }}>{row.date}</td>
                <td style={{ padding: '4px 6px', whiteSpace: 'nowrap' }}>
                  {row.isManual && (
                    <>
                      <button type="button" onClick={() => startEdit(row)} className="ew-icon-btn" style={{ width: 22, height: 22, marginRight: 4 }} title="Edit">
                        <Pencil size={11} />
                      </button>
                      <button type="button" onClick={() => remove(row.id)} className="ew-icon-btn" style={{ width: 22, height: 22 }} title="Delete">
                        <Trash2 size={11} />
                      </button>
                    </>
                  )}
                  {row.source === 'seed' && <span style={{ fontSize: 9, color: 'var(--text-4)' }}>seed</span>}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={7} style={{ padding: 8, color: 'var(--text-4)' }}>No analyst targets — add a manual row or refresh live data.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {!editing ? (
        <button type="button" onClick={startAdd} style={{
          marginTop: 8, display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600,
          padding: '5px 10px', background: 'var(--accent-dim)', border: '1px solid var(--accent-border)',
          color: 'var(--accent)', borderRadius: 4, cursor: 'pointer',
        }}>
          <Plus size={12} /> Manual target
        </button>
      ) : (
        <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8 }}>
          <input placeholder="Firm" value={editing.firm} onChange={e => setEditing({ ...editing, firm: e.target.value })} style={inputStyle} />
          <input placeholder="Analyst" value={editing.analystName} onChange={e => setEditing({ ...editing, analystName: e.target.value })} style={inputStyle} />
          <input type="number" placeholder="Target $" value={editing.priceTarget || ''} onChange={e => setEditing({ ...editing, priceTarget: Number(e.target.value) })} style={inputStyle} />
          <input type="number" placeholder="Prev $" value={editing.previousTarget ?? ''} onChange={e => setEditing({ ...editing, previousTarget: e.target.value === '' ? null : Number(e.target.value) })} style={inputStyle} />
          <select value={editing.action} onChange={e => setEditing({ ...editing, action: e.target.value as AnalystTargetInput['action'] })} style={inputStyle}>
            {ACTIONS.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <select value={editing.rating ?? ''} onChange={e => setEditing({ ...editing, rating: (e.target.value || null) as AnalystTargetInput['rating'] })} style={inputStyle}>
            <option value="">Rating</option>
            {RATINGS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <input type="date" value={editing.date} onChange={e => setEditing({ ...editing, date: e.target.value })} style={inputStyle} />
          <ManualTargetFormActions saving={saving} onSave={save} onCancel={() => { setEditing(null); setEditId(null) }} />
        </div>
      )}
    </div>
  )
}

const inputStyle: import('react').CSSProperties = {
  padding: '6px 8px', fontSize: 11, borderRadius: 4, border: '1px solid var(--border)',
  background: 'var(--bg-card)', color: 'var(--text-1)', minWidth: 0,
}

function ManualTargetFormActions({ saving, onSave, onCancel }: { saving: boolean; onSave: () => void; onCancel: () => void }) {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <button type="button" disabled={saving} onClick={onSave} style={{
        padding: '6px 12px', fontSize: 11, fontWeight: 700, borderRadius: 4, cursor: 'pointer',
        background: 'var(--accent)', color: '#fff', border: 'none',
      }}>{saving ? '…' : 'Save'}</button>
      <button type="button" onClick={onCancel} style={{
        padding: '6px 10px', fontSize: 11, borderRadius: 4, cursor: 'pointer',
        background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-3)',
      }}>Cancel</button>
    </div>
  )
}