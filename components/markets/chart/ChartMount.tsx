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
import type { ChartTf } from '@/lib/charts'
import { parseChartState, serializeChartState, type ChartState } from '@/lib/chart-state'
import { useChartMarkers } from '@/lib/chart-markers'

export type { ChartStats, ChartMarker }

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
}

export default function ChartMount({
  symbol,
  height = 'fill',
  defaultTf,
  onStats,
  controlsRight,
  resizeKey,
  onAsk,
  markers,
  state: stateProp,
  onStateChange,
}: ChartMountProps) {
  const [drawings, setDrawings] = useState<ChartState | null>(null)
  // News-on-bars: the News tab toggles markers into COMM's session store;
  // the engine draws whatever is there plus anything passed in by prop.
  const newsMarkers = useChartMarkers(symbol)
  const allMarkers = markers && markers.length ? [...newsMarkers, ...markers] : newsMarkers
  // The engine mounts (and server-renders) with no drawings; the persisted
  // ones arrive after hydration. Child effects fire before this one, so the
  // engine's first empty emit must NOT erase the stored state — writes are
  // ignored until the read has happened.
  const restoredRef = useRef(false)
  useEffect(() => {
    restoredRef.current = false
    setDrawings(stateProp ?? readDrawings(symbol))
    restoredRef.current = true
  }, [symbol, stateProp])
  const handleStateChange = useCallback(
    (s: ChartState) => {
      if (!restoredRef.current) return
      writeDrawings(s)
      onStateChange?.(s)
    },
    [onStateChange],
  )

  return (
    <MarketChart
      symbol={symbol}
      height={height}
      defaultTf={defaultTf}
      onStats={onStats}
      controlsRight={controlsRight}
      resizeKey={resizeKey}
      state={drawings}
      onStateChange={handleStateChange}
      markers={allMarkers}
      onAsk={onAsk}
      askHref={promptHref}
    />
  )
}
