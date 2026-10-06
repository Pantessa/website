// ─────────────────────────────────────────────────────────────────────────
//  Positioning — who is long, who is short, and where each side breaks.
//  The battlefield (components/markets/chart/BattleField) reads this to put
//  the perp market on the board: the armies are the long and short ACCOUNTS,
//  the powder kegs are where leveraged positions get liquidated, and a player
//  is one position with its own liquidation line.
//
//  Pure + client-safe. Two kinds of numbers live here, and the UI keeps them
//  apart:
//    MEASURED   the long/short account share, open interest and funding, as
//               an exchange publishes them (lib/derivs-read names the source)
//    ESTIMATED  the liquidation map. No exchange publishes where positions
//               liquidate; like every such map it is a model: open interest
//               that appeared on a bar is assumed opened near that bar's
//               price across a spread of leverages. It says where the fuel
//               probably is, never that price will go there.
// ─────────────────────────────────────────────────────────────────────────

import type { Candle } from './charts'

export interface OiPoint {
  /** Unix seconds of the reading. */
  t: number
  oi: number
}
export interface RatioPoint {
  t: number
  /** Share of accounts net long, 0..1. */
  long: number
}

export interface DerivsBody {
  symbol: string
  tf: string
  /** The exchange the series come from, or null when none answered. */
  source: string | null
  /** 'coin' = contracts in the token's units; 'usd' = notional dollars. */
  oiUnit: 'coin' | 'usd'
  oi: OiPoint[]
  ratio: RatioPoint[]
  /** That exchange's current funding per 8 hours, as a fraction (0.0001 = 0.01%). */
  funding8h: number | null
  /** Hyperliquid, where the board's orders execute. */
  hl: { mark: number; fundingHr: number; oiUsd: number; maxLeverage: number } | null
  /** Readers that did not answer, by name. */
  missing: string[]
}

// ── The liquidation map (ESTIMATED) ───────────────────────────────────────

/** The spread of leverage new positions are assumed to open at. Weights sum to 1. */
export const LIQ_TIERS: { lev: number; w: number }[] = [
  { lev: 5, w: 0.25 },
  { lev: 10, w: 0.35 },
  { lev: 25, w: 0.25 },
  { lev: 50, w: 0.15 },
]
/** Maintenance margin: a position liquidates a little before its margin is gone. */
const MAINT = 0.005

export interface LiqLevel {
  /** Whose positions liquidate here: longs sit under the price, shorts over it. */
  side: 'long' | 'short'
  price: number
  usd: number
  /** The bar the positions opened on. */
  from: number
}
export interface LiqHit extends LiqLevel {
  /** The bar whose range reached the level. */
  at: number
}
export interface LiqMap {
  alive: LiqLevel[]
  hits: LiqHit[]
}

/** Open interest at each bar's open, carried from the last reading at or
 *  before it; null before the first reading. One extra entry for "now". */
export function oiAtBars(bars: Candle[], oi: OiPoint[]): (number | null)[] {
  const out: (number | null)[] = []
  let j = -1
  for (const b of bars) {
    while (j + 1 < oi.length && oi[j + 1].t <= b.t) j++
    out.push(j >= 0 ? oi[j].oi : null)
  }
  out.push(oi.length && bars.length && oi[oi.length - 1].t > bars[bars.length - 1].t ? oi[oi.length - 1].oi : null)
  return out
}

/** Walk the bars through `upTo`: open interest that APPEARS on a bar becomes
 *  liquidation levels on both sides of that bar's typical price (every new
 *  contract has a long and a short), open interest that LEAVES thins every
 *  level still standing, and a later bar whose range reaches a level sets it
 *  off (a hit) and removes it. */
