'use client'

// TheWall — every dollar standing between the price and anywhere it might go,
// stacked at its price on the candle chart's right margin (Nate picked it
// 2026-10-06 over the tilted table: "every pixel a number", on the price axis
// the candles already have). Each rung (lib/wall) is a 1.5% band that keeps
// its kinds apart, and the ink keeps them apart too:
//   solid     resting orders on Coinbase (bright) and Hyperliquid (dimmer) — MEASURED, live
//   hatched   the liquidation map's clusters — ESTIMATED, says "est." everywhere it speaks
//   grey      what the bars on screen traded at that price — DERIVED from the tape, its own scale
//
// The ladder is a PANEL docked to the price, one fixed-height row per rung:
// on a chart whose axis spans a 10× year a 1.5% band is four pixels tall, so
// drawing the rungs at the chart's own scale made them a sliver. A bracket on
// the chart's edge shows the band's true extent, and the price line runs
// into the panel at the boundary between the first rung over and under it.
//
// A bar whose range reached an estimated cluster wears a burst at the price
// that went: the history of the walls that fell, on the time axis. Only the
// biggest on screen are drawn — the model's 50× tier is set off by almost
// every bar, and a burst on every bar is noise. When the live price trades
// through a rung it flares and fades.
//
// A pointer-transparent canvas over the plot, positioned with the chart's own
// geometry (DrawingLayer's ChartGeom). The chart widens its right margin
// while the panel draws (MarketChart reads `onStatus`); the hover is read off
// the plot's own pointer events, so the chart keeps every gesture.

import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { Candle, ChartPair, ChartTf } from '@/lib/charts'
import { fieldDate } from '@/lib/battlefield'
import { fmtUsdShort, liquidationMap, type BookBody, type DerivsBody } from '@/lib/derivs'
import { marginBarsFor, wallHits, wallRungs, wallWidthPx, WALL_PX_NARROW, WALL_RANGE_PCT, WALL_RANGE_PCT_NARROW, type Wall, type WallHit, type WallRung } from '@/lib/wall'
import { fmtPrice } from '@/components/CandleChart'
import type { Tokens } from './chart-tokens'
import type { ChartGeom } from './DrawingLayer'
import './battlefield.css'

export { marginBarsFor }

const FONT = "'Geist Mono', ui-monospace, SFMono-Regular, Menlo, monospace"
const FLARE_MS = 1_600
/** The plot's bottom strip the panel keeps clear (the time axis). */
const AXIS_H = 28
const TOP = 18
/** A rung's row in the panel, wide and narrow. */
const ROW_H = 11
const ROW_H_NARROW = 7
/** Bursts drawn: the biggest hits on screen, and only those at least this share of the biggest. */
const HITS_SHOWN = 10
const HIT_FLOOR = 0.1

export interface WallStatus {
  /** Anything drawn at all. */
  active: boolean
  /** The margin the panel wants, in pixels (0 when nothing draws). */
  px: number
  sources: { spot: boolean; perp: boolean; est: boolean }
}

export interface TheWallProps {
  geom: ChartGeom | null
  bars: Candle[]
  symbol: string
  pair: ChartPair
  tf: ChartTf
  tokens: Tokens
  last: number | null
  /** The plot wrapper the geometry measures: the hover is read off its pointer events. */
  hostRef: RefObject<HTMLDivElement | null>
  onStatus?: (s: WallStatus) => void
}

type Hover = { kind: 'rung'; rung: WallRung; x: number; y: number } | { kind: 'hit'; hit: WallHit; x: number; y: number }

interface Layout {
  x0: number
  x1: number
  segX0: number
  segMax: number
  isNarrow: boolean
  rowH: number
  /** The panel's top edge and the row count. */
  top: number
  rows: number
  /** y of the boundary between the first rung over and under the price. */
  lineY: number
  /** The band's true extent on the chart (for the bracket), top and bottom y. */
  bandTop: number
  bandBottom: number
  lastX: number
  barW: number
  bottom: number
}

const rgb = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]
const rgba = (hex: string, a: number): string => `rgba(${rgb(hex).join(',')},${a})`

