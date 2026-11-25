// CALLED IT on the Advanced chart: an X handle's calls as the library's own
// shapes (squad called-it, lane CHART, 2026-11-11).
//
// What is drawn, and why each choice:
//
//   a CARD per picked call    its tip on the bar the post landed on (that
//                             day's close), its box on a RAIL above or below
//                             the candles. Since 2026-11-24 the card is paint
//                             on the marks layer (lib/tv/called-overlay): a
//                             cut-corner card set in the page's own type,
//                             placed again on every frame and stamped into
//                             the chart's screenshot. Where the layer cannot
//                             mount, it is the library's `callout` as before.
//   a MARK per other call     a cut-corner tile on the same layer, counted
//                             where calls crowd (never piled): a glyph and a
//                             color for the verdict. On a phone every call is
//                             a mark: a card would hide the candles. Where
//                             the layer cannot mount: the datafeed's bar
//                             marks (a disc over the bar, the words in its
//                             tooltip).
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

import { ADDED_MARK, PIN_URL_MAX, VERDICT_WORDS, cmpPostId, fmtDay, judgedLine, moveLine, recordHref, sinceLine, type CallVerdict, type CalledCall, type CalledRecord } from '@/lib/called-it/spec'
import { cardFont, cardSize, createMarksLayer, pageFonts, pageMeasure, type CardBox, type CardFonts, type CardInks, type CardSpec } from './called-overlay'
import type { ShapeSnapshot } from './shapes'
import { TV_FONT_FAMILY } from './theme'
import type { TvChartApi, TvDatafeed, TvMark, TvPoint, TvPriceScaleApi, TvShapeOptions, TvWidget } from './types'

// ── The words on a pin ──────────────────────────────────────────────────

/** A card shows this many of the post's characters at most. */
export const PIN_WORDS_MAX = 90
const ELLIPSIS = '\u2026'
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g

/** `10 Jan 2026`, the UTC day the post was made (the contract's own day format, so a card and the coverage line agree). */
export function pinDate(ms: number): string {
  return fmtDay(ms)
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
  /** `\u2715 missed \u00b7 10 Jan 2026`: the verdict's glyph and word, then the day. */
  head: string
  /** The post's own words, wrapped. */
  words: string[]
  /** `-29.1% in 30 days, +14.2% since` */
  result: string
  /** A viewer pasted this post (it says so on its own line). */
  added: boolean
  lines: string[]
  /** What the shape is given. */
  text: string
}

/**
 * The lines of a card (2026-11-16, the call card): the VERDICT first (its
 * glyph, its word, the day), the post's own words (X's text and nothing
 * else), then the move. The account is not repeated on every card: the band
 * above the chart and the line on the pane both say whose plot it is. A post
 * a viewer pasted says so on a line of its own (the spec's mark) and gives up
 * one line of its words for it, so every card is the same height at most. No
 * line is ever wider than the card: a long head or a long result takes two.
 */
