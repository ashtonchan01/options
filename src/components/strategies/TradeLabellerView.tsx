import { useState, useMemo } from 'react'
import type { AppState } from '../../types'
import type { TradeLabel } from '../../store/tradeLabelsStore'
import { tradeId } from '../../store/tradeLabelsStore'

// ─── Strategy options ─────────────────────────────────────────────────────────

export const STRATEGY_OPTIONS: { value: TradeLabel; label: string; color: string }[] = [
  { value: 'covered_calls',  label: 'Covered Calls',     color: '#3b82f6' },
  { value: 'csp',            label: 'Cash Secured Puts',  color: '#f43f5e' },
  { value: 'leap',           label: 'LEAP',              color: '#10b981' },
  { value: 'spx',            label: 'SPX',               color: '#8b5cf6' },
  { value: 'rotation',       label: 'Rotation Model',    color: '#f59e0b' },
  { value: 'ptos',           label: 'PTOS',              color: '#06b6d4' },
  { value: 'dcas',           label: 'DCAS',              color: '#ec4899' },
  { value: 'profit_taking',  label: 'Profit Taking',     color: '#84cc16' },
  { value: 'lilo',           label: 'LILO',              color: '#f97316' },
  { value: 'arb_cloud',      label: 'ARB Cloud',         color: '#a78bfa' },
  { value: 'tabi',           label: 'TABI',              color: '#34d399' },
  { value: 'forex',          label: 'Forex',             color: '#e879f9' },
]

const STRAT_MAP = Object.fromEntries(STRATEGY_OPTIONS.map(s => [s.value, s])) as Record<TradeLabel, typeof STRATEGY_OPTIONS[number]>

