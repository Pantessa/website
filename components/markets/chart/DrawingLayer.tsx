'use client'

// The drawings over the candles — horizontal levels, zones, trend lines,
// notes — rendered as an SVG layer in the chart's own pixel space so a
// level can wear a chip. lightweight-charts owns the bars, axes, crosshair
// and (for h lines) the axis price tag; this layer owns the hit targets,
// the labels, and the popover that turns a level into an ask. Everything
// here is pointer-events:none except the handles, so pan/zoom on the bars
// keeps working under the drawings.
//
// The popover's chips follow the chip-send contract: a click SENDS the ask
// through `onAct` (ChartOverlay's send path). When the host has no send
// path (the standalone /t page) it passes `askHref` and the chip becomes a
// prefill link instead — a URL never fires a turn.

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Trash2, X } from 'lucide-react'
import type { ChartLine } from '@/lib/chart-state'
import type { LineActionOffer } from '@/lib/chart-actions'
import { fmtPrice } from '@/components/CandleChart'

/** Pixel geometry the chart exposes for one render tick. `plotRight` is
 *  where the price axis begins (the pane width). Null coordinates mean
 *  "not representable" (price scale not ready) — the layer draws nothing. */
export interface ChartGeom {
  width: number
  height: number
  plotRight: number
  priceToY: (price: number) => number | null
  timeToX: (t: number) => number | null
}

export type DrawTool = 'none' | 'h' | 'zone' | 'trend' | 'note'

export interface DrawingLayerProps {
  geom: ChartGeom | null
  lines: ChartLine[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  onChange: (lines: ChartLine[]) => void
  /** Offers for a selected level/zone — composed by the host from the live
   *  last price (lib/chart-actions). */
  offersFor: (line: ChartLine) => LineActionOffer[]
  /** Why a level has fewer offers than a trader expects (named, or null). */
  missingNote: string | null
  onAct?: (ask: string) => void
  askHref?: (ask: string) => string
  readOnly?: boolean
  /** A zone/trend in progress: the first click, waiting for the second. */
  pending?: { tool: DrawTool; price: number; t: number } | null
  /** Live crosshair position for the in-progress preview. */
  hover?: { x: number; y: number; price: number | null; t: number | null } | null
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

export default function DrawingLayer({ geom, lines, selectedId, onSelect, onChange, offersFor, missingNote, onAct, askHref, readOnly, pending, hover }: DrawingLayerProps) {
  const selected = useMemo(() => lines.find((l) => l.id === selectedId) ?? null, [lines, selectedId])
  const [labelDraft, setLabelDraft] = useState('')
  const popRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!selected) return
    setLabelDraft(selected.kind === 'note' ? selected.text : (selected.label ?? ''))
  }, [selected])

  // Click outside the popover closes it (Esc is handled by the host).
  useEffect(() => {
    if (!selected) return
    const onDown = (e: MouseEvent) => {
      const el = popRef.current
      if (el && !el.contains(e.target as Node) && !(e.target as HTMLElement).closest?.('[data-draw-handle]')) onSelect(null)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [selected, onSelect])

  if (!geom || geom.width <= 0 || geom.height <= 0) return null
  const { width, height, plotRight } = geom
  const plotW = Math.max(0, plotRight)

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
      if (v) update(line.id, { text: v } as Partial<ChartLine>)
    } else {
      update(line.id, { label: v || undefined } as Partial<ChartLine>)
    }
  }

  // Popover anchor: the selected drawing's y (clamped inside the pane).
  let popY: number | null = null
  if (selected) {
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
      <svg className="mkt-draw" width={width} height={height} aria-hidden={lines.length === 0 && !pending}>
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
              <rect
                data-draw-handle
                x={0}
                y={top}
                width={plotW}
                height={h}
                className="mkt-draw__hit"
                onMouseDown={(e) => {
                  e.stopPropagation()
                  if (!readOnly) onSelect(l.id)
                }}
              />
              <text x={8} y={clamp(top + 12, 12, height - 4)} className="mkt-draw__label">
                {(l.label ?? 'zone') + (l.action ? ` · ${l.action.kind}` : '')} {fmtPrice(Math.min(l.p1, l.p2))}–{fmtPrice(Math.max(l.p1, l.p2))}
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
                <line
                  data-draw-handle
                  x1={0}
                  x2={plotW}
                  y1={y}
                  y2={y}
                  className="mkt-draw__hit"
                  onMouseDown={(e) => {
                    e.stopPropagation()
                    if (!readOnly) onSelect(l.id)
                  }}
                />
                <g transform={`translate(8, ${clamp(y - 9, 2, height - 20)})`} className="mkt-draw__pill" data-draw-handle onMouseDown={(e) => { e.stopPropagation(); if (!readOnly) onSelect(l.id) }}>
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
                <line
                  data-draw-handle
                  x1={x1}
                  x2={x2}
                  y1={y1}
                  y2={y2}
                  className="mkt-draw__hit"
                  onMouseDown={(e) => {
                    e.stopPropagation()
                    if (!readOnly) onSelect(l.id)
                  }}
                />
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
                <circle
                  data-draw-handle
                  cx={cx}
                  cy={y}
                  r={11}
                  className="mkt-draw__hit"
                  onMouseDown={(e) => {
                    e.stopPropagation()
                    if (!readOnly) onSelect(l.id)
                  }}
                />
                <text x={clamp(cx + 8, 8, plotW - 8)} y={clamp(y - 8, 12, height - 4)} className="mkt-draw__label mkt-draw__label--note">
                  {l.text.length > 42 ? `${l.text.slice(0, 41)}…` : l.text}
                </text>
              </g>
            )
          }
          return null
        })}

        {/* in-progress preview: first click placed, second follows the cursor */}
        {pending && hover && hover.price !== null && (() => {
          const y1 = geom.priceToY(pending.price)
          if (y1 === null) return null
          if (pending.tool === 'zone') {
            const top = Math.min(y1, hover.y)
            return <rect className="mkt-draw__preview" x={0} y={top} width={plotW} height={Math.max(1, Math.abs(hover.y - y1))} />
          }
          if (pending.tool === 'trend') {
            const x1 = geom.timeToX(pending.t)
            if (x1 === null) return null
            return <line className="mkt-draw__preview" x1={x1} y1={y1} x2={hover.x} y2={hover.y} />
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
