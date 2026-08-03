/**
 * Compact global exchanges map for the Dashboard overview — same flat
 * equirectangular projection as the Markets page, with a %-change label
 * per city and a hover tooltip showing price, without the region buttons
 * or side list (those live in the Markets tab / LiveChartsStrip).
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

function fmtPrice(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function WorldMapPanel({ quotes, now }: { quotes: Record<string, MarketQuote>; now: Date }) {
  const cityGroups = useMemo(() => groupByCity(EXCHANGES), [])
  const openCount = EXCHANGES.filter(ex => isExchangeOpen(ex, now)).length
  const [hover, setHover] = useState<{ group: CityGroup; x: number; y: number } | null>(null)

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
            // Lead exchange for this city's inline label — the one with the largest |% change|, if any quotes loaded
            const withQuotes = g.exchanges.filter(ex => quotes[ex.symbol])
            const lead = withQuotes.length > 0
              ? withQuotes.reduce((a, b) => Math.abs(quotes[b.symbol].changePercent) > Math.abs(quotes[a.symbol].changePercent) ? b : a)
              : null
            const leadQuote = lead ? quotes[lead.symbol] : null
            const changeColor = !leadQuote ? 'var(--text-4)' : leadQuote.changePercent >= 0 ? '#10b981' : '#f43f5e'
            return (
              <g
                key={`${g.city}|${g.country}`}
                transform={`translate(${x}, ${y})`}
                onMouseEnter={() => setHover({ group: g, x, y })}
                onMouseLeave={() => setHover(null)}
                style={{ cursor: 'pointer' }}
              >
                {anyOpen && (
                  <circle r={5} fill={color} opacity={0.35}>
                    <animate attributeName="r" values="4;8;4" dur="2s" repeatCount="indefinite" />
                    <animate attributeName="opacity" values="0.35;0;0.35" dur="2s" repeatCount="indefinite" />
                  </circle>
                )}
                <circle r={7} fill="transparent" />
                <circle r={2.6} fill={color} stroke="var(--bg-surface)" strokeWidth={0.8} />
                {leadQuote && (
                  <text x={5} y={2.5} fontSize={6.5} fontFamily="Inter, sans-serif" fontWeight={700} fill={changeColor}
                    style={{ paintOrder: 'stroke', stroke: 'var(--bg-surface)', strokeWidth: 2 }}>
                    {leadQuote.changePercent >= 0 ? '+' : ''}{leadQuote.changePercent.toFixed(1)}%
                  </text>
                )}
              </g>
            )
          })}
        </svg>

        {hover && (
          <div style={{
            position: 'absolute',
            left: `${(hover.x / WIDTH) * 100}%`,
            top: `${(hover.y / HEIGHT) * 100}%`,
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
