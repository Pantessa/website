// ─────────────────────────────────────────────────────────────────────────
//  The battlefield — the chart's second view (components/markets/chart/
//  BattleField). The SAME bars the candles draw, tipped back onto a tabletop
//  map: time still runs left to right, price still runs near to far, and the
//  close is the front line. Ground under the line is held by buyers, ground
//  over it by sellers; a bar's body is the ground that changed hands that
//  bar and its volume is how tall the block stands.
//
//  Pure + client-safe: the projection, the price scale, the calendar bands,
//  who is winning and the words of a bar's battle report all live here so
//  the harness can pin them without a canvas. Nothing in this file invents
//  a number: every figure in a report is the bar's own o/h/l/c/v.
// ─────────────────────────────────────────────────────────────────────────

import type { Candle, ChartTf } from './charts'

// ── Projection ────────────────────────────────────────────────────────────

export interface FieldBox {
  left: number
  top: number
  width: number
  height: number
}

export interface FieldPoint {
  x: number
  y: number
  /** Perspective scale at that depth (1 at the near edge), for upright sprites. */
  s: number
}

/** The road along the near edge (the calendar) takes this much ground below price zero. */
export const ROAD_V = -0.13
/** How hard the far edge is squeezed at full tilt. Width and depth share the
 *  one divisor, so the map is a true projection: a straight line on the ground
 *  (a wall, a month's edge, a trend line) stays straight on screen. */
const DEPTH_K = 0.65
/** At full tilt the field gives the top of the box to the sky. */
const SKY = 0.26

/** Ground coordinates → pixels. `u` is time (0 = first bar's left edge, 1 =
 *  the last bar's right edge), `v` is price (0 = the scale's floor, 1 = its
 *  ceiling; ROAD_V..0 is the calendar road). `tilt` 0 is the flat chart, 1 the
 *  tabletop: animating it tips the chart over without moving a bar sideways
 *  at the near edge. */
export function fieldProjector(box: FieldBox, tilt: number) {
  const k = DEPTH_K * Math.max(0, Math.min(1, tilt))
  const span = 1 - ROAD_V
  const usable = box.height * (1 - SKY * Math.max(0, Math.min(1, tilt)))
  const bottom = box.top + box.height
  const cx = box.left + box.width / 2
  const project = (u: number, v: number): FieldPoint => {
    const w = (v - ROAD_V) / span
    const s = 1 / (1 + k * w)
    return { x: cx + (u - 0.5) * box.width * s, y: bottom - w * (1 + k) * s * usable, s }
  }
  const unproject = (x: number, y: number): { u: number; v: number } => {
    const d = (bottom - y) / usable
    const w = d / (1 + k - k * d)
    const s = 1 / (1 + k * w)
    return { u: (x - cx) / (box.width * s) + 0.5, v: ROAD_V + w * span }
  }
  return { project, unproject }
}

// ── Scale ─────────────────────────────────────────────────────────────────

export interface FieldScale {
  lo: number
  hi: number
  vOf: (price: number) => number
}

/** The price scale: every wick on the field plus a margin, never below zero.
 *  `include` stretches it to hold prices off the tape (a liquidation cluster
 *  ahead, a player's line). */
export function fieldScale(bars: Candle[], include: number[] = []): FieldScale {
  let lo = Infinity
  let hi = -Infinity
  for (const b of bars) {
    if (b.l < lo) lo = b.l
    if (b.h > hi) hi = b.h
  }
  for (const p of include) {
    if (!Number.isFinite(p) || p <= 0) continue
    if (p < lo) lo = p
    if (p > hi) hi = p
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
    lo = 0
    hi = 1
  }
  const pad = (hi - lo || hi || 1) * 0.08
  const floor = Math.max(0, lo - pad)
  const ceil = hi + pad
  return { lo: floor, hi: ceil, vOf: (p) => (p - floor) / (ceil - floor) }
}

/** Round price ticks across the scale (about `want` of them). */
export function fieldTicks(lo: number, hi: number, want = 5): number[] {
  const span = hi - lo
  if (!(span > 0)) return []
  const raw = span / want
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= want + 1) ?? 10 * mag
  const out: number[] = []
  for (let p = Math.ceil(lo / step) * step; p < hi; p += step) out.push(Number(p.toPrecision(12)))
  return out
}

// ── The calendar ──────────────────────────────────────────────────────────

export type Season = 'winter' | 'spring' | 'summer' | 'autumn'

