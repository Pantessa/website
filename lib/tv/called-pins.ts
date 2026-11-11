// CALLED IT on the Advanced chart: an X handle's calls as the library's own
// shapes (squad called-it, lane CHART, 2026-11-11).
//
// What is drawn, and why each choice:
//
//   a CARD per picked call    the library's `callout`: its tip on the bar the
//                             post landed on (that day's close), its box on a
//                             RAIL above or below the candles. Native, so it
//                             pans and zooms with the bars and is in the
//                             chart's own screenshot.
//   a MARK per other call     the datafeed's bar marks (a small disc over the
//                             bar): a glyph and a color for the verdict, the
//                             words in its tooltip. On a phone every call is
//                             a mark: a card would hide the candles.
//   the TALLY on the pane     one fixed line in the pane's corner: the full
//                             count and who plotted it. A viewer chooses the
//                             pins, nobody chooses the count, and the count is
//                             in every picture of the pins (honesty rule 4).
//
// Rules this file holds (pinned in scripts/called-chart-pins):
//   · A pin is created locked, unselectable, never saved, never undoable. It
//     is data on the chart, not one of the viewer's drawings: it cannot be
//     edited (a post's words are X's own), it is not in the saved layout, it
//     is not in "Your drawings", and it never crosses the bridge into Ask the
//     chart, Share or a published call (`withoutCalled`, `cleanLayout`).
//   · The words on a card are the post's own, cut by code and marked with an
//     ellipsis where cut (`clampPost`). Nothing rewrites them.
//   · Right and wrong differ by color AND by word (and by glyph on a mark).
//   · No two cards overlap at the zoom a plot opens on, and a card never
//     leaves the pane (`layoutCallouts`).
//
// The first half is pure (no browser, no library). The controller at the end
// is the only part that touches the chart, through the hand-written types in
// lib/tv/types (the library itself is licensed and never in this repository).

import { ADDED_MARK, PIN_URL_MAX, VERDICT_WORDS, cmpPostId, moveLine, recordHref, type CallVerdict, type CalledCall, type CalledRecord } from '@/lib/called-it/spec'
import type { ShapeSnapshot } from './shapes'
import type { TvChartApi, TvDatafeed, TvMark, TvPoint, TvPriceScaleApi, TvShapeOptions, TvWidget } from './types'

// ── The words on a pin ──────────────────────────────────────────────────

/** A card shows this many of the post's characters at most. */
export const PIN_WORDS_MAX = 90
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const
const ELLIPSIS = '\u2026'
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g

/** `10 Jan 2026`, the UTC day the post was made. */
export function pinDate(ms: number): string {
  const d = new Date(ms)
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

/** X's text on one line: control and direction characters out, runs of whitespace as one space. No word is changed. */
export function cleanPostText(text: string): string {
  return text.replace(CONTROL_RE, ' ').replace(/\s+/g, ' ').trim()
}

const segmenter: { segment(s: string): Iterable<{ segment: string }> } | null = (() => {
  try {
    const I = Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: 'grapheme' }) => { segment(s: string): Iterable<{ segment: string }> } }
    return I.Segmenter ? new I.Segmenter(undefined, { granularity: 'grapheme' }) : null
  } catch {
    return null
  }
})()
/** What a reader counts as characters (an emoji is one, never half of one). */
export function graphemes(s: string): string[] {
  return segmenter ? Array.from(segmenter.segment(s), (x) => x.segment) : Array.from(s)
}

/** Cut `chars[from, to)` back to a word boundary when one is near; never returns nothing. */
function backToWord(chars: readonly string[], from: number, to: number): number {
  if (to >= chars.length || chars[to] === ' ') return to
  for (let i = to; i > from && to - i <= 14; i--) if (chars[i - 1] === ' ') return i - 1
  return to
}
function forwardToWord(chars: readonly string[], from: number): number {
  if (from <= 0 || chars[from - 1] === ' ') return from
  for (let i = from; i < chars.length && i - from <= 14; i++) if (chars[i] === ' ') return i + 1
  return from
}

/**
 * The post's words for a small card: all of them when they fit, else ONE
 * contiguous span with an ellipsis at each cut. The span is the start of the
 * post unless the quote that carries the call would be cut off, in which case
 * it is the span around the quote. Never more than `max` characters, the
 * ellipses included. Nothing is reworded.
 */
export function clampPost(text: string, quote: string | null | undefined, max: number = PIN_WORDS_MAX): string {
  const chars = graphemes(cleanPostText(text))
  if (chars.length <= max) return chars.join('')
  const flat = chars.join('')
  const q = quote ? cleanPostText(quote) : ''
  const qAt = q ? flat.indexOf(q) : -1
  // Positions in `chars` (graphemes), not in the string.
  const qStart = qAt < 0 ? -1 : graphemes(flat.slice(0, qAt)).length
  const qEnd = qStart < 0 ? -1 : qStart + graphemes(q).length
  const headEnd = backToWord(chars, 0, max - 1)
  if (qStart < 0 || qEnd <= headEnd) return `${chars.slice(0, headEnd).join('').trimEnd()}${ELLIPSIS}`
  // The quote sits past the head: open the window a few words before it.
  const room = max - 2
  let from = forwardToWord(chars, Math.max(0, qStart - Math.max(0, Math.floor((room - (qEnd - qStart)) / 3))))
  if (from > qStart) from = qStart
  let to = Math.min(chars.length, from + room)
  if (to < chars.length) to = backToWord(chars, Math.max(from + 1, Math.min(qEnd, to)), to)
  const body = chars.slice(from, to).join('').trim()
  return `${from > 0 ? ELLIPSIS : ''}${body}${to < chars.length ? ELLIPSIS : ''}`
}

/** Text width in px. The browser hands in the canvas's own measure; the pins use `estimateTextWidth`. */
export type Measure = (text: string) => number

