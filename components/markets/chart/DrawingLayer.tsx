'use client'

// The drawings over the candles — horizontal levels, zones, trend lines,
// notes, Fibonacci retracements, vertical lines — rendered as an SVG layer
// in the chart's own pixel space so a level can wear a chip. lightweight-
// charts owns the bars, axes, crosshair and (for h lines) the axis price
// tag; this layer owns the hit targets, the labels, and the popover that
// turns a level into an ask. Everything here is pointer-events:none except
// the handles, so pan/zoom on the bars keeps working under the drawings.
//
// Gestures (pointer events, so a finger works like a mouse):
//   · a drawing is DRAGGED by its body; a zone by either edge, a trend line
//     or a fib by either end, a vertical line sideways. A press that doesn't
//     travel is a click and opens the popover. The math is lib/chart-draw
//     (pure, pinned).
//   · with a tool armed, a capture surface takes the plot: press-drag-release
//     draws a zone, a trend line or a fib in one motion, and two clicks still
//     work. With the magnet on, trend / fib ends and notes snap to the bar's
//     open/high/low/close.
//   · two tools place nothing. ZOOM: drag a box, and the host aims the chart
//     at it — both axes (lib/chart-focus boxFocus). MEASURE: drag a box and
//     read it out loud (percent, dollars, bars, time); the readout stays
//     until the next press, and the tool stays armed for the next leg.
//
// The popover's chips follow the chip-send contract: a click SENDS the ask
// through `onAct` (ChartOverlay's send path). When the host has no send
// path (the standalone /t page) it passes `askHref` and the chip becomes a
// prefill link instead — a URL never fires a turn.

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { Focus, Trash2, X } from 'lucide-react'
import { newLineId, type ChartLine, type TrendExtend } from '@/lib/chart-state'
import type { LineActionOffer } from '@/lib/chart-actions'
import { DRAG_SLOP_PX, DRAW_DRAG_MIN_PX, dragLine, fibLevels, measureReadout, trendReadout, zoneReadout, type DragPart, type DrawSpace, type DrawTool } from '@/lib/chart-draw'
import { boxFocus, lineFocus, type FocusView } from '@/lib/chart-focus'
import { fmtLegendTime } from '@/lib/chart-legend'
import type { ChartTf } from '@/lib/charts'
import { fmtPrice } from '@/components/CandleChart'

export type { DrawTool }

/** Pixel geometry the chart exposes for one render tick. `plotRight` is
 *  where the price axis begins (the pane width). Null coordinates mean
 *  "not representable" (price scale not ready) — the layer draws nothing. */
export interface ChartGeom extends DrawSpace {
  width: number
  height: number
  plotRight: number
  /** Seconds per bar on the frame on screen (a trend line's "12 bars"). */
  barSec: number
  tf: ChartTf
  /** A pixel → the engine's bar index (fractional allowed) — the zoom box's time edges. */
  xToLogical: (x: number) => number | null
}

