'use client'

// MarketChart — the chart that executes. TradingView's open-source engine
// (lightweight-charts, Apache-2.0 — attribution rendered under the chart,
// as the licence requires) drawing the same /api/charts/candles series the
// hand-rolled CandleChart draws, plus everything a trading chart needs and
// a screenshot never has: drawings that become orders, news pinned to bars,
// overlays computed from the bars on screen, and — for Robinhood Chain
// stocks — the POOL price next to the tape.
//
// Theme: the canvas reads the site's CSS tokens (--accent / --sell / --fg /
// --bg / --line / --muted-2) at mount and re-reads them on every theme flip
// (the bootstrap script owns html[data-theme]; a MutationObserver watches
// it). CandleChart.tsx stays for OG cards / server render.
//
// Contracts it speaks:
//   state / onStateChange  — lib/chart-state (COMM stores it on posts)
//   markers                — { t, label, url? }[] (COMM feeds /api/news)
//   onAsk                  — the chip-send path (ChartOverlay's onAsk); with
//                            no onAsk the chips become prefill links
//   onStats                — the header numbers, same shape as CandleChart

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type Logical,
  type MouseEventParams,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts'
import { Eraser, Minus, MousePointer2, RectangleHorizontal, StickyNote, TrendingUp } from 'lucide-react'
import { CHART_TFS, chartPairFor, type Candle, type ChartTf } from '@/lib/charts'
import { newLineId, serializeChartState, type ChartLine, type ChartState } from '@/lib/chart-state'
import { composeLineActions, composeZoneActions, missingActionNote, type LineActionOffer } from '@/lib/chart-actions'
import { bollinger, ema, hasVolume, OVERLAYS, sma, vwap, type LinePoint, type OverlayKey } from '@/lib/chart-indicators'
import { poolPremiumPct, type PoolPrice } from '@/lib/pool-price-shape'
import { fmtPrice, type ChartStats } from '@/components/CandleChart'
import DrawingLayer, { type ChartGeom, type DrawTool } from './DrawingLayer'

const POLL_MS: Record<ChartTf, number> = { '15m': 8_000, '1h': 15_000, '4h': 20_000, '1d': 30_000 }
const POOL_POLL_MS = 30_000

export interface ChartMarker {
  /** Unix seconds — pinned to the last bar that opened at or before it. */
  t: number
  label: string
  url?: string
}

export interface MarketChartProps {
  symbol: string
  /** Fixed pixel height, or 'fill' to take the flex parent's remaining space. */
  height?: number | 'fill'
  defaultTf?: ChartTf
  /** Initial / replayed drawings. Re-applied whenever a DIFFERENT state
   *  arrives (a fork), never on the echo of our own onStateChange. */
  state?: ChartState | null
  onStateChange?: (s: ChartState) => void
  markers?: ChartMarker[]
  /** Chip-send: a level's chip SENDS this ask. Absent → prefill links. */
  onAsk?: (ask: string) => void
  /** Prefill link builder when there is no send path (default /chat?prompt=). */
  askHref?: (ask: string) => string
  onStats?: (s: ChartStats) => void
  controlsRight?: ReactNode
  resizeKey?: string | number | boolean
  /** Drawing tools on (default) or a read-only replay (a post's chart). */
  tools?: boolean
  /** Dollar size for the level chips (default $25). */
  actionUsd?: number
  /** Overlays lit at mount. */
  defaultOverlays?: OverlayKey[]
}

interface CandlesResponse {
  symbol: string
  label: string | null
  source: string | null
  feed?: string | null
  tf: ChartTf
  candles: Candle[]
  last?: number | null
  changePct24h?: number | null
  error?: string
}

interface Tokens {
  accent: string
  sell: string
  fg: string
  bg: string
  line: string
  muted: string
  muted2: string
  surf: string
}

/** Resolve a CSS token to a canvas-safe hex — oklch()/color-mix() strings
 *  are fine for CSS but the engine paints on a 2D canvas whose alpha
 *  variants we compose by hand, so normalize through a scratch canvas. */