/** A cautious width for a proportional sans at `fontPx` (a little over the real one, so a card is never drawn wider than planned). */
export function estimateTextWidth(text: string, fontPx: number): number {
  let em = 0
  for (const ch of graphemes(text)) {
    const cp = ch.codePointAt(0) ?? 0
    if (cp > 0x2e7f || ch.length > 1) em += 1.05
    else if (/[ilI.,:;'|!\u00b7 ]/.test(ch)) em += 0.3
    else if (/[mwMW@%]/.test(ch)) em += 0.86
    else if (/[A-Z0-9+\-]/.test(ch)) em += 0.64
    else em += 0.55
  }
  return em * fontPx
}

/**
 * Wrap to `maxWidth`, at most `maxLines` lines. Text that fits without a cut
 * is BALANCED: the same number of lines, as even as they go (no last line of
 * one word, and a narrower card). When `maxLines` cuts it, the last line ends
 * in an ellipsis that fits.
 */
export function wrapWords(text: string, maxWidth: number, measure: Measure, maxLines: number): string[] {
  const greedy = wrapGreedy(text, maxWidth, measure, maxLines)
  if (greedy.cut || greedy.lines.length < 2) return greedy.lines
  // The narrowest width that still takes no more lines.
  let lo = Math.max(...text.split(' ').map((w) => Math.min(maxWidth, measure(w))))
  let hi = maxWidth
  let best = greedy.lines
  for (let i = 0; i < 12 && hi - lo > 1; i++) {
    const mid = (lo + hi) / 2
    const tried = wrapGreedy(text, mid, measure, maxLines)
    if (!tried.cut && tried.lines.length <= greedy.lines.length) {
      hi = mid
      best = tried.lines
    } else lo = mid
  }
  return best
}

function wrapGreedy(text: string, maxWidth: number, measure: Measure, maxLines: number): { lines: string[]; cut: boolean } {
  const words = text.split(' ').filter(Boolean)
  const lines: string[] = []
  let line = ''
  let cut = false
  const pushLong = (word: string) => {
    // A word wider than the card (a link, a long cashtag run) breaks by character.
    let part = ''
    for (const ch of graphemes(word)) {
      if (part && measure(part + ch) > maxWidth) {
        lines.push(part)
        part = ch
      } else part += ch
    }
    line = part
  }
  for (const word of words) {
    const next = line ? `${line} ${word}` : word
    if (measure(next) <= maxWidth) {
      line = next
      continue
    }
    if (line) lines.push(line)
    line = ''
    if (measure(word) <= maxWidth) line = word
    else pushLong(word)
  }
  if (line) lines.push(line)
  if (lines.length > maxLines) {
    lines.length = maxLines
    cut = true
  }
  if (cut) {
    let last = graphemes(lines[maxLines - 1].replace(/\u2026$/, ''))
    while (last.length > 1 && measure(`${last.join('').trimEnd()}${ELLIPSIS}`) > maxWidth) last = last.slice(0, -1)
    lines[maxLines - 1] = `${last.join('').trimEnd()}${ELLIPSIS}`
  }
  return { lines, cut }
}

export interface PinText {
  /** `@handle \u00b7 10 Jan 2026` */
  head: string
  /** The post's own words, wrapped. */
  words: string[]
  /** `-29.1% in 30 days \u00b7 missed` */
  result: string
  /** A viewer pasted this post (it says so on its own line). */
  added: boolean
  lines: string[]
  /** What the shape is given. */
  text: string
}

/**
 * The lines of a card: who and when, the post's own words (X's text and
 * nothing else), the move with the verdict's word. A post a viewer pasted
 * says so on a line of its own (the spec's mark) and gives up one line of its
 * words for it, so every card is the same height at most. No line is ever
 * wider than the card: a long handle or a long result takes two lines.
 */
export function pinText(call: Pick<CalledCall, 'text' | 'quote' | 'postedAt' | 'verdict' | 'judgedPct'> & { origin?: CalledCall['origin'] }, handle: string, opts: { textWidth: number; measure: Measure; wordLines: number }): PinText {
  const fit = (whole: string, parts: string[]) => (opts.measure(whole) <= opts.textWidth ? [whole] : parts)
  const added = call.origin === 'added'
  const head = `@${handle} \u00b7 ${pinDate(call.postedAt)}`
  const result = `${moveLine(call)} \u00b7 ${VERDICT_WORDS[call.verdict]}`
  const headLines = [...fit(head, [`@${handle}`, pinDate(call.postedAt)]), ...(added ? [ADDED_MARK] : [])]
  const resultLines = fit(result, [moveLine(call), VERDICT_WORDS[call.verdict]])
  const spare = Math.max(1, opts.wordLines - (headLines.length - 1) - (resultLines.length - 1))
  const words = wrapWords(clampPost(call.text, call.quote), opts.textWidth, opts.measure, spare)
  const lines = [...headLines, ...words, ...resultLines]
  return { head, words, result, added, lines, text: lines.join('\n') }
}

// ── Color, glyph and word ───────────────────────────────────────────────

export interface CalledInks {
  up: string
  down: string
  fg: string
  bg: string
  surf: string
  muted: string
  line: string
}

/** One glyph per verdict: a mark is too small for a word, and color alone is not enough. */
export const VERDICT_GLYPH: Readonly<Record<CallVerdict, string>> = { right: '\u2713', wrong: '\u2715', flat: '\u2013', open: '?' }

export interface VerdictLook {
  /** The verdict's color: the card's border and leader, the mark's ring. */
  ink: string
  glyph: string
  word: string
  /** A hit or a miss is a filled mark; the two that are not results are hollow. */
  filled: boolean
}

export function verdictLook(verdict: CallVerdict, inks: CalledInks): VerdictLook {
  const ink = verdict === 'right' ? inks.up : verdict === 'wrong' ? inks.down : inks.muted
  return { ink, glyph: VERDICT_GLYPH[verdict], word: VERDICT_WORDS[verdict], filled: verdict === 'right' || verdict === 'wrong' }
}

// ── How many cards a pane holds ─────────────────────────────────────────

export const CALLOUT_FONT_PX = 12
/** The library sets a callout's lines one font-size apart and pads the box by this much. */
export const CALLOUT_LINE_PX = CALLOUT_FONT_PX
export const CALLOUT_PAD_PX = 10
export const CALLOUT_GAP_PX = 10
const TEXT_W_MIN = 180
const TEXT_W_MAX = 236
/** The pane's own furniture a card must stay clear of (measured on v33.1.0). */
export const PANE_KEEP = {
  /** The legend's first row (symbol, O H L C) runs across the top. */
  top: 34,
  /** Its second row (Volume) and the fold button sit under it at the left. */
  topLeftWidth: 112,
  /** The library's logo, bottom left. The tally starts to its right. */
  logoWidth: 52,
  edge: 8,
} as const
/** Under this pane width every call is a mark (a phone): a card would cover the candles it points at. */
export const CARDS_MIN_PANE_W = 520
const CARDS_MIN_PANE_H = 300
/** Air between a rail of cards and the candles. */
const RAIL_AIR_PX = 18

export interface PaneSize {
  width: number
  height: number
}

export interface CalloutPlan {
  /** Cards one rail holds side by side. 0 = marks only. */
  perRail: number
  /** Cards on the whole pane (two rails). */
  total: number
  /** The widest a card's text may run, px. */
  textWidth: number
  /** Lines of the post's words on a card (2, or 3 on a tall pane). */
  wordLines: number
}

/** What a pane of this size holds. Pure: the same pane always holds the same cards. */
export function calloutPlan(pane: PaneSize): CalloutPlan {
  const none: CalloutPlan = { perRail: 0, total: 0, textWidth: TEXT_W_MAX, wordLines: 2 }
  if (!(pane.width >= CARDS_MIN_PANE_W) || !(pane.height >= CARDS_MIN_PANE_H)) return none
  // The upper rail is the narrow one (the legend's corner): it sets the count.
  const room = pane.width - PANE_KEEP.topLeftWidth - PANE_KEEP.edge
  for (let n = 4; n >= 1; n--) {
    const textWidth = Math.floor((room - (n - 1) * CALLOUT_GAP_PX) / n) - 2 * CALLOUT_PAD_PX
    if (textWidth >= TEXT_W_MIN) return { perRail: n, total: Math.min(PIN_URL_MAX, n * 2), textWidth: Math.min(TEXT_W_MAX, textWidth), wordLines: pane.height >= 470 ? 3 : 2 }
  }
  return none
}

/** The picked calls that get a card: the highest impact first when the pane holds fewer than were picked. Ids, date ascending. */
export function boxedIds(calls: readonly Pick<CalledCall, 'postId' | 'picked' | 'impact' | 'postedAt'>[], total: number): string[] {
  const picked = calls.filter((c) => c.picked)
  if (total <= 0) return []
  const keep = picked.length <= total ? picked : [...picked].sort((a, b) => b.impact - a.impact || cmpPostId(a.postId, b.postId)).slice(0, total)
  return [...keep].sort((a, b) => a.postedAt - b.postedAt || cmpPostId(a.postId, b.postId)).map((c) => c.postId)
}

export interface BoxSize {
  w: number
  h: number
}

/** The box the library draws for these lines, its own wrap off (measured on v33.1.0: the widest line + 10px a side, one font-size a line + 10px top and bottom). */
export function boxSize(lines: readonly string[], measure: Measure): BoxSize {
  const widest = lines.reduce((m, l) => Math.max(m, measure(l)), 0)
  // Never narrower than what will be drawn (`pinText` keeps every line inside the card's text width).
  return { w: Math.ceil(widest) + 2 * CALLOUT_PAD_PX, h: lines.length * CALLOUT_LINE_PX + 2 * CALLOUT_PAD_PX }
}

// ── Where the cards go ──────────────────────────────────────────────────

export type RailSide = 'above' | 'below'

export interface PinAnchor {
  id: string
  /** The bar's centre across the pane, px. Null when the bar is not on screen. */
  x: number | null
  /** The call's price down the pane, px. Null when the scale cannot say. */
  y: number | null
}

export interface PlacedBox {
  id: string
  side: RailSide
  /** On screen now. A card whose bar is off screen waits beside its bar. */
  inView: boolean
  /** Top-left, px in the pane. */
  x: number
  y: number
  w: number
  h: number
}

export interface LayoutInput {
  pane: PaneSize
  /** Every card, date ascending. The order fixes each card's rail. */
  anchors: readonly PinAnchor[]
  sizes: Readonly<Record<string, BoxSize>>
  /** Px the tally line takes at the pane's foot. */
  keepBottom: number
  /** Px the legend's own row takes at the pane's head (it wraps to two rows on a narrow pane). Default: one row. */
  keepTop?: number
  /** The first card's rail; the rest alternate. */
  startAbove?: boolean
  gap?: number
}

/** A card's rail by its place in date order: they alternate, so neighbors in time never share a rail. */
export function railOf(index: number, startAbove: boolean): RailSide {
  return (index % 2 === 0) === startAbove ? 'above' : 'below'
}

/**
 * Spread boxes along one rail: each as close to its anchor as it can be,
 * none overlapping, none outside [lo, hi]. `items` are in anchor order and
 * stay in it (so two leaders never cross). Returns left edges.
 */
export function spreadRail(items: readonly { cx: number; w: number }[], lo: number, hi: number, gap: number): number[] {
  const n = items.length
  const left = items.map((it) => it.cx - it.w / 2)
  // Left to right: nothing before `lo`, nothing on top of its neighbor.
  for (let i = 0; i < n; i++) left[i] = Math.max(left[i], i === 0 ? lo : left[i - 1] + items[i - 1].w + gap)
  // Right to left: nothing past `hi`.
  for (let i = n - 1; i >= 0; i--) left[i] = Math.min(left[i], i === n - 1 ? hi - items[i].w : left[i + 1] - gap - items[i].w)
  // A rail too full to hold them all keeps the left edge (the plan never asks for this).
  for (let i = 0; i < n; i++) left[i] = Math.max(left[i], i === 0 ? lo : left[i - 1] + items[i - 1].w + gap)
  return left.map((x) => Math.round(x))
}

/** The pane rows the two rails stand on. */
export function railRows(pane: PaneSize, keepBottom: number, maxBoxH: number, keepTop: number = PANE_KEEP.top): { aboveTop: number; belowBottom: number } {
  return { aboveTop: keepTop, belowBottom: Math.max(keepTop + maxBoxH * 2 + RAIL_AIR_PX, pane.height - keepBottom) }
}

/** The upper rail's row from the legend's measured foot: never above one legend row, never so low the rail eats the pane. */
export function keepTopFor(legendBottomPx: number | null): number {
  if (legendBottomPx === null || !Number.isFinite(legendBottomPx)) return PANE_KEEP.top
  return Math.max(PANE_KEEP.top, Math.min(96, Math.round(legendBottomPx) + 6))
}

/** Which rail the first card takes: the one that makes the leaders shorter in all. Decided once per plot. */
export function pickStartSide(input: Pick<LayoutInput, 'pane' | 'anchors' | 'sizes' | 'keepBottom' | 'keepTop'>): boolean {
  const maxH = Math.max(0, ...Object.values(input.sizes).map((s) => s.h))
  const rows = railRows(input.pane, input.keepBottom, maxH, input.keepTop)
  const cost = (startAbove: boolean) =>
    input.anchors.reduce((sum, a, i) => {
      if (a.y === null) return sum
      const h = input.sizes[a.id]?.h ?? maxH
      return sum + (railOf(i, startAbove) === 'above' ? Math.abs(a.y - (rows.aboveTop + h)) : Math.abs(rows.belowBottom - h - a.y))
    }, 0)
  return cost(true) <= cost(false)
}

/**
 * Every card's box. Cards alternate between a rail above the candles and one
 * below, in date order; on a rail each sits over (or under) its own bar and
 * slides sideways only as far as a neighbor or the pane's edge makes it. No
 * two overlap and none leaves the pane.
 */
export function layoutCallouts(input: LayoutInput): PlacedBox[] {
  const gap = input.gap ?? CALLOUT_GAP_PX
  const startAbove = input.startAbove ?? true
  const { pane } = input
  const size = (id: string): BoxSize => input.sizes[id] ?? { w: TEXT_W_MAX + 2 * CALLOUT_PAD_PX, h: 4 * CALLOUT_LINE_PX + 2 * CALLOUT_PAD_PX }
  const maxH = Math.max(0, ...input.anchors.map((a) => size(a.id).h))
  const rows = railRows(pane, input.keepBottom, maxH, input.keepTop)
  const out: PlacedBox[] = []
  for (const side of ['above', 'below'] as const) {
    const rail = input.anchors.map((a, i) => ({ a, i })).filter(({ i }) => railOf(i, startAbove) === side)
    const seen = rail.filter(({ a }) => a.x !== null && a.x >= 0 && a.x <= pane.width)
    const lo = side === 'above' ? PANE_KEEP.topLeftWidth : PANE_KEEP.edge
    const hi = pane.width - PANE_KEEP.edge
    const lefts = spreadRail(seen.map(({ a }) => ({ cx: a.x as number, w: size(a.id).w })), lo, hi, gap)
    seen.forEach(({ a }, k) => {
      const s = size(a.id)
      out.push({ id: a.id, side, inView: true, x: lefts[k], y: side === 'above' ? rows.aboveTop : rows.belowBottom - s.h, w: s.w, h: s.h })
    })
    for (const { a } of rail) {
      if (seen.some((x) => x.a === a)) continue
      // Off screen: the card waits on its rail's row, centred on its bar (wherever that is).
      const s = size(a.id)
      out.push({ id: a.id, side, inView: false, x: Math.round((a.x ?? -9999) - s.w / 2), y: side === 'above' ? rows.aboveTop : rows.belowBottom - s.h, w: s.w, h: s.h })
    }
  }
  const order = new Map(input.anchors.map((a, i) => [a.id, i]))
  return out.sort((p, q) => (order.get(p.id) ?? 0) - (order.get(q.id) ?? 0))
}

export function boxesOverlap(a: Pick<PlacedBox, 'x' | 'y' | 'w' | 'h'>, b: Pick<PlacedBox, 'x' | 'y' | 'w' | 'h'>): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

/**
 * The pane's top and bottom margins (percent) while a plot is on it: room for
 * the two rails of cards, or (marks only) just room for the tally line at the
 * foot. Never tighter than the margins the viewer already had.
 */
export function railMargins(pane: PaneSize, plan: CalloutPlan, maxBoxH: number, keepBottom: number, base: { top: number; bottom: number }, keepTop: number = PANE_KEEP.top): { top: number; bottom: number } {
  if (!(pane.height > 0)) return base
  const pct = (px: number) => Math.min(38, Math.ceil((px / pane.height) * 100))
  if (plan.total === 0) return { top: base.top, bottom: Math.max(base.bottom, pct(keepBottom + 6)) }
  return { top: Math.max(base.top, pct(keepTop + maxBoxH + RAIL_AIR_PX)), bottom: Math.max(base.bottom, pct(keepBottom + maxBoxH + RAIL_AIR_PX)) }
}

// ── The time axis, sampled ──────────────────────────────────────────────
// The library answers "which bar is at this pixel" and has no call for the
// reverse, so the controller samples the first across the pane and these two
// read the samples. Pure.

export interface AxisSample {
  x: number
  /** The open time (seconds) of the bar drawn at x. */
  t: number
}

/** The centre of the bar that holds `t`, px; null when that bar is not on screen. */
export function xForTime(samples: readonly AxisSample[], t: number): number | null {
  if (!samples.length || t < samples[0].t) return null
  // One run of samples per bar on screen.
  const bars: { t: number; lo: number; hi: number }[] = []
  for (const s of samples) {
    const last = bars[bars.length - 1]
    if (last && last.t === s.t) last.hi = s.x
    else bars.push({ t: s.t, lo: s.x, hi: s.x })
  }
  let step = Infinity
  for (let i = 1; i < bars.length; i++) step = Math.min(step, bars[i].t - bars[i - 1].t)
  let at = -1
  for (let i = 0; i < bars.length && bars[i].t <= t; i++) at = i
  if (at < 0) return null
  // Past the newest bar on screen by a whole bar or more: that call's bar is off to the right.
  if (at === bars.length - 1 && t - bars[at].t >= step) return null
  return (bars[at].lo + bars[at].hi) / 2
}

/** The bar time at pixel `x`, clamped to the bars on screen. */
export function timeForX(samples: readonly AxisSample[], x: number): number | null {
  if (!samples.length) return null
  let best = samples[0]
  for (const s of samples) {
    if (Math.abs(s.x - x) < Math.abs(best.x - x)) best = s
    if (s.x > x) break
  }
  return best.t
}

// ── The shapes and the marks, as data ───────────────────────────────────

/** The options every pin shape is made with. One place, pinned. */
export const PIN_SHAPE_FLAGS = { lock: true, disableSelection: true, disableSave: true, disableUndo: true, zOrder: 'top', showInObjectsTree: false } as const

export interface CalloutSpec {
  points: [TvPoint, TvPoint]
  options: TvShapeOptions
}

/** One card: its tip on the bar and the day's close, its box centred at `box`. */
export function calloutShape(call: Pick<CalledCall, 'barTime' | 'priceAt' | 'verdict'> & { origin?: CalledCall['origin'] }, text: PinText, box: { time: number; price: number }, inks: CalledInks, opts: { focus?: boolean } = {}): CalloutSpec {
  const look = verdictLook(call.verdict, inks)
  return {
    points: [
      { time: call.barTime, price: call.priceAt },
      { time: box.time, price: box.price },
    ],
    options: {
      shape: 'callout',
      text: text.text,
      ...PIN_SHAPE_FLAGS,
      // The lines are wrapped here (wrapWords) and the library's own wrap is off: with it on, every box is drawn the full
      // wrap width whatever it says (measured on v33.1.0), and a short post would cover candles for nothing.
      // A pasted post's card is set in italics (and says "added by a viewer" on its first line): a scanned call's never is.
      overrides: { backgroundColor: inks.surf, bordercolor: look.ink, color: inks.fg, fontsize: CALLOUT_FONT_PX, bold: false, italic: call.origin === 'added', linewidth: opts.focus ? 2 : 1, transparency: 0, wordWrap: false },
    },
  }
}

export const CALLED_MARK_PREFIX = 'called:'

/** A mark's tooltip. The library escapes it (measured: a tag is shown as its characters), and it still carries only one line. */
export function markTooltip(call: Pick<CalledCall, 'text' | 'quote' | 'postedAt' | 'verdict' | 'judgedPct'> & { origin?: CalledCall['origin'] }, handle: string): string {
  return `@${handle} \u00b7 ${pinDate(call.postedAt)}${call.origin === 'added' ? ` \u00b7 ${ADDED_MARK}` : ''} \u00b7 ${moveLine(call)} \u00b7 ${VERDICT_WORDS[call.verdict]}: ${clampPost(call.text, call.quote)}`
}

/** Every call that has no card, as a bar mark. */
export function calledMarks(record: Pick<CalledRecord, 'handle' | 'calls'>, boxed: ReadonlySet<string> | readonly string[], inks: CalledInks): TvMark[] {
  const has = boxed instanceof Set ? boxed : new Set(boxed)
  return record.calls
    .filter((c) => !has.has(c.postId))
    .map((c) => {
      const look = verdictLook(c.verdict, inks)
      // A pasted post's mark is a ring, never a filled disc: it is shown and not counted.
      const filled = look.filled && c.origin !== 'added'
      return {
        id: `${CALLED_MARK_PREFIX}${c.postId}`,
        time: c.barTime,
        color: { border: look.ink, background: filled ? look.ink : inks.surf },
        text: markTooltip(c, record.handle),
        label: look.glyph,
        labelFontColor: filled ? inks.bg : c.origin === 'added' && look.filled ? look.ink : inks.fg,
        minSize: 16,
      }
    })
}

/** The post a clicked mark stands for, or null when the mark is not ours. */
export function postIdOfMark(markId: unknown): string | null {
  return typeof markId === 'string' && markId.startsWith(CALLED_MARK_PREFIX) ? markId.slice(CALLED_MARK_PREFIX.length) : null
}

/** Add the plot's marks to a datafeed's own (the wallet's fills). The feed's answer is never dropped or reordered. */
export function withCalledMarks<F extends Pick<TvDatafeed, 'getMarks'>>(feed: F, read: (ticker: string) => readonly TvMark[]): F {
  const inner = feed.getMarks.bind(feed)
  feed.getMarks = (info, from, to, onData, resolution) =>
    inner(
      info,
      from,
      to,
      (marks) => {
        let ours: TvMark[] = []
        try {
          ours = read(info.ticker).filter((m) => m.time >= from && m.time <= to)
        } catch {
          /* the feed's own marks still draw */
        }
        onData(ours.length ? [...marks, ...ours] : marks)
      },
      resolution,
    )
  return feed
}

export const TALLY_FONT_PX = 11
/** On a pane too narrow for cards (a phone) the tally is set a size down: it is three times the lines there. */
export function tallyFontPx(pane: PaneSize): number {
  return pane.width < CARDS_MIN_PANE_W ? 10 : TALLY_FONT_PX
}

export interface TallyLabel {
  text: string
  lines: number
  fontPx: number
  /** Px the label takes at the pane's foot, its own air included. */
  keepBottom: number
}

/**
 * The lines on the pane, all of them the record's own words (lib/called-it/spec,
 * untouched): the headline (the count of what the scan found, or "no tally"
 * when nothing was scanned), what the scan read (where the pane has room for
 * cards; a phone's strip carries it), that pasted posts are shown and not
 * counted (when any are), who plotted it, and where the record lives.
 */
export function tallyLabel(record: Pick<CalledRecord, 'handle' | 'symbol' | 'side' | 'words'>, pane: PaneSize, measure?: Measure): TallyLabel {
  const fontPx = tallyFontPx(pane)
  const width = measure ?? ((s: string) => estimateTextWidth(s, fontPx))
  const wrapWidth = Math.max(140, Math.floor(pane.width - PANE_KEEP.logoWidth - PANE_KEEP.edge - 12))
  const where = `pantessa.com${recordHref(record.handle, record.symbol, record.side)}`
  const coverage = pane.width >= CARDS_MIN_PANE_W ? record.words.coverage : null
  // Each sentence starts its own line (a count is never split from its own words by another sentence); the address joins the standing line when both fit.
  const last = width(`${record.words.standing} ${where}`) <= wrapWidth ? [`${record.words.standing} ${where}`] : [record.words.standing, where]
  const parts = [record.words.headline, ...(coverage ? [coverage] : []), ...(record.words.added ? [record.words.added] : []), ...last]
  const lines = parts.flatMap((p) => wrapWords(p, wrapWidth, width, 4))
  return { text: lines.join('\n'), lines: lines.length, fontPx, keepBottom: lines.length * fontPx + 22 }
}

/** The tally's shape: fixed to the pane (it does not pan), same flags as a pin. The lines are wrapped here; the library's wrap is off. */
export function tallyShape(label: TallyLabel, inks: CalledInks): TvShapeOptions {
  return {
    shape: 'anchored_text',
    text: label.text,
    ...PIN_SHAPE_FLAGS,
    overrides: { color: inks.muted, fontsize: label.fontPx, bold: false, italic: false, fillBackground: true, backgroundColor: inks.bg, backgroundTransparency: 18, drawBorder: false, wordWrap: false },
  }
}

// ── The view a plot opens on ────────────────────────────────────────────

const DAY_SEC = 86_400
/** A plot never opens tighter than this (one recent call is not a three-day chart). */
const FIT_MIN_DAYS = 120

/** Daily bars from a little before the first call to now: every pin on screen. Seconds. */
export function fitRange(calls: readonly Pick<CalledCall, 'barTime'>[], nowSec: number): { from: number; to: number } | null {
  if (!calls.length) return null
  const first = calls.reduce((m, c) => Math.min(m, c.barTime), Infinity)
  const start = Math.min(first, nowSec - FIT_MIN_DAYS * DAY_SEC)
  const pad = Math.max(10 * DAY_SEC, Math.round((nowSec - start) * 0.07))
  return { from: start - pad, to: nowSec }
}

// ── Nothing of a plot is ever kept ──────────────────────────────────────

/** The chart's shapes without the plot's: what the plan, the bridge and Ask the chart are given. */
export function withoutCalled<T extends Pick<ShapeSnapshot, 'id'>>(shapes: readonly T[], owns: (id: string) => boolean): T[] {
  return shapes.filter((s) => !owns(s.id))
}

export interface PaneMargins {
  top: number
  bottom: number
}

/** The margins a saved layout holds (percent), or the library's defaults. */
export function readMargins(layout: unknown): PaneMargins {
  const pp = (layout as { charts?: { chartProperties?: { paneProperties?: { topMargin?: unknown; bottomMargin?: unknown } } }[] } | null)?.charts?.[0]?.chartProperties?.paneProperties
  const n = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 50 ? v : d)
  return { top: n(pp?.topMargin, 10), bottom: n(pp?.bottomMargin, 8) }
}

/**
 * A layout on its way to storage, with nothing of a plot in it: no source
 * whose id is a pin's (the library already leaves them out; this is the
 * second lock) and, while a plot has widened the pane's margins to make room
 * for the rails, the margins the viewer had before. Returns a copy; anything
 * that is not a layout comes back as it was.
 */
export function cleanLayout(layout: object, owns: (id: string) => boolean, margins: { original: PaneMargins; applied: PaneMargins } | null): object {
  let copy: { charts?: unknown }
  try {
    copy = JSON.parse(JSON.stringify(layout)) as { charts?: unknown }
  } catch {
    return layout
  }
  if (!Array.isArray(copy.charts)) return layout
  const near = (a: unknown, b: number) => typeof a === 'number' && Math.abs(a - b) < 0.0051
  for (const chart of copy.charts as { panes?: unknown; chartProperties?: { paneProperties?: Record<string, unknown> } }[]) {
    if (!chart) continue
    const pp = chart.chartProperties?.paneProperties
    if (margins && pp) {
      if (near(pp.topMargin, margins.applied.top)) pp.topMargin = margins.original.top
      if (near(pp.bottomMargin, margins.applied.bottom)) pp.bottomMargin = margins.original.bottom
    }
    if (!Array.isArray(chart.panes)) continue
    for (const pane of chart.panes as { sources?: unknown; leftAxisesState?: unknown; rightAxisesState?: unknown }[]) {
      if (!pane) continue
      if (Array.isArray(pane.sources)) pane.sources = (pane.sources as { id?: unknown }[]).filter((s) => !(s && typeof s.id === 'string' && owns(s.id)))
      for (const axes of [pane.leftAxisesState, pane.rightAxisesState]) {
        if (!Array.isArray(axes)) continue
        for (const axis of axes as { state?: Record<string, unknown>; sources?: unknown }[]) {
          if (!axis) continue
          if (Array.isArray(axis.sources)) axis.sources = (axis.sources as unknown[]).filter((id) => !(typeof id === 'string' && owns(id)))
          if (margins && axis.state) {
            if (near(axis.state.m_topMargin, margins.applied.top / 100)) axis.state.m_topMargin = margins.original.top / 100
            if (near(axis.state.m_bottomMargin, margins.applied.bottom / 100)) axis.state.m_bottomMargin = margins.original.bottom / 100
          }
        }
      }
    }
  }
  return copy
}

// ─────────────────────────────────────────────────────────────────────────
//  THE CONTROLLER: the only part that touches the chart.
// ─────────────────────────────────────────────────────────────────────────

export interface CalledPinsInput {
  /** The plot, or null for none. Drawn only on its own symbol's chart. */
  record: CalledRecord | null
  /** The call the strip is pointing at (a thicker card). */
  focusId: string | null
  /** Bumped to ask for "fit all calls": daily bars, every pin on screen. 0 = never asked. */
  fitNonce: number
}

export interface CalledPinsHooks {
  symbol: string
  inks(): CalledInks
  /** A card or a mark was clicked. */
  onPick(postId: string): void
  /** How many cards are on the chart (0 = marks only), for the strip's wording. */
  onCards?(count: number): void
  /** This chart can draw the plot (true once attached, false when it goes away): the strip offers "Fit all calls" only then. */
  onAttach?(on: boolean): void
}

export interface CalledPinsController {
  attach(widget: TvWidget, chart: TvChartApi, host?: HTMLElement | null): void
  detach(): void
  set(input: CalledPinsInput): void
  /** Is this chart entity one of the plot's shapes? */
  owns(id: string): boolean
  /** A drawing event for one of the plot's shapes. Returns true when it was ours (the page's own handler stops there). */
  event(id: string, type: string): boolean
  /** The marks for the datafeed (`withCalledMarks`). */
  marks(ticker: string): readonly TvMark[]
  /** A layout on its way to storage (`cleanLayout`). */
  cleanLayout(layout: object): object
  /** The site's theme flipped: re-ink. */
  retheme(): void
}

const RELAYOUT_MS = 170
/** The scale can move without the range moving (a new high on the forming bar): the cards are checked this often. */
const DRIFT_CHECK_MS = 2500
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const sameSym = (a: string, b: string) => a.split(':').pop()?.toUpperCase() === b.split(':').pop()?.toUpperCase()

/** The canvas's own text measure, in the family the library draws with. */
function canvasMeasure(fontPx: number): Measure {
  try {
    const ctx = document.createElement('canvas').getContext('2d')
    if (!ctx) throw new Error('no canvas')
    ctx.font = `${fontPx}px -apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif`
    // A hair over the measure: a line planned to fit is never wrapped again by the library.
    return (s) => ctx.measureText(s).width * 1.02 + 1
  } catch {
    return (s) => estimateTextWidth(s, fontPx)
  }
}

/** The price drawn at pixel `y` (the scale has only the forward call; it is monotonic, so it is searched). */
function priceAtY(scale: TvPriceScaleApi, y: number, near: number): number | null {
  const at = (p: number) => scale.priceToCoordinate(p)
  if (!(near > 0)) return null
  let lo = near / 64
  let hi = near * 64
  const yLo = at(lo)
  const yHi = at(hi)
  if (yLo === null || yHi === null || yLo === yHi) return null
  // An ordinary scale draws higher prices higher up (a smaller y); an inverted one the other way.
  const falling = yHi < yLo
  for (let i = 0; i < 48; i++) {
    const mid = Math.sqrt(lo * hi)
    const ym = at(mid)
    if (ym === null) return null
    if (ym > y === falling) lo = mid
    else hi = mid
  }
  return Math.sqrt(lo * hi)
}

interface Drawn {
  shapeId: string
  postId: string
  size: BoxSize
  /** The box point the library was last given. */
  point: { time: number; price: number } | null
}

export function createCalledPins(hooks: CalledPinsHooks): CalledPinsController {
  let widget: TvWidget | null = null
  let chart: TvChartApi | null = null
  let hostEl: HTMLElement | null = null
  let input: CalledPinsInput = { record: null, focusId: null, fitNonce: 0 }
  let gen = 0
  let fitDone = 0
  let drawnKey = ''
  let cards = new Map<string, Drawn>()
  const owned = new Set<string>()
  const removing = new Set<string>()
  let labelId: string | null = null
  let labelKey = ''
  let marks: TvMark[] = []
  let plan: CalloutPlan = calloutPlan({ width: 0, height: 0 })
  let startAbove = true
  let margins: { original: PaneMargins; applied: PaneMargins } | null = null
  let relayoutTimer: ReturnType<typeof setTimeout> | null = null
  let relayoutTries = 0
  let renderTimer: ReturnType<typeof setTimeout> | null = null
  let driftTimer: ReturnType<typeof setInterval> | null = null
  let resizeWatch: ResizeObserver | null = null
  let measure: Measure = (s) => estimateTextWidth(s, CALLOUT_FONT_PX)
  const tallyMeasures = new Map<number, Measure>()
  /** The tally's text measure at the size this pane sets it in. */
  const measureTally = (pane: PaneSize): Measure => {
    const px = tallyFontPx(pane)
    let m = tallyMeasures.get(px)
    if (!m) {
      m = widget ? canvasMeasure(px) : (s: string) => estimateTextWidth(s, px)
      tallyMeasures.set(px, m)
    }
    return m
  }
  const subs: (() => void)[] = []

  const mainPane = () => {
    const panes = chart?.getPanes() ?? []
    return panes.find((p) => p.hasMainSeries()) ?? panes[0] ?? null
  }
  const paneSize = (): PaneSize | null => {
    try {
      const width = chart?.getTimeScale().width() ?? 0
      const height = mainPane()?.getHeight() ?? 0
      return width > 0 && height > 0 ? { width, height } : null
    } catch {
      return null
    }
  }
  /**
   * Where the legend's own row ends, px down the pane. The legend is the
   * library's HTML over the canvas: on a narrow pane it wraps to two rows, and
   * a card drawn under it would be written over. Read from the frame's own
   * document (same origin); null when it cannot be read, and one row is assumed.
   */
  const legendBottom = (): number | null => {
    try {
      const doc = hostEl?.querySelector('iframe')?.contentDocument
      const root = doc?.querySelector('[data-qa-id="legend"]')
      const row = doc?.querySelector('[data-qa-id="legend-series-item"]')
      if (!root || !row) return null
      const top = root.getBoundingClientRect().top
      const bottom = row.getBoundingClientRect().bottom
      return bottom > top ? bottom - top + 4 : null
    } catch {
      return null
    }
  }
  const sampleAxis = (width: number): AxisSample[] => {
    const scale = chart?.getTimeScale()
    if (!scale) return []
    const step = Math.max(1, Math.min(4, Math.floor(scale.barSpacing() / 2) || 1))
    const out: AxisSample[] = []
    for (let x = 0; x <= width; x += step) {
      const t = scale.coordinateToTime(x)
      if (typeof t === 'number' && Number.isFinite(t)) out.push({ x, t })
    }
    return out
  }
  const plotted = (): CalledRecord | null => {
    const r = input.record
    return r && sameSym(r.symbol, hooks.symbol) ? r : null
  }
  const recordKey = (r: CalledRecord, p: CalloutPlan) => {
    const ink = hooks.inks()
    return [r.handle, r.symbol, r.side, r.verified ? 'v' : 'n', r.words.headline, r.words.coverage ?? '', r.words.added ?? '', p.perRail, p.textWidth, p.wordLines, ink.bg, ink.fg, ink.up, r.calls.map((c) => `${c.postId}${c.picked ? '*' : ''}${c.origin === 'added' ? '+' : ''}${c.verdict[0]}${Math.round(c.judgedPct * 1000)}`).join(',')].join('|')
  }

  const removeShape = (id: string) => {
    removing.add(id)
    owned.delete(id)
    try {
      chart?.removeEntity(id)
    } catch {
      /* already gone */
    }
    // The library reports the removal a moment later: the id stays "ours" until then.
    setTimeout(() => removing.delete(id), 1500)
  }
  const clearShapes = () => {
    for (const d of cards.values()) removeShape(d.shapeId)
    cards = new Map()
    if (labelId) removeShape(labelId)
    labelId = null
    labelKey = ''
  }
  const refreshMarks = () => {
    try {
      chart?.clearMarks()
      chart?.refreshMarks()
    } catch {
      /* the next range change asks again */
    }
  }
  /** Widen (or give back) the pane's margins. The viewer's own are read before the first change and kept. */
  const setMargins = (want: ((base: PaneMargins) => PaneMargins) | null) => {
    const w = widget
    if (!w) return
    try {
      if (!want) {
        if (margins) w.applyOverrides({ 'paneProperties.topMargin': margins.original.top, 'paneProperties.bottomMargin': margins.original.bottom })
        margins = null
        return
      }
      const put = (original: PaneMargins) => {
        const next = want(original)
        if (margins && margins.applied.top === next.top && margins.applied.bottom === next.bottom) return
        if (!margins && next.top === original.top && next.bottom === original.bottom) return
        margins = { original, applied: next }
        w.applyOverrides({ 'paneProperties.topMargin': next.top, 'paneProperties.bottomMargin': next.bottom })
      }
      if (margins) put(margins.original)
      else w.save((s) => put(readMargins(s)))
    } catch {
      /* the rails still stand; the candles keep the room they had */
    }
  }

  const fit = async (record: CalledRecord): Promise<void> => {
    const c = chart
    const range = fitRange(record.calls, Math.floor(Date.now() / 1000))
    if (!c || !range) return
    try {
      const res = c.resolution().toUpperCase()
      if (res !== '1D' && res !== 'D') await Promise.race([Promise.resolve(c.setResolution('1D')), sleep(4000)])
      await Promise.race([c.setVisibleRange(range, { percentRightMargin: 5 }), sleep(5000)])
    } catch {
      /* the chart keeps the view it has; "Fit all calls" asks again */
    }
  }

  /** Where everything is, right now. Null while the chart cannot say (no bars yet). */
  const readView = (record: CalledRecord, ids: readonly string[]) => {
    try {
      const pane = paneSize()
      const scale = mainPane()?.getMainSourcePriceScale() ?? null
      if (!pane || !scale) return null
      const samples = sampleAxis(pane.width)
      if (!samples.length) return null
      const byId = new Map(record.calls.map((c) => [c.postId, c]))
      const anchors: PinAnchor[] = ids.map((id) => {
        const c = byId.get(id)
        return { id, x: c ? xForTime(samples, c.barTime) : null, y: c ? scale.priceToCoordinate(c.priceAt) : null }
      })
      const spacing = chart?.getTimeScale().barSpacing() ?? 6
      return { pane, scale, samples, anchors, spacing, keepTop: keepTopFor(legendBottom()) }
    } catch {
      return null
    }
  }
  type View = NonNullable<ReturnType<typeof readView>>

  const boxPoint = (view: View, box: PlacedBox, near: number): { time: number; price: number } | null => {
    const time = timeForX(view.samples, box.x + box.w / 2)
    const price = priceAtY(view.scale, box.y + box.h / 2, near)
    return time === null || price === null ? null : { time, price }
  }
  /** Is the card already where the layout wants it (to the bar it can snap to)? */
  const settled = (view: View, d: Drawn, box: PlacedBox): boolean => {
    if (!d.point) return false
    const x = xForTime(view.samples, d.point.time)
    const y = view.scale.priceToCoordinate(d.point.price)
    if (x === null || y === null) return false
    return Math.abs(x - (box.x + box.w / 2)) <= Math.max(2, view.spacing / 2 + 1) && Math.abs(y - (box.y + box.h / 2)) <= 2
  }

  const labelPos = (pane: PaneSize, keepBottom: number) => ({ x: PANE_KEEP.logoWidth / pane.width, y: Math.max(0, (pane.height - keepBottom + 8) / pane.height) })
  const placeLabel = async (record: CalledRecord, pane: PaneSize, my: number): Promise<void> => {
    const c = chart
    if (!c) return
    const label = tallyLabel(record, pane, measureTally(pane))
    const inks = hooks.inks()
    const key = `${label.text}|${label.fontPx}|${inks.bg}|${inks.muted}`
    try {
      if (labelId && labelKey === key) {
        c.getShapeById(labelId).setAnchoredPosition(labelPos(pane, label.keepBottom))
        return
      }
      if (labelId) removeShape(labelId)
      labelId = null
      const id = await c.createAnchoredShape(labelPos(pane, label.keepBottom), tallyShape(label, inks))
      if (my !== gen) {
        removeShape(id)
        return
      }
      labelId = id
      owned.add(id)
      labelKey = key
    } catch {
      /* the strip under the chart still carries the tally */
    }
  }

  const applyFocus = () => {
    const c = chart
    if (!c) return
    for (const d of cards.values()) {
      try {
        const shape = c.getShapeById(d.shapeId)
        const focus = d.postId === input.focusId
        shape.setProperties({ linewidth: focus ? 2 : 1 })
        if (focus) shape.bringToFront()
      } catch {
        /* redrawn on the next render */
      }
    }
  }

  /** Move the cards to where the view now wants them. False when the view cannot be read yet. */
  const relayout = (): boolean => {
    const c = chart
    const record = plotted()
    if (!c || !record || !drawnKey) return true
    const ids = [...cards.keys()]
    const view = readView(record, ids)
    if (!view) return false
    // A pane that now holds a different number of cards is drawn again from the top.
    const nextPlan = calloutPlan(view.pane)
    if (nextPlan.perRail !== plan.perRail || nextPlan.textWidth !== plan.textWidth || nextPlan.wordLines !== plan.wordLines) {
      schedule()
      return true
    }
    const label = tallyLabel(record, view.pane, measureTally(view.pane))
    if (labelId) {
      try {
        if (labelKey.startsWith(`${label.text}|${label.fontPx}|`)) c.getShapeById(labelId).setAnchoredPosition(labelPos(view.pane, label.keepBottom))
        else {
          drawnKey = ''
          schedule()
          return true
        }
      } catch {
        /* drawn again on the next render */
      }
    }
    if (!ids.length) return true
    const sizes = Object.fromEntries([...cards.values()].map((d) => [d.postId, d.size]))
    const placed = layoutCallouts({ pane: view.pane, anchors: view.anchors, sizes, keepBottom: label.keepBottom, keepTop: view.keepTop, startAbove })
    const byId = new Map(record.calls.map((call) => [call.postId, call]))
    for (const box of placed) {
      const d = cards.get(box.id)
      const call = byId.get(box.id)
      if (!d || !call || !box.inView || settled(view, d, box)) continue
      const point = boxPoint(view, box, call.priceAt)
      if (!point) continue
      try {
        c.getShapeById(d.shapeId).setPoints([{ time: call.barTime, price: call.priceAt }, point])
        d.point = point
      } catch {
        /* the shape went away: the next render draws it again */
      }
    }
    return true
  }

  const render = async (): Promise<void> => {
    const c = chart
    const w = widget
    if (!c || !w) return
    const my = ++gen
    const record = plotted()
    if (!record) {
      const had = cards.size > 0 || labelId !== null || marks.length > 0
      clearShapes()
      marks = []
      drawnKey = ''
      setMargins(null)
      if (had) refreshMarks()
      hooks.onCards?.(0)
      return
    }
    if (input.fitNonce !== fitDone) {
      fitDone = input.fitNonce
      await fit(record)
      if (my !== gen) return
    }
    // The chart may still be loading the bars the view asked for.
    for (let i = 0; i < 40 && my === gen && !readView(record, []); i++) await sleep(150)
    const pane = paneSize()
    if (my !== gen || !pane) return
    plan = calloutPlan(pane)
    const key = recordKey(record, plan)
    if (key === drawnKey) {
      applyFocus()
      relayout()
      return
    }
    const inks = hooks.inks()
    const ids = boxedIds(record.calls, plan.total)
    const byId = new Map(record.calls.map((call) => [call.postId, call]))
    const texts = new Map<string, PinText>()
    const sizes: Record<string, BoxSize> = {}
    for (const id of ids) {
      const call = byId.get(id)
      if (!call) continue
      const text = pinText(call, record.handle, { textWidth: plan.textWidth, measure, wordLines: plan.wordLines })
      texts.set(id, text)
      sizes[id] = boxSize(text.lines, measure)
    }
    const maxH = Math.max(0, ...Object.values(sizes).map((s) => s.h))
    const label = tallyLabel(record, pane, measureTally(pane))
    const keepTop = keepTopFor(legendBottom())
    setMargins((base) => railMargins(pane, plan, maxH, label.keepBottom, base, keepTop))
    // The margins move the candles: read the view after the chart has drawn them.
    await sleep(80)
    if (my !== gen) return
    const view = readView(record, ids)
    if (!view) return
    startAbove = pickStartSide({ pane: view.pane, anchors: view.anchors, sizes, keepBottom: label.keepBottom, keepTop: view.keepTop })
    const placed = layoutCallouts({ pane: view.pane, anchors: view.anchors, sizes, keepBottom: label.keepBottom, keepTop: view.keepTop, startAbove })

    clearShapes()
    marks = calledMarks(record, ids, inks)
    const next = new Map<string, Drawn>()
    for (const box of placed) {
      const call = byId.get(box.id)
      const text = texts.get(box.id)
      if (!call || !text) continue
      // A card whose bar is off screen is made beside its bar and placed when the bar comes into view.
      const point = box.inView ? boxPoint(view, box, call.priceAt) : null
      const spec = calloutShape(call, text, point ?? { time: call.barTime, price: call.priceAt * (box.side === 'above' ? 1.06 : 0.94) }, inks, { focus: call.postId === input.focusId })
      try {
        const id = await c.createMultipointShape(spec.points, spec.options)
        owned.add(id)
        if (my !== gen) {
          removeShape(id)
          for (const d of next.values()) removeShape(d.shapeId)
          return
        }
        next.set(box.id, { shapeId: id, postId: box.id, size: sizes[box.id], point })
      } catch {
        /* a card the chart refuses is skipped; the strip still lists the call */
      }
    }
    cards = next
    await placeLabel(record, view.pane, my)
    if (my !== gen) return
    drawnKey = key
    refreshMarks()
    hooks.onCards?.(cards.size)
    // The scale settles a frame or two after the margins change: place once more.
    scheduleRelayout()
  }

  function schedule() {
    if (renderTimer) clearTimeout(renderTimer)
    renderTimer = setTimeout(() => {
      renderTimer = null
      void render()
    }, 0)
  }
  function scheduleRelayout() {
    if (relayoutTimer) clearTimeout(relayoutTimer)
    relayoutTimer = setTimeout(() => {
      relayoutTimer = null
      if (relayout()) relayoutTries = 0
      else if (++relayoutTries < 40) scheduleRelayout()
    }, RELAYOUT_MS)
  }

  return {
    attach(w, c, host) {
      widget = w
      chart = c
      hostEl = host ?? null
      measure = canvasMeasure(CALLOUT_FONT_PX)
      tallyMeasures.clear()
      const onRange = () => scheduleRelayout()
      const onMark = ((id: unknown) => {
        const post = postIdOfMark(id)
        if (post) hooks.onPick(post)
      }) as never
      try {
        c.onVisibleRangeChanged().subscribe(null, onRange)
        c.onIntervalChanged().subscribe(null, onRange)
        w.subscribe('onMarkClick', onMark)
        subs.push(
          () => c.onVisibleRangeChanged().unsubscribe(null, onRange),
          () => c.onIntervalChanged().unsubscribe(null, onRange),
          () => w.unsubscribe('onMarkClick', onMark),
        )
      } catch {
        /* the pins still draw; they are placed again on the next render */
      }
      if (host && typeof ResizeObserver !== 'undefined') {
        resizeWatch = new ResizeObserver(() => scheduleRelayout())
        resizeWatch.observe(host)
      }
      driftTimer = setInterval(() => {
        if (cards.size && !relayoutTimer && !renderTimer && typeof document !== 'undefined' && !document.hidden) relayout()
      }, DRIFT_CHECK_MS)
      hooks.onAttach?.(true)
      schedule()
    },
    detach() {
      gen++
      if (relayoutTimer) clearTimeout(relayoutTimer)
      if (renderTimer) clearTimeout(renderTimer)
      if (driftTimer) clearInterval(driftTimer)
      relayoutTimer = renderTimer = null
      driftTimer = null
      resizeWatch?.disconnect()
      resizeWatch = null
      for (const off of subs.splice(0)) {
        try {
          off()
        } catch {
          /* the widget is going away */
        }
      }
      try {
        clearShapes()
        setMargins(null)
      } catch {
        /* the widget is going away */
      }
      marks = []
      drawnKey = ''
      fitDone = 0
      if (widget) hooks.onAttach?.(false)
      widget = chart = null
      hostEl = null
    },
    set(next) {
      const focusOnly = next.record === input.record && next.fitNonce === input.fitNonce && next.focusId !== input.focusId
      input = next
      if (!chart) return
      if (focusOnly) applyFocus()
      else schedule()
    },
    owns: (id) => owned.has(id) || removing.has(id),
    event(id, type) {
      if (!owned.has(id) && !removing.has(id)) return false
      if (type === 'click') {
        const hit = [...cards.values()].find((d) => d.shapeId === id)
        if (hit) hooks.onPick(hit.postId)
      } else if (type === 'remove' && owned.has(id)) {
        // The library's own "remove drawings" took a pin. A pin is the plot's, not a drawing: it comes back.
        owned.delete(id)
        if (labelId === id) labelId = null
        drawnKey = ''
        schedule()
      }
      return true
    },
    marks: (ticker) => (plotted() && sameSym(ticker, hooks.symbol) ? marks : []),
    cleanLayout: (layout) => cleanLayout(layout, (id) => owned.has(id), margins),
    retheme() {
      drawnKey = ''
      if (chart) schedule()
    },
  }
}
