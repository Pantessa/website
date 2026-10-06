// The three projections of the battle scene (2026-10-06). No React, no DOM
// beyond the canvas context handed in. components/live/Battle.tsx builds
// the scene from its refs once a frame and calls one of these.
//
//   drawFront — time → x, percent → y; one field for every army.
//   drawMap   — a band per army as wide as its open-interest share; inside
//               the band, time → x and percent → y (its elevation profile).
//   drawSiege — a polar arena; a sector per army, time → angle across the
//               sector, percent → radius (the most ground nearest the hill).
//
// Shared: the glyph ranks (▲ bought / ▼ sold per unit), the bursts (fills
// of four units or more, at the moment they hit), the flags, the tracers
// (every fill as it lands), the hover readout.

import {
  anchorFor,
  armyLabel,
  burstsOf,
  fieldUnit,
  fitRange,
  fmtPct,
  glyphsFor,
  mapBands,
  MAP_MIN_BAND_SHARE,
  spreadFlags,
  oiUsd,
  pctTicks,
  siegeAngle,
  siegeRadius,
  siegeSectors,
  strengthOf,
  trackOf,
  windowMinutes,
  type Anchor,
  type ArmyContext,
  type BattleView,
  type Burst,
  type FrontWindow,
  type PctRange,
  type PricePoint,
  type Strength,
  type TrackPoint,
} from '@/lib/battle'
import { fmtPrice, fmtUsd, type TapeFill, type TapeSide } from '@/lib/tape'

export const PARTICLE_MS = 900
export const FLASH_MS = 2500

export interface Particle {
  market: string
  side: TapeSide
  usd: number
  t0: number
  dx: number
  dy: number
}

export interface Inks {
  army: string[]
  up: string
  down: string
  grid: string
  horizon: string
  gain: string
  loss: string
  fg: string
  muted: string
  bg: string
  surface: string
  mono: string
  ui: string
}

export interface ArmyFrame {
  market: string
  slot: number
  anchor: Anchor | null
  track: TrackPoint[]
  pct: number | null
  last: number | null
  strength: Strength
  bursts: Burst[]
  oiUsd: number | null
}

export interface DrawInput {
  view: BattleView
  armies: string[]
  since: FrontWindow
  now: number
  openedAt: number
  samples: Map<string, PricePoint[]>
  fills: TapeFill[]
  contexts: Map<string, ArmyContext>
  particles: Particle[]
  range: PctRange
  hover: { x: number; y: number } | null
  inks: Inks
  reduced: boolean
  paused: boolean
}

export interface Scene {
  frames: ArmyFrame[]
  unit: number
  range: PctRange
  from: number
  to: number
}

/** Every army's frame, the shared unit, the eased range. The range object
 *  handed in is mutated: it eases toward the fit so a burst never snaps. */
export function buildScene(d: DrawInput): Scene {
  const minutes = windowMinutes(d.since)
  const from = minutes === null ? d.openedAt : d.now - minutes * 60_000
  const to = d.now
  const strengths: Strength[] = []
  const pre = d.armies.map((market, i) => {
    const samples = d.samples.get(market) ?? []
    const anchor = anchorFor(samples, d.since, d.now, d.openedAt)
    const track = anchor ? trackOf(samples, anchor) : []
    const strength = strengthOf(d.fills, market, d.now)
    strengths.push(strength)
    const c = d.contexts.get(market)
    return { market, slot: i, anchor, track, strength, oiUsd: c ? oiUsd(c) : null }
  })
  const unit = fieldUnit(strengths)
  const frames: ArmyFrame[] = pre.map((a) => {
    const bursts = a.anchor ? burstsOf(d.fills, a.market, unit, Math.max(from, a.anchor.t)) : []
    const lastPt = a.track[a.track.length - 1]
    return { ...a, bursts, pct: lastPt ? lastPt.pct : null, last: lastPt ? lastPt.p : null }
  })
  const pcts: number[] = []
  for (const a of frames) {
    for (const p of a.track) if (p.t >= from - 1000) pcts.push(p.pct)
    for (const b of a.bursts) if (a.anchor) pcts.push((b.price / a.anchor.p - 1) * 100)
  }
  const target = fitRange(pcts)
  d.range.lo += (target.lo - d.range.lo) * 0.12
  d.range.hi += (target.hi - d.range.hi) * 0.12
  return { frames, unit, range: d.range, from, to }
}

