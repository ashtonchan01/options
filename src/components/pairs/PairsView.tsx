/**
 * Pair ratio chart. Read-only analytics: daily A/B from /api/history,
 * horizontal range bands, and touch/cross markers. Never places an order.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRightLeft, RefreshCw, RotateCcw } from 'lucide-react'
import { WATCHLIST } from '../../data/watchlist'
import { fetchDailyHistory, type DailySeries, type HistoryRange } from '../../services/history'
import {
  autoBands, bandSignals, buildRatio, fmtRatio, rangePosition, rollingZ, zScore,
  type Bands, type RatioPoint,
} from './ratio'

const LOOKBACKS: { id: HistoryRange; label: string }[] = [
  { id: '3mo', label: '3M' },
  { id: '6mo', label: '6M' },
  { id: '1y', label: '1Y' },
  { id: '2y', label: '2Y' },
]

const STORAGE_PREFIX = 'options:pair-bands:'

interface SavedBands { top: number; bottom: number }

function storageKey(a: string, b: string): string {
  return `${STORAGE_PREFIX}${a}/${b}`
}

function loadSaved(a: string, b: string): SavedBands | null {
  try {
    const raw = localStorage.getItem(storageKey(a, b))
    if (!raw) return null
    const parsed = JSON.parse(raw) as SavedBands
    if (typeof parsed.top === 'number' && typeof parsed.bottom === 'number' && parsed.top > parsed.bottom) return parsed
  } catch { /* ignore */ }
  return null
}

function saveBands(a: string, b: string, bands: SavedBands) {
  try { localStorage.setItem(storageKey(a, b), JSON.stringify(bands)) } catch { /* ignore */ }
}

function clearBands(a: string, b: string) {
  try { localStorage.removeItem(storageKey(a, b)) } catch { /* ignore */ }
}

function tickerList(tickers: string[]): string[] {
  const set = new Set<string>()
  for (const t of tickers) {
    const s = t.trim().toUpperCase()
    if (s) set.add(s)
  }
  if (set.size === 0) for (const t of WATCHLIST) set.add(t)
  return [...set].sort()
}

interface Hover {
  index: number
  xPct: number
  yPct: number
}

