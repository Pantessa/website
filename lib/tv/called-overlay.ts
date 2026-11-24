// CALLED IT, the marks layer (squad mobile-sleek, lane CHART, 2026-11-24).
//
// The calls that have no card used to be the library's bar marks: one disc a
// call, stacked over its bar. Sixty calls made sixty discs, and where an
// account posted every day they piled into a blob that hid the candles. This
// layer draws them instead, as the brand's own shape, on one canvas laid over
// the chart's pane:
//
//   a TILE per call          the cut-corner tile of the Cut P, two flat tones,
//                            the verdict's glyph cut in the ground colour. A
//                            hairline leads from it to the bar and the price
//                            the post landed on.
//   a CHIP per crowd         calls that would touch are counted, never piled:
//                            one chip per verdict (its tile, then how many),
//                            stacked over the stretch of bars they share. The
//                            stretch is cut in TIME, so a pan never reshuffles
//                            a crowd; only a zoom does.
//   the OPENED call          lifted out of its crowd and drawn alone, larger,
//                            ringed in the page's ink, on its own bar.
//   a CARD per picked call   where the pane has the room (lib/tv/called-pins
//                            decides which calls and where): a cut-corner
//                            card on a rail above or below the candles. The
//                            verdict line in the verdict's tone, the post's
//                            own words, the move in mono, a hairline to the
//                            bar. Placed again on every frame, so a card
//                            rides its bar through a pan with no lag.
//
// Rules this file holds (with lib/tv/called-pins, whose header has the rest):
//   · Right and wrong differ by colour AND by glyph. The two verdicts that are
//     not results (no real move, too early to say) are hollow, and differ from
//     each other by colour and glyph too. A post a viewer pasted is a dashed
//     hollow tile and is never counted in with the scanned ones.
//   · A chip's count is the count of calls under it: nothing is dropped.
//   · The layer is paint, not a drawing: nothing here is a chart shape, so
//     nothing here can be selected, edited, saved or listed.
//   · It takes no pointer events. A press is read from the chart's own frame:
//     a tap that did not move opens the nearest mark inside a 44px target; a
//     drag still pans the chart under the marks.
//
// The first half is pure. The layer at the end is the only part that touches
// a document, and it does nothing where there is none (the pins run it so).

import type { CallVerdict, CalledCall } from '@/lib/called-it/spec'
import type { TvChartApi } from './types'

export type MarkCall = Pick<CalledCall, 'postId' | 'barTime' | 'priceAt' | 'verdict' | 'impact'> & { origin?: CalledCall['origin'] }

/** Sizes in px. A phone's tile is a little larger; the press target is `tap` either way. */
export const MARK_PX = { tile: 18, phoneTile: 20, gap: 2, lift: 12, focus: 30, tap: 44, phonePane: 520 } as const

/** A stack reads top to bottom: came true, missed, too early to say, no real move. */
export const MARK_ORDER: readonly CallVerdict[] = ['right', 'wrong', 'open', 'flat']

export function tileFor(paneWidth: number): number {
  return paneWidth < MARK_PX.phonePane ? MARK_PX.phoneTile : MARK_PX.tile
}
/** The room one stack takes across the pane: a tile, a two-digit count, air. */
export function slotFor(tile: number): number {
  return tile * 2 + 10
}
/** A chip's width: the tile alone for one call, the tile and its count for more. */
export function chipWidth(tile: number, count: number): number {
  return count <= 1 ? tile : Math.round(tile + 7 + String(count).length * tile * 0.34)
}

/** Bars one stack stands for at this zoom. */
export function binBarsFor(spacing: number, slot: number): number {
  return Math.max(1, Math.ceil(slot / Math.max(0.05, spacing)))
}

export interface MarkChip {
  verdict: CallVerdict
  added: boolean
  /** The calls under the chip, the one that moved furthest first. */
  ids: string[]
}
export interface MarkBin {
  key: number
  /** The first and the last bar of the stretch, seconds. */
  t0: number
  t1: number
  chips: MarkChip[]
  calls: MarkCall[]
}

/**
 * The calls cut into stretches of `binBars` bars, by time (so the same call is
 * in the same stretch wherever the chart is panned). Every call is in exactly
 * one chip of exactly one stretch. `skip` leaves a call out (the opened one,
 * which is drawn alone).
 */
export function binMarks(calls: readonly MarkCall[], barSec: number, binBars: number, skip?: string | null): MarkBin[] {
  const span = Math.max(1, barSec) * Math.max(1, binBars)
  const bins = new Map<number, MarkCall[]>()
  for (const c of calls) {
    if (c.postId === skip) continue
    const key = Math.floor(c.barTime / span)
    const list = bins.get(key)
    if (list) list.push(c)
    else bins.set(key, [c])
  }
  return [...bins.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([key, list]) => {
      const chips: MarkChip[] = []
      for (const added of [false, true]) {
        for (const verdict of MARK_ORDER) {
          const hit = list.filter((c) => c.verdict === verdict && (c.origin === 'added') === added).sort((a, b) => b.impact - a.impact || (a.postId < b.postId ? -1 : 1))
          if (hit.length) chips.push({ verdict, added, ids: hit.map((c) => c.postId) })
        }
      }
      return { key, t0: key * span, t1: key * span + span - Math.max(1, barSec), chips, calls: list }
    })
}

