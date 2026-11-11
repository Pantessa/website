'use client'

// The ONE mount point for the symbol page's chart. SHELL owns the frame
// around it; the CHART lane's engine (MarketChart — lightweight-charts,
// drawings that become orders, overlays, news-on-bars, the 4663 pool price)
// lives behind this prop surface. Integration (QA, 2026-09-11) wired the
// engine in here: the drawings persist per symbol in localStorage (a
// viewer's own levels — never shared; posts carry their own ChartState),
// and a level's action chip SENDS through the frame's `onAsk` door (the
// chip-send contract — the signature is the gate). With no `onAsk` the
// chips fall back to prefill links, so a read-only mount never fires a turn.

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { ChartStats } from '@/components/CandleChart'
import MarketChart, { type ChartMarker } from '@/components/markets/chart/MarketChart'
import AdvancedChart from '@/components/markets/chart/AdvancedChart'
import { DEFAULT_CHART_TF, type ChartTf } from '@/lib/charts'
import { syncViewParam, type ChartView } from '@/lib/markets'
import { ENGINE_PREF_KEY, advancedChartsBuilt, engineFor, parseEnginePref, type EnginePref } from '@/lib/tv/config'
import { parseChartState, serializeChartState, type ChartState } from '@/lib/chart-state'
import { DEFAULT_SYMBOL_OVERLAYS } from '@/lib/chart-indicators'
import { useChartMarkers } from '@/lib/chart-markers'
import type { FillMarker } from '@/lib/chart-fills'
import { useClassicCalledMarkers } from '@/lib/called-it/use-record'

export type { ChartStats, ChartMarker }

// THE ADVANCED CHART (2026-11-11): TradingView's Advanced Charts, on the
// symbol page, when the build ships the library (lib/tv/config — the files
// are licensed and never in this repository). The component here is only
// Pantessa's own shell and datafeed; the library itself is a script the
// shell loads on demand. The built-in chart stays the fallback (the library
// failed to load), the home of the views only it draws (Depth, Tape,
// Heatmap, the Wall) and a choice the visitor can make ("Classic chart").
const ADVANCED_BUILT = advancedChartsBuilt()
/** The library failed in this tab: every later chart opens on the built-in engine. */
let advancedFailed = false

function readEnginePref(): EnginePref | null {
  try {
    return parseEnginePref(window.localStorage.getItem(ENGINE_PREF_KEY))
  } catch {
    return null
  }
}
function writeEnginePref(pref: EnginePref) {
  try {
    window.localStorage.setItem(ENGINE_PREF_KEY, pref)
  } catch {
    /* the choice lasts for this page */
  }
}

const promptHref = (prompt: string) => `/chat?prompt=${encodeURIComponent(prompt)}`

// localStorage can be absent or throw (private mode, thumbnail capture) —
// every touch is try/catch and the chart renders fine with nothing stored.
const drawKey = (symbol: string) => `yf-chart-state:${symbol}`
function readDrawings(symbol: string): ChartState | null {
  try {
    const raw = window.localStorage.getItem(drawKey(symbol))
    return raw ? parseChartState(raw) : null
  } catch {
    return null
  }
}
function writeDrawings(s: ChartState) {
  try {
    if (s.lines.length === 0) window.localStorage.removeItem(drawKey(s.symbol))
    else window.localStorage.setItem(drawKey(s.symbol), serializeChartState(s))
  } catch {
    /* nothing to keep */
  }
}

export interface ChartMountProps {
  symbol: string
  /** Fixed pixel height, or 'fill' to take the flex parent's remaining space. */
  height?: number | 'fill'
  defaultTf?: ChartTf
  /** Mirror the frame into `?tf=` (the symbol page only). */
  urlTf?: boolean
  /** Fires whenever fresh candles land — the header reads last/chg off it. */
  onStats?: (s: ChartStats) => void
  /** Extra control beside the live badge (the frame's expand toggle). */
  controlsRight?: ReactNode
  /** Bump to force a re-measure (expand/collapse). */
  resizeKey?: string | number | boolean
  /** The send door: a drawn level's chip sends its ask here (chip-send). */
  onAsk?: (ask: string) => void
  /** News-on-bars markers (COMM feeds these from /api/news). */
  markers?: ChartMarker[]
  /** Initial drawings from outside (a post's ChartState); overrides the stored ones. */
  state?: ChartState | null
  /** Mirror of the live drawings (the composer's "attach my current chart"). */
  onStateChange?: (s: ChartState) => void
  /** The visible window (bar open times + frame) — AI's "what's on screen". */
  onViewport?: (v: { from: number; to: number; tf: ChartTf }) => void
  /** A second symbol as a % line on the left scale (the page's ?vs=). */
  compare?: string | null
  /** The connected wallet's own fills on this symbol (lib/chart-fills useSymbolFills). */
  fills?: FillMarker[]
  /** Drawn over the plot above the time axis (MarketChart `overlay`). */
  overlay?: ReactNode
  /** Offer the Battlefield view beside the candles (MarketChart `battlefield`). */
  battlefield?: boolean
  /** The Depth chart's act (MarketChart `onLimit`). */
  onLimit?: (side: 'buy' | 'sell', price: number) => void
  /** Offer the Advanced chart here (the symbol page). Every other mount is
   *  the built-in engine: a small embedded chart has no room for its toolbars. */
  advanced?: boolean
}

