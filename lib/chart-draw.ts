// ─────────────────────────────────────────────────────────────────────────
//  Drawing gestures — the pure half of the chart's drawing layer.
//
//  A drawing is moved in PIXELS and stored in price + time (lib/chart-state),
//  so every gesture is: the line as it was when the press began, plus the
//  pointer's total travel, through the chart's own coordinate functions.
//  Working from the origin (never from the last frame's result) keeps a long
//  drag from drifting as the conversions round.
//
//  Pure + client-safe. The harness pins it (scripts/chart-calls-pins.ts).
// ─────────────────────────────────────────────────────────────────────────

import type { Candle } from './charts'
import type { ChartLine } from './chart-state'

/** The tools the layer arms. 'none' leaves the plot to the engine's own
 *  gestures. zoom and measure place nothing: one focuses the view on a box,
 *  the other reads a box out loud. */
export type DrawTool = 'none' | 'h' | 'zone' | 'trend' | 'note' | 'fib' | 'vline' | 'zoom' | 'measure'

/** One key arms one tool while the pointer is over the chart (no modifier,
 *  not while typing). Letters only: the digits are the frames, +/- the zoom,
 *  the arrows the pan, L the newest bar (lib/chart-legend chartKey). */
export const TOOL_KEYS: Readonly<Record<string, DrawTool>> = {
  h: 'h',
  r: 'zone', // a Rectangle across a price range
  t: 'trend',
  n: 'note',
  f: 'fib',
  v: 'vline',
  z: 'zoom',
  m: 'measure',
}

/** The tool a lone key press arms, or null. Case-insensitive; a modifier is never a tool. */
export function toolForKey(e: { key: string; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean }): DrawTool | null {
  if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.key.length !== 1) return null
  return TOOL_KEYS[e.key.toLowerCase()] ?? null
}

/** The chart's coordinate functions for one render. Null = not representable. */
export interface DrawSpace {
  priceToY: (price: number) => number | null
  yToPrice: (y: number) => number | null
  timeToX: (t: number) => number | null
  xToTime: (x: number) => number | null
  /** Magnet: a pixel → the nearest bar's open/high/low/close when one is close. */
  snap?: (x: number, y: number) => { t: number; price: number } | null
}

/** Which part of a drawing the pointer holds: the whole thing, or one end
 *  ('a' = the first point / p1 edge, 'b' = the second point / p2 edge). */
export type DragPart = 'body' | 'a' | 'b'

/** A press that travels less than this is a click, not a drag. */
export const DRAG_SLOP_PX = 4
/** A press-and-drag shorter than this places the first point only. */
export const DRAW_DRAG_MIN_PX = 6
/** The magnet's reach. */
export const SNAP_PX = 8

function shiftPrice(price: number, dy: number, s: DrawSpace): number | null {
  const y = s.priceToY(price)
  if (y === null) return null
  const next = s.yToPrice(y + dy)
  return next !== null && Number.isFinite(next) && next > 0 ? next : null
}

function shiftTime(t: number, dx: number, s: DrawSpace): number | null {
  const x = s.timeToX(t)
  if (x === null) return null
  const next = s.xToTime(x + dx)
  return next !== null && Number.isFinite(next) && next >= 0 ? Math.round(next) : null
}

/** One end of a trend line or a note, moved and (when a magnet is on) snapped. */
function shiftPoint(t: number, price: number, dx: number, dy: number, s: DrawSpace, snap: boolean): { t: number; price: number } | null {
  const x = s.timeToX(t)
  const y = s.priceToY(price)
  if (x === null || y === null) return null
  if (snap && s.snap) {
    const hit = s.snap(x + dx, y + dy)
    if (hit) return hit
  }
  const nt = s.xToTime(x + dx)
  const np = s.yToPrice(y + dy)
  if (nt === null || np === null || !(np > 0) || !(nt >= 0)) return null
  return { t: Math.round(nt), price: np }
}

/**
 * The line `origin` after the pointer travelled (dx, dy) pixels holding
 * `part`. Null when the result is not a drawing the schema accepts (a price
 * at or under zero, a zone with no height, a trend line that is a point) —
 * the caller keeps the last good line. `magnet` (default on) lets a moved
 * end or note take the nearest open/high/low/close; a level or a vertical
 * line never snaps.
 */
