// The battle views on /live (2026-10-06): the live tape drawn as a war for
// ground, three ways.
//
// Nate: "select two / three / four tokens and visualize the ground each is
// moving on — a percent move in market cap … current strength in token
// backers. Fun, interactive, visually informative." Then: all three ideas as
// tabs on /live; people pick one to five tokens from the top gainers or the
// biggest, or add their own.
//
// The ground is percent move since an anchor (percent price move IS percent
// market-cap move over a window short enough to matter: supply does not move
// in an hour). The strength is the last sixty seconds of taker fills, buys
// against sells. The three projections of the same scene:
//   • The Front — time left to right, percent bottom to top; each army's
//     front line is its percent track, fills land on it as they happen.
//   • The Siege — a polar arena; each army owns a sector, its track sweeps
//     the sector from its camp at the edge toward the hill at the centre;
//     the most ground is closest to the hill.
//   • The Map — territory bands as wide as each army's open interest (the
//     dollars actually committed, the venue's own number), the terrain as
//     high as its percent move, its history as the elevation profile.
//
// Every pixel is a number: one ▲ is one unit of dollars bought in the last
// sixty seconds, printed in the legend and shared by every army; one ▼ the
// same unit sold; a burst is a fill of four units or more. Nothing on any
// field is estimated. Pure module; lib/battle-feed.ts reads the venue;
// components/live/Battle.tsx + battle-draw.ts draw. Pinned by
// scripts/battle-pins.ts.

import { unitUsd, unitsFor } from '@/lib/derivs'
import { tapeMarket, type TapeFill, type TapeSide } from '@/lib/tape'

// ── Views and the URL ────────────────────────────────────────────────────────

export type BattleView = 'front' | 'siege' | 'map'
export type LiveView = 'tape' | BattleView

export interface LiveViewDef {
  id: LiveView
  label: string
  blurb: string
}

export const LIVE_VIEWS: readonly LiveViewDef[] = [
  { id: 'tape', label: 'Tape', blurb: 'every fill as it lands, with the sentence that does the same' },
  { id: 'front', label: 'The Front', blurb: 'time by percent move; each army’s front line, fills landing on it' },
  { id: 'siege', label: 'The Siege', blurb: 'a polar arena; the most ground holds the hill' },
  { id: 'map', label: 'The Map', blurb: 'land as wide as open interest, as high as percent move' },
]

export function parseLiveView(raw: string | null | undefined): LiveView {
  return LIVE_VIEWS.some((v) => v.id === raw) ? (raw as LiveView) : 'tape'
}

export function isBattleView(v: LiveView): v is BattleView {
  return v !== 'tape'
}

/** `/live` with the view, the armies and the window, nothing default spelled out. */
export function liveUrl(view: LiveView, tokens: readonly string[], window: FrontWindow, pathname = '/live'): string {
  const q = new URLSearchParams()
  if (view !== 'tape') q.set('view', view)
  if (tokens.length) q.set('t', tokens.join(','))
  if (window !== DEFAULT_WINDOW) q.set('since', window)
  const s = q.toString()
  return s ? `${pathname}?${s}` : pathname
}

// ── Windows ──────────────────────────────────────────────────────────────────

export type FrontWindow = 'open' | '15m' | '1h' | '4h' | '24h'

export interface FrontWindowDef {
  id: FrontWindow
  label: string
  /** Null = since the page opened (the anchor is the first price seen). */
  minutes: number | null
}

export const FRONT_WINDOWS: readonly FrontWindowDef[] = [
  { id: 'open', label: 'since open', minutes: null },
  { id: '15m', label: '15m', minutes: 15 },
  { id: '1h', label: '1h', minutes: 60 },
  { id: '4h', label: '4h', minutes: 240 },
  { id: '24h', label: '24h', minutes: 1440 },
]

export const DEFAULT_WINDOW: FrontWindow = '1h'

export function parseFrontWindow(raw: string | null | undefined): FrontWindow {
  const hit = FRONT_WINDOWS.find((w) => w.id === raw)
  return hit ? hit.id : DEFAULT_WINDOW
}