const PAD = { l: 56, r: 168, t: 26, b: 30 }

// ── The Front ────────────────────────────────────────────────────────────────

export function drawFront(ctx: CanvasRenderingContext2D, w: number, h: number, d: DrawInput, s: Scene): void {
  const { inks } = d
  const plotW = Math.max(10, w - PAD.l - PAD.r)
  const plotH = Math.max(10, h - PAD.t - PAD.b)
  const x = (t: number) => PAD.l + ((t - s.from) / Math.max(1, s.to - s.from)) * plotW
  const y = (pct: number) => PAD.t + ((s.range.hi - pct) / (s.range.hi - s.range.lo)) * plotH
  ctx.clearRect(0, 0, w, h)
  drawGround(ctx, inks, PAD.l, PAD.t, plotW, plotH, y)
  drawGrid(ctx, inks, s.range, PAD.l, plotW, y, PAD.l - 8)
  drawTimeTicks(ctx, inks, s.from, s.to, PAD.l, plotW, h - 10)
  const order = [...s.frames].sort((a, b) => (a.pct ?? -Infinity) - (b.pct ?? -Infinity))
  const fronts = new Map<string, Front>()
  const drawn: { a: ArmyFrame; ink: string; fx: number; fy: number }[] = []
  for (const a of order) {
    if (!a.anchor || a.track.length === 0) continue
    const ink = inks.army[a.slot] ?? inks.army[0]
    const pts = a.track.filter((p) => p.t >= s.from - 1000)
    if (pts.length === 0) continue
    drawTrack(ctx, ink, pts.map((p) => [x(p.t), y(p.pct)] as const), y(0))
    drawBursts(ctx, d, a, s, (b) => [x(b.t), y((b.price / a.anchor!.p - 1) * 100)])
    const lastPt = pts[pts.length - 1]
    const fx = x(lastPt.t)
    const fy = y(lastPt.pct)
    drawRanks(ctx, inks, ink, a, s.unit, fx - 10, fy, { x: 0, y: -1 })
    dot(ctx, ink, fx, fy, 3.5)
    drawn.push({ a, ink, fx, fy })
    fronts.set(a.market, { x: PAD.l + plotW, y: fy, nx: 0, ny: -1, tx: 1, ty: 0 })
  }
  // Flags at the right edge, spread so close fronts never print over each other.
  const flagYs = spreadFlags(drawn.map((f) => f.fy), 30, PAD.t + 13, PAD.t + plotH - 13)
  drawn.forEach((f, i) => drawFlag(ctx, inks, f.ink, f.a, PAD.l + plotW + 8, flagYs[i], PAD.r - 12, PAD.t, PAD.t + plotH, f.fx, f.fy))
  drawTracers(ctx, d, fronts)
  if (d.hover && d.hover.x >= PAD.l && d.hover.x <= PAD.l + plotW) {
    const t = s.from + ((d.hover.x - PAD.l) / plotW) * (s.to - s.from)
    hoverAt(ctx, d, s, t, d.hover.y, (p) => [x(p.t), y(p.pct)], { x1: d.hover.x, y1: PAD.t, y2: PAD.t + plotH }, PAD.l, PAD.l + plotW, PAD.t)
  }
}

// ── The Map ──────────────────────────────────────────────────────────────────

const MAP_PAD = { l: 56, r: 24, t: 44, b: 30 }

