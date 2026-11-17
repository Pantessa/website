// The News tab as a front page: which story sits where, what the dateline
// says, and what the price did since a story ran. Pure and client-safe (the
// tab imports it; scripts/news-front-pins.ts pins it).
//
// THE ORDER IS THE FEED'S. Stories arrive newest first and are dealt into the
// page's seats in that order: the lead, two seconds beside it, the "in brief"
// column, the picture grid, then the archive. Nothing here ranks a story by
// anything but its time, so the page never claims an editorial judgment the
// feed did not make.

import type { NewsItem } from '@/lib/news-shared'

export const FRONT_SECONDS = 2
export const FRONT_BRIEFS = 4
export const FRONT_FEATURES = 8
/** A picture row shorter than this reads as a leftover: it joins the archive. */
export const FRONT_FEATURES_MIN = 3

export interface FrontPage {
  lead: NewsItem | null
  seconds: NewsItem[]
  briefs: NewsItem[]
  features: NewsItem[]
  archive: NewsItem[]
}

/** Deal the feed (newest first) into the page's seats. Every item lands in
 *  exactly one seat; none is dropped and none repeats. */
export function frontPage(items: readonly NewsItem[]): FrontPage {
  const lead = items[0] ?? null
  let at = lead ? 1 : 0
  const take = (n: number) => {
    const out = items.slice(at, at + n)
    at += out.length
    return out
  }
  const seconds = take(FRONT_SECONDS)
  const briefs = take(FRONT_BRIEFS)
  let features = take(FRONT_FEATURES)
  if (features.length < FRONT_FEATURES_MIN) {
    at -= features.length
    features = []
  }
  return { lead, seconds, briefs, features, archive: items.slice(at) }
}

/** "The Ethereum Edition". A name that already opens with "The" keeps its own. */
export function nameplate(name: string): string {
  // "Apple Inc." reads better on a masthead as "Apple".
  const n = name
    .replace(/,?\s+(Inc\.?|Corp(oration)?\.?|Co\.?|Ltd\.?|PLC|N\.V\.|S\.A\.|Holdings|Company|Class [A-C])(?=\s|$)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!n) return 'The Edition'
  return /^the\s/i.test(n) ? `${n} Edition` : `The ${n} Edition`
}

