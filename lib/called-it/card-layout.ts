// CALLED IT, lane RECORD: where things stand on the two pictures of a record.
//
//   · the SHARE IMAGE (app/api/og/called): a scoreboard column, and a panel
//     with the price line and up to four post cards, each tied to its day by a
//     leader line (`ogLayout`);
//   · the LANDING's chart (components/called/RecordChart): the same line with
//     a numbered flag per pinned call on a rail above it (`railPins`).
//
// Pure: no React, no node builtins, no colour. Numbers in, boxes out, so the
// harness can pin what a picture promises: cards never overlap each other or
// the scoreboard, a leader line never crosses a card or another leader, and a
// post's words reach a small card only clamped, never reworded.
//
// The leader proof, in one place (pinned on thousands of random spreads in
// scripts/called-record-pins.ts):
//   1. Cards live in two rows, above and below the band the line is drawn in;
//      a leader runs from its card's band-side edge to its day's point, so it
//      stays inside the band and can only touch a card at its own edge.
//   2. The top row takes the calls whose points stand HIGHEST, the bottom row
//      the lowest. A top leader lives above its point and a bottom leader
//      below its point, so a top and a bottom leader cannot cross.
//   3. A row holds at most two cards, in date order. When they push apart the
//      left card only ever moves left of its day and the right card right, so
//      the two leaders lean away from each other.
import { VERDICT_WORDS, type CalledCall, type CallVerdict } from './spec'

// ── Shapes ──────────────────────────────────────────────────────────────

/** One daily close: the bar's open time (unix seconds) and its close. */
export interface ClosePoint {
  t: number
  c: number
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Pt {
  x: number
  y: number
}

/** Where a time and a price stand, each as a fraction: x 0 = the first bar, y 0 = the highest price. */
export interface PlotScale {
  t0: number
  t1: number
  lo: number
  hi: number
  x: (tSec: number) => number
  y: (price: number) => number
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const round1 = (n: number) => Math.round(n * 10) / 10

/**
 * The scale a record's line and pins share. Null with fewer than two closes.
 * `prices` (the calls' prices that day) widen the range, so a pin can never
 * stand outside the plot even if the record was judged on a newer bar.
 */
export function plotScale(closes: readonly ClosePoint[], prices: readonly number[] = []): PlotScale | null {
  if (closes.length < 2) return null
  const t0 = closes[0].t
  const t1 = closes[closes.length - 1].t
  if (!(t1 > t0)) return null
  let lo = Infinity
  let hi = -Infinity
  for (const p of closes) {
    if (p.c < lo) lo = p.c
    if (p.c > hi) hi = p.c
  }
  for (const p of prices) {
    if (!(p > 0)) continue
    if (p < lo) lo = p
    if (p > hi) hi = p
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null
  if (!(hi > lo)) {
    hi = lo * 1.01 + 1e-9
    lo = lo * 0.99
  }
  return {
    t0,
    t1,
    lo,
    hi,
    x: (tSec) => clamp((tSec - t0) / (t1 - t0), 0, 1),
    y: (price) => clamp((hi - price) / (hi - lo), 0, 1),
  }
}

/** A drawn line starts this long before the first call, so the first pin never sits on the plot's left edge. */
export const PLOT_LEAD_DAYS = 21

/**
 * Where a record's drawn line starts (unix seconds). The chart holds more
 * history than a scan reads, and a line that opens with months no pin can
 * stand on wastes the picture: so the line starts one scan window back from
 * now, or a few weeks before the first call when that is earlier (a post a
 * viewer pasted can be older than a scan), and never before the record's own
 * first bar.
 */
export function plotFromSec(windowFromMs: number, nowMs: number, firstCallBarSec: number | null, scanDays: number): number {
  const day = 86_400
  const scanFrom = Math.floor(nowMs / 1000) - scanDays * day
  const lead = firstCallBarSec === null ? scanFrom : firstCallBarSec - PLOT_LEAD_DAYS * day
  return Math.max(Math.floor(windowFromMs / 1000), Math.min(scanFrom, lead))
}

/** The line and the area under it, drawn inside `box`. Coordinates to one decimal. */
export function linePaths(closes: readonly ClosePoint[], scale: PlotScale, box: Rect): { line: string; area: string } {
  const pts = closes.map((p) => `${round1(box.x + scale.x(p.t) * box.w)} ${round1(box.y + scale.y(p.c) * box.h)}`)
  const line = `M${pts.join('L')}`
  const base = round1(box.y + box.h)
  return { line, area: `${line}L${round1(box.x + box.w)} ${base}L${round1(box.x)} ${base}Z` }
}

// ── The share image ─────────────────────────────────────────────────────

export const OG_SIZE = { w: 1200, h: 630 } as const
/** The scoreboard: who, on what, the full tally, the standing line, the address. */
export const OG_COLUMN: Rect = { x: 44, y: 40, w: 316, h: 550 }
/** The exhibit: the price line and the post cards. */
export const OG_PANEL: Rect = { x: 392, y: 40, w: 764, h: 550 }
export const OG_CARD = {
  w: 356,
  h: 126,
  /** Card edge to panel edge. */
  inset: 14,
  /** Least air between two cards in a row. */
  gap: 12,
  /** Card row to the band. */
  rowGap: 14,
  /** A leader never leaves a card closer than this to its corner. */
  attachInset: 22,
  /** Air between the band and the panel edge (or a row) above and below the line. */
  bandPadTop: 12,
  bandPadBottom: 26,
} as const
/** Post cards on one image. Two rows of two is what stays readable at feed size. */
export const OG_MAX_CARDS = 4

export interface OgCallIn {
  id: string
  /** The bar the call stands on (unix seconds). */
  t: number
  /** The close that day. */
  price: number
}

export interface OgCardBox extends Rect {
  id: string
  row: 'top' | 'bottom'
  /** The day's point on the line. */
  anchor: Pt
  /** Where the leader leaves the card: on its band-side edge. */
  attach: Pt
}

export interface OgDot extends Pt {
  id: string
  carded: boolean
}

export interface OgLayout {
  panel: Rect
  column: Rect
  /** The box the line is drawn in. */
  band: Rect
  cards: OgCardBox[]
  /** Every call's point on the line, carded or not, in the order given. */
  dots: OgDot[]
}

/**
 * Lay out one share image. `carded` are the calls that get a post card (the
 * first OG_MAX_CARDS are used, the caller ranks them); `others` are drawn as
 * dots only. With no scale (no chart) there are no cards and no dots.
 */
export function ogLayout(scale: PlotScale | null, carded: readonly OgCallIn[], others: readonly OgCallIn[] = []): OgLayout {
  const C = OG_CARD
  const P = OG_PANEL
  const bandX = P.x + C.inset + C.attachInset + 4
  const bandW = P.w - 2 * (C.inset + C.attachInset + 4)
  const fullBand: Rect = { x: bandX, y: P.y + C.inset + C.bandPadTop, w: bandW, h: P.h - 2 * C.inset - C.bandPadTop - C.bandPadBottom }
  if (!scale) return { panel: P, column: OG_COLUMN, band: fullBand, cards: [], dots: [] }

  const seen = new Set<string>()
  const picks = carded.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true))).slice(0, OG_MAX_CARDS)
  const norm = picks.map((c) => ({ id: c.id, xN: scale.x(c.t), yN: scale.y(c.price) }))