export function liquidationMap(bars: Candle[], oi: OiPoint[], unit: 'coin' | 'usd', upTo = bars.length - 1): LiqMap {
  const alive: LiqLevel[] = []
  const hits: LiqHit[] = []
  if (!bars.length || oi.length < 2) return { alive, hits }
  const at = oiAtBars(bars, oi)
  const end = Math.min(upTo, bars.length - 1)
  for (let i = 0; i <= end; i++) {
    const b = bars[i]
    // The bar's own range sets off what stood before it.
    for (let k = alive.length - 1; k >= 0; k--) {
      const lv = alive[k]
      if (lv.side === 'long' ? b.l <= lv.price : b.h >= lv.price) {
        hits.push({ ...lv, at: i })
        alive.splice(k, 1)
      }
    }
    const a = at[i]
    const z = at[i + 1]
    if (a === null || z === null || a <= 0) continue
    const delta = z - a
    if (delta < 0) {
      const keep = Math.max(0, 1 + delta / a)
      for (const lv of alive) lv.usd *= keep
      continue
    }
    if (delta === 0) continue
    const entry = (b.h + b.l + b.c) / 3
    const notional = unit === 'coin' ? delta * entry : delta
    for (const { lev, w } of LIQ_TIERS) {
      alive.push({ side: 'long', price: entry * (1 - 1 / lev + MAINT), usd: notional * w, from: i })
      alive.push({ side: 'short', price: entry * (1 + 1 / lev - MAINT), usd: notional * w, from: i })
    }
  }
  return { alive, hits }
}

export interface LiqBucket {
  side: 'long' | 'short'
  /** The bucket's dollar-weighted price. */
  price: number
  usd: number
  /** The earliest bar among its levels. */
  from: number
}

/** Levels gathered into price buckets `stepPct` wide (of `ref`), per side. */
export function liqBuckets(levels: LiqLevel[], ref: number, stepPct = 1.5): LiqBucket[] {
  if (!(ref > 0)) return []
  const step = (ref * stepPct) / 100
  const by = new Map<string, LiqBucket & { wsum: number }>()
  for (const lv of levels) {
    if (!(lv.usd > 0)) continue
    const key = `${lv.side}:${Math.floor(lv.price / step)}`
    const cur = by.get(key)
    if (cur) {
      cur.wsum += lv.price * lv.usd
      cur.usd += lv.usd
      cur.from = Math.min(cur.from, lv.from)
    } else by.set(key, { side: lv.side, price: lv.price, usd: lv.usd, from: lv.from, wsum: lv.price * lv.usd })
  }
  return [...by.values()].map(({ wsum, ...b }) => ({ ...b, price: wsum / b.usd })).sort((a, b) => a.price - b.price)
}

/** Dollars of liquidations within `pct` percent of `price`: shorts above it, longs below it. */
export function fuelWithin(levels: { side: 'long' | 'short'; price: number; usd: number }[], price: number, pct: number): { above: number; below: number } {
  let above = 0
  let below = 0
  for (const lv of levels) {
    if (lv.side === 'short' && lv.price > price && lv.price <= price * (1 + pct / 100)) above += lv.usd
    if (lv.side === 'long' && lv.price < price && lv.price >= price * (1 - pct / 100)) below += lv.usd
  }
  return { above, below }
}

// ── The read ──────────────────────────────────────────────────────────────