export function windowMinutes(id: FrontWindow): number | null {
  return FRONT_WINDOWS.find((w) => w.id === id)?.minutes ?? null
}

// ── Armies (the tokens) ──────────────────────────────────────────────────────

export const MAX_ARMIES = 5
/** The slot inks, by index; the canvas reads `--army-N` from the page. */
export const ARMY_SLOTS = [1, 2, 3, 4, 5] as const
/** What the field opens with when the venue cannot be asked for its gainers. */
export const FALLBACK_ARMIES: readonly string[] = ['BTC', 'ETH', 'HYPE']
/** How many of the pick list the field opens with. */
export const DEFAULT_PICK = 3

const MARKET_RE = /^(?:xyz:)?[A-Za-z][A-Za-z0-9]{0,11}$/i

/** The venue spells a main-book coin in caps and a HIP-3 market as
 *  `xyz:TICKER`; the URL may arrive in any case. Unknown shapes are dropped,
 *  duplicates collapse, the list is capped. An empty result is no armies. */
export function parseFrontTokens(raw: string | null | undefined): string[] {
  if (!raw) return []
  const out: string[] = []
  for (const part of raw.split(',')) {
    const s = part.trim()
    if (!MARKET_RE.test(s)) continue
    const norm = s.toLowerCase().startsWith('xyz:') ? `xyz:${s.slice(4).toUpperCase()}` : s.toUpperCase()
    if (!out.includes(norm)) out.push(norm)
    if (out.length >= MAX_ARMIES) break
  }
  return out
}

/**
 * Your own army, in the venue's spelling (2026-10-06, Nate: "if they do not
 * appear, I can add 3 or more of my own"). A typed name resolves against
 * the venue's market list: `near` is NEAR, `pepe` is kPEPE (the 1000× coin
 * is what the venue lists), `nvda` is xyz:NVDA (the stock perp). No such
 * market → null, and the page says so in the venue's words. An unknown
 * universe (the read failed) accepts the typed shape as-is, so the box
 * never goes dead.
 */
export function resolveMarket(raw: string, universe: readonly string[]): string | null {
  const [norm] = parseFrontTokens(raw)
  if (!norm) return null
  if (universe.length === 0) return norm
  const byLower = new Map(universe.map((m) => [m.toLowerCase(), m] as const))
  const key = norm.toLowerCase()
  const direct = byLower.get(key)
  if (direct) return direct
  if (!key.startsWith('xyz:')) {
    const kilo = byLower.get(`k${key}`)
    if (kilo) return kilo
    const stock = byLower.get(`xyz:${key}`)
    if (stock) return stock
  }
  return null
}

export interface OwnAdd {
  /** Resolved, new, and inside the cap — in typed order. */
  added: string[]
  /** Typed names the venue lists no market for. */
  unknown: string[]
  /** Resolved markets that did not fit the field. */
  full: string[]
}

/** Several at once: commas or spaces separate (`near sol, doge`). Already
 *  picked markets are skipped silently. */
export function addOwnMarkets(raw: string, universe: readonly string[], current: readonly string[], max = MAX_ARMIES): OwnAdd {
  const out: OwnAdd = { added: [], unknown: [], full: [] }
  for (const part of raw.split(/[,\s]+/)) {
    const s = part.trim()
    if (!s) continue
    const m = resolveMarket(s, universe)
    if (!m) {
      out.unknown.push(s)
      continue
    }
    if (current.includes(m) || out.added.includes(m)) continue
    if (current.length + out.added.length >= max) {
      out.full.push(m)
      continue
    }
    out.added.push(m)
  }
  return out
}

/** The flag's words: `HYPE`, or `NVDA·xyz` for a stock perp. */
export function armyLabel(market: string): string {
  const m = tapeMarket(market)
  return m.dex ? `${m.ticker}·${m.dex}` : m.ticker
}

// ── The picker: top gainers or the biggest, from the venue's own rows ────────

export type PickMode = 'gainers' | 'biggest'

