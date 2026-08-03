/**
 * Compact global exchanges map for the Dashboard overview — same flat
 * equirectangular projection, region zoom, and always-on per-exchange
 * labels as the Markets page.
 */
import { useMemo, useState } from 'react'
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

/** Which direction a city's label fans out from its dot — same layout as the Markets tab. */
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

function CityMarker({
  group, quotes, now, scale,
}: {
  group: CityGroup
  quotes: Record<string, MarketQuote>
  now: Date
  scale: number
}) {
  const pt = projection([group.lon, group.lat])
  if (!pt) return null
  const [x, y] = pt
  const anyOpen = group.exchanges.some(ex => isExchangeOpen(ex, now))
  const dotColor = !anyOpen ? 'var(--text-4)' : '#10b981'

  const anchor = LABEL_ANCHOR[group.city] ?? 'right'
  const lineHeight = 8.5 * scale
  const n = group.exchanges.length
  const textAnchor = anchor === 'left' ? 'end' : anchor === 'right' ? 'start' : 'middle'
  const labelX = anchor === 'left' ? -6 * scale : anchor === 'right' ? 6 * scale : 0
  const stackStartY = anchor === 'top' ? -7 * scale - (n - 1) * lineHeight
    : anchor === 'bottom' ? 7 * scale + lineHeight * 0.3
    : -((n - 1) * lineHeight) / 2 + 2.5 * scale

  return (
    <g transform={`translate(${x}, ${y})`}>
      {anyOpen && (
        <circle r={5 * scale} fill={dotColor} opacity={0.35}>
          <animate attributeName="r" values={`${4 * scale};${8 * scale};${4 * scale}`} dur="2s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.35;0;0.35" dur="2s" repeatCount="indefinite" />
        </circle>
      )}
      <circle r={2.6 * scale} fill={dotColor} stroke="var(--bg-surface)" strokeWidth={0.8 * scale} />

      {group.exchanges.map((ex, i) => {
        const q = quotes[ex.symbol]
        const changeColor = !q ? 'var(--text-3)' : q.change >= 0 ? '#10b981' : '#f43f5e'
        const rowY = stackStartY + i * lineHeight
        return (
          <text key={ex.symbol} x={labelX} y={rowY} textAnchor={textAnchor}
            fontSize={6.5 * scale} fontFamily="Inter, sans-serif" fontWeight={400} fill="var(--text-2)"
            style={{ paintOrder: 'stroke', stroke: 'var(--bg-surface)', strokeWidth: 2 * scale }}>
            {ex.name}
            {q && (
              <tspan fill={changeColor} fontWeight={400}>
                {'  '}{q.changePercent >= 0 ? '+' : ''}{q.changePercent.toFixed(2)}%
              </tspan>
            )}
          </text>
        )
      })}
    </g>
  )
}

export default function WorldMapPanel({ quotes, now }: { quotes: Record<string, MarketQuote>; now: Date }) {
  const cityGroups = useMemo(() => groupByCity(EXCHANGES), [])
  const openCount = EXCHANGES.filter(ex => isExchangeOpen(ex, now)).length
  const [region, setRegion] = useState<Region>('global')

  const crop = useMemo(() => getCrop(region), [region])
  const scale = crop.width / GLOBAL_CROP_WIDTH

  return (
    <div className="dash-panel">
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

      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
        <svg viewBox={`${crop.x0} ${crop.y0} ${crop.width} ${crop.height}`} style={{ width: '100%', height: '100%', display: 'block' }}>
          <rect x={crop.x0} y={crop.y0} width={crop.width} height={crop.height} fill="var(--bg-surface)" />
          <path d={countriesPath} fill="var(--bg-active)" fillRule="evenodd" />
          <path d={bordersPath} fill="none" stroke="var(--border)" strokeWidth={0.5} />
          {cityGroups.map(g => (
            <CityMarker key={`${g.city}|${g.country}`} group={g} quotes={quotes} now={now} scale={scale} />
          ))}
        </svg>
      </div>
    </div>
  )
}
