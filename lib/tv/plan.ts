// WHAT YOU DREW, AS THINGS YOU CAN DO. Pure, pinned (scripts/tv-pins).
//
// On the Advanced chart the drawing tools are the library's. What Pantessa
// adds is the reading: every drawing that names a price is turned into the
// sentences that act on it, through the same composer the built-in chart
// used (lib/chart-actions — every sentence it writes is one a native parser
// builds, pinned in the harness).
//
//   a level        (horizontal line or ray)     → buy / sell / stop there
//   a zone         (rectangle, price range)     → buy at the floor, sell at
//                                                  the ceiling, stop under it
//   a retracement  (fib)                        → one row per level, each
//                                                  with the order that rests
//                                                  at it
//   a position box (the Long / Short Position
//                   tool: entry, stop, target)  → the trade it draws: on a
//                                                  perp, one job that opens
//                                                  and arms the stop; on spot,
//                                                  the entry, the stop and
//                                                  the target as three orders
//
// The honesty rules live in lib/chart-actions and are not repeated here: a
// limit buy only under the market, a stop only where it would not fire on
// arm, nothing on an index. This file only chooses WHICH offers each row of
// a drawing carries.

import { composeLineActions, composeZoneActions, fmtAskPrice, type LineActionOffer } from '@/lib/chart-actions'
import { FIB_RATIOS, fibLevels } from '@/lib/chart-draw'
import type { ChartSource } from '@/lib/charts'
import { tokenHome } from '@/lib/token-home'
import type { ShapeSnapshot } from './shapes'

export type PlanKind = 'level' | 'zone' | 'fib' | 'long' | 'short'

export interface PlanRow {
  /** What the row is: "Entry", "Stop", "0.618", "Floor". */
  name: string
  price: number
  offers: LineActionOffer[]
}

export interface PlanItem {
  /** The chart entity it reads (click a row → the drawing is selected). */
  shapeId: string
  kind: PlanKind
  /** "Level", "Zone", "Fib retracement", "Long plan", "Short plan". */
  title: string
  /** The drawing's own label, when it has one. */
  label?: string
  rows: PlanRow[]
  /** One line under the title: reward-to-risk for a position box. */
  note?: string
  /** The whole drawing as ONE sentence, when one sentence can do it. */
  whole?: LineActionOffer
}

export interface PlanContext {
  symbol: string
  source: ChartSource
  last: number
  usd?: number
  /** 10^decimals of the chart's price scale: a position box stores its stop
   *  and target as a count of ticks from the entry. */
  pricescale: number
}

const H_TOOLS = new Set(['horizontal_line', 'horizontal_ray'])
const ZONE_TOOLS = new Set(['rectangle', 'price_range', 'date_and_price_range'])

const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null)
const text = (x: unknown): string | undefined => (typeof x === 'string' && x.trim() ? x.trim().slice(0, 80) : undefined)

/** Offers that only make sense AT the level (not the "now" market chips). */
const atLevel = (offers: LineActionOffer[]) => offers.filter((o) => o.action.kind === 'limit' || o.action.kind === 'stop' || o.action.kind === 'protect')

/** A position box's three prices. The library keeps the entry as the first
 *  point and the stop / target as tick counts from it. */
export function positionLevels(s: ShapeSnapshot, pricescale: number): { entry: number; stop: number; target: number } | null {
  const entry = num(s.points[0]?.price)
  const stopTicks = num(s.props.stopLevel)
  const profitTicks = num(s.props.profitLevel)
  if (entry === null || entry <= 0 || stopTicks === null || profitTicks === null || !(pricescale > 0)) return null
  const tick = 1 / pricescale
  const long = s.name === 'long_position'
  const stop = long ? entry - stopTicks * tick : entry + stopTicks * tick
  const target = long ? entry + profitTicks * tick : entry - profitTicks * tick
  if (!(stop > 0) || !(target > 0) || stop === entry) return null
  return { entry, stop, target }
}

/** A stop's distance as the percent the job grammar reads: one decimal,
 *  between 0.1 and 90. */
