/**
 * Global markets overview — flat (equirectangular) world map with country
 * outlines, a dot + name/%-change label per major exchange (green/pulsing
 * if trading is currently open, gray if closed), region zoom buttons, and
 * a scrollable side list with a sparkline per exchange. Country shapes
 * come from world-atlas (bundled, no runtime fetch); prices come from
 * /api/markets, refreshed on a short interval.
 */
import { useEffect, useMemo, useState } from 'react'
import { geoEquirectangular, geoPath } from 'd3-geo'
import { feature, mesh } from 'topojson-client'
import type { Topology, GeometryCollection, Objects } from 'topojson-specification'
import countriesTopology from '../../data/countries-110m.json'
import { EXCHANGES, type Exchange } from '../../data/exchanges'
import { isExchangeOpen } from '../../utils/marketHours'
import { fetchMarketQuotes, type MarketQuote } from '../../services/markets'

const WIDTH = 960
const HEIGHT = 460
const REFRESH_MS = 60_000

const topology = countriesTopology as unknown as Topology<Objects<{ name?: string }>>
const countries = feature(topology, topology.objects.countries as GeometryCollection)
const countryBorders = mesh(topology, topology.objects.countries as GeometryCollection, (a, b) => a !== b)

const projection = geoEquirectangular().fitSize([WIDTH, HEIGHT], countries)
const pathGen = geoPath(projection)
const countriesPath = pathGen(countries) ?? ''
const bordersPath = pathGen(countryBorders) ?? ''

/**
 * Region zoom presets — lon/lat bounding boxes fed through the same fixed
 * projection to crop the SVG viewBox, which reads as "zooming in" without
 * needing a separate projection per region.
 */
type Region = 'global' | 'america' | 'europe' | 'asia'
const REGIONS: Record<Region, { label: string; lonMin: number; lonMax: number; latMin: number; latMax: number }> = {
  global:  { label: 'Global Indices', lonMin: -110, lonMax: 165, latMin: -58, latMax: 75 },
  america: { label: 'America',        lonMin: -125, lonMax: -35, latMin: -35, latMax: 58 },
  europe:  { label: 'Europe',         lonMin: -15,  lonMax: 42,  latMin: 33,  latMax: 62 },
  asia:    { label: 'Asia',           lonMin: 65,   lonMax: 155, latMin: -40, latMax: 45 },
}

function getCrop(region: Region) {
  const r = REGIONS[region]
  const y0 = projection([0, r.latMax])![1]
  const y1 = projection([0, r.latMin])![1]
  const x0 = projection([r.lonMin, 0])![0]
  const x1 = projection([r.lonMax, 0])![0]
  return { x0, y0, width: x1 - x0, height: y1 - y0 }
}

const GLOBAL_CROP_WIDTH = getCrop('global').width

function fmtPrice(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** Tiny intraday line+area chart from a quote's 15m closes, like a mini stock ticker chart. */
function Sparkline({ data, color, width = 72, height = 28 }: { data: number[]; color: string; width?: number; height?: number }) {
  if (data.length < 2) {
    return <svg width={width} height={height} style={{ flexShrink: 0 }} />
  }
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width
    const y = height - ((v - min) / range) * height
    return [x, y] as const
  })
  const linePath = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const areaPath = `${linePath} L${width},${height} L0,${height} Z`

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ flexShrink: 0 }}>
      <path d={areaPath} fill={color} opacity={0.12} />
      <path d={linePath} fill="none" stroke={color} strokeWidth={1.3} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

interface CityGroup {
  city: string
  country: string
  lat: number
  lon: number
  exchanges: Exchange[]
}

function groupByCity(exchanges: Exchange[]): CityGroup[] {
  const groups = new Map<string, CityGroup>()
  for (const ex of exchanges) {
    const key = ex.mapGroup ?? `${ex.city}|${ex.country}`
    let g = groups.get(key)
    if (!g) { g = { city: ex.city, country: ex.country, lat: ex.lat, lon: ex.lon, exchanges: [] }; groups.set(key, g) }
    g.exchanges.push(ex)
  }
  return [...groups.values()]
}

/**
 * Which direction a city's label fans out from its dot. Cities that sit
 * close together on the map (Europe, East Asia, SE Asia) get manually
 * spread in different directions so their labels don't collide.
 */
type Anchor = 'left' | 'right' | 'top' | 'bottom'
const LABEL_ANCHOR: Record<string, Anchor> = {
  'Toronto':      'top',
  'London':       'left',
  'Paris':        'bottom',
  'Frankfurt':    'top',
  'Milan':        'bottom',
  'Moscow':       'right',
  'Shanghai':     'left',
  'Seoul':        'top',
  'Hong Kong':    'bottom',
  'Taipei':       'right',
  'Kuala Lumpur': 'top',
  'Singapore':    'bottom',
  'Sydney':       'left',
  'Tokyo':        'left',
}