  // Rows: the highest points go up, the lowest go down (proof step 2).
  const byHeight = [...norm].sort((a, b) => a.yN - b.yN || a.xN - b.xN || (a.id < b.id ? -1 : 1))
  const upper = norm.filter((c) => c.yN <= 0.5).length
  const n = norm.length
  const kTop = n === 0 ? 0 : n === 4 ? 2 : n === 3 ? clamp(upper, 1, 2) : upper
  const topIds = new Set(byHeight.slice(0, kTop).map((c) => c.id))
  const hasTop = kTop > 0
  const hasBottom = n - kTop > 0

  const top = P.y + C.inset + (hasTop ? C.h + C.rowGap : 0) + C.bandPadTop
  const bottom = P.y + P.h - C.inset - (hasBottom ? C.h + C.rowGap : 0) - C.bandPadBottom
  const band: Rect = { x: bandX, y: top, w: bandW, h: bottom - top }
  const at = (xN: number, yN: number): Pt => ({ x: round1(band.x + xN * band.w), y: round1(band.y + yN * band.h) })

  const minX = P.x + C.inset
  const maxX = P.x + P.w - C.inset - C.w
  const place = (row: 'top' | 'bottom'): OgCardBox[] => {
    const inRow = norm
      .filter((c) => topIds.has(c.id) === (row === 'top'))
      .map((c) => ({ id: c.id, anchor: at(c.xN, c.yN) }))
      .sort((a, b) => a.anchor.x - b.anchor.x || (a.id < b.id ? -1 : 1))
    const xs = inRow.map((c) => clamp(c.anchor.x - C.w / 2, minX, maxX))
    if (xs.length === 2 && xs[1] - xs[0] < C.w + C.gap) {
      // Push apart about the midpoint of the two ideal spans (proof step 3)…
      const mid = (xs[0] + xs[1] + C.w) / 2
      xs[0] = mid - C.gap / 2 - C.w
      xs[1] = mid + C.gap / 2
      // …then slide the pair back inside the panel.
      if (xs[0] < minX) {
        xs[1] += minX - xs[0]
        xs[0] = minX
      }
      if (xs[1] > maxX) {
        xs[0] -= xs[1] - maxX
        xs[1] = maxX
      }
    }
    const y = row === 'top' ? P.y + C.inset : P.y + P.h - C.inset - C.h
    return inRow.map((c, i) => {
      const x = round1(xs[i])
      return {
        id: c.id,
        row,
        x,
        y,
        w: C.w,
        h: C.h,
        anchor: c.anchor,
        attach: { x: round1(clamp(c.anchor.x, x + C.attachInset, x + C.w - C.attachInset)), y: row === 'top' ? y + C.h : y },
      }
    })
  }
  const cards = [...place('top'), ...place('bottom')]
  const cardedIds = new Set(cards.map((c) => c.id))
  const dots: OgDot[] = []
  const dotSeen = new Set<string>()
  for (const c of [...picks, ...carded.slice(OG_MAX_CARDS), ...others]) {
    if (dotSeen.has(c.id)) continue
    dotSeen.add(c.id)
    dots.push({ id: c.id, ...at(scale.x(c.t), scale.y(c.price)), carded: cardedIds.has(c.id) })
  }
  return { panel: P, column: OG_COLUMN, band, cards, dots }
}

