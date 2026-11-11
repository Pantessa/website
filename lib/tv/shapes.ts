// Drawings, both ways. Pure, pinned (scripts/tv-pins).
//
// The library owns the drawing tools on the Advanced chart (a hundred of
// them, with their own undo, magnets, templates and settings). Pantessa
// still speaks its own small drawings schema (lib/chart-state ChartLine)
// everywhere a drawing leaves the chart: a published call, a community post,
// the share card, Ask the chart, a "fork this chart" replay. This file is
// the bridge:
//
//   shapeFromLine   a stored ChartLine  → the shape to create on the chart
//   lineFromShape   a shape on the chart → a ChartLine, or null when the
//                   schema has no word for it (a pitchfork, a brush stroke)
//
// A shape the schema cannot say is not lost: the chart keeps its own copy
// (lib/tv/store) and the share image is the chart's own screenshot. It just
// does not travel as data.

import { CHART_LABEL_MAX, CHART_NOTE_MAX, type ChartLine } from '@/lib/chart-state'
import type { TvPoint, TvShapeOptions } from './types'

/** What the chart tells us about one drawing. Times are unix seconds. */
export interface ShapeSnapshot {
  id: string
  /** The library's tool id: `horizontal_line`, `fib_retracement`, … */
  name: string
  points: { time?: number; price: number }[]
  props: Record<string, unknown>
}

/** The shape to draw for a stored line. */
export interface ShapeSpec {
  points: TvPoint[]
  options: TvShapeOptions
}

const CONTROL_RE = /[\x00-\x1f\x7f]/g

/** A label the schema accepts, or undefined: trimmed, single-line, capped. */
export function cleanLabel(raw: unknown, max = CHART_LABEL_MAX): string | undefined {
  if (typeof raw !== 'string') return undefined
  const s = raw.replace(CONTROL_RE, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
  return s.length ? s : undefined
}

/** A ChartLine id for a chart entity: the schema's id alphabet, prefixed. */
export function lineIdFor(entityId: string): string {
  const safe = entityId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 56)
  return `tv_${safe || 'x'}`
}

const price = (n: unknown): number | null => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? Number(n.toPrecision(12)) : null)
const sec = (n: unknown): number | null => (typeof n === 'number' && Number.isFinite(n) && n >= 0 && n < 4_102_444_800 ? Math.round(n) : null)

/** A stored line → the shape that draws it. `now` anchors shapes whose
 *  schema form has no time (a level, a zone). */
export function shapeFromLine(line: ChartLine, nowSec: number, barSec: number): ShapeSpec {
  switch (line.kind) {
    case 'h':
      return { points: [{ time: nowSec, price: line.price }], options: { shape: 'horizontal_line', ...(line.label ? { text: line.label, overrides: { showLabel: true } } : {}) } }
    case 'zone':
      // The schema's zone is a price band across the whole chart: a rectangle
      // anchored a hundred bars back and stretched both ways.
      return {
        points: [
          { time: nowSec - 100 * barSec, price: Math.max(line.p1, line.p2) },
          { time: nowSec, price: Math.min(line.p1, line.p2) },
        ],
        options: { shape: 'rectangle', ...(line.label ? { text: line.label } : {}), overrides: { extendLeft: true, extendRight: true, ...(line.label ? { showLabel: true } : {}) } },
      }
    case 'trend':
      return {
        points: [
          { time: line.t1, price: line.p1 },
          { time: line.t2, price: line.p2 },
        ],
        options: { shape: line.extend === 'both' ? 'extended' : line.extend === 'right' ? 'ray' : 'trend_line', ...(line.label ? { text: line.label, overrides: { showLabel: true } } : {}) },
      }
    case 'fib':
      return {
        points: [
          { time: line.t1, price: line.p1 },
          { time: line.t2, price: line.p2 },
        ],
        options: { shape: 'fib_retracement' },
      }
    case 'vline':
      return { points: [{ time: line.t }], options: { shape: 'vertical_line', ...(line.label ? { text: line.label, overrides: { showLabel: true } } : {}) } }
    case 'note':
      return { points: [{ time: line.t, price: line.price }], options: { shape: 'note', text: line.text } }
  }
}

const H_TOOLS = new Set(['horizontal_line', 'horizontal_ray'])
const TREND_TOOLS = new Set(['trend_line', 'ray', 'extended', 'arrow', 'info_line', 'trend_angle'])
const ZONE_TOOLS = new Set(['rectangle', 'price_range', 'date_and_price_range'])
const NOTE_TOOLS = new Set(['note', 'text', 'callout', 'comment', 'balloon', 'price_note', 'price_label', 'signpost'])

/** A drawing on the chart → the schema's line, or null when it has no word for it. */
export function lineFromShape(s: ShapeSnapshot): ChartLine | null {
  const id = lineIdFor(s.id)
  const [a, b] = s.points
  const label = s.props.showLabel === false ? undefined : cleanLabel(s.props.text)
  if (H_TOOLS.has(s.name)) {
    const p = price(a?.price)
    return p === null ? null : { id, kind: 'h', price: p, ...(label ? { label } : {}) }
  }
  if (ZONE_TOOLS.has(s.name)) {
    const p1 = price(a?.price)
    const p2 = price(b?.price)
    if (p1 === null || p2 === null || p1 === p2) return null
    return { id, kind: 'zone', p1: Math.max(p1, p2), p2: Math.min(p1, p2), ...(label ? { label } : {}) }
  }
  if (TREND_TOOLS.has(s.name)) {
    const t1 = sec(a?.time)
    const t2 = sec(b?.time)
    const p1 = price(a?.price)
    const p2 = price(b?.price)
    if (t1 === null || t2 === null || p1 === null || p2 === null) return null
    if (t1 === t2 && p1 === p2) return null
    const both = s.name === 'extended' || (s.props.extendLeft === true && s.props.extendRight === true)
    const right = s.name === 'ray' || s.props.extendRight === true
    return { id, kind: 'trend', t1, p1, t2, p2, ...(label ? { label } : {}), ...(both ? { extend: 'both' as const } : right ? { extend: 'right' as const } : {}) }
  }
  if (s.name === 'fib_retracement') {
    const t1 = sec(a?.time)
    const t2 = sec(b?.time)
    const p1 = price(a?.price)
    const p2 = price(b?.price)
    if (t1 === null || t2 === null || p1 === null || p2 === null || p1 === p2) return null
    return { id, kind: 'fib', t1, p1, t2, p2 }
  }
  if (s.name === 'vertical_line') {
    const t = sec(a?.time)
    return t === null ? null : { id, kind: 'vline', t, ...(label ? { label } : {}) }
  }
  if (NOTE_TOOLS.has(s.name)) {
    const t = sec(a?.time)
    const p = price(a?.price)
    const text = cleanLabel(s.props.text, CHART_NOTE_MAX)
    if (t === null || p === null || !text) return null
    return { id, kind: 'note', t, price: p, text }
  }
  return null
}

/** Every drawing the schema can say, in the chart's order, capped. */
export function linesFromShapes(shapes: readonly ShapeSnapshot[], cap: number): ChartLine[] {
  const out: ChartLine[] = []
  for (const s of shapes) {
    const line = lineFromShape(s)
    if (line) out.push(line)
    if (out.length >= cap) break
  }
  return out
}

/** Same drawings? (ids and geometry; the echo guard between chart and page). */
export function sameLines(a: readonly ChartLine[], b: readonly ChartLine[]): boolean {
  return a.length === b.length && JSON.stringify(a) === JSON.stringify(b)
}