export function drawMap(ctx: CanvasRenderingContext2D, w: number, h: number, d: DrawInput, s: Scene): void {
  const { inks } = d
  const plotW = Math.max(10, w - MAP_PAD.l - MAP_PAD.r)
  const plotH = Math.max(10, h - MAP_PAD.t - MAP_PAD.b)
  const y = (pct: number) => MAP_PAD.t + ((s.range.hi - pct) / (s.range.hi - s.range.lo)) * plotH
  const bands = mapBands(s.frames.map((a) => a.oiUsd), plotW, 10, Math.max(72, plotW * MAP_MIN_BAND_SHARE))
  ctx.clearRect(0, 0, w, h)
  drawGround(ctx, inks, MAP_PAD.l, MAP_PAD.t, plotW, plotH, y)
  drawGrid(ctx, inks, s.range, MAP_PAD.l, plotW, y, MAP_PAD.l - 8)
  const fronts = new Map<string, Front>()
  const totalOi = s.frames.reduce((sum, a) => sum + (a.oiUsd ?? 0), 0)
  s.frames.forEach((a, i) => {
    const band = bands[i]
    if (!band) return
    const bx = MAP_PAD.l + band.x
    const ink = inks.army[a.slot] ?? inks.army[0]
    // The band: its land, and its deed on top.
    ctx.globalAlpha = 0.05
    ctx.fillStyle = ink
    ctx.fillRect(bx, MAP_PAD.t, band.w, plotH)
    ctx.globalAlpha = 1
    ctx.strokeStyle = inks.grid
    ctx.lineWidth = 1
    ctx.strokeRect(bx + 0.5, MAP_PAD.t + 0.5, band.w - 1, plotH - 1)
    ctx.font = `600 12px ${inks.ui}`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = ink
    ctx.fillText(armyLabel(a.market), bx + 8, MAP_PAD.t - 24)
    ctx.font = `10px ${inks.mono}`
    ctx.fillStyle = inks.muted
    const deed = a.oiUsd === null ? 'open interest unread' : band.w >= 260 ? `${fmtUsd(a.oiUsd)} open interest · ${Math.round(band.share * 100)}% of the field` : `${fmtUsd(a.oiUsd)} OI · ${Math.round(band.share * 100)}%`
    ctx.fillText(fitText(ctx, deed, band.w - 16), bx + 8, MAP_PAD.t - 10)
    if (!a.anchor || a.track.length === 0) return
    const xb = (t: number) => bx + 6 + ((t - s.from) / Math.max(1, s.to - s.from)) * (band.w - 12)
    const pts = a.track.filter((p) => p.t >= s.from - 1000)
    if (pts.length === 0) return
    drawTrack(ctx, ink, pts.map((p) => [xb(p.t), y(p.pct)] as const), y(0))
    drawBursts(ctx, d, a, s, (b) => [xb(b.t), y((b.price / a.anchor!.p - 1) * 100)], band.w < 140)
    const lastPt = pts[pts.length - 1]
    const fx = xb(lastPt.t)
    const fy = y(lastPt.pct)
    drawRanks(ctx, inks, ink, a, s.unit, fx - 8, fy, { x: 0, y: -1 }, Math.max(4, Math.floor((band.w - 16) / 8)))
    dot(ctx, ink, fx, fy, 3.5)
    // The elevation sign: the percent on the terrain's top edge.
    ctx.font = `600 12px ${inks.mono}`
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    const sign = fmtPct(a.pct)
    const sw = ctx.measureText(sign).width + 12
    const sy = Math.min(Math.max(fy - 22, MAP_PAD.t + 4), MAP_PAD.t + plotH - 22)
    ctx.fillStyle = ink
    roundRect(ctx, bx + band.w - 6 - sw, sy, sw, 18, 4)
    ctx.fill()
    ctx.fillStyle = inks.bg
    ctx.fillText(sign, bx + band.w - 12, sy + 9)
    fronts.set(a.market, { x: fx, y: fy, nx: 0, ny: -1, tx: 1, ty: 0 })
  })
  if (totalOi > 0) {
    ctx.font = `10px ${inks.mono}`
    ctx.fillStyle = inks.muted
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    ctx.fillText(`land = open interest, ${fmtUsd(totalOi)} across the field · height = % move · profile = the window, ${clockOf(s.from)} → now`, MAP_PAD.l, h - 10)
  }
  drawTracers(ctx, d, fronts)
  if (d.hover) {
    const i = bands.findIndex((b) => d.hover!.x >= MAP_PAD.l + b.x && d.hover!.x <= MAP_PAD.l + b.x + b.w)
    const a = i >= 0 ? s.frames[i] : null
    if (a && a.track.length) {
      const band = bands[i]
      const bx = MAP_PAD.l + band.x
      const t = s.from + ((d.hover.x - bx - 6) / Math.max(1, band.w - 12)) * (s.to - s.from)
      hoverAt(ctx, d, { ...s, frames: [a] }, t, d.hover.y, (p) => [bx + 6 + ((p.t - s.from) / Math.max(1, s.to - s.from)) * (band.w - 12), y(p.pct)], { x1: d.hover.x, y1: MAP_PAD.t, y2: MAP_PAD.t + plotH }, MAP_PAD.l, MAP_PAD.l + plotW, MAP_PAD.t)
    }
  }
}

