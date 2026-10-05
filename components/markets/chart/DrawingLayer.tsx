'use client'

// The drawings over the candles — horizontal levels, zones, trend lines,
// notes — rendered as an SVG layer in the chart's own pixel space so a
// level can wear a chip. lightweight-charts owns the bars, axes, crosshair
// and (for h lines) the axis price tag; this layer owns the hit targets,
// the labels, and the popover that turns a level into an ask. Everything
// here is pointer-events:none except the handles, so pan/zoom on the bars
// keeps working under the drawings.
//
// Gestures (pointer events, so a finger works like a mouse):
//   · a drawing is DRAGGED by its body; a zone by either edge, a trend line
//     by either end. A press that doesn't travel is a click and opens the
//     popover. The math is lib/chart-draw (pure, pinned).
//   · with a tool armed, a capture surface takes the plot: press-drag-release
//     draws a zone or a trend line in one motion, and two clicks still work.
//     Trend ends and notes snap to the bar's open/high/low/close.
//
// The popover's chips follow the chip-send contract: a click SENDS the ask
// through `onAct` (ChartOverlay's send path). When the host has no send
// path (the standalone /t page) it passes `askHref` and the chip becomes a
// prefill link instead — a URL never fires a turn.

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { Trash2, X } from 'lucide-react'
import { newLineId, type ChartLine } from '@/lib/chart-state'
import type { LineActionOffer } from '@/lib/chart-actions'
import { DRAG_SLOP_PX, DRAW_DRAG_MIN_PX, dragLine, trendReadout, zoneReadout, type DragPart, type DrawSpace } from '@/lib/chart-draw'
import { fmtPrice } from '@/components/CandleChart'

/** Pixel geometry the chart exposes for one render tick. `plotRight` is
 *  where the price axis begins (the pane width). Null coordinates mean
 *  "not representable" (price scale not ready) — the layer draws nothing. */
export interface ChartGeom extends DrawSpace {
  width: number
  height: number
  plotRight: number
  /** Seconds per bar on the frame on screen (a trend line's "12 bars"). */
  barSec: number
}

export type DrawTool = 'none' | 'h' | 'zone' | 'trend' | 'note'

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

