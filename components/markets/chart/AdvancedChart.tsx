'use client'

// AdvancedChart — the symbol page's chart on TradingView's Advanced Charts.
//
// The library draws the bars, owns the frames, the indicators and a hundred
// drawing tools. Pantessa supplies everything around it:
//
//   the data      lib/tv/datafeed: our candles endpoint, the older pages a
//                 zoom-out pulls in, and the instrument's own prints on the
//                 forming bar
//   the plan      lib/tv/plan: every drawing that names a price (a level, a
//                 zone, a fib, a Long / Short Position box) is read into the
//                 sentences that act on it, under the chart, one tap each
//   the memory    lib/tv/store: drawings per symbol, the layout for all
//   the bridge    lib/tv/shapes: what you drew, in the small schema a call,
//                 a post and Ask the chart still speak; and what THEY draw
//                 (a fork, the AI's levels) put back on this chart
//
// It is mounted only by ChartMount, only when the build ships the library
// (lib/tv/config). Any failure to load calls `onFail` and the built-in
// chart takes over: a visitor never sees an empty box.
//
// LICENCE: Advanced Charts is free "provided that the TradingView
// attribution remains visible". The library's own logo on the plot is that
// attribution and nothing here hides it; the foot names TradingView too.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ChartCandlestick, Grid3x3, Layers2, Minus, RectangleHorizontal, Rows3, ScrollText, Share2, TrendingDown, TrendingUp, X } from 'lucide-react'
import { DEFAULT_CHART_TF, chartPairFor, chartUnitOf, isHip3Pair, isLookOnlyPair, isPrintTf, sourceHasTf, type ChartTf } from '@/lib/charts'
import { PRINT_BAR_SPACING } from '@/lib/chart-viewport'
import { chartLiveFeed, livePriceStats, tailIsLive, tailWords } from '@/lib/chart-live'
import { CHART_STATE_MAX_LINES, serializeChartState, type ChartLine, type ChartState } from '@/lib/chart-state'
import { missingActionNote, type LineActionOffer } from '@/lib/chart-actions'
import { fillLabel, type FillMarker } from '@/lib/chart-fills'
import { watermarkUrl } from '@/lib/chart-share'
import { syncTfParam, type ChartView } from '@/lib/markets'
import { seriesVar } from '@/lib/markets-look'
import { canSellAsk } from '@/lib/sell-gate'
import { canTradeAsk } from '@/lib/trade-venue-gate'
import { useHeld } from '@/lib/use-held'
import { useTradable } from '@/lib/use-tradable'
import type { FeedStatus } from '@/lib/tape-feed'
import { fmtPrice, type ChartStats } from '@/components/CandleChart'
import { TV_LIBRARY_PATH } from '@/lib/tv/config'
import { createPantessaDatafeed, type PantessaDatafeed } from '@/lib/tv/datafeed'
import { loadTvLibrary } from '@/lib/tv/loader'
import { planFor, type PlanItem } from '@/lib/tv/plan'
import { pageTfOfResolution, resolutionsForSource, tvResolution, TF_SECONDS } from '@/lib/tv/resolution'
import { linesFromShapes, sameLines, shapeFromLine, type ShapeSnapshot } from '@/lib/tv/shapes'
import { externalApplied, layoutForChart, legacyMoved, markExternalApplied, markLegacyMoved, readStoredLayout, writeStoredLayout } from '@/lib/tv/store'
import { tvCssProperties, tvOverrides, tvStudyOverrides } from '@/lib/tv/theme'
import type { TvChartApi, TvWidget } from '@/lib/tv/types'
import { readTokens, type Tokens } from './chart-tokens'
import ChartShare from './ChartShare'
import { useHeatYear } from './PositionHeat'
import './advanced-chart.css'

const LIVE_EMIT_MS = 250
const LIVE_PRINT_FRESH_MS = 60_000
const SYNC_MS = 140