export default function PairsView({ tickers }: { tickers: string[] }) {
  const symbols = useMemo(() => tickerList(tickers), [tickers])
  const [sideA, setSideA] = useState(() => symbols.includes('TSLA') ? 'TSLA' : symbols[0] ?? 'TSLA')
  const [sideB, setSideB] = useState(() => {
    const other = symbols.find(s => s !== (symbols.includes('TSLA') ? 'TSLA' : symbols[0]))
    return other ?? symbols[1] ?? 'NVDA'
  })
  const [range, setRange] = useState<HistoryRange>('1y')
  const [series, setSeries] = useState<Record<string, DailySeries>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [manual, setManual] = useState<SavedBands | null>(null)
  const [hover, setHover] = useState<Hover | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!symbols.includes(sideA) && symbols[0]) setSideA(symbols[0])
    if (!symbols.includes(sideB) && symbols[1]) setSideB(symbols.find(s => s !== sideA) ?? symbols[0])
  }, [symbols, sideA, sideB])

  useEffect(() => {
    setManual(loadSaved(sideA, sideB))
  }, [sideA, sideB])

  useEffect(() => {
    if (!sideA || !sideB || sideA === sideB) return
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchDailyHistory([sideA, sideB], range).then(data => {
      if (cancelled) return
      setSeries(data)
      if (!data[sideA] || !data[sideB]) setError('No daily history for that pair.')
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [sideA, sideB, range, reloadKey])

  const points = useMemo(() => buildRatio(series[sideA], series[sideB]), [series, sideA, sideB])
  const detected = useMemo(() => autoBands(points), [points])
  const bands = manual ?? detected
  const ratios = useMemo(() => points.map(p => p.ratio), [points])
  const last = points[points.length - 1]
  const z = last ? zScore(last.ratio, ratios) : null
  const pos = last && bands ? rangePosition(last.ratio, bands) : null
  const signals = useMemo(() => (bands ? bandSignals(points, bands) : []), [points, bands])
  const zSeries = useMemo(() => rollingZ(points), [points])

  function commit(next: Bands) {
    if (!(next.top > next.bottom)) return
    const saved = { top: next.top, bottom: next.bottom }
    setManual(saved)
    saveBands(sideA, sideB, saved)
  }

  function resetAuto() {
    setManual(null)
    clearBands(sideA, sideB)
  }

  function swap() {
    setSideA(sideB)
    setSideB(sideA)
  }

  return (
    <div className="jr-root pairs-root">
      <div className="pairs-toolbar">
        <ArrowRightLeft size={16} style={{ color: 'var(--accent)', flexShrink: 0 }} />
        <div className="cc-section-title" style={{ padding: 0 }}>Pairs</div>
        <label className="pairs-field">
          <span>Side A</span>
          <select value={sideA} onChange={e => setSideA(e.target.value)} aria-label="Side A">
            {symbols.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <button type="button" className="pairs-swap" onClick={swap} title="Swap sides" aria-label="Swap sides">
          <ArrowRightLeft size={14} />
        </button>
        <label className="pairs-field">
          <span>Side B</span>
          <select value={sideB} onChange={e => setSideB(e.target.value)} aria-label="Side B">
            {symbols.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <div className="pairs-ranges" role="tablist" aria-label="Lookback">
          {LOOKBACKS.map(lb => (
            <button
              key={lb.id}
              type="button"
              role="tab"
              aria-selected={range === lb.id}
              className={range === lb.id ? 'active' : ''}
              onClick={() => setRange(lb.id)}
            >{lb.label}</button>
          ))}
        </div>
        <button type="button" className="pairs-refresh" onClick={() => setReloadKey(k => k + 1)} disabled={loading}>
          <RefreshCw size={12} style={{ animation: loading ? 'spin 1.5s linear infinite' : 'none' }} />
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {sideA === sideB && (
        <div className="pairs-note">Pick two different watchlist stocks.</div>
      )}

      <div className="pairs-readout">
        <Stat label="Ratio" value={last ? fmtRatio(last.ratio) : '—'} sub={last ? `${sideA} / ${sideB} · ${last.date}` : 'daily close'} />
        <Stat label="In range" value={pos != null && Number.isFinite(pos) ? `${pos.toFixed(0)}%` : '—'} sub="0% bottom · 100% top" />
        <Stat label="To top" value={last && bands ? fmtRatio(bands.top - last.ratio) : '—'} sub={bands ? `band ${fmtRatio(bands.top)}` : ''} accent="#ef4444" />
        <Stat label="To bottom" value={last && bands ? fmtRatio(last.ratio - bands.bottom) : '—'} sub={bands ? `band ${fmtRatio(bands.bottom)}` : ''} accent="#10b981" />
        <Stat label="Z-score" value={z != null ? z.toFixed(2) : '—'} sub="vs lookback mean" />
        <div className="pairs-band-edit">
          <label>
            Top
            <input
              type="number"
              step="any"
              aria-label="Top band"
              value={bands ? trimInput(bands.top) : ''}
              onChange={e => {
                const top = Number(e.target.value)
                if (bands && Number.isFinite(top)) commit({ top, bottom: Math.min(bands.bottom, top - 1e-6) })
              }}
            />
          </label>
          <label>
            Bottom
            <input
              type="number"
              step="any"
              aria-label="Bottom band"
              value={bands ? trimInput(bands.bottom) : ''}
              onChange={e => {
                const bottom = Number(e.target.value)
                if (bands && Number.isFinite(bottom)) commit({ bottom, top: Math.max(bands.top, bottom + 1e-6) })
              }}
            />
          </label>
          <button type="button" onClick={resetAuto} disabled={!manual} title="Use the auto-detected bands">
            <RotateCcw size={12} /> Auto
          </button>
        </div>
      </div>

      <div className="pairs-legend">
        <span><i style={{ background: '#eab308' }} /> Top — sell {sideA} / buy {sideB}</span>
        <span><i style={{ background: '#e2e8f0' }} /> Bottom — buy {sideA} / sell {sideB}</span>
        <span><i className="pairs-dot" style={{ background: '#ef4444' }} /> Red at the top band</span>
        <span><i className="pairs-dot" style={{ background: '#10b981' }} /> Green at the bottom band</span>
        {manual && <span style={{ color: 'var(--text-3)' }}>Bands saved for {sideA}/{sideB}</span>}
      </div>

      <div className="pairs-chart-card">
        {error && !loading && <div className="pairs-note">{error}</div>}
        {loading && points.length === 0 && <div className="pairs-note">Loading daily closes…</div>}
        {points.length > 0 && bands && (
          <RatioChart
            points={points}
            bands={bands}
            signals={signals}
            hover={hover}
            onHover={setHover}
            onBands={commit}
            sideA={sideA}
            sideB={sideB}
          />
        )}
        {points.length > 0 && (
          <Oscillator points={points} zSeries={zSeries} hoverIndex={hover?.index ?? null} onHover={setHover} />
        )}
      </div>

      <p className="pairs-footnote">Read-only. Ratio of daily closes. Nothing on this page sends an order.</p>
    </div>
  )
}

function trimInput(n: number): string {
  return String(Math.round(n * 1e6) / 1e6)
}

function Stat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="pairs-stat">
      <div className="pairs-stat-label">{label}</div>
      <div className="pairs-stat-value" style={accent ? { color: accent } : undefined}>{value}</div>
      {sub && <div className="pairs-stat-sub">{sub}</div>}
    </div>
  )
}

const PAD_L = 58
const PAD_R = 12
const PAD_T = 16
const PAD_B = 28

function RatioChart({
  points, bands, signals, hover, onHover, onBands, sideA, sideB,
}: {
  points: RatioPoint[]
  bands: Bands
  signals: { index: number; side: 'top' | 'bottom' }[]
  hover: Hover | null
  onHover: (h: Hover | null) => void
  onBands: (b: Bands) => void
  sideA: string
  sideB: string
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const drag = useRef<'top' | 'bottom' | null>(null)
  const [size, setSize] = useState({ w: 800, h: 360 })

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const measure = () => {
      const rect = el.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) setSize({ w: rect.width, h: rect.height })
    }
    measure()
    const obs = new ResizeObserver(measure)
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  const yMinData = Math.min(...points.map(p => p.ratio), bands.bottom)
  const yMaxData = Math.max(...points.map(p => p.ratio), bands.top)
  const pad = (yMaxData - yMinData) * 0.08 || Math.abs(yMaxData) * 0.05 || 0.01
  const yMin = yMinData - pad
  const yMax = yMaxData + pad

  function yOf(v: number, h: number): number {
    return PAD_T + (1 - (v - yMin) / (yMax - yMin)) * (h - PAD_T - PAD_B)
  }
  function vOf(y: number, h: number): number {
    const inner = h - PAD_T - PAD_B
    const t = 1 - (y - PAD_T) / inner
    return yMin + t * (yMax - yMin)
  }
  function xOf(i: number, w: number): number {
    if (points.length === 1) return PAD_L
    return PAD_L + (i / (points.length - 1)) * (w - PAD_L - PAD_R)
  }

  const { w, h } = size
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${xOf(i, w).toFixed(2)},${yOf(p.ratio, h).toFixed(2)}`).join(' ')
  const yTop = yOf(bands.top, h)
  const yBot = yOf(bands.bottom, h)
  const ticks = 4
  const yTicks = Array.from({ length: ticks + 1 }, (_, i) => yMin + ((yMax - yMin) * i) / ticks)
  const xLabels = xTickIndexes(points, w < 520 ? 4 : 6)

  function eventIndex(clientX: number): { index: number; xPct: number; yPct: number } | null {
    const el = wrapRef.current
    if (!el) return null
    const rect = el.getBoundingClientRect()
    const x = ((clientX - rect.left) / rect.width) * w
    const rel = (x - PAD_L) / (w - PAD_L - PAD_R)
    const index = Math.max(0, Math.min(points.length - 1, Math.round(rel * (points.length - 1))))
    return { index, xPct: (xOf(index, w) / w) * 100, yPct: (yOf(points[index].ratio, h) / h) * 100 }
  }

  function onPointerMove(e: React.PointerEvent) {
    const el = wrapRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (drag.current) {
      const y = ((e.clientY - rect.top) / rect.height) * h
      const v = vOf(y, h)
      if (drag.current === 'top') onBands({ top: Math.max(v, bands.bottom + (yMax - yMin) * 0.01), bottom: bands.bottom })
      else onBands({ bottom: Math.min(v, bands.top - (yMax - yMin) * 0.01), top: bands.top })
      return
    }
    onHover(eventIndex(e.clientX))
  }

  function onPointerDown(e: React.PointerEvent, which: 'top' | 'bottom') {
    e.preventDefault()
    drag.current = which
    ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
  }

  const tip = hover ? points[hover.index] : null
  const tipSignal = hover ? signals.find(s => s.index === hover.index) : undefined

  return (
    <div
      ref={wrapRef}
      className="pairs-chart"
      onPointerMove={onPointerMove}
      onPointerLeave={() => { if (!drag.current) onHover(null) }}
      onPointerUp={() => { drag.current = null }}
    >
      <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`${sideA} divided by ${sideB}`}>
        {yTicks.map(v => (
          <g key={v}>
            <line x1={PAD_L} x2={w - PAD_R} y1={yOf(v, h)} y2={yOf(v, h)} stroke="var(--border)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            <text x={PAD_L - 8} y={yOf(v, h)} fill="var(--text-4)" fontSize={12} textAnchor="end" dominantBaseline="middle">{fmtRatio(v)}</text>
          </g>
        ))}
        <line x1={PAD_L} x2={w - PAD_R} y1={yTop} y2={yTop} stroke="#eab308" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        <line x1={PAD_L} x2={w - PAD_R} y1={yBot} y2={yBot} stroke="#e2e8f0" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        <path d={line} fill="none" stroke="var(--accent)" strokeWidth={1.75} vectorEffect="non-scaling-stroke" />
        {signals.map(s => (
          <circle
            key={`${s.side}-${s.index}`}
            cx={xOf(s.index, w)}
            cy={yOf(points[s.index].ratio, h)}
            r={4.5}
            fill={s.side === 'top' ? '#ef4444' : '#10b981'}
            stroke="#0a0a0c"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {hover && tip && (
          <line x1={xOf(hover.index, w)} x2={xOf(hover.index, w)} y1={PAD_T} y2={h - PAD_B} stroke="var(--text-4)" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
        )}
        {xLabels.map((i, n) => (
          <text key={points[i].date} x={xOf(i, w)} y={h - 8} fill="var(--text-4)" fontSize={12}
            textAnchor={n === 0 ? 'start' : n === xLabels.length - 1 ? 'end' : 'middle'}>{points[i].date.slice(2)}</text>
        ))}
        {/* Hit targets for dragging the bands. Wide invisible strokes. */}
        <line x1={PAD_L} x2={w - PAD_R} y1={yTop} y2={yTop} stroke="transparent" strokeWidth={14} style={{ cursor: 'ns-resize' }} vectorEffect="non-scaling-stroke"
          onPointerDown={e => onPointerDown(e, 'top')} />
        <line x1={PAD_L} x2={w - PAD_R} y1={yBot} y2={yBot} stroke="transparent" strokeWidth={14} style={{ cursor: 'ns-resize' }} vectorEffect="non-scaling-stroke"
          onPointerDown={e => onPointerDown(e, 'bottom')} />
      </svg>
      {tip && hover && (
        <div className="pairs-tip" style={{ left: `${Math.min(Math.max(hover.xPct, 8), 78)}%`, top: 8 }}>
          <div>{tip.date}</div>
          <div>Ratio {fmtRatio(tip.ratio)}</div>
          {tipSignal && (
            <div style={{ color: tipSignal.side === 'top' ? '#ef4444' : '#10b981' }}>
              {tipSignal.side === 'top' ? `Sell ${sideA} / buy ${sideB}` : `Buy ${sideA} / sell ${sideB}`}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Oscillator({
  points, zSeries, hoverIndex, onHover,
}: {
  points: RatioPoint[]
  zSeries: (number | null)[]
  hoverIndex: number | null
  onHover: (h: Hover | null) => void
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 800, h: 110 })
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const measure = () => {
      const rect = el.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) setSize({ w: rect.width, h: rect.height })
    }
    measure()
    const obs = new ResizeObserver(measure)
    obs.observe(el)
    return () => obs.disconnect()
  }, [])
  const { w, h } = size
  const yMin = -3
  const yMax = 3
  function yOf(v: number): number {
    const c = Math.max(yMin, Math.min(yMax, v))
    return PAD_T + (1 - (c - yMin) / (yMax - yMin)) * (h - PAD_T - 8)
  }
  function xOf(i: number): number {
    if (points.length === 1) return PAD_L
    return PAD_L + (i / (points.length - 1)) * (w - PAD_L - PAD_R)
  }
  const parts: string[] = []
  let drawing = false
  zSeries.forEach((z, i) => {
    if (z == null || !Number.isFinite(z)) { drawing = false; return }
    parts.push(`${drawing ? 'L' : 'M'}${xOf(i).toFixed(2)},${yOf(z).toFixed(2)}`)
    drawing = true
  })
  return (
    <div
      ref={wrapRef}
      className="pairs-osc"
      onPointerMove={e => {
        const rect = e.currentTarget.getBoundingClientRect()
        const x = ((e.clientX - rect.left) / rect.width) * w
        const rel = (x - PAD_L) / (w - PAD_L - PAD_R)
        const index = Math.max(0, Math.min(points.length - 1, Math.round(rel * (points.length - 1))))
        onHover({ index, xPct: (xOf(index) / w) * 100, yPct: 0 })
      }}
      onPointerLeave={() => onHover(null)}
    >
      <div className="pairs-osc-label">Z-score · 20d</div>
      <svg viewBox={`0 0 ${w} ${h}`}>
        {[-2, 0, 2].map(v => (
          <g key={v}>
            <line x1={PAD_L} x2={w - PAD_R} y1={yOf(v)} y2={yOf(v)} stroke={v === 0 ? 'var(--border-light)' : 'var(--border)'} strokeDasharray={v === 0 ? undefined : '4 4'} vectorEffect="non-scaling-stroke" />
            <text x={PAD_L - 8} y={yOf(v)} fill="var(--text-4)" fontSize={11} textAnchor="end" dominantBaseline="middle">{v}</text>
          </g>
        ))}
        <path d={parts.join(' ')} fill="none" stroke="#38bdf8" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        {hoverIndex != null && (
          <line x1={xOf(hoverIndex)} x2={xOf(hoverIndex)} y1={PAD_T} y2={h - 8} stroke="var(--text-4)" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
        )}
      </svg>
    </div>
  )
}

function xTickIndexes(points: RatioPoint[], count = 6): number[] {
  if (points.length === 0) return []
  const n = Math.min(count, points.length)
  const out: number[] = []
  for (let i = 0; i < n; i++) out.push(Math.round((i * (points.length - 1)) / Math.max(n - 1, 1)))
  return [...new Set(out)]
}
