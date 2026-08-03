/**
 * Compact global exchanges map for the Dashboard overview — same flat
 * equirectangular projection as the Markets page, without the region
 * buttons or side list (those live in the Markets tab / LiveChartsStrip).
 */
import { useMemo } from 'react'
import { geoEquirectangular, geoPath } from 'd3-geo'
import { feature, mesh } from 'topojson-client'
import type { Topology, GeometryCollection, Objects } from 'topojson-specification'
import countriesTopology from '../../../data/countries-110m.json'
import { EXCHANGES, type Exchange } from '../../../data/exchanges'
import { isExchangeOpen } from '../../../utils/marketHours'

const WIDTH = 480
const HEIGHT = 260

const topology = countriesTopology as unknown as Topology<Objects<{ name?: string }>>
const countries = feature(topology, topology.objects.countries as GeometryCollection)
const countryBorders = mesh(topology, topology.objects.countries as GeometryCollection, (a, b) => a !== b)
const projection = geoEquirectangular().fitSize([WIDTH, HEIGHT], countries)
const pathGen = geoPath(projection)
const countriesPath = pathGen(countries) ?? ''
const bordersPath = pathGen(countryBorders) ?? ''

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

export default function WorldMapPanel({ now }: { now: Date }) {
  const cityGroups = useMemo(() => groupByCity(EXCHANGES), [])
  const openCount = EXCHANGES.filter(ex => isExchangeOpen(ex, now)).length

  return (
    <div className="dash-panel">
      <div className="dash-panel-header">
        <span>World Markets</span>
        <span className="dash-panel-sub">{openCount} of {EXCHANGES.length} open</span>
      </div>
      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} style={{ width: '100%', height: '100%', display: 'block' }}>
          <rect x={0} y={0} width={WIDTH} height={HEIGHT} fill="var(--bg-surface)" />
          <path d={countriesPath} fill="var(--bg-active)" fillRule="evenodd" />
          <path d={bordersPath} fill="none" stroke="var(--border)" strokeWidth={0.5} />
          {cityGroups.map(g => {
            const pt = projection([g.lon, g.lat])
            if (!pt) return null
            const [x, y] = pt
            const anyOpen = g.exchanges.some(ex => isExchangeOpen(ex, now))
            const color = anyOpen ? '#10b981' : 'var(--text-4)'
            return (
              <g key={`${g.city}|${g.country}`} transform={`translate(${x}, ${y})`}>
                {anyOpen && (
                  <circle r={5} fill={color} opacity={0.35}>
                    <animate attributeName="r" values="4;8;4" dur="2s" repeatCount="indefinite" />
                    <animate attributeName="opacity" values="0.35;0;0.35" dur="2s" repeatCount="indefinite" />
                  </circle>
                )}
                <circle r={2.6} fill={color} stroke="var(--bg-surface)" strokeWidth={0.8} />
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}