export interface AdvancedChartProps {
  /** The engine choice is settled: load the library and build the chart.
   *  Until then only the shell renders (it is what the server sends). */
  armed: boolean
  symbol: string
  height?: number | 'fill'
  defaultTf?: ChartTf
  urlTf?: boolean
  /** Drawings from outside: a fork, or the lines Ask the chart proposes. */
  state?: ChartState | null
  /** The viewer's drawings from the built-in chart, moved over once. */
  legacy?: ChartState | null
  onStateChange?: (s: ChartState) => void
  markers?: { t: number; label: string; url?: string }[]
  onAsk?: (ask: string) => void
  askHref?: (ask: string) => string
  onStats?: (s: ChartStats) => void
  controlsRight?: ReactNode
  resizeKey?: string | number | boolean
  actionUsd?: number
  onViewport?: (v: { from: number; to: number; tf: ChartTf }) => void
  compare?: string | null
  fills?: FillMarker[]
  /** Offer the other views (Depth, Heatmap, Tape) beside the chart. */
  battlefield?: boolean
  /** A view only the built-in chart draws was picked. */
  onView?: (view: ChartView) => void
  /** The library could not start: hand the page to the built-in chart. */
  onFail: (reason: string) => void
  /** The frame the chart is on (the built-in chart opens on it after a switch). */
  onTf?: (tf: ChartTf) => void
}

/** Is a background this dark? (the library has two base themes; ours are tokens) */
function isDark(hex: string): boolean {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!m) return true
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => parseInt(x, 16) / 255)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.5
}

const QUICK_TOOLS: { tool: string; label: string; title: string; Icon: typeof Minus }[] = [
  { tool: 'horizontal_line', label: 'Level', title: 'A level: click a price. It can carry a buy, a sell or a stop.', Icon: Minus },
  { tool: 'rectangle', label: 'Zone', title: 'A zone: drag a box. Buy at its floor, sell at its ceiling.', Icon: RectangleHorizontal },
  { tool: 'fib_retracement', label: 'Fib', title: 'A retracement: drag the swing. Each level can rest an order.', Icon: Rows3 },
  { tool: 'long_position', label: 'Long', title: 'A long position: entry, stop and target in one box, built as one trade.', Icon: TrendingUp },
  { tool: 'short_position', label: 'Short', title: 'A short position: entry, stop and target in one box.', Icon: TrendingDown },
]