export function pinText(call: Pick<CalledCall, 'text' | 'quote' | 'postedAt' | 'verdict' | 'judgedPct'> & Partial<Pick<CalledCall, 'now' | 'target'>> & { origin?: CalledCall['origin'] }, _handle: string, opts: { textWidth: number; measure: Measure; wordLines: number }): PinText {
  const fit = (whole: string, parts: string[]) => (opts.measure(whole) <= opts.textWidth ? [whole] : parts)
  const added = call.origin === 'added'
  const verdict = `${VERDICT_GLYPH[call.verdict]} ${VERDICT_WORDS[call.verdict]}`
  const head = `${verdict} \u00b7 ${pinDate(call.postedAt)}`
  const result = moveLine(call)
  const headLines = [...fit(head, [verdict, pinDate(call.postedAt)]), ...(added ? [ADDED_MARK] : [])]
  // Too wide for one line: the judged move, then how it has gone since (a card never grows taller for it).
  const since = sinceLine(call)
  let resultLines = fit(result, since ? [judgedLine(call), since] : [result])
  // A card with a mark line and a two-line result would outgrow the rest: there the "since" is left to the call card.
  if (since && headLines.length + 1 + resultLines.length > opts.wordLines + 2) resultLines = [judgedLine(call)]
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
/** Under this pane height every call is a mark too (a phone on its side): two rails of cards would leave the candles and the tiles no room. */
const CARDS_MIN_PANE_H = 360
/** Air between a rail of cards and the candles. */
const RAIL_AIR_PX = 18

/** Px over the highest candle that a marks-only pane keeps for the marks themselves (two tiles and their lift). */
export const MARKS_HEAD_PX = 46
/** The deepest foot (percent of the pane) the candles are lifted by to clear an opened call's card. */
export const COVER_MARGIN_MAX = 58

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
  // Marks only (a phone): room at the head for a stack of two marks over the highest bar, and for the tally at the foot.
  if (plan.total === 0) return { top: Math.max(base.top, pct(keepTop + MARKS_HEAD_PX)), bottom: Math.max(base.bottom, pct(keepBottom + 6)) }
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
      overrides: { backgroundColor: mixInk(look.ink, inks.surf, CALLOUT_TINT), bordercolor: look.ink, color: inks.fg, fontsize: CALLOUT_FONT_PX, bold: false, italic: call.origin === 'added', linewidth: opts.focus ? 3 : 1, transparency: 0, wordWrap: false },
    },
  }
}

