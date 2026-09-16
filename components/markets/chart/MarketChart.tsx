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

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  PriceScaleMode,
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
import { CHART_TFS, DEFAULT_CHART_TF, chartPairFor, type Candle, type ChartTf } from '@/lib/charts'
import { newLineId, serializeChartState, type ChartLine, type ChartState } from '@/lib/chart-state'
import { composeLineActions, composeZoneActions, missingActionNote, type LineActionOffer } from '@/lib/chart-actions'
import { bollinger, ema, hasVolume, mergeHistory, onWindow, OVERLAYS, prependHistory, sma, vwap, type LinePoint, type OverlayKey } from '@/lib/chart-indicators'
import { clampToFirstBar, wantsOlderBars } from '@/lib/chart-viewport'
import { equitySession, extendedRuns, FRAME_SEC, sessionsApply, type EquitySession } from '@/lib/chart-sessions'
import { poolPremiumPct, type PoolPrice } from '@/lib/pool-price-shape'
import { fmtPrice, type ChartStats } from '@/components/CandleChart'
import '@/components/markets/look.css'
import DrawingLayer, { type ChartGeom, type DrawTool } from './DrawingLayer'
import { SessionBands } from './session-bands'
import { fillLabel, type FillMarker } from '@/lib/chart-fills'
import { useChartHover } from '@/lib/markets-ai-hover'
import { seriesVar } from '@/lib/markets-look'
import { VolumeProfile } from './volume-profile'
import { canSellAsk } from '@/lib/sell-gate'
import { useHeld } from '@/lib/use-held'

const POLL_MS: Record<ChartTf, number> = { '15m': 8_000, '1h': 15_000, '4h': 20_000, '1d': 30_000 }
const POOL_POLL_MS = 30_000
/** Bars the chart holds for one symbol + frame: the live window (180), its
 *  warm-up (200), and the older pages a zoom-out pulls in. Past it the chart
 *  stops paging, and a zoom-out stops where every drawn bar fits the plot. */
const HISTORY_CAP = 2_200
/** At the cap the oldest bars stay off the canvas as the rolling lines'
 *  warm-up, so an SMA 200 still starts at the first candle on screen. Only a
 *  feed with nothing older shows a line starting partway in. */
const CAP_WARMUP = 200
/** A missing warm-up (the deep feed missed) is asked for again at most this often. */
const WARMUP_RETRY_MS = 60_000
/** A failed older page is asked for again after this long. */
const PAGE_RETRY_MS = 5_000
/** The right margin, in bars, between the latest candle and the price scale. */
const RIGHT_OFFSET = 4
/** A stock's extended-hours candles draw at this share of the up/down color:
 *  present and readable, a step behind the regular session's. */
const QUIET_CANDLE_ALPHA = 0.5

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
  /** The visible window (bar open times + frame) after every range change —
   *  the AI lane reads "what's on screen" off it. Throttled to one per frame. */
  onViewport?: (v: { from: number; to: number; tf: ChartTf }) => void
  /** A second symbol drawn as a % line on the LEFT scale — indexed to the
   *  first bar on screen (the engine's percentage mode), so two tapes with
   *  different prices compare honestly. Same frame as the chart. */
  compare?: string | null
  /** The connected wallet's own signed executions on this symbol — a receipt
   *  glyph per fill on its bar, in the venue's series ink (lib/chart-fills). */
  fills?: FillMarker[]
  /** Drawn over the plot, inside the canvas wrapper — so it positions against
   *  the plot and the time axis, never the footer, whose height changes (a
   *  stock's session legend wraps it to two lines). Must be
   *  pointer-transparent: the chart keeps its gestures. The landing's
   *  rehearsal strip rides here. */
  overlay?: ReactNode
}

interface CandlesResponse {
  symbol: string
  label: string | null
  source: string | null
  feed?: string | null
  tf: ChartTf
  candles: Candle[]
  /** ?warmup=1 only: the bars before `candles`, for the rolling lines. */
  warmup?: Candle[]
  last?: number | null
  changePct24h?: number | null
  error?: string
}

/** ?before= — one older page: the bars that opened before `before`. */
interface OlderPageResponse {
  feed?: string | null
  older?: Candle[]
  /** The feed holds nothing older. Absent on a retryable miss. */
  exhausted?: boolean
  error?: string
}

interface Tokens {
  accent: string
  sell: string
  /** Candle inks: --mk-up / --mk-down (look.css), falling back to accent / sell. */
  up: string
  down: string
  /** Translucent tints used as-is: the grid and the crosshair. */
  grid: string
  crosshair: string
  /** The compare line's ink: series slot 2 (orange), never a candle ink. */
  compare: string
  /** The eight series inks (fill glyphs wear their venue's). */
  series: string[]
  fg: string
  bg: string
  line: string
  muted: string
  muted2: string
  surf: string
  /** The slow averages keep the colors traders read them in: 50 blue, 200 yellow. */
  ma50: string
  ma200: string
  /** The extended-hours tint behind a stock's quiet bars (translucent, used as-is). */
  session: string
}

