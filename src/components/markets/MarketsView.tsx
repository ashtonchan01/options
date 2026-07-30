/**
 * Global markets overview — flat (equirectangular) world map with country
 * outlines and a dot per major exchange (green if trading is currently
 * open, gray if closed) plus a live quote list below. Country shapes come
 * from world-atlas (bundled, no runtime fetch); prices come from
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

function fmtPrice(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
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
    const key = `${ex.city}|${ex.country}`
    let g = groups.get(key)
    if (!g) { g = { city: ex.city, country: ex.country, lat: ex.lat, lon: ex.lon, exchanges: [] }; groups.set(key, g) }
    g.exchanges.push(ex)
  }
  return [...groups.values()]
}

/**
 * One dot per city cluster. Labels are left off the map (dense regions
 * like Europe / East Asia sit too close together at this scale to fit
 * text without overlapping) — hover shows a native tooltip, and the full
 * name/price/change lives in the grid below where there's room.
 */
function CityMarker({
  group, now, onHover,
}: {
  group: CityGroup
  now: Date
  onHover: (group: CityGroup | null, pos: { x: number; y: number } | null) => void
}) {
  const pt = projection([group.lon, group.lat])
  if (!pt) return null
  const [x, y] = pt
  const anyOpen = group.exchanges.some(ex => isExchangeOpen(ex, now))
  const dotColor = !anyOpen ? 'var(--text-4)' : '#10b981'

  return (
    <g
      transform={`translate(${x}, ${y})`}
      onMouseEnter={() => onHover(group, { x, y })}
      onMouseLeave={() => onHover(null, null)}
      style={{ cursor: 'pointer' }}
    >
      {anyOpen && (
        <circle r={6} fill={dotColor} opacity={0.35}>
          <animate attributeName="r" values="5;10;5" dur="2s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.35;0;0.35" dur="2s" repeatCount="indefinite" />
        </circle>
      )}
      {/* Larger invisible hit target for easier hovering */}
      <circle r={8} fill="transparent" />
      <circle r={3.5} fill={dotColor} stroke="var(--bg-surface)" strokeWidth={1} />
    </g>
  )
}

export default function MarketsView() {
  const [quotes, setQuotes] = useState<Record<string, MarketQuote>>({})
  const [now, setNow] = useState(() => new Date())
  const [hover, setHover] = useState<{ group: CityGroup; pos: { x: number; y: number } } | null>(null)

  const symbols = useMemo(() => EXCHANGES.map(e => e.symbol), [])
  const cityGroups = useMemo(() => groupByCity(EXCHANGES), [])

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

      {/* World map */}
      <div style={{
        position: 'relative', background: 'var(--bg-card)', border: '1px solid var(--border)',
        borderRadius: 8, padding: 8, marginBottom: 16, overflow: 'hidden',
      }}>
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
          <rect x={0} y={0} width={WIDTH} height={HEIGHT} fill="var(--bg-surface)" />
          <path d={countriesPath} fill="var(--bg-active)" fillRule="evenodd" />
          <path d={bordersPath} fill="none" stroke="var(--border)" strokeWidth={0.6} />
          {cityGroups.map(g => (
            <CityMarker
              key={`${g.city}|${g.country}`}
              group={g}
              now={now}
              onHover={(group, pos) => setHover(group && pos ? { group, pos } : null)}
            />
          ))}
        </svg>

        {hover && (
          <div style={{
            position: 'absolute',
            left: `${(hover.pos.x / WIDTH) * 100}%`,
            top: `${(hover.pos.y / HEIGHT) * 100}%`,
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

      {/* Quote list */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8,
      }}>
        {EXCHANGES.map(ex => {
          const q = quotes[ex.symbol]
          const open = isExchangeOpen(ex, now)
          const color = !q ? 'var(--text-3)' : q.change >= 0 ? '#10b981' : '#f43f5e'
          return (
            <div key={ex.symbol} style={{
              background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6,
              padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 3,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{
                  width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                  background: open ? '#10b981' : 'var(--text-4)',
                }} />
                <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-1)' }}>{ex.name}</span>
                <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-4)' }}>{open ? 'OPEN' : 'CLOSED'}</span>
              </div>
              {q ? (
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, fontFamily: 'Inter, sans-serif', color: 'var(--text-1)' }}>
                    {fmtPrice(q.price)}
                  </span>
                  <span style={{ fontSize: 11.5, fontWeight: 600, fontFamily: 'Inter, sans-serif', color }}>
                    {q.change >= 0 ? '+' : ''}{fmtPrice(q.change)} ({q.changePercent >= 0 ? '+' : ''}{q.changePercent.toFixed(2)}%)
                  </span>
                </div>
              ) : (
                <span style={{ fontSize: 12, color: 'var(--text-4)' }}>—</span>
              )}
              <span style={{ fontSize: 10, color: 'var(--text-4)' }}>{ex.city}, {ex.country}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
