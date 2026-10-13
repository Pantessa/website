// ─────────────────────────────────────────────────────────────────────────
//  Chart viewport — the rules that keep the candles filling the plot when a
//  trader zooms out. Pure + client-safe: MarketChart applies them to the
//  engine's visible logical range (bar indices: 0 is the first bar the chart
//  holds, bars − 1 the latest), and the harness pins them, because a canvas
//  is the one thing the API harness can't look at.
//
//  The chart used to hold its 180-bar window and nothing else, and the
//  engine zoomed around the cursor: a zoom-out left the candles in a strip
//  mid-plot with empty time on both sides (Nate, /t/DOGE, 2026-09-14).
//  Now the engine holds the right edge on a zoom (rightBarStaysOnScroll),
//  and two rules cover the left:
//
//   · wantsOlderBars — while less than a screen of held bars sits left of
//     the view, the chart asks the candle route for an older page
//     (?before=). A zoom-out reads as more range.
//   · clampToFirstBar — the plot never shows time before the first held
//     bar. A zoom-out, a pan, or a wider plot that would open empty space on
//     the left pins the left edge to the first bar. The view keeps its width
//     in bars when it can, and fits every held bar (plus the right margin)
//     when it is wider than all of them — so once the feed has nothing older,
//     the zoom-out stops with the candles spanning the plot.
//
//  Two more rules (2026-10-13, Nate on /t/ETH?tf=1s: "I can't seem to zoom
//  out"):
//
//   · printOpeningView — a PRINT frame (1s: bars built from the relay's
//     prints) opens at PRINT_BAR_SPACING per bar with the newest bar at the
//     right, whatever it holds. It used to open on fitContent(): a fit of
//     the FIRST print — one bar across the whole plot — and the engine keeps
//     that spacing as bars arrive, so two bars filled 1,900 px and a readable
//     chart sat fifty wheel notches away. The clamp never runs on a print
//     frame either: there is nothing older to page, and a zoom-out past the
//     first print shows the time before it empty, which is the truth.
//   · fitMarginBars — the right margin a FIT carries for the Wall's pixels,
//     solved at the fitted spacing. The margin is a bar count in the engine;
//     counted at a zoomed-out spacing it was hundreds of bars, the fit
//     included them, and the candles landed in a 58 px sliver at the left of
//     an empty plot — and stayed there, because the engine drops an offset
//     written in the same frame as a range write and the margin sync trusted
//     its own memory (engineRightOffset is what it reads now).
// ─────────────────────────────────────────────────────────────────────────

import { marginBarsFor } from '@/lib/wall'

export interface LogicalView {
  from: number
  to: number
}

/** A fitted view's first index comes back from the engine as ±1e-9, not 0. */
const EDGE_SLACK = 0.01

/** The preload floor in bars: a view zoomed in tight still keeps this many
 *  held bars ahead of its left edge, so a pan doesn't meet the edge first. */
export const PRELOAD_MIN_BARS = 120

/**
 * The view to set when `view` opens empty time before the first held bar,
 * or null when it doesn't. `rightOffset` is the engine's right margin in bars.
 */
export function clampToFirstBar(view: LogicalView, bars: number, rightOffset: number): LogicalView | null {
  if (bars <= 0 || view.from >= -EDGE_SLACK) return null
  const fit = bars - 1 + rightOffset
  return { from: 0, to: Math.min(view.to - view.from, fit) }
}

/** Should the chart ask for an older page? Yes while fewer held bars sit left
 *  of the view than the view is wide (or than the preload floor). */
export function wantsOlderBars(view: LogicalView, bars: number): boolean {
  if (bars <= 0) return false
  return view.from < Math.max(view.to - view.from, PRELOAD_MIN_BARS)
}

/** A print frame's opening density: the engine's own default (what Reset
 *  restores) — a second bar every 6 px, so a 900 px plot holds 2½ minutes of
 *  prints and a 1,500 px plot four. */
export const PRINT_BAR_SPACING = 6

/**
 * The view a print frame opens on: the newest bar at the right edge (plus
 * the margin) at `barSpacing` per bar, however few bars the ring holds. The
 * engine turns a logical range into a spacing of width / (to − from + 1), so
 * `from` goes negative on a cold ring on purpose — the time before the relay
 * held prints is empty, not missing, and the plot fills as the ring does.
 */
export function printOpeningView(bars: number, rightOffset: number, width: number, barSpacing = PRINT_BAR_SPACING): LogicalView | null {
  if (bars <= 0 || !(width > 0) || !(barSpacing > 0)) return null
  const to = bars - 1 + rightOffset
  return { from: to - width / barSpacing + 1, to }
}

/**
 * The right margin, in bars, that a fit of every held bar carries for
 * `marginPx` of room (the Wall) beside the engine's own `rightOffset` bars —
 * a fixed point of lib/wall marginBarsFor at the FITTED spacing,
 * width / (bars + margin), never the count the zoomed-out spacing gave.
 */
export function fitMarginBars(bars: number, rightOffset: number, marginPx: number, width: number): number {
  if (bars <= 0 || !(width > 0) || !(marginPx > 0)) return rightOffset
  // Start from the spacing that leaves the pixels beside the bars, then settle.
  let margin = marginBarsFor(marginPx, Math.max(width - marginPx, width * 0.25) / (bars + rightOffset), rightOffset)
  for (let i = 0; i < 4; i++) {
    const next = marginBarsFor(marginPx, width / (bars + margin), rightOffset)
    if (next === margin) break
    margin = next
  }
  return margin
}

/** The right offset the engine holds, in bars, read off its visible logical
 *  range: the range's `to` is the newest bar's index plus the offset. */
export function engineRightOffset(view: LogicalView, bars: number): number | null {
  if (bars <= 0) return null
  return view.to - (bars - 1)
}