// ── The Siege ────────────────────────────────────────────────────────────────

export function drawSiege(ctx: CanvasRenderingContext2D, w: number, h: number, d: DrawInput, s: Scene): void {
  const { inks } = d
  const cx = w / 2
  const cy = h / 2 + 6
  const R = Math.max(40, Math.min(w, h) / 2 - 40)
  ctx.clearRect(0, 0, w, h)
  const sectors = siegeSectors(s.frames.length)
  const rr = (pct: number) => siegeRadius(pct, s.range, R)
  // Ground: the ring outside the horizon is lost ground, inside it gained.
  const r0 = rr(0)
  const gainGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r0)
  gainGrad.addColorStop(0, inks.gain)
  gainGrad.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = gainGrad
  ctx.beginPath()
  ctx.arc(cx, cy, r0, 0, Math.PI * 2)
  ctx.fill()
  const lossGrad = ctx.createRadialGradient(cx, cy, r0, cx, cy, R)
  lossGrad.addColorStop(0, 'rgba(0,0,0,0)')
  lossGrad.addColorStop(1, inks.loss)
  ctx.fillStyle = lossGrad
  ctx.beginPath()
  ctx.arc(cx, cy, R, 0, Math.PI * 2)
  ctx.arc(cx, cy, r0, 0, Math.PI * 2, true)
  ctx.fill()
  // Rings: the percent ticks, labelled up the twelve o'clock spoke, a
  // label skipped when it would sit on the last one.
  ctx.font = `10px ${inks.mono}`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  let lastLabelRad = -Infinity
  for (const t of pctTicks(s.range)) {
    const rad = rr(t)
    if (rad > R + 0.5) continue
    ctx.strokeStyle = t === 0 ? inks.horizon : inks.grid
    ctx.lineWidth = 1
    ctx.setLineDash(t === 0 ? [5, 4] : [])
    ctx.beginPath()
    ctx.arc(cx, cy, rad, 0, Math.PI * 2)
    ctx.stroke()
    ctx.setLineDash([])
    if (Math.abs(rad - lastLabelRad) < 14) continue
    lastLabelRad = rad
    ctx.fillStyle = inks.muted
    ctx.fillText(t === 0 ? '0' : fmtPct(t), cx + 5, cy - rad)
  }
  // Sector spokes.
  if (sectors.length > 1) {
    ctx.strokeStyle = inks.grid
    for (const sec of sectors) {
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.lineTo(cx + Math.cos(sec.start) * R, cy + Math.sin(sec.start) * R)
      ctx.stroke()
    }
  }
  const fronts = new Map<string, Front>()
  const order = [...s.frames].sort((a, b) => (a.pct ?? -Infinity) - (b.pct ?? -Infinity))
  for (const a of order) {
    const sec = sectors[s.frames.indexOf(a)] ?? sectors[0]
    const ink = inks.army[a.slot] ?? inks.army[0]
    // The camp: the army's name at the edge of its sector, kept on the canvas.
    const mid = (sec.start + sec.end) / 2
    ctx.font = `600 12px ${inks.ui}`
    const nameW = ctx.measureText(armyLabel(a.market)).width
    const campX = Math.min(Math.max(cx + Math.cos(mid) * (R + 16), 6 + nameW / 2), w - 6 - nameW / 2)
    const campY = Math.min(Math.max(cy + Math.sin(mid) * (R + 16), 12), h - 12)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = ink
    ctx.fillText(armyLabel(a.market), campX, campY)
    if (!a.anchor || a.track.length === 0) continue
    const pts = a.track.filter((p) => p.t >= s.from - 1000)
    if (pts.length === 0) continue
    const polar = (t: number, pct: number): readonly [number, number] => {
      const ang = siegeAngle(t, s.from, s.to, sec)
      const rad = rr(pct)
      return [cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad]
    }
    // Territory: between the camp arc (R) and the track, closed along the edge.
    const line = pts.map((p) => polar(p.t, p.pct))
    const a0 = siegeAngle(pts[0].t, s.from, s.to, sec)
    const a1 = siegeAngle(pts[pts.length - 1].t, s.from, s.to, sec)
    ctx.beginPath()
    ctx.moveTo(cx + Math.cos(a0) * R, cy + Math.sin(a0) * R)
    for (const [px, py] of line) ctx.lineTo(px, py)
    ctx.arc(cx, cy, R, a1, a0, true)
    ctx.closePath()
    ctx.globalAlpha = 0.11
    ctx.fillStyle = ink
    ctx.fill()
    ctx.globalAlpha = 1
    strokeLine(ctx, ink, line)
    drawBursts(ctx, d, a, s, (b) => polar(b.t, (b.price / a.anchor!.p - 1) * 100))
    const [fx, fy] = line[line.length - 1]
    // Forward is toward the hill; the ranks mass behind the wall (outward).
    const nx = (cx - fx) / Math.max(1, Math.hypot(cx - fx, cy - fy))
    const ny = (cy - fy) / Math.max(1, Math.hypot(cx - fx, cy - fy))
    drawRanks(ctx, inks, ink, a, s.unit, fx - 10, fy, { x: nx, y: ny })
    dot(ctx, ink, fx, fy, 3.5)
    // The flag: the percent beside the wall, kept inside the canvas.
    ctx.font = `600 12px ${inks.mono}`
    const sign = fmtPct(a.pct)
    const sw = ctx.measureText(sign).width + 12
    const flx = Math.min(Math.max(fx - nx * 26 - sw / 2, 4), w - sw - 4)
    const fly = Math.min(Math.max(fy - ny * 26 - 9, 4), h - 22)
    ctx.fillStyle = ink
    roundRect(ctx, flx, fly, sw, 18, 4)
    ctx.fill()
    ctx.fillStyle = inks.bg
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(sign, flx + sw / 2, fly + 9)
    fronts.set(a.market, { x: fx, y: fy, nx, ny, tx: -ny, ty: nx })
  }
  // The hill: who holds it, on a pill at the centre.
  const leader = [...s.frames].filter((a) => a.pct !== null).sort((a, b) => b.pct! - a.pct!)[0]
  const hillInk = leader ? inks.army[leader.slot] ?? inks.army[0] : inks.muted
  ctx.fillStyle = hillInk
  ctx.beginPath()
  ctx.arc(cx, cy, 6, 0, Math.PI * 2)
  ctx.fill()
  const hillText = leader ? `${armyLabel(leader.market)} holds the hill` : 'the hill'
  ctx.font = `600 11px ${inks.ui}`
  const hw = ctx.measureText(hillText).width + 16
  ctx.fillStyle = inks.surface
  ctx.globalAlpha = 0.9
  roundRect(ctx, cx - hw / 2, cy + 10, hw, 20, 6)
  ctx.fill()
  ctx.globalAlpha = 1
  ctx.strokeStyle = hillInk
  ctx.lineWidth = 1
  roundRect(ctx, cx - hw / 2, cy + 10, hw, 20, 6)
  ctx.stroke()
  ctx.fillStyle = inks.fg
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(hillText, cx, cy + 20)
  drawTracers(ctx, d, fronts)
  if (d.hover) {
    const dx = d.hover.x - cx
    const dy = d.hover.y - cy
    const dist = Math.hypot(dx, dy)
    if (dist <= R) {
      let ang = Math.atan2(dy, dx)
      if (ang < -Math.PI / 2) ang += Math.PI * 2
      const i = sectors.findIndex((sec) => ang >= sec.start && ang < sec.end)
      const a = i >= 0 ? s.frames[i] : null
      if (a && a.track.length) {
        const sec = sectors[i]
        const k = (ang - sec.start) / (sec.end - sec.start)
        const t = s.from + ((k - 0.05) / 0.9) * (s.to - s.from)
        hoverAt(ctx, d, { ...s, frames: [a] }, t, d.hover.y, (p) => {
          const pa = siegeAngle(p.t, s.from, s.to, sec)
          const pr = rr(p.pct)
          return [cx + Math.cos(pa) * pr, cy + Math.sin(pa) * pr]
        }, null, 8, w - 8, 8)
      }
    }
  }
}