export function stopPercent(entry: number, stop: number): string | null {
  if (!(entry > 0) || !(stop > 0)) return null
  const pct = (Math.abs(entry - stop) / entry) * 100
  if (!(pct >= 0.1) || pct > 90) return null
  const s = pct.toFixed(1)
  return s.endsWith('.0') ? s.slice(0, -2) : s
}

const usdLabel = (usd: number) => (Number.isInteger(usd) ? `$${usd}` : `$${usd.toFixed(2)}`)

/** Does this market open as a Hyperliquid perp from a level? (lib/chart-actions' own split.) */
const perpMarket = (symbol: string, source: ChartSource) => source === 'hyperliquid' || (source === 'coinbase' && !!tokenHome(symbol))

function positionItem(s: ShapeSnapshot, ctx: PlanContext): PlanItem | null {
  const lv = positionLevels(s, ctx.pricescale)
  if (!lv) return null
  const long = s.name === 'long_position'
  const sym = ctx.symbol.toUpperCase()
  const usd = ctx.usd ?? 25
  const base = { symbol: ctx.symbol, source: ctx.source, last: ctx.last, usd }
  const rr = Math.abs(lv.target - lv.entry) / Math.abs(lv.entry - lv.stop)
  const note = `Reward to risk ${rr >= 10 ? rr.toFixed(0) : rr.toFixed(1)} : 1 · stop ${stopPercent(lv.entry, lv.stop) ?? '?'}% from entry`
  const item: PlanItem = { shapeId: s.id, kind: long ? 'long' : 'short', title: long ? 'Long plan' : 'Short plan', rows: [], note }

  if (perpMarket(ctx.symbol, ctx.source)) {
    // A perp fills at market now (IOC): the box's entry is where you MEANT
    // to get in, the order opens at today's price and the stop is armed as
    // the box's own distance from it.
    const open = composeLineActions({ ...base, price: lv.entry }).find((o) => o.action.kind === (long ? 'buy' : 'sell'))
    const pct = stopPercent(lv.entry, lv.stop)
    if (open && pct) {
      item.whole = {
        action: { kind: long ? 'buy' : 'sell', ask: `${open.action.ask}, then protect my ${sym} ${long ? 'long' : 'short'} with a ${pct}% stop` },
        label: `${long ? 'Long' : 'Short'} ${usdLabel(usd)} with a ${pct}% stop`,
        hint: `One job: opens the ${long ? 'long' : 'short'} at market now, then arms the Guardian stop ${pct}% away. You sign each step.`,
      }
    }
    item.rows.push({ name: 'Entry', price: lv.entry, offers: open ? [open] : [] })
    // The Guardian's one-tap levels are written for a long (lib/chart-actions).
    item.rows.push({ name: 'Stop', price: lv.stop, offers: long ? composeLineActions({ ...base, price: lv.stop }).filter((o) => o.action.kind === 'stop') : [] })
    item.rows.push({ name: 'Target', price: lv.target, offers: long ? composeLineActions({ ...base, price: lv.target }).filter((o) => o.action.kind === 'protect') : [] })
    return item
  }

  if (!long) {
    // Spot cannot be shorted: the box is a plan to SELL what you hold at the
    // entry and buy it back at the target.
    const sells = composeLineActions({ ...base, price: lv.entry })
    const sell = sells.find((o) => o.action.kind === 'limit' && /^limit order: sell /.test(o.action.ask)) ?? sells.find((o) => o.action.kind === 'sell')
    item.rows.push({ name: 'Sell at', price: lv.entry, offers: sell ? [sell] : [] })
    item.rows.push({ name: 'Buy back at', price: lv.target, offers: composeLineActions({ ...base, price: lv.target }).filter((o) => o.action.kind === 'limit' && /^limit order: buy /.test(o.action.ask)) })
    item.note = `${note} · spot has no short: this reads as sell, then buy back`
    return item
  }

  const entryOffers = composeLineActions({ ...base, price: lv.entry })
  // An entry is a BUY: resting under the market when the box sits there, at
  // market when the entry is at or over today's price (nothing here rests a
  // buy above the market, and the chip says "now").
  const entry = entryOffers.find((o) => o.action.kind === 'limit' && /^limit order: buy /.test(o.action.ask)) ?? entryOffers.find((o) => o.action.kind === 'buy')
  item.rows.push({ name: 'Entry', price: lv.entry, offers: entry ? [entry] : [] })
  item.rows.push({ name: 'Stop', price: lv.stop, offers: composeLineActions({ ...base, price: lv.stop }).filter((o) => o.action.kind === 'stop') })
  item.rows.push({ name: 'Target', price: lv.target, offers: composeLineActions({ ...base, price: lv.target }).filter((o) => o.action.kind === 'limit' && /^limit order: sell /.test(o.action.ask)) })
  return item
}