export const PICK_MODES: readonly { id: PickMode; label: string; hint: string }[] = [
  { id: 'gainers', label: 'Top gainers · 24h', hint: 'the venue’s own day change, markets with real open interest' },
  { id: 'biggest', label: 'Biggest · open interest', hint: 'the dollars committed right now; market cap is not a venue number' },
]

export function parsePickMode(raw: string | null | undefined): PickMode {
  return raw === 'biggest' ? 'biggest' : 'gainers'
}

/** Markets under this much open interest never make the pick list (a
 *  thin perp prints a wild day change nobody can trade). */
export const PICK_MIN_OI_USD = 2_000_000
export const PICK_ROWS = 12

export interface PickRow {
  market: string
  /** The venue's day change, percent. */
  dayPct: number | null
  oiUsd: number
}

export function pickList(ctxs: ReadonlyMap<string, ArmyContext>, mode: PickMode, n = PICK_ROWS, minOi = PICK_MIN_OI_USD): PickRow[] {
  const rows: PickRow[] = []
  for (const [market, c] of ctxs) {
    if (/:XYZ100$/.test(market)) continue
    const oi = oiUsd(c)
    if (!(oi >= minOi)) continue
    rows.push({ market, dayPct: dayChangePct(c), oiUsd: oi })
  }
  if (mode === 'gainers') {
    return rows.filter((r) => r.dayPct !== null).sort((a, b) => b.dayPct! - a.dayPct!).slice(0, n)
  }
  return rows.sort((a, b) => b.oiUsd - a.oiUsd).slice(0, n)
}

// ── Prices → ground ──────────────────────────────────────────────────────────

export interface PricePoint {
  /** Milliseconds. */
  t: number
  p: number
}

/** One-minute candles from the venue become two samples each: the open at
 *  the bar's start (so an anchor at the window's edge is the real open) and
 *  the close at its end. */
export function candleSamples(candles: readonly { t: number; T?: number; o: string | number; c: string | number }[]): PricePoint[] {
  const out: PricePoint[] = []
  for (const c of candles) {
    const o = Number(c.o)
    const cl = Number(c.c)
    const end = typeof c.T === 'number' ? c.T : c.t + 59_999
    if (Number.isFinite(o) && o > 0) out.push({ t: c.t, p: o })
    if (Number.isFinite(cl) && cl > 0) out.push({ t: end, p: cl })
  }
  return out
}

/**
 * Merge samples into a sorted, deduped series, one per second (the newest
 * in the second wins) so a day of mids stays a few thousand points.
 * Anything before `keepFrom` is dropped.
 */
export function mergeSamples(existing: readonly PricePoint[], incoming: readonly PricePoint[], keepFrom: number): PricePoint[] {
  const bySec = new Map<number, PricePoint>()
  const put = (s: PricePoint) => {
    if (!Number.isFinite(s.p) || s.p <= 0 || !Number.isFinite(s.t) || s.t < keepFrom) return
    const k = Math.floor(s.t / 1000)
    const prev = bySec.get(k)
    if (!prev || s.t >= prev.t) bySec.set(k, s)
  }
  for (const s of existing) put(s)
  for (const s of incoming) put(s)
  return [...bySec.values()].sort((a, b) => a.t - b.t)
}

/**
 * Append a live sample in place, keeping the series sorted and one per
 * second: a later sample in the same second replaces the earlier one, and a
 * sample older than the last is dropped (the venue's clock rules). Returns
 * whether the series changed.
 */
export function pushSample(samples: PricePoint[], s: PricePoint): boolean {
  if (!Number.isFinite(s.p) || s.p <= 0 || !Number.isFinite(s.t)) return false
  const last = samples[samples.length - 1]
  if (!last) {
    samples.push(s)
    return true
  }
  if (s.t < last.t) return false
  if (Math.floor(s.t / 1000) === Math.floor(last.t / 1000)) {
    samples[samples.length - 1] = s
    return true
  }
  samples.push(s)
  return true
}

export interface Anchor {
  t: number
  p: number
  /** The series starts after the window's edge: the ground is measured
   *  from the first price we hold, and the flag says so. */
  partial: boolean
}

