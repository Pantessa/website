// ─────────────────────────────────────────────────────────────────────────
//  THE WALL — every dollar standing between the price and anywhere it might
//  go, gathered into rungs on the price axis (components/markets/chart/
//  TheWall draws them on the candle chart's right margin).
//
//  A rung is a price band `stepPct` wide. The grid is anchored on the LAST
//  price, so the price itself is always a rung boundary: k = −1 is the first
//  band under it, k = 0 the first band over it. Each rung keeps its kinds of
//  dollars apart, because the UI draws them apart:
//    spotUsd    resting orders on Coinbase's book        MEASURED, live
//    perpUsd    resting orders on Hyperliquid's book     MEASURED, live
//    liqUsd     the liquidation map's clusters           ESTIMATED (hatched)
//    tradedUsd  what the bars on screen traded there     DERIVED from the tape;
//               its own scale, never summed with the standing dollars
//  `usd` is the standing total (spot + perp + liq): what a rung's bar scales by.
//
//  Pure + client-safe. Pinned by scripts/battlefield-pins.ts.
// ─────────────────────────────────────────────────────────────────────────

import type { Candle } from './charts'
import type { BookBody, LiqHit, LiqLevel } from './derivs'

/** A rung's height as a share of the price. */
export const WALL_STEP_PCT = 1.5
/** How far above and below the price the ladder reaches. */
export const WALL_RANGE_PCT = 12
export const WALL_RANGE_PCT_NARROW = 6
/** Pixels the ladder asks of the chart's right margin, wide and narrow. */
export const WALL_PX = 220
export const WALL_PX_NARROW = 64
/** A plot narrower than this gets the narrow ladder (no labels, nearer rungs). */
export const WALL_NARROW_BELOW = 640

export interface WallRung {
  /** Band index on the grid anchored at the last price: −1 just under it, 0 just over it. */
  k: number
  lo: number
  hi: number
  /** The band's middle. */
  price: number
  side: 'below' | 'above'
  spotUsd: number
  perpUsd: number
  liqUsd: number
  tradedUsd: number
  /** Standing dollars: spot + perp + liq. */
  usd: number
}

export interface Wall {
  rungs: WallRung[]
  /** Band height in price. */
  step: number
  /** Rungs per side. */
  perSide: number
  /** The biggest standing total and the biggest traded total, for scaling. */
  max: number
  tradedMax: number
}

type Book = Pick<BookBody, 'bids' | 'asks'>

export interface WallInput {
  last: number
  spot?: Book | null
  perp?: Book | null
  /** The liquidation map's standing levels (ESTIMATED). */
  levels?: readonly Pick<LiqLevel, 'price' | 'usd'>[]
  /** The held bars and the index range on screen, for `tradedUsd`. */
  bars?: readonly Candle[]
  from?: number
  to?: number
  stepPct?: number
  rangePct?: number
}

export const EMPTY_WALL: Wall = { rungs: [], step: 0, perSide: 0, max: 0, tradedMax: 0 }

/** The rungs within `rangePct` of the price, every one present (so the ladder
 *  can label its grid evenly), each carrying what stands in its band. */
export function wallRungs(x: WallInput): Wall {
  const last = x.last
  if (!(last > 0)) return EMPTY_WALL
  const stepPct = x.stepPct ?? WALL_STEP_PCT
  const rangePct = x.rangePct ?? WALL_RANGE_PCT
  if (!(stepPct > 0) || !(rangePct > 0)) return EMPTY_WALL
  const step = (last * stepPct) / 100
  const perSide = Math.ceil(rangePct / stepPct)
  const kOf = (p: number) => Math.floor((p - last) / step)
  const inRange = (k: number) => k >= -perSide && k < perSide
  const by = new Map<number, WallRung>()
  const rung = (k: number): WallRung => {
    let r = by.get(k)
    if (!r) {
      const lo = last + k * step
      r = { k, lo, hi: lo + step, price: lo + step / 2, side: k < 0 ? 'below' : 'above', spotUsd: 0, perpUsd: 0, liqUsd: 0, tradedUsd: 0, usd: 0 }
      by.set(k, r)
    }
    return r
  }
  for (let k = -perSide; k < perSide; k++) rung(k)
  const addBook = (book: Book, field: 'spotUsd' | 'perpUsd') => {
    for (const l of [...book.bids, ...book.asks]) {
      if (!(l.usd > 0) || !(l.px > 0)) continue
      const k = kOf(l.px)
      if (inRange(k)) rung(k)[field] += l.usd
    }
  }
  if (x.spot) addBook(x.spot, 'spotUsd')
  if (x.perp) addBook(x.perp, 'perpUsd')
  for (const lv of x.levels ?? []) {
    if (!(lv.usd > 0) || !(lv.price > 0)) continue
    const k = kOf(lv.price)
    if (inRange(k)) rung(k).liqUsd += lv.usd
  }
  const bars = x.bars ?? []
  if (bars.length) {
    const lo = Math.max(0, Math.floor(x.from ?? 0))
    const hi = Math.min(bars.length - 1, Math.ceil(x.to ?? bars.length - 1))
    for (let i = lo; i <= hi; i++) {
      const b = bars[i]
      if (!(b.v > 0) || !(b.c > 0)) continue
      const k = kOf(b.c)
      if (inRange(k)) rung(k).tradedUsd += b.v * b.c
    }
  }
  const rungs = [...by.values()].sort((a, b) => a.k - b.k)
  let max = 0
  let tradedMax = 0
  for (const r of rungs) {
    r.usd = r.spotUsd + r.perpUsd + r.liqUsd
    if (r.usd > max) max = r.usd
    if (r.tradedUsd > tradedMax) tradedMax = r.tradedUsd
  }
  return { rungs, step, perSide, max, tradedMax }
}