export function dragLine(origin: ChartLine, part: DragPart, dx: number, dy: number, s: DrawSpace, magnet = true): ChartLine | null {
  switch (origin.kind) {
    case 'h': {
      const price = shiftPrice(origin.price, dy, s)
      return price === null ? null : { ...origin, price }
    }
    case 'zone': {
      const p1 = part === 'b' ? origin.p1 : shiftPrice(origin.p1, dy, s)
      const p2 = part === 'a' ? origin.p2 : shiftPrice(origin.p2, dy, s)
      if (p1 === null || p2 === null || p1 === p2) return null
      return { ...origin, p1, p2 }
    }
    case 'trend':
    case 'fib': {
      if (part === 'body') {
        // The whole line travels together: one time shift for both ends, so
        // its length in bars never changes under the hand.
        const t1 = shiftTime(origin.t1, dx, s)
        const p1 = shiftPrice(origin.p1, dy, s)
        const p2 = shiftPrice(origin.p2, dy, s)
        if (t1 === null || p1 === null || p2 === null) return null
        if (origin.kind === 'fib' && p1 === p2) return null
        return { ...origin, t1, p1, t2: origin.t2 + (t1 - origin.t1), p2 }
      }
      const a = part === 'a' ? shiftPoint(origin.t1, origin.p1, dx, dy, s, magnet) : { t: origin.t1, price: origin.p1 }
      const b = part === 'b' ? shiftPoint(origin.t2, origin.p2, dx, dy, s, magnet) : { t: origin.t2, price: origin.p2 }
      if (!a || !b || (a.t === b.t && a.price === b.price)) return null
      if (origin.kind === 'fib' && a.price === b.price) return null
      return { ...origin, t1: a.t, p1: a.price, t2: b.t, p2: b.price }
    }
    case 'note': {
      const p = shiftPoint(origin.t, origin.price, dx, dy, s, magnet)
      return p ? { ...origin, t: p.t, price: p.price } : null
    }
    case 'vline': {
      const t = shiftTime(origin.t, dx, s)
      return t === null ? null : { ...origin, t }
    }
  }
}

// ── fibonacci ───────────────────────────────────────────────────────────────

/** The retracement ratios, swing start (0) to swing end (1), plus the two
 *  extensions traders actually trade (1.272, 1.618). */
export const FIB_RATIOS: readonly number[] = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.272, 1.618]

export interface FibLevel {
  ratio: number
  price: number
  /** "0.618" — the ratio as it reads on the chart. */
  label: string
}

/** The levels of a swing from p1 to p2: ratio 0 sits at p1, ratio 1 at p2,
 *  and the retracement runs BACK from the swing's end (a 0.618 of an up-swing
 *  is 61.8% of the way back down). Prices at or under zero are dropped (an
 *  extension past a small base can cross it). */
export function fibLevels(p1: number, p2: number, ratios: readonly number[] = FIB_RATIOS): FibLevel[] {
  if (!(p1 > 0) || !(p2 > 0) || p1 === p2) return []
  const out: FibLevel[] = []
  for (const ratio of ratios) {
    // ratio 0 = the swing's END (the retracement's origin), 1 = its start.
    const price = p2 - (p2 - p1) * ratio
    if (price > 0) out.push({ ratio, price, label: ratio === 0 || ratio === 1 ? String(ratio) : ratio.toFixed(3) })
  }
  return out
}

// ── measure ─────────────────────────────────────────────────────────────────

