/**
 * Compact global exchanges map for the Dashboard overview — same flat
 * equirectangular projection and region zoom as the Markets page. Every
 * city gets an inline label; hovering a city brings its label to the
 * front (drawn last) so it reads clearly even over crowded neighbors.
 */
import { useMemo, useState, useRef, useLayoutEffect } from 'react'
import { geoEquirectangular, geoPath } from 'd3-geo'
import { feature, mesh } from 'topojson-client'
import type { Topology, GeometryCollection, Objects } from 'topojson-specification'
import countriesTopology from '../../../data/countries-110m.json'
import { EXCHANGES, type Exchange } from '../../../data/exchanges'
import { isExchangeOpen } from '../../../utils/marketHours'
import type { MarketQuote } from '../../../services/markets'

const WIDTH = 480
const HEIGHT = 260

const topology = countriesTopology as unknown as Topology<Objects<{ name?: string }>>
const countries = feature(topology, topology.objects.countries as GeometryCollection)
const countryBorders = mesh(topology, topology.objects.countries as GeometryCollection, (a, b) => a !== b)
const projection = geoEquirectangular().fitSize([WIDTH, HEIGHT], countries)
const pathGen = geoPath(projection)
const countriesPath = pathGen(countries) ?? ''
const bordersPath = pathGen(countryBorders) ?? ''