interface Props {
  state: AppState
  labels: Record<string, TradeLabel>
  setLabel: (id: string, label: TradeLabel | null) => void
  setMany:  (ids: string[], label: TradeLabel | null) => void
  clearAll: () => void
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt$(n: number) {
  const sign = n < 0 ? '-' : ''
  return `${sign}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtDate(s: string) {
  const d = new Date(s)
  return isNaN(d.getTime()) ? s : d.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })
}

function fmtExpiry(s: string) {
  if (!s) return '—'
  if (/^\d{8}$/.test(s)) s = `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`
  const d = new Date(s)
  return isNaN(d.getTime()) ? s : d.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: '2-digit' })
}

function pnlCls(n: number) { return n > 0 ? 'pos' : n < 0 ? 'neg' : 'neu' }

type FilterMode = 'all' | 'unlabelled' | 'labelled' | TradeLabel
type SortKey = 'date_desc' | 'date_asc' | 'underlying' | 'net_desc'

// ─── Label badge ──────────────────────────────────────────────────────────────

function LabelBadge({ label }: { label: TradeLabel }) {
  const cfg = STRAT_MAP[label]
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 3,
      color: cfg.color, background: `${cfg.color}18`, border: `1px solid ${cfg.color}40`,
      letterSpacing: '0.06em', whiteSpace: 'nowrap',
    }}>
      {cfg.label}
    </span>
  )
}

// ─── Strategy select dropdown ─────────────────────────────────────────────────

function StratSelect({ value, onChange }: { value: TradeLabel | null; onChange: (v: TradeLabel | null) => void }) {
  return (
    <select
      className="tl-strat-select"
      value={value ?? ''}
      onChange={e => onChange((e.target.value || null) as TradeLabel | null)}
      onClick={e => e.stopPropagation()}
    >
      <option value="">— unassigned —</option>
      {STRATEGY_OPTIONS.map(s => (
        <option key={s.value} value={s.value}>{s.label}</option>
      ))}
    </select>
  )
}

// ─── Progress bar ─────────────────────────────────────────────────────────────

function LabelProgress({ total, labelled }: { total: number; labelled: number }) {
  const pct = total ? (labelled / total) * 100 : 0
  return (
    <div className="tl-progress-wrap">
      <div className="tl-progress-bar">
        <div className="tl-progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="tl-progress-text">
        {labelled} / {total} labelled ({pct.toFixed(0)}%)
      </span>
    </div>
  )
}

// ─── Main view ────────────────────────────────────────────────────────────────

export default function TradeLabellerView({ state, labels, setLabel, setMany, clearAll }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState<FilterMode>('all')
  const [sort, setSort] = useState<SortKey>('date_desc')
  const [bulkLabel, setBulkLabel] = useState<TradeLabel | ''>('')
  const [confirmClear, setConfirmClear] = useState(false)

  const trades = state.sync.trades

  // Build sorted + filtered list
  const displayed = useMemo(() => {
    let arr = [...trades]

    // Filter
    if (filter === 'unlabelled') arr = arr.filter(t => !labels[tradeId(t)])
    else if (filter === 'labelled') arr = arr.filter(t => !!labels[tradeId(t)])
    else if (filter !== 'all') arr = arr.filter(t => labels[tradeId(t)] === filter)

    // Sort
    switch (sort) {
      case 'date_desc':  arr.sort((a, b) => b.tradeDate.localeCompare(a.tradeDate)); break
      case 'date_asc':   arr.sort((a, b) => a.tradeDate.localeCompare(b.tradeDate)); break
      case 'underlying': arr.sort((a, b) => (a.underlyingSymbol ?? a.symbol).localeCompare(b.underlyingSymbol ?? b.symbol)); break
      case 'net_desc':   arr.sort((a, b) => b.netCash - a.netCash); break
    }

    return arr
  }, [trades, labels, filter, sort])

  const labelledCount = trades.filter(t => !!labels[tradeId(t)]).length

  // Selection helpers
  function toggleRow(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleAll() {
    if (selected.size === displayed.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(displayed.map(t => tradeId(t))))
    }
  }

  function applyBulk() {
    if (!selected.size) return
    setMany([...selected], bulkLabel || null)
    setSelected(new Set())
    setBulkLabel('')
  }

  const allChecked = displayed.length > 0 && selected.size === displayed.length
  const someChecked = selected.size > 0 && selected.size < displayed.length

  return (
    <div className="tl-root">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="tl-header">
        <div>
          <h2 className="cc-title" style={{ fontSize: 20 }}>Label Trades</h2>
          <div className="cc-subtitle">Assign each trade to a strategy — labels are saved locally in your browser</div>
        </div>
        <LabelProgress total={trades.length} labelled={labelledCount} />
      </div>

      {/* ── Toolbar ─────────────────────────────────────────────────────────── */}
      <div className="tl-toolbar">
        {/* Filter chips */}
        <div className="tl-filter-row">
          {([
            { key: 'all',        label: `All (${trades.length})` },
            { key: 'unlabelled', label: `Unlabelled (${trades.length - labelledCount})` },
            { key: 'labelled',   label: `Labelled (${labelledCount})` },
          ] as { key: FilterMode; label: string }[]).map(f => (
            <button
              key={f.key}
              className={`tl-filter-chip${filter === f.key ? ' active' : ''}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
          <div className="tl-divider-v" />
          {STRATEGY_OPTIONS.map(s => {
            const count = trades.filter(t => labels[tradeId(t)] === s.value).length
            if (count === 0) return null
            return (
              <button
                key={s.value}
                className={`tl-filter-chip${filter === s.value ? ' active' : ''}`}
                style={filter === s.value ? { borderColor: s.color, color: s.color, background: `${s.color}14` } : {}}
                onClick={() => setFilter(filter === s.value ? 'all' : s.value as FilterMode)}
              >
                {s.label} <span style={{ opacity: 0.6 }}>({count})</span>
              </button>
            )
          })}
        </div>

        {/* Right: sort + bulk + clear */}
        <div className="tl-toolbar-right">
          <select className="cc-select" style={{ minWidth: 160, fontSize: 12 }} value={sort} onChange={e => setSort(e.target.value as SortKey)}>
            <option value="date_desc">Date — Newest first</option>
            <option value="date_asc">Date — Oldest first</option>
            <option value="underlying">Underlying A–Z</option>
            <option value="net_desc">Net $ — Highest first</option>
          </select>

          {confirmClear ? (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: '#f43f5e' }}>Clear all labels?</span>
              <button className="tl-btn tl-btn-danger" onClick={() => { clearAll(); setConfirmClear(false) }}>Yes, clear</button>
              <button className="tl-btn" onClick={() => setConfirmClear(false)}>Cancel</button>
            </div>
          ) : (
            <button className="tl-btn" onClick={() => setConfirmClear(true)} style={{ color: 'var(--text-4)' }}>
              Clear all labels
            </button>
          )}
        </div>
      </div>

      {/* ── Bulk action bar ─────────────────────────────────────────────────── */}
      {selected.size > 0 && (
        <div className="tl-bulk-bar">
          <span style={{ fontSize: 13, color: 'var(--text-2)', fontWeight: 600 }}>
            {selected.size} trade{selected.size !== 1 ? 's' : ''} selected
          </span>
          <span style={{ fontSize: 12, color: 'var(--text-4)' }}>Assign to:</span>
          <select
            className="cc-select"
            style={{ minWidth: 180, fontSize: 12 }}
            value={bulkLabel}
            onChange={e => setBulkLabel(e.target.value as TradeLabel | '')}
          >
            <option value="">— choose strategy —</option>
            {STRATEGY_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            <option value="">— clear label —</option>
          </select>
          <button
            className="tl-btn tl-btn-primary"
            onClick={applyBulk}
            disabled={bulkLabel === '' && selected.size === 0}
          >
            Apply to {selected.size} trade{selected.size !== 1 ? 's' : ''}
          </button>
          <button className="tl-btn" onClick={() => setSelected(new Set())}>Deselect all</button>
        </div>
      )}

      {/* ── Table ───────────────────────────────────────────────────────────── */}
      <div className="tl-table-wrap">
        {displayed.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-5)', fontSize: 14 }}>
            No trades match this filter
          </div>
        ) : (
          <table className="trade-table tl-table">
            <thead>
              <tr>
                <th style={{ width: 36 }}>
                  <input
                    type="checkbox"
                    className="tl-checkbox"
                    checked={allChecked}
                    ref={el => { if (el) el.indeterminate = someChecked }}
                    onChange={toggleAll}
                  />
                </th>
                <th>Date</th>
                <th>Underlying</th>
                <th>Symbol</th>
                <th style={{ textAlign: 'center' }}>Type</th>
                <th style={{ textAlign: 'right' }}>Strike</th>
                <th>Expiry</th>
                <th style={{ textAlign: 'right' }}>Qty</th>
                <th style={{ textAlign: 'right' }}>Net Cash</th>
                <th style={{ minWidth: 200 }}>Strategy Label</th>
              </tr>
            </thead>
            <tbody>
              {displayed.map((t, i) => {
                const id       = tradeId(t)
                const checked  = selected.has(id)
                const label    = labels[id] ?? null
                const pcColor  = t.putCall === 'C' ? '#3b82f6' : t.putCall === 'P' ? '#f43f5e' : 'var(--text-4)'

                return (
                  <tr
                    key={i}
                    className={`tl-row${checked ? ' tl-row-selected' : ''}`}
                    onClick={() => toggleRow(id)}
                  >
                    <td onClick={e => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        className="tl-checkbox"
                        checked={checked}
                        onChange={() => toggleRow(id)}
                      />
                    </td>
                    <td className="mono" style={{ color: 'var(--text-3)', fontSize: 12, whiteSpace: 'nowrap' }}>
                      {fmtDate(t.tradeDate)}
                    </td>
                    <td style={{ fontWeight: 700, fontFamily: 'IBM Plex Mono, monospace', color: 'var(--text-1)' }}>
                      {t.underlyingSymbol ?? '—'}
                    </td>
                    <td style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 11, color: 'var(--text-3)' }}>
                      {t.symbol}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {t.putCall ? (
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 5px', color: pcColor, background: `${pcColor}14`, border: `1px solid ${pcColor}30` }}>
                          {t.putCall === 'C' ? 'CALL' : 'PUT'}
                        </span>
                      ) : (
                        <span style={{ fontSize: 10, color: 'var(--text-4)' }}>{t.assetClass}</span>
                      )}
                    </td>
                    <td className="mono" style={{ textAlign: 'right', color: 'var(--text-2)' }}>
                      {t.strike ? `$${t.strike.toLocaleString()}` : '—'}
                    </td>
                    <td className="mono" style={{ fontSize: 12, color: 'var(--text-3)' }}>
                      {fmtExpiry(t.expiry ?? '')}
                    </td>
                    <td className="mono" style={{ textAlign: 'right', color: t.quantity < 0 ? '#10b981' : '#f43f5e' }}>
                      {t.quantity > 0 ? '+' : ''}{t.quantity}
                    </td>
                    <td className={`mono ${pnlCls(t.netCash)}`} style={{ textAlign: 'right', fontWeight: 700 }}>
                      {fmt$(t.netCash)}
                    </td>
                    <td onClick={e => e.stopPropagation()}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {label && <LabelBadge label={label} />}
                        <StratSelect
                          value={label}
                          onChange={v => setLabel(id, v)}
                        />
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