/**
 * Where the ground is measured from. A minute window anchors on the first
 * sample at or after its left edge; "since open" anchors on the first
 * sample at or after the moment the page opened. No sample → no anchor.
 */
export function anchorFor(samples: readonly PricePoint[], window: FrontWindow, nowMs: number, openedAt: number): Anchor | null {
  if (samples.length === 0) return null
  const minutes = windowMinutes(window)
  const edge = minutes === null ? openedAt : nowMs - minutes * 60_000
  const first = samples.find((s) => s.t >= edge) ?? samples[samples.length - 1]
  // Partial when the first sample we hold sits well inside the window (a
  // minute of slack for candle alignment; "since open" is never partial).
  const partial = minutes !== null && first.t - edge > 90_000
  return { t: first.t, p: first.p, partial }
}

export function percentOf(p: number, anchor: Anchor): number {
  return (p / anchor.p - 1) * 100
}

export interface TrackPoint {
  t: number
  p: number
  pct: number
}

/** The army's front line: every sample from the anchor on, as percent. */
export function trackOf(samples: readonly PricePoint[], anchor: Anchor): TrackPoint[] {
  const out: TrackPoint[] = []
  for (const s of samples) {
    if (s.t < anchor.t) continue
    out.push({ t: s.t, p: s.p, pct: percentOf(s.p, anchor) })
  }
  return out
}

// ── The vertical range ───────────────────────────────────────────────────────

export interface PctRange {
  lo: number
  hi: number
}

export const MIN_HALF_RANGE_PCT = 0.25

/**
 * Fit the field to every army's track: the horizon (0) is always on it,
 * the ground reaches 15% past the furthest line, and a flat field still
 * shows a quarter percent each way so the lines have room to move.
 */
export function fitRange(pcts: readonly number[], minHalf = MIN_HALF_RANGE_PCT): PctRange {
  let lo = 0
  let hi = 0
  for (const v of pcts) {
    if (!Number.isFinite(v)) continue
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  const span = hi - lo
  const pad = span * 0.15
  lo -= pad
  hi += pad
  if (hi < minHalf) hi = minHalf
  if (lo > -minHalf) lo = -minHalf
  return { lo, hi }
}

const TICK_STEPS = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 25, 50, 100]

/** Grid lines in percent: a round step that gives four to nine lines. */
export function pctTicks(range: PctRange): number[] {
  const span = range.hi - range.lo
  const step = TICK_STEPS.find((s) => span / s <= 9) ?? TICK_STEPS[TICK_STEPS.length - 1]
  const out: number[] = []
  const start = Math.ceil(range.lo / step) * step
  for (let v = start; v <= range.hi + 1e-9; v += step) out.push(+v.toFixed(4))
  return out
}

// ── Strength: who is backing the army right now ──────────────────────────────

export interface Strength {
  buyUsd: number
  sellUsd: number
  /** buy − sell. */
  netUsd: number
  fills: number
  /** Share of the dollars that were buys, 0–100, or null with no fills. */
  buyPct: number | null
}

export const STRENGTH_WINDOW_MS = 60_000

export function strengthOf(fills: readonly TapeFill[], market: string, nowMs: number, windowMs = STRENGTH_WINDOW_MS): Strength {
  let buy = 0
  let sell = 0
  let n = 0
  const from = nowMs - windowMs
  for (const f of fills) {
    if (f.at < from) break
    if (f.market !== market) continue
    n++
    if (f.side === 'buy') buy += f.usd
    else sell += f.usd
  }
  const total = buy + sell
  return { buyUsd: buy, sellUsd: sell, netUsd: buy - sell, fills: n, buyPct: total > 0 ? Math.round((buy / total) * 100) : null }
}

/** The field's unit: one glyph's dollars, chosen so the strongest side of
 *  the strongest army is at most `maxGlyphs` glyphs. Shared by every army
 *  and printed in the legend. */
export function fieldUnit(strengths: readonly Strength[], maxGlyphs = 20): number {
  let max = 0
  for (const s of strengths) max = Math.max(max, s.buyUsd, s.sellUsd)
  return unitUsd(max, maxGlyphs)
}

export function glyphsFor(usd: number, unit: number): number {
  return unitsFor(usd, unit)
}