function resolveColor(value: string, fallback: string): string {
  try {
    const c = document.createElement('canvas')
    const ctx = c.getContext('2d')
    if (!ctx) return fallback
    ctx.fillStyle = '#000'
    ctx.fillStyle = value
    const out = String(ctx.fillStyle)
    return /^#[0-9a-f]{6}$/i.test(out) ? out : fallback
  } catch {
    return fallback
  }
}

function readTokens(): Tokens {
  const cs = getComputedStyle(document.documentElement)
  const get = (name: string, fb: string) => resolveColor(cs.getPropertyValue(name).trim() || fb, fb)
  return {
    accent: get('--accent', '#3ecf8e'),
    sell: get('--sell', '#e5484d'),
    fg: get('--fg', '#ffffff'),
    bg: get('--bg', '#000000'),
    line: get('--line', '#3a3a3a'),
    muted: get('--muted', '#9a9a9a'),
    muted2: get('--muted-2', '#7a7a7a'),
    surf: get('--surf-1', '#161616'),
  }
}

const alpha = (hex: string, a: number) => `${hex}${Math.round(a * 255).toString(16).padStart(2, '0')}`

/** Nearest-bar snap for markers: the last bar opened at or before t. */
function barTimeFor(candles: Candle[], t: number): number | null {
  if (!candles.length) return null
  if (t <= candles[0].t) return candles[0].t
  let lo = 0
  let hi = candles.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (candles[mid].t <= t) lo = mid
    else hi = mid - 1
  }
  return candles[lo].t
}

/** Time → fractional logical index (the engine's x space), extrapolated
 *  past both ends with the bar width so off-screen endpoints still map. */
function timeToLogical(candles: Candle[], t: number): number | null {
  const n = candles.length
  if (n === 0) return null
  const bar = n > 1 ? Math.max(1, candles[n - 1].t - candles[n - 2].t) : 3600
  if (t <= candles[0].t) return (t - candles[0].t) / bar
  if (t >= candles[n - 1].t) return n - 1 + (t - candles[n - 1].t) / bar
  let lo = 0
  let hi = n - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (candles[mid].t <= t) lo = mid
    else hi = mid - 1
  }
  const span = Math.max(1, candles[lo + 1].t - candles[lo].t)
  return lo + (t - candles[lo].t) / span
}

function logicalToTime(candles: Candle[], l: number): number | null {
  const n = candles.length
  if (n === 0) return null
  const bar = n > 1 ? Math.max(1, candles[n - 1].t - candles[n - 2].t) : 3600
  if (l <= 0) return Math.round(candles[0].t + l * bar)
  if (l >= n - 1) return Math.round(candles[n - 1].t + (l - (n - 1)) * bar)
  const i = Math.floor(l)
  const span = Math.max(1, candles[i + 1].t - candles[i].t)
  return Math.round(candles[i].t + (l - i) * span)
}

const toLineData = (pts: LinePoint[]) => pts.filter((p) => p.v !== null).map((p) => ({ time: p.t as UTCTimestamp, value: p.v as number }))

