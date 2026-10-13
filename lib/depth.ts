// THE DEPTH CHART (2026-10-13). Nate, with Coinbase's UNI-USDC depth chart:
// "can we build a depth chart on an asset like this using the realtime Dune
// data showing the order book stack?"
//
// The honest premise: Dune's feed is EXECUTIONS, not the book (its runbook
// puts order-book depth outside the feed's scope; every frame on the wire is
// a trade). So the curve comes from the books the venues publish — Coinbase's
// level-2 spot book, Hyperliquid's l2Book — and Dune adds the one thing a
// venue's own depth chart lacks: the prints landing on the curve as they
// happen (a wall eaten, a sweep running up the asks).
//
// This module is the pure half: the book model and its deltas, the window,
// the cumulative curve, the hover's numbers, the act at a level, the foot's
// words. No DOM, no socket, no network. Pinned in scripts/depth-pins.ts.
// components/markets/chart/DepthChart.tsx draws it; lib/depth-feed.ts feeds it.

import type { ChartPair } from '@/lib/charts'

export type DepthSide = 'bid' | 'ask'

/** One resting level: the price and the size in BASE units (UNI, not dollars). */
export interface DepthLevel {
  px: number
  size: number
}

/** The book as the chart holds it: bids best-first (descending), asks
 *  best-first (ascending), every size > 0, every price unique. */
export interface DepthBook {
  bids: DepthLevel[]
  asks: DepthLevel[]
  /** (best bid + best ask) / 2; null while a side is empty. */
  mid: number | null
  /** Unix ms of the last change applied. */
  at: number
}

/** A change on one side: size 0 removes the level. */
export interface L2Change {
  side: DepthSide
  px: number
  size: number
}

/** Where a book comes from — the label on the curve and in the foot. */
export type DepthVenue = 'coinbase' | 'hyperliquid'

export const DEPTH_VENUE_LABEL: Record<DepthVenue, string> = {
  coinbase: 'Coinbase spot',
  hyperliquid: 'Hyperliquid perp',
}

/** The window chips: ± percent of the mid shown. `null` = the whole book. */
export const DEPTH_WINDOWS: readonly { pct: number | null; label: string }[] = [
  { pct: 0.5, label: '0.5%' },
  { pct: 1, label: '1%' },
  { pct: 2, label: '2%' },
  { pct: 5, label: '5%' },
  { pct: 10, label: '10%' },
  { pct: null, label: 'All' },
]
export const DEFAULT_DEPTH_WINDOW_PCT = 2

/** The size axis: the venue's base units (Coinbase's choice) or dollars (the
 *  page's choice — every other number on /t is a dollar). Dollars lead. */
export type DepthUnit = 'usd' | 'base'
export const DEFAULT_DEPTH_UNIT: DepthUnit = 'usd'

/** A print fades off the curve after this long. */
export const PRINT_FADE_MS = 8_000
/** The tape strip under the chart shows this many prints — whole rows, never a clipped one. */
export const DEPTH_TAPE_ROWS = 6

export const EMPTY_BOOK: DepthBook = { bids: [], asks: [], mid: null, at: 0 }

const finitePos = (n: number): boolean => Number.isFinite(n) && n > 0

function midOf(bids: readonly DepthLevel[], asks: readonly DepthLevel[]): number | null {
  if (!bids.length || !asks.length) return null
  return (bids[0].px + asks[0].px) / 2
}

/**
 * A book from raw levels in any order: a price at or under zero, a size at
 * or under zero, or a non-number is dropped; a price given twice keeps the
 * LAST size (a snapshot that repeats a level is the venue restating it);
 * bids sort best-first downward, asks best-first upward. A crossed book
 * (best bid ≥ best ask) is the venue mid-update: the crossing bid levels
 * are dropped so the mid stays a real spread, never a negative one.
 */