/** Meteorological seasons, northern hemisphere, by the bar's UTC month. */
export function seasonOf(t: number): Season {
  const m = new Date(t * 1000).getUTCMonth()
  return m === 11 || m <= 1 ? 'winter' : m <= 4 ? 'spring' : m <= 7 ? 'summer' : 'autumn'
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

export interface TimeBand {
  /** First and last bar index (inclusive). */
  from: number
  to: number
  /** The signpost on the road: a month ("OCT", "JAN 2026") or a day ("MON 5"). */
  label: string
  season: Season
}

/** The field's calendar: one band of ground per month on the slow frames
 *  (4H, 1D), one per day on the fast ones (15m, 1H). The road signs, the
 *  alternating ground and the forest's season all read these. UTC, like the
 *  bars. */
export function timeBands(bars: Candle[], tf: ChartTf): TimeBand[] {
  const byMonth = tf === '1d' || tf === '4h'
  const out: TimeBand[] = []
  let key = ''
  bars.forEach((b, i) => {
    const d = new Date(b.t * 1000)
    const k = byMonth ? `${d.getUTCFullYear()}-${d.getUTCMonth()}` : `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`
    if (k === key) {
      out[out.length - 1].to = i
      return
    }
    key = k
    const label = byMonth
      ? d.getUTCMonth() === 0 || out.length === 0
        ? `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
        : MONTHS[d.getUTCMonth()]
      : `${DAYS[d.getUTCDay()]} ${d.getUTCDate()}`
    out.push({ from: i, to: i, label, season: seasonOf(b.t) })
  })
  return out
}

/** The tear-off calendar's parts for a bar. Intraday frames carry the hour. */
export function fieldDate(t: number, tf: ChartTf): { month: string; day: string; year: string; time: string | null } {
  const d = new Date(t * 1000)
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  return { month: MONTHS[d.getUTCMonth()], day: String(d.getUTCDate()), year: String(d.getUTCFullYear()), time: tf === '1d' ? null : `${hh}:${mm} UTC` }
}

// ── Who is winning ────────────────────────────────────────────────────────

export interface Pressure {
  side: 'bulls' | 'bears' | 'stalemate'
  /** Share of the stretch's force that pushed up, 0..1. Volume on up bars over
   *  all volume; a tape with no volume weighs each bar by its body instead. */
  bullShare: number
  /** Close of the last bar against the open of the first. */
  move: number
  movePct: number
  /** The close the stretch ends on. */
  last: number
  /** Bars in the stretch (shorter than asked near the start of the field). */
  bars: number
}

export const PRESSURE_BARS = 20

/** The trailing stretch ending at bar `i`: who took ground, and with what
 *  share of the force. A move smaller than half an average bar's range is a
 *  stalemate, whatever the volume says. */
export function pressureAt(bars: Candle[], i: number, lookback = PRESSURE_BARS): Pressure | null {
  if (!bars.length || i < 0) return null
  const end = Math.min(i, bars.length - 1)
  const start = Math.max(0, end - lookback + 1)
  let up = 0
  let all = 0
  let upBody = 0
  let allBody = 0
  let range = 0
  for (let j = start; j <= end; j++) {
    const b = bars[j]
    const body = Math.abs(b.c - b.o)
    all += b.v
    allBody += body
    if (b.c >= b.o) {
      up += b.v
      upBody += body
    }
    range += b.h - b.l
  }
  const n = end - start + 1
  const move = bars[end].c - bars[start].o
  const movePct = bars[start].o > 0 ? (move / bars[start].o) * 100 : 0
  const bullShare = all > 0 ? up / all : allBody > 0 ? upBody / allBody : 0.5
  const side = Math.abs(move) < (range / n) * 0.5 ? 'stalemate' : move > 0 ? 'bulls' : 'bears'
  return { side, bullShare, move, movePct, last: bars[end].c, bars: n }
}

/** Units on the field for a stretch: between `min` and `max` in all, split by
 *  the force share, each side keeping at least two so a rout still has someone
 *  to rout. */
export function troopCounts(bullShare: number, total: number): { bulls: number; bears: number } {
  const t = Math.max(4, Math.round(total))
  const bulls = Math.min(t - 2, Math.max(2, Math.round(t * Math.max(0, Math.min(1, bullShare)))))
  return { bulls, bears: t - bulls }
}

/** Index of the highest high and the lowest low among bars 0..upTo. */
export function fieldRecords(bars: Candle[], upTo = bars.length - 1): { high: number; low: number } | null {
  if (!bars.length || upTo < 0) return null
  let high = 0
  let low = 0
  for (let i = 1; i <= Math.min(upTo, bars.length - 1); i++) {
    if (bars[i].h > bars[high].h) high = i
    if (bars[i].l < bars[low].l) low = i
  }
  return { high, low }
}

// ── A bar's battle report ─────────────────────────────────────────────────

/** Dollars at the precision of `ref` (the price the amount is a move OF): 47
 *  cents of ground on an $8 token reads $0.47, not $0.4700. */
const fmtUsd = (n: number, ref = n): string => {
  const a = Math.abs(n)
  const r = Math.abs(ref)
  if (r >= 1 && a < 1) return `$${a.toFixed(2)}`
  if (a >= 1000) return `$${a.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
  if (a >= 1) return `$${a.toFixed(2)}`
  if (a >= 0.01) return `$${a.toFixed(4)}`
  return `$${a.toPrecision(3)}`
}

export function fmtForce(n: number): string {
  const a = Math.abs(n)
  if (a >= 1e9) return `${(a / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `${(a / 1e6).toFixed(2)}M`
  if (a >= 1e3) return `${(a / 1e3).toFixed(1)}K`
  return a >= 10 ? a.toFixed(0) : a.toFixed(2)
}

export interface BattleReport {
  outcome: 'bulls' | 'bears' | 'stalemate'
  headline: string
  /** One fact a line, each the bar's own numbers. */
  lines: string[]
}

/** What happened on one bar, in the field's words. A body under a tenth of
 *  the bar's range is a stalemate; a wick over half the range that the close
 *  gave back is a raid thrown back. */
export function battleReport(bar: Candle, symbol: string): BattleReport {
  const body = bar.c - bar.o
  const range = bar.h - bar.l
  const pct = bar.o > 0 ? (body / bar.o) * 100 : 0
  const outcome: BattleReport['outcome'] = range <= 0 || Math.abs(body) < range * 0.1 ? 'stalemate' : body > 0 ? 'bulls' : 'bears'
  const sign = pct >= 0 ? '+' : '−'
  const headline =
    outcome === 'stalemate'
      ? `Stalemate. The line held at ${fmtUsd(bar.c)}`
      : outcome === 'bulls'
        ? `Bulls took ${fmtUsd(body, bar.c)} of ground (${sign}${Math.abs(pct).toFixed(2)}%)`
        : `Bears took back ${fmtUsd(body, bar.c)} (${sign}${Math.abs(pct).toFixed(2)}%)`
  const lines = [`Line moved ${fmtUsd(bar.o)} → ${fmtUsd(bar.c)}`]
  const top = bar.h - Math.max(bar.o, bar.c)
  const bottom = Math.min(bar.o, bar.c) - bar.l
  if (range > 0 && top > range * 0.5) lines.push(`Bulls raided to ${fmtUsd(bar.h)} and were thrown back`)
  else if (range > 0 && bottom > range * 0.5) lines.push(`Bears broke through to ${fmtUsd(bar.l)} and lost it again`)
  else lines.push(`Fighting ranged ${fmtUsd(bar.l)} to ${fmtUsd(bar.h)}`)
  if (bar.v > 0) lines.push(`Force committed: ${fmtForce(bar.v)} ${symbol} (~${fmtUsd(bar.v * bar.c).replace(/\.\d+$/, '')})`)
  return { outcome, headline, lines }
}

/** The line under the pressure bar: "Bulls took $1.24 (+16.2%) over 20 bars". */
export function pressureLine(p: Pressure): string {
  const pct = `${p.movePct >= 0 ? '+' : '−'}${Math.abs(p.movePct).toFixed(1)}%`
  if (p.side === 'stalemate') return `Dug in: ${pct} over ${p.bars} bars`
  return `${p.side === 'bulls' ? 'Bulls took' : 'Bears took'} ${fmtUsd(p.move, p.last)} (${pct}) over ${p.bars} bars`
}

// ── Scenery ───────────────────────────────────────────────────────────────

/** A stable 0..1 hash: the forest and the units stand in the same places on
 *  every frame and every reload. */
export function fieldHash(n: number, salt = 0): number {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(salt + 0x1b873593, 0xc2b2ae35)
  x ^= x >>> 15
  x = Math.imul(x, 0x2c1b3c6d)
  x ^= x >>> 12
  x = Math.imul(x, 0x297a2d39)
  x ^= x >>> 15
  return (x >>> 0) / 4294967296
}

/** The most bars the field draws: past it, the newest ones. */
export const FIELD_MAX_BARS = 400

/** Empty slots past the newest bar: the ground ahead, where the liquidation
 *  clusters and a player's lines are drawn before price gets there. */
export const fieldAhead = (bars: number): number => Math.max(8, Math.round(bars * 0.22))