/** One drawing → what it can do, or null when it names no price to act on. */
export function planItemFor(s: ShapeSnapshot, ctx: PlanContext): PlanItem | null {
  if (!(ctx.last > 0)) return null
  const base = { symbol: ctx.symbol, source: ctx.source, last: ctx.last, usd: ctx.usd }
  const label = s.props.showLabel === false ? undefined : text(s.props.text)
  if (H_TOOLS.has(s.name)) {
    const price = num(s.points[0]?.price)
    if (price === null || price <= 0) return null
    return { shapeId: s.id, kind: 'level', title: 'Level', label, rows: [{ name: price < ctx.last ? 'Under the market' : price > ctx.last ? 'Over the market' : 'At the market', price, offers: composeLineActions({ ...base, price }) }] }
  }
  if (ZONE_TOOLS.has(s.name)) {
    const p1 = num(s.points[0]?.price)
    const p2 = num(s.points[1]?.price)
    if (p1 === null || p2 === null || p1 <= 0 || p2 <= 0 || p1 === p2) return null
    const lo = Math.min(p1, p2)
    const hi = Math.max(p1, p2)
    const offers = composeZoneActions({ ...base, p1, p2 })
    const floor = offers.filter((o) => /floor|under the zone/i.test(o.label))
    const ceiling = offers.filter((o) => /ceiling/i.test(o.label))
    return {
      shapeId: s.id,
      kind: 'zone',
      title: 'Zone',
      label,
      rows: [
        { name: 'Ceiling', price: hi, offers: ceiling },
        { name: 'Floor', price: lo, offers: floor },
      ],
      ...(lo < ctx.last && hi > ctx.last ? { note: 'The price is inside this zone: it carries an order once the market is above or below it.' } : {}),
    }
  }
  if (s.name === 'fib_retracement') {
    const p1 = num(s.points[0]?.price)
    const p2 = num(s.points[1]?.price)
    if (p1 === null || p2 === null || p1 <= 0 || p2 <= 0 || p1 === p2) return null
    // The retracement levels a trader rests orders at; the swing's two ends
    // and the extensions are on the chart, not in the list.
    const ratios = FIB_RATIOS.filter((r) => r > 0 && r < 1)
    const rows = fibLevels(p1, p2, ratios).map((lv) => ({ name: lv.label, price: lv.price, offers: atLevel(composeLineActions({ ...base, price: lv.price })).slice(0, 1) }))
    return { shapeId: s.id, kind: 'fib', title: 'Fib retracement', rows, note: `Swing ${fmtAskPrice(p1)} to ${fmtAskPrice(p2)}` }
  }
  if (s.name === 'long_position' || s.name === 'short_position') return positionItem(s, ctx)
  return null
}

/** Every actionable drawing on the chart, newest first, capped. */
export function planFor(shapes: readonly ShapeSnapshot[], ctx: PlanContext, cap = 12): PlanItem[] {
  const out: PlanItem[] = []
  for (let i = shapes.length - 1; i >= 0 && out.length < cap; i--) {
    const item = planItemFor(shapes[i], ctx)
    if (item) out.push(item)
  }
  return out
}

/** Every sentence a plan offers (the gates and the pins read this). */
export function planAsks(items: readonly PlanItem[]): string[] {
  return items.flatMap((it) => [...(it.whole ? [it.whole.action.ask] : []), ...it.rows.flatMap((r) => r.offers.map((o) => o.action.ask))])
}
