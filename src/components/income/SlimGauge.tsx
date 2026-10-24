/**
 * One slim progress bar for Income: This month, Target breakdown, and the
 * crypto gauge. Height, radius, and label type are the same everywhere.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'

const BAR_H = 11
const LABEL_H = 14
const LABEL_GAP = 3
const CHAR_W = 11 * 0.58

export interface SlimSegment {
  key: string
  value: number
  color: string
  /** Labels with this key sit on the combined span of every matching slice. */
  labelKey?: string
}

export interface SlimLabel {
  key: string
  text: string
  abbrev?: string[]
}

export interface SlimMarker {
  /** Fraction of the bar, 0–1. */
  at: number
  text: string
}

function textWidth(text: string): number {
  return Math.ceil(text.length * CHAR_W)
}

function inkFor(color: string): string {
  if (color.startsWith('hsl') || color.startsWith('var(')) return '#1c1917'
  const hex = color.replace('#', '')
  if (hex.length < 6) return '#1c1917'
  const r = Number.parseInt(hex.slice(0, 2), 16)
  const g = Number.parseInt(hex.slice(2, 4), 16)
  const b = Number.parseInt(hex.slice(4, 6), 16)
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#1c1917' : '#fff'
}

interface Box { left: number; right: number; top: number; bottom: number }

function hits(placed: Box[], left: number, top: number, width: number): boolean {
  const right = left + width
  const bottom = top + LABEL_H
  return placed.some(box => left < box.right + 4 && right > box.left - 4 && top < box.bottom && bottom > box.top)
}

export default function SlimGauge({
  segments,
  labels = [],
  marker = null,
  total,
  ariaLabel,
}: {
  segments: SlimSegment[]
  labels?: SlimLabel[]
  marker?: SlimMarker | null
  /** When set, slices are fractions of this total and the rest of the bar stays empty. */
  total?: number
  ariaLabel: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setWidth(el.clientWidth)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const sum = segments.reduce((acc, seg) => acc + (seg.value > 0 ? seg.value : 0), 0)
  const scale = total != null && total > 0 ? total : sum
  const barTop = LABEL_H + LABEL_GAP
  const nodes: ReactNode[] = []
  let below = false

  if (width > 0 && scale > 0) {
    const spans = new Map<string, { left: number; width: number; color: string }>()
    let cursor = 0
    for (const seg of segments) {
      if (!(seg.value > 0)) continue
      const pieceW = (seg.value / scale) * width
      const key = seg.labelKey ?? seg.key
      const prev = spans.get(key)
      if (prev && Math.abs(prev.left + prev.width - cursor) < 1) prev.width += pieceW
      else if (!prev || pieceW > prev.width) spans.set(key, { left: cursor, width: pieceW, color: seg.color })
      cursor += pieceW
    }
    const placed: Box[] = []
    const pin = (key: string, text: string, left: number, top: number, color?: string) => {
      const textW = textWidth(text)
      placed.push({ left, right: left + textW, top, bottom: top + LABEL_H })
      if (top >= barTop + BAR_H) below = true
      nodes.push(
        <span key={key} className="income-slim-label" style={{ left, top, width: textW, color }}>{text}</span>,
      )
    }
    for (const label of labels) {
      const span = spans.get(label.key)
      const options = [label.text, ...(label.abbrev ?? [])].filter(Boolean)
      const segW = span?.width ?? 0
      const inside = options.find(option => textWidth(option) + 8 <= segW && LABEL_H <= BAR_H)
      if (inside && span) {
        const textW = textWidth(inside)
        pin(label.key, inside, span.left + (span.width - textW) / 2, barTop + (BAR_H - LABEL_H) / 2, inkFor(span.color))
        continue
      }
      let chosen = options[0] ?? ''
      let textW = textWidth(chosen)
      const center = span ? span.left + span.width / 2 : 0
      let left = Math.max(0, Math.min(width - textW, center - textW / 2))
      let top = 0
      let guard = 0
      while (hits(placed, left, top, textW) && guard < options.length + 2) {
        const next = options[Math.min(guard + 1, options.length - 1)]
        if (next && next !== chosen && guard < options.length) {
          chosen = next
          textW = textWidth(chosen)
          left = Math.max(0, Math.min(width - textW, center - textW / 2))
        } else {
          top = barTop + BAR_H + LABEL_GAP
          left = Math.max(0, Math.min(width - textW, center - textW / 2))
        }
        guard += 1
      }
      if (chosen) pin(label.key, chosen, left, top)
    }
    if (marker && marker.at > 0 && marker.at < 1) {
      const mark = marker.at * width
      const chosen = marker.text
      const textW = textWidth(chosen)
      const clamp = (left: number) => Math.max(0, Math.min(width - textW, left))
      const candidates = [
        { left: clamp(mark - textW / 2), top: 0 },
        { left: clamp(mark - textW - 4), top: 0 },
        { left: clamp(mark + 4), top: 0 },
        { left: clamp(mark - textW / 2), top: barTop + BAR_H + LABEL_GAP },
      ]
      const spot = candidates.find(candidate => !hits(placed, candidate.left, candidate.top, textW))
      if (spot) pin('marker', chosen, spot.left, spot.top)
    }
  }

  const height = barTop + BAR_H + (below ? LABEL_GAP + LABEL_H : 0)
  const markerAt = marker != null && marker.at > 0 && marker.at < 1 && scale > 0 ? marker.at : null

  return (
    <div ref={ref} className="income-slim" style={{ height }} role="img" aria-label={ariaLabel}>
      {nodes}
      <div className="income-slim-bar" style={{ top: barTop }}>
        {scale > 0 ? segments.filter(seg => seg.value > 0).map(seg => (
          <span key={seg.key} style={{ flex: `0 0 ${(seg.value / scale) * 100}%`, background: seg.color }} />
        )) : <span className="income-slim-empty" />}
      </div>
      {markerAt != null && <i className="income-slim-cap" style={{ left: `${markerAt * 100}%`, top: barTop - 3 }} />}
    </div>
  )
}