// ── Shared parts ─────────────────────────────────────────────────────────────

interface Front {
  x: number
  y: number
  /** Forward: the way the army advances (unit vector). */
  nx: number
  ny: number
  /** Along the front (unit vector). */
  tx: number
  ty: number
}

function drawGround(ctx: CanvasRenderingContext2D, inks: Inks, l: number, t: number, pw: number, ph: number, y: (pct: number) => number): void {
  const y0 = Math.min(Math.max(y(0), t), t + ph)
  const gainGrad = ctx.createLinearGradient(0, t, 0, y0)
  gainGrad.addColorStop(0, inks.gain)
  gainGrad.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = gainGrad
  ctx.fillRect(l, t, pw, Math.max(0, y0 - t))
  const lossGrad = ctx.createLinearGradient(0, y0, 0, t + ph)
  lossGrad.addColorStop(0, 'rgba(0,0,0,0)')
  lossGrad.addColorStop(1, inks.loss)
  ctx.fillStyle = lossGrad
  ctx.fillRect(l, y0, pw, Math.max(0, t + ph - y0))
}

function drawGrid(ctx: CanvasRenderingContext2D, inks: Inks, range: PctRange, l: number, pw: number, y: (pct: number) => number, labelX: number): void {
  ctx.font = `10px ${inks.mono}`
  ctx.textBaseline = 'middle'
  for (const t of pctTicks(range)) {
    const yy = y(t)
    ctx.strokeStyle = t === 0 ? inks.horizon : inks.grid
    ctx.lineWidth = 1
    ctx.setLineDash(t === 0 ? [5, 4] : [])
    ctx.beginPath()
    ctx.moveTo(l, yy)
    ctx.lineTo(l + pw, yy)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.fillStyle = inks.muted
    ctx.textAlign = 'right'
    ctx.fillText(t === 0 ? '0' : fmtPct(t), labelX, yy)
  }
}