/** A 45° hatch in `ink` for the estimated segments. */
function hatch(ink: string): CanvasPattern | null {
  const off = document.createElement('canvas')
  off.width = 6
  off.height = 6
  const c = off.getContext('2d')
  if (!c) return null
  c.fillStyle = rgba(ink, 0.1)
  c.fillRect(0, 0, 6, 6)
  c.strokeStyle = rgba(ink, 0.8)
  c.lineWidth = 1.6
  c.beginPath()
  c.moveTo(-1, 7)
  c.lineTo(7, -1)
  c.moveTo(-1, 1)
  c.lineTo(1, -1)
  c.moveTo(5, 7)
  c.lineTo(7, 5)
  c.stroke()
  return c.createPattern(off, 'repeat')
}

/** The row a rung sits on, top first: the highest band is row 0. */
const rowOf = (k: number, perSide: number) => perSide - 1 - k

export default function TheWall({ geom, bars, symbol, pair, tf, tokens, last, hostRef, onStatus }: TheWallProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [derivs, setDerivs] = useState<DerivsBody | null>(null)
  const [perp, setPerp] = useState<BookBody | null>(null)
  const [spot, setSpot] = useState<BookBody | null>(null)
  const [hover, setHover] = useState<Hover | null>(null)
  const noMarket = pair.source === 'robinhood'

  // ── Reads: positioning on the chart's frame, the two books ──
  useEffect(() => {
    setDerivs(null)
    if (noMarket) return
    let alive = true
    const load = async () => {
      try {
        const res = await fetch(`/api/markets/derivs?symbol=${encodeURIComponent(symbol)}&tf=${tf}`, { cache: 'no-store' })
        const body = (await res.json()) as DerivsBody
        if (alive && res.ok && Array.isArray(body.oi)) setDerivs(body)
      } catch {
        /* no clusters this read */
      }
    }
    void load()
    const t = setInterval(() => void load(), 60_000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [symbol, tf, noMarket])
  useEffect(() => {
    setPerp(null)
    setSpot(null)
    if (noMarket) return
    let alive = true
    const read = async (path: string, set: (b: BookBody | null) => void) => {
      try {
        const res = await fetch(`${path}?symbol=${encodeURIComponent(symbol)}`, { cache: 'no-store' })
        const body = (await res.json()) as BookBody
        if (alive && res.ok && Array.isArray(body.bids)) set(body)
      } catch {
        /* that book is missing this read */
      }
    }
    void read('/api/markets/book', setPerp)
    void read('/api/markets/spot-book', setSpot)
    const a = setInterval(() => void read('/api/markets/book', setPerp), 10_000)
    const b = setInterval(() => void read('/api/markets/spot-book', setSpot), 15_000)
    return () => {
      alive = false
      clearInterval(a)
      clearInterval(b)
    }
  }, [symbol, noMarket])

  // ── The model: the map over the held bars, the rungs around the price ──
  const map = useMemo(() => (derivs && derivs.oi.length > 1 && bars.length > 1 ? liquidationMap(bars, derivs.oi, derivs.oiUnit) : { alive: [], hits: [] }), [derivs, bars])
  const allHits = useMemo(() => wallHits(map.hits), [map])
  // The bars on screen, for the traded underlay and the bursts.
  const view = useMemo(() => {
    if (!geom || !bars.length) return null
    let from = -1
    let to = -1
    for (let i = 0; i < bars.length; i++) {
      const x = geom.timeToX(bars[i].t)
      if (x === null) continue
      if (x >= 0 && from < 0) from = i
      if (x <= geom.plotRight) to = i
    }
    return from < 0 || to < from ? null : { from, to }
  }, [geom, bars])
  const narrow = !!geom && geom.plotRight < 640
  const wall = useMemo<Wall>(
    () =>
      last
        ? wallRungs({ last, spot, perp, levels: map.alive, bars, from: view?.from, to: view?.to, rangePct: narrow ? WALL_RANGE_PCT_NARROW : WALL_RANGE_PCT })
        : { rungs: [], step: 0, perSide: 0, max: 0, tradedMax: 0 },
    [last, spot, perp, map, bars, view, narrow],
  )
  // The bursts worth drawing: the biggest hits whose bar is on screen.
  const shownHits = useMemo(() => {
    if (!view) return []
    const onScreen = allHits.hits.filter((h) => h.at >= view.from && h.at <= view.to)
    const top = onScreen[0]?.usd ?? 0
    return onScreen.filter((h) => h.usd >= top * HIT_FLOOR).slice(0, HITS_SHOWN)
  }, [allHits, view])
  const sources = useMemo(
    () => ({
      spot: !!spot && spot.bids.length + spot.asks.length > 0,
      perp: !!perp && perp.bids.length + perp.asks.length > 0,
      est: map.alive.length > 0,
    }),
    [spot, perp, map],
  )
  const active = !noMarket && (wall.max > 0 || shownHits.length > 0)
  const px = wallWidthPx(geom?.plotRight ?? 0, active)
  useEffect(() => onStatus?.({ active, px, sources }), [active, px, sources, onStatus])

  // ── Layout: the panel docked to the price, right of the last candle ──
  const lay = useMemo<Layout | null>(() => {
    if (!geom || !bars.length || !last || !px || !wall.rungs.length) return null
    const lastX = geom.timeToX(bars[bars.length - 1].t)
    if (lastX === null) return null
    const prevX = bars.length > 1 ? geom.timeToX(bars[bars.length - 2].t) : null
    const barW = prevX === null ? 8 : Math.abs(lastX - prevX)
    const isNarrow = px <= WALL_PX_NARROW
    // The chart's "+" (put an order here) rides the price axis's inner edge: the ladder leaves it a column.
    const x1 = geom.plotRight - (isNarrow ? 4 : 30)
    const x0 = Math.max(lastX + barW / 2 + 10, x1 - px + (isNarrow ? 0 : 26))
    if (x1 - x0 < 40) return null
    const bottom = geom.height - AXIS_H
    const rows = wall.rungs.length
    const rowH = Math.max(4, Math.min(isNarrow ? ROW_H_NARROW : ROW_H, Math.floor((bottom - TOP) / rows)))
    const panelH = rows * rowH
    const yl = geom.priceToY(last)
    if (yl === null) return null
    // The boundary row sits at the price line when it can; the panel stays on the plot.
    const top = Math.max(TOP, Math.min(bottom - panelH, yl - wall.perSide * rowH))
    const labelW = isNarrow ? 0 : 40
    const segX0 = x0 + labelW
    const rangePct = (wall.perSide * wall.step) / last
    const bandTop = geom.priceToY(last * (1 + rangePct)) ?? top
    const bandBottom = geom.priceToY(last * (1 - rangePct)) ?? top + panelH
    return { x0, x1, segX0, segMax: Math.max(8, x1 - segX0 - 2), isNarrow, rowH, top, rows, lineY: top + wall.perSide * rowH, bandTop, bandBottom, lastX, barW, bottom }
  }, [geom, bars, last, px, wall])

  // Everything the pointer listener needs, without re-binding.
  const stateRef = useRef({ lay, wall, shownHits, bars, geom })
  stateRef.current = { lay, wall, shownHits, bars, geom }

  // ── Hover: read off the plot's own pointer events (the canvas is transparent) ──
  useEffect(() => {
    const host = hostRef.current
    if (!host || !active) return
    let lastKey = ''
    const onMove = (e: PointerEvent) => {
      const { lay, wall, shownHits, bars, geom } = stateRef.current
      if (!lay || !geom) return
      const box = host.getBoundingClientRect()
      const x = e.clientX - box.left
      const y = e.clientY - box.top
      let next: Hover | null = null
      if (x >= lay.x0 && x <= lay.x1 && y >= lay.top && y < lay.top + lay.rows * lay.rowH) {
        const row = Math.floor((y - lay.top) / lay.rowH)
        const k = wall.perSide - 1 - row
        const rung = wall.rungs.find((r) => r.k === k)
        if (rung) next = { kind: 'rung', rung, x, y }
      } else if (x < lay.x0) {
        // A burst under the cursor: the nearest drawn hit within 10px.
        let best: { hit: WallHit; d: number } | null = null
        for (const h of shownHits) {
          const bar = bars[h.at]
          if (!bar) continue
          const hx = geom.timeToX(bar.t)
          const hy = geom.priceToY(h.price)
          if (hx === null || hy === null) continue
          const d = Math.hypot(hx - x, hy - y)
          if (d <= 10 && (!best || d < best.d)) best = { hit: h, d }
        }
        if (best) next = { kind: 'hit', hit: best.hit, x, y }
      }
      const key = next ? (next.kind === 'rung' ? `r${next.rung.k}` : `h${next.hit.at}:${next.hit.side}`) : ''
      if (key === lastKey) return
      lastKey = key
      setHover(next)
    }
    const onLeave = () => {
      lastKey = ''
      setHover(null)
    }
    host.addEventListener('pointermove', onMove, { passive: true })
    host.addEventListener('pointerleave', onLeave)
    return () => {
      host.removeEventListener('pointermove', onMove)
      host.removeEventListener('pointerleave', onLeave)
    }
  }, [hostRef, active])

  // ── Flares: a rung whose estimated cluster is gone while price moved through it ──
  const seenRef = useRef<Map<number, number>>(new Map())
  const flaresRef = useRef<{ k: number; side: 'long' | 'short'; usd: number; at: number }[]>([])
  const lastPriceRef = useRef<number | null>(null)
  useEffect(() => {
    const now = performance.now()
    const next = new Map(wall.rungs.map((r) => [r.k, r.liqUsd]))
    const prev = lastPriceRef.current
    if (prev !== null && last !== null && wall.step > 0) {
      for (const [k, usd] of seenRef.current) {
        if (!(usd > 0) || (next.get(k) ?? 0) > usd * 0.1) continue
        const lo = last + k * wall.step
        const hi = lo + wall.step
        const crossed = Math.min(prev, last) <= hi && Math.max(prev, last) >= lo
        if (crossed) flaresRef.current.push({ k, side: k < 0 ? 'long' : 'short', usd, at: now })
      }
    }
    seenRef.current = next
    lastPriceRef.current = last
  }, [wall, last])

  // ── Paint ──
  const patterns = useMemo(() => ({ up: hatch(tokens.up), down: hatch(tokens.down) }), [tokens])
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !geom) return
    let raf = 0
    const draw = () => {
      const now = performance.now()
      flaresRef.current = flaresRef.current.filter((f) => now - f.at < FLARE_MS)
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      if (canvas.width !== Math.round(geom.width * dpr) || canvas.height !== Math.round(geom.height * dpr)) {
        canvas.width = Math.round(geom.width * dpr)
        canvas.height = Math.round(geom.height * dpr)
      }
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, geom.width, geom.height)
      if (!lay || !last || !active) return
      const text = (s: string, x: number, y: number, color: string, align: CanvasTextAlign = 'right', size = 9) => {
        ctx.font = `${size}px ${FONT}`
        ctx.textAlign = align
        ctx.textBaseline = 'middle'
        const w = ctx.measureText(s).width
        const xs = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x
        ctx.fillStyle = rgba(tokens.bg, 0.82)
        ctx.fillRect(xs - 3, y - 6.5, w + 6, 13)
        ctx.fillStyle = color
        ctx.fillText(s, x, y)
      }
      const inkOf = (side: 'below' | 'above') => (side === 'below' ? tokens.up : tokens.down)
      const rowY = (k: number) => lay.top + rowOf(k, wall.perSide) * lay.rowH
      const panelBottom = lay.top + lay.rows * lay.rowH

      // The panel's ground and the bracket on the chart's edge: the band's true extent.
      ctx.fillStyle = rgba(tokens.bg, 0.72)
      ctx.fillRect(lay.x0 - 2, lay.top - 1, lay.x1 - lay.x0 + 4, lay.rows * lay.rowH + 2)
      const bx = lay.x0 - 6
      ctx.strokeStyle = rgba(tokens.muted2, 0.6)
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(bx - 3, lay.bandTop)
      ctx.lineTo(bx, lay.bandTop)
      ctx.lineTo(bx, lay.bandBottom)
      ctx.lineTo(bx - 3, lay.bandBottom)
      ctx.stroke()
      ctx.setLineDash([2, 3])
      ctx.strokeStyle = rgba(tokens.muted2, 0.35)
      ctx.beginPath()
      ctx.moveTo(bx, lay.bandTop)
      ctx.lineTo(lay.x0 - 1, lay.top)
      ctx.moveTo(bx, lay.bandBottom)
      ctx.lineTo(lay.x0 - 1, panelBottom)
      ctx.stroke()
      ctx.setLineDash([])
      // The price line runs into the panel at the boundary row.
      ctx.setLineDash([3, 3])
      ctx.strokeStyle = rgba(tokens.fg, 0.7)
      ctx.beginPath()
      ctx.moveTo(lay.x0, lay.lineY + 0.5)
      ctx.lineTo(lay.x1, lay.lineY + 0.5)
      ctx.stroke()
      ctx.setLineDash([])
      if (!lay.isNarrow && lay.top - TOP >= 12) text(`THE WALL · ±${Math.round((wall.perSide * wall.step * 100) / last)}% in ${wall.step > 0 ? ((wall.step / last) * 100).toFixed(1) : '1.5'}% rungs`, lay.x0, lay.top - 8, tokens.muted2, 'left', 8.5)

      // The two biggest standing rungs a side carry their dollars.
      const labelled = new Set<number>()
      for (const side of ['below', 'above'] as const) {
        wall.rungs
          .filter((r) => r.side === side && r.usd > 0)
          .sort((a, b) => b.usd - a.usd)
          .slice(0, 2)
          .forEach((r) => labelled.add(r.k))
      }

      for (const r of wall.rungs) {
        const yTop = rowY(r.k)
        const y = yTop + lay.rowH / 2
        const h = Math.max(2, lay.rowH - 3)
        const ink = inkOf(r.side)
        // Price labels: every other rung, so they never crowd.
        if (!lay.isNarrow && r.k % 2 === 0 && lay.rowH >= 9) text(`$${fmtPrice(r.price)}`, lay.segX0 - 6, y, tokens.muted2, 'right', 8.5)
        // The traded underlay: its own scale, the full row, faint.
        if (r.tradedUsd > 0 && wall.tradedMax > 0) {
          const w = lay.segMax * (r.tradedUsd / wall.tradedMax)
          ctx.fillStyle = rgba(tokens.muted2, 0.16)
          ctx.fillRect(lay.segX0, yTop + 1, w, lay.rowH - 2)
        }
        // The standing segments, measured first, then the estimate.
        let x = lay.segX0
        const seg = (usd: number, style: string | CanvasPattern | null) => {
          if (!(usd > 0) || wall.max <= 0 || !style) return
          const w = Math.max(1.5, lay.segMax * (usd / wall.max))
          ctx.fillStyle = style
          ctx.fillRect(x, y - h / 2, w, h)
          x += w + 2
        }
        seg(r.spotUsd, rgba(ink, 0.92))
        seg(r.perpUsd, rgba(ink, 0.55))
        seg(r.liqUsd, r.side === 'below' ? patterns.up : patterns.down)
        if (labelled.has(r.k) && !lay.isNarrow) {
          const s = fmtUsdShort(r.usd)
          const room = lay.x1 - x
          if (room >= 36) text(s, x + 4, y, ink, 'left', 8.5)
          else text(s, lay.x1 - 2, y, tokens.fg, 'right', 8.5)
        }
      }

      // The hovered rung's row.
      if (hover?.kind === 'rung') {
        ctx.strokeStyle = rgba(tokens.fg, 0.9)
        ctx.lineWidth = 1
        ctx.strokeRect(lay.x0 + 0.5, rowY(hover.rung.k) + 0.5, lay.x1 - lay.x0 - 1, lay.rowH - 1)
      }

      // Bursts: the bars whose range reached an estimated cluster (the biggest on screen).
      const hitMax = shownHits[0]?.usd ?? 0
      for (const hit of shownHits) {
        const bar = bars[hit.at]
        if (!bar || hitMax <= 0) continue
        const hx = geom.timeToX(bar.t)
        const hy = geom.priceToY(hit.price)
        if (hx === null || hy === null || hx < 0 || hx > lay.lastX + lay.barW || hy < TOP || hy > lay.bottom) continue
        const ink = hit.side === 'long' ? tokens.up : tokens.down
        const r = 4 + 8 * Math.sqrt(hit.usd / hitMax)
        ctx.strokeStyle = rgba(ink, 0.9)
        ctx.lineWidth = 1.2
        ctx.beginPath()
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2 + Math.PI / 8
          ctx.moveTo(hx + Math.cos(a) * r * 0.5, hy + Math.sin(a) * r * 0.5)
          ctx.lineTo(hx + Math.cos(a) * r, hy + Math.sin(a) * r)
        }
        ctx.stroke()
        ctx.beginPath()
        ctx.arc(hx, hy, Math.max(2, r * 0.42), 0, Math.PI * 2)
        const pat = hit.side === 'long' ? patterns.up : patterns.down
        ctx.fillStyle = pat ?? rgba(ink, 0.4)
        ctx.fill()
        ctx.strokeStyle = rgba(tokens.bg, 0.9)
        ctx.lineWidth = 1
        ctx.stroke()
        if (hit === shownHits[0] && !lay.isNarrow) text(`~${fmtUsdShort(hit.usd)} ${hit.side}s set off · est.`, hx, hy - r - 8, tokens.fg, 'center', 8.5)
      }

      // Flares: a rung set off live, fading.
      for (const f of flaresRef.current) {
        const y = rowY(f.k) + lay.rowH / 2
        const k = (now - f.at) / FLARE_MS
        const r = 6 + 26 * k
        const ink = f.side === 'long' ? tokens.up : tokens.down
        ctx.beginPath()
        ctx.arc(lay.x0 + 10, y, r, 0, Math.PI * 2)
        ctx.strokeStyle = rgba(ink, 0.9 * (1 - k))
        ctx.lineWidth = 2
        ctx.stroke()
        ctx.fillStyle = `rgba(255, 206, 120, ${0.6 * (1 - k)})`
        ctx.fill()
        if (k < 0.7) text(`~${fmtUsdShort(f.usd)} ${f.side}s set off (est.)`, lay.x0 - 8, y, tokens.fg, 'right', 9)
      }
      if (flaresRef.current.length) raf = requestAnimationFrame(draw)
    }
    draw()
    return () => cancelAnimationFrame(raf)
  }, [geom, bars, wall, shownHits, lay, active, last, tokens, patterns, hover])

  if (noMarket || !geom) return null
  const tip = hover && lay && last ? tipFor(hover, last, bars, tf) : null
  const tipLeft = lay && hover ? Math.max(8, Math.min(geom.width - 272, (hover.kind === 'rung' ? lay.x0 : hover.x) - 276)) : 0
  const tipTop = hover ? Math.max(6, Math.min(geom.height - 120, hover.y - 48)) : 0
  return (
    <div className="wall" aria-hidden="true">
      <canvas ref={canvasRef} className="wall__canvas" style={{ width: geom.width, height: geom.height }} />
      {tip && (
        <div className={`bf__tip wall__tip bf__tip--${tip.bulls ? 'bulls' : 'bears'}`} style={{ left: tipLeft, top: tipTop }}>
          <span className="bf__tip-k mono">{tip.k}</span>
          <strong>{tip.head}</strong>
          {tip.lines.map((l) => (
            <span key={l}>{l}</span>
          ))}
        </div>
      )}
    </div>
  )
}