export function bookFromLevels(bids: readonly DepthLevel[], asks: readonly DepthLevel[], at = 0): DepthBook {
  const clean = (rows: readonly DepthLevel[]): Map<number, number> => {
    const m = new Map<number, number>()
    for (const r of rows) {
      if (!finitePos(r.px) || !Number.isFinite(r.size)) continue
      if (r.size <= 0) m.delete(r.px)
      else m.set(r.px, r.size)
    }
    return m
  }
  const b = [...clean(bids).entries()].map(([px, size]) => ({ px, size })).sort((x, y) => y.px - x.px)
  const a = [...clean(asks).entries()].map(([px, size]) => ({ px, size })).sort((x, y) => x.px - y.px)
  let bb = b
  if (a.length) {
    const bestAsk = a[0].px
    bb = b.filter((l) => l.px < bestAsk)
  }
  return { bids: bb, asks: a, mid: midOf(bb, a), at }
}

/** The book after a venue's delta: a size sets the level, zero removes it.
 *  Returns the same book when nothing changed. */
export function applyL2Changes(book: DepthBook, changes: readonly L2Change[], at: number): DepthBook {
  if (!changes.length) return book
  const bids = new Map(book.bids.map((l) => [l.px, l.size]))
  const asks = new Map(book.asks.map((l) => [l.px, l.size]))
  let touched = false
  for (const c of changes) {
    if (!finitePos(c.px) || !Number.isFinite(c.size)) continue
    const m = c.side === 'bid' ? bids : asks
    if (c.size <= 0) {
      if (m.delete(c.px)) touched = true
    } else if (m.get(c.px) !== c.size) {
      m.set(c.px, c.size)
      touched = true
    }
  }
  if (!touched) return book
  return bookFromLevels([...bids].map(([px, size]) => ({ px, size })), [...asks].map(([px, size]) => ({ px, size })), at)
}

// ── Venue wire shapes (parsed here so the pins hold them to real samples) ──

/** Coinbase Advanced Trade WebSocket `level2` (keyless, measured 2026-10-13):
 *  `{channel:'l2_data', events:[{type:'snapshot'|'update', product_id,
 *  updates:[{side:'bid'|'offer', price_level, new_quantity}]}]}`. A
 *  `new_quantity` of 0 removes the level. Anything else on the socket
 *  (subscriptions, heartbeats) parses to null. */
export interface CoinbaseL2Event {
  kind: 'snapshot' | 'update'
  product: string
  changes: L2Change[]
}

export function parseCoinbaseL2(raw: unknown): CoinbaseL2Event[] {
  if (!raw || typeof raw !== 'object') return []
  const msg = raw as { channel?: unknown; events?: unknown }
  if (msg.channel !== 'l2_data' || !Array.isArray(msg.events)) return []
  const out: CoinbaseL2Event[] = []
  for (const ev of msg.events as { type?: unknown; product_id?: unknown; updates?: unknown }[]) {
    if (!ev || (ev.type !== 'snapshot' && ev.type !== 'update') || typeof ev.product_id !== 'string' || !Array.isArray(ev.updates)) continue
    const changes: L2Change[] = []
    for (const u of ev.updates as { side?: unknown; price_level?: unknown; new_quantity?: unknown }[]) {
      if (!u || (u.side !== 'bid' && u.side !== 'offer')) continue
      const px = Number(u.price_level)
      const size = Number(u.new_quantity)
      if (!finitePos(px) || !Number.isFinite(size) || size < 0) continue
      changes.push({ side: u.side === 'bid' ? 'bid' : 'ask', px, size })
    }
    out.push({ kind: ev.type, product: ev.product_id, changes })
  }
  return out
}

/** Hyperliquid `l2Book` (WebSocket push or the info API; measured): a whole
 *  book each time — `{levels:[bids[], asks[]]}` of `{px, sz, n}`. */
export function parseHlL2Book(raw: unknown, at = Date.now()): DepthBook | null {
  if (!raw || typeof raw !== 'object') return null
  const d = ('channel' in (raw as object) ? (raw as { channel?: unknown; data?: unknown }).data : raw) as { levels?: unknown } | undefined
  if (!d || !Array.isArray(d.levels) || d.levels.length < 2) return null
  const side = (rows: unknown): DepthLevel[] => (Array.isArray(rows) ? (rows as { px?: unknown; sz?: unknown }[]).map((r) => ({ px: Number(r?.px), size: Number(r?.sz) })) : [])
  const book = bookFromLevels(side(d.levels[0]), side(d.levels[1]), at)
  return book.bids.length || book.asks.length ? book : null
}