export interface PlacedMark {
  key: string
  ids: string[]
  verdict: CallVerdict
  added: boolean
  count: number
  /** Top-left, px in the pane. */
  x: number
  y: number
  w: number
  h: number
  /** The tile's side inside the chip. */
  tile: number
  /** The opened call. */
  focus: boolean
  /** The bar and price a lone call points at. */
  tip: { x: number; y: number } | null
}

export interface PlaceInput {
  calls: readonly MarkCall[]
  focusId: string | null
  pane: { width: number; height: number }
  /** Px kept clear at the pane's head (the legend) and foot (the tally). */
  keepTop: number
  keepBottom: number
  /** The legend's own corner (its second row and fold button, top left): a mark there starts under it. */
  keepCorner?: { width: number; top: number }
  barSec: number
  spacing: number
  /** The centre of the bar that holds `t`, px (may be off the pane). */
  x(t: number): number
  /** A price down the pane, px; null when the scale cannot say. */
  y(price: number): number | null
}

/**
 * Where every mark goes. A stretch's chips stand in one column over the
 * middle of the stretch, the bottom one a little above the highest call in
 * it; columns are a slot apart, so no two ever touch. The opened call stands
 * alone on its own bar. Nothing is placed outside the pane.
 */
export function placeMarks(input: PlaceInput): PlacedMark[] {
  const { pane } = input
  const tile = tileFor(pane.width)
  const slot = slotFor(tile)
  const binBars = binBarsFor(input.spacing, slot)
  const topAt = (x: number) => (input.keepCorner && x < input.keepCorner.width ? Math.max(input.keepTop, input.keepCorner.top) : input.keepTop) + 2
  const floor = pane.height - input.keepBottom - 4
  const out: PlacedMark[] = []
  const focusCall = input.focusId ? (input.calls.find((c) => c.postId === input.focusId) ?? null) : null
  // The columns on the pane, each as wide as its widest chip, then spread like the cards' rail: every column as close
  // to its own stretch as it can be, none over its neighbour, none off the pane (a stretch half off the edge slides in).
  const cols = binMarks(input.calls, input.barSec, binBars, focusCall?.postId)
    .map((bin) => ({ bin, cx: (input.x(bin.t0) + input.x(bin.t1)) / 2, w: Math.max(...bin.chips.map((chip) => chipWidth(tile, chip.ids.length))) }))
    .filter((c) => c.cx >= -slot / 2 && c.cx <= pane.width + slot / 2)
  const left = cols.map((c) => c.cx - c.w / 2)
  const air = 4
  for (let i = 0; i < cols.length; i++) left[i] = Math.max(left[i], i === 0 ? 2 : left[i - 1] + cols[i - 1].w + air)
  for (let i = cols.length - 1; i >= 0; i--) left[i] = Math.min(left[i], i === cols.length - 1 ? pane.width - cols[i].w - 2 : left[i + 1] - air - cols[i].w)
  for (let k = 0; k < cols.length; k++) {
    const { bin } = cols[k]
    const cx = left[k] + cols[k].w / 2
    let high: number | null = null
    for (const c of bin.calls) {
      const y = input.y(c.priceAt)
      if (y !== null && Number.isFinite(y) && (high === null || y < high)) high = y
    }
    if (high === null) continue
    const stackH = bin.chips.length * tile + (bin.chips.length - 1) * MARK_PX.gap
    let y = Math.round(high - MARK_PX.lift - stackH)
    y = Math.max(topAt(left[k]), Math.min(y, floor - stackH))
    const lone = bin.calls.length === 1 ? bin.calls[0] : null
    for (const chip of bin.chips) {
      const w = chipWidth(tile, chip.ids.length)
      const x = Math.round(cx - w / 2)
      const tipY = lone ? input.y(lone.priceAt) : null
      out.push({ key: `${bin.key}:${chip.added ? '+' : ''}${chip.verdict}`, ids: chip.ids, verdict: chip.verdict, added: chip.added, count: chip.ids.length, x, y, w, h: tile, tile, focus: false, tip: lone && tipY !== null ? { x: input.x(lone.barTime), y: tipY } : null })
      y += tile + MARK_PX.gap
    }
  }
  if (focusCall) {
    const fx = input.x(focusCall.barTime)
    const fy = input.y(focusCall.priceAt)
    if (fy !== null && fx >= 0 && fx <= pane.width) {
      const s = MARK_PX.focus
      const x = Math.round(Math.max(4, Math.min(fx - s / 2, pane.width - s - 4)))
      let y = Math.round(Math.max(topAt(x) + 2, Math.min(fy - MARK_PX.lift - 8 - s, floor - s)))
      // It stands clear of the crowd beside it: above the stack it would cover, when the pane has the room.
      for (let pass = 0; pass < 3; pass++) {
        const under = out.filter((m) => m.x < x + s + 3 && x < m.x + m.w + 3 && m.y < y + s + 3 && y < m.y + m.h + 3)
        if (!under.length) break
        const above = Math.min(...under.map((m) => m.y)) - s - 6
        if (above < topAt(x) + 2) break
        y = above
      }
      out.push({ key: `focus:${focusCall.postId}`, ids: [focusCall.postId], verdict: focusCall.verdict, added: focusCall.origin === 'added', count: 1, x, y, w: s, h: s, tile: s, focus: true, tip: { x: fx, y: fy } })
    }
  }
  return out
}