/**
 * One dot per city cluster, with a stacked name+% label fanned out per
 * LABEL_ANCHOR. `scale` counteracts the zoom-region crop so dots/labels
 * stay a constant apparent screen size instead of blowing up when a
 * narrower (more zoomed-in) region is selected.
 */
function CityMarker({
  group, quotes, now, onHover, scale,
}: {
  group: CityGroup
  quotes: Record<string, MarketQuote>
  now: Date
  onHover: (group: CityGroup | null, pos: { x: number; y: number } | null) => void
  scale: number
}) {
  const pt = projection([group.lon, group.lat])
  if (!pt) return null
  const [x, y] = pt
  const anyOpen = group.exchanges.some(ex => isExchangeOpen(ex, now))
  const dotColor = !anyOpen ? 'var(--text-4)' : '#10b981'

  const anchor = LABEL_ANCHOR[group.city] ?? 'right'
  const lineHeight = 9.5 * scale
  const n = group.exchanges.length
  const textAnchor = anchor === 'left' ? 'end' : anchor === 'right' ? 'start' : 'middle'
  const labelX = anchor === 'left' ? -6 * scale : anchor === 'right' ? 6 * scale : 0
  // For top/bottom anchors the whole stack sits above/below the dot; for left/right it's vertically centered on it.
  const stackStartY = anchor === 'top' ? -7 * scale - (n - 1) * lineHeight
    : anchor === 'bottom' ? 7 * scale + lineHeight * 0.3
    : -((n - 1) * lineHeight) / 2 + 2.5 * scale

  return (
    <g
      transform={`translate(${x}, ${y})`}
      onMouseEnter={() => onHover(group, { x, y })}
      onMouseLeave={() => onHover(null, null)}
      style={{ cursor: 'pointer' }}
    >
      {anyOpen && (
        <circle r={6 * scale} fill={dotColor} opacity={0.35}>
          <animate attributeName="r" values={`${5 * scale};${10 * scale};${5 * scale}`} dur="2s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.35;0;0.35" dur="2s" repeatCount="indefinite" />
        </circle>
      )}
      {/* Larger invisible hit target for easier hovering */}
      <circle r={8 * scale} fill="transparent" />
      <circle r={3.5 * scale} fill={dotColor} stroke="var(--bg-surface)" strokeWidth={scale} />

      {group.exchanges.map((ex, i) => {
        const q = quotes[ex.symbol]
        const changeColor = !q ? 'var(--text-3)' : q.change >= 0 ? '#10b981' : '#f43f5e'
        const rowY = stackStartY + i * lineHeight
        return (
          <text key={ex.symbol} x={labelX} y={rowY} textAnchor={textAnchor}
            fontSize={7.5 * scale} fontFamily="Inter, sans-serif" fontWeight={700} fill="var(--text-2)"
            style={{ paintOrder: 'stroke', stroke: 'var(--bg-surface)', strokeWidth: 2.5 * scale }}>
            {ex.name}
            {q && (
              <tspan fill={changeColor} fontWeight={600}>
                {'  '}{q.changePercent >= 0 ? '+' : ''}{q.changePercent.toFixed(2)}%
              </tspan>
            )}
          </text>
        )
      })}
    </g>
  )
}