/** The dateline under the nameplate: "Tuesday, November 17, 2026". */
export function editionDate(now: Date): string {
  return now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

/** The archive's date stamp: "Nov 7". */
export function archiveDate(publishedAt: number): string {
  return new Date(publishedAt * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ── the price since a story ran ─────────────────────────────────────────────

export interface Bar {
  /** Unix seconds, bar open. */
  t: number
  o: number
  c: number
}

export const HOUR_SEC = 3600
export const DAY_SEC = 86400

/** The price inside one series at time `t`: on the line from the bar's open
 *  to its close while the bar is open, its close once it has shut (a stock's
 *  overnight gap reads the last close). Null before the first bar. */
function priceIn(bars: readonly Bar[], step: number, t: number): number | null {
  if (bars.length === 0 || t < bars[0].t) return null
  let lo = 0
  let hi = bars.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (bars[mid].t <= t) lo = mid
    else hi = mid - 1
  }
  const b = bars[lo]
  const into = (t - b.t) / step
  const p = into >= 1 ? b.c : b.o + (b.c - b.o) * Math.max(0, into)
  return Number.isFinite(p) && p > 0 ? p : null
}

/** The price when a story ran: the hourly tape where it reaches back that
 *  far, the daily one behind it, null where neither does. */
export function priceAt(t: number, hourly: readonly Bar[], daily: readonly Bar[]): number | null {
  return priceIn(hourly, HOUR_SEC, t) ?? priceIn(daily, DAY_SEC, t)
}

export interface Since {
  /** Percent move from the story's price to the last price. */
  pct: number
  from: number
  dir: 'up' | 'down' | 'flat'
}

/** Below this the move is noise and reads "flat". */
export const SINCE_FLAT_PCT = 0.05

export function sinceMove(t: number, last: number | null | undefined, hourly: readonly Bar[], daily: readonly Bar[]): Since | null {
  if (!last || !Number.isFinite(last) || last <= 0) return null
  const from = priceAt(t, hourly, daily)
  if (from === null) return null
  const pct = ((last - from) / from) * 100
  if (!Number.isFinite(pct)) return null
  return { pct, from, dir: Math.abs(pct) < SINCE_FLAT_PCT ? 'flat' : pct > 0 ? 'up' : 'down' }
}

/** "+1.2%", "-0.4%", "flat". Plain ASCII signs. */
export function sinceLabel(s: Since): string {
  if (s.dir === 'flat') return 'flat'
  const abs = Math.abs(s.pct)
  return `${s.pct > 0 ? '+' : '-'}${abs >= 10 ? abs.toFixed(0) : abs.toFixed(1)}%`
}

// ── the plate: the tape around a story, for a lead with no picture ──────────

export interface Plate {
  /** Closes across the window, oldest first. */
  closes: number[]
  /** Where the story ran, as a position along the closes (0 … closes.length - 1). */
  mark: number
  /** 'hour' or 'day' bars. */
  grain: 'hour' | 'day'
}

export const PLATE_MIN_POINTS = 6

function windowOf(bars: readonly Bar[], step: number, t: number, before: number, after: number): Plate | null {
  if (bars.length === 0 || t < bars[0].t) return null
  const from = t - before * step
  const to = t + after * step
  const win = bars.filter((b) => b.t >= from && b.t <= to)
  if (win.length < PLATE_MIN_POINTS) return null
  // The mark sits between the last bar that opened at or before the story and the next.
  let i = 0
  while (i + 1 < win.length && win[i + 1].t <= t) i++
  const span = i + 1 < win.length ? win[i + 1].t - win[i].t : step
  const mark = Math.min(win.length - 1, i + Math.max(0, Math.min(1, (t - win[i].t) / span)))
  return { closes: win.map((b) => b.c), mark, grain: step === HOUR_SEC ? 'hour' : 'day' }
}

/** The tape around a story: a day before and three after on hourly bars, or a
 *  week before and three after on daily ones for an older story. Null when
 *  neither tape holds enough of the window to draw. */
export function plateFor(t: number, hourly: readonly Bar[], daily: readonly Bar[]): Plate | null {
  return windowOf(hourly, HOUR_SEC, t, 24, 72) ?? windowOf(daily, DAY_SEC, t, 7, 21)
}

/** Which way the tape went from the story to the end of the plate's window. */
export function plateDir(p: Plate): 'up' | 'down' | 'flat' {
  const lo = Math.floor(p.mark)
  const hi = Math.min(p.closes.length - 1, lo + 1)
  const at = p.closes[lo] + (p.closes[hi] - p.closes[lo]) * (p.mark - lo)
  const end = p.closes[p.closes.length - 1]
  if (!(at > 0)) return 'flat'
  const pct = ((end - at) / at) * 100
  return Math.abs(pct) < SINCE_FLAT_PCT ? 'flat' : pct > 0 ? 'up' : 'down'
}

export interface PlatePath {
  /** The whole line. */
  line: string
  /** The part of the line after the story. */
  tail: string
  /** The part after the story, closed down to the floor (the filled area). */
  area: string
  /** The story's point. */
  x: number
  y: number
}

/** The plate as SVG paths in a `w` × `h` box (y grows down; `pad` keeps the
 *  line off the edges). */
export function platePath(p: Plate, w: number, h: number, pad = 6): PlatePath {
  const n = p.closes.length
  let min = Math.min(...p.closes)
  let max = Math.max(...p.closes)
  if (max - min < 1e-12) {
    min -= 1
    max += 1
  }
  const x = (i: number) => (n === 1 ? w / 2 : (i / (n - 1)) * w)
  const y = (v: number) => pad + (1 - (v - min) / (max - min)) * (h - pad * 2)
  const r = (v: number) => Math.round(v * 100) / 100
  const pts = p.closes.map((c, i) => [x(i), y(c)] as const)
  const line = pts.map(([px, py], i) => `${i === 0 ? 'M' : 'L'}${r(px)} ${r(py)}`).join(' ')
  const lo = Math.floor(p.mark)
  const hi = Math.min(n - 1, lo + 1)
  const f = p.mark - lo
  const mx = x(p.mark)
  const my = pts[lo][1] + (pts[hi][1] - pts[lo][1]) * f
  const after = pts.slice(hi === lo ? lo : hi)
  const run = after.map(([px, py]) => `L${r(px)} ${r(py)}`).join(' ')
  const tail = `M${r(mx)} ${r(my)} ${run}`.trim()
  const area = `M${r(mx)} ${r(h)} L${r(mx)} ${r(my)} ${run} L${r(w)} ${r(h)} Z`
  return { line, tail, area, x: r(mx), y: r(my) }
}