/** A burst: a fill of at least this many units. */
export const BURST_UNITS = 4

export interface Burst {
  t: number
  price: number
  usd: number
  side: TapeSide
  id: string
}

/** The big prints on an army's track from `from` on, in time order. */
export function burstsOf(fills: readonly TapeFill[], market: string, unit: number, from: number): Burst[] {
  const floor = unit * BURST_UNITS
  const out: Burst[] = []
  for (const f of fills) {
    if (f.at < from) break
    if (f.market !== market || f.usd < floor) continue
    out.push({ t: f.at, price: f.price, usd: f.usd, side: f.side, id: f.id })
  }
  out.sort((a, b) => a.t - b.t)
  return out
}

// ── Rank ─────────────────────────────────────────────────────────────────────

export interface RankedArmy<T> {
  army: T
  pct: number | null
  rank: number
}

/** Most ground first; an army with no ground yet ranks last, in list order. */
export function rankArmies<T>(armies: readonly T[], pctOf: (a: T) => number | null): RankedArmy<T>[] {
  const rows = armies.map((army) => ({ army, pct: pctOf(army) }))
  const sorted = [...rows].sort((a, b) => {
    if (a.pct === null && b.pct === null) return 0
    if (a.pct === null) return 1
    if (b.pct === null) return -1
    return b.pct - a.pct
  })
  return sorted.map((r, i) => ({ ...r, rank: i + 1 }))
}

// ── The Siege: the polar arena ───────────────────────────────────────────────

export interface Sector {
  /** Radians, clockwise from twelve o'clock in canvas space (−π/2 is up). */
  start: number
  end: number
}

/** One sector per army, equal, the first starting at the right (three
 *  o'clock) so two armies face each other left and right. One army owns the
 *  whole circle. */
export function siegeSectors(n: number): Sector[] {
  const count = Math.max(1, n)
  const out: Sector[] = []
  const span = (Math.PI * 2) / count
  for (let i = 0; i < count; i++) out.push({ start: -Math.PI / 2 + i * span, end: -Math.PI / 2 + (i + 1) * span })
  return out
}

/** The hill is at the centre: the most ground (the range's top) stands at
 *  `inner × R` from it, the least (the range's bottom) at the camp on the
 *  edge. */
export const SIEGE_INNER = 0.14

export function siegeRadius(pct: number, range: PctRange, R: number, inner = SIEGE_INNER): number {
  const span = Math.max(1e-9, range.hi - range.lo)
  const k = Math.min(1, Math.max(0, (range.hi - pct) / span))
  return R * (inner + (1 - inner) * k)
}

/** Time sweeps the sector from its start edge to its end edge, a small
 *  margin kept on both sides so neighbours never touch. */
export function siegeAngle(t: number, from: number, to: number, sector: Sector, margin = 0.05): number {
  const k = Math.min(1, Math.max(0, (t - from) / Math.max(1, to - from)))
  const width = sector.end - sector.start
  return sector.start + width * (margin + k * (1 - 2 * margin))
}

// ── Flags that never overlap ─────────────────────────────────────────────────

/**
 * Flag rows want to sit at their front's height; two fronts a few pixels
 * apart would print on top of each other. Keep each flag at least `gap`
 * from the next, in the fronts' own order, inside [top, bottom]. Returns
 * the adjusted ys in the input's order.
 */
export function spreadFlags(ys: readonly number[], gap: number, top: number, bottom: number): number[] {
  const idx = ys.map((y, i) => ({ y: Math.min(Math.max(y, top), bottom), i })).sort((a, b) => a.y - b.y)
  for (let k = 1; k < idx.length; k++) idx[k].y = Math.max(idx[k].y, idx[k - 1].y + gap)
  if (idx.length) {
    idx[idx.length - 1].y = Math.min(idx[idx.length - 1].y, bottom)
    for (let k = idx.length - 2; k >= 0; k--) idx[k].y = Math.min(idx[k].y, idx[k + 1].y - gap)
    for (let k = 0; k < idx.length; k++) idx[k].y = Math.max(idx[k].y, top + k * gap)
  }
  const out = new Array<number>(ys.length)
  for (const { y, i } of idx) out[i] = y
  return out
}