export interface DrawingLayerProps {
  geom: ChartGeom | null
  lines: ChartLine[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  /** A finished edit (add, remove, label, attach) — the host records undo. */
  onChange: (lines: ChartLine[]) => void
  /** A drag is beginning — the host records the undo point once. */
  onDragStart?: () => void
  /** Live positions while a drawing is dragged — no undo point per frame. */
  onDrag?: (lines: ChartLine[]) => void
  /** The armed tool; 'none' leaves the plot to the chart's own gestures. */
  tool?: DrawTool
  /** A drawing was placed — the host puts the tool down. */
  onToolDone?: () => void
  /** The note tool picked a point — the host asks for the words. */
  onNote?: (at: { t: number; price: number }) => void
  /** The zoom tool drew a box, or a drawing's Focus was pressed: aim the
   *  chart there (both axes for a box, the price axis for a drawing). */
  onFocus?: (view: FocusView | { price: FocusView['price'] }) => void
  /** Snap trend / fib ends and notes to the bar's O/H/L/C (default on). */
  magnet?: boolean
  /** Offers for a selected level/zone — composed by the host from the live
   *  last price (lib/chart-actions). */
  offersFor: (line: ChartLine) => LineActionOffer[]
  /** Why a level has fewer offers than a trader expects (named, or null). */
  missingNote: string | null
  onAct?: (ask: string) => void
  askHref?: (ask: string) => string
  readOnly?: boolean
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

interface Pt {
  x: number
  y: number
}

/** A segment through (x1,y1)-(x2,y2) stretched to the plot's edges: the
 *  whole line for 'both', the part right of the second point for 'right'. */
function extendedEnds(x1: number, y1: number, x2: number, y2: number, extend: TrendExtend | undefined, plotW: number): { ax: number; ay: number; bx: number; by: number } | null {
  if (!extend || x1 === x2) return null
  const slope = (y2 - y1) / (x2 - x1)
  const at = (x: number) => y1 + (x - x1) * slope
  const right = x2 >= x1
  const far = right ? plotW : 0
  const near = right ? 0 : plotW
  if (extend === 'right') return { ax: x2, ay: y2, bx: far, by: at(far) }
  return { ax: near, ay: at(near), bx: far, by: at(far) }
}

const EXTEND_OPTIONS: { key: TrendExtend | 'none'; label: string; title: string }[] = [
  { key: 'none', label: 'segment', title: 'The line ends at its two points' },
  { key: 'right', label: 'ray →', title: 'The line carries on past its second point' },
  { key: 'both', label: '↔ both', title: 'The line runs across the whole plot' },
]

export default function DrawingLayer({ geom, lines, selectedId, onSelect, onChange, onDragStart, onDrag, tool = 'none', onToolDone, onNote, onFocus, magnet = true, offersFor, missingNote, onAct, askHref, readOnly }: DrawingLayerProps) {
  const selected = useMemo(() => lines.find((l) => l.id === selectedId) ?? null, [lines, selectedId])
  const [labelDraft, setLabelDraft] = useState('')
  const popRef = useRef<HTMLDivElement | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  // A drawing under the hand: the popover stays shut until the press ends.
  const [draggingId, setDraggingId] = useState<string | null>(null)
  // The tool's first point (a zone / trend / fib in progress, or a zoom /
  // measure box's corner) and the cursor.
  const [draft, setDraft] = useState<{ tool: DrawTool; at: Pt; t: number; price: number } | null>(null)
  const [cursor, setCursor] = useState<Pt | null>(null)
  // A finished measurement, kept in price + time so it rides a pan.
  const [measure, setMeasure] = useState<{ from: { t: number; price: number }; to: { t: number; price: number } } | null>(null)
  const pressRef = useRef<{ at: Pt; placedDraft: boolean } | null>(null)
  const linesRef = useRef(lines)
  linesRef.current = lines
  const geomRef = useRef(geom)
  geomRef.current = geom
  const magnetRef = useRef(magnet)
  magnetRef.current = magnet

  useEffect(() => {
    if (!selected) return
    setLabelDraft(selected.kind === 'note' ? selected.text : (selected.label ?? ''))
  }, [selected])

  // Putting the tool down (Esc, the toolbar, a finished drawing) drops the
  // draft and any measurement on screen.
  useEffect(() => {
    setDraft(null)
    setCursor(null)
    setMeasure(null)
    pressRef.current = null
  }, [tool])

  // Click outside the popover closes it (Esc is handled by the host).
  useEffect(() => {
    if (!selected) return
    const onDown = (e: PointerEvent) => {
      const el = popRef.current
      if (el && !el.contains(e.target as Node) && !(e.target as HTMLElement).closest?.('[data-draw-handle]')) onSelect(null)
    }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [selected, onSelect])

  const local = useCallback((e: { clientX: number; clientY: number }): Pt => {
    const box = svgRef.current?.getBoundingClientRect()
    return box ? { x: e.clientX - box.left, y: e.clientY - box.top } : { x: e.clientX, y: e.clientY }
  }, [])

  // ── dragging a drawing that exists ────────────────────────────────────────
  const startDrag = useCallback(
    (e: ReactPointerEvent, line: ChartLine, part: DragPart) => {
      e.stopPropagation()
      if (readOnly || (e.pointerType === 'mouse' && e.button !== 0)) return
      e.preventDefault()
      onSelect(line.id)
      const x0 = e.clientX
      const y0 = e.clientY
      let moved = false
      const move = (ev: PointerEvent) => {
        const dx = ev.clientX - x0
        const dy = ev.clientY - y0
        if (!moved) {
          if (Math.hypot(dx, dy) < DRAG_SLOP_PX) return
          moved = true
          setDraggingId(line.id)
          onDragStart?.()
        }
        const g = geomRef.current
        if (!g) return
        const next = dragLine(line, part, dx, dy, g, magnetRef.current)
        if (next) (onDrag ?? onChange)(linesRef.current.map((l) => (l.id === line.id ? next : l)))
      }
      const end = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', end)
        window.removeEventListener('pointercancel', end)
        setDraggingId(null)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', end)
      window.addEventListener('pointercancel', end)
    },
    [readOnly, onSelect, onDragStart, onDrag, onChange],
  )
  const grab = (line: ChartLine, part: DragPart = 'body') => ({ 'data-draw-handle': true, onPointerDown: (e: ReactPointerEvent) => startDrag(e, line, part) })

  if (!geom || geom.width <= 0 || geom.height <= 0) return null
  const { width, height, plotRight } = geom
  const plotW = Math.max(0, plotRight)
  const snapsEnds = magnet && (tool === 'trend' || tool === 'fib' || tool === 'note')

  // ── placing a new drawing (the capture surface, tool armed) ───────────────
  const pointAt = (p: Pt, snap: boolean): { t: number; price: number } | null => {
    if (snap) {
      const hit = geom.snap?.(p.x, p.y)
      if (hit) return hit
    }
    const price = geom.yToPrice(p.y)
    const t = geom.xToTime(p.x)
    return price !== null && price > 0 && t !== null ? { t: Math.round(t), price } : null
  }
  const add = (line: ChartLine) => {
    onChange([...lines, line])
    onSelect(line.id)
    onToolDone?.()
  }
  const finish = (from: { t: number; price: number }, to: { t: number; price: number }, fromPx: Pt, toPx: Pt) => {
    if (tool === 'zone' && from.price !== to.price) add({ id: newLineId('z'), kind: 'zone', p1: from.price, p2: to.price })
    else if (tool === 'trend' && !(from.t === to.t && from.price === to.price)) add({ id: newLineId('t'), kind: 'trend', t1: from.t, p1: from.price, t2: to.t, p2: to.price })
    else if (tool === 'fib' && from.price !== to.price) add({ id: newLineId('f'), kind: 'fib', t1: from.t, p1: from.price, t2: to.t, p2: to.price })
    else if (tool === 'zoom') {
      const view = boxFocus(fromPx, toPx, geom.xToLogical, geom.yToPrice)
      if (view) {
        onFocus?.(view)
        onToolDone?.()
      }
    } else if (tool === 'measure') {
      // A box too small to read is a click: it clears the last readout.
      setMeasure(Math.hypot(fromPx.x - toPx.x, fromPx.y - toPx.y) >= DRAW_DRAG_MIN_PX ? { from, to } : null)
    }
  }
  const boxTool = tool === 'zone' || tool === 'trend' || tool === 'fib' || tool === 'zoom' || tool === 'measure'
  const capture = {
    onPointerDown: (e: ReactPointerEvent<SVGRectElement>) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      e.preventDefault()
      e.currentTarget.setPointerCapture?.(e.pointerId)
      const at = local(e)
      setCursor(at)
      if (tool === 'measure') setMeasure(null)
      let placedDraft = false
      if (boxTool && !draft) {
        const p = pointAt(at, snapsEnds)
        if (p) {
          setDraft({ tool, at, ...p })
          placedDraft = true
        }
      }
      pressRef.current = { at, placedDraft }
    },
    onPointerMove: (e: ReactPointerEvent<SVGRectElement>) => setCursor(local(e)),
    onPointerLeave: () => {
      if (!pressRef.current) setCursor(null)
    },
    onPointerUp: (e: ReactPointerEvent<SVGRectElement>) => {
      const press = pressRef.current
      pressRef.current = null
      if (!press) return
      const at = local(e)
      if (tool === 'h') {
        const price = geom.yToPrice(at.y)
        if (price !== null && price > 0) add({ id: newLineId('h'), kind: 'h', price })
        return
      }
      if (tool === 'vline') {
        const t = geom.xToTime(at.x)
        if (t !== null && t >= 0) add({ id: newLineId('v'), kind: 'vline', t: Math.round(t) })
        return
      }
      if (tool === 'note') {
        const p = pointAt(at, snapsEnds)
        if (p) {
          onNote?.(p)
          onToolDone?.()
        }
        return
      }
      if (!draft && !press.placedDraft) return
      // The press that placed the first point either dragged out the whole
      // shape, or was a click and the second click finishes it. A zoom or a
      // measure box is always one motion: a click with either leaves nothing.
      if (press.placedDraft && Math.hypot(at.x - press.at.x, at.y - press.at.y) < DRAW_DRAG_MIN_PX) {
        if (tool === 'zoom' || tool === 'measure') setDraft(null)
        return
      }
      const fromPx = draft?.at ?? press.at
      const from = draft ?? pointAt(press.at, snapsEnds)
      const to = pointAt(at, snapsEnds)
      if (from && to) finish(from, to, fromPx, at)
      if (tool === 'zoom' || tool === 'measure') setDraft(null)
    },
    onPointerCancel: () => {
      pressRef.current = null
    },
  }

  const update = (id: string, patch: Partial<ChartLine>) => {
    onChange(lines.map((l) => (l.id === id ? ({ ...l, ...patch } as ChartLine) : l)))
  }
  const remove = (id: string) => {
    onChange(lines.filter((l) => l.id !== id))
    onSelect(null)
  }
  const attach = (line: ChartLine, offer: LineActionOffer) => {
    if (line.kind === 'h' || line.kind === 'zone') update(line.id, { action: offer.action } as Partial<ChartLine>)
    if (onAct) {
      onAct(offer.action.ask)
      onSelect(null)
    }
  }
  const commitLabel = (line: ChartLine) => {
    const v = labelDraft.trim().slice(0, line.kind === 'note' ? 280 : 80)
    if (line.kind === 'note') {
      if (v && v !== line.text) update(line.id, { text: v } as Partial<ChartLine>)
    } else if ((v || undefined) !== line.label) {
      update(line.id, { label: v || undefined } as Partial<ChartLine>)
    }
  }
  /** A fib level becomes a level of its own (which can carry an order). */
  const levelFromFib = (price: number, label: string) => {
    const id = newLineId('h')
    onChange([...lines, { id, kind: 'h', price, label }])
    onSelect(id)
  }
  const focusSelected = () => {
    if (!selected) return
    const price = lineFocus(selected)
    if (price) onFocus?.({ price })
  }

  // Popover anchor: the selected drawing's y (clamped inside the pane).
  let popY: number | null = null
  if (selected && draggingId !== selected.id) {
    const y =
      selected.kind === 'h' || selected.kind === 'note'
        ? geom.priceToY(selected.price)
        : selected.kind === 'vline'
          ? 24
          : geom.priceToY(Math.max(selected.p1, selected.p2))
    if (y !== null) popY = clamp(y, 8, Math.max(8, height - 8))
  }
  const offers = selected ? offersFor(selected) : []
  // Below the line when there is room under it, above it otherwise — and
  // never taller than the space it has (the canvas clips; a popover whose
  // head is cut off can't be closed or labelled).
  // On a phone's plot (260px tall) "the space it has" on one side of the line
  // was ~130px: one offer and a scrollbar. There the popover takes the whole
  // plot, edge to edge; the level stays in its head ("level · $204.93").
  const popStyle: CSSProperties | null =
    popY === null
      ? null
      : width < 480
        ? { left: 8, right: 8, top: 8, width: 'auto', maxHeight: Math.max(120, height - 16) }
      : popY > height * 0.55
        ? { left: 12, top: 8, maxHeight: Math.max(120, popY - 18) }
        : { left: 12, top: popY + 10, maxHeight: Math.max(120, height - popY - 18) }

  const popKind = !selected
    ? ''
    : selected.kind === 'h'
      ? `level · $${fmtPrice(selected.price)}`
      : selected.kind === 'zone'
        ? `zone · $${fmtPrice(Math.min(selected.p1, selected.p2))}–$${fmtPrice(Math.max(selected.p1, selected.p2))}`
        : selected.kind === 'trend'
          ? 'trend line'
          : selected.kind === 'fib'
            ? `fib · $${fmtPrice(selected.p1)} → $${fmtPrice(selected.p2)}`
            : selected.kind === 'vline'
              ? `time · ${fmtLegendTime(selected.t, geom.tf)}`
              : 'note'

  // The measurement on screen (finished, or the box under the hand).
  const measureBox = (from: { t: number; price: number }, to: { t: number; price: number }, toPx?: Pt) => {
    const x1 = geom.timeToX(from.t)
    const y1 = geom.priceToY(from.price)
    const x2 = toPx?.x ?? geom.timeToX(to.t)
    const y2 = toPx?.y ?? geom.priceToY(to.price)
    if (x1 === null || y1 === null || x2 === null || y2 === null) return null
    const read = measureReadout(from.price, to.price, from.t, to.t, geom.barSec, fmtPrice)
    if (!read) return null
    const up = read.delta >= 0
    const left = Math.min(x1, x2)
    const top = Math.min(y1, y2)
    const w = Math.abs(x2 - x1)
    const h = Math.abs(y2 - y1)
    const labelW = 9 + 6.2 * read.words.length
    const lx = clamp(x2 + 8, 8, Math.max(8, plotW - labelW - 8))
    const ly = clamp(y2 < y1 ? top - 26 : top + h + 8, 2, Math.max(2, height - 20))
    return (
      <g className={`mkt-draw__measure${up ? ' is-up' : ' is-down'}`}>
        <rect x={left} y={top} width={Math.max(1, w)} height={Math.max(1, h)} />
        <line x1={x1} y1={y1} x2={x2} y2={y2} />
        <circle cx={x1} cy={y1} r={3} />
        <circle cx={x2} cy={y2} r={3} />
        <g transform={`translate(${lx}, ${ly})`} className="mkt-draw__pill mkt-draw__pill--read">
          <rect rx={4} height={18} width={Math.max(40, labelW)} />
          <text x={6} y={12.5}>{read.words}</text>
        </g>
      </g>
    )
  }

  return (
    <>
      <svg ref={svgRef} className={`mkt-draw${draggingId ? ' is-dragging' : ''}`} width={width} height={height} aria-hidden={lines.length === 0 && tool === 'none'}>
        {/* zones first so lines sit over them */}
        {lines.map((l) => {
          if (l.kind !== 'zone') return null
          const y1 = geom.priceToY(l.p1)
          const y2 = geom.priceToY(l.p2)
          if (y1 === null || y2 === null) return null
          const top = Math.min(y1, y2)
          const h = Math.max(2, Math.abs(y2 - y1))
          const sel = l.id === selectedId
          return (
            <g key={l.id} className={`mkt-draw__zone${sel ? ' is-selected' : ''}${l.action ? ' has-action' : ''}`}>
              <rect x={0} y={top} width={plotW} height={h} />
              <rect x={0} y={top} width={plotW} height={h} className="mkt-draw__hit mkt-draw__hit--move" {...grab(l)} />
              {sel && !readOnly && (
                <>
                  {/* either edge resizes; the grips say so */}
                  <line x1={0} x2={plotW} y1={y1} y2={y1} className="mkt-draw__hit mkt-draw__hit--ns" {...grab(l, 'a')} />
                  <line x1={0} x2={plotW} y1={y2} y2={y2} className="mkt-draw__hit mkt-draw__hit--ns" {...grab(l, 'b')} />
                  <rect className="mkt-draw__grip" x={plotW / 2 - 12} y={y1 - 2} width={24} height={4} rx={2} />
                  <rect className="mkt-draw__grip" x={plotW / 2 - 12} y={y2 - 2} width={24} height={4} rx={2} />
                </>
              )}
              <text x={8} y={clamp(top + 12, 12, height - 4)} className="mkt-draw__label">
                {(l.label ?? 'zone') + (l.action ? ` · ${l.action.kind}` : '')} {fmtPrice(Math.min(l.p1, l.p2))}–{fmtPrice(Math.max(l.p1, l.p2))}{sel ? ` · ${zoneReadout(l.p1, l.p2)}` : ''}
              </text>
            </g>
          )
        })}
        {/* vertical lines next: under every price drawing, over the zones */}
        {lines.map((l) => {
          if (l.kind !== 'vline') return null
          const x = geom.timeToX(l.t)
          if (x === null || x < -2 || x > plotW + 2) return null
          const sel = l.id === selectedId
          const when = fmtLegendTime(l.t, geom.tf)
          const pillW = Math.max(40, 9 + 6.2 * when.length)
          return (
            <g key={l.id} className={`mkt-draw__v${sel ? ' is-selected' : ''}`}>
              <line x1={x} x2={x} y1={0} y2={height} />
              <line x1={x} x2={x} y1={0} y2={height} className="mkt-draw__hit mkt-draw__hit--ew" {...grab(l)} />
              <g transform={`translate(${clamp(x - pillW / 2, 2, Math.max(2, plotW - pillW - 2))}, ${height - 22})`} className="mkt-draw__pill" {...grab(l)}>
                <rect rx={4} height={18} width={pillW} />
                <text x={6} y={12.5}>{when}</text>
              </g>
              {l.label && (
                <text x={clamp(x + 6, 8, plotW - 8)} y={14} className="mkt-draw__label">
                  {l.label}
                </text>
              )}
            </g>
          )
        })}
        {lines.map((l) => {
          if (l.kind === 'h') {
            const y = geom.priceToY(l.price)
            if (y === null) return null
            const sel = l.id === selectedId
            return (
              <g key={l.id} className={`mkt-draw__h${sel ? ' is-selected' : ''}${l.action ? ' has-action' : ''}`}>
                <line x1={0} x2={plotW} y1={y} y2={y} />
                <line x1={0} x2={plotW} y1={y} y2={y} className="mkt-draw__hit mkt-draw__hit--ns" {...grab(l)} />
                <g transform={`translate(8, ${clamp(y - 9, 2, height - 20)})`} className="mkt-draw__pill" {...grab(l)}>
                  <rect rx={4} height={18} width={Math.max(40, 9 + 6.2 * ((l.label ?? (l.action ? l.action.kind : 'level')).length + fmtPrice(l.price).length + 3))} />
                  <text x={6} y={12.5}>
                    {l.label ?? (l.action ? l.action.kind : 'level')} · {fmtPrice(l.price)}
                  </text>
                </g>
              </g>
            )
          }
          if (l.kind === 'trend') {
            const x1 = geom.timeToX(l.t1)
            const x2 = geom.timeToX(l.t2)
            const y1 = geom.priceToY(l.p1)
            const y2 = geom.priceToY(l.p2)
            if (x1 === null || x2 === null || y1 === null || y2 === null) return null
            const sel = l.id === selectedId
            const ext = extendedEnds(x1, y1, x2, y2, l.extend, plotW)
            return (
              <g key={l.id} className={`mkt-draw__trend${sel ? ' is-selected' : ''}`}>
                {ext && <line className="mkt-draw__ext" x1={ext.ax} y1={ext.ay} x2={ext.bx} y2={ext.by} />}
                <line x1={x1} x2={x2} y1={y1} y2={y2} />
                <line x1={x1} x2={x2} y1={y1} y2={y2} className="mkt-draw__hit mkt-draw__hit--move" {...grab(l)} />
                {sel && !readOnly && (
                  <>
                    <circle className="mkt-draw__end" cx={x1} cy={y1} r={4.5} />
                    <circle className="mkt-draw__end" cx={x2} cy={y2} r={4.5} />
                    <circle className="mkt-draw__hit mkt-draw__hit--move" cx={x1} cy={y1} r={12} {...grab(l, 'a')} />
                    <circle className="mkt-draw__hit mkt-draw__hit--move" cx={x2} cy={y2} r={12} {...grab(l, 'b')} />
                  </>
                )}
                {sel && (
                  <text x={clamp((x1 + x2) / 2, 8, plotW - 8)} y={clamp((y1 + y2) / 2 - 8, 12, height - 4)} textAnchor="middle" className="mkt-draw__label mkt-draw__label--read">
                    {trendReadout(l.p1, l.p2, l.t1, l.t2, geom.barSec)}
                  </text>
                )}
                {l.label && (
                  <text x={clamp(x2 + 6, 8, plotW - 8)} y={clamp(y2 - 6, 12, height - 4)} className="mkt-draw__label">
                    {l.label}
                  </text>
                )}
              </g>
            )
          }
          if (l.kind === 'fib') {
            const x1 = geom.timeToX(l.t1)
            const x2 = geom.timeToX(l.t2)
            const y1 = geom.priceToY(l.p1)
            const y2 = geom.priceToY(l.p2)
            if (x1 === null || x2 === null || y1 === null || y2 === null) return null
            const sel = l.id === selectedId
            // Every level draws its line; a label only where it has room (two
            // levels under 11px apart on a small swing wrote over each other).
            const placed = fibLevels(l.p1, l.p2).map((lv) => ({ lv, y: geom.priceToY(lv.price) }))
            let lastLabelY = -Infinity
            const levels = [...placed]
              .sort((a, b) => (a.y ?? 0) - (b.y ?? 0))
              .map((e) => {
                const label = e.y !== null && e.y - lastLabelY >= 11
                if (label && e.y !== null) lastLabelY = e.y
                return { ...e, label }
              })
            const left = clamp(Math.min(x1, x2), 0, plotW)
            // The retracement band: the swing's own height, tinted; the
            // extensions beyond it draw as lines alone.
            const bandTop = Math.min(y1, y2)
            const bandH = Math.abs(y2 - y1)
            return (
              <g key={l.id} className={`mkt-draw__fib${sel ? ' is-selected' : ''}`}>
                <rect className="mkt-draw__fibband" x={left} y={bandTop} width={Math.max(0, plotW - left)} height={Math.max(1, bandH)} />
                {levels.map(({ lv, y, label }) => {
                  if (y === null || y < -2 || y > height + 2) return null
                  const text = `${lv.label} · ${fmtPrice(lv.price)}`
                  return (
                    <g key={lv.ratio} className={`mkt-draw__fiblvl${lv.ratio > 1 ? ' is-ext' : ''}${lv.ratio === 0 || lv.ratio === 1 ? ' is-end' : ''}`}>
                      <line x1={left} x2={plotW} y1={y} y2={y} />
                      {label && (
                        <text x={plotW - 6} y={clamp(y - 3, 10, height - 4)} textAnchor="end" className="mkt-draw__label mkt-draw__label--read">
                          {text}
                        </text>
                      )}
                    </g>
                  )
                })}
                <line className="mkt-draw__fibswing" x1={x1} x2={x2} y1={y1} y2={y2} />
                <line x1={x1} x2={x2} y1={y1} y2={y2} className="mkt-draw__hit mkt-draw__hit--move" {...grab(l)} />
                {sel && !readOnly && (
                  <>
                    <circle className="mkt-draw__end" cx={x1} cy={y1} r={4.5} />
                    <circle className="mkt-draw__end" cx={x2} cy={y2} r={4.5} />
                    <circle className="mkt-draw__hit mkt-draw__hit--move" cx={x1} cy={y1} r={12} {...grab(l, 'a')} />
                    <circle className="mkt-draw__hit mkt-draw__hit--move" cx={x2} cy={y2} r={12} {...grab(l, 'b')} />
                  </>
                )}
                {l.label && (
                  <text x={clamp(left + 6, 8, plotW - 8)} y={clamp(bandTop - 6, 12, height - 4)} className="mkt-draw__label">
                    {l.label}
                  </text>
                )}
              </g>
            )
          }
          if (l.kind === 'note') {
            const x = geom.timeToX(l.t)
            const y = geom.priceToY(l.price)
            if (x === null || y === null) return null
            const sel = l.id === selectedId
            const cx = clamp(x, 6, plotW - 6)
            return (
              <g key={l.id} className={`mkt-draw__note${sel ? ' is-selected' : ''}`}>
                <circle cx={cx} cy={y} r={4} />
                <circle cx={cx} cy={y} r={12} className="mkt-draw__hit mkt-draw__hit--move" {...grab(l)} />
                <text x={clamp(cx + 8, 8, plotW - 8)} y={clamp(y - 8, 12, height - 4)} className="mkt-draw__label mkt-draw__label--note">
                  {l.text.length > 42 ? `${l.text.slice(0, 41)}…` : l.text}
                </text>
              </g>
            )
          }
          return null
        })}

        {/* a finished measurement rides the bars until the next press */}
        {measure && !draft && measureBox(measure.from, measure.to)}

        {/* The armed tool takes the plot: one surface, every pointer. */}
        {tool !== 'none' && !readOnly && <rect className={`mkt-draw__capture${tool === 'zoom' ? ' is-zoom' : ''}`} x={0} y={0} width={plotW} height={height} {...capture} />}

        {/* in progress: a guide under the cursor, then the shape as it grows */}
        {tool === 'h' && cursor && (
          <g className="mkt-draw__guide">
            <line x1={0} x2={plotW} y1={cursor.y} y2={cursor.y} />
            <text x={8} y={clamp(cursor.y - 5, 12, height - 4)} className="mkt-draw__label mkt-draw__label--read">
              {(() => {
                const p = geom.yToPrice(cursor.y)
                return p !== null ? `level · ${fmtPrice(p)}` : ''
              })()}
            </text>
          </g>
        )}
        {tool === 'vline' && cursor && (
          <g className="mkt-draw__guide">
            <line x1={cursor.x} x2={cursor.x} y1={0} y2={height} />
            <text x={clamp(cursor.x + 6, 8, plotW - 8)} y={14} className="mkt-draw__label mkt-draw__label--read">
              {(() => {
                const t = geom.xToTime(cursor.x)
                return t !== null ? fmtLegendTime(Math.round(t), geom.tf) : ''
              })()}
            </text>
          </g>
        )}
        {draft && cursor && (() => {
          const y1 = geom.priceToY(draft.price)
          if (y1 === null) return null
          if (draft.tool === 'zone') {
            const top = Math.min(y1, cursor.y)
            const p2 = geom.yToPrice(cursor.y)
            return (
              <g>
                <rect className="mkt-draw__preview" x={0} y={top} width={plotW} height={Math.max(1, Math.abs(cursor.y - y1))} />
                {p2 !== null && (
                  <text x={8} y={clamp(top - 5, 12, height - 4)} className="mkt-draw__label mkt-draw__label--read">
                    {fmtPrice(Math.min(draft.price, p2))}–{fmtPrice(Math.max(draft.price, p2))} · {zoneReadout(draft.price, p2)}
                  </text>
                )}
              </g>
            )
          }
          if (draft.tool === 'trend' || draft.tool === 'fib') {
            const x1 = geom.timeToX(draft.t)
            if (x1 === null) return null
            const to = pointAt(cursor, snapsEnds)
            const x2 = to ? (geom.timeToX(to.t) ?? cursor.x) : cursor.x
            const y2 = to ? (geom.priceToY(to.price) ?? cursor.y) : cursor.y
            const fibPreview = draft.tool === 'fib' && to ? fibLevels(draft.price, to.price) : []
            const left = clamp(Math.min(x1, x2), 0, plotW)
            return (
              <g>
                {fibPreview.map((lv) => {
                  const y = geom.priceToY(lv.price)
                  return y === null ? null : <line key={lv.ratio} className="mkt-draw__preview" x1={left} x2={plotW} y1={y} y2={y} />
                })}
                <line className="mkt-draw__preview" x1={x1} y1={y1} x2={x2} y2={y2} />
                <circle className="mkt-draw__end" cx={x1} cy={y1} r={4} />
                <circle className="mkt-draw__end" cx={x2} cy={y2} r={4} />
                {to && (
                  <text x={clamp(x2 + 10, 8, plotW - 8)} y={clamp(y2 - 8, 12, height - 4)} className="mkt-draw__label mkt-draw__label--read">
                    {trendReadout(draft.price, to.price, draft.t, to.t, geom.barSec)}
                  </text>
                )}
              </g>
            )
          }
          if (draft.tool === 'zoom') {
            const left = Math.min(draft.at.x, cursor.x)
            const top = Math.min(draft.at.y, cursor.y)
            const w = Math.abs(cursor.x - draft.at.x)
            const h = Math.abs(cursor.y - draft.at.y)
            const pLo = geom.yToPrice(top + h)
            const pHi = geom.yToPrice(top)
            const ready = boxFocus(draft.at, cursor, geom.xToLogical, geom.yToPrice) !== null
            return (
              <g className={`mkt-draw__zoombox${ready ? ' is-ready' : ''}`}>
                <rect x={left} y={top} width={Math.max(1, w)} height={Math.max(1, h)} />
                {pLo !== null && pHi !== null && (
                  <text x={clamp(left + 6, 8, plotW - 8)} y={clamp(top - 6, 12, height - 4)} className="mkt-draw__label mkt-draw__label--read">
                    {ready ? `zoom to ${fmtPrice(pLo)}–${fmtPrice(pHi)}` : 'drag a box'}
                  </text>
                )}
              </g>
            )
          }
          if (draft.tool === 'measure') {
            const to = pointAt(cursor, false)
            return to ? measureBox({ t: draft.t, price: draft.price }, to, cursor) : null
          }
          return null
        })()}
      </svg>

      {selected && popStyle && (
        <div ref={popRef} className="mkt-pop" style={popStyle} role="dialog" aria-label="Drawing actions">
          <div className="mkt-pop__head">
            <span className="mono mkt-pop__kind">{popKind}</span>
            <button type="button" className="mkt-pop__x" aria-label="Close" onClick={() => onSelect(null)}>
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          {!readOnly && (
            <input
              className="mkt-pop__label"
              value={labelDraft}
              maxLength={selected.kind === 'note' ? 280 : 80}
              placeholder={selected.kind === 'note' ? 'What you noticed…' : 'Label (optional)'}
              onChange={(e) => setLabelDraft(e.target.value)}
              onBlur={() => commitLabel(selected)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  commitLabel(selected)
                  ;(e.target as HTMLInputElement).blur()
                }
              }}
            />
          )}
          {selected.kind === 'trend' && !readOnly && (
            <div className="mkt-pop__seg" role="group" aria-label="Extend the line">
              {EXTEND_OPTIONS.map((o) => {
                const on = (selected.extend ?? 'none') === o.key
                return (
                  <button key={o.key} type="button" className={`mkt-pop__segbtn mono${on ? ' is-active' : ''}`} aria-pressed={on} title={o.title} onClick={() => update(selected.id, { extend: o.key === 'none' ? undefined : o.key } as Partial<ChartLine>)}>
                    {o.label}
                  </button>
                )
              })}
            </div>
          )}
          {selected.kind === 'fib' && (
            <ul className="mkt-pop__levels" aria-label="Fibonacci levels">
              {fibLevels(selected.p1, selected.p2).map((lv) => (
                <li key={lv.ratio} className={lv.ratio > 1 ? 'is-ext' : undefined}>
                  <span className="mono mkt-pop__ratio">{lv.label}</span>
                  <span className="mono">${fmtPrice(lv.price)}</span>
                  {!readOnly && (
                    <button type="button" className="mkt-pop__mini" title={`Put a level at $${fmtPrice(lv.price)} — it can carry an order`} onClick={() => levelFromFib(lv.price, `fib ${lv.label}`)}>
                      level here
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {offers.length > 0 && (
            <div className="mkt-pop__offers">
              {offers.map((o) => {
                const active = (selected.kind === 'h' || selected.kind === 'zone') && selected.action?.ask === o.action.ask
                const cls = `mkt-pop__chip${active ? ' is-active' : ''}${o.action.kind === 'buy' || o.action.kind === 'limit' && /buy/.test(o.action.ask) ? ' mkt-pop__chip--buy' : ''}`
                const body = (
                  <>
                    <span className="mkt-pop__chiplabel">{o.label}</span>
                    <span className="mkt-pop__hint">{o.hint}</span>
                  </>
                )
                return onAct ? (
                  <button key={o.action.ask} type="button" className={cls} title={o.action.ask} onClick={() => attach(selected, o)}>
                    {body}
                  </button>
                ) : (
                  <a key={o.action.ask} className={cls} title={o.action.ask} href={askHref ? askHref(o.action.ask) : `/chat?prompt=${encodeURIComponent(o.action.ask)}`} onClick={() => attach(selected, o)}>
                    {body}
                  </a>
                )
              })}
              <span className="mono mkt-pop__foot">{onAct ? 'a chip sends the ask · your wallet signs' : 'a chip prefills chat · you send it · your wallet signs'}</span>
            </div>
          )}
          {missingNote && (selected.kind === 'h' || selected.kind === 'zone') && <p className="mkt-pop__missing">{missingNote}</p>}
          <div className="mkt-pop__row">
            {onFocus && selected.kind !== 'vline' && (
              <button type="button" className="mkt-pop__del mkt-pop__focus" title="Aim the price axis at this drawing (the bars stay where they are)" onClick={focusSelected}>
                <Focus className="h-3 w-3" /> Focus
              </button>
            )}
            {!readOnly && (
              <button type="button" className="mkt-pop__del" onClick={() => remove(selected.id)}>
                <Trash2 className="h-3 w-3" /> Remove
              </button>
            )}
          </div>
        </div>
      )}
    </>
  )
}
