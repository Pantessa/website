// Our candles → the library's bars, and the paging rules between them.
// Pure, pinned (scripts/tv-pins).
//
// The rules the library holds a datafeed to (its datafeed guide, v33):
//  · a bar's time is MILLISECONDS; ours are seconds
//  · bars ascend strictly, no two share a time
//  · a daily bar is stamped 00:00 UTC of its trading day (a stock's tape
//    stamps it at the open, 13:30 or 14:30 UTC)
//  · `to` is exclusive: never hand back a bar at or after it
//  · the end of history is said out loud (`noData`), never inferred from a
//    short page

import type { Candle, ChartTf } from '@/lib/charts'
import { TF_SECONDS } from './resolution'
import type { TvBar } from './types'

/** The open time (seconds) of the slot a candle belongs to: frames are cut
 *  on UTC boundaries (the symbol is described as round-the-clock in UTC,
 *  lib/tv/symbol), so a daily bar snaps to its UTC midnight (a stock's tape
 *  stamps it at the open, 13:30 or 14:30 UTC) and an index's hour bar that
 *  starts at twenty past (its exchange opens at 08:20 New York) snaps to the
 *  hour. The library moves a misaligned bar itself on candles and gets it
 *  wrong on Heikin Ashi and Renko; we hand it aligned bars instead. */
export function slotOf(tSec: number, tf: ChartTf): number {
  const span = TF_SECONDS[tf]
  return Math.floor(tSec / span) * span
}

/** One candle as a bar of its frame, on its slot. */
export function toTvBar(c: Candle, tf: ChartTf): TvBar {
  return { time: slotOf(c.t, tf) * 1000, open: c.o, high: c.h, low: c.l, close: c.c, volume: c.v }
}

const sane = (c: Candle) => Number.isFinite(c.t) && [c.o, c.h, c.l, c.c].every((n) => Number.isFinite(n) && n > 0)

/**
 * Candles from one or more reads → bars the library accepts: ascending,
 * unique by time, nothing malformed. Always fresh objects (the library edits
 * what it is handed).
 *
 * Two different things can share a slot, and they are treated differently:
 *  · the SAME candle read twice (a warm-up and a window overlap): the later
 *    read replaces the earlier one, nothing is counted twice
 *  · two DIFFERENT candles that snap to one slot (an index's half-hour stub
 *    beside its hour bar): folded into one bar, first open, last close, the
 *    widest high and low, the volumes added
 */
export function toTvBars(candles: readonly Candle[], tf: ChartTf): TvBar[] {
  const byStamp = new Map<number, Candle>()
  for (const c of candles) if (sane(c)) byStamp.set(c.t, c)
  const sorted = [...byStamp.values()].sort((a, b) => a.t - b.t)
  const out: TvBar[] = []
  for (const c of sorted) {
    const bar = toTvBar(c, tf)
    const prev = out[out.length - 1]
    if (prev && prev.time === bar.time) {
      prev.high = Math.max(prev.high, bar.high)
      prev.low = Math.min(prev.low, bar.low)
      prev.close = bar.close
      prev.volume = (prev.volume ?? 0) + (bar.volume ?? 0)
    } else out.push(bar)
  }
  return out
}

/** The bars that open before `toSec` (exclusive), as fresh copies. */
export function barsBefore(bars: readonly TvBar[], toSec: number): TvBar[] {
  const toMs = toSec * 1000
  return bars.filter((b) => b.time < toMs).map((b) => ({ ...b }))
}

/** The `before=` to ask our endpoint for the page older than `oldestMs`. The
 *  endpoint answers bars that opened strictly before it. */
export function olderPageCursor(oldestMs: number): number {
  return Math.floor(oldestMs / 1000)
}

/**
 * What a realtime poll may push: the bars of a fresh window at or after the
 * last bar the chart holds, oldest first. The library refuses a bar older
 * than its last ("time violation"), so anything behind `lastMs` is dropped;
 * the bar AT `lastMs` is the forming bar and replaces itself.
 */
export function ticksSince(window: readonly TvBar[], lastMs: number | null): TvBar[] {
  if (lastMs === null) return window.length ? [{ ...window[window.length - 1] }] : []
  return window.filter((b) => b.time >= lastMs).map((b) => ({ ...b }))
}

/** The open time (ms) of the bar a moment belongs to, on a served frame. */
export function barOpenMs(atMs: number, tf: ChartTf): number {
  const span = TF_SECONDS[tf] * 1000
  return Math.floor(atMs / span) * span
}

/**
 * A print folded into the forming bar. `tail` is the last bar the chart
 * holds (or null). A print behind the tail's bar is ignored (the venue's own
 * bar already counted it); one inside it stretches it; one past it opens the
 * next bar at the print's price.
 */
export function foldPrint(tail: TvBar | null, print: { at: number; price: number; size: number }, tf: ChartTf): TvBar | null {
  if (!(print.price > 0) || !Number.isFinite(print.at)) return null
  const open = barOpenMs(print.at, tf)
  if (tail && open < tail.time) return null
  if (tail && open === tail.time) {
    return { time: tail.time, open: tail.open, high: Math.max(tail.high, print.price), low: Math.min(tail.low, print.price), close: print.price, volume: (tail.volume ?? 0) + (Number.isFinite(print.size) ? print.size : 0) }
  }
  return { time: open, open: print.price, high: print.price, low: print.price, close: print.price, volume: Number.isFinite(print.size) ? print.size : 0 }
}