export default function AdvancedChart({
  armed,
  symbol,
  height: heightProp = 'fill',
  defaultTf = DEFAULT_CHART_TF,
  urlTf = false,
  state,
  legacy,
  onStateChange,
  markers,
  onAsk,
  askHref,
  onStats,
  controlsRight,
  resizeKey,
  actionUsd,
  onViewport,
  compare,
  fills,
  battlefield = false,
  onView,
  onFail,
  onTf,
}: AdvancedChartProps) {
  const fill = heightProp === 'fill'
  const pair = useMemo(() => chartPairFor(symbol), [symbol])
  const lookOnly = isLookOnlyPair(pair)
  const priceSign = chartUnitOf(pair) === 'usd' ? '$' : ''
  const startTf: ChartTf = pair && sourceHasTf(pair.source, state?.tf ?? defaultTf) ? (state?.tf ?? defaultTf) : pair && sourceHasTf(pair.source, defaultTf) ? defaultTf : '15m'
  const [tf, setTf] = useState<ChartTf>(startTf)
  const [ready, setReady] = useState(false)
  const [tailStatus, setTailStatus] = useState<FeedStatus>('idle')
  const [feedLabel, setFeedLabel] = useState<string | null>(null)
  const [last, setLast] = useState<number | null>(null)
  const [shapes, setShapes] = useState<ShapeSnapshot[]>([])
  const [lines, setLines] = useState<ChartLine[]>([])
  const [focusId, setFocusId] = useState<string | null>(null)
  const [shareOpen, setShareOpen] = useState(false)
  const [planOpen, setPlanOpen] = useState(true)

  const hostRef = useRef<HTMLDivElement | null>(null)
  const widgetRef = useRef<TvWidget | null>(null)
  const chartRef = useRef<TvChartApi | null>(null)
  const feedRef = useRef<PantessaDatafeed | null>(null)
  const tokensRef = useRef<Tokens | null>(null)
  const tfRef = useRef(tf)
  tfRef.current = tf

  // Everything the long-lived widget reads goes through refs: it is built once per symbol.
  const fillsRef = useRef(fills)
  fillsRef.current = fills
  const markersRef = useRef(markers)
  markersRef.current = markers
  const onStatsRef = useRef(onStats)
  onStatsRef.current = onStats
  const onStateRef = useRef(onStateChange)
  onStateRef.current = onStateChange
  const onViewportRef = useRef(onViewport)
  onViewportRef.current = onViewport
  const onFailRef = useRef(onFail)
  onFailRef.current = onFail
  const onTfRef = useRef(onTf)
  onTfRef.current = onTf
  const stateRef = useRef(state)
  stateRef.current = state
  const legacyRef = useRef(legacy)
  legacyRef.current = legacy

  // ── The header follows the prints (the built-in chart's rule, lib/chart-live) ──
  const emittedRef = useRef<ChartStats | null>(null)
  const livePrintRef = useRef<{ price: number; at: number } | null>(null)
  const liveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const emitWindow = useCallback((s: ChartStats) => {
    const lp = livePrintRef.current
    const next = lp && lp.at > Date.now() - LIVE_PRINT_FRESH_MS && s.last != null ? livePriceStats(s, lp.price) : s
    emittedRef.current = next
    onStatsRef.current?.(next)
    setLast(next.last)
  }, [])
  const emitPrint = useCallback((price: number) => {
    if (!(price > 0)) return
    livePrintRef.current = { price, at: Date.now() }
    if (liveTimerRef.current) return
    liveTimerRef.current = setTimeout(() => {
      liveTimerRef.current = null
      const prev = emittedRef.current
      const lp = livePrintRef.current
      if (!prev || !lp) return
      const next = livePriceStats(prev, lp.price)
      if (next === prev) return
      emittedRef.current = next
      onStatsRef.current?.(next)
      setLast(next.last)
    }, LIVE_EMIT_MS)
  }, [])
  useEffect(
    () => () => {
      if (liveTimerRef.current) clearTimeout(liveTimerRef.current)
    },
    [],
  )

  // ── Drawings: the chart's own → our schema, and the store ─────────────────
  const lastEmittedRef = useRef<string>('')
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const applyingRef = useRef(false)
  const sym = pair?.symbol ?? symbol.toUpperCase()

  const syncNow = useCallback(() => {
    const chart = chartRef.current
    if (!chart || applyingRef.current) return
    let snap: ShapeSnapshot[] = []
    try {
      snap = chart.getAllShapes().flatMap(({ id, name }) => {
        try {
          const api = chart.getShapeById(id)
          return [{ id, name, points: api.getPoints(), props: api.getProperties() ?? {} }]
        } catch {
          return []
        }
      })
    } catch {
      return
    }
    setShapes(snap)
    const next = linesFromShapes(snap, CHART_STATE_MAX_LINES)
    setLines((cur) => (sameLines(cur, next) ? cur : next))
    const st: ChartState = { v: 1, symbol: sym, tf: tfRef.current, lines: next }
    const key = serializeChartState(st)
    if (key !== lastEmittedRef.current) {
      lastEmittedRef.current = key
      onStateRef.current?.(st)
    }
  }, [sym])
  const scheduleSync = useCallback(() => {
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current)
    syncTimerRef.current = setTimeout(syncNow, SYNC_MS)
  }, [syncNow])
  /** Keep the layout (it carries the drawings). The library asks for a save
   *  two seconds after a change; a drawing is also kept right away, so one
   *  made just before leaving the page is not lost. */
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveLayout = useCallback(() => {
    try {
      widgetRef.current?.save((s) => writeStoredLayout(s))
    } catch {
      /* nothing saved this time */
    }
  }, [])
  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(saveLayout, 600)
  }, [saveLayout])

  /** Put stored lines on the chart as the library's own shapes. */
  const drawLines = useCallback(async (chart: TvChartApi, list: readonly ChartLine[]) => {
    const now = Math.floor(Date.now() / 1000)
    const barSec = TF_SECONDS[tfRef.current]
    for (const line of list) {
      const spec = shapeFromLine(line, now, barSec)
      try {
        if (spec.points.length === 1) await chart.createShape(spec.points[0], spec.options)
        else await chart.createMultipointShape(spec.points, spec.options)
      } catch {
        /* a line the chart refuses is skipped; the rest still draw */
      }
    }
  }, [])

  // ── The widget: one per symbol ────────────────────────────────────────────
  useEffect(() => {
    const host = hostRef.current
    if (!armed || !host || !pair) return
    let dead = false
    let widget: TvWidget | null = null
    let themeWatch: MutationObserver | null = null
    const tokens = readTokens()
    tokensRef.current = tokens

    const feed = createPantessaDatafeed({
      mainSymbol: pair.symbol,
      initialTf: startTf,
      onWindow: (w) => {
        if (dead) return
        setFeedLabel(w.feed)
        emitWindow({ last: w.last, changePct24h: w.changePct24h, label: w.label, source: w.source, feed: w.feed })
      },
      onPrint: (p) => !dead && emitPrint(p),
      onTail: (s) => !dead && setTailStatus(s),
      onGap: () => {
        try {
          chartRef.current?.resetData()
        } catch {
          /* the next poll tries again */
        }
      },
      fills: () => fillsRef.current ?? [],
      news: () => markersRef.current ?? [],
      inks: () => {
        const t = tokensRef.current ?? tokens
        return { up: t.up, down: t.down, fg: t.fg, bg: t.bg, accent: t.accent }
      },
    })
    feedRef.current = feed

    const phone = typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches
    let tz = 'Etc/UTC'
    try {
      tz = Intl.DateTimeFormat().resolvedOptions().timeZone || tz
    } catch {
      /* UTC */
    }

    loadTvLibrary()
      .then((tv) => {
        if (dead) return
        const layout = layoutForChart(readStoredLayout(), pair.symbol, tvResolution(startTf))
        widget = new tv.widget({
          container: host,
          datafeed: feed,
          symbol: pair.symbol,
          interval: tvResolution(startTf),
          library_path: TV_LIBRARY_PATH,
          locale: 'en',
          autosize: true,
          theme: isDark(tokens.bg) ? 'dark' : 'light',
          timezone: tz,
          // The page IS the symbol (its header, its ticket, its tabs): the
          // chart does not navigate. Layouts are kept by us, not a dialog.
          // The market-status badge is off because every market is described
          // as round-the-clock (lib/tv/symbol): it would read "open" on a Sunday.
          disabled_features: ['header_symbol_search', 'symbol_search_hot_key', 'header_saveload', 'display_market_status', 'popup_hints', 'header_quick_search', 'study_templates'],
          enabled_features: ['seconds_resolution', ...(phone ? ['hide_left_toolbar_by_default'] : [])],
          overrides: tvOverrides(tokens),
          studies_overrides: tvStudyOverrides(tokens),
          loading_screen: { backgroundColor: tokens.bg, foregroundColor: tokens.accent },
          favorites: { intervals: resolutionsForSource(pair.source) },
          time_frames: [
            { text: '1d', resolution: '15', description: '1 day in 15 minute bars' },
            { text: '5d', resolution: '60', description: '5 days in 1 hour bars' },
            { text: '1m', resolution: '240', description: '1 month in 4 hour bars' },
            { text: '6m', resolution: '1D', description: '6 months in daily bars' },
            { text: '1y', resolution: '1D', description: '1 year in daily bars' },
            { text: '5y', resolution: '1W', description: '5 years in weekly bars' },
          ],
          auto_save_delay: 2,
          ...(layout ? { saved_data: layout } : {}),
        })
        widgetRef.current = widget
        const w = widget

        const applyTheme = (t: Tokens) => {
          try {
            w.applyOverrides({ ...tvOverrides(t), ...tvStudyOverrides(t) })
            for (const [k, v] of Object.entries(tvCssProperties(t))) w.setCSSCustomProperty(k, v)
          } catch {
            /* the widget is going away */
          }
        }

        w.onChartReady(() => {
          if (dead) return
          const chart = w.activeChart()
          chartRef.current = chart
          applyTheme(tokens)

          // A saved layout remembers the symbol and frame it was saved on: this page decides both.
          try {
            if (chart.symbol().split(':').pop()?.toUpperCase() !== pair.symbol.toUpperCase()) void chart.setSymbol(pair.symbol)
            if (pageTfOfResolution(chart.resolution()) !== startTf || chart.resolution() !== tvResolution(startTf)) void chart.setResolution(tvResolution(startTf))
          } catch {
            /* the constructor's own symbol and interval stand */
          }

          // A print frame holds minutes, not months: at the bar width a daily
          // chart was left on, its bars are hairs against the right edge. It
          // opens at the built-in chart's readable width instead.
          const readablePrints = (resolution: string) => {
            if (!isPrintTf(pageTfOfResolution(resolution))) return
            try {
              const scale = chart.getTimeScale()
              if (scale.barSpacing() < PRINT_BAR_SPACING) scale.setBarSpacing(PRINT_BAR_SPACING)
            } catch {
              /* the chart keeps the width it has */
            }
          }
          readablePrints(tvResolution(startTf))
          chart.onIntervalChanged().subscribe(null, (interval) => {
            const next = pageTfOfResolution(interval)
            setTf(next)
            onTfRef.current?.(next)
            readablePrints(interval)
          })
          chart.onVisibleRangeChanged().subscribe(null, (range) => {
            if (range && Number.isFinite(range.from) && Number.isFinite(range.to)) onViewportRef.current?.({ from: Math.floor(range.from), to: Math.floor(range.to), tf: tfRef.current })
          })

          w.subscribe('drawing_event', ((id: string, type: string) => {
            if (type === 'click') setFocusId(id)
            if (type === 'create') {
              setFocusId(id)
              setPlanOpen(true)
            }
            scheduleSync()
            scheduleSave()
          }) as never)
          // The "+" on the price axis drops a level at that price: it shows up in the plan, ready to act on.
          w.subscribe('onPlusClick', ((p: { price: number }) => {
            if (!(p?.price > 0)) return
            void chart.createShape({ time: Math.floor(Date.now() / 1000), price: p.price }, { shape: 'horizontal_line' })
          }) as never)
          w.subscribe('onAutoSaveNeeded', (() => saveLayout()) as never)

          // Drawings come back with the layout (the library binds each to
          // its symbol). Two things are drawn on top: the ones made on the
          // built-in chart, moved over once, and whatever arrived from
          // outside (a fork).
          const restore = async () => {
            applyingRef.current = true
            try {
              if (!legacyMoved(pair.symbol)) {
                if (legacyRef.current?.lines.length) await drawLines(chart, legacyRef.current.lines)
                markLegacyMoved(pair.symbol)
              }
              // A fork is drawn once on this browser, then it lives in the
              // layout: the same link reloaded does not draw it again.
              const outside = stateRef.current
              if (outside?.lines.length) {
                const key = serializeChartState(outside)
                if (!externalApplied(pair.symbol, key)) {
                  await drawLines(chart, outside.lines)
                  markExternalApplied(pair.symbol, key)
                }
              }
            } catch {
              /* a line the chart refuses is left behind */
            } finally {
              applyingRef.current = false
            }
            if (stateRef.current) lastEmittedRef.current = serializeChartState(stateRef.current)
            if (!dead) {
              syncNow()
              setReady(true)
            }
          }
          void restore()
        })

        // The site's theme flips (html[data-theme]): re-read the tokens, re-ink the chart.
        themeWatch = new MutationObserver(() => {
          const t = readTokens()
          tokensRef.current = t
          void w
            .changeTheme(isDark(t.bg) ? 'dark' : 'light', { disableUndo: true })
            .catch(() => undefined)
            .then(() => applyTheme(t))
        })
        themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] })
      })
      .catch((err: unknown) => {
        if (!dead) onFailRef.current(err instanceof Error ? err.message : 'chart library failed')
      })

    return () => {
      dead = true
      themeWatch?.disconnect()
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current)
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
        try {
          widget?.save((s) => writeStoredLayout(s))
        } catch {
          /* the last save stands */
        }
      }
      feed.dispose()
      feedRef.current = null
      chartRef.current = null
      widgetRef.current = null
      try {
        widget?.remove()
      } catch {
        /* already gone */
      }
    }
    // One widget per symbol: everything else reaches it through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [armed, pair?.symbol, pair?.source])

  // The frame is a shareable address on the symbol page.
  useEffect(() => {
    if (urlTf) syncTfParam(tf, DEFAULT_CHART_TF)
  }, [tf, urlTf])

  // Drawings from outside AFTER mount (Ask the chart proposes levels, a post is forked):
  // draw the ones this chart does not have yet. Our own echo is ignored.
  useEffect(() => {
    const chart = chartRef.current
    if (!ready || !chart || !state) return
    const key = serializeChartState(state)
    if (key === lastEmittedRef.current) return
    lastEmittedRef.current = key
    markExternalApplied(sym, key)
    const have = new Set(lines.map((l) => l.id))
    const fresh = state.lines.filter((l) => !have.has(l.id))
    const gone = lines.filter((l) => !state.lines.some((x) => x.id === l.id))
    void (async () => {
      applyingRef.current = true
      try {
        for (const l of gone) {
          const entity = shapes.find((s) => `tv_${s.id}` === l.id)?.id
          if (entity) chart.removeEntity(entity)
        }
        await drawLines(chart, fresh)
      } finally {
        applyingRef.current = false
        syncNow()
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, ready])

  // Fills and news marks are read when the library asks: ask again when they change.
  useEffect(() => {
    if (!ready) return
    try {
      chartRef.current?.clearMarks()
      chartRef.current?.refreshMarks()
    } catch {
      /* the next range change redraws them */
    }
  }, [fills, markers, ready])

  // The page's Compare control (?vs=): the second symbol as a % line.
  const compareIdRef = useRef<string | null>(null)
  useEffect(() => {
    const chart = chartRef.current
    if (!ready || !chart) return
    if (compareIdRef.current) {
      try {
        chart.removeEntity(compareIdRef.current)
      } catch {
        /* already removed in the chart's own legend */
      }
      compareIdRef.current = null
    }
    const vs = compare ? chartPairFor(compare)?.symbol : null
    if (!vs) return
    let alive = true
    void chart
      .createStudy('Compare', false, false, { source: 'close', symbol: vs })
      .then((id) => {
        if (alive) compareIdRef.current = id
        else if (id) chart.removeEntity(id)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [compare, ready])

  // ── The plan: what the drawings can do ────────────────────────────────────
  const held = useHeld()
  const tradable = useTradable()
  const plan = useMemo<(Omit<PlanItem, 'rows'> & { rows: (PlanItem['rows'][number] & { needsHolding: boolean })[] })[]>(() => {
    if (!pair || last === null || lookOnly) return []
    const ok = (o: LineActionOffer) => canSellAsk(o.action.ask, held) && canTradeAsk(o.action.ask, tradable)
    return planFor(shapes, { symbol: pair.symbol, source: pair.source, last, usd: actionUsd, pricescale: feedRef.current?.pricescale() ?? 10_000 })
      .map((it) => ({
        ...it,
        whole: it.whole && ok(it.whole) ? it.whole : undefined,
        // A row whose orders all need the token in the wallet says so, instead of "no order here".
        rows: it.rows.map((r) => ({ ...r, offers: r.offers.filter(ok), needsHolding: r.offers.length > 0 && r.offers.every((o) => !canSellAsk(o.action.ask, held)) })),
      }))
      .filter((it) => it.kind !== 'level' || it.rows.some((r) => r.offers.length > 0))
  }, [shapes, pair, last, lookOnly, actionUsd, held, tradable])
  const missing = pair ? missingActionNote(pair.symbol, pair.source) : null

  const pickTool = useCallback((tool: string) => {
    try {
      void widgetRef.current?.selectLineTool(tool)
    } catch {
      /* the toolbar still has it */
    }
  }, [])
  const selectShape = useCallback((id: string) => {
    setFocusId(id)
    try {
      const sel = chartRef.current?.selection()
      sel?.clear()
      sel?.add(id)
    } catch {
      /* the row is still highlighted */
    }
  }, [])
  const removeShape = useCallback((id: string) => {
    try {
      chartRef.current?.removeEntity(id)
    } catch {
      /* gone already */
    }
    scheduleSync()
  }, [scheduleSync])

  // The other views live on the built-in chart; the switch looks the same on both.
  const heatCandidate = battlefield && !!pair && pair.source !== 'robinhood' && !isHip3Pair(pair) && !lookOnly
  const heatYear = useHeatYear(pair?.symbol ?? symbol, heatCandidate)
  const heatTab = heatCandidate && (heatYear.derivs ? heatYear.cells.some((c) => c.long !== null) : !heatYear.failed)
  const liveFeed = useMemo(() => chartLiveFeed(pair), [pair])
  const tapeTab = !heatTab && !!pair && (pair.source === 'coinbase' || pair.source === 'hyperliquid' || !!liveFeed)

  if (!pair) {
    return <div className="rounded-xl border border-[var(--line)] px-4 py-6 text-center text-[12px] text-[color:var(--muted-2)]">No live chart for {symbol.toUpperCase()} yet.</div>
  }

  const chip = (o: LineActionOffer, primary = false) =>
    onAsk ? (
      <button key={o.action.ask} type="button" className={`tvx-chip${primary ? ' tvx-chip--primary' : ''}`} title={o.hint} onClick={() => onAsk(o.action.ask)}>
        {o.label}
      </button>
    ) : (
      <a key={o.action.ask} className={`tvx-chip${primary ? ' tvx-chip--primary' : ''}`} title={o.hint} href={(askHref ?? ((a: string) => `/chat?prompt=${encodeURIComponent(a)}`))(o.action.ask)}>
        {o.label}
      </a>
    )

  return (
    <div className={fill ? 'mkt-chart tvx min-h-0 flex-1' : 'mkt-chart tvx'} data-engine="advanced" data-tail={liveFeed && tailIsLive(tf, liveFeed) ? tailStatus : 'polled'} data-ready={ready ? '' : undefined} data-resize={String(resizeKey ?? '')}>
      <div className="mkt-chart__bar">
        {battlefield && !lookOnly && (
          <div className="mkt-view" role="group" aria-label="Chart view">
            <button type="button" className="mkt-view__btn mono is-active" aria-pressed title="Candles">
              <ChartCandlestick className="h-3.5 w-3.5" />
              <span>Candles</span>
            </button>
            <button type="button" className="mkt-view__btn mono" aria-pressed={false} title="Depth: the resting order book as a curve, the prints landing on it live" onClick={() => onView?.('depth')}>
              <Layers2 className="h-3.5 w-3.5" />
              <span>Depth</span>
            </button>
            {heatTab && (
              <button type="button" className="mkt-view__btn mono" aria-pressed={false} title="Heatmap: a year of longs vs shorts, one cell a day" onClick={() => onView?.('heat')}>
                <Grid3x3 className="h-3.5 w-3.5" />
                <span>Heatmap</span>
              </button>
            )}
            {tapeTab && (
              <button type="button" className="mkt-view__btn mono" aria-pressed={false} title="Tape: this market's trades as they print, newest first" onClick={() => onView?.('tape')}>
                <ScrollText className="h-3.5 w-3.5" />
                <span>Tape</span>
              </button>
            )}
          </div>
        )}
        <span className="mkt-chart__right">
          <span className="mono flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[color:var(--muted-2)]">
            {lookOnly ? (
              <>
                <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: 'var(--muted-2)' }} />
                delayed
              </>
            ) : (
              <>
                <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: 'var(--accent)' }} />
                live
              </>
            )}
          </span>
          {ready && (
            <button type="button" className="mkt-sharebtn mono" aria-haspopup="dialog" aria-expanded={shareOpen} title="Share this chart: image, link, or a stamped call on X" onClick={() => setShareOpen(true)}>
              <Share2 className="h-3 w-3" /> Share
            </button>
          )}
          {controlsRight}
        </span>
      </div>

      <div className={`mkt-chart__canvas tvx__canvas${fill ? ' min-h-0 flex-1' : ''}`} style={fill ? undefined : { height: heightProp }}>
        <div ref={hostRef} className="tvx__host" />
      </div>

      {/* THE PLAN: what you drew, as things you can do. */}
      {!lookOnly && (
        <section className={`tvx-plan${planOpen ? '' : ' is-folded'}`} aria-label="What your drawings can do">
          <header className="tvx-plan__head">
            <button type="button" className="tvx-plan__title mono" aria-expanded={planOpen} onClick={() => setPlanOpen((o) => !o)}>
              Your drawings{plan.length ? ` · ${plan.length}` : ''}
            </button>
            <div className="tvx-plan__tools" role="group" aria-label="Draw something that can act">
              {QUICK_TOOLS.map(({ tool, label, title, Icon }) => (
                <button key={tool} type="button" className="tvx-tool mono" title={title} onClick={() => pickTool(tool)} disabled={!ready}>
                  <Icon className="h-3 w-3" />
                  {label}
                </button>
              ))}
            </div>
          </header>
          {planOpen &&
            (plan.length === 0 ? (
              <p className="tvx-plan__empty">
                Draw a level, a zone, a fib or a Long / Short Position and it shows up here as orders you can build in one tap. The <b>+</b> on the price axis drops a level where you point.
                {missing ? ` ${missing}` : ''}
              </p>
            ) : (
              <ul className="tvx-plan__list">
                {plan.map((it) => (
                  <li key={it.shapeId} className={`tvx-card tvx-card--${it.kind}${focusId === it.shapeId ? ' is-focus' : ''}`} data-plan-kind={it.kind}>
                    <div className="tvx-card__head">
                      <button type="button" className="tvx-card__title mono" title="Select this drawing on the chart" onClick={() => selectShape(it.shapeId)}>
                        {it.title}
                        {it.label ? <span className="tvx-card__label">{it.label}</span> : null}
                      </button>
                      <button type="button" className="tvx-card__x" aria-label={`Remove this ${it.title.toLowerCase()} from the chart`} title="Remove from the chart" onClick={() => removeShape(it.shapeId)}>
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                    {it.whole ? <div className="tvx-card__whole">{chip(it.whole, true)}</div> : null}
                    <ul className="tvx-card__rows">
                      {it.rows.map((r) => (
                        <li key={`${r.name}:${r.price}`} className="tvx-row">
                          <span className="tvx-row__name mono">{r.name}</span>
                          <span className="tvx-row__price mono">
                            {priceSign}
                            {fmtPrice(r.price)}
                          </span>
                          <span className="tvx-row__chips">{r.offers.length ? r.offers.slice(0, it.kind === 'level' ? 5 : 2).map((o) => chip(o)) : <span className="tvx-row__none">{r.needsHolding ? `once you hold ${pair.symbol}` : 'no order here'}</span>}</span>
                        </li>
                      ))}
                    </ul>
                    {it.note ? <p className="tvx-card__note">{it.note}</p> : null}
                  </li>
                ))}
              </ul>
            ))}
        </section>
      )}

      {fills && fills.length > 0 && (
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

      {shareOpen && (
        <ChartShare
          symbol={pair.symbol}
          tf={tf}
          view="candles"
          lines={lines}
          onClose={() => setShareOpen(false)}
          capture={async () => {
            try {
              const shot = (await widgetRef.current?.takeClientScreenshot()) ?? null
              // The picture is the chart's own (its drawings and TradingView's
              // mark included); the page it came from is written beside it.
              const ctx = shot?.getContext('2d')
              if (shot && ctx) {
                const size = Math.max(12, Math.round(shot.height * 0.024))
                ctx.font = `${size}px ui-monospace, SFMono-Regular, Menlo, monospace`
                ctx.textAlign = 'right'
                ctx.textBaseline = 'alphabetic'
                ctx.fillStyle = tokensRef.current?.muted ?? '#8a8f98'
                ctx.fillText(watermarkUrl(pair.symbol), shot.width - size, shot.height - Math.round(size * 0.9))
              }
              return shot
            } catch {
              return null
            }
          }}
        />
      )}

      <div className="mkt-chart__foot mono">
        {lookOnly ? (
          <span>feed · index data · delayed up to 15 minutes · closes with its exchange</span>
        ) : (
          <span>
            {feedLabel ? `feed · ${feedLabel}` : ''}
            {feedLabel ? ` · tail · ${tailWords(tailStatus, liveFeed, tf)}` : ''}
          </span>
        )}
        <a className="mkt-attrib" href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer" data-tv-attribution>
          Charts by TradingView
        </a>
      </div>
    </div>
  )
}