export default function MarketChart({
  symbol,
  height: heightProp = 360,
  defaultTf = '1h',
  state,
  onStateChange,
  markers,
  onAsk,
  askHref,
  onStats,
  controlsRight,
  resizeKey,
  tools = true,
  actionUsd,
  defaultOverlays,
}: MarketChartProps) {
  const fill = heightProp === 'fill'
  const pair = useMemo(() => chartPairFor(symbol), [symbol])
  const [tf, setTf] = useState<ChartTf>(state?.tf ?? defaultTf)
  const [data, setData] = useState<CandlesResponse | null>(null)
  const [stale, setStale] = useState(false)
  const [tokens, setTokens] = useState<Tokens | null>(null)
  const [overlays, setOverlays] = useState<Set<OverlayKey>>(() => new Set(defaultOverlays ?? []))
  const [lines, setLines] = useState<ChartLine[]>(state?.lines ?? [])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [tool, setTool] = useState<DrawTool>('none')
  const [pending, setPending] = useState<{ tool: DrawTool; price: number; t: number } | null>(null)
  const [hover, setHover] = useState<{ x: number; y: number; price: number | null; t: number | null } | null>(null)
  const [geomTick, setGeomTick] = useState(0)
  const [pool, setPool] = useState<PoolPrice | null>(null)
  const [noteDraft, setNoteDraft] = useState<{ t: number; price: number; text: string } | null>(null)

  const wrapRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const overlayRefs = useRef<Map<string, ISeriesApi<'Line'>>>(new Map())
  const markerApiRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null)
  const poolLineRef = useRef<IPriceLine | null>(null)
  const hLineRefs = useRef<Map<string, IPriceLine>>(new Map())
  const candlesRef = useRef<Candle[]>([])
  const onStatsRef = useRef(onStats)
  onStatsRef.current = onStats
  const toolRef = useRef(tool)
  toolRef.current = tool
  const pendingRef = useRef(pending)
  pendingRef.current = pending
  const lastEmittedRef = useRef<string | null>(null)
  const lastAppliedRef = useRef<string | null>(state ? serializeChartState(state) : null)
  const markersRef = useRef(markers)
  markersRef.current = markers

  const candles = data?.candles ?? []
  candlesRef.current = candles
  const last = candles.length ? candles[candles.length - 1].c : null

  // ── Theme tokens (mount + every flip) ─────────────────────────────────────
  useEffect(() => {
    setTokens(readTokens())
    const mo = new MutationObserver(() => setTokens(readTokens()))
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onMq = () => setTokens(readTokens())
    mq.addEventListener?.('change', onMq)
    return () => {
      mo.disconnect()
      mq.removeEventListener?.('change', onMq)
    }
  }, [])

  // ── Candles ───────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/charts/candles?symbol=${encodeURIComponent(symbol)}&tf=${tf}`, { cache: 'no-store' })
      if (!res.ok) throw new Error(String(res.status))
      const d = (await res.json()) as CandlesResponse
      if (d.candles.length > 0) {
        setData(d)
        setStale(false)
        onStatsRef.current?.({
          last: d.last ?? d.candles[d.candles.length - 1].c,
          changePct24h: d.changePct24h ?? null,
          label: d.label,
          source: d.source,
          feed: d.feed ?? d.source,
        })
      } else if (d.error) {
        setStale(true)
        setData((cur) => cur ?? d)
      }
    } catch {
      setStale(true)
    }
  }, [symbol, tf])

  useEffect(() => {
    if (!pair) return
    setData(null)
    void load()
    const timer = setInterval(() => void load(), POLL_MS[tf])
    return () => clearInterval(timer)
  }, [symbol, tf, pair, load])

  // ── Pool price (Robinhood Chain stocks only) ──────────────────────────────
  useEffect(() => {
    if (pair?.source !== 'robinhood') {
      setPool(null)
      return
    }
    let alive = true
    const tick = async () => {
      try {
        const res = await fetch(`/api/charts/pool-price?symbol=${encodeURIComponent(pair.symbol)}`, { cache: 'no-store' })
        const body = (await res.json()) as { pool: PoolPrice | null }
        if (alive) setPool(body.pool ?? null)
      } catch {
        if (alive) setPool(null)
      }
    }
    void tick()
    const timer = setInterval(() => void tick(), POOL_POLL_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [pair])

  // ── Engine lifecycle ──────────────────────────────────────────────────────
  useEffect(() => {
    const el = wrapRef.current
    if (!el || !tokens || !pair) return
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: tokens.bg },
        textColor: tokens.muted2,
        // No in-chart TV logo: the footer below carries the license's
        // attribution (the NOTICE line + a link to tradingview.com) instead.
        attributionLogo: false,
        fontFamily: "'Geist Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 10,
      },
      grid: { vertLines: { color: alpha(tokens.line, 0.35) }, horzLines: { color: alpha(tokens.line, 0.35) } },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: alpha(tokens.fg, 0.35), labelBackgroundColor: tokens.surf }, horzLine: { color: alpha(tokens.fg, 0.35), labelBackgroundColor: tokens.surf } },
      rightPriceScale: { borderColor: alpha(tokens.line, 0.6), scaleMargins: { top: 0.08, bottom: 0.22 } },
      timeScale: { borderColor: alpha(tokens.line, 0.6), timeVisible: tf !== '1d', secondsVisible: false, rightOffset: 4 },
      localization: { priceFormatter: (p: number) => fmtPrice(p) },
      handleScale: { axisPressedMouseMove: true },
    })
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: tokens.accent,
      downColor: tokens.sell,
      borderVisible: false,
      wickUpColor: tokens.accent,
      wickDownColor: tokens.sell,
      priceLineVisible: true,
      priceLineStyle: LineStyle.Dashed,
      lastValueVisible: true,
    })
    const volSeries = chart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: 'vol', lastValueVisible: false, priceLineVisible: false })
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } })
    chartRef.current = chart
    candleRef.current = candleSeries
    volRef.current = volSeries
    markerApiRef.current = createSeriesMarkers(candleSeries, [])

    const bump = () => setGeomTick((n) => n + 1)
    chart.timeScale().subscribeVisibleLogicalRangeChange(bump)
    const ro = new ResizeObserver(bump)
    ro.observe(el)

    const onMove = (p: MouseEventParams<Time>) => {
      if (!p.point) {
        setHover(null)
        return
      }
      const price = candleSeries.coordinateToPrice(p.point.y)
      const logical = chart.timeScale().coordinateToLogical(p.point.x)
      const t = logical === null ? null : logicalToTime(candlesRef.current, logical as number)
      setHover({ x: p.point.x, y: p.point.y, price: price === null ? null : Number(price), t })
    }
    chart.subscribeCrosshairMove(onMove)

    const onClick = (p: MouseEventParams<Time>) => {
      // A news marker under the cursor opens its story.
      if (p.hoveredObjectId) {
        const m = (markersRef.current ?? []).find((mk, i) => `news-${i}-${mk.t}` === p.hoveredObjectId)
        if (m?.url) {
          window.open(m.url, '_blank', 'noopener,noreferrer')
          return
        }
      }
      const t0 = toolRef.current
      if (t0 === 'none' || !p.point) return
      const priceRaw = candleSeries.coordinateToPrice(p.point.y)
      if (priceRaw === null) return
      const price = Number(priceRaw)
      if (!(price > 0)) return
      const logical = chart.timeScale().coordinateToLogical(p.point.x)
      const t = logical === null ? (candlesRef.current.at(-1)?.t ?? Math.floor(Date.now() / 1000)) : (logicalToTime(candlesRef.current, logical as number) ?? Math.floor(Date.now() / 1000))
      if (t0 === 'h') {
        const id = newLineId('h')
        setLines((cur) => [...cur, { id, kind: 'h', price }])
        setSelectedId(id)
        setTool('none')
        return
      }
      if (t0 === 'note') {
        setNoteDraft({ t, price, text: '' })
        setTool('none')
        return
      }
      const pend = pendingRef.current
      if (!pend || pend.tool !== t0) {
        setPending({ tool: t0, price, t })
        return
      }
      if (t0 === 'zone') {
        if (price === pend.price) return
        const id = newLineId('z')
        setLines((cur) => [...cur, { id, kind: 'zone', p1: pend.price, p2: price }])
        setSelectedId(id)
      } else if (t0 === 'trend') {
        if (t === pend.t && price === pend.price) return
        const id = newLineId('t')
        setLines((cur) => [...cur, { id, kind: 'trend', t1: pend.t, p1: pend.price, t2: t, p2: price }])
        setSelectedId(id)
      }
      setPending(null)
      setTool('none')
    }
    chart.subscribeClick(onClick)

    return () => {
      ro.disconnect()
      chart.unsubscribeCrosshairMove(onMove)
      chart.unsubscribeClick(onClick)
      chart.remove()
      chartRef.current = null
      candleRef.current = null
      volRef.current = null
      markerApiRef.current = null
      poolLineRef.current = null
      overlayRefs.current.clear()
      hLineRefs.current.clear()
    }
    // Recreate only when the pair changes; theme + tf changes apply via options.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pair, tokens !== null])

  // Theme flip → repaint the existing chart.
  useEffect(() => {
    const chart = chartRef.current
    if (!chart || !tokens) return
    chart.applyOptions({
      layout: { background: { type: ColorType.Solid, color: tokens.bg }, textColor: tokens.muted2 },
      grid: { vertLines: { color: alpha(tokens.line, 0.35) }, horzLines: { color: alpha(tokens.line, 0.35) } },
      crosshair: { vertLine: { color: alpha(tokens.fg, 0.35), labelBackgroundColor: tokens.surf }, horzLine: { color: alpha(tokens.fg, 0.35), labelBackgroundColor: tokens.surf } },
      rightPriceScale: { borderColor: alpha(tokens.line, 0.6) },
      timeScale: { borderColor: alpha(tokens.line, 0.6) },
    })
    candleRef.current?.applyOptions({ upColor: tokens.accent, downColor: tokens.sell, wickUpColor: tokens.accent, wickDownColor: tokens.sell })
    setGeomTick((n) => n + 1)
  }, [tokens])

  useEffect(() => {
    chartRef.current?.applyOptions({ timeScale: { timeVisible: tf !== '1d' } })
  }, [tf])

  // Parent-announced layout change (expand/collapse).
  useEffect(() => {
    setGeomTick((n) => n + 1)
  }, [resizeKey])

  // Data → series.
  const fitOnceRef = useRef<string>('')
  useEffect(() => {
    const cs = candleRef.current
    const vs = volRef.current
    const chart = chartRef.current
    if (!cs || !vs || !chart || !tokens) return
    if (!candles.length) return
    cs.setData(candles.map((c) => ({ time: c.t as UTCTimestamp, open: c.o, high: c.h, low: c.l, close: c.c })))
    vs.setData(candles.map((c) => ({ time: c.t as UTCTimestamp, value: c.v, color: alpha(c.c >= c.o ? tokens.accent : tokens.sell, 0.28) })))
    const key = `${symbol}:${tf}`
    if (fitOnceRef.current !== key) {
      chart.timeScale().fitContent()
      fitOnceRef.current = key
    }
    setGeomTick((n) => n + 1)
  }, [candles, symbol, tf, tokens])

  // Overlays → line series.
  useEffect(() => {
    const chart = chartRef.current
    if (!chart || !tokens) return
    const want = new Map<string, { data: LinePoint[]; color: string; width: 1 | 2; style?: LineStyle }>()
    if (candles.length) {
      if (overlays.has('sma20')) want.set('sma20', { data: sma(candles, 20), color: tokens.accent, width: 1 })
      if (overlays.has('sma50')) want.set('sma50', { data: sma(candles, 50), color: tokens.muted, width: 1 })
      if (overlays.has('ema20')) want.set('ema20', { data: ema(candles, 20), color: alpha(tokens.fg, 0.7), width: 1 })
      if (overlays.has('bb')) {
        const bb = bollinger(candles, 20, 2)
        want.set('bb:u', { data: bb.upper, color: alpha(tokens.muted2, 0.8), width: 1, style: LineStyle.Dotted })
        want.set('bb:m', { data: bb.middle, color: alpha(tokens.muted2, 0.5), width: 1, style: LineStyle.Dotted })
        want.set('bb:l', { data: bb.lower, color: alpha(tokens.muted2, 0.8), width: 1, style: LineStyle.Dotted })
      }
      if (overlays.has('vwap') && hasVolume(candles)) want.set('vwap', { data: vwap(candles), color: alpha(tokens.sell, 0.75), width: 1, style: LineStyle.Dashed })
    }
    for (const [key, series] of overlayRefs.current) {
      if (!want.has(key)) {
        chart.removeSeries(series)
        overlayRefs.current.delete(key)
      }
    }
    for (const [key, spec] of want) {
      let series = overlayRefs.current.get(key)
      if (!series) {
        series = chart.addSeries(LineSeries, { lineWidth: spec.width, color: spec.color, lineStyle: spec.style ?? LineStyle.Solid, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false })
        overlayRefs.current.set(key, series)
      } else {
        series.applyOptions({ color: spec.color, lineStyle: spec.style ?? LineStyle.Solid })
      }
      series.setData(toLineData(spec.data))
    }
  }, [overlays, candles, tokens])

  // News markers → the bars.
  useEffect(() => {
    const api = markerApiRef.current
    if (!api || !tokens) return
    if (!candles.length || !markers?.length) {
      api.setMarkers([])
      return
    }
    const out: SeriesMarker<Time>[] = []
    markers.forEach((m, i) => {
      const bt = barTimeFor(candles, m.t)
      if (bt === null) return
      out.push({ time: bt as UTCTimestamp, position: 'aboveBar', shape: 'circle', color: alpha(tokens.fg, 0.75), size: 1, id: `news-${i}-${m.t}`, text: m.label.length > 28 ? `${m.label.slice(0, 27)}…` : m.label })
    })
    out.sort((a, b) => (a.time as number) - (b.time as number))
    api.setMarkers(out)
  }, [markers, candles, tokens])

  // Pool price → dotted line on the price scale.
  useEffect(() => {
    const cs = candleRef.current
    if (!cs || !tokens) return
    if (poolLineRef.current) {
      cs.removePriceLine(poolLineRef.current)
      poolLineRef.current = null
    }
    if (pool) {
      poolLineRef.current = cs.createPriceLine({ price: pool.usdPerToken, color: alpha(tokens.fg, 0.55), lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: 'pool' })
    }
  }, [pool, tokens])

  // Horizontal levels also get the engine's axis tag (the SVG layer draws
  // the line + pill; the tag rides the price scale like a real order line).
  useEffect(() => {
    const cs = candleRef.current
    if (!cs || !tokens) return
    const wanted = new Map(lines.filter((l): l is Extract<ChartLine, { kind: 'h' }> => l.kind === 'h').map((l) => [l.id, l]))
    for (const [id, pl] of hLineRefs.current) {
      if (!wanted.has(id)) {
        cs.removePriceLine(pl)
        hLineRefs.current.delete(id)
      }
    }
    for (const [id, l] of wanted) {
      const color = l.action ? (l.action.kind === 'sell' || (l.action.kind === 'limit' && /sell/.test(l.action.ask)) || l.action.kind === 'stop' ? tokens.sell : tokens.accent) : tokens.muted
      const existing = hLineRefs.current.get(id)
      if (existing) existing.applyOptions({ price: l.price, color, title: l.action ? l.action.kind : '' })
      else hLineRefs.current.set(id, cs.createPriceLine({ price: l.price, color, lineWidth: 1, lineStyle: LineStyle.Solid, lineVisible: false, axisLabelVisible: true, title: l.action ? l.action.kind : '' }))
    }
  }, [lines, tokens])

  // ── State in / out ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!state) return
    const ser = serializeChartState(state)
    if (ser === lastAppliedRef.current || ser === lastEmittedRef.current) return
    lastAppliedRef.current = ser
    setLines(state.lines)
    if (state.tf !== tf) setTf(state.tf)
    setSelectedId(null)
  }, [state, tf])

  useEffect(() => {
    if (!onStateChange || !pair) return
    const next: ChartState = { v: 1, symbol: pair.symbol, tf, lines }
    const ser = serializeChartState(next)
    if (ser === lastEmittedRef.current) return
    if (lastAppliedRef.current === ser) {
      lastEmittedRef.current = ser
      return
    }
    lastEmittedRef.current = ser
    onStateChange(next)
  }, [lines, tf, pair, onStateChange])

  // Esc cancels a tool / selection / note draft; Delete removes the selection.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      if (e.key === 'Escape') {
        if (noteDraft) setNoteDraft(null)
        else if (pending) setPending(null)
        else if (tool !== 'none') setTool('none')
        else if (selectedId) setSelectedId(null)
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId && tools) {
        setLines((cur) => cur.filter((l) => l.id !== selectedId))
        setSelectedId(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [noteDraft, pending, tool, selectedId, tools])

  // ── Geometry for the drawing layer (one object per tick) ──────────────────
  const geom = useMemo<ChartGeom | null>(() => {
    void geomTick
    const chart = chartRef.current
    const cs = candleRef.current
    const el = wrapRef.current
    if (!chart || !cs || !el || !candles.length) return null
    const box = el.getBoundingClientRect()
    const plotRight = chart.timeScale().width()
    return {
      width: Math.round(box.width),
      height: Math.round(box.height),
      plotRight,
      priceToY: (p) => {
        const y = cs.priceToCoordinate(p)
        return y === null ? null : Number(y)
      },
      timeToX: (t) => {
        const l = timeToLogical(candles, t)
        if (l === null) return null
        const x = chart.timeScale().logicalToCoordinate(l as Logical)
        return x === null ? null : Number(x)
      },
    }
  }, [geomTick, candles])

  const offersFor = useCallback(
    (line: ChartLine): LineActionOffer[] => {
      if (!pair || last === null) return []
      if (line.kind === 'h') return composeLineActions({ symbol: pair.symbol, source: pair.source, price: line.price, last, usd: actionUsd })
      if (line.kind === 'zone') return composeZoneActions({ symbol: pair.symbol, source: pair.source, p1: line.p1, p2: line.p2, last, usd: actionUsd })
      return []
    },
    [pair, last, actionUsd],
  )

  const premium = poolPremiumPct(pool, last)
  const feedLabel = data?.feed ?? pair?.source ?? ''

  if (!pair) {
    return (
      <div className="rounded-xl border border-[var(--line)] px-4 py-6 text-center text-[12px] text-[color:var(--muted-2)]">
        No live chart for {symbol.toUpperCase()} yet.
      </div>
    )
  }

  const toolBtn = (key: DrawTool, Icon: typeof Minus, title: string) => (
    <button
      key={key}
      type="button"
      className={`mkt-tool${tool === key ? ' is-active' : ''}`}
      aria-pressed={tool === key}
      title={title}
      aria-label={title}
      onClick={() => {
        setPending(null)
        setNoteDraft(null)
        setTool(tool === key ? 'none' : key)
      }}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  )

  return (
    <div className={fill ? 'mkt-chart min-h-0 flex-1' : 'mkt-chart'}>
      {/* Row 1: timeframes · overlays · tools · live badge */}
      <div className="mkt-chart__bar">
        <div className="tok__tf">
          {CHART_TFS.map((t) => (
            <button key={t.key} type="button" className={`tok__tfbtn mono${tf === t.key ? ' is-active' : ''}`} aria-pressed={tf === t.key} onClick={() => setTf(t.key)}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="mkt-chart__ind" role="group" aria-label="Overlays">
          {OVERLAYS.filter((o) => o.key !== 'vwap' || hasVolume(candles)).map((o) => (
            <button
              key={o.key}
              type="button"
              className={`mkt-ind mono${overlays.has(o.key) ? ' is-active' : ''}`}
              aria-pressed={overlays.has(o.key)}
              title={o.title}
              onClick={() =>
                setOverlays((cur) => {
                  const next = new Set(cur)
                  if (next.has(o.key)) next.delete(o.key)
                  else next.add(o.key)
                  return next
                })
              }
            >
              {o.label}
            </button>
          ))}
        </div>
        {tools && (
          <div className="mkt-chart__tools" role="group" aria-label="Drawing tools">
            {toolBtn('none', MousePointer2, 'Select')}
            {toolBtn('h', Minus, 'Horizontal level — click a price')}
            {toolBtn('zone', RectangleHorizontal, 'Zone — click two prices')}
            {toolBtn('trend', TrendingUp, 'Trend line — click two points')}
            {toolBtn('note', StickyNote, 'Note — click where you noticed it')}
            {lines.length > 0 && (
              <button
                type="button"
                className="mkt-tool"
                title="Clear drawings"
                aria-label="Clear drawings"
                onClick={() => {
                  setLines([])
                  setSelectedId(null)
                }}
              >
                <Eraser className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}
        <span className="mkt-chart__right">
          {pool && premium !== null && (
            <span className="mkt-pool mono" title={`${pool.via} · $${pool.quoteUsd} buys ${pool.tokenOut.toFixed(4)} ${pair.symbol}`}>
              pool ~${fmtPrice(pool.usdPerToken)} <span className={premium > 0.05 ? 'mkt-pool__prem--up' : premium < -0.05 ? 'mkt-pool__prem--down' : ''}>({premium >= 0 ? '+' : '−'}{Math.abs(premium).toFixed(2)}% vs tape)</span>
            </span>
          )}
          <span className="mono flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[color:var(--muted-2)]">
            {stale ? (
              'feed stalled — retrying'
            ) : (
              <>
                <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: 'var(--accent)' }} />
                live
              </>
            )}
          </span>
          {controlsRight}
        </span>
      </div>

      {tool !== 'none' && (
        <p className="mkt-chart__hint mono">
          {tool === 'h' && 'click a price to place a level — it can carry an order'}
          {tool === 'zone' && (pending ? 'click the other edge of the zone' : 'click the first edge of the zone')}
          {tool === 'trend' && (pending ? 'click the second point' : 'click the first point')}
          {tool === 'note' && 'click where you noticed it'}
          {' · esc cancels'}
        </p>
      )}

      {/* Canvas: the engine owns the bars; the SVG layer owns the drawings. */}
      <div className={`mkt-chart__canvas${tool !== 'none' ? ' is-drawing' : ''}${fill ? ' min-h-0 flex-1' : ''}`} style={fill ? undefined : { height: heightProp }}>
        <div ref={wrapRef} className="mkt-chart__engine" />
        {candles.length === 0 && (
          <div className="mkt-chart__empty">
            <span className="text-[12px] text-[color:var(--muted-2)]">{data?.error ? 'Chart feed unavailable — retrying.' : 'Loading candles…'}</span>
          </div>
        )}
        <DrawingLayer
          geom={geom}
          lines={lines}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onChange={setLines}
          offersFor={offersFor}
          missingNote={missingActionNote(pair.symbol, pair.source)}
          onAct={onAsk}
          askHref={askHref}
          readOnly={!tools}
          pending={pending}
          hover={hover}
        />
        {noteDraft && (
          <form
            className="mkt-pop mkt-pop--note"
            style={{ left: 12, top: 12 }}
            onSubmit={(e) => {
              e.preventDefault()
              const text = noteDraft.text.trim().slice(0, 280)
              if (!text) return
              const id = newLineId('n')
              setLines((cur) => [...cur, { id, kind: 'note', t: noteDraft.t, price: noteDraft.price, text }])
              setNoteDraft(null)
            }}
          >
            <span className="mono mkt-pop__kind">note · ${fmtPrice(noteDraft.price)}</span>
            <input autoFocus className="mkt-pop__label" value={noteDraft.text} maxLength={280} placeholder="What you noticed…" onChange={(e) => setNoteDraft({ ...noteDraft, text: e.target.value })} />
            <div className="flex gap-1.5">
              <button type="submit" className="mkt-pop__chip mkt-pop__chip--buy">
                <span className="mkt-pop__chiplabel">Pin note</span>
              </button>
              <button type="button" className="mkt-pop__chip" onClick={() => setNoteDraft(null)}>
                <span className="mkt-pop__chiplabel">Cancel</span>
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Marker legend — the bars carry a dot; the story is one click here. */}
      {markers && markers.length > 0 && candles.length > 0 && (
        <ul className="mkt-markers">
          {markers.slice(0, 6).map((m, i) => (
            <li key={`${m.t}-${i}`}>
              {m.url ? (
                <a href={m.url} target="_blank" rel="noopener noreferrer nofollow" title={m.label}>
                  {m.label}
                </a>
              ) : (
                <span title={m.label}>{m.label}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Attribution — the engine's license wants TradingView's NOTICE line and
          a link to tradingview.com on the page. With attributionLogo off this
          footer is the ONLY credit: never drop it. */}
      <div className="mkt-chart__foot mono">
        <span>{feedLabel ? `feed · ${String(feedLabel)}` : ''}</span>
        <a className="mkt-attrib" href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer nofollow">
          Charts by TradingView Lightweight Charts™ · <span className="mkt-attrib__notice">© 2025 TradingView, Inc.</span>
        </a>
      </div>
    </div>
  )
}