export default function MarketsView() {
  const [quotes, setQuotes] = useState<Record<string, MarketQuote>>({})
  const [now, setNow] = useState(() => new Date())
  const [hover, setHover] = useState<{ group: CityGroup; pos: { x: number; y: number } } | null>(null)
  const [region, setRegion] = useState<Region>('global')

  const symbols = useMemo(() => EXCHANGES.map(e => e.symbol), [])
  const cityGroups = useMemo(() => groupByCity(EXCHANGES), [])
  const crop = useMemo(() => getCrop(region), [region])
  const markerScale = crop.width / GLOBAL_CROP_WIDTH

  useEffect(() => {
    let cancelled = false
    async function load() {
      const data = await fetchMarketQuotes(symbols)
      if (!cancelled && Object.keys(data).length > 0) setQuotes(data)
    }
    load()
    const priceTimer = setInterval(load, REFRESH_MS)
    const clockTimer = setInterval(() => setNow(new Date()), 30_000)
    return () => { cancelled = true; clearInterval(priceTimer); clearInterval(clockTimer) }
  }, [symbols])

  const openCount = EXCHANGES.filter(ex => isExchangeOpen(ex, now)).length

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: '20px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-1)', margin: 0 }}>Markets</h2>
        <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
          {openCount} of {EXCHANGES.length} exchanges open
        </span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: 'var(--text-4)' }}>
          Updated {now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>

      {/* Region zoom buttons */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        {(Object.keys(REGIONS) as Region[]).map(r => (
          <button
            key={r}
            onClick={() => setRegion(r)}
            style={{
              fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 6,
              border: `1px solid ${region === r ? '#8b5cf6' : 'var(--border)'}`,
              background: region === r ? '#8b5cf61a' : 'var(--bg-card)',
              color: region === r ? '#8b5cf6' : 'var(--text-3)',
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            {REGIONS[r].label}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 16, alignItems: 'stretch' }}>
        {/* World map */}
        <div style={{
          position: 'relative', flex: 1, minWidth: 0, background: 'var(--bg-card)', border: '1px solid var(--border)',
          borderRadius: 8, padding: 8, overflow: 'hidden',
        }}>
          <svg viewBox={`${crop.x0} ${crop.y0} ${crop.width} ${crop.height}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
            <rect x={crop.x0} y={crop.y0} width={crop.width} height={crop.height} fill="var(--bg-surface)" />
            <path d={countriesPath} fill="var(--bg-active)" fillRule="evenodd" />
            <path d={bordersPath} fill="none" stroke="var(--border)" strokeWidth={0.6} />
            {cityGroups.map(g => (
              <CityMarker
                key={`${g.city}|${g.country}`}
                group={g}
                quotes={quotes}
                now={now}
                scale={markerScale}
                onHover={(group, pos) => setHover(group && pos ? { group, pos } : null)}
              />
            ))}
          </svg>

          {hover && (
            <div style={{
              position: 'absolute',
              left: `${((hover.pos.x - crop.x0) / crop.width) * 100}%`,
              top: `${((hover.pos.y - crop.y0) / crop.height) * 100}%`,
              transform: 'translate(-50%, -100%) translateY(-10px)',
              background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6,
              padding: '6px 8px', pointerEvents: 'none', whiteSpace: 'nowrap', zIndex: 1,
              boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            }}>
              <div style={{ fontSize: 10, color: 'var(--text-4)', marginBottom: 2 }}>
                {hover.group.city}, {hover.group.country}
              </div>
              {hover.group.exchanges.map(ex => {
                const q = quotes[ex.symbol]
                const changeColor = !q ? 'var(--text-3)' : q.change >= 0 ? '#10b981' : '#f43f5e'
                const open = isExchangeOpen(ex, now)
                return (
                  <div key={ex.symbol} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5 }}>
                    <span style={{ width: 5, height: 5, borderRadius: '50%', background: open ? '#10b981' : 'var(--text-4)', flexShrink: 0 }} />
                    <span style={{ fontWeight: 700, color: 'var(--text-1)' }}>{ex.name}</span>
                    {q && (
                      <span style={{ fontWeight: 600, color: changeColor, fontFamily: 'Inter, sans-serif' }}>
                        {q.changePercent >= 0 ? '+' : ''}{q.changePercent.toFixed(2)}%
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Scrollable side list — all exchanges with a sparkline each */}
        <div style={{
          width: 280, flexShrink: 0, background: 'var(--bg-card)', border: '1px solid var(--border)',
          borderRadius: 8, overflowY: 'auto', maxHeight: 560,
        }}>
          {EXCHANGES.map((ex, i) => {
            const q = quotes[ex.symbol]
            const open = isExchangeOpen(ex, now)
            const color = !q ? 'var(--text-3)' : q.change >= 0 ? '#10b981' : '#f43f5e'
            return (
              <div key={ex.symbol} style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px',
                borderTop: i === 0 ? 'none' : '1px solid var(--border-light)',
              }}>
                <span style={{
                  width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                  background: open ? '#10b981' : 'var(--text-4)',
                }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {ex.name}
                  </div>
                  {q ? (
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 700, fontFamily: 'Inter, sans-serif', color: 'var(--text-1)' }}>
                        {fmtPrice(q.price)}
                      </span>
                      <span style={{ fontSize: 10.5, fontWeight: 600, fontFamily: 'Inter, sans-serif', color }}>
                        {q.change >= 0 ? '+' : ''}{q.changePercent.toFixed(2)}%
                      </span>
                    </div>
                  ) : (
                    <span style={{ fontSize: 11, color: 'var(--text-4)' }}>—</span>
                  )}
                </div>
                {q && q.sparkline.length > 1 && <Sparkline data={q.sparkline} color={color} width={60} height={26} />}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