/** The site's own book routes (`/api/markets/spot-book`, `/api/markets/book`)
 *  carry dollars per level, not units: size = usd / px. */
export function bookFromRoute(body: { bids?: { px: number; usd: number }[]; asks?: { px: number; usd: number }[]; at?: number } | null | undefined): DepthBook | null {
  if (!body || !Array.isArray(body.bids) || !Array.isArray(body.asks)) return null
  const lv = (rows: { px: number; usd: number }[]): DepthLevel[] => rows.map((r) => ({ px: Number(r.px), size: Number(r.px) > 0 ? Number(r.usd) / Number(r.px) : 0 }))
  const book = bookFromLevels(lv(body.bids), lv(body.asks), body.at ?? Date.now())
  return book.bids.length || book.asks.length ? book : null
}

// ── The curve ────────────────────────────────────────────────────────────

/** A level with everything resting between it and the mid, inclusive. */
export interface CumLevel extends DepthLevel {
  /** Base units, cumulative from the mid outward. */
  cum: number
  /** Dollars (size × price), cumulative from the mid outward. */
  cumUsd: number
}

/** Cumulate one side from the mid outward. The side must already be
 *  best-first (bookFromLevels); a zero or negative size never counts. */
export function cumulate(levels: readonly DepthLevel[]): CumLevel[] {
  const out: CumLevel[] = []
  let cum = 0
  let cumUsd = 0
  for (const l of levels) {
    if (!finitePos(l.px) || !finitePos(l.size)) continue
    cum += l.size
    cumUsd += l.size * l.px
    out.push({ px: l.px, size: l.size, cum, cumUsd })
  }
  return out
}

export interface DepthWindow {
  /** The window's price span, symmetric about the mid. */
  lo: number
  hi: number
  mid: number
  pct: number | null
  bids: CumLevel[]
  asks: CumLevel[]
  /** The taller side's last cumulative, the y-axis top. */
  maxCum: number
  maxCumUsd: number
  /** Resting inside the window, per side. */
  bidUsd: number
  askUsd: number
}

/**
 * The slice of the book within ±pct of the mid, cumulated FROM THE MID
 * OUTWARD — so the window's edge reads the window's own dollars (Coinbase
 * cumulates over the whole book, so its edge reads a number you cannot see
 * the rest of). `null` pct = the whole book, on a span symmetric about the
 * mid so both sides keep one price scale. A book with no mid has no window.
 */
export function depthWindow(book: DepthBook, pct: number | null): DepthWindow | null {
  const mid = book.mid
  if (mid == null || !finitePos(mid)) return null
  let half: number
  if (pct == null) {
    const lowest = book.bids.length ? book.bids[book.bids.length - 1].px : mid
    const highest = book.asks.length ? book.asks[book.asks.length - 1].px : mid
    half = Math.max(mid - lowest, highest - mid)
    if (!(half > 0)) half = mid * 0.01
  } else {
    if (!finitePos(pct)) return null
    half = (mid * pct) / 100
  }
  const lo = mid - half
  const hi = mid + half
  const bids = cumulate(book.bids.filter((l) => l.px >= lo))
  const asks = cumulate(book.asks.filter((l) => l.px <= hi))
  const lastB = bids[bids.length - 1]
  const lastA = asks[asks.length - 1]
  return {
    lo,
    hi,
    mid,
    pct,
    bids,
    asks,
    maxCum: Math.max(lastB?.cum ?? 0, lastA?.cum ?? 0),
    maxCumUsd: Math.max(lastB?.cumUsd ?? 0, lastA?.cumUsd ?? 0),
    bidUsd: lastB?.cumUsd ?? 0,
    askUsd: lastA?.cumUsd ?? 0,
  }
}

/** The curve's value at a price: the cumulative of the last level at or
 *  nearer the mid than `price` on its side (a step function, flat between
 *  levels). Null outside the book or at the mid itself. */
export function levelAt(w: DepthWindow, price: number): { side: DepthSide; level: CumLevel; index: number } | null {
  if (!finitePos(price) || price === w.mid) return null
  const side: DepthSide = price < w.mid ? 'bid' : 'ask'
  const rows = side === 'bid' ? w.bids : w.asks
  let hit = -1
  for (let i = 0; i < rows.length; i++) {
    if (side === 'bid' ? rows[i].px >= price : rows[i].px <= price) hit = i
    else break
  }
  return hit < 0 ? null : { side, level: rows[hit], index: hit }
}

