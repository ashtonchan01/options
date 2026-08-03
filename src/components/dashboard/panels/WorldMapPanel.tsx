/**
 * Compact global exchanges map for the Dashboard overview — same flat
 * equirectangular projection and region zoom as the Markets page. Every
 * city gets an inline label; hovering a city brings its label to the
 * front (drawn last) so it reads clearly even over crowded neighbors.
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

function fmtPrice(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function leadExchange(group: CityGroup, quotes: Record<string, MarketQuote>): Exchange | null {
  const withQuotes = group.exchanges.filter(ex => quotes[ex.symbol])
  if (withQuotes.length === 0) return null
  return withQuotes.reduce((a, b) => Math.abs(quotes[b.symbol].changePercent) > Math.abs(quotes[a.symbol].changePercent) ? b : a)
}

function CityMarker({
  group, quotes, now, scale, isHovered, onHover,
}: {
  group: CityGroup
  quotes: Record<string, MarketQuote>
  now: Date
  scale: number
  isHovered: boolean
  onHover: (group: CityGroup | null, pos: { x: number; y: number } | null) => void
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
  const labelScale = isHovered ? 1.35 : 1

  return (
    <g
      transform={`translate(${x}, ${y})`}
      onMouseEnter={() => onHover(group, { x, y })}
      onMouseLeave={() => onHover(null, null)}
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

      <text x={labelX * labelScale} y={labelY * labelScale} textAnchor={textAnchor}
        fontSize={(isHovered ? 6.5 : 5) * scale} fontFamily="Inter, sans-serif" fontWeight={isHovered ? 600 : 400}
        fill={isHovered ? 'var(--text-1)' : 'var(--text-3)'}
        style={{ paintOrder: 'stroke', stroke: 'var(--bg-surface)', strokeWidth: (isHovered ? 2.5 : 1.2) * scale }}>
        {group.exchanges.length > 1 ? group.city : group.exchanges[0].name}
        {leadQuote && (
          <tspan fill={changeColor} fontWeight={isHovered ? 700 : 400}>
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
  const [hover, setHover] = useState<{ group: CityGroup; x: number; y: number } | null>(null)

  const crop = useMemo(() => getCrop(region), [region])
  const scale = crop.width / GLOBAL_CROP_WIDTH

  // Draw the hovered city last so its label renders on top of any crowded neighbors.
  const orderedCityGroups = useMemo(() => {
    if (!hover) return cityGroups
    const key = `${hover.group.city}|${hover.group.country}`
    return [...cityGroups].sort((a, b) => {
      const aHover = `${a.city}|${a.country}` === key ? 1 : 0
      const bHover = `${b.city}|${b.country}` === key ? 1 : 0
      return aHover - bHover
    })
  }, [cityGroups, hover])

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
          {orderedCityGroups.map(g => (
            <CityMarker
              key={`${g.city}|${g.country}`}
              group={g}
              quotes={quotes}
              now={now}
              scale={scale}
              isHovered={hover ? `${hover.group.city}|${hover.group.country}` === `${g.city}|${g.country}` : false}
              onHover={(group, pos) => setHover(group && pos ? { group, x: pos.x, y: pos.y } : null)}
            />
          ))}
        </svg>

        {hover && (
          <div style={{
            position: 'absolute',
            left: `${((hover.x - crop.x0) / crop.width) * 100}%`,
            top: `${((hover.y - crop.y0) / crop.height) * 100}%`,
            transform: 'translate(-50%, -100%) translateY(-8px)',
            background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6,
            padding: '6px 8px', pointerEvents: 'none', whiteSpace: 'nowrap', zIndex: 1,
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          }}>
            <div style={{ fontSize: 9.5, color: 'var(--text-4)', marginBottom: 2 }}>
              {hover.group.city}, {hover.group.country}
            </div>
            {hover.group.exchanges.map(ex => {
              const q = quotes[ex.symbol]
              const color = !q ? 'var(--text-3)' : q.change >= 0 ? '#10b981' : '#f43f5e'
              const open = isExchangeOpen(ex, now)
              return (
                <div key={ex.symbol} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: open ? '#10b981' : 'var(--text-4)', flexShrink: 0 }} />
                  <span style={{ fontWeight: 700, color: 'var(--text-1)' }}>{ex.name}</span>
                  {q ? (
                    <>
                      <span style={{ fontFamily: 'Inter, sans-serif', color: 'var(--text-2)' }}>{fmtPrice(q.price)}</span>
                      <span style={{ fontWeight: 600, color, fontFamily: 'Inter, sans-serif' }}>
                        {q.changePercent >= 0 ? '+' : ''}{q.changePercent.toFixed(2)}%
                      </span>
                    </>
                  ) : (
                    <span style={{ color: 'var(--text-4)' }}>—</span>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