function drawTimeTicks(ctx: CanvasRenderingContext2D, inks: Inks, from: number, to: number, l: number, pw: number, baseline: number): void {
  ctx.font = `10px ${inks.mono}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = inks.muted
  for (let i = 0; i <= 4; i++) {
    const t = from + ((to - from) * i) / 4
    ctx.fillText(i === 0 ? `${clockOf(t)} · anchor` : i === 4 ? 'now' : clockOf(t), l + (pw * i) / 4, baseline)
  }
}

/** Territory under or over the line to the horizon, then the line with a halo. */
function drawTrack(ctx: CanvasRenderingContext2D, ink: string, pts: readonly (readonly [number, number])[], y0: number): void {
  ctx.beginPath()
  ctx.moveTo(pts[0][0], y0)
  for (const [px, py] of pts) ctx.lineTo(px, py)
  ctx.lineTo(pts[pts.length - 1][0], y0)
  ctx.closePath()
  ctx.globalAlpha = 0.11
  ctx.fillStyle = ink
  ctx.fill()
  ctx.globalAlpha = 1
  strokeLine(ctx, ink, pts)
}

function strokeLine(ctx: CanvasRenderingContext2D, ink: string, pts: readonly (readonly [number, number])[]): void {
  ctx.beginPath()
  pts.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)))
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.strokeStyle = ink
  ctx.globalAlpha = 0.25
  ctx.lineWidth = 7
  ctx.stroke()
  ctx.globalAlpha = 1
  ctx.lineWidth = 2.2
  ctx.stroke()
}

function drawBursts(ctx: CanvasRenderingContext2D, d: DrawInput, a: ArmyFrame, s: Scene, at: (b: Burst) => readonly [number, number], terse = false): void {
  const { inks } = d
  for (const b of a.bursts) {
    const [bx, by] = at(b)
    const rad = Math.min(18, 4 + 3 * Math.sqrt(b.usd / (s.unit * 4)))
    const col = b.side === 'buy' ? inks.up : inks.down
    ctx.strokeStyle = col
    ctx.fillStyle = col
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.arc(bx, by, rad, 0, Math.PI * 2)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(bx, by, 2.5, 0, Math.PI * 2)
    ctx.fill()
    const age = d.now - b.t
    if (age < FLASH_MS && !d.paused) {
      const k = age / FLASH_MS
      ctx.globalAlpha = 1 - k
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(bx, by, rad + k * 26, 0, Math.PI * 2)
      ctx.stroke()
      ctx.globalAlpha = 1
      if (!terse) {
        ctx.font = `600 11px ${inks.mono}`
        ctx.textAlign = 'left'
        ctx.textBaseline = 'middle'
        ctx.fillText(`${fmtUsd(b.usd)} ${b.side === 'buy' ? 'bought' : 'sold'}`, bx + rad + 6, by - 8)
      }
    }
  }
}

/** ▲ bought behind the front (against the army's forward), ▼ sold ahead of it. */
function drawRanks(ctx: CanvasRenderingContext2D, inks: Inks, ink: string, a: ArmyFrame, unit: number, x: number, y: number, fwd: { x: number; y: number }, perRow = 10): void {
  const buy = glyphsFor(a.strength.buyUsd, unit)
  const sell = glyphsFor(a.strength.sellUsd, unit)
  const tx = -fwd.y
  const ty = fwd.x
  const place = (count: number, color: string, dir: 1 | -1, pointForward: boolean) => {
    if (count <= 0) return
    ctx.fillStyle = color
    for (let i = 0; i < count; i++) {
      const col = i % perRow
      const row = Math.floor(i / perRow)
      const ox = x + tx * (-col * 8) - fwd.x * dir * (12 + row * 8)
      const oy = y + ty * (-col * 8) - fwd.y * dir * (12 + row * 8)
      triangle(ctx, ox, oy, 5, pointForward ? fwd : { x: -fwd.x, y: -fwd.y })
    }
  }
  place(buy, ink, 1, true)
  place(sell, inks.down, -1, false)
}

function triangle(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, dir: { x: number; y: number }): void {
  const h = size / 2
  const px = -dir.y
  const py = dir.x
  ctx.beginPath()
  ctx.moveTo(x + dir.x * h, y + dir.y * h)
  ctx.lineTo(x - dir.x * h + px * h, y - dir.y * h + py * h)
  ctx.lineTo(x - dir.x * h - px * h, y - dir.y * h - py * h)
  ctx.closePath()
  ctx.fill()
}

function drawFlag(ctx: CanvasRenderingContext2D, inks: Inks, ink: string, a: ArmyFrame, bx: number, fy: number, maxW: number, top: number, bottom: number, fromX: number, fromY: number): void {
  const label = armyLabel(a.market)
  ctx.font = `600 12px ${inks.ui}`
  const tw = ctx.measureText(label).width
  ctx.font = `600 12px ${inks.mono}`
  const pw = ctx.measureText(fmtPct(a.pct)).width
  const bw = Math.min(maxW, tw + pw + 26)
  const byTop = Math.min(Math.max(fy - 13, top), bottom - 26)
  ctx.strokeStyle = ink
  ctx.lineWidth = 1
  ctx.setLineDash([2, 3])
  ctx.beginPath()
  ctx.moveTo(fromX, fromY)
  ctx.lineTo(bx, byTop + 13)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.fillStyle = ink
  roundRect(ctx, bx, byTop, bw, 26, 5)
  ctx.fill()
  ctx.fillStyle = inks.bg
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.font = `600 12px ${inks.ui}`
  ctx.fillText(label, bx + 9, byTop + 13)
  ctx.font = `600 12px ${inks.mono}`
  ctx.textAlign = 'right'
  ctx.fillText(fmtPct(a.pct), bx + bw - 8, byTop + 13)
}

/** Every fill as it lands: a buy rises from behind the front, a sell falls
 *  on it from ahead. The particle list is pruned in place. */
function drawTracers(ctx: CanvasRenderingContext2D, d: DrawInput, fronts: Map<string, Front>): void {
  if (d.reduced || d.paused) return
  const { inks } = d
  const alive: Particle[] = []
  for (const p of d.particles) {
    const age = d.now - p.t0
    if (age >= PARTICLE_MS) continue
    alive.push(p)
    const f = fronts.get(p.market)
    if (!f) continue
    const k = 1 - Math.pow(1 - age / PARTICLE_MS, 2)
    const dir = p.side === 'buy' ? -1 : 1
    const sx = f.x + f.nx * dir * p.dy + f.tx * p.dx
    const sy = f.y + f.ny * dir * p.dy + f.ty * p.dx
    const px = sx + (f.x - sx) * k
    const py = sy + (f.y - sy) * k
    ctx.globalAlpha = 0.9 * (1 - k)
    ctx.fillStyle = p.side === 'buy' ? inks.up : inks.down
    ctx.beginPath()
    ctx.arc(px, py, 1.4 + Math.min(4, Math.sqrt(p.usd) / 60), 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1
  d.particles.length = 0
  d.particles.push(...alive)
}

/** The nearest front at the pointer's moment: a crosshair and a readout. */
function hoverAt(
  ctx: CanvasRenderingContext2D,
  d: DrawInput,
  s: Scene,
  t: number,
  mouseY: number,
  at: (p: TrackPoint) => readonly [number, number],
  cross: { x1: number; y1: number; y2: number } | null,
  minX: number,
  maxX: number,
  minY: number,
): void {
  const { inks } = d
  let best: { a: ArmyFrame; p: TrackPoint; dy: number } | null = null
  for (const a of s.frames) {
    if (!a.track.length) continue
    const p = nearest(a.track, t)
    const dy = Math.abs(at(p)[1] - mouseY)
    if (!best || dy < best.dy) best = { a, p, dy }
  }
  if (cross) {
    ctx.strokeStyle = inks.horizon
    ctx.lineWidth = 1
    ctx.setLineDash([3, 3])
    ctx.beginPath()
    ctx.moveTo(cross.x1, cross.y1)
    ctx.lineTo(cross.x1, cross.y2)
    ctx.stroke()
    ctx.setLineDash([])
  }
  if (!best) return
  const ink = inks.army[best.a.slot] ?? inks.army[0]
  const [px, py] = at(best.p)
  dot(ctx, ink, px, py, 4.5)
  const line = `${armyLabel(best.a.market)} · ${clockOf(best.p.t, true)} · ${fmtPrice(best.p.p)} · ${fmtPct(best.p.pct)}`
  ctx.font = `11px ${inks.mono}`
  const lw = ctx.measureText(line).width + 16
  const tx = Math.min(Math.max(px + 10, minX), maxX - lw)
  const ty = Math.max(minY + 4, py - 30)
  ctx.fillStyle = inks.surface
  ctx.globalAlpha = 0.92
  roundRect(ctx, tx, ty, lw, 20, 5)
  ctx.fill()
  ctx.globalAlpha = 1
  ctx.strokeStyle = ink
  ctx.lineWidth = 1
  roundRect(ctx, tx, ty, lw, 20, 5)
  ctx.stroke()
  ctx.fillStyle = inks.fg
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(line, tx + 8, ty + 10)
}

function dot(ctx: CanvasRenderingContext2D, ink: string, x: number, y: number, r: number): void {
  ctx.fillStyle = ink
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text
  let s = text
  while (s.length > 3 && ctx.measureText(`${s}…`).width > maxW) s = s.slice(0, -1)
  return `${s}…`
}

function nearest(track: TrackPoint[], t: number): TrackPoint {
  let lo = 0
  let hi = track.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (track[mid].t < t) lo = mid + 1
    else hi = mid
  }
  const a = track[lo]
  const b = track[Math.max(0, lo - 1)]
  return Math.abs(a.t - t) <= Math.abs(b.t - t) ? a : b
}

export function clockOf(ms: number, seconds = false): string {
  const d = new Date(ms)
  return d.toLocaleTimeString('en-GB', { hour12: false, hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}) })
}