/** Dollars of resting orders between the mid and `price`: what a taker
 *  would have to buy (above) or sell (below) to move the mid there. Zero at
 *  or inside the spread. */
export function costToMove(book: DepthBook, price: number): number {
  const mid = book.mid
  if (mid == null || !finitePos(price)) return 0
  let usd = 0
  if (price > mid) for (const l of book.asks) {
    if (l.px > price) break
    usd += l.size * l.px
  }
  else if (price < mid) for (const l of book.bids) {
    if (l.px < price) break
    usd += l.size * l.px
  }
  return usd
}

/** Where a print lands: a buy lifts the asks, a sell hits the bids; with no
 *  side given, the price decides (at or over the mid = the asks). */
export function printOnBook(print: { price: number; side?: 'buy' | 'sell' | null }, mid: number | null): DepthSide {
  if (print.side === 'buy') return 'ask'
  if (print.side === 'sell') return 'bid'
  if (mid == null) return 'ask'
  return print.price >= mid ? 'ask' : 'bid'
}

/** The largest single levels in the window, per side — the walls. */
export function wallsIn(w: DepthWindow, n = 3): { bids: CumLevel[]; asks: CumLevel[] } {
  const top = (rows: readonly CumLevel[]) => [...rows].sort((a, b) => b.size * b.px - a.size * a.px).slice(0, Math.max(0, n))
  return { bids: top(w.bids), asks: top(w.asks) }
}

/** A print's fade, 1 → 0 over PRINT_FADE_MS; 0 once gone. */
export function printAlpha(atMs: number, nowMs: number, fadeMs = PRINT_FADE_MS): number {
  const age = nowMs - atMs
  if (age <= 0) return 1
  if (age >= fadeMs) return 0
  return 1 - age / fadeMs
}

/** A print's dot radius in CSS px from its notional: square-root scaled so
 *  a $10K print is twice a $2.5K one, floored for visibility, capped. */
export function printRadius(usd: number, min = 3, max = 18): number {
  if (!finitePos(usd)) return min
  return Math.min(max, Math.max(min, Math.sqrt(usd / 100)))
}

// ── The act at a level ───────────────────────────────────────────────────

/** Clicking a level aims the order ticket at a LIMIT order resting there:
 *  on the bids (under the mid) a limit BUY, on the asks (over) a limit
 *  SELL — the only two that rest, which is the ticket's own honesty rule
 *  (lib/order-ticket: a limit buy at or over the market is marketable, a
 *  market order in a limit's clothes). Null at the mid. */
export function limitAimAt(side: DepthSide, price: number): { side: 'buy' | 'sell'; limitPrice: number } | null {
  if (!finitePos(price)) return null
  return { side: side === 'bid' ? 'buy' : 'sell', limitPrice: price }
}

/** Does this chart have a resting-order lane at all? A spot coin rests on
 *  CoW (its limit chains, lib/order-ticket); a perp has no limit grammar
 *  here; a tokenized stock trades against a pool, not a book. The caller
 *  passes the lane's chain count. */
export function levelActsFor(pair: Pick<ChartPair, 'source'>, limitChains: number): boolean {
  return pair.source === 'coinbase' && limitChains > 0
}

// ── Which books a chart has ──────────────────────────────────────────────

export interface DepthPlan {
  /** The book the curve is drawn from. */
  main: DepthVenue | null
  /** A second book offered as a thin outline (off by default). */
  other: DepthVenue | null
  /** Why there is no main book, in words. */
  why: string | null
}

/** A Coinbase-sourced coin draws Coinbase's book with Hyperliquid's perp
 *  book offered beside it (a DIFFERENT instrument — labeled, off by
 *  default); a Hyperliquid perp draws its own book and nothing else (no spot
 *  book exists for it); a tokenized stock has no resting book at all. */