// ── The landing's chart ─────────────────────────────────────────────────

/** Two pinned calls closer than this (a fraction of the plot's width) fly their flags at different heights. A 24px flag on a 340px phone plot is 7%. */
export const RAIL_MIN_DX = 0.075
export const RAIL_LEVELS = 3

export interface RailPin {
  postId: string
  /** The call's number: its place in the record, date ascending, from 1. The card under the chart wears the same number. */
  n: number
  /** Fractions of the plot: x 0 = the first bar, y 0 = the highest price. */
  x: number
  y: number
  picked: boolean
  verdict: CallVerdict
  /** Which rail row the flag flies on (picked calls only; 0 is the top row). */
  level: number
}

/**
 * Every call's place on the landing's chart. Picked calls fly a numbered flag
 * on a rail above the line; a flag never shares a rail row with another flag
 * closer than `minDx` (three rows are enough for any three neighbours; a
 * tighter crowd reuses the row furthest back).
 */
export function railPins(calls: readonly Pick<CalledCall, 'postId' | 'barTime' | 'priceAt' | 'picked' | 'verdict'>[], scale: PlotScale, minDx = RAIL_MIN_DX): { pins: RailPin[]; levels: number } {
  const pins: RailPin[] = calls.map((c, i) => ({ postId: c.postId, n: i + 1, x: scale.x(c.barTime), y: scale.y(c.priceAt), picked: c.picked, verdict: c.verdict, level: 0 }))
  const flown: RailPin[] = []
  for (const p of [...pins].filter((q) => q.picked).sort((a, b) => a.x - b.x || a.n - b.n)) {
    const near = flown.filter((q) => p.x - q.x < minDx)
    const taken = new Set(near.map((q) => q.level))
    let level = 0
    while (level < RAIL_LEVELS && taken.has(level)) level++
    if (level === RAIL_LEVELS) {
      // More than three neighbours: take the row whose last flag is furthest back.
      let best = 0
      let bestX = Infinity
      for (let l = 0; l < RAIL_LEVELS; l++) {
        const last = Math.max(...near.filter((q) => q.level === l).map((q) => q.x))
        if (last < bestX) {
          bestX = last
          best = l
        }
      }
      level = best
    }
    p.level = level
    flown.push(p)
  }
  return { pins, levels: flown.length ? Math.max(...flown.map((p) => p.level)) + 1 : 0 }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

/** Month marks along the time axis: at most `max`, on the first of a month, the year on the first mark and on every January. */
export function monthTicks(t0: number, t1: number, max = 6): { x: number; label: string }[] {
  if (!(t1 > t0)) return []
  const firsts: number[] = []
  const d = new Date(t0 * 1000)
  let y = d.getUTCFullYear()
  let m = d.getUTCMonth()
  for (let i = 0; i < 600; i++) {
    const ts = Date.UTC(y, m, 1) / 1000
    if (ts > t1) break
    if (ts >= t0) firsts.push(ts)
    m++
    if (m === 12) {
      m = 0
      y++
    }
  }
  if (firsts.length === 0) return []
  const step = Math.max(1, Math.ceil(firsts.length / max))
  // Count back from the newest month so the right end of the axis is always marked.
  const kept = firsts.filter((_, i) => (firsts.length - 1 - i) % step === 0)
  return kept.map((ts, i) => {
    const dt = new Date(ts * 1000)
    const mon = MONTHS[dt.getUTCMonth()]
    return { x: (ts - t0) / (t1 - t0), label: i === 0 || dt.getUTCMonth() === 0 ? `${mon} ${dt.getUTCFullYear()}` : mon }
  })
}

// ── Words on a card (X's words stay X's words) ──────────────────────────

/** Invisible formatting that can reorder or hide text: C0/C1 controls and the bidi overrides. Never a letter, never an emoji joiner. */
const CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f‪-‮⁦-⁩]/g