/** Two opaque `#rrggbb` inks mixed (`t` of the first). Anything else gives the second back: the canvas takes no `color-mix()`. */
export function mixInk(a: string, b: string, t: number): string {
  const hex = (c: string) => (/^#[0-9a-f]{6}$/i.test(c) ? [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) : null)
  const x = hex(a)
  const y = hex(b)
  if (!x || !y) return b
  return `#${x.map((v, i) => Math.round(v * t + y[i] * (1 - t)).toString(16).padStart(2, '0')).join('')}`
}

/** How much of the verdict's ink a card's fill carries. */
export const CALLOUT_TINT = 0.14

/** The focused call's bar, marked: a dashed rule in the verdict's ink, so the call card and its dot read as one. */
export function focusLineShape(call: Pick<CalledCall, 'verdict'>, inks: CalledInks): TvShapeOptions {
  return { shape: 'vertical_line', ...PIN_SHAPE_FLAGS, overrides: { linecolor: verdictLook(call.verdict, inks).ink, linestyle: 2, linewidth: 2, showTime: false, extendLine: true } }
}

/** Which side of the pane the call card docks on: the one its bar is NOT on. A bar that is off screen leaves it on the right. */
export function dockFor(x: number | null, paneWidth: number): 'left' | 'right' {
  return x !== null && paneWidth > 0 && x > paneWidth / 2 ? 'left' : 'right'
}

export const CALLED_MARK_PREFIX = 'called:'

/** A mark's tooltip. The library escapes it (measured: a tag is shown as its characters), and it still carries only one line. */
export function markTooltip(call: Pick<CalledCall, 'text' | 'quote' | 'postedAt' | 'verdict' | 'judgedPct'> & Partial<Pick<CalledCall, 'now' | 'target'>> & { origin?: CalledCall['origin'] }, handle: string): string {
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
  /** A phone's two lines (the count beside the glyphs, the address) in place of the record's full sentences. */
  short: boolean
}

/**
 * The lines on the pane, all of them the record's own words (lib/called-it/spec,
 * untouched): the headline (the count of what the scan found, or "no tally"
 * when nothing was scanned), what the scan read (where the pane has room for
 * cards; a phone's strip carries it), that pasted posts are shown and not
 * counted (when any are), who plotted it, and where the record lives.
 */
export function tallyLabel(record: Pick<CalledRecord, 'handle' | 'symbol' | 'side' | 'words'> & Partial<Pick<CalledRecord, 'tally' | 'scanned'>>, pane: PaneSize, measure?: Measure): TallyLabel {
  const fontPx = tallyFontPx(pane)
  const width = measure ?? ((s: string) => estimateTextWidth(s, fontPx))
  const wrapWidth = Math.max(140, Math.floor(pane.width - PANE_KEEP.logoWidth - PANE_KEEP.edge - 12))
  const where = `pantessa.com${recordHref(record.handle, record.symbol, record.side)}`
  // A PHONE (2026-11-24): two short lines. The count as numbers beside the marks' own glyphs (so the line is the
  // tiles' legend too), and where the record lives. The record's full sentences (the headline, what the scan read,
  // the standing) are in the band right above the plot there, and `shareNote` puts the standing in the Share picture.
  const short = shortTally(record)
  if (pane.width < CARDS_MIN_PANE_W && short) {
    const count = [`@${record.handle} \u00b7 ${short}`, short].find((l) => width(l) <= wrapWidth) ?? short
    const lines = [count, ...(width(where) <= wrapWidth ? [where] : [])]
    return { text: lines.join('\n'), lines: lines.length, fontPx, keepBottom: lines.length * fontPx + 22, short: true }
  }
  const coverage = pane.width >= CARDS_MIN_PANE_W ? record.words.coverage : null
  // Each sentence starts its own line (a count is never split from its own words by another sentence). The address joins
  // the standing line when both fit, takes a line of its own when it fits alone, and is left out when it would have to
  // be broken (half an address is no address; the strip's Share has the whole one).
  const last = width(`${record.words.standing} ${where}`) <= wrapWidth ? [`${record.words.standing} ${where}`] : width(where) <= wrapWidth ? [record.words.standing, where] : [record.words.standing]
  const parts = [record.words.headline, ...(coverage ? [coverage] : []), ...(record.words.added ? [record.words.added] : []), ...last]
  const lines = parts.flatMap((p) => wrapWords(p, wrapWidth, width, 4))
  return { text: lines.join('\n'), lines: lines.length, fontPx, keepBottom: lines.length * fontPx + 22, short: false }
}

/** `63 calls \u00b7 \u271334 \u271524 \u20131 ?4`: a scanned record's count beside the verdicts' glyphs (none shown for a verdict with no call). Null for a record with no tally. */
export function shortTally(record: Partial<Pick<CalledRecord, 'tally' | 'scanned'>>): string | null {
  const t = record.tally
  if (!t || record.scanned === false || !(t.total > 0)) return null
  const parts = (['right', 'wrong', 'flat', 'open'] as const).filter((v) => t[v] > 0).map((v) => `${VERDICT_GLYPH[v]}${t[v]}`)
  return `${t.total} ${t.total === 1 ? 'call' : 'calls'} \u00b7 ${parts.join(' ')}`
}

/** The tally's shape: fixed to the pane (it does not pan), same flags as a pin. The lines are wrapped here; the library's wrap is off. */
export function tallyShape(label: TallyLabel, inks: CalledInks): TvShapeOptions {
  return {
    shape: 'anchored_text',
    text: label.text,
    ...PIN_SHAPE_FLAGS,
    // A phone's two short lines stand where the volume bars are: their plate is solid, so no bar shows through the words.
    overrides: { color: inks.muted, fontsize: label.fontPx, bold: false, italic: false, fillBackground: true, backgroundColor: inks.bg, backgroundTransparency: label.short ? 0 : 18, drawBorder: false, wordWrap: false },
  }
}

// ── The view a plot opens on ────────────────────────────────────────────

const DAY_SEC = 86_400
/** A plot never opens tighter than this (one recent call is not a three-day chart). */
const FIT_MIN_DAYS = 120

/** Daily bars from a little before the first call to now: every pin on screen. Seconds. */
export function fitRange(calls: readonly Pick<CalledCall, 'barTime'>[], nowSec: number, paneWidth?: number): { from: number; to: number } | null {
  if (!calls.length) return null
  const first = calls.reduce((m, c) => Math.min(m, c.barTime), Infinity)
  const start = Math.min(first, nowSec - FIT_MIN_DAYS * DAY_SEC)
  // Air before the first call: 7% of the span, and on a narrow pane (a phone) at least the width of a mark's column,
  // so the first stack is never cut by the pane's edge.
  const share = paneWidth && paneWidth > 0 ? Math.max(0.07, Math.min(0.2, FIT_AIR_PX / paneWidth)) : 0.07
  const pad = Math.max(10 * DAY_SEC, Math.round((nowSec - start) * share))
  return { from: start - pad, to: nowSec }
}
/**
 * Is the chart on the view the fit asked for? The library snaps a range to its bars and may start at the first bar
 * it has, so "the same" is: it starts no more than a fifth of the span before the asked start and no more than a
 * third after it. (The failure this catches starts YEARS before.)
 */
export function fitHolds(now: { from: number; to: number }, asked: { from: number; to: number }): boolean {
  const span = asked.to - asked.from
  if (!(span > 0) || !Number.isFinite(now.from)) return true
  return now.from >= asked.from - span * 0.2 && now.from <= asked.from + span * 0.34
}
/** Px of air the fit leaves beside the first call (half a mark's column and a little). */
export const FIT_AIR_PX = 36
/** Percent of the pane left empty after the newest bar by the fit: more on a phone, where a column is a larger share. */
export function fitRightMargin(paneWidth: number): number {
  return paneWidth > 0 && paneWidth < CARDS_MIN_PANE_W ? 9 : 5
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
  /** Which side of the pane the call card should dock on for the focused call (the side its bar is not on). */
  onDock?(side: 'left' | 'right'): void
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
  /** Px of the pane's foot that the opened call's card covers (a phone's bottom dock); 0 when nothing does. */
  setCover(px: number): void
  /** The record's own standing line and what the scan read, for a picture of a pane whose tally is the short one (a phone); null when the pane already says them. */
  shareNote(): string | null
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
    // The family the chart's canvas is set in (lib/tv/theme): the page has the same face loaded.
    ctx.font = `${fontPx}px ${TV_FONT_FAMILY}`
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
  let focusLine: { id: string; key: string } | null = null
  let focusSeq = 0
  let marks: TvMark[] = []
  /** The marks layer is drawing (lib/tv/called-overlay): the library's own bar marks stand down. */
  let layerOn = false
  /** What the layer draws: every call with no card. Set by `render`. */
  let scene: { key: string; calls: CalledCall[]; keepTop: number; keepBottom: number; cards?: CardSpec[]; layout?: (pane: PaneSize, anchors: PinAnchor[]) => CardBox[] } | null = null
  let plan: CalloutPlan = calloutPlan({ width: 0, height: 0 })
  /** Px of the pane's foot under the opened call's card (a phone's bottom dock). 0 = nothing covers the pane. */
  let cover = 0
  /** The margins the last render asked for, before the cover is added. */
  let marginWant: ((base: PaneMargins) => PaneMargins) | null = null
  /** The range the last fit left the chart on: while the viewer has not moved it, a new pane width fits again. */
  let fitView: { from: number; to: number; width: number } | null = null
  let revealAt = 0
  let fitting = false
  let fitSeq = 0
  let startAbove = true
  let margins: { original: PaneMargins; applied: PaneMargins } | null = null
  let resizeTimer: ReturnType<typeof setTimeout> | null = null
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
  /** Where the whole legend ends (its Volume row and fold button included), px down the pane, and how wide that corner is. */
  const legendCorner = (): { width: number; top: number } | undefined => {
    try {
      const root = hostEl?.querySelector('iframe')?.contentDocument?.querySelector('[data-qa-id="legend"]')
      if (!root) return undefined
      const box = root.getBoundingClientRect()
      const rows = [...root.querySelectorAll('[data-qa-id="legend-source-item"], [data-qa-id="legend-toggler"], button')].map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0)
      if (!rows.length) return undefined
      const pane = root.parentElement?.getBoundingClientRect()
      const left = pane?.left ?? box.left
      const top = pane?.top ?? box.top
      return { width: Math.min(220, Math.max(...rows.map((r) => r.right - left)) + 8), top: Math.max(...rows.map((r) => r.bottom - top)) + 6 }
    } catch {
      return undefined
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
    return [layerOn ? 'layer' : 'native', r.handle, r.symbol, r.side, r.verified ? 'v' : 'n', r.words.headline, r.words.coverage ?? '', r.words.added ?? '', p.perRail, p.textWidth, p.wordLines, ink.bg, ink.fg, ink.up, r.calls.map((c) => `${c.postId}${c.picked ? '*' : ''}${c.origin === 'added' ? '+' : ''}${c.verdict[0]}${Math.round(c.judgedPct * 1000)}`).join(',')].join('|')
  }

  /** The verdict inks of the marks layer: the market's green and red, gold for "too early to say", grey for no real move. */
  const markInks = (): CardInks => {
    const ink = hooks.inks()
    let gold = ''
    try {
      gold = typeof document === 'undefined' ? '' : getComputedStyle(document.documentElement).getPropertyValue('--gold').trim()
    } catch {
      /* the muted ink stands in */
    }
    return { up: ink.up, down: ink.down, open: /^#[0-9a-f]{6}$/i.test(gold) ? gold : ink.muted, flat: ink.muted, fg: ink.fg, bg: ink.bg, surf: ink.surf, muted: ink.muted }
  }
  // The legend's corner is read from the frame's document: once a second is plenty (it moves when a study is added).
  let cornerAt = 0
  let cornerNow: { width: number; top: number } | undefined
  const corner = () => {
    const now = Date.now()
    if (now - cornerAt > 1000) {
      cornerAt = now
      cornerNow = legendCorner()
    }
    return cornerNow
  }
  /** One call as a card of the layer: the verdict's word and the day, the post's own words (cut and wrapped by `pinText`, never reworded), the move. */
  const cardSpecOf = (call: CalledCall, handle: string, textWidth: number, wordLines: number, pageText: (font: string, text: string) => number, fonts: CardFonts, dateNote?: string): CardSpec => {
    const wide: Measure = (t) => Math.max(pageText(cardFont.words(fonts), t), pageText(cardFont.result(fonts), t))
    const text = pinText(call, handle, { textWidth, measure: wide, wordLines })
    const spec = { id: call.postId, barTime: call.barTime, priceAt: call.priceAt, verdict: call.verdict, added: text.added ? ADDED_MARK : null, word: VERDICT_WORDS[call.verdict], date: dateNote ? `${pinDate(call.postedAt)} \u00b7 ${dateNote}` : pinDate(call.postedAt), words: text.words, result: text.lines.slice(text.lines.lastIndexOf(text.words[text.words.length - 1]) + 1) }
    return { ...spec, ...cardSize(spec, fonts, pageText) }
  }
  let previewText: ((font: string, text: string) => number) | null = null
  const layer = createMarksLayer({
    // A mark under the mouse shows its call as a card (what the library's tooltip used to say, set as the cards are).
    // Over a crowd it is the call a press would open, and says which of how many (`1 of 7`): each press steps on.
    preview: (postId, at) => {
      const record = plotted()
      const call = record?.calls.find((c) => c.postId === postId)
      previewText = previewText ?? pageMeasure()
      return record && call && previewText ? cardSpecOf(call, record.handle, 236, 3, previewText, pageFonts(), at && at.of > 1 ? `${at.index} of ${at.of}` : undefined) : null
    },
    host: () => hostEl,
    chart: () => chart,
    // Under the opened call's card nothing is drawn: the marks (and the opened call's own tile) stay above it.
    scene: () => (scene && plotted() ? { ...scene, keepBottom: Math.max(scene.keepBottom, cover ? cover + 6 : 0), focusId: input.focusId, keepCorner: corner() } : null),
    inks: markInks,
    onPick: (postId) => hooks.onPick(postId),
    onMount: (on) => {
      if (layerOn === on) return
      layerOn = on
      refreshMarks()
      // The cards change hands with the marks: the layer's own when it draws, the library's callouts when it cannot.
      // (A render already under way is dropped by the next one: it would have drawn for the other hand.)
      if (chart && plotted()) {
        drawnKey = ''
        schedule()
      }
    },
  })

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

  /** The render's margins, and under an opened call's card (a phone) a foot deep enough that the candles end above it. */
  const applyMargins = () => {
    const want = marginWant
    if (!want) return
    const height = paneSize()?.height ?? 0
    setMargins((base) => {
      const m = want(base)
      if (!(cover > 0) || !(height > 0)) return m
      const foot = Math.min(COVER_MARGIN_MAX, Math.ceil(((cover + 10) / height) * 100))
      // The head gives back what it can: with half the pane under the card, the candles need the rest.
      return { top: Math.min(m.top, Math.max(base.top, 14)), bottom: Math.max(m.bottom, foot) }
    })
  }
  /**
   * The opened call's bar is on the pane, clear of its edges. A step to a call
   * that is off screen, or a pane that just got narrower (the side column
   * opening, a phone turned), pans the chart by as little as shows it. A call
   * that is already in view never moves the chart.
   */
  const revealFocus = () => {
    const c = chart
    const record = plotted()
    const call = record && input.focusId ? record.calls.find((x) => x.postId === input.focusId) : null
    // Never while the fit is still on its way: it would read the view the chart opened on and pan that.
    if (!c || !call || fitting || Date.now() - revealAt < 350) return
    try {
      const pane = paneSize()
      if (!pane) return
      const x = xForTime(sampleAxis(pane.width), call.barTime)
      // Under a card that covers the pane's foot (a phone) the opened bar goes to the middle of what is left in sight.
      const centre = cover > 0 && pane.width < CARDS_MIN_PANE_W
      const pad = centre ? pane.width * 0.3 : Math.min(72, pane.width * 0.2)
      if (x !== null && x >= pad && x <= pane.width - pad) return
      const r = c.getVisibleRange()
      const span = r.to - r.from
      if (!(span > 0)) return
      const left = x === null ? call.barTime < r.from : x < pad
      const from = call.barTime - span * (centre ? 0.5 : left ? 0.3 : 0.7)
      revealAt = Date.now()
      fitSeq++
      fitView = null
      void c.setVisibleRange({ from, to: from + span }).catch(() => undefined)
    } catch {
      /* the call card still names the call */
    }
  }
  /** The pane changed width while the chart was still on the fit's own view: fit again (every call back on the pane). */
  const refitIfUntouched = () => {
    const c = chart
    const record = plotted()
    const was = fitView
    if (!c || !record || !was) return false
    try {
      const pane = paneSize()
      const now = c.getVisibleRange()
      if (!pane || Math.abs(pane.width - was.width) < 24) return false
      // Bars keep their width when the pane does not: the newest stays put and the oldest slide off (or air opens).
      if (Math.abs(now.to - was.to) > 2 * DAY_SEC) {
        fitView = null
        return false
      }
      void fit(record)
      return true
    } catch {
      return false
    }
  }

  const fit = async (record: CalledRecord): Promise<void> => {
    const c = chart
    const width = paneSize()?.width ?? 0
    const range = fitRange(record.calls, Math.floor(Date.now() / 1000), width)
    if (!c || !range) return
    fitting = true
    try {
      const res = c.resolution().toUpperCase()
      if (res !== '1D' && res !== 'D') await Promise.race([Promise.resolve(c.setResolution('1D')), sleep(4000)])
      await Promise.race([c.setVisibleRange(range, { percentRightMargin: fitRightMargin(width) }), sleep(5000)])
      await sleep(60)
      const now = c.getVisibleRange()
      fitView = { from: now.from, to: now.to, width: paneSize()?.width ?? width }
    } catch {
      /* the chart keeps the view it has; "Fit all calls" asks again */
    }
    // THE FIT MUST HOLD. The library sets a range of its own when a symbol's first bars arrive, and on a market whose
    // history is slow to load (a stock) that can land AFTER the fit: the chart then opened on five years with the
    // calls in its last sliver. So the view is read back three times over the next seconds and the fit is put again
    // while it is not the one asked for. Not awaited: the pins draw meanwhile.
    const seq = ++fitSeq
    void (async () => {
      const span = range.to - range.from
      for (const wait of [450, 900, 1500]) {
        await sleep(wait)
        if (seq !== fitSeq || chart !== c) return
        try {
          if (fitHolds(c.getVisibleRange(), range)) continue
          await Promise.race([c.setVisibleRange(range, { percentRightMargin: fitRightMargin(paneSize()?.width ?? width) }), sleep(4000)])
          await sleep(60)
          const now = c.getVisibleRange()
          fitView = { from: now.from, to: now.to, width: paneSize()?.width ?? width }
        } catch {
          /* read again on the next pass */
        }
      }
      void span
      if (seq === fitSeq) {
        fitting = false
        // A call that was opened before the fit landed (a link to one call) is brought into view on the fitted chart.
        setTimeout(revealFocus, 120)
      }
    })()
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

  // (On a phone's pane the label stands 6px further from the library's logo: the two never touch.)
  const labelPos = (pane: PaneSize, keepBottom: number) => ({ x: (PANE_KEEP.logoWidth + (pane.width < CARDS_MIN_PANE_W ? 6 : 0)) / pane.width, y: Math.max(0, (pane.height - keepBottom + 8) / pane.height) })
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

  /** The focused call's bar wears a dashed rule; the call card is told which side of the pane that bar is NOT on. */
  const syncFocus = async (): Promise<void> => {
    const c = chart
    const record = plotted()
    const call = record && input.focusId ? (record.calls.find((x) => x.postId === input.focusId) ?? null) : null
    const inks = hooks.inks()
    const key = c && call ? `${call.postId}|${call.barTime}|${verdictLook(call.verdict, inks).ink}` : ''
    if (call) {
      try {
        const pane = paneSize()
        hooks.onDock?.(dockFor(pane ? xForTime(sampleAxis(pane.width), call.barTime) : null, pane?.width ?? 0))
      } catch {
        /* the card keeps the side it has */
      }
    }
    if ((focusLine?.key ?? '') === key) return
    const my = ++focusSeq
    if (focusLine) removeShape(focusLine.id)
    focusLine = null
    if (!c || !call) return
    try {
      const id = await c.createShape({ time: call.barTime }, focusLineShape(call, inks))
      owned.add(id)
      if (my !== focusSeq) removeShape(id)
      else focusLine = { id, key }
    } catch {
      /* the card still says which call it is */
    }
  }

  const applyFocus = () => {
    const c = chart
    if (!c) return
    void syncFocus()
    revealFocus()
    for (const d of cards.values()) {
      try {
        const shape = c.getShapeById(d.shapeId)
        const focus = d.postId === input.focusId
        shape.setProperties({ linewidth: focus ? 3 : 1 })
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
      scene = null
      drawnKey = ''
      marginWant = null
      fitView = null
      setMargins(null)
      void syncFocus()
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
    // The layer draws the cards itself when it is up (set in the page's own type); else they are the library's callouts.
    const pageText = layerOn ? pageMeasure() : null
    const fonts = pageFonts()
    const specs: CardSpec[] = []
    for (const id of ids) {
      const call = byId.get(id)
      if (!call) continue
      if (pageText) {
        const spec = cardSpecOf(call, record.handle, plan.textWidth, plan.wordLines, pageText, fonts)
        specs.push(spec)
        sizes[id] = { w: spec.w, h: spec.h }
        continue
      }
      const text = pinText(call, record.handle, { textWidth: plan.textWidth, measure, wordLines: plan.wordLines })
      texts.set(id, text)
      sizes[id] = boxSize(text.lines, measure)
    }
    const maxH = Math.max(0, ...Object.values(sizes).map((s) => s.h))
    const label = tallyLabel(record, pane, measureTally(pane))
    const keepTop = keepTopFor(legendBottom())
    marginWant = (base) => railMargins(pane, plan, maxH, label.keepBottom, base, keepTop)
    applyMargins()
    // The margins move the candles: read the view after the chart has drawn them.
    await sleep(80)
    if (my !== gen) return
    const view = readView(record, ids)
    if (!view) return
    startAbove = pickStartSide({ pane: view.pane, anchors: view.anchors, sizes, keepBottom: label.keepBottom, keepTop: view.keepTop })
    const placed = layoutCallouts({ pane: view.pane, anchors: view.anchors, sizes, keepBottom: label.keepBottom, keepTop: view.keepTop, startAbove })

    clearShapes()
    marks = calledMarks(record, ids, inks)
    const boxed = new Set(ids)
    scene = { key, calls: record.calls.filter((call) => !boxed.has(call.postId)), keepTop: view.keepTop, keepBottom: label.keepBottom }
    if (pageText) {
      const side = startAbove
      const keepTopNow = view.keepTop
      scene.cards = specs
      scene.layout = (paneNow, anchors) => layoutCallouts({ pane: paneNow, anchors, sizes, keepBottom: label.keepBottom, keepTop: keepTopNow, startAbove: side })
      cards = new Map()
      await placeLabel(record, view.pane, my)
      if (my !== gen) return
      drawnKey = key
      refreshMarks()
      hooks.onCards?.(specs.length)
      void syncFocus()
      return
    }
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
    void syncFocus()
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
        resizeWatch = new ResizeObserver(() => {
          scheduleRelayout()
          if (resizeTimer) clearTimeout(resizeTimer)
          resizeTimer = setTimeout(() => {
            resizeTimer = null
            applyMargins()
            if (!refitIfUntouched()) revealFocus()
          }, 320)
        })
        resizeWatch.observe(host)
      }
      driftTimer = setInterval(() => {
        if (cards.size && !relayoutTimer && !renderTimer && typeof document !== 'undefined' && !document.hidden) relayout()
      }, DRIFT_CHECK_MS)
      hooks.onAttach?.(true)
      layer.start()
      schedule()
    },
    detach() {
      gen++
      if (relayoutTimer) clearTimeout(relayoutTimer)
      if (renderTimer) clearTimeout(renderTimer)
      if (resizeTimer) clearTimeout(resizeTimer)
      resizeTimer = null
      marginWant = null
      fitView = null
      fitSeq++
      fitting = false
      cover = 0
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
        focusSeq++
        if (focusLine) removeShape(focusLine.id)
        focusLine = null
        setMargins(null)
      } catch {
        /* the widget is going away */
      }
      layer.stop()
      marks = []
      scene = null
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
        if (focusLine?.id === id) focusLine = null
        drawnKey = ''
        schedule()
      }
      return true
    },
    // While the marks layer draws them, the library is given none (it would draw its discs under the tiles).
    marks: (ticker) => (!layerOn && plotted() && sameSym(ticker, hooks.symbol) ? marks : []),
    cleanLayout: (layout) => cleanLayout(layout, (id) => owned.has(id), margins),
    shareNote() {
      const record = plotted()
      const pane = paneSize()
      if (!record || !pane || !tallyLabel(record, pane, measureTally(pane)).short) return null
      return [record.words.standing, record.words.coverage].filter(Boolean).join(' ')
    },
    setCover(px) {
      const next = Number.isFinite(px) && px > 8 ? Math.round(px) : 0
      if (Math.abs(next - cover) < 4) return
      // The card arriving or leaving is a new view for the opened bar; a few px of the page scrolling under it is not.
      const arrived = (next > 0) !== (cover > 0) || Math.abs(next - cover) > 40
      cover = next
      applyMargins()
      layer.invalidate()
      if (arrived) setTimeout(revealFocus, 380)
    },
    retheme() {
      layer.invalidate()
      drawnKey = ''
      if (chart) schedule()
    },
  }
}