/** Token → canvas colors. The engine paints on a 2D canvas whose alpha
 *  variants we compose by hand (`alpha(hex, a)`), so an opaque token has to
 *  come out as a plain #rrggbb. The theme's neutrals (--line, --surf-1,
 *  --muted, --muted-2) are oklch(), and a canvas's fillStyle getter hands
 *  oklch() back as oklch(), not hex: the old getter-only check fell back to
 *  the hardcoded DARK hexes on every theme, so the light chart drew a dark
 *  grid, dark borders and a dark crosshair label. Now the browser resolves the
 *  value (a span's computed color, so var() and color-mix() work too), the
 *  getter's hex is taken when it gives one, and anything else is painted onto
 *  a 1×1 canvas and read back. */
function colorProbe() {
  const span = document.createElement('span')
  span.style.display = 'none'
  document.body.appendChild(span)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 1
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  const computed = (value: string): string | null => {
    if (!value) return null
    span.style.color = ''
    span.style.color = value
    return span.style.color ? getComputedStyle(span).color : null
  }
  const SENTINEL = '#010203'
  return {
    /** An opaque token as #rrggbb; a translucent one has no single hex. */
    hex(value: string, fallback: string): string {
      try {
        const color = computed(value)
        if (!color || !ctx) return fallback
        ctx.fillStyle = SENTINEL
        ctx.fillStyle = color
        const got = String(ctx.fillStyle)
        if (got === SENTINEL) return fallback // the canvas refused the syntax
        if (/^#[0-9a-f]{6}$/i.test(got)) return got
        ctx.clearRect(0, 0, 1, 1)
        ctx.fillRect(0, 0, 1, 1)
        const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
        return a < 250 ? fallback : `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`
      } catch {
        return fallback
      }
    },
    /** Any token as a color string the canvas takes as-is (the translucent tints). */
    css(value: string, fallback: string): string {
      try {
        return computed(value) ?? fallback
      } catch {
        return fallback
      }
    },
    dispose() {
      span.remove()
    },
  }
}

function readTokens(): Tokens {
  const cs = getComputedStyle(document.documentElement)
  const probe = colorProbe()
  const get = (name: string, fb: string) => probe.hex(cs.getPropertyValue(name).trim(), fb)
  try {
    return {
      accent: get('--accent', '#3ecf8e'),
      sell: get('--sell', '#e5484d'),
      up: get('--mk-up', get('--accent', '#3ecf8e')),
      down: get('--mk-down', get('--sell', '#e5484d')),
      grid: probe.css(cs.getPropertyValue('--mk-grid').trim(), 'rgba(255, 255, 255, 0.07)'),
      crosshair: probe.css(cs.getPropertyValue('--mk-crosshair').trim(), 'rgba(255, 255, 255, 0.35)'),
      compare: get('--mk-series-2', '#e0642c'),
      series: Array.from({ length: 8 }, (_, i) => get(`--mk-series-${i + 1}`, '#9a9a9a')),
      fg: get('--fg', '#ffffff'),
      bg: get('--bg', '#000000'),
      line: get('--line', '#3a3a3a'),
      muted: get('--muted', '#9a9a9a'),
      muted2: get('--muted-2', '#7a7a7a'),
      surf: get('--surf-1', '#161616'),
      ma50: get('--chart-ma-50', '#5b9cff'),
      ma200: get('--chart-ma-200', '#f5c518'),
      session: probe.css(cs.getPropertyValue('--chart-session').trim(), 'rgba(255, 255, 255, 0.045)'),
    }
  } finally {
    probe.dispose()
  }
}

/** Wick ink relative to the body ("luminous cores, quiet wicks"). */
const WICK_ALPHA = 0.62

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
  defaultTf = DEFAULT_CHART_TF,
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
  onViewport,
  compare,
  fills,
  overlay,
}: MarketChartProps) {
  const fill = heightProp === 'fill'
  const pair = useMemo(() => chartPairFor(symbol), [symbol])
  const [tf, setTf] = useState<ChartTf>(state?.tf ?? defaultTf)
  const [data, setData] = useState<CandlesResponse | null>(null)
  const [stale, setStale] = useState(false)
  const [tokens, setTokens] = useState<Tokens | null>(null)
  const [overlays, setOverlays] = useState<Set<OverlayKey>>(() => new Set(defaultOverlays ?? []))
  // The rolling lines' history: the warm-up plus every polled window merged in.
  const [history, setHistory] = useState<Candle[]>([])
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
  // The extended-hours shading on a stock's intraday frames (lib/chart-sessions).
  const bandsRef = useRef<SessionBands | null>(null)
  const vpRef = useRef<VolumeProfile | null>(null)
  const compareRef = useRef<ISeriesApi<'Line'> | null>(null)
  const [cmp, setCmp] = useState<{ symbol: string; tf: ChartTf; candles: Candle[] } | null>(null)
  const poolLineRef = useRef<IPriceLine | null>(null)
  const hLineRefs = useRef<Map<string, IPriceLine>>(new Map())
  // Every bar the chart holds, for the engine callbacks (hover/click time, the viewport guard).
  const barsRef = useRef<Candle[]>([])
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
  // The symbol:tf on screen — a response for one the chart already left is dropped.
  const keyRef = useRef('')
  const warmRef = useRef<{ key: string; warmed: boolean; triedAt: number; inflight: boolean }>({ key: '', warmed: false, triedAt: 0, inflight: false })
  // Older pages for the frame on screen: one in flight, a failed one waits
  // PAGE_RETRY_MS, and `exhausted` (nothing older, or a full history) ends it.
  const pageRef = useRef<{ key: string; loading: boolean; exhausted: boolean; retryAt: number; lastBefore: number | null }>({ key: '', loading: false, exhausted: false, retryAt: 0, lastBefore: null })
  const historyRef = useRef<Candle[]>([])
  historyRef.current = history
  // The feed that drew the live window: a page from any other tape is dropped.
  const feedRef = useRef<string | null>(null)

  const candles = data?.candles ?? []
  // What the engine draws (`bars`) and what the rolling lines read
  // (`lineSrc`): every held bar (older pages, the warm-up, the merged polls)
  // once the history spans the live window, the window alone until then. At
  // the cap the oldest CAP_WARMUP stay off the canvas but in the lines.
  const { bars, lineSrc } = useMemo(() => {
    const covers = history.length > 0 && candles.length > 0 && history[0].t <= candles[0].t && history[history.length - 1].t >= candles[candles.length - 1].t
    if (!covers) return { bars: candles, lineSrc: candles }
    return { bars: history.length >= HISTORY_CAP ? history.slice(CAP_WARMUP) : history, lineSrc: history }
  }, [history, candles])
  barsRef.current = bars
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
  // The viewport guard. Every visible-range change (a zoom, a pan, a resize,
  // bars landing) runs it once, after the engine settles and before it
  // paints: the plot never shows time before the first held bar
  // (clampToFirstBar), and while less than a screen of held bars sits left
  // of the view the chart asks for an older page (wantsOlderBars). The why
  // is in lib/chart-viewport.
  const drawnRef = useRef(0) // bars in the engine's series right now
  const loadOlderRef = useRef<() => Promise<void>>(async () => {})
  const guardQueuedRef = useRef(false)
  // The visible window as bar open times, once per animation frame at most.
  const tfRef = useRef(tf)
  tfRef.current = tf
  const viewportRafRef = useRef<number | null>(null)
  const onViewportRef = useRef(onViewport)
  onViewportRef.current = onViewport
  const emitViewport = useCallback(
    (view: { from: number; to: number }) => {
      if (!onViewportRef.current || viewportRafRef.current != null) return
      viewportRafRef.current = requestAnimationFrame(() => {
        viewportRafRef.current = null
        const bars = barsRef.current
        if (!bars.length || !onViewportRef.current) return
        const lo = Math.max(0, Math.min(bars.length - 1, Math.floor(view.from)))
        const hi = Math.max(0, Math.min(bars.length - 1, Math.ceil(view.to)))
        onViewportRef.current({ from: bars[lo].t, to: bars[hi].t, tf: tfRef.current })
      })
    },
    [],
  )
  const requestGuard = useCallback(() => {
    if (guardQueuedRef.current) return
    guardQueuedRef.current = true
    queueMicrotask(() => {
      guardQueuedRef.current = false
      const chart = chartRef.current
      const drawn = drawnRef.current
      if (!chart || drawn === 0) return
      const ts = chart.timeScale()
      const view = ts.getVisibleLogicalRange()
      if (!view) return
      const clamped = clampToFirstBar(view, drawn, RIGHT_OFFSET)
      if (clamped) ts.setVisibleLogicalRange({ from: clamped.from as Logical, to: clamped.to as Logical })
      if (wantsOlderBars(clamped ?? view, drawn)) void loadOlderRef.current()
      emitViewport(clamped ?? view)
    })
  }, [emitViewport])

  // Warm-up: the bars before the window, once per symbol + frame (asked again
  // at most once a minute while the deep feed misses). The rolling lines read
  // them, so an SMA 200 has its 200 bars and every line starts at the first
  // candle instead of `period` bars in. The engine draws them too, off-screen
  // left of the opening view: the first range a zoom-out shows.
  const loadWarmup = useCallback(async () => {
    const key = `${symbol}:${tf}`
    const w = warmRef.current
    if (w.key === key && (w.warmed || w.inflight || Date.now() - w.triedAt < WARMUP_RETRY_MS)) return
    warmRef.current = { key, warmed: false, triedAt: Date.now(), inflight: true }
    let landed = false
    try {
      const res = await fetch(`/api/charts/candles?symbol=${encodeURIComponent(symbol)}&tf=${tf}&warmup=1`, { cache: 'no-store' })
      if (!res.ok) return
      const d = (await res.json()) as CandlesResponse
      if (keyRef.current !== key || !Array.isArray(d.warmup) || d.candles.length === 0) return
      warmRef.current = { key, warmed: true, triedAt: Date.now(), inflight: false }
      landed = true
      const warmed = [...d.warmup, ...d.candles]
      // Polls that landed first are the newer tape: they win where the two
      // overlap, and the warm-up only adds what is older.
      setHistory((cur) => {
        const m = mergeHistory(warmed, cur, HISTORY_CAP)
        if (m.gap) warmRef.current = { key, warmed: false, triedAt: Date.now(), inflight: false }
        return m.bars
      })
    } catch {
      // The lines draw over the window alone until a retry lands.
    } finally {
      if (warmRef.current.key === key) warmRef.current.inflight = false
      // Older pages wait for the warm-up (it is the first page). One that
      // landed re-runs the guard through the engine's range change; a miss
      // re-runs it here, so paging doesn't wait out the retry minute.
      if (!landed) requestGuard()
    }
  }, [symbol, tf, requestGuard])

  // Older pages: the bars before the first one held, while a zoom-out or a
  // pan nears it. One page at a time, after the warm-up. A feed with nothing
  // older, or a full history, ends the asking, and the guard's clamp then
  // fits what the chart holds.
  const loadOlder = useCallback(async () => {
    const key = `${symbol}:${tf}`
    if (keyRef.current !== key) return
    const page = pageRef.current.key === key ? pageRef.current : (pageRef.current = { key, loading: false, exhausted: false, retryAt: 0, lastBefore: null })
    const w = warmRef.current
    if (page.loading || page.exhausted || Date.now() < page.retryAt || (w.key === key && w.inflight)) return
    const held = historyRef.current
    if (held.length === 0 || feedRef.current === null) return
    if (held.length >= HISTORY_CAP) {
      page.exhausted = true
      return
    }
    const before = held[0].t
    // That page already landed; its bars are waiting on a render.
    if (page.lastBefore === before) return
    page.loading = true
    const later = () => {
      page.retryAt = Date.now() + PAGE_RETRY_MS
      window.setTimeout(requestGuard, PAGE_RETRY_MS + 50)
    }
    try {
      const res = await fetch(`/api/charts/candles?symbol=${encodeURIComponent(symbol)}&tf=${tf}&before=${before}`, { cache: 'no-store' })
      const d = (await res.json()) as OlderPageResponse
      if (pageRef.current !== page) return
      // A retryable miss, or a page from another tape (a Yahoo history under
      // a Robinhood window): splice nothing, ask again later.
      if (!res.ok || d.error || !Array.isArray(d.older) || (d.feed ?? null) !== feedRef.current) {
        later()
        return
      }
      const older = d.older
      page.lastBefore = before
      if (d.exhausted || older.length === 0) page.exhausted = true
      if (older.length === 0) return
      setHistory((cur) => {
        // The history moved on (a gap restarted it): this page no longer joins it.
        if (cur[0]?.t !== before) return cur
        const m = prependHistory(older, cur, HISTORY_CAP)
        if (m.full) page.exhausted = true
        return m.bars
      })
    } catch {
      if (pageRef.current === page) later()
    } finally {
      page.loading = false
    }
  }, [symbol, tf, requestGuard])
  loadOlderRef.current = loadOlder

  const load = useCallback(async () => {
    const key = `${symbol}:${tf}`
    try {
      const res = await fetch(`/api/charts/candles?symbol=${encodeURIComponent(symbol)}&tf=${tf}`, { cache: 'no-store' })
      if (!res.ok) throw new Error(String(res.status))
      const d = (await res.json()) as CandlesResponse
      // A response for the symbol or frame the chart just left never paints
      // (nor leaks its bars into the new frame's history).
      if (keyRef.current !== key) return
      if (d.candles.length > 0) {
        setData(d)
        feedRef.current = d.feed ?? null
        setStale(false)
        setHistory((cur) => {
          const m = mergeHistory(cur, d.candles, HISTORY_CAP)
          // The tab slept through a whole window: bars in between are gone,
          // so the history restarts from this window, warms up, and pages again.
          if (m.gap) {
            warmRef.current = { key, warmed: false, triedAt: 0, inflight: false }
            pageRef.current = { key, loading: false, exhausted: false, retryAt: 0, lastBefore: null }
          }
          return m.bars
        })
        void loadWarmup()
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
      if (keyRef.current === key) setStale(true)
    }
  }, [symbol, tf, loadWarmup])

  useEffect(() => {
    if (!pair) return
    keyRef.current = `${symbol}:${tf}`
    pageRef.current = { key: keyRef.current, loading: false, exhausted: false, retryAt: 0, lastBefore: null }
    feedRef.current = null
    setData(null)
    setHistory([])
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
      grid: { vertLines: { color: tokens.grid }, horzLines: { color: tokens.grid } },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: tokens.crosshair, labelBackgroundColor: tokens.surf }, horzLine: { color: tokens.crosshair, labelBackgroundColor: tokens.surf } },
      rightPriceScale: { borderColor: alpha(tokens.line, 0.6), scaleMargins: { top: 0.08, bottom: 0.22 } },
      // A zoom holds the right edge (the latest bar stays put) instead of the
      // bar under the cursor: a zoom-out from mid-plot used to push the latest
      // candle left into empty time. The left edge is the viewport guard's.
      timeScale: { borderColor: alpha(tokens.line, 0.6), timeVisible: tf !== '1d', secondsVisible: false, rightOffset: RIGHT_OFFSET, rightBarStaysOnScroll: true },
      localization: { priceFormatter: (p: number) => fmtPrice(p) },
      handleScale: { axisPressedMouseMove: true },
    })
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: tokens.up,
      downColor: tokens.down,
      borderVisible: false,
      // Luminous cores, quiet wicks: the body carries the ink, the wick sits back.
      wickUpColor: alpha(tokens.up, WICK_ALPHA),
      wickDownColor: alpha(tokens.down, WICK_ALPHA),
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
    // The session tint rides the candle series on the engine's bottom layer:
    // under the grid and every candle. The data effect hands it the runs.
    const bands = new SessionBands()
    candleSeries.attachPrimitive(bands)
    bandsRef.current = bands
    const vp = new VolumeProfile()
    candleSeries.attachPrimitive(vp)
    vpRef.current = vp

    const bump = () => setGeomTick((n) => n + 1)
    // Every range change repaints the drawings and runs the viewport guard.
    const onRange = () => {
      bump()
      requestGuard()
    }
    chart.timeScale().subscribeVisibleLogicalRangeChange(onRange)
    const ro = new ResizeObserver(bump)
    ro.observe(el)

    // The bar under the crosshair is shared with the AI lane's ask box
    // ("Explain the 14:00 bar" follows the cursor): one store write per bar
    // change, null when the cursor leaves the plot.
    let hoverBarT: number | null = null
    const reportHoverBar = (logical: number | null) => {
      const held = barsRef.current
      const i = logical === null ? -1 : Math.round(logical)
      const bar = i >= 0 && i < held.length ? held[i] : null
      const t = bar?.t ?? null
      if (t === hoverBarT) return
      hoverBarT = t
      useChartHover.getState().setHoverBar(symbol, bar ? { t: bar.t, o: bar.o, h: bar.h, l: bar.l, c: bar.c, v: bar.v } : null)
    }
    const onMove = (p: MouseEventParams<Time>) => {
      if (!p.point) {
        setHover(null)
        reportHoverBar(null)
        return
      }
      const price = candleSeries.coordinateToPrice(p.point.y)
      const logical = chart.timeScale().coordinateToLogical(p.point.x)
      const t = logical === null ? null : logicalToTime(barsRef.current, logical as number)
      setHover({ x: p.point.x, y: p.point.y, price: price === null ? null : Number(price), t })
      reportHoverBar(logical === null ? null : (logical as number))
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
      const t = logical === null ? (barsRef.current.at(-1)?.t ?? Math.floor(Date.now() / 1000)) : (logicalToTime(barsRef.current, logical as number) ?? Math.floor(Date.now() / 1000))
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
      reportHoverBar(null)
      chart.unsubscribeClick(onClick)
      chart.remove()
      chartRef.current = null
      candleRef.current = null
      volRef.current = null
      markerApiRef.current = null
      bandsRef.current = null
      vpRef.current = null
      compareRef.current = null
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
      grid: { vertLines: { color: tokens.grid }, horzLines: { color: tokens.grid } },
      crosshair: { vertLine: { color: tokens.crosshair, labelBackgroundColor: tokens.surf }, horzLine: { color: tokens.crosshair, labelBackgroundColor: tokens.surf } },
      rightPriceScale: { borderColor: alpha(tokens.line, 0.6) },
      timeScale: { borderColor: alpha(tokens.line, 0.6) },
    })
    candleRef.current?.applyOptions({ upColor: tokens.up, downColor: tokens.down, wickUpColor: alpha(tokens.up, WICK_ALPHA), wickDownColor: alpha(tokens.down, WICK_ALPHA) })
    setGeomTick((n) => n + 1)
  }, [tokens])

  useEffect(() => {
    chartRef.current?.applyOptions({ timeScale: { timeVisible: tf !== '1d' } })
  }, [tf])

  // Parent-announced layout change (expand/collapse).
  useEffect(() => {
    setGeomTick((n) => n + 1)
  }, [resizeKey])

  // Sessions: which of a stock's intraday bars are quiet hours
  // (lib/chart-sessions). Null for crypto, perps and daily bars.
  const sessions = useMemo<EquitySession[] | null>(() => (sessionsApply(pair?.source, tf) ? bars.map((c) => equitySession(c.t, FRAME_SEC[tf])) : null), [bars, pair?.source, tf])

  // Data → series. The engine draws every held bar; the view opens on the
  // live window, the older bars waiting off-screen left for a zoom-out.
  const fitOnceRef = useRef<string>('')
  useEffect(() => {
    const cs = candleRef.current
    const vs = volRef.current
    const chart = chartRef.current
    if (!cs || !vs || !chart || !tokens) return
    // The render that switches frames still carries the frame it left (the
    // key effect clears it a beat later). Drawing that would mark the NEW
    // frame fitted with the old bars, and the new frame would open at the old
    // one's zoom: AAPL on 4H opened with the left half of the plot empty.
    if (!bars.length || data?.tf !== tf || data.symbol !== pair?.symbol) return
    // A stock's extended hours: the candles and their volume go quiet and the
    // bands shade the stretch behind them, so an hour of pre-market dust reads
    // as a quiet session instead of a hole in the tape.
    const quiet = (i: number) => sessions !== null && sessions[i] !== 'regular'
    cs.setData(bars.map((c, i) => {
      const bar = { time: c.t as UTCTimestamp, open: c.o, high: c.h, low: c.l, close: c.c }
      if (!quiet(i)) return bar
      const color = alpha(c.c >= c.o ? tokens.up : tokens.down, QUIET_CANDLE_ALPHA)
      return { ...bar, color, wickColor: color, borderColor: color }
    }))
    vs.setData(bars.map((c, i) => ({ time: c.t as UTCTimestamp, value: c.v, color: alpha(c.c >= c.o ? tokens.up : tokens.down, quiet(i) ? 0.14 : 0.28) })))
    bandsRef.current?.update(sessions ? extendedRuns(sessions) : [], tokens.session)
    vpRef.current?.update(overlays.has('vp') && hasVolume(bars) ? bars : [], alpha(tokens.muted2, 0.28), alpha(tokens.up, 0.55))
    drawnRef.current = bars.length
    const key = `${symbol}:${tf}`
    if (fitOnceRef.current !== key) {
      const older = bars.length - candles.length
      if (older > 0) chart.timeScale().setVisibleLogicalRange({ from: older as Logical, to: (bars.length - 1 + RIGHT_OFFSET) as Logical })
      else chart.timeScale().fitContent()
      fitOnceRef.current = key
    }
    setGeomTick((n) => n + 1)
  }, [bars, sessions, candles.length, data?.tf, data?.symbol, pair?.symbol, symbol, tf, tokens, overlays])

  // Compare: a second symbol's candles at the chart's frame, drawn as a line
  // on the LEFT scale in percentage mode (indexed to the first bar on screen).
  const cmpPair = useMemo(() => (compare ? chartPairFor(compare) : null), [compare])
  useEffect(() => {
    if (!cmpPair || cmpPair.symbol === pair?.symbol) {
      setCmp(null)
      return
    }
    let alive = true
    const load = async () => {
      try {
        // ?warmup=1: the second feed's bars BEFORE its window too, so the line
        // reaches back as far as the chart's own warmed history instead of
        // starting mid-plot on 1H.
        const res = await fetch(`/api/charts/candles?symbol=${encodeURIComponent(cmpPair.symbol)}&tf=${tf}&warmup=1`, { cache: 'no-store' })
        const body = (await res.json()) as CandlesResponse
        if (alive && body.candles?.length) setCmp({ symbol: cmpPair.symbol, tf, candles: [...(body.warmup ?? []), ...body.candles] })
      } catch {
        /* the compare line simply stays off */
      }
    }
    void load()
    const timer = setInterval(() => void load(), 60_000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [cmpPair, pair?.symbol, tf])
  useEffect(() => {
    const chart = chartRef.current
    if (!chart || !tokens) return
    const want = cmp && cmp.tf === tf && cmp.candles.length > 1
    if (!want) {
      if (compareRef.current) {
        chart.removeSeries(compareRef.current)
        compareRef.current = null
        chart.applyOptions({ leftPriceScale: { visible: false } })
      }
      return
    }
    if (!compareRef.current) {
      compareRef.current = chart.addSeries(LineSeries, { priceScaleId: 'left', lineWidth: 2, color: tokens.compare, priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: true, title: cmp.symbol })
      chart.applyOptions({ leftPriceScale: { visible: true, mode: PriceScaleMode.Percentage, borderColor: alpha(tokens.line, 0.6) } })
    } else compareRef.current.applyOptions({ color: tokens.compare, title: cmp.symbol })
    compareRef.current.setData(cmp.candles.map((c) => ({ time: c.t as UTCTimestamp, value: c.c })))
  }, [cmp, tf, tokens])

  // Overlays → line series. The rolling lines read every held bar (older
  // pages, the warm-up, merged polls) and are cut back to the bars on the
  // canvas, so each starts at the first candle on screen unless the feed has
  // nothing older. VWAP stays a statistic of the live window.
  useEffect(() => {
    const chart = chartRef.current
    if (!chart || !tokens) return
    const want = new Map<string, { data: LinePoint[]; color: string; width: 1 | 2; style?: LineStyle }>()
    if (bars.length) {
      const src = lineSrc
      const cut = (pts: LinePoint[]) => (src === bars ? pts : onWindow(pts, bars))
      if (overlays.has('sma20')) want.set('sma20', { data: cut(sma(src, 20)), color: tokens.up, width: 1 })
      // The slow pair draws 2px: at 1px the yellow antialiases into a muddy
      // gold on a dark canvas, and these are the trend lines the page opens on.
      if (overlays.has('sma50')) want.set('sma50', { data: cut(sma(src, 50)), color: tokens.ma50, width: 2 })
      if (overlays.has('sma200')) want.set('sma200', { data: cut(sma(src, 200)), color: tokens.ma200, width: 2 })
      if (overlays.has('ema20')) want.set('ema20', { data: cut(ema(src, 20)), color: alpha(tokens.fg, 0.7), width: 1 })
      if (overlays.has('bb')) {
        const bb = bollinger(src, 20, 2)
        want.set('bb:u', { data: cut(bb.upper), color: alpha(tokens.muted2, 0.8), width: 1, style: LineStyle.Dotted })
        want.set('bb:m', { data: cut(bb.middle), color: alpha(tokens.muted2, 0.5), width: 1, style: LineStyle.Dotted })
        want.set('bb:l', { data: cut(bb.lower), color: alpha(tokens.muted2, 0.8), width: 1, style: LineStyle.Dotted })
      }
      if (overlays.has('vwap') && hasVolume(candles)) want.set('vwap', { data: vwap(candles), color: alpha(tokens.down, 0.75), width: 1, style: LineStyle.Dashed })
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
    // Candles paint above every line (the engine draws a pane's series in
    // order): a 2px average laid over a quiet bar hid it whole, and the gap
    // read as a missing candle. The price scale keeps localization's formatter.
    const cs = candleRef.current
    const top = overlayRefs.current.size + 1
    if (cs && cs.seriesOrder() < top) cs.setSeriesOrder(top)
  }, [overlays, bars, lineSrc, candles, tokens])

  // News markers + the wallet's own fills → the bars. A fill is a receipt
  // glyph in its venue's series ink: an up-arrow under the bar for a buy, a
  // down-arrow over it for a sell; the legend under the chart carries the words.
  useEffect(() => {
    const api = markerApiRef.current
    if (!api || !tokens) return
    if (!bars.length || (!markers?.length && !fills?.length)) {
      api.setMarkers([])
      return
    }
    const out: SeriesMarker<Time>[] = []
    markers?.forEach((m, i) => {
      const bt = barTimeFor(bars, m.t)
      if (bt === null) return
      out.push({ time: bt as UTCTimestamp, position: 'aboveBar', shape: 'circle', color: alpha(tokens.fg, 0.75), size: 1, id: `news-${i}-${m.t}`, text: m.label.length > 28 ? `${m.label.slice(0, 27)}…` : m.label })
    })
    fills?.forEach((f) => {
      // A fill before the first held bar has no bar to sit on; it stays in the legend.
      if (f.t < bars[0].t) return
      const bt = barTimeFor(bars, f.t)
      if (bt === null) return
      const slot = Number((seriesVar(f.venueId).match(/--mk-series-(\d)/) ?? [])[1] ?? 8) - 1
      const ink = tokens.series[slot] ?? tokens.fg
      const amt = f.usd != null && Number.isFinite(f.usd) ? `$${f.usd >= 100 ? Math.round(f.usd).toLocaleString('en-US') : f.usd.toFixed(2)}` : ''
      out.push({ time: bt as UTCTimestamp, position: f.side === 'buy' ? 'belowBar' : 'aboveBar', shape: f.side === 'buy' ? 'arrowUp' : 'arrowDown', color: ink, size: 1.6, id: `fill-${f.id}`, text: `${f.side === 'buy' ? 'Bought' : 'Sold'} ${amt}`.trim() })
    })
    out.sort((a, b) => (a.time as number) - (b.time as number))
    api.setMarkers(out)
  }, [markers, fills, bars, tokens])

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
      const color = l.action ? (l.action.kind === 'sell' || (l.action.kind === 'limit' && /sell/.test(l.action.ask)) || l.action.kind === 'stop' ? tokens.down : tokens.up) : tokens.muted
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
    if (!chart || !cs || !el || !bars.length) return null
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
        const l = timeToLogical(bars, t)
        if (l === null) return null
        // The engine converts whole bar indices only (5.2.1 answers a
        // fractional logical with x = 0), and a drawing's time lands between
        // bars once the frame changes: a trend line drawn on 15m and viewed
        // on 1H pinned its end to the left edge. Interpolate between neighbours.
        const ts = chart.timeScale()
        const i = Math.floor(l)
        const x0 = ts.logicalToCoordinate(i as Logical)
        const x1 = ts.logicalToCoordinate((i + 1) as Logical)
        return x0 === null || x1 === null ? null : Number(x0) + (Number(x1) - Number(x0)) * (l - i)
      },
    }
  }, [geomTick, bars])

  // A level's Sell chips ("Sell here", "Sell ETH now") show only while the
  // connected wallet holds the symbol (lib/sell-gate): nothing to sell, no chip.
  const held = useHeld()
  const offersFor = useCallback(
    (line: ChartLine): LineActionOffer[] => {
      if (!pair || last === null) return []
      const offers =
        line.kind === 'h'
          ? composeLineActions({ symbol: pair.symbol, source: pair.source, price: line.price, last, usd: actionUsd })
          : line.kind === 'zone'
            ? composeZoneActions({ symbol: pair.symbol, source: pair.source, p1: line.p1, p2: line.p2, last, usd: actionUsd })
            : []
      return offers.filter((o) => canSellAsk(o.action.ask, held))
    },
    [pair, last, actionUsd, held],
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
              style={{ '--ind-sw': o.swatch } as CSSProperties}
              onClick={() =>
                setOverlays((cur) => {
                  const next = new Set(cur)
                  if (next.has(o.key)) next.delete(o.key)
                  else next.add(o.key)
                  return next
                })
              }
            >
              <span className="mkt-ind__sw" aria-hidden="true" />
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
        {overlay}
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

      {/* Your fills — the glyphs on the bars; the receipt words + explorer link live here. */}
      {fills && fills.length > 0 && pair && (
        <ul className="mkt-markers mk-fills" aria-label="Your fills on this chart">
          {fills.slice(-6).map((f) => {
            const label = fillLabel(f, pair.symbol)
            return (
              <li key={f.id} className={`mk-fills__row mk-fills__row--${f.side}`}>
                <i className="mk-fills__glyph" style={{ background: seriesVar(f.venueId) }} aria-hidden="true" />
                {f.txUrl ? (
                  <a href={f.txUrl} target="_blank" rel="noopener noreferrer nofollow" title={label}>
                    {label}
                  </a>
                ) : (
                  <span title={label}>{label}</span>
                )}
              </li>
            )
          })}
          {fills.length > 6 ? <li className="mk-fills__more">+{fills.length - 6} earlier</li> : null}
        </ul>
      )}
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
        {cmp && cmp.tf === tf ? <span>vs {cmp.symbol} · % since the first bar on screen (left scale) · </span> : null}
        <span>
          {feedLabel ? `feed · ${String(feedLabel)}` : ''}
          {sessions && feedLabel ? ' · shaded = pre/post-market' : ''}
        </span>
        <a className="mkt-attrib" href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer nofollow">
          Charts by TradingView Lightweight Charts™ · <span className="mkt-attrib__notice">© 2025 TradingView, Inc.</span>
        </a>
      </div>
    </div>
  )
}