/**
 * A post's words for a SMALL card: one line of whitespace, cut on a word
 * boundary at `max` characters with an ellipsis. Nothing is reworded; the full
 * text is on the landing, one tap away.
 */
export function clampPostText(text: string, max: number): string {
  const one = text.replace(CONTROL_RE, '').replace(/\s+/g, ' ').trim()
  const chars = Array.from(one)
  if (chars.length <= max) return one
  const cut = chars.slice(0, Math.max(1, max - 1)).join('')
  const space = cut.lastIndexOf(' ')
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`
}

/** How wide a character runs against a lowercase letter: capitals and digits wider, thin letters and spaces narrower, CJK and emoji double. */
function charUnits(ch: string): number {
  const cp = ch.codePointAt(0) ?? 0
  if (cp > 0x2e7f) return 2
  if (/[MW@%]/.test(ch)) return 1.55
  if (/[A-Z0-9$#&?]/.test(ch)) return 1.22
  if (/[ iljtfrI.,:;'!|()\-]/.test(ch)) return 0.58
  return 1
}

/** A text's drawn width in lowercase-letter widths (an estimate: good enough to decide where a card's two lines end). */
export function textUnits(text: string): number {
  let n = 0
  for (const ch of text) n += charUnits(ch)
  return Math.round(n * 100) / 100
}

/**
 * clampPostText by drawn width instead of by count: a post in capitals or
 * with emoji fills a card's lines sooner than its character count says, and
 * its ellipsis must not fall off the card.
 */
export function clampPostWidth(text: string, maxUnits: number): string {
  const one = text.replace(CONTROL_RE, '').replace(/\s+/g, ' ').trim()
  if (textUnits(one) <= maxUnits) return one
  let used = 1.2 // the ellipsis
  let cut = ''
  for (const ch of one) {
    const u = charUnits(ch)
    if (used + u > maxUnits) break
    used += u
    cut += ch
  }
  const space = cut.lastIndexOf(' ')
  return `${(space > cut.length * 0.6 ? cut.slice(0, space) : cut).trimEnd()}\u2026`
}

/** The same cleaning with no cut: for a name on a card. */
export function cleanLine(text: string, max: number): string {
  return clampPostText(text, max)
}

const reEscape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * The post's text split around the span the label quoted, so a page can mark
 * it. The three parts joined are the text, byte for byte. Null when the span
 * is not there (the page then prints the text unmarked).
 */
export function splitQuote(text: string, quote: string | null | undefined): [string, string, string] | null {
  const q = (quote ?? '').trim()
  if (q.length < 3) return null
  let from = text.indexOf(q)
  let len = q.length
  if (from < 0) {
    // The label's whitespace may differ from the post's (spec quoteIsFromPost allows it).
    let m: RegExpExecArray | null = null
    try {
      m = new RegExp(q.split(/\s+/).map(reEscape).join('\\s+')).exec(text)
    } catch {
      m = null
    }
    if (!m) return null
    from = m.index
    len = m[0].length
  }
  return [text.slice(0, from), text.slice(from, from + len), text.slice(from + len)]
}

/**
 * The record's headline as the pieces a page colours: who, then each count.
 * The pieces joined are the headline exactly (the words are spec's; nothing is
 * re-worded here). Null when the headline is not a tally ("no calls found").
 */
export function headlineParts(headline: string): { who: string; counts: { text: string; kind: CallVerdict | 'total' }[]; end: string } | null {
  const cut = headline.indexOf(': ')
  if (cut < 0 || !headline.endsWith('.')) return null
  const who = headline.slice(0, cut + 2)
  const rest = headline.slice(cut + 2, -1)
  const phrases = rest.split(', ')
  if (!/^\d+ calls?$/.test(phrases[0] ?? '')) return null
  const kinds = Object.entries(VERDICT_WORDS) as [CallVerdict, string][]
  const counts: { text: string; kind: CallVerdict | 'total' }[] = []
  for (const [i, text] of phrases.entries()) {
    if (i === 0) {
      counts.push({ text, kind: 'total' })
      continue
    }
    const hit = kinds.find(([, word]) => text.endsWith(` ${word}`) && /^\d+ /.test(text))
    if (!hit) return null
    counts.push({ text, kind: hit[0] })
  }
  return { who, counts, end: '.' }
}

/** The tally half of a headline: "10 calls, 5 called it, 3 missed." (or "no calls found in this window."). */
export function headlineTally(headline: string): string {
  const cut = headline.indexOf(': ')
  return cut < 0 ? headline : headline.slice(cut + 2)
}

// ── Dates, prices, counts ───────────────────────────────────────────────

/** `14 Jun 2026`, UTC. */
export function fmtUtcDate(ms: number): string {
  const d = new Date(ms)
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

/** `14 Jun 2026, 18:00 UTC`. */
export function fmtUtcDateTime(ms: number): string {
  const d = new Date(ms)
  return `${fmtUtcDate(ms)}, ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`
}

/** A price in the chart's own unit: dollars, an index level, or a yield in percent. */
export function fmtCallPrice(v: number, unit: 'usd' | 'level' | 'yield' = 'usd'): string {
  if (!Number.isFinite(v)) return '-'
  if (unit === 'yield') return `${v.toFixed(3)}%`
  const a = Math.abs(v)
  const body = a >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : a >= 1 ? v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : a >= 0.01 ? v.toFixed(4) : v.toPrecision(3)
  return unit === 'usd' ? `$${body}` : body
}

/** `950` · `4.2K` · `12K` · `1.3M`. */
export function fmtCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0'
  if (n < 1000) return String(Math.round(n))
  if (n < 10_000) return `${(Math.floor(n / 100) / 10).toFixed(1).replace(/\.0$/, '')}K`
  if (n < 1_000_000) return `${Math.floor(n / 1000)}K`
  return `${(Math.floor(n / 100_000) / 10).toFixed(1).replace(/\.0$/, '')}M`
}

/** The letter an avatar falls back to: the name's first letter or number, else the handle's. */
export function initialOf(name: string | null | undefined, handle: string): string {
  for (const src of [name ?? '', handle]) {
    const m = /[\p{L}\p{N}]/u.exec(src)
    if (m) return m[0].toUpperCase()
  }
  return '@'
}

// ── Avatars (the server fetches them; these are the rules it fetches by) ─

export const AVATAR_HOSTS: ReadonlySet<string> = new Set(['pbs.twimg.com', 'abs.twimg.com'])
export const AVATAR_TIMEOUT_MS = 2000
export const AVATAR_MAX_BYTES = 400_000
export const AVATAR_TYPES: ReadonlySet<string> = new Set(['image/jpeg', 'image/png', 'image/gif'])

/**
 * The one URL an avatar is fetched from, or null: https, one of X's two image
 * hosts exactly, no port, no credentials. X's default 48px file is swapped for
 * its 200px sibling (the same file name, X's own suffix).
 */
export function avatarFetchUrl(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string' || raw.length > 500) return null
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return null
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return null
  if (!AVATAR_HOSTS.has(u.hostname.toLowerCase())) return null
  u.hash = ''
  u.pathname = u.pathname.replace(/_normal(\.[A-Za-z0-9]+)$/, '_200x200$1')
  return u.toString()
}

// ── The image's address ─────────────────────────────────────────────────

/** The share image for a record. `pins` rides along only when the page's URL carried its own. */
export function calledImageHref(handle: string, symbol: string, side: 'all' | 'bull' | 'bear' = 'all', pins: readonly string[] = []): string {
  const q = new URLSearchParams({ handle, sym: symbol.toUpperCase() })
  if (side !== 'all') q.set('side', side)
  if (pins.length) q.set('pins', pins.join(','))
  return `/api/og/called?${q.toString()}`
}