export default function DrawingLayer({ geom, lines, selectedId, onSelect, onChange, onDragStart, onDrag, tool = 'none', onToolDone, onNote, offersFor, missingNote, onAct, askHref, readOnly }: DrawingLayerProps) {
  const selected = useMemo(() => lines.find((l) => l.id === selectedId) ?? null, [lines, selectedId])
  const [labelDraft, setLabelDraft] = useState('')
  const popRef = useRef<HTMLDivElement | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  // A drawing under the hand: the popover stays shut until the press ends.
  const [draggingId, setDraggingId] = useState<string | null>(null)
  // The tool's first point (a zone or trend line in progress) and the cursor.
  const [draft, setDraft] = useState<{ tool: DrawTool; at: Pt; t: number; price: number } | null>(null)
  const [cursor, setCursor] = useState<Pt | null>(null)
  const pressRef = useRef<{ at: Pt; placedDraft: boolean } | null>(null)
  const linesRef = useRef(lines)
  linesRef.current = lines
  const geomRef = useRef(geom)
  geomRef.current = geom

  useEffect(() => {
    if (!selected) return
    setLabelDraft(selected.kind === 'note' ? selected.text : (selected.label ?? ''))
  }, [selected])

  // Putting the tool down (Esc, the toolbar, a finished drawing) drops the draft.
  useEffect(() => {
    setDraft(null)
    setCursor(null)
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
        const next = dragLine(line, part, dx, dy, g)
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

  // ── placing a new drawing (the capture surface, tool armed) ───────────────
  const pointAt = (p: Pt, magnet: boolean): { t: number; price: number } | null => {
    if (magnet) {
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
  const finish = (from: { t: number; price: number }, to: { t: number; price: number }) => {
    if (tool === 'zone' && from.price !== to.price) add({ id: newLineId('z'), kind: 'zone', p1: from.price, p2: to.price })
    else if (tool === 'trend' && !(from.t === to.t && from.price === to.price)) add({ id: newLineId('t'), kind: 'trend', t1: from.t, p1: from.price, t2: to.t, p2: to.price })
  }
  const capture = {
    onPointerDown: (e: ReactPointerEvent<SVGRectElement>) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      e.preventDefault()
      e.currentTarget.setPointerCapture?.(e.pointerId)
      const at = local(e)
      setCursor(at)
      let placedDraft = false
      if ((tool === 'zone' || tool === 'trend') && !draft) {
        const p = pointAt(at, tool === 'trend')
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
      if (tool === 'note') {
        const p = pointAt(at, true)
        if (p) {
          onNote?.(p)
          onToolDone?.()
        }
        return
      }
      if (!draft && !press.placedDraft) return
      // The press that placed the first point either dragged out the whole
      // shape, or was a click and the second click finishes it.
      if (press.placedDraft && Math.hypot(at.x - press.at.x, at.y - press.at.y) < DRAW_DRAG_MIN_PX) return
      const from = draft ?? pointAt(press.at, tool === 'trend')
      const to = pointAt(at, tool === 'trend')
      if (from && to) finish(from, to)
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

  // Popover anchor: the selected drawing's y (clamped inside the pane).
  let popY: number | null = null
  if (selected && draggingId !== selected.id) {
    const y =
      selected.kind === 'h' || selected.kind === 'note'
        ? geom.priceToY(selected.price)
        : selected.kind === 'zone'
          ? geom.priceToY(Math.max(selected.p1, selected.p2))
          : geom.priceToY(Math.max(selected.p1, selected.p2))
    if (y !== null) popY = clamp(y, 8, Math.max(8, height - 8))
  }
  const offers = selected ? offersFor(selected) : []
  // Below the line when there is room under it, above it otherwise — and
  // never taller than the space it has (the canvas clips; a popover whose
  // head is cut off can't be closed or labelled).
  const popStyle: CSSProperties | null =
    popY === null
      ? null
      : popY > height * 0.55
        ? { left: 12, top: 8, maxHeight: Math.max(120, popY - 18) }
        : { left: 12, top: popY + 10, maxHeight: Math.max(120, height - popY - 18) }

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
            return (
              <g key={l.id} className={`mkt-draw__trend${sel ? ' is-selected' : ''}`}>
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

        {/* The armed tool takes the plot: one surface, every pointer. */}
        {tool !== 'none' && !readOnly && <rect className="mkt-draw__capture" x={0} y={0} width={plotW} height={height} {...capture} />}

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
          if (draft.tool === 'trend') {
            const x1 = geom.timeToX(draft.t)
            if (x1 === null) return null
            const to = pointAt(cursor, true)
            const x2 = to ? (geom.timeToX(to.t) ?? cursor.x) : cursor.x
            const y2 = to ? (geom.priceToY(to.price) ?? cursor.y) : cursor.y
            return (
              <g>
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
          return null
        })()}
      </svg>

      {selected && popStyle && (
        <div ref={popRef} className="mkt-pop" style={popStyle} role="dialog" aria-label="Level actions">
          <div className="mkt-pop__head">
            <span className="mono mkt-pop__kind">
              {selected.kind === 'h' ? `level · $${fmtPrice(selected.price)}` : selected.kind === 'zone' ? `zone · $${fmtPrice(Math.min(selected.p1, selected.p2))}–$${fmtPrice(Math.max(selected.p1, selected.p2))}` : selected.kind === 'trend' ? 'trend line' : 'note'}
            </span>
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
          {!readOnly && (
            <button type="button" className="mkt-pop__del" onClick={() => remove(selected.id)}>
              <Trash2 className="h-3 w-3" /> Remove
            </button>
          )}
        </div>
      )}
    </>
  )
}