// ── The Map: territory bands ─────────────────────────────────────────────────

/** No band narrower than this share of the field, so a small army's
 *  profile can still be read; the deed on the band prints the real share. */
export const MAP_MIN_BAND_SHARE = 0.14

export interface Band {
  x: number
  w: number
  /** This army's share of the field's open interest, 0–1 (equal shares
   *  when nothing is known). */
  share: number
}

/**
 * Bands as wide as each army's open interest share of the field, every
 * band at least `minW` wide so a small army still has a front, gaps
 * between. Null open interest reads as unknown: equal shares when nothing
 * is known, zero when others are.
 */
export function mapBands(oi: readonly (number | null)[], plotW: number, gap = 10, minW = 72): Band[] {
  const n = oi.length
  if (n === 0) return []
  const known = oi.filter((v): v is number => v !== null && v > 0)
  const total = known.reduce((s, v) => s + v, 0)
  const shares = oi.map((v) => (total > 0 ? (v !== null && v > 0 ? v / total : 0) : 1 / n))
  const avail = Math.max(minW * n, plotW - gap * (n - 1))
  // Widths by share, then every band lifted to the minimum and the excess
  // taken from the widest so the row still fits.
  let widths = shares.map((s) => s * avail)
  let deficit = 0
  widths = widths.map((w) => {
    if (w < minW) {
      deficit += minW - w
      return minW
    }
    return w
  })
  while (deficit > 1e-6) {
    const i = widths.indexOf(Math.max(...widths))
    const give = Math.min(deficit, widths[i] - minW)
    if (give <= 0) break
    widths[i] -= give
    deficit -= give
  }
  const out: Band[] = []
  let x = 0
  widths.forEach((w, i) => {
    out.push({ x, w, share: shares[i] })
    x += w + gap
  })
  return out
}

// ── The venue's context row ──────────────────────────────────────────────────

export interface ArmyContext {
  markPx: number
  /** Open interest in coins; × markPx for dollars. */
  openInterest: number
  /** The venue's current funding rate per hour, as a fraction. */
  funding: number
  prevDayPx: number
  dayNtlVlm: number
}

export function contextFrom(row: { markPx: string | number; openInterest: string | number; funding: string | number; prevDayPx: string | number; dayNtlVlm: string | number }): ArmyContext | null {
  const n = (v: string | number) => Number(v)
  const c = { markPx: n(row.markPx), openInterest: n(row.openInterest), funding: n(row.funding), prevDayPx: n(row.prevDayPx), dayNtlVlm: n(row.dayNtlVlm) }
  if (!Number.isFinite(c.markPx) || c.markPx <= 0) return null
  for (const k of ['openInterest', 'funding', 'prevDayPx', 'dayNtlVlm'] as const) if (!Number.isFinite(c[k])) c[k] = 0
  return c
}

export function oiUsd(c: ArmyContext): number {
  return c.openInterest * c.markPx
}

export function dayChangePct(c: ArmyContext): number | null {
  return c.prevDayPx > 0 ? (c.markPx / c.prevDayPx - 1) * 100 : null
}

// ── Formats ──────────────────────────────────────────────────────────────────

/** `+2.31%` · `−0.06%` · `+0.004%` (three places under a hundredth) · `+12.3%`. */
export function fmtPct(pct: number | null): string {
  if (pct === null || !Number.isFinite(pct)) return '—'
  const abs = Math.abs(pct)
  const places = abs >= 10 ? 1 : abs > 0 && abs < 0.01 ? 3 : 2
  const sign = pct > 0 ? '+' : pct < 0 ? '−' : ''
  return `${sign}${abs.toFixed(places)}%`
}

/** Funding as the venue quotes it, per hour: `+0.0013%/h`. */
export function fmtFunding(perHour: number): string {
  const pct = perHour * 100
  const sign = pct > 0 ? '+' : pct < 0 ? '−' : ''
  return `${sign}${Math.abs(pct).toFixed(4)}%/h`
}
