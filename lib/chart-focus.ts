// ─────────────────────────────────────────────────────────────────────────
//  Chart focus — the rules that let a trader aim the chart at one section
//  of the plot in BOTH directions. Pure + client-safe; the harness pins it
//  (scripts/chart-calls-pins.ts), because a canvas is the one thing the API
//  harness cannot look at.
//
//  The engine (lightweight-charts) auto-scales the price axis to whatever
//  bars are on screen, so the only way to look closely at one price range
//  used to be dragging the axis, which scales about its middle and never
//  pans. Nate, /t/ETH 2026-10-08: "I would like to focus on one section
//  vertically but I can only scale the height and not the width." Now:
//
//   · boxFocus     — a dragged box becomes a view: its bars become the
//                    visible logical range and its prices the price range
//                    (the engine's manual mode, priceScale.setVisibleRange).
//   · padRange     — a focused price range breathes: a little air above and
//                    below so the candles at its edges are not cut in half.
//   · lineFocus    — "Focus" on a drawing: a zone's two prices, a trend or
//                    fib's swing, with the same air.
//   · wheelScale   — the price range after a wheel tick over the price axis
//                    (TradingView's gesture): scaled about the price under
//                    the pointer, in while the wheel rolls up, out while it
//                    rolls down, never past MIN_SPAN_PCT.
// ─────────────────────────────────────────────────────────────────────────

import type { ChartLine } from './chart-state'

export interface PriceRange {
  from: number
  to: number
}

export interface FocusView {
  /** Bar indices (the engine's logical space), left to right. */
  logical: { from: number; to: number }
  price: PriceRange
}

/** A box narrower or shorter than this is a click, not a focus. */
export const FOCUS_MIN_PX = 8
/** A focused view never holds fewer bars than this. */
export const FOCUS_MIN_BARS = 3
/** The air above and below a focused price range, as a share of its height. */
export const FOCUS_PAD = 0.06
/** A price range never collapses tighter than this share of its middle. */
export const MIN_SPAN_PCT = 0.0005
/** One wheel tick scales the price range by this factor. */
export const WHEEL_STEP = 1.12

/** `from`..`to` with `pad` of its height added on each side. Order-safe. */
export function padRange(a: number, b: number, pad = FOCUS_PAD): PriceRange | null {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  const lo = Math.min(a, b)
  const hi = Math.max(a, b)
  const mid = (lo + hi) / 2
  if (!(mid > 0)) return null
  // A flat box (two equal prices) still opens on something: MIN_SPAN_PCT of its price.
  const span = Math.max(hi - lo, mid * MIN_SPAN_PCT)
  const air = span * pad
  return { from: Math.max(mid * MIN_SPAN_PCT, lo - air), to: hi + air }
}

/**
 * The view a dragged box asks for. `a` and `b` are the box's corners in
 * pixels; `xToLogical` / `yToPrice` are the chart's own conversions. Null
 * when the box is a click (under FOCUS_MIN_PX either way) or lands off the
 * price scale.
 */
export function boxFocus(a: { x: number; y: number }, b: { x: number; y: number }, xToLogical: (x: number) => number | null, yToPrice: (y: number) => number | null): FocusView | null {
  if (Math.abs(a.x - b.x) < FOCUS_MIN_PX || Math.abs(a.y - b.y) < FOCUS_MIN_PX) return null
  const l1 = xToLogical(Math.min(a.x, b.x))
  const l2 = xToLogical(Math.max(a.x, b.x))
  const p1 = yToPrice(Math.min(a.y, b.y))
  const p2 = yToPrice(Math.max(a.y, b.y))
  if (l1 === null || l2 === null || p1 === null || p2 === null) return null
  const price = padRange(p1, p2)
  if (!price) return null
  let from = Math.min(l1, l2)
  let to = Math.max(l1, l2)
  if (to - from < FOCUS_MIN_BARS) {
    const mid = (from + to) / 2
    from = mid - FOCUS_MIN_BARS / 2
    to = mid + FOCUS_MIN_BARS / 2
  }
  return { logical: { from, to }, price }
}

/** The price range a drawing asks the chart to look at: a zone's edges, a
 *  swing's two prices. A level and a note sit at one price, so they open a
 *  window of ±FOCUS_WINDOW_PCT around it; a vertical line has no prices. */
export const FOCUS_WINDOW_PCT = 0.03
export function lineFocus(line: ChartLine): PriceRange | null {
  switch (line.kind) {
    case 'zone':
    case 'trend':
    case 'fib':
      return padRange(line.p1, line.p2)
    case 'h':
    case 'note':
      return padRange(line.price * (1 - FOCUS_WINDOW_PCT), line.price * (1 + FOCUS_WINDOW_PCT), 0)
    case 'vline':
      return null
  }
}

/** A wheel tick over the price axis: the range scaled about `at` (the price
 *  under the pointer), tighter on a roll up (deltaY < 0), wider on a roll
 *  down. `at` outside the range scales about its middle. */
export function wheelScale(range: PriceRange, at: number | null, deltaY: number, step = WHEEL_STEP): PriceRange | null {
  if (!Number.isFinite(range.from) || !Number.isFinite(range.to) || !(range.to > range.from) || deltaY === 0) return null
  const factor = deltaY < 0 ? 1 / step : step
  const pivot = at !== null && at > range.from && at < range.to ? at : (range.from + range.to) / 2
  const span = range.to - range.from
  const nextSpan = Math.max(span * factor, Math.abs(pivot) * MIN_SPAN_PCT)
  const share = (pivot - range.from) / span
  const from = pivot - nextSpan * share
  const to = from + nextSpan
  if (!(to > 0)) return null
  return { from, to }
}
