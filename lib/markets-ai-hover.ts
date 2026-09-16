'use client'

// MK2/AI — the hovered bar, shared between the chart and the ask box. The
// chart (VIZ's MarketChart) reports the bar under the crosshair with
// `setHoverBar`; AskChart shows "Explain this bar" for it and asks
// `POST /api/markets/ask { kind: 'explain', bar }` (one sentence, cached per
// bar server-side). Nobody else reads it. Until the chart reports, the box
// offers the window's LAST bar instead — never a stale one.

import { create } from 'zustand'

export interface HoverBar {
  t: number
  o: number
  h: number
  l: number
  c: number
  v: number
}

interface ChartHoverState {
  bar: HoverBar | null
  /** The chart's symbol the bar belongs to (a bar from another page never
   *  reaches this page's box). */
  symbol: string | null
  setHoverBar: (symbol: string, bar: HoverBar | null) => void
}

export const useChartHover = create<ChartHoverState>()((set) => ({
  bar: null,
  symbol: null,
  setHoverBar: (symbol, bar) => set({ symbol, bar }),
}))

/** Coarse label for the chip: "Explain 14:00 bar" / "Explain Sep 14 bar". */
export function hoverBarLabel(bar: HoverBar, tf: string | undefined): string {
  const d = new Date(bar.t * 1000)
  const intraday = tf === '15m' || tf === '1h' || tf === '4h'
  const when = intraday ? d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' }) + ' UTC' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
  return `Explain the ${when} bar`
}
