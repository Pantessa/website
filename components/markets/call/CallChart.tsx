'use client'

// The call's chart: the live tape with the author's lines replayed read-only
// (nobody redraws someone else's call), their verified fills as receipt
// glyphs on the bars, and a marker on the bar the call was stamped on. It
// mounts the engine directly, never ChartMount: ChartMount keeps a viewer's
// own drawings per symbol, and opening a call must not overwrite them.

import { useMemo } from 'react'
import MarketChart from '@/components/markets/chart/MarketChart'
import type { ChartState } from '@/lib/chart-state'
import type { FillMarker } from '@/lib/chart-fills'
import { DEFAULT_SYMBOL_OVERLAYS } from '@/lib/chart-indicators'

const promptHref = (prompt: string) => `/chat?prompt=${encodeURIComponent(prompt)}`

export default function CallChart({ symbol, state, fills, callT, callLabel }: { symbol: string; state: ChartState | null; fills: FillMarker[]; callT: number; callLabel: string }) {
  const markers = useMemo(() => [{ t: callT, label: callLabel }], [callT, callLabel])
  return (
    // Not `.tchart`: that class is the full-viewport chart shell (height: 100dvh − nav),
    // and on this page it left a screen of empty space under a 420px chart.
    <div className="callpg__chart">
      <MarketChart symbol={symbol} height={420} state={state} defaultTf={state?.tf} tools={false} fills={fills} markers={markers} askHref={promptHref} defaultOverlays={DEFAULT_SYMBOL_OVERLAYS} />
    </div>
  )
}