/** The mark a press at (px, py) means: the nearest one whose box, grown to the press target, holds the point. The opened call wins a tie. */
export function hitMark(marks: readonly PlacedMark[], px: number, py: number, tap: number = MARK_PX.tap): PlacedMark | null {
  let best: PlacedMark | null = null
  let bestD = Infinity
  for (const m of marks) {
    const gx = Math.max(0, (tap - m.w) / 2)
    const gy = Math.max(0, (tap - m.h) / 2)
    if (px < m.x - gx || px > m.x + m.w + gx || py < m.y - gy || py > m.y + m.h + gy) continue
    const d = Math.hypot(px - (m.x + m.w / 2), py - (m.y + m.h / 2)) - (m.focus ? 6 : 0)
    if (d < bestD) {
      best = m
      bestD = d
    }
  }
  return best
}

/** Which call a press on a mark opens: the first under it, or the one after the call already open (a second press walks the crowd). */
export function pickFrom(mark: Pick<PlacedMark, 'ids'>, focusId: string | null): string {
  const at = focusId ? mark.ids.indexOf(focusId) : -1
  return mark.ids[(at + 1) % mark.ids.length]
}

/** A chart resolution in seconds (`1D`, `60`, `10S`, `1W`); null for a month, whose bars are not one length. */
export function resolutionSeconds(resolution: string): number | null {
  const m = /^(\d*)([SDWM]?)$/i.exec(resolution.trim())
  if (!m) return null
  const n = Number(m[1] || 1)
  const unit = m[2].toUpperCase()
  if (!(n > 0)) return null
  if (unit === 'M') return null
  return n * (unit === 'S' ? 1 : unit === 'D' ? 86_400 : unit === 'W' ? 604_800 : 60)
}

// ── The paint ───────────────────────────────────────────────────────────

export interface MarkInks {
  up: string
  down: string
  open: string
  flat: string
  fg: string
  bg: string
}