type Region = 'global' | 'america' | 'europe' | 'asia'
const REGIONS: Record<Region, { label: string; lonMin: number; lonMax: number; latMin: number; latMax: number }> = {
  global:  { label: 'Global',  lonMin: -110, lonMax: 165, latMin: -58, latMax: 75 },
  america: { label: 'America', lonMin: -125, lonMax: -35, latMin: -35, latMax: 58 },
  europe:  { label: 'Europe',  lonMin: -15,  lonMax: 42,  latMin: 33,  latMax: 62 },
  asia:    { label: 'Asia',    lonMin: 65,   lonMax: 155, latMin: -40, latMax: 45 },
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

interface CityGroup { city: string; country: string; lat: number; lon: number; exchanges: Exchange[] }

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

function leadExchange(group: CityGroup, quotes: Record<string, MarketQuote>): Exchange | null {
  const withQuotes = group.exchanges.filter(ex => quotes[ex.symbol])
  if (withQuotes.length === 0) return null
  return withQuotes.reduce((a, b) => Math.abs(quotes[b.symbol].changePercent) > Math.abs(quotes[a.symbol].changePercent) ? b : a)
}

function CityMarker({
  group, quotes, now, scale, textScale, onHover,
}: {
  group: CityGroup
  quotes: Record<string, MarketQuote>
  now: Date
  scale: number
  textScale: number
  onHover: (group: CityGroup | null) => void
}) {
  const pt = projection([group.lon, group.lat])
  if (!pt) return null
  const [x, y] = pt
  const anyOpen = group.exchanges.some(ex => isExchangeOpen(ex, now))
  const dotColor = !anyOpen ? 'var(--text-4)' : '#10b981'
  const lead = leadExchange(group, quotes)
  const leadQuote = lead ? quotes[lead.symbol] : null
  const changeColor = !leadQuote ? 'var(--text-3)' : leadQuote.changePercent >= 0 ? '#10b981' : '#f43f5e'

  const anchor = LABEL_ANCHOR[group.city] ?? 'right'
  const textAnchor = anchor === 'left' ? 'end' : anchor === 'right' ? 'start' : 'middle'
  const labelX = anchor === 'left' ? -6 * scale : anchor === 'right' ? 6 * scale : 0
  const labelY = anchor === 'top' ? -7 * scale : anchor === 'bottom' ? 8.5 * scale : 2 * scale

  return (
    <g
      transform={`translate(${x}, ${y})`}
      onMouseEnter={() => onHover(group)}
      onMouseLeave={() => onHover(null)}
      style={{ cursor: 'pointer' }}
    >
      {anyOpen && (
        <circle r={3.2 * scale} fill={dotColor} opacity={0.35}>
          <animate attributeName="r" values={`${2.6 * scale};${5 * scale};${2.6 * scale}`} dur="2s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.35;0;0.35" dur="2s" repeatCount="indefinite" />
        </circle>
      )}
      <circle r={6 * scale} fill="transparent" />
      <circle r={1.6 * scale} fill={dotColor} stroke="var(--bg-surface)" strokeWidth={0.6 * scale} />

      {/* textScale is derived from the SVG's actual measured on-screen pixels
          per viewBox unit (see WorldMapPanel), not guessed from crop width
          alone — a width-only ratio was wrong whenever a region's aspect
          ratio forced the *height* to be the binding "meet" dimension
          instead (Europe's wide-short crop), which is what made both the
          scale-based (too small) and sqrt-scale-based (still too big on
          Europe specifically) attempts miscalibrate. This keeps rendered
          text a genuinely constant pixel size across every region. */}
      <text x={labelX} y={labelY} textAnchor={textAnchor}
        fontSize={13 * textScale} fontFamily="Inter, sans-serif" fontWeight={500} fill="var(--text-3)"
        style={{ paintOrder: 'stroke', stroke: 'var(--bg-surface)', strokeWidth: 2.8 * textScale }}>
        {group.exchanges.length > 1 ? group.city : group.exchanges[0].name}
        {leadQuote && (
          <tspan fill={changeColor} fontWeight={400}>
            {'  '}{leadQuote.changePercent >= 0 ? '+' : ''}{leadQuote.changePercent.toFixed(2)}%
          </tspan>
        )}
      </text>
    </g>
  )
}

export default function WorldMapPanel({ quotes, now }: { quotes: Record<string, MarketQuote>; now: Date }) {
  const cityGroups = useMemo(() => groupByCity(EXCHANGES), [])
  const openCount = EXCHANGES.filter(ex => isExchangeOpen(ex, now)).length
  const [region, setRegion] = useState<Region>('global')
  const [hover, setHover] = useState<CityGroup | null>(null)

  const crop = useMemo(() => getCrop(region), [region])
  const scale = crop.width / GLOBAL_CROP_WIDTH

  // The width-only `scale` ratio above only matches the SVG's actual
  // magnification when width is the binding "meet" dimension — Europe's
  // crop is much wider-than-tall relative to the panel, so height ends up
  // binding instead, and text sized off `scale` alone came out wrong just
  // for that region. Measure the real rendered px-per-viewBox-unit ratio
  // instead, so text can be sized to a genuinely constant on-screen pixel
  // size in every region regardless of which dimension is binding.
  const svgWrapRef = useRef<HTMLDivElement>(null)
  const [magnification, setMagnification] = useState(1)
  useLayoutEffect(() => {
    const el = svgWrapRef.current
    if (!el) return
    const measure = () => {
      const { width, height } = el.getBoundingClientRect()
      if (width === 0 || height === 0) return
      setMagnification(Math.min(width / crop.width, height / crop.height))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [crop])
  // Desired constant on-screen text size, expressed back in SVG units.
  const textScale = 1 / magnification

  // Draw the hovered city last so its label renders on top of any crowded neighbors.
  const orderedCityGroups = useMemo(() => {
    if (!hover) return cityGroups
    const key = `${hover.city}|${hover.country}`
    return [...cityGroups].sort((a, b) => {
      const aHover = `${a.city}|${a.country}` === key ? 1 : 0
      const bHover = `${b.city}|${b.country}` === key ? 1 : 0
      return aHover - bHover
    })
  }, [cityGroups, hover])

  return (
    <div className="dash-panel dash-map-panel">
      <div className="dash-panel-header">
        <span>World Markets</span>
        <span className="dash-panel-sub">{openCount} of {EXCHANGES.length} open</span>
      </div>

      <div style={{ display: 'flex', gap: 5 }}>
        {(Object.keys(REGIONS) as Region[]).map(r => (
          <button
            key={r}
            onClick={() => setRegion(r)}
            style={{
              fontSize: 10.5, fontWeight: 600, padding: '3px 9px', borderRadius: 5,
              border: `1px solid ${region === r ? '#8b5cf6' : 'var(--border)'}`,
              background: region === r ? '#8b5cf61a' : 'transparent',
              color: region === r ? '#8b5cf6' : 'var(--text-3)',
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            {REGIONS[r].label}
          </button>
        ))}
      </div>

      <div ref={svgWrapRef} style={{ flex: 1, position: 'relative', minHeight: 0 }}>
        <svg viewBox={`${crop.x0} ${crop.y0} ${crop.width} ${crop.height}`} style={{ width: '100%', height: '100%', display: 'block' }}>
          <rect x={crop.x0} y={crop.y0} width={crop.width} height={crop.height} fill="var(--bg-surface)" />
          <path d={countriesPath} fill="var(--bg-active)" fillRule="evenodd" />
          <path d={bordersPath} fill="none" stroke="var(--border)" strokeWidth={0.5} />
          {orderedCityGroups.map(g => (
            <CityMarker
              key={`${g.city}|${g.country}`}
              group={g}
              quotes={quotes}
              now={now}
              scale={scale}
              textScale={textScale}
              onHover={setHover}
            />
          ))}
        </svg>
      </div>
    </div>
  )
}