export function fmtUsdShort(n: number): string {
  const a = Math.abs(n)
  if (a >= 1e9) return `$${(a / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `$${(a / 1e6).toFixed(1)}M`
  if (a >= 1e3) return `$${(a / 1e3).toFixed(0)}K`
  return `$${a.toFixed(0)}`
}

export interface CrowdInput {
  /** Share of accounts long, 0..1. */
  longShare: number | null
  /** Funding per 8 hours as a fraction. */
  funding8h: number | null
  /** Open interest and price, each as a percent change over the same stretch. */
  oiChangePct: number | null
  priceChangePct: number | null
  /** Estimated liquidation dollars within 10% of the price. */
  fuelAbove: number
  fuelBelow: number
}

export interface CrowdRead {
  /** Which way the positioning leans to break, when it leans at all. */
  lean: 'up' | 'down' | 'even'
  headline: string
  /** What open interest did while price moved: the textbook four cases. */
  flow: string | null
}

/** A side is crowded past this share of accounts. */
export const CROWDED = 0.6
/** One side's fuel outweighs the other's past this ratio. */
const FUEL_EDGE = 1.5

/** Positioning in one headline. Rules, not a model, and every one a standard
 *  reading: a crowded side that also pays funding is the exposed side; the
 *  side with more liquidation fuel stacked near the price is the side a move
 *  would feed on. It describes pressure. It does not forecast. */
export function crowdRead(x: CrowdInput): CrowdRead {
  const flow =
    x.oiChangePct === null || x.priceChangePct === null || (Math.abs(x.oiChangePct) < 1 && Math.abs(x.priceChangePct) < 1)
      ? null
      : x.priceChangePct >= 0
        ? x.oiChangePct >= 0
          ? 'Price up, open interest up: new money is backing the advance'
          : 'Price up, open interest down: shorts are closing, not new longs arriving'
        : x.oiChangePct >= 0
          ? 'Price down, open interest up: new shorts are pressing'
          : 'Price down, open interest down: longs are leaving the field'
  const longCrowd = x.longShare !== null && x.longShare >= CROWDED
  const shortCrowd = x.longShare !== null && x.longShare <= 1 - CROWDED
  const longsPay = x.funding8h !== null && x.funding8h > 0
  const shortsPay = x.funding8h !== null && x.funding8h < 0
  const moreBelow = x.fuelBelow > x.fuelAbove * FUEL_EDGE && x.fuelBelow > 0
  const moreAbove = x.fuelAbove > x.fuelBelow * FUEL_EDGE && x.fuelAbove > 0
  if (longCrowd && moreBelow) return { lean: 'down', headline: 'Longs are crowded, with the most fuel under them', flow }
  if (shortCrowd && moreAbove) return { lean: 'up', headline: 'Shorts are crowded, with the most fuel over them', flow }
  if (longCrowd && longsPay) return { lean: 'down', headline: 'Longs are crowded and paying to stay', flow }
  if (shortCrowd && shortsPay) return { lean: 'up', headline: 'Shorts are crowded and paying to stay', flow }
  if (moreAbove) return { lean: 'up', headline: 'More short fuel overhead than long fuel below', flow }
  if (moreBelow) return { lean: 'down', headline: 'More long fuel below than short fuel overhead', flow }
  if (longCrowd) return { lean: 'even', headline: 'The crowd is long', flow }
  if (shortCrowd) return { lean: 'even', headline: 'The crowd is short', flow }
  return { lean: 'even', headline: 'Evenly matched', flow }
}

/** "+0.0100% / 8h · longs pay" */
export function fundingLine(funding8h: number): string {
  const pct = `${funding8h >= 0 ? '+' : '−'}${Math.abs(funding8h * 100).toFixed(4)}% / 8h`
  return `${pct} · ${funding8h > 0 ? 'longs pay shorts' : funding8h < 0 ? 'shorts pay longs' : 'flat'}`
}

// ── A player: one position on the board ───────────────────────────────────

export interface Player {
  side: 'long' | 'short'
  entry: number
  leverage: number
  /** Position size in dollars (notional), the way the order sentence sizes it. */
  usd: number
}

export const PLAYER_LEVERAGES = [2, 3, 5, 10, 20]
export const PLAYER_SIZES = [10, 25, 100]

/** Where the position liquidates if its margin were the whole account
 *  (Hyperliquid's isolated formula: maintenance is half the initial margin at
 *  the coin's max leverage). A cross account with other funds liquidates
 *  later, so the board calls this an estimate. */
export function playerLiqPrice(p: Player, maxLeverage: number): number {
  const dir = p.side === 'long' ? 1 : -1
  const l = 1 / (2 * Math.max(1, maxLeverage))
  return Math.max(0, (p.entry * (1 - dir / Math.max(1, p.leverage))) / (1 - l * dir))
}

export interface PlayerState {
  liq: number
  pnlUsd: number
  /** Return on the margin posted, percent. */
  roePct: number
  marginUsd: number
  /** Percent the price must move against the position to reach `liq`. */
  toLiqPct: number
  liquidated: boolean
}

export function playerState(p: Player, mark: number, maxLeverage: number): PlayerState {
  const dir = p.side === 'long' ? 1 : -1
  const liq = playerLiqPrice(p, maxLeverage)
  const marginUsd = p.usd / Math.max(1, p.leverage)
  const pnlUsd = p.entry > 0 ? p.usd * (mark / p.entry - 1) * dir : 0
  const liquidated = p.side === 'long' ? mark <= liq : mark >= liq
  return { liq, pnlUsd, roePct: marginUsd > 0 ? (pnlUsd / marginUsd) * 100 : 0, marginUsd, toLiqPct: mark > 0 ? (Math.abs(mark - liq) / mark) * 100 : 0, liquidated }
}

/** Dollars of the player's OWN side that liquidate between the price and the
 *  player's line: the others who break first. */
export function fuelBeforePlayer(levels: { side: 'long' | 'short'; price: number; usd: number }[], p: Player, mark: number, liq: number): number {
  let usd = 0
  for (const lv of levels) {
    if (lv.side !== p.side) continue
    if (p.side === 'long' ? lv.price < mark && lv.price > liq : lv.price > mark && lv.price < liq) usd += lv.usd
  }
  return usd
}

/** A stored player, re-validated: anything off-shape is no player. */
export function parsePlayer(x: unknown): Player | null {
  if (typeof x !== 'object' || x === null) return null
  const p = x as Record<string, unknown>
  if (p.side !== 'long' && p.side !== 'short') return null
  const num = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi
  if (!num(p.entry, 1e-9, 1e9) || !num(p.leverage, 1, 50) || !num(p.usd, 1, 1e6)) return null
  return { side: p.side, entry: p.entry as number, leverage: p.leverage as number, usd: p.usd as number }
}

// ── The front: units in formation and the resting book ────────────────────

/** Dollar sizes a unit can stand for. The board picks the smallest one that
 *  keeps the biggest cluster under `maxUnits` tanks. */
export const UNIT_STEPS = [1e4, 2.5e4, 5e4, 1e5, 2.5e5, 5e5, 1e6, 2.5e6, 5e6, 1e7, 2.5e7, 5e7, 1e8, 2.5e8]

export function unitUsd(maxUsd: number, maxUnits = 14): number {
  return UNIT_STEPS.find((s) => maxUsd / s <= maxUnits) ?? UNIT_STEPS[UNIT_STEPS.length - 1]
}

/** Tanks for a cluster: none under half a unit, at least one from there. */
export function unitsFor(usd: number, unit: number): number {
  return usd < unit / 2 ? 0 : Math.max(1, Math.round(usd / unit))
}

export interface BookLevel {
  px: number
  usd: number
}
export interface BookBody {
  symbol: string
  /** Resting orders, best first, in dollars at each price. */
  bids: BookLevel[]
  asks: BookLevel[]
  mid: number | null
  /** Unix ms the book was read. */
  at: number
  missing?: string
}

/** Dollars resting within `pct` of the mid on each side: the ramparts at the front. */
export function bookWalls(book: Pick<BookBody, 'bids' | 'asks' | 'mid'>, pct = 2): { bidUsd: number; askUsd: number } {
  const mid = book.mid
  if (!mid || !(mid > 0)) return { bidUsd: 0, askUsd: 0 }
  let bidUsd = 0
  let askUsd = 0
  for (const l of book.bids) if (l.px >= mid * (1 - pct / 100)) bidUsd += l.usd
  for (const l of book.asks) if (l.px <= mid * (1 + pct / 100)) askUsd += l.usd
  return { bidUsd, askUsd }
}

// ── Spot: the resting book as rows ────────────────────────────────────────

export interface BookRow {
  side: 'long' | 'short'
  /** The rung's dollar-weighted price. */
  price: number
  usd: number
  /** The rung's bounds. */
  lo: number
  hi: number
}

/** Resting orders gathered into price rungs `stepPct` wide (of the mid)
 *  within `rangePct` of it: bids under the mid as the buyers' rows, asks
 *  over it as the sellers'. MEASURED, not modelled. */
export function bookRows(book: Pick<BookBody, 'bids' | 'asks' | 'mid'>, rangePct: number, stepPct: number): BookRow[] {
  const mid = book.mid
  if (!mid || !(mid > 0)) return []
  const step = (mid * stepPct) / 100
  const by = new Map<string, BookRow & { wsum: number }>()
  const add = (side: 'long' | 'short', l: BookLevel) => {
    if (Math.abs(l.px / mid - 1) > rangePct / 100 || !(l.usd > 0)) return
    const k = Math.floor(l.px / step)
    const key = `${side}:${k}`
    const cur = by.get(key)
    if (cur) {
      cur.usd += l.usd
      cur.wsum += l.px * l.usd
    } else by.set(key, { side, price: l.px, usd: l.usd, lo: k * step, hi: (k + 1) * step, wsum: l.px * l.usd })
  }
  for (const l of book.bids) if (l.px < mid) add('long', l)
  for (const l of book.asks) if (l.px > mid) add('short', l)
  return [...by.values()].map(({ wsum, ...r }) => ({ ...r, price: wsum / r.usd })).sort((a, b) => a.price - b.price)
}

export interface SpotRead {
  lean: 'up' | 'down' | 'even'
  headline: string
  /** Share of resting dollars within the fence that are bids, 0..1. */
  bidShare: number
  spreadPct: number | null
}

/** The spot book in one line: which side has the deeper book near the price. */
export function spotRead(book: Pick<BookBody, 'bids' | 'asks' | 'mid'>, pct = 5): SpotRead {
  const { bidUsd, askUsd } = bookWalls(book, pct)
  const all = bidUsd + askUsd
  const bidShare = all > 0 ? bidUsd / all : 0.5
  const spreadPct = book.mid && book.bids[0] && book.asks[0] ? ((book.asks[0].px - book.bids[0].px) / book.mid) * 100 : null
  if (all <= 0) return { lean: 'even', headline: 'No resting orders read', bidShare, spreadPct }
  if (bidShare >= 0.6) return { lean: 'up', headline: 'Buyers hold the deeper book', bidShare, spreadPct }
  if (bidShare <= 0.4) return { lean: 'down', headline: 'Sellers hold the deeper book', bidShare, spreadPct }
  return { lean: 'even', headline: 'The book is evenly matched', bidShare, spreadPct }
}

// ── The heatmap: positioning by day, the contribution-graph way ───────────

export interface HeatCell {
  /** Unix seconds at the UTC day's start. */
  day: number
  /** Share of accounts long that day, null when no reading landed. */
  long: number | null
  /** Open interest that day (the unit the source uses), null when unread. */
  oi: number | null
  /** The day's close over its open, percent; null without a daily bar. */
  pricePct: number | null
}

export const DAY_SEC = 86_400
export const HEAT_WEEKS = 53

/** One cell per UTC day for the last HEAT_WEEKS weeks ending on the week of
 *  `now`, the newest reading of each day winning. Columns are weeks
 *  (Sunday first, the GitHub layout), so the first cell is the Sunday
 *  HEAT_WEEKS − 1 weeks before this week's Sunday. */
export function heatCells(ratio: RatioPoint[], oi: OiPoint[], bars: Candle[], now: number, weeks = HEAT_WEEKS): HeatCell[] {
  const today = Math.floor(now / DAY_SEC) * DAY_SEC
  const sunday = today - new Date(today * 1000).getUTCDay() * DAY_SEC
  const start = sunday - (weeks - 1) * 7 * DAY_SEC
  const end = sunday + 6 * DAY_SEC
  const byDay = new Map<number, HeatCell>()
  for (let d = start; d <= end; d += DAY_SEC) byDay.set(d, { day: d, long: null, oi: null, pricePct: null })
  const dayOf = (t: number) => Math.floor(t / DAY_SEC) * DAY_SEC
  for (const r of ratio) {
    const c = byDay.get(dayOf(r.t))
    if (c) c.long = r.long
  }
  for (const p of oi) {
    const c = byDay.get(dayOf(p.t))
    if (c) c.oi = p.oi
  }
  for (const b of bars) {
    const c = byDay.get(dayOf(b.t))
    if (c && b.o > 0) c.pricePct = (b.c / b.o - 1) * 100
  }
  return [...byDay.values()]
}

/** The year's typical day: the median long share of the days read. A coin's
 *  crowd is structurally one-sided (UNI's accounts run ~65% long every day),
 *  so the cells ink the day AGAINST its own year, not against 50/50. */
export function heatMedian(cells: { long: number | null }[]): number | null {
  const xs = cells.map((c) => c.long).filter((x): x is number => x !== null).sort((a, b) => a - b)
  if (!xs.length) return null
  const mid = xs.length >> 1
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2
}

/** How far a day sits from the typical day before it counts as one side's. */
export const HEAT_EDGE = 0.04

/** The day's ink, −1 (far more short than usual) … +1 (far more long than
 *  usual): the share's distance from `center`, full strength at 8 points. */
export function heatTone(long: number | null, center = 0.5): number | null {
  if (long === null) return null
  return Math.max(-1, Math.min(1, (long - center) / 0.08))
}

export interface HeatSummary {
  /** Days with a reading. */
  read: number
  /** The typical day's long share. */
  median: number | null
  /** Days each side ran past the typical day by HEAT_EDGE. */
  longDays: number
  shortDays: number
  /** The run ending today: how many days in a row the same side has run above usual, and which. */
  streak: { side: 'long' | 'short'; days: number } | null
  headline: string
}

export function heatSummary(cells: HeatCell[]): HeatSummary {
  const median = heatMedian(cells)
  const center = median ?? 0.5
  let read = 0
  let longDays = 0
  let shortDays = 0
  for (const c of cells) {
    if (c.long === null) continue
    read++
    if (c.long >= center + HEAT_EDGE) longDays++
    else if (c.long <= center - HEAT_EDGE) shortDays++
  }
  let runSide: 'long' | 'short' | null = null
  let runDays = 0
  for (let i = cells.length - 1; i >= 0; i--) {
    const c = cells[i]
    if (c.long === null) {
      if (runDays) break
      continue
    }
    const side: 'long' | 'short' | null = c.long >= center + HEAT_EDGE ? 'long' : c.long <= center - HEAT_EDGE ? 'short' : null
    if (!side || (runSide && runSide !== side)) break
    runSide = side
    runDays++
  }
  const streak: HeatSummary['streak'] = runSide ? { side: runSide, days: runDays } : null
  const headline =
    read === 0
      ? 'No daily positioning read yet'
      : streak && streak.days >= 3
        ? `More ${streak.side} than usual ${streak.days} days running`
        : longDays > shortDays * 2 && longDays > 0
          ? `More long than usual on ${longDays} of ${read} days`
          : shortDays > longDays * 2 && shortDays > 0
            ? `More short than usual on ${shortDays} of ${read} days`
            : `A year near its usual: ${longDays} days longer, ${shortDays} shorter`
  return { read, median, longDays, shortDays, streak, headline }
}

// ── The Rivers: positioning as two flows under the candles ────────────────

export interface RiverDay {
  day: number
  /** 0..1 across the strip's history zone. */
  x: number
  /** Share of accounts long (carried from the last read day when a day is unread). */
  long: number
  /** Open interest in dollars, null when unread. */
  oiUsd: number | null
  /** Open interest as a share of the window's biggest day, 0..1 (0.35 floor so a thin river still shows). */
  flow: number
  /** The day's liquidation cascades, dollars per side (ESTIMATED), from the daily map. */
  wipedLong: number
  wipedShort: number
}

export interface RiverSeries {
  days: RiverDay[]
  median: number
  oiMax: number
}

/** The last `window` days as river samples: each day's long share, its open
 *  interest in dollars (coins × that day's close), and what the day's range
 *  set off on each side (the daily liquidation map's hits). */
export function riverSeries(cells: HeatCell[], bars: Candle[], oiUnit: 'coin' | 'usd', window = 180): RiverSeries {
  const median = heatMedian(cells) ?? 0.5
  const closeByDay = new Map<number, number>()
  for (const b of bars) closeByDay.set(Math.floor(b.t / DAY_SEC) * DAY_SEC, b.c)
  // The daily map over the daily bars: hits are the days' cascades.
  const oiPts: OiPoint[] = cells.filter((c) => c.oi !== null).map((c) => ({ t: c.day, oi: c.oi as number }))
  const daily = [...bars].filter((b) => b.t >= (cells[0]?.day ?? 0)).sort((a, b) => a.t - b.t)
  const map = oiPts.length > 1 && daily.length > 1 ? liquidationMap(daily, oiPts, oiUnit) : { alive: [], hits: [] }
  const wiped = new Map<number, { long: number; short: number }>()
  for (const h of map.hits) {
    const d = Math.floor(daily[h.at].t / DAY_SEC) * DAY_SEC
    const w = wiped.get(d) ?? { long: 0, short: 0 }
    w[h.side] += h.usd
    wiped.set(d, w)
  }
  const today = Math.floor(Date.now() / 1000 / DAY_SEC) * DAY_SEC
  const recent = cells.filter((c) => c.day <= today).slice(-window)
  let lastLong = median
  let oiMax = 0
  const rows = recent.map((c) => {
    if (c.long !== null) lastLong = c.long
    const close = closeByDay.get(c.day)
    const oiUsd = c.oi === null ? null : oiUnit === 'coin' ? (close ? c.oi * close : null) : c.oi
    if (oiUsd !== null && oiUsd > oiMax) oiMax = oiUsd
    const w = wiped.get(c.day)
    return { day: c.day, long: lastLong, oiUsd, wipedLong: w?.long ?? 0, wipedShort: w?.short ?? 0 }
  })
  const n = Math.max(1, rows.length - 1)
  return {
    median,
    oiMax,
    days: rows.map((r, i) => ({ ...r, x: i / n, flow: oiMax > 0 && r.oiUsd !== null ? 0.35 + 0.65 * (r.oiUsd / oiMax) : 0.35 })),
  }
}

/** Where each river runs on a day, in strip units (0 = top, 1 = bottom):
 *  the long river rides ABOVE the centre when the crowd is longer than its
 *  usual, the short river below, and they cross on the days it flips. Each
 *  river's width is its side's share of the day's open interest. */
export function riverLanes(d: RiverDay, median: number, maxWidth = 0.42): { long: { y: number; w: number }; short: { y: number; w: number } } {
  const tone = Math.max(-1, Math.min(1, (d.long - median) / 0.08))
  const wLong = maxWidth * d.flow * d.long
  const wShort = maxWidth * d.flow * (1 - d.long)
  // 0.18 of the strip between the two centres at full tone; the rivers meet (and swap) at tone 0.
  const spread = 0.18 * tone
  return { long: { y: 0.5 - spread, w: wLong }, short: { y: 0.5 + spread, w: wShort } }
}

// ── Strata: the liquidation clusters drawn on the candle chart's right margin ──

export interface Stratum {
  side: 'long' | 'short'
  price: number
  usd: number
  /** 0..1 of the biggest stratum. */
  weight: number
}

/** The clusters within `pct` of the price as strata, biggest first, at most `max`. */
export function strataFor(buckets: { side: 'long' | 'short'; price: number; usd: number }[], mark: number, pct = 25, max = 12): Stratum[] {
  if (!(mark > 0)) return []
  const near = buckets.filter((b) => Math.abs(b.price / mark - 1) <= pct / 100 && (b.side === 'short' ? b.price > mark : b.price < mark))
  const top = near.reduce((m, b) => Math.max(m, b.usd), 0)
  return near
    .sort((a, b) => b.usd - a.usd)
    .slice(0, max)
    .map((b) => ({ side: b.side, price: b.price, usd: b.usd, weight: top > 0 ? b.usd / top : 0 }))
}