export default function ChartMount({
  symbol,
  height = 'fill',
  defaultTf,
  urlTf,
  onStats,
  controlsRight,
  resizeKey,
  onAsk,
  markers,
  state: stateProp,
  onStateChange,
  onViewport,
  compare,
  fills,
  overlay,
  battlefield,
  onLimit,
  advanced = false,
}: ChartMountProps) {
  const [drawings, setDrawings] = useState<ChartState | null>(null)
  // Which engine draws: decided after mount (the choice, the URL and the
  // view all live in the browser). A build without the library is 'classic'
  // from the first render, exactly as before.
  const offered = advanced && ADVANCED_BUILT
  // The server renders the Advanced chart's shell where the build has it
  // (the view switch, the plan, the foot): most visitors stay on it. The
  // library itself is not asked for until the choice is settled (`armed`),
  // so a visitor headed for the built-in chart never downloads it.
  const [engine, setEngine] = useState<EnginePref>(offered ? 'advanced' : 'classic')
  const [armed, setArmed] = useState(false)
  const [liveTf, setLiveTf] = useState<ChartTf | undefined>(undefined)
  useEffect(() => {
    if (!offered) return
    setEngine(engineFor({ built: true, pref: readEnginePref(), search: window.location.search, failed: advancedFailed }))
    setArmed(true)
  }, [offered, symbol])
  const chooseEngine = useCallback((next: EnginePref) => {
    writeEnginePref(next)
    setEngine(next)
  }, [])
  const onAdvancedFail = useCallback(() => {
    advancedFailed = true
    setEngine('classic')
  }, [])
  // A view only the built-in chart draws: its `?view=` address is written
  // first, so the built-in chart opens straight onto it.
  const onAdvancedView = useCallback((view: ChartView) => {
    syncViewParam(view, null)
    setEngine('classic')
  }, [])
  // …and back: "Candles" on the built-in switch returns to the Advanced chart.
  const onClassicView = useCallback(
    (view: ChartView) => {
      if (view !== 'candles' || !offered || advancedFailed || readEnginePref() === 'classic') return
      syncViewParam('candles', null)
      setEngine('advanced')
    },
    [offered],
  )
  // News-on-bars: the News tab toggles markers into COMM's session store;
  // the engine draws whatever is there plus anything passed in by prop.
  const newsMarkers = useChartMarkers(symbol)
  const allMarkers = markers && markers.length ? [...newsMarkers, ...markers] : newsMarkers
  // CALLED IT on the built-in chart: a plotted handle's calls as dots on their bars (the
  // Advanced chart draws its own cards and marks; the strip under the chart carries the words).
  const calledMarkers = useClassicCalledMarkers(symbol)
  const classicMarkers = calledMarkers.length ? [...allMarkers, ...calledMarkers] : allMarkers
  // The engine mounts (and server-renders) with no drawings; the persisted
  // ones arrive after hydration. Child effects fire before this one, so the
  // engine's first empty emit must NOT erase the stored state — writes are
  // ignored until the read has happened.
  const restoredRef = useRef(false)
  useEffect(() => {
    restoredRef.current = false
    // A post's lines load on the frame they were drawn on. Your own saved
    // lines load onto the frame the chart opens on (the day, 2026-09-16),
    // so a chart never reopens on 1H just because it once had a line on it.
    const stored = stateProp ? null : readDrawings(symbol)
    setDrawings(stateProp ?? (stored ? { ...stored, tf: defaultTf ?? DEFAULT_CHART_TF } : null))
    restoredRef.current = true
  }, [symbol, stateProp, defaultTf])
  const handleStateChange = useCallback(
    (s: ChartState) => {
      if (!restoredRef.current) return
      writeDrawings(s)
      onStateChange?.(s)
    },
    [onStateChange],
  )

  const engineSwitch =
    offered && armed && !advancedFailed ? (
      <button
        type="button"
        className="tvx-engine mono"
        data-engine-switch={engine}
        title={engine === 'advanced' ? 'Back to the built-in chart (the Wall, the session shading)' : 'The TradingView chart: every drawing tool and indicator'}
        onClick={() => chooseEngine(engine === 'advanced' ? 'classic' : 'advanced')}
      >
        {engine === 'advanced' ? 'Classic chart' : 'Pro chart'}
      </button>
    ) : null

  if (engine === 'advanced') {
    return (
      <AdvancedChart
        key={symbol}
        armed={armed}
        symbol={symbol}
        height={height}
        defaultTf={liveTf ?? defaultTf}
        urlTf={urlTf}
        onStats={onStats}
        controlsRight={
          <>
            {engineSwitch}
            {controlsRight}
          </>
        }
        resizeKey={resizeKey}
        state={stateProp ?? null}
        legacy={stateProp ? null : drawings}
        onStateChange={onStateChange}
        markers={allMarkers}
        onAsk={onAsk}
        askHref={promptHref}
        onViewport={onViewport}
        compare={compare}
        fills={fills}
        battlefield={battlefield}
        onView={onAdvancedView}
        onFail={onAdvancedFail}
        onTf={setLiveTf}
      />
    )
  }

  return (
    <MarketChart
      symbol={symbol}
      height={height}
      defaultTf={liveTf ?? defaultTf}
      urlTf={urlTf}
      onStats={onStats}
      controlsRight={
        engineSwitch ? (
          <>
            {engineSwitch}
            {controlsRight}
          </>
        ) : (
          controlsRight
        )
      }
      onView={offered ? onClassicView : undefined}
      resizeKey={resizeKey}
      state={drawings}
      onStateChange={handleStateChange}
      markers={classicMarkers}
      onAsk={onAsk}
      askHref={promptHref}
      defaultOverlays={DEFAULT_SYMBOL_OVERLAYS}
      onViewport={onViewport}
      compare={compare}
      fills={fills}
      overlay={overlay}
      battlefield={battlefield}
      onLimit={onLimit}
    />
  )
}