/** Two opaque `#rrggbb` inks mixed (`t` of the first); anything else gives the first back. */
function mix(a: string, b: string, t: number): string {
  const hex = (c: string) => (/^#[0-9a-f]{6}$/i.test(c) ? [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) : null)
  const x = hex(a)
  const y = hex(b)
  if (!x || !y) return a
  return `#${x.map((v, i) => Math.round(v * t + y[i] * (1 - t)).toString(16).padStart(2, '0')).join('')}`
}

export function markInk(verdict: CallVerdict, inks: MarkInks): string {
  return verdict === 'right' ? inks.up : verdict === 'wrong' ? inks.down : verdict === 'open' ? inks.open : inks.flat
}

/** The verdict glyphs of the kit's tile (components/sleek/VerdictTile), in its 24 box. */
const GLYPH: Record<CallVerdict, number[][]> = {
  right: [[7, 12.4, 10.6, 16, 17.2, 8.6]],
  wrong: [
    [8, 8, 16, 16],
    [16, 8, 8, 16],
  ],
  flat: [[7.5, 12, 16.5, 12]],
  open: [[9, 9, 9, 7.6, 15, 7.6, 15, 11.4, 12, 11.4, 12, 13.6]],
}

type Ctx = CanvasRenderingContext2D

/** The tile's silhouette: the top-left and bottom-right corners cut. */
function cutPath(ctx: Ctx, x: number, y: number, w: number, h: number, c: number): void {
  ctx.beginPath()
  ctx.moveTo(x + c, y)
  ctx.lineTo(x + w, y)
  ctx.lineTo(x + w, y + h - c)
  ctx.lineTo(x + w - c, y + h)
  ctx.lineTo(x, y + h)
  ctx.lineTo(x, y + c)
  ctx.closePath()
}

function glyph(ctx: Ctx, verdict: CallVerdict, x: number, y: number, s: number, ink: string): void {
  const k = s / 24
  ctx.strokeStyle = ink
  ctx.lineWidth = Math.max(1.5, 2.6 * k)
  ctx.lineCap = 'square'
  ctx.lineJoin = 'miter'
  ctx.setLineDash([])
  for (const run of GLYPH[verdict]) {
    ctx.beginPath()
    for (let i = 0; i < run.length; i += 2) {
      if (i === 0) ctx.moveTo(x + run[i] * k, y + run[i + 1] * k)
      else ctx.lineTo(x + run[i] * k, y + run[i + 1] * k)
    }
    ctx.stroke()
  }
  if (verdict === 'open') {
    ctx.fillStyle = ink
    ctx.fillRect(x + 10.7 * k, y + 15.4 * k, 2.6 * k, 2.6 * k)
  }
}

/** One mark. A hit or a miss is filled (lit above the diagonal, shaded below); the rest are hollow; a pasted post is dashed. */
function paintMark(ctx: Ctx, m: PlacedMark, inks: MarkInks, mono: string, hover: boolean): void {
  const ink = markInk(m.verdict, inks)
  const filled = !m.added && (m.verdict === 'right' || m.verdict === 'wrong')
  const s = m.tile
  const c = Math.round((s * 16) / 72)
  const { x, y, w, h } = m
  // The ground under it, a hair wider: a mark never bleeds into a candle or its neighbour.
  const halo = m.focus ? 3 : 1.5
  cutPath(ctx, x - halo, y - halo, w + 2 * halo, h + 2 * halo, c + halo * 0.6)
  ctx.fillStyle = inks.bg
  ctx.fill()
  ctx.save()
  cutPath(ctx, x, y, w, h, c)
  ctx.clip()
  if (filled) {
    ctx.fillStyle = mix(ink, '#000000', 0.68)
    ctx.fillRect(x, y, s, s)
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + s, y)
    ctx.lineTo(x, y + s)
    ctx.closePath()
    ctx.fillStyle = ink
    ctx.fill()
    if (w > s) {
      ctx.fillStyle = mix(ink, inks.bg, 0.2)
      ctx.fillRect(x + s, y, w - s, h)
    }
  } else {
    ctx.fillStyle = inks.bg
    ctx.fillRect(x, y, w, h)
  }
  ctx.restore()
  if (!filled) {
    cutPath(ctx, x + 0.5, y + 0.5, w - 1, h - 1, c)
    ctx.strokeStyle = ink
    ctx.lineWidth = 1
    ctx.setLineDash(m.added ? [2, 2] : [])
    ctx.stroke()
    ctx.setLineDash([])
  }
  glyph(ctx, m.verdict, x, y, s, filled ? inks.bg : ink)
  if (m.count > 1) {
    ctx.font = `600 ${Math.round(s * 0.58)}px ${mono}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = ink
    ctx.fillText(String(m.count), x + s + (w - s) / 2 - 1, y + h / 2 + 0.5)
  }
  if (m.focus || hover) {
    const r = m.focus ? 3 : 2
    cutPath(ctx, x - r + 0.5, y - r + 0.5, w + 2 * r - 1, h + 2 * r - 1, c + r * 0.6)
    ctx.strokeStyle = inks.fg
    ctx.lineWidth = m.focus ? 1.5 : 1
    ctx.stroke()
  }
}

/** The whole layer: leaders first, the crowd, then the opened call on top. */
export function paintMarks(ctx: Ctx, marks: readonly PlacedMark[], inks: MarkInks, mono: string, hoverKey: string | null): void {
  for (const m of marks) {
    if (!m.tip) continue
    const ink = markInk(m.verdict, inks)
    const fromX = m.x + m.w / 2
    const fromY = m.y + m.h
    if (m.tip.y > fromY + 3) {
      ctx.beginPath()
      ctx.moveTo(fromX, fromY)
      ctx.lineTo(m.tip.x, m.tip.y)
      ctx.strokeStyle = inks.bg
      ctx.lineWidth = m.focus ? 4 : 3
      ctx.stroke()
      ctx.strokeStyle = ink
      ctx.lineWidth = m.focus ? 1.5 : 1
      ctx.stroke()
    }
    const d = m.focus ? 7 : 5
    ctx.fillStyle = inks.bg
    ctx.fillRect(Math.round(m.tip.x - d / 2) - 1, Math.round(m.tip.y - d / 2) - 1, d + 2, d + 2)
    ctx.fillStyle = ink
    ctx.fillRect(Math.round(m.tip.x - d / 2), Math.round(m.tip.y - d / 2), d, d)
  }
  for (const m of marks) if (!m.focus) paintMark(ctx, m, inks, mono, m.key === hoverKey)
  for (const m of marks) if (m.focus) paintMark(ctx, m, inks, mono, false)
}

// ── The cards ───────────────────────────────────────────────────────────

/** A card's metrics, px. One place: the size the layout plans with is the size the paint draws. */
export const CARD_PX = { pad: 11, cut: 10, tile: 14, head: 16, headGap: 7, wordsFont: 13, wordsLine: 17, resultGap: 7, resultFont: 11, resultLine: 15, addedLine: 15, dateFont: 10 } as const

export interface CardSpec {
  id: string
  barTime: number
  priceAt: number
  verdict: CallVerdict
  /** A post a viewer pasted: it says so on a line of its own. */
  added: string | null
  /** The verdict's word and the day, the post's own words (already cut and wrapped), the move. */
  word: string
  date: string
  words: readonly string[]
  result: readonly string[]
  w: number
  h: number
}

export interface CardBox {
  id: string
  side: 'above' | 'below'
  inView: boolean
  x: number
  y: number
  w: number
  h: number
}

export interface CardFonts {
  sans: string
  mono: string
}
export const cardFont = {
  word: (f: CardFonts) => `600 12px ${f.sans}`,
  date: (f: CardFonts) => `500 ${CARD_PX.dateFont}px ${f.mono}`,
  words: (f: CardFonts) => `400 ${CARD_PX.wordsFont}px ${f.sans}`,
  added: (f: CardFonts) => `italic 400 11px ${f.sans}`,
  result: (f: CardFonts) => `500 ${CARD_PX.resultFont}px ${f.mono}`,
} as const

/** The box a card takes for these lines. `measure(font, text)` is the canvas's own. */
export function cardSize(card: Pick<CardSpec, 'word' | 'date' | 'words' | 'result' | 'added'>, fonts: CardFonts, measure: (font: string, text: string) => number): { w: number; h: number } {
  const head = CARD_PX.tile + 7 + measure(cardFont.word(fonts), card.word) + 14 + measure(cardFont.date(fonts), card.date.toUpperCase())
  const widest = Math.max(head, ...card.words.map((l) => measure(cardFont.words(fonts), l)), ...card.result.map((l) => measure(cardFont.result(fonts), l)), card.added ? measure(cardFont.added(fonts), card.added) : 0)
  return {
    w: Math.ceil(widest) + 2 * CARD_PX.pad,
    h: 2 * CARD_PX.pad + CARD_PX.head + (card.added ? CARD_PX.addedLine : 0) + CARD_PX.headGap + card.words.length * CARD_PX.wordsLine + CARD_PX.resultGap + card.result.length * CARD_PX.resultLine - 3,
  }
}

/** The page's own type families (Geist, Geist Mono), read from its tokens; the system's where there is no page. */
export function pageFonts(): CardFonts {
  const fallback: CardFonts = { sans: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif", mono: "ui-monospace, 'SF Mono', Menlo, monospace" }
  try {
    if (typeof document === 'undefined') return fallback
    const cs = getComputedStyle(document.documentElement)
    return { sans: cs.getPropertyValue('--font-sans').trim() || fallback.sans, mono: cs.getPropertyValue('--font-mono').trim() || fallback.mono }
  } catch {
    return fallback
  }
}

/** A text measure on a canvas of the page's document; null where there is none. */
export function pageMeasure(): ((font: string, text: string) => number) | null {
  try {
    if (typeof document === 'undefined') return null
    const ctx = document.createElement('canvas').getContext('2d')
    if (!ctx) return null
    return (font, text) => {
      ctx.font = font
      return ctx.measureText(text).width + 0.5
    }
  } catch {
    return null
  }
}

export interface CardInks extends MarkInks {
  surf: string
  muted: string
}

function paintCard(ctx: Ctx, card: CardSpec, box: CardBox, tip: { x: number; y: number } | null, inks: CardInks, fonts: CardFonts, state: { focus: boolean; hover: boolean }): void {
  const ink = markInk(card.verdict, inks)
  const { x, y, w, h } = box
  const P = CARD_PX
  const lit = state.focus || state.hover
  // The hairline to the bar: from the card's near edge, straight to a square on the price.
  if (tip) {
    const fromX = Math.max(x + P.cut + 8, Math.min(tip.x, x + w - P.cut - 8))
    const fromY = box.side === 'above' ? y + h : y
    ctx.beginPath()
    ctx.moveTo(fromX, fromY)
    ctx.lineTo(tip.x, tip.y)
    ctx.strokeStyle = inks.bg
    ctx.lineWidth = 3
    ctx.stroke()
    ctx.strokeStyle = mix(ink, inks.bg, lit ? 1 : 0.62)
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.fillStyle = inks.bg
    ctx.fillRect(Math.round(tip.x) - 4, Math.round(tip.y) - 4, 8, 8)
    ctx.fillStyle = ink
    ctx.fillRect(Math.round(tip.x) - 3, Math.round(tip.y) - 3, 6, 6)
  }
  // The card: a calm ground with a breath of the verdict's tone, one hairline edge, the brand's two cut corners.
  cutPath(ctx, x - 2, y - 2, w + 4, h + 4, P.cut + 1)
  ctx.fillStyle = inks.bg
  ctx.fill()
  cutPath(ctx, x, y, w, h, P.cut)
  ctx.fillStyle = mix(ink, inks.bg, state.focus ? 0.13 : 0.07)
  ctx.fill()
  cutPath(ctx, x + 0.5, y + 0.5, w - 1, h - 1, P.cut)
  ctx.strokeStyle = mix(ink, inks.bg, lit ? 1 : 0.5)
  ctx.lineWidth = state.focus ? 1.5 : 1
  ctx.stroke()
  // The verdict line: the tile, the word in the verdict's tone, the day.
  const tx = x + P.pad
  let ty = y + P.pad
  paintMark(ctx, { key: '', ids: [], verdict: card.verdict, added: !!card.added, count: 1, x: tx, y: ty + 1, w: P.tile, h: P.tile, tile: P.tile, focus: false, tip: null }, { ...inks, bg: mix(ink, inks.bg, 0.07) }, fonts.mono, false)
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.font = cardFont.word(fonts)
  ctx.fillStyle = ink
  ctx.fillText(card.word, tx + P.tile + 7, ty + P.head / 2 + 1)
  ctx.font = cardFont.date(fonts)
  ctx.textAlign = 'right'
  ctx.fillStyle = inks.muted
  ctx.fillText(card.date.toUpperCase(), x + w - P.pad, ty + P.head / 2 + 1)
  ctx.textAlign = 'left'
  ty += P.head
  if (card.added) {
    ctx.font = cardFont.added(fonts)
    ctx.fillStyle = inks.muted
    ctx.fillText(card.added, tx, ty + P.addedLine / 2 + 2)
    ty += P.addedLine
  }
  ty += P.headGap
  // The post's own words.
  ctx.font = card.added ? `italic ${cardFont.words(fonts)}` : cardFont.words(fonts)
  ctx.fillStyle = inks.fg
  for (const line of card.words) {
    ctx.fillText(line, tx, ty + P.wordsLine / 2 - 1)
    ty += P.wordsLine
  }
  ty += P.resultGap - 3
  // The move, in mono.
  ctx.font = cardFont.result(fonts)
  ctx.fillStyle = mix(inks.fg, inks.bg, 0.66)
  for (const line of card.result) {
    ctx.fillText(line, tx, ty + P.resultLine / 2)
    ty += P.resultLine
  }
}

// ─────────────────────────────────────────────────────────────────────────
//  THE LAYER: the only part that touches a document.
// ─────────────────────────────────────────────────────────────────────────

export interface MarksScene {
  /** Changes when the calls (or their verdicts) do. */
  key: string
  calls: readonly MarkCall[]
  focusId: string | null
  keepTop: number
  keepBottom: number
  keepCorner?: { width: number; top: number }
  /** The picked calls' cards and the rule that places them (lib/tv/called-pins `layoutCallouts`). */
  cards?: readonly CardSpec[]
  layout?: (pane: { width: number; height: number }, anchors: { id: string; x: number | null; y: number | null }[]) => CardBox[]
}

export interface MarksLayerHooks {
  /** The element the chart's frame is in. */
  host(): HTMLElement | null
  chart(): TvChartApi | null
  /** What to draw, or null for nothing. */
  scene(): MarksScene | null
  inks(): CardInks
  /** The card for one call, shown while the mouse is over its mark. */
  preview?(postId: string): CardSpec | null
  onPick(postId: string): void
  /** The layer is drawing (true) or cannot (false): the caller falls back to the library's own marks. */
  onMount(on: boolean): void
}

export interface MarksLayer {
  start(): void
  stop(): void
  /** Paint again on the next frame (the inks changed). */
  invalidate(): void
}

const TAP_MOVE_PX = 10
const TAP_MS = 700

export function createMarksLayer(hooks: MarksLayerHooks): MarksLayer {
  let canvas: HTMLCanvasElement | null = null
  /** Painted in the page's own document (so the page's fonts set the counts), then copied onto the frame's canvas. */
  let buf: HTMLCanvasElement | null = null
  let wrap: HTMLElement | null = null
  let frameDoc: Document | null = null
  let raf = 0
  let running = false
  let on = false
  let sig = ''
  let marks: PlacedMark[] = []
  let hover: string | null = null
  let boxes: CardBox[] = []
  let fonts: CardFonts = pageFonts()
  let down: { x: number; y: number; at: number } | null = null
  const cardAt = (p: { x: number; y: number }): CardBox | null => boxes.find((b) => b.inView && p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) ?? null

  const local = (e: { clientX: number; clientY: number }): { x: number; y: number } | null => {
    if (!canvas) return null
    const r = canvas.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  const onPane = (e: Event): boolean => {
    const t = e.target as { closest?: (s: string) => unknown } | null
    return !!wrap && !!t && typeof t.closest === 'function' && wrap.contains(e.target as Node) && !t.closest('[data-qa-id="legend"]')
  }
  const onDown = (e: PointerEvent) => {
    down = onPane(e) ? { x: e.clientX, y: e.clientY, at: Date.now() } : null
  }
  const onUp = (e: PointerEvent) => {
    const d = down
    down = null
    if (!d || Date.now() - d.at > TAP_MS || Math.hypot(e.clientX - d.x, e.clientY - d.y) > TAP_MOVE_PX) return
    const p = local(e)
    const scene = hooks.scene()
    if (!p || !scene) return
    const hit = hitMark(marks, p.x, p.y, e.pointerType === 'mouse' ? 28 : MARK_PX.tap)
    const card = hit ? null : cardAt(p)
    if (hit) hooks.onPick(hit.focus ? hit.ids[0] : pickFrom(hit, scene.focusId))
    else if (card) hooks.onPick(card.id)
  }
  const onMove = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return
    const p = onPane(e) ? local(e) : null
    const hit = p ? hitMark(marks, p.x, p.y, 24) : null
    const card = p && !hit ? cardAt(p) : null
    const next = hit ? hit.key : card ? `card:${card.id}` : null
    if (next === hover) return
    hover = next
    if (wrap) wrap.style.cursor = next ? 'pointer' : ''
  }
  const onLeave = () => {
    hover = null
  }

  const unbind = () => {
    try {
      frameDoc?.removeEventListener('pointerdown', onDown, true)
      frameDoc?.removeEventListener('pointerup', onUp, true)
      frameDoc?.removeEventListener('pointermove', onMove, true)
      frameDoc?.removeEventListener('pointerleave', onLeave, true)
      canvas?.remove()
    } catch {
      /* the frame is gone */
    }
    canvas = null
    wrap = null
    frameDoc = null
    marks = []
    boxes = []
    sig = ''
  }
  const mount = (): boolean => {
    try {
      const doc = hooks.host()?.querySelector('iframe')?.contentDocument ?? null
      if (!doc) return false
      if (canvas && canvas.isConnected && frameDoc === doc) return true
      const w = doc.querySelector('.chart-markup-table.pane .chart-gui-wrapper') as HTMLElement | null
      if (!w) return false
      unbind()
      frameDoc = doc
      wrap = w
      canvas = doc.createElement('canvas')
      canvas.setAttribute('data-called-marks', '')
      canvas.setAttribute('aria-hidden', 'true')
      canvas.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:3'
      w.appendChild(canvas)
      buf = document.createElement('canvas')
      fonts = pageFonts()
      doc.addEventListener('pointerdown', onDown, true)
      doc.addEventListener('pointerup', onUp, true)
      doc.addEventListener('pointermove', onMove, true)
      doc.addEventListener('pointerleave', onLeave, true)
      return true
    } catch {
      return false
    }
  }
  const setOn = (next: boolean) => {
    if (on === next) return
    on = next
    hooks.onMount(next)
  }
  const clear = () => {
    if (!canvas || !sig) return
    canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
    canvas.dataset.marks = '0'
    canvas.dataset.cards = '0'
    marks = []
    boxes = []
    sig = ''
  }

  /** The centre of the bar under the pane's middle, to a tenth of a pixel: every other bar is whole bars from it. */
  const reference = (chart: TvChartApi, width: number, spacing: number): { t: number; x: number } | null => {
    const scale = chart.getTimeScale()
    const mid = width / 2
    const t = scale.coordinateToTime(mid)
    if (typeof t !== 'number' || !Number.isFinite(t)) return null
    let lo = mid - spacing - 1
    let hi = mid
    if (scale.coordinateToTime(lo) === t) return { t, x: mid }
    for (let i = 0; i < 12; i++) {
      const m = (lo + hi) / 2
      if (scale.coordinateToTime(m) === t) hi = m
      else lo = m
    }
    return { t, x: hi + spacing / 2 }
  }

  const frame = () => {
    if (!running) return
    raf = requestAnimationFrame(frame)
    if (document.hidden) return
    const chart = hooks.chart()
    if (!chart || !mount() || !canvas || !wrap || !buf) {
      if (!chart) setOn(false)
      return
    }
    setOn(true)
    const scene = hooks.scene()
    if (!scene || (!scene.calls.length && !scene.cards?.length)) {
      clear()
      return
    }
    try {
      const width = wrap.clientWidth
      const height = wrap.clientHeight
      const dpr = frameDoc?.defaultView?.devicePixelRatio || 1
      const spacing = chart.getTimeScale().barSpacing()
      const barSec = resolutionSeconds(chart.resolution())
      const panes = chart.getPanes()
      const price = (panes.find((p) => p.hasMainSeries()) ?? panes[0])?.getMainSourcePriceScale() ?? null
      const ref = reference(chart, width, spacing)
      if (!(width > 0) || !(height > 0) || !(spacing > 0) || !barSec || !price || !ref) {
        clear()
        return
      }
      const p0 = (scene.calls[0] ?? scene.cards?.[0])?.priceAt ?? 1
      const inks = hooks.inks()
      const next = [width, height, dpr, spacing.toFixed(3), barSec, ref.t, ref.x.toFixed(1), price.priceToCoordinate(p0)?.toFixed(1), price.priceToCoordinate(p0 * 1.25)?.toFixed(1), scene.key, scene.focusId, scene.keepTop, scene.keepBottom, scene.keepCorner?.top, scene.cards?.length, document.fonts?.status, hover, inks.up, inks.bg].join('|')
      if (next === sig) return
      sig = next
      // Bars are whole steps of time from the reference on a market that never closes. One that does (a stock's
      // weekend) has no bar for the gap: there the bars on screen are read one by one and a call sits on its own.
      let xOf = (t: number): number => ref.x + Math.floor((t - ref.t) / barSec) * spacing
      const scale = chart.getTimeScale()
      const edge = scale.coordinateToTime(2)
      const edgeWant = ref.t + Math.floor((2 - (ref.x - spacing / 2)) / spacing) * barSec
      if (typeof edge === 'number' && Math.abs(edge - edgeWant) > barSec / 2) {
        const seen: { t: number; x: number }[] = []
        for (let x = ref.x - Math.floor(ref.x / spacing) * spacing; x <= width; x += spacing) {
          const t = scale.coordinateToTime(x)
          if (typeof t === 'number' && Number.isFinite(t)) seen.push({ t, x })
        }
        xOf = (t) => {
          if (!seen.length || t < seen[0].t) return -9999
          let at = seen[0]
          for (const b of seen) {
            if (b.t > t) break
            at = b
          }
          return at === seen[seen.length - 1] && t - at.t >= barSec * 4 ? width + 9999 : at.x
        }
      }
      marks = placeMarks({
        calls: scene.calls,
        focusId: scene.focusId,
        pane: { width, height },
        keepTop: scene.keepTop,
        keepBottom: scene.keepBottom,
        keepCorner: scene.keepCorner,
        barSec,
        spacing,
        x: xOf,
        y: (p) => price.priceToCoordinate(p),
      })
      const pw = Math.round(width * dpr)
      const ph = Math.round(height * dpr)
      if (buf.width !== pw || buf.height !== ph) {
        buf.width = pw
        buf.height = ph
      }
      if (canvas.width !== pw || canvas.height !== ph) {
        canvas.width = pw
        canvas.height = ph
      }
      const b = buf.getContext('2d')
      const c = canvas.getContext('2d')
      if (!b || !c) return
      b.setTransform(dpr, 0, 0, dpr, 0, 0)
      b.clearRect(0, 0, width, height)
      const cards = scene.cards ?? []
      boxes = cards.length && scene.layout ? scene.layout({ width, height }, cards.map((card) => ({ id: card.id, x: xOf(card.barTime), y: price.priceToCoordinate(card.priceAt) }))) : []
      for (const pass of [false, true]) {
        for (const box of boxes) {
          const card = cards.find((k) => k.id === box.id)
          const focus = box.id === scene.focusId
          if (!card || !box.inView || focus !== pass) continue
          const ty = price.priceToCoordinate(card.priceAt)
          paintCard(b, card, box, ty === null ? null : { x: xOf(card.barTime), y: ty }, inks, fonts, { focus, hover: hover === `card:${box.id}` })
        }
      }
      paintMarks(b, marks, inks, fonts.mono, hover)
      // The mark under the mouse says what it is: the call a press would open, as a card beside it.
      const over = hover && !hover.startsWith('card:') ? marks.find((m) => m.key === hover) : null
      const tipCard = over && !over.focus ? (hooks.preview?.(pickFrom(over, scene.focusId)) ?? null) : null
      if (over && tipCard) {
        const above = over.y - tipCard.h - 10 >= scene.keepTop
        const box: CardBox = { id: tipCard.id, side: above ? 'above' : 'below', inView: true, x: Math.round(Math.max(6, Math.min(over.x + over.w / 2 - tipCard.w / 2, width - tipCard.w - 6))), y: Math.round(above ? over.y - tipCard.h - 10 : over.y + over.h + 10), w: tipCard.w, h: tipCard.h }
        paintCard(b, tipCard, box, null, inks, fonts, { focus: false, hover: true })
      }
      c.clearRect(0, 0, pw, ph)
      c.drawImage(buf, 0, 0)
      canvas.dataset.marks = String(marks.length)
      canvas.dataset.cards = String(boxes.filter((k) => k.inView).length)
      canvas.dataset.hits = JSON.stringify(marks.map((m) => [m.ids[0], Math.round(m.x + m.w / 2), Math.round(m.y + m.h / 2), m.count, m.focus ? 1 : 0]))
    } catch {
      /* the chart is between two states: the next frame draws it */
    }
  }

  return {
    start() {
      if (running || typeof requestAnimationFrame === 'undefined' || typeof document === 'undefined') return
      running = true
      raf = requestAnimationFrame(frame)
    },
    stop() {
      running = false
      if (raf && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(raf)
      raf = 0
      unbind()
      buf = null
      setOn(false)
    },
    invalidate() {
      sig = ''
    },
  }
}

/** The margin the library's own screenshot leaves around the chart, in CSS px (measured on v33.1.0: it grows with the device's pixel ratio; the pane itself is drawn one canvas px to the CSS px). */
const SHOT_MARGIN_PX = 10

/**
 * The marks and cards, stamped onto the chart's own picture (Share). The layer
 * is paint over the pane, so the library's screenshot does not hold it: this
 * puts it back where the pane is. The tally line is the library's own shape
 * and is already in the picture. Does nothing where the layer is not drawing.
 */
export function stampMarks(shot: HTMLCanvasElement | null | undefined, host: HTMLElement | null | undefined): void {
  try {
    const frame = host?.querySelector('iframe')
    const layer = frame?.contentDocument?.querySelector('canvas[data-called-marks]') as HTMLCanvasElement | null | undefined
    const ctx = shot?.getContext('2d')
    if (!shot || !ctx || !layer || !(layer.width > 0) || !(layer.clientWidth > 0) || layer.dataset.marks === undefined) return
    const dpr = frame?.contentWindow?.devicePixelRatio || 1
    ctx.drawImage(layer, SHOT_MARGIN_PX * dpr, SHOT_MARGIN_PX * dpr, layer.clientWidth, layer.clientHeight)
  } catch {
    /* the picture keeps the candles and the tally */
  }
}
