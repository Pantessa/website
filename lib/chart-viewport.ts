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
// ─────────────────────────────────────────────────────────────────────────

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