/** The hover's words: a rung's breakdown by kind, or a burst's day. */
function tipFor(h: Hover, last: number, bars: Candle[], tf: ChartTf): { k: string; head: string; lines: string[]; bulls: boolean } {
  if (h.kind === 'hit') {
    const bar = bars[h.hit.at]
    const d = bar ? fieldDate(bar.t, tf) : null
    return {
      k: d ? `${d.month} ${d.day}, ${d.year} · estimated` : 'estimated',
      head: `~${fmtUsdShort(h.hit.usd)} of ${h.hit.side}s set off`,
      lines: [`${h.hit.count} cluster${h.hit.count === 1 ? '' : 's'} near $${fmtPrice(h.hit.price)} · the bar's range reached them`],
      bulls: h.hit.side === 'short',
    }
  }
  const r = h.rung
  const below = r.side === 'below'
  const pct = Math.abs(r.price / last - 1) * 100
  const lines: string[] = []
  if (r.spotUsd > 0) lines.push(`Coinbase ${below ? 'bids' : 'asks'} ${fmtUsdShort(r.spotUsd)} · resting now`)
  if (r.perpUsd > 0) lines.push(`Hyperliquid ${below ? 'bids' : 'asks'} ${fmtUsdShort(r.perpUsd)} · resting now`)
  if (r.liqUsd > 0) lines.push(`${below ? 'long' : 'short'} liquidations ~${fmtUsdShort(r.liqUsd)} · est.`)
  if (r.tradedUsd > 0) lines.push(`traded here ${fmtUsdShort(r.tradedUsd)} · the bars on screen`)
  if (!lines.length) lines.push('Nothing standing in this band')
  return {
    k: `$${fmtPrice(r.lo)} – $${fmtPrice(r.hi)} · ${pct.toFixed(1)}% ${below ? 'below' : 'above'}`,
    head: r.usd > 0 ? `${fmtUsdShort(r.usd)} standing${r.liqUsd > 0 ? ' (incl. est.)' : ''}` : 'Open ground',
    lines,
    bulls: below,
  }
}
