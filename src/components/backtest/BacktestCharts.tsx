/**
 * SPX candles and the equity curve.
 * TradingView Lightweight Charts — https://www.tradingview.com/
 */
import { useEffect, useRef } from 'react'
import {
  CandlestickSeries,
  ColorType,
  LineSeries,
  createChart,
  createSeriesMarkers,
} from 'lightweight-charts'

export interface Candle {
  time: string
  open: number
  high: number
  low: number
  close: number
}

export interface TradeMark {
  time: string
  win: boolean
}

export interface EquityCurve {
  name: string
  color: string
  points: { time: string; value: number }[]
}

function themeColors() {
  const cs = getComputedStyle(document.documentElement)
  const pick = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback
  return {
    text: pick('--text-3', '#8f8f98'),
    border: pick('--border', 'rgba(255,255,255,0.08)'),
    bg: pick('--bg-card', '#1c1c21'),
    up: pick('--neon-green', '#10b981'),
    down: pick('--pink', '#ef4444'),
  }
}

function chartOptions(height: number) {
  const c = themeColors()
  return {
    autoSize: true,
    height,
    layout: {
      background: { type: ColorType.Solid, color: c.bg },
      textColor: c.text,
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSize: 12,
      attributionLogo: true,
    },
    grid: {
      vertLines: { color: c.border },
      horzLines: { color: c.border },
    },
    rightPriceScale: { borderColor: c.border },
    timeScale: { borderColor: c.border, rightOffset: 4 },
    crosshair: { vertLine: { color: c.border }, horzLine: { color: c.border } },
  }
}

export function SpxChart({ theme, candles, marks }: { theme: string; candles: Candle[]; marks: TradeMark[] }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el || candles.length === 0) return
    const c = themeColors()
    const chart = createChart(el, chartOptions(el.clientHeight || 280))
    const series = chart.addSeries(CandlestickSeries, {
      upColor: c.up,
      downColor: c.down,
      borderUpColor: c.up,
      borderDownColor: c.down,
      wickUpColor: c.up,
      wickDownColor: c.down,
    })
    series.setData(candles)
    const byTime = new Map<string, boolean>()
    for (const mark of marks) byTime.set(mark.time, (byTime.get(mark.time) ?? true) && mark.win)
    const markers = [...byTime.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([time, win]) => ({
        time,
        position: win ? 'belowBar' as const : 'aboveBar' as const,
        shape: win ? 'arrowUp' as const : 'arrowDown' as const,
        color: win ? c.up : c.down,
        size: 0.6,
      }))
    createSeriesMarkers(series, markers)
    chart.timeScale().fitContent()
    return () => chart.remove()
  }, [theme, candles, marks])
  return <div ref={ref} className="bt-chart" />
}

export function EquityChart({ theme, curves }: { theme: string; curves: EquityCurve[] }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const chart = createChart(el, chartOptions(el.clientHeight || 280))
    let any = false
    for (const curve of curves) {
      if (curve.points.length === 0) continue
      any = true
      const series = chart.addSeries(LineSeries, {
        color: curve.color,
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: true,
        title: curve.name,
      })
      series.setData(curve.points)
    }
    if (any) chart.timeScale().fitContent()
    return () => chart.remove()
  }, [theme, curves])
  return <div ref={ref} className="bt-chart" />
}
