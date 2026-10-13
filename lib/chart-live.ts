// THE CHART'S LIVE TAIL (2026-10-13). Nate: "now that you know the Dune data,
// would it make sense to use it for our asset chart page? … zooms in on UNI
// at 1 sec, show the price and candle growing and shrinking in realtime …
// or static ones for larger views — you decide."
//
// The call: history stays the venue's polled candles on every frame (the
// cheap, static part); the LAST bar goes live from Dune's prints on the
// zoomed-in frames (1m · 15m · 1H) — its high, low and close move with every
// execution, a last-print line flashes, and on the next poll the venue's own
// bar lands over it. 4H and 1D keep polling: a day bar needs no socket.
//
// The honesty rule: only prints of the chart's OWN instrument drive its tail.
//   • a Hyperliquid perp chart takes HyperCore prints — the same venue, the
//     same book, exact;
//   • a Coinbase-sourced coin chart takes DEX spot prints for that coin on
//     Ethereum, Base and Arbitrum (WETH is ETH; cbBTC and WBTC are BTC) —
//     Dune's spot trial covers fifteen tokens, so a coin outside it keeps a
//     polled tail and the pill says so;
//   • a tokenized stock takes nothing: the Robinhood tape is one instrument,
//     the xyz stock PERPS are another; mixing them would draw a perp's price
//     on a spot chart.
// Pure: no network, no engine. Pinned in scripts/tape-pins.ts.

import type { Candle, ChartPair, ChartTf } from '@/lib/charts'
import type { DuneVenueId } from '@/lib/dune'
import type { TapeFill } from '@/lib/tape'

/** The frames whose tail follows the prints. */
export const LIVE_TAIL_TFS: readonly ChartTf[] = ['1s', '1m', '15m', '1h']

export interface ChartLiveFeed {
  venues: DuneVenueId[]
  /** The venue spellings the relay filters to (`markets=`). */
  markets: string[]
  /** The words after the dot: where the prints come from. */
  label: string
}

/** Dune's spot trial: the fifteen tokens its DEX feed carries (July 2026
 *  runbook), by the chart's canonical symbol → the symbols the feed prints. */
const DEX_PRINTS: Readonly<Record<string, readonly string[]>> = {
  ETH: ['WETH', 'ETH'],
  BTC: ['WBTC', 'cbBTC'],
  UNI: ['UNI'],
  AAVE: ['AAVE'],
  LINK: ['LINK'],
  AERO: ['AERO'],
  ARB: ['ARB'],
}

const DEX_VENUES: DuneVenueId[] = ['dex-ethereum', 'dex-base', 'dex-arbitrum']

export function chartLiveFeed(pair: Pick<ChartPair, 'symbol' | 'source' | 'pair'> | null): ChartLiveFeed | null {
  if (!pair) return null
  if (pair.source === 'hyperliquid') return { venues: ['hypercore'], markets: [pair.pair], label: 'Hyperliquid prints' }
  if (pair.source === 'coinbase') {
    const m = DEX_PRINTS[pair.symbol.toUpperCase()]
    return m ? { venues: DEX_VENUES, markets: [...m], label: 'DEX prints' } : null
  }
  return null
}

/** Does this frame follow the prints at all? */
export function tailIsLive(tf: ChartTf, feed: ChartLiveFeed | null): boolean {
  return !!feed && LIVE_TAIL_TFS.includes(tf)
}

export interface Print {
  /** Milliseconds. */
  at: number
  price: number
  /** Base units, the candle's volume unit. */
  size: number
}

/** The bucket a print belongs to, in the frame's seconds. */
export function bucketOf(atMs: number, tfSec: number): number {
  return Math.floor(atMs / 1000 / tfSec) * tfSec
}

/**
 * One print onto the tail. In the tail's own bucket it stretches the high
 * and low, moves the close and adds its size; a print in a NEWER bucket
 * opens a new bar at its price (the old one is done); a print older than
 * the tail's bucket is history the venue already closed — ignored, never
 * redrawn. A print at or under zero is noise.
 */
export function applyPrint(tail: Candle | null, p: Print, tfSec: number): { bar: Candle; fresh: boolean } | null {
  if (!(p.price > 0) || !Number.isFinite(p.at)) return null
  const t = bucketOf(p.at, tfSec)
  const size = Number.isFinite(p.size) && p.size > 0 ? p.size : 0
  if (!tail || t > tail.t) return { bar: { t, o: p.price, h: p.price, l: p.price, c: p.price, v: size }, fresh: true }
  if (t < tail.t) return null
  return { bar: { t: tail.t, o: tail.o, h: Math.max(tail.h, p.price), l: Math.min(tail.l, p.price), c: p.price, v: tail.v + size }, fresh: false }
}

/** A tape fill as a print (the relay already filtered the market). */
export function printOf(f: Pick<TapeFill, 'at' | 'price' | 'size'>): Print {
  return { at: f.at, price: f.price, size: f.size }
}

/**
 * A PRINT frame's bars (1s): the whole series from the prints, oldest
 * first — the relay's backfill (the last minutes it already held) plus
 * every live print since. A second with no print is no bar: the engine
 * draws the gap, never a flat invented candle.
 */
export function barsFromPrints(prints: readonly Print[], tfSec: number): Candle[] {
  const sorted = [...prints].filter((p) => p.price > 0 && Number.isFinite(p.at)).sort((a, b) => a.at - b.at)
  const out: Candle[] = []
  for (const p of sorted) {
    const r = applyPrint(out[out.length - 1] ?? null, p, tfSec)
    if (!r) continue
    if (r.fresh) out.push(r.bar)
    else out[out.length - 1] = r.bar
  }
  return out
}

/** How much of a print frame the relay hands a new viewer: the minutes it
 *  already holds (lib/dune LIVE_BACKFILL_MS). A cold instance holds less and
 *  the frame builds as you watch — said in the foot. */
export const PRINT_KEEP_MS = 5 * 60_000

/** The pill's words. */
export function tailWords(status: 'idle' | 'connecting' | 'live' | 'reconnecting' | 'unconfigured' | 'closed', feed: ChartLiveFeed | null, tf: ChartTf): string {
  if (!feed) return 'polled'
  if (!LIVE_TAIL_TFS.includes(tf)) return 'polled · prints on 1m–1H'
  switch (status) {
    case 'live':
      return tf === '1s' ? `${feed.label} · live · bars built from prints` : `${feed.label} · live`
    case 'connecting':
    case 'idle':
      return `${feed.label} · connecting`
    case 'reconnecting':
      return `${feed.label} · reconnecting`
    case 'unconfigured':
      return 'polled · relay has no key'
    case 'closed':
      return 'polled'
  }
}