/** "3d 4h" / "45m" / "2w 1d" — a span of seconds in the words a trader says. */
export function spanWords(sec: number): string {
  const s = Math.abs(Math.round(sec))
  if (s < 60) return `${s}s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(s / 3600)
  if (h < 24) {
    const mm = Math.round((s - h * 3600) / 60)
    return mm > 0 ? `${h}h ${mm}m` : `${h}h`
  }
  const d = Math.floor(s / 86400)
  if (d < 14) {
    const hh = Math.round((s - d * 86400) / 3600)
    return hh > 0 ? `${d}d ${hh}h` : `${d}d`
  }
  const w = Math.floor(d / 7)
  const dd = d - w * 7
  return dd > 0 ? `${w}w ${dd}d` : `${w}w`
}

export interface MeasureRead {
  /** The move, signed, as a share of the first price. */
  pct: number
  /** The move in quote currency, signed. */
  delta: number
  bars: number
  /** Seconds between the two points (bars × the frame). */
  sec: number
  /** "+4.21% · +$108.00 · 12 bars · 3d" */
  words: string
}

/** What a measured box says: first point to second, in percent, dollars,
 *  bars and time. `fmt` prints a price the way the axis does. */
export function measureReadout(p1: number, p2: number, t1: number, t2: number, barSec: number, fmt: (p: number) => string): MeasureRead | null {
  if (!(p1 > 0) || !(p2 > 0)) return null
  const delta = p2 - p1
  const pct = (delta / p1) * 100
  const bars = barSec > 0 ? Math.round(Math.abs(t2 - t1) / barSec) : 0
  const sec = bars * barSec
  const sign = delta >= 0 ? '+' : '−'
  const parts = [`${sign}${Math.abs(pct).toFixed(2)}%`, `${sign}$${fmt(Math.abs(delta))}`]
  if (bars > 0) parts.push(`${bars} bar${bars === 1 ? '' : 's'}`, spanWords(sec))
  return { pct, delta, bars, sec, words: parts.join(' · ') }
}

/** The bar's open/high/low/close nearest to `y`, when one is within reach. */
export function nearestOhlc(bar: Candle, y: number, priceToY: (p: number) => number | null, reach = SNAP_PX): number | null {
  let best: number | null = null
  let bestD = reach
  for (const p of [bar.h, bar.l, bar.o, bar.c]) {
    const py = priceToY(p)
    if (py === null) continue
    const d = Math.abs(py - y)
    if (d <= bestD) {
      bestD = d
      best = p
    }
  }
  return best
}

/** "+4.21% · 12 bars" — what a trend line measures, first point to second. */
export function trendReadout(p1: number, p2: number, t1: number, t2: number, barSec: number): string {
  if (!(p1 > 0) || !(p2 > 0)) return ''
  const pct = ((p2 - p1) / p1) * 100
  const bars = barSec > 0 ? Math.round(Math.abs(t2 - t1) / barSec) : 0
  const sign = pct >= 0 ? '+' : '−'
  return `${sign}${Math.abs(pct).toFixed(2)}%${bars > 0 ? ` · ${bars} bar${bars === 1 ? '' : 's'}` : ''}`
}

/** "3.10% wide" — a zone's height as a share of its lower edge. */
export function zoneReadout(p1: number, p2: number): string {
  const lo = Math.min(p1, p2)
  const hi = Math.max(p1, p2)
  return lo > 0 ? `${(((hi - lo) / lo) * 100).toFixed(2)}% wide` : ''
}

// ── undo ────────────────────────────────────────────────────────────────────

export const UNDO_MAX = 60

export interface UndoStacks {
  past: ChartLine[][]
  future: ChartLine[][]
}

export const emptyUndo = (): UndoStacks => ({ past: [], future: [] })

/** Record `current` as the state to come back to; a new edit ends any redo. */
export function recordUndo(u: UndoStacks, current: ChartLine[]): UndoStacks {
  return { past: [...u.past, current].slice(-UNDO_MAX), future: [] }
}

export function undo(u: UndoStacks, current: ChartLine[]): { stacks: UndoStacks; lines: ChartLine[] } | null {
  if (u.past.length === 0) return null
  const lines = u.past[u.past.length - 1]
  return { stacks: { past: u.past.slice(0, -1), future: [...u.future, current] }, lines }
}

export function redo(u: UndoStacks, current: ChartLine[]): { stacks: UndoStacks; lines: ChartLine[] } | null {
  if (u.future.length === 0) return null
  const lines = u.future[u.future.length - 1]
  return { stacks: { past: [...u.past, current], future: u.future.slice(0, -1) }, lines }
}