export function depthPlanFor(pair: Pick<ChartPair, 'source' | 'symbol'> | null, perpListed: boolean): DepthPlan {
  if (!pair) return { main: null, other: null, why: 'No chart, no book.' }
  if (pair.source === 'coinbase') return { main: 'coinbase', other: perpListed ? 'hyperliquid' : null, why: null }
  if (pair.source === 'hyperliquid') return { main: 'hyperliquid', other: null, why: null }
  return { main: null, other: null, why: `${pair.symbol} on Robinhood Chain trades against a Uniswap pool, not a resting order book — there is no depth to stack. Coinbase does not list it.` }
}

// ── Words and numbers ────────────────────────────────────────────────────

export type BookFeedStatus = 'idle' | 'connecting' | 'live' | 'polling' | 'reconnecting' | 'missing' | 'closed'

/** The foot's book words. */
export function bookWords(venue: DepthVenue | null, status: BookFeedStatus, pollSec = 5): string {
  if (!venue) return 'book · none'
  const name = venue === 'coinbase' ? 'Coinbase level 2' : 'Hyperliquid l2Book'
  switch (status) {
    case 'live':
      return `book · ${name} · live`
    case 'polling':
      return `book · ${name} · every ${pollSec}s`
    case 'connecting':
    case 'idle':
      return `book · ${name} · connecting`
    case 'reconnecting':
      return `book · ${name} · reconnecting`
    case 'missing':
      return `book · ${name} · not listed`
    case 'closed':
      return `book · ${name} · closed`
  }
}

/** The foot's prints words: Dune only ever adds the prints, and it says so. */
export function printWords(feedLabel: string | null, status: 'idle' | 'connecting' | 'live' | 'reconnecting' | 'unconfigured' | 'closed' | null, count: number): string {
  if (!feedLabel || status === null) return 'prints · none for this instrument'
  switch (status) {
    case 'live':
      return count > 0 ? `prints · ${feedLabel} · live` : `prints · ${feedLabel} · waiting for the first print`
    case 'connecting':
    case 'idle':
      return `prints · ${feedLabel} · connecting`
    case 'reconnecting':
      return `prints · ${feedLabel} · reconnecting`
    case 'unconfigured':
      return 'prints · relay has no key'
    case 'closed':
      return 'prints · off'
  }
}

/** A book price with the precision its magnitude needs — Coinbase shows four
 *  decimals on a $7 coin, two on a $100 one. */
export function fmtDepthPrice(p: number): string {
  if (!Number.isFinite(p)) return '—'
  if (p >= 10_000) return p.toFixed(0)
  if (p >= 100) return p.toFixed(2)
  if (p >= 1) return p.toFixed(4)
  if (p >= 0.01) return p.toFixed(5)
  return p.toPrecision(3)
}

/** A base-unit size: three significant figures below 10, then plain. */
export function fmtDepthSize(n: number): string {
  if (!Number.isFinite(n)) return '—'
  const a = Math.abs(n)
  if (a >= 1e6) return `${(a / 1e6).toFixed(2)}M`
  if (a >= 1e4) return `${(a / 1e3).toFixed(1)}K`
  if (a >= 10) return a.toFixed(1)
  if (a >= 1) return a.toFixed(2)
  return a.toPrecision(3)
}

/** Dollars, short: $1.2M · $340K · $5,120 · $42. */
export function fmtDepthUsd(n: number): string {
  if (!Number.isFinite(n)) return '—'
  const a = Math.abs(n)
  if (a >= 1e9) return `$${(a / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `$${(a / 1e6).toFixed(a >= 1e7 ? 1 : 2)}M`
  if (a >= 1e4) return `$${(a / 1e3).toFixed(0)}K`
  if (a >= 1e3) return `$${a.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
  return `$${a.toFixed(0)}`
}

/** The axis's numbers: five round steps up to the top. */
export function axisSteps(max: number, n = 4): number[] {
  if (!finitePos(max)) return []
  const raw = max / n
  const mag = 10 ** Math.floor(Math.log10(raw))
  const norm = raw / mag
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10
  const step = nice * mag
  const out: number[] = []
  for (let v = step; v <= max + 1e-9; v += step) out.push(v)
  return out
}

/** The URL and the switch: `?view=depth`. */
export const DEPTH_VIEW_PARAM = 'depth'