/** The rung whose band holds `price`, or null off the ladder. */
export function wallRungAt(w: Wall, last: number, price: number): WallRung | null {
  if (!(w.step > 0) || !(price > 0)) return null
  const k = Math.floor((price - last) / w.step)
  return w.rungs.find((r) => r.k === k) ?? null
}

export interface WallSummary {
  /** Standing resting orders within the fence, under and over the price. */
  belowUsd: number
  aboveUsd: number
  /** Estimated liquidation dollars within the fence, under and over. */
  belowEst: number
  aboveEst: number
}

/** What stands within `pct` of the price on each side. */
export function wallSummary(w: Wall, last: number, pct = 5): WallSummary {
  const s: WallSummary = { belowUsd: 0, aboveUsd: 0, belowEst: 0, aboveEst: 0 }
  if (!(last > 0)) return s
  for (const r of w.rungs) {
    if (Math.abs(r.price / last - 1) > pct / 100) continue
    if (r.side === 'below') {
      s.belowUsd += r.spotUsd + r.perpUsd
      s.belowEst += r.liqUsd
    } else {
      s.aboveUsd += r.spotUsd + r.perpUsd
      s.aboveEst += r.liqUsd
    }
  }
  return s
}

// ── Hits: the bars whose range reached an estimated cluster ───────────────

export interface WallHit {
  /** The bar that reached the levels. */
  at: number
  side: 'long' | 'short'
  /** Dollars set off on that bar, that side (ESTIMATED). */
  usd: number
  /** The dollar-weighted price of the levels that went. */
  price: number
  /** How many levels went. */
  count: number
}

/** The map's hits gathered per bar and side, biggest first. */
export function wallHits(hits: readonly LiqHit[]): { hits: WallHit[]; max: number } {
  const by = new Map<string, WallHit & { wsum: number }>()
  for (const h of hits) {
    if (!(h.usd > 0)) continue
    const key = `${h.at}:${h.side}`
    const cur = by.get(key)
    if (cur) {
      cur.usd += h.usd
      cur.wsum += h.price * h.usd
      cur.count++
    } else by.set(key, { at: h.at, side: h.side, usd: h.usd, price: h.price, count: 1, wsum: h.price * h.usd })
  }
  const out = [...by.values()].map(({ wsum, ...h }) => ({ ...h, price: wsum / h.usd })).sort((a, b) => b.usd - a.usd)
  return { hits: out, max: out.length ? out[0].usd : 0 }
}

// ── The margin the chart leaves for the ladder ───────────────────────────

/** Which ladder a plot this wide gets, in pixels (0 = none). */
export function wallWidthPx(plotWidth: number, on: boolean): number {
  if (!on || !(plotWidth > 0)) return 0
  return plotWidth < WALL_NARROW_BELOW ? WALL_PX_NARROW : WALL_PX
}

/** The chart's right offset in BARS that leaves `px` of room at the current
 *  bar spacing, never under `fallback` (the chart's own breathing room). The
 *  margin is a bar count in the engine, so a zoom changes the pixels it is
 *  worth; the chart re-asks on every range change. */
export function marginBarsFor(px: number, barSpacing: number, fallback: number): number {
  if (!(px > 0)) return fallback
  const spacing = Math.max(1, barSpacing || 1)
  return Math.max(fallback, Math.ceil(px / spacing) + 1)
}
