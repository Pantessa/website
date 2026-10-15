// THE FLYOVER (2026-10-15): fly over every live market. Buys raise the land,
// sells sink it; color is the price move; every plot carries the sentence a
// wallet can sign.
//
// Nate, with the Pulse on `/` open: "I want to see this market data in a view
// as if we were flying over the blockchain space and can see all the buy and
// sell data pushing up on land so we can see the winners and losers ... It
// should be interactive and look good on full screen. Use the Dune data and
// most important is that it should be informative for the user."
//
// The world, channel by channel (each one a measured number, never a guess):
//   • a PLOT is a market that printed in the last 15 minutes, on the
//     CONTINENT of the venue it printed on (HyperCore perps, HyperCore xyz
//     stock perps, Lighter, Lighter Robinhood, the DEX trial on Base,
//     Ethereum and Arbitrum) — "the blockchain space";
//   • its FOOTPRINT is its size: the venue's own 24h volume where the venue
//     tells us (HyperCore), else 96x what this session saw in 15 minutes,
//     never under a floor so a thin DEX token still has land you can read;
//   • its HEIGHT is the lens: Flow (the default) = net taker flow over the
//     window, buys minus sells, on a log ladder (each story is ten times the
//     dollars of the one below); Activity = everything traded; Move = the
//     price move;
//   • its COLOR is the price move over the same window, in every lens — so
//     "bought hard but still red" and "sold hard but green" read at a glance;
//   • every fill is a DROP onto its plot; a print of $50K or more is a METEOR.
//
// This module is the pure half: the ledger of per-second buckets, the sums,
// the ladders, the continents, the layout (a squarified treemap per
// continent), the stability rules, the leaderboard, the label tiers, the
// readout's sentences, the chips (lib/tape followAsk, verbatim — the page
// gates them with canTradeAsk), the sky log and the legend. No React, no
// three, no DOM, no fetch: scripts/flyover-pins.ts imports it under node.
// components/live/flyover-scene.ts draws it; components/live/Flyover.tsx
// subscribes and holds the HUD.
//
// Anything a person could sign or share (the readout, the legend, the sky
// log) is printable ASCII: the house style's em dashes, curly quotes and
// middle dots are kept out of these lines on purpose.

import { DUNE_VENUES, type DuneVenueId } from '@/lib/dune'
import { DEFAULT_THRESHOLDS, FLOW_CLASSES, flowClassOf, followAsk, tapeMarket, type FlowClass, type FollowAsk, type TapeFill, type TapeSide, type TapeSource, type TapeVenue } from '@/lib/tape'

// ── Windows and lenses (the URL) ─────────────────────────────────────────────

export type FlyoverWindow = '1m' | '5m' | '15m'
export const FLYOVER_WINDOWS: readonly FlyoverWindow[] = ['1m', '5m', '15m']
export const DEFAULT_FLYOVER_WINDOW: FlyoverWindow = '5m'
export const WINDOW_SEC: Readonly<Record<FlyoverWindow, number>> = { '1m': 60, '5m': 300, '15m': 900 }

export function parseFlyoverWindow(raw: string | null | undefined): FlyoverWindow {
  return FLYOVER_WINDOWS.includes(raw as FlyoverWindow) ? (raw as FlyoverWindow) : DEFAULT_FLYOVER_WINDOW
}

export type FlyoverLens = 'flow' | 'activity' | 'move'
export const LENSES: readonly FlyoverLens[] = ['flow', 'activity', 'move']
export const DEFAULT_LENS: FlyoverLens = 'flow'
export const LENS_LABEL: Readonly<Record<FlyoverLens, string>> = { flow: 'Flow', activity: 'Activity', move: 'Move' }
/** One line each: the question a lens answers. */
export const LENS_HINT: Readonly<Record<FlyoverLens, string>> = {
  flow: 'where money is pushing: net taker flow',
  activity: 'where it is busy: everything traded',
  move: 'who is winning: the price move',
}

export function parseLens(raw: string | null | undefined): FlyoverLens {
  return LENSES.includes(raw as FlyoverLens) ? (raw as FlyoverLens) : DEFAULT_LENS
}

/**
 * The address bar's query with the Flyover's own two params set (`?w=`,
 * `?lens=`), each omitted at its default; everything else (`view`, `t`, `m`)
 * kept as it was. The page mirrors with replaceState; the router never sees
 * it, so lib/LiveTabs reads the address bar at click time.
 */
export function flyoverSearch(search: string, w: FlyoverWindow, lens: FlyoverLens): string {
  const q = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  if (w === DEFAULT_FLYOVER_WINDOW) q.delete('w')
  else q.set('w', w)
  if (lens === DEFAULT_LENS) q.delete('lens')
  else q.set('lens', lens)
  const s = q.toString().replace(/%2C/gi, ',').replace(/%3A/gi, ':')
  return s ? `?${s}` : ''
}

/** What a share of The Flyover appends to the share URL (which always names
 *  `view=flyover`): `&w=1m&lens=move`, only what is off its default. */
export function flyoverShareParams(search: URLSearchParams): string {
  const w = parseFlyoverWindow(search.get('w'))
  const lens = parseLens(search.get('lens'))
  return `${w !== DEFAULT_FLYOVER_WINDOW ? `&w=${w}` : ''}${lens !== DEFAULT_LENS ? `&lens=${lens}` : ''}`
}

// ── Continents: one per venue ────────────────────────────────────────────────

export type ContinentId = 'hypercore' | 'hypercore-xyz' | 'lighter' | 'lighter-robinhood' | 'dex-base' | 'dex-ethereum' | 'dex-arbitrum'

export interface ContinentDef {
  id: ContinentId
  /** The ground label. ASCII. */
  label: string
  /** One line: what lives there. ASCII. */
  blurb: string
  kind: 'perp' | 'spot'
  /** The relay venue it is read from (lib/dune). */
  duneVenue: DuneVenueId
}

/** Display order: HyperCore first, then the other perp books, then the chains. */
export const CONTINENTS: readonly ContinentDef[] = [
  { id: 'hypercore', label: 'HyperCore', blurb: 'Hyperliquid perps', kind: 'perp', duneVenue: 'hypercore' },
  { id: 'hypercore-xyz', label: 'HyperCore xyz', blurb: 'stock perps on the xyz dex', kind: 'perp', duneVenue: 'hypercore' },
  { id: 'lighter', label: 'Lighter', blurb: 'Lighter perps, USDC-settled', kind: 'perp', duneVenue: 'lighter' },
  { id: 'lighter-robinhood', label: 'Lighter Robinhood', blurb: 'USDG-settled perps', kind: 'perp', duneVenue: 'lighter-robinhood' },
  { id: 'dex-base', label: 'Base DEX', blurb: 'spot swaps on Base', kind: 'spot', duneVenue: 'dex-base' },
  { id: 'dex-ethereum', label: 'Ethereum DEX', blurb: 'spot swaps on Ethereum', kind: 'spot', duneVenue: 'dex-ethereum' },
  { id: 'dex-arbitrum', label: 'Arbitrum DEX', blurb: 'spot swaps on Arbitrum', kind: 'spot', duneVenue: 'dex-arbitrum' },
]

export function continentDef(id: ContinentId): ContinentDef {
  return CONTINENTS.find((c) => c.id === id) ?? CONTINENTS[0]
}

const DEX_CONTINENT: Readonly<Record<number, ContinentId>> = { 8453: 'dex-base', 1: 'dex-ethereum', 42161: 'dex-arbitrum' }

/** Where a fill lands. A HyperCore market spelled `xyz:` is a stock perp
 *  on the xyz dex; a spot swap is its chain's DEX; a chain the trial does not
 *  carry has no continent (null — the fill is not drawn, never guessed). */
export function continentOf(venue: TapeVenue, chainId: number | null, market = ''): ContinentId | null {
  switch (venue) {
    case 'hyperliquid':
      return /^xyz:/i.test(market) ? 'hypercore-xyz' : 'hypercore'
    case 'lighter':
      return 'lighter'
    case 'lighter-robinhood':
      return 'lighter-robinhood'
    case 'dex':
      return chainId != null ? (DEX_CONTINENT[chainId] ?? null) : null
  }
  return null
}

/** The relay venues a set of continents reads. */
export function venuesOfContinents(ids: readonly ContinentId[]): DuneVenueId[] {
  const want = new Set(ids.map((id) => continentDef(id).duneVenue))
  return DUNE_VENUES.map((v) => v.id).filter((id) => want.has(id))
}

/** A plot is a market on a continent: `BTC` on HyperCore and `BTC` on
 *  Lighter are two plots, `WETH` on Base and on Ethereum two more. */
export function plotKey(continent: ContinentId, market: string): string {
  return `${continent}|${market}`
}

export function parsePlotKey(key: string): { continent: ContinentId; market: string } | null {
  const i = key.indexOf('|')
  if (i <= 0) return null
  const continent = key.slice(0, i) as ContinentId
  if (!CONTINENTS.some((c) => c.id === continent)) return null
  const market = key.slice(i + 1)
  return market ? { continent, market } : null
}

/** The name a plot wears: the bare ticker (`xyz:NVDA` is NVDA on the xyz
 *  continent already). */
export function plotName(market: string): string {
  return tapeMarket(market).ticker
}

// ── The ledger: per-second buckets per plot ──────────────────────────────────

/** How much history every plot keeps (the widest window), plus a little so a
 *  bucket at the window's edge is never pruned a second early. */
export const LEDGER_KEEP_SEC = 900
export const LEDGER_SPAN_SEC = LEDGER_KEEP_SEC + 30
/** A block the relay replaced (op UPDATE) arrives within seconds; its fills
 *  stay in the journal this long so a retract can take them back out. */
export const JOURNAL_KEEP_SEC = 180

export interface LargestPrint {
  id: string
  usd: number
  side: TapeSide
  at: number
  price: number
}

export interface LedgerBucket {
  /** Unix seconds. */
  sec: number
  buyUsd: number
  sellUsd: number
  count: number
  firstPx: number
  lastPx: number
  /** The venue stamps of the first and last price in the bucket. */
  firstAt: number
  lastAt: number
  largest: LargestPrint | null
  /** Dollars by flow class (Dune's four when the effect is known, the taker side otherwise). */
  effects: Record<FlowClass, number>
}

export interface PlotLedger {
  key: string
  market: string
  continent: ContinentId
  venue: TapeVenue
  /** The EVM chain of a spot plot; null for a perp. */
  chainId: number | null
  /** Ascending by `sec`. */
  buckets: LedgerBucket[]
  /** The newest venue stamp seen (ms). */
  lastAt: number
}

interface JournalEntry {
  id: string
  key: string
  sec: number
  usd: number
  side: TapeSide
  cls: FlowClass
}

export interface Ledger {
  plots: Map<string, PlotLedger>
  /** Fill id → its bucket second: the dedupe across a relay reopen (the
   *  backfill replays the ring) and the way a retract finds its fills. */
  seen: Map<string, number>
  /** `venue:block` → the fills it carried, for a retract. */
  journal: Map<string, { sec: number; entries: JournalEntry[] }>
}

export function createLedger(): Ledger {
  return { plots: new Map(), seen: new Map(), journal: new Map() }
}

const emptyEffects = (): Record<FlowClass, number> => ({ 'long-open': 0, 'short-cover': 0, 'long-close': 0, 'short-open': 0, buy: 0, sell: 0 })

function bucketAt(plot: PlotLedger, sec: number, create: boolean): LedgerBucket | null {
  const b = plot.buckets
  // Fills arrive newest-last almost always: search from the end.
  for (let i = b.length - 1; i >= 0; i--) {
    if (b[i].sec === sec) return b[i]
    if (b[i].sec < sec) {
      if (!create) return null
      const nb = newBucket(sec)
      b.splice(i + 1, 0, nb)
      return nb
    }
  }
  if (!create) return null
  const nb = newBucket(sec)
  b.unshift(nb)
  return nb
}

function newBucket(sec: number): LedgerBucket {
  return { sec, buyUsd: 0, sellUsd: 0, count: 0, firstPx: NaN, lastPx: NaN, firstAt: Infinity, lastAt: -Infinity, largest: null, effects: emptyEffects() }
}

/**
 * One fill into the ledger. A fill stamped in the future (a client clock
 * behind the venue's) counts at `now`; one older than the ledger's span, one
 * without a continent, a non-positive price or value, or one already seen
 * (same id) is not counted. Returns the plot key it landed on, or null.
 */
export function ingest(ledger: Ledger, fill: TapeFill, nowMs: number): string | null {
  if (!fill || typeof fill.id !== 'string' || ledger.seen.has(fill.id)) return null
  if (!(fill.usd > 0) || !(fill.price > 0) || !fill.market) return null
  const continent = continentOf(fill.venue, fill.chainId ?? null, fill.market)
  if (!continent) return null
  const nowSec = Math.floor(nowMs / 1000)
  const at = Number.isFinite(fill.at) ? Math.min(fill.at, nowMs) : nowMs
  const sec = Math.min(Math.floor(at / 1000), nowSec)
  if (sec <= nowSec - LEDGER_SPAN_SEC) return null
  const key = plotKey(continent, fill.market)
  let plot = ledger.plots.get(key)
  if (!plot) {
    plot = { key, market: fill.market, continent, venue: fill.venue, chainId: fill.venue === 'dex' ? fill.chainId ?? null : null, buckets: [], lastAt: 0 }
    ledger.plots.set(key, plot)
  }
  const b = bucketAt(plot, sec, true)!
  const cls = flowClassOf(fill)
  if (fill.side === 'buy') b.buyUsd += fill.usd
  else b.sellUsd += fill.usd
  b.count++
  b.effects[cls] += fill.usd
  if (at < b.firstAt) {
    b.firstAt = at
    b.firstPx = fill.price
  }
  if (at >= b.lastAt) {
    b.lastAt = at
    b.lastPx = fill.price
  }
  if (!b.largest || fill.usd > b.largest.usd) b.largest = { id: fill.id, usd: fill.usd, side: fill.side, at, price: fill.price }
  if (at > plot.lastAt) plot.lastAt = at
  ledger.seen.set(fill.id, sec)
  if (fill.block != null) {
    const jk = journalKey(fill.venue, fill.block)
    const j = ledger.journal.get(jk) ?? { sec, entries: [] }
    j.sec = Math.max(j.sec, sec)
    j.entries.push({ id: fill.id, key, sec, usd: fill.usd, side: fill.side, cls })
    ledger.journal.set(jk, j)
  }
  return key
}

function journalKey(venue: TapeVenue, block: number): string {
  return `${venue}:${block}`
}

/**
 * The relay replaced a block (op UPDATE): take that block's fills back out of
 * their buckets (and out of `seen`, so the replacement's fills — often the
 * same ids — count again). The ring is per-second sums, so a bucket's first
 * and last price stay as they were; a retracted fill that was its bucket's
 * largest clears that bucket's largest (the next print there can take it
 * back). Returns how many fills came out.
 */
export function retract(ledger: Ledger, venue: TapeVenue, block: number): number {
  const jk = journalKey(venue, block)
  const j = ledger.journal.get(jk)
  if (!j) return 0
  ledger.journal.delete(jk)
  let n = 0
  for (const e of j.entries) {
    ledger.seen.delete(e.id)
    const plot = ledger.plots.get(e.key)
    if (!plot) continue
    const b = bucketAt(plot, e.sec, false)
    if (!b) continue
    if (e.side === 'buy') b.buyUsd = Math.max(0, b.buyUsd - e.usd)
    else b.sellUsd = Math.max(0, b.sellUsd - e.usd)
    b.effects[e.cls] = Math.max(0, b.effects[e.cls] - e.usd)
    b.count = Math.max(0, b.count - 1)
    if (b.largest?.id === e.id) b.largest = null
    n++
    if (b.count === 0) plot.buckets.splice(plot.buckets.indexOf(b), 1)
  }
  return n
}

/** Age out buckets past the span, plots with nothing left, stale ids and
 *  journal blocks. Run on the page's second hand. */
export function prune(ledger: Ledger, nowMs: number): void {
  const nowSec = Math.floor(nowMs / 1000)
  const floor = nowSec - LEDGER_SPAN_SEC
  for (const [key, plot] of ledger.plots) {
    let i = 0
    while (i < plot.buckets.length && plot.buckets[i].sec <= floor) i++
    if (i > 0) plot.buckets.splice(0, i)
    if (plot.buckets.length === 0) ledger.plots.delete(key)
  }
  for (const [id, sec] of ledger.seen) if (sec <= floor) ledger.seen.delete(id)
  for (const [jk, j] of ledger.journal) if (j.sec <= nowSec - JOURNAL_KEEP_SEC) ledger.journal.delete(jk)
}

export interface PlotSums {
  buyUsd: number
  sellUsd: number
  /** buys − sells. */
  netUsd: number
  grossUsd: number
  count: number
  /** The price as the window opened (the last print before it, when the
   *  ledger holds one), else the first print inside it. Null = no print. */
  firstPx: number | null
  lastPx: number | null
  /** lastPx over firstPx, in percent. Null = no move to measure yet (no
   *  print, or one print and nothing before the window). */
  movePct: number | null
  largest: LargestPrint | null
  effects: Record<FlowClass, number>
  /** The newest print inside the window (ms), or null. */
  lastAt: number | null
}

export const EMPTY_SUMS: PlotSums = Object.freeze({ buyUsd: 0, sellUsd: 0, netUsd: 0, grossUsd: 0, count: 0, firstPx: null, lastPx: null, movePct: null, largest: null, effects: emptyEffects(), lastAt: null }) as PlotSums

/** What a plot did over the window: the seconds (nowSec − windowSec, nowSec]. */
export function sums(plot: PlotLedger | null | undefined, nowSec: number, windowSec: number): PlotSums {
  if (!plot || plot.buckets.length === 0) return { ...EMPTY_SUMS, effects: emptyEffects() }
  const start = nowSec - windowSec // exclusive
  let buy = 0
  let sell = 0
  let count = 0
  let refBefore: number | null = null
  let firstIn: number | null = null
  let firstInAt = Infinity
  let last: number | null = null
  let lastAt = -Infinity
  let largest: LargestPrint | null = null
  const effects = emptyEffects()
  for (const b of plot.buckets) {
    if (b.sec <= start) {
      if (b.count > 0 && Number.isFinite(b.lastPx)) refBefore = b.lastPx
      continue
    }
    if (b.sec > nowSec) break
    if (b.count === 0) continue
    buy += b.buyUsd
    sell += b.sellUsd
    count += b.count
    for (const c of FLOW_CLASSES) effects[c] += b.effects[c]
    if (Number.isFinite(b.firstPx) && b.firstAt < firstInAt) {
      firstInAt = b.firstAt
      firstIn = b.firstPx
    }
    if (Number.isFinite(b.lastPx) && b.lastAt >= lastAt) {
      lastAt = b.lastAt
      last = b.lastPx
    }
    if (b.largest && (!largest || b.largest.usd > largest.usd)) largest = b.largest
  }
  const firstPx = refBefore ?? firstIn
  const measurable = refBefore !== null || count >= 2
  const movePct = firstPx && last && measurable ? (last / firstPx - 1) * 100 : null
  return {
    buyUsd: buy,
    sellUsd: sell,
    netUsd: buy - sell,
    grossUsd: buy + sell,
    count,
    firstPx: count > 0 ? firstPx : null,
    lastPx: count > 0 ? last : null,
    movePct: count > 0 ? movePct : null,
    largest,
    effects,
    lastAt: count > 0 && Number.isFinite(lastAt) ? lastAt : null,
  }
}

/** Everything traded on a plot over the ledger's whole span (the session's
 *  measure of its size where the venue gives no 24h volume). */
export function sessionUsd(plot: PlotLedger | null | undefined, nowSec: number): number {
  if (!plot) return 0
  let usd = 0
  for (const b of plot.buckets) if (b.sec > nowSec - LEDGER_KEEP_SEC && b.sec <= nowSec) usd += b.buyUsd + b.sellUsd
  return usd
}

// ── Heights and color ────────────────────────────────────────────────────────

/** One story of net flow per window: about $1K a minute. Each ×10 in net
 *  flow is one more story (log ladder). */
export const UNIT_USD: Readonly<Record<FlyoverWindow, number>> = { '1m': 1_000, '5m': 5_000, '15m': 15_000 }
/** The price move that reads as full color (and three stories in the Move lens). */
export const MOVE_CLAMP_PCT: Readonly<Record<FlyoverWindow, number>> = { '1m': 0.5, '5m': 1.5, '15m': 3 }
/** Stories in the Move lens at the clamp. */
export const MOVE_STORIES = 3
/** The tallest tower / deepest pit the scene draws, in stories. */
export const MAX_STORIES = 5

/** Flow lens: sign · log10(1 + |net| / UNIT). 0 → 0; UNIT → log10(2); 9·UNIT → 1 story. */
export function elevation(netUsd: number, w: FlyoverWindow): number {
  if (!Number.isFinite(netUsd) || netUsd === 0) return 0
  const s = Math.log10(1 + Math.abs(netUsd) / UNIT_USD[w])
  return netUsd > 0 ? s : -s
}

/** Activity lens: log10(1 + gross / UNIT), never below 0. */
export function activityHeight(grossUsd: number, w: FlyoverWindow): number {
  if (!Number.isFinite(grossUsd) || grossUsd <= 0) return 0
  return Math.log10(1 + grossUsd / UNIT_USD[w])
}

/** Color position, −1 (full down) … 0 (neutral) … 1 (full up): the move over
 *  the window against that window's clamp. A plot with no move yet is 0. */
export function moveT(movePct: number | null, w: FlyoverWindow): number {
  if (movePct === null || !Number.isFinite(movePct)) return 0
  return Math.max(-1, Math.min(1, movePct / MOVE_CLAMP_PCT[w]))
}

/** Move lens: the same clamp, signed, three stories at the clamp. */
export function moveHeight(movePct: number | null, w: FlyoverWindow): number {
  return moveT(movePct, w) * MOVE_STORIES
}

/** The height a lens draws, in stories, clamped to the scene's range. */
export function heightFor(lens: FlyoverLens, s: Pick<PlotSums, 'netUsd' | 'grossUsd' | 'movePct'>, w: FlyoverWindow): number {
  const h = lens === 'flow' ? elevation(s.netUsd, w) : lens === 'activity' ? activityHeight(s.grossUsd, w) : moveHeight(s.movePct, w)
  return Math.max(-MAX_STORIES, Math.min(MAX_STORIES, h))
}

/** The dollars a lens needs for `stories` (the legend's ladder). */
export function storyUsd(stories: number, w: FlyoverWindow): number {
  return UNIT_USD[w] * (Math.pow(10, stories) - 1)
}

/** The lens draws a sea (signed heights) or bare ground (Activity, ≥ 0). */
export function lensHasSea(lens: FlyoverLens): boolean {
  return lens !== 'activity'
}

// ── Footprint ────────────────────────────────────────────────────────────────

/** 15 minutes is about 1/96 of a day. */
export const SESSION_WEIGHT = 96
/** No plot is smaller than this (a DEX token with three prints still has land). */
export const SIZE_FLOOR_USD = 25_000

/** A plot's footprint weight in dollars a day: the venue's own 24h volume, or
 *  96× the session's 15 minutes, whichever is larger, never under the floor. */
export function plotSize(s: { dayVolumeUsd?: number | null; sessionUsd: number }): number {
  const day = s.dayVolumeUsd != null && Number.isFinite(s.dayVolumeUsd) && s.dayVolumeUsd > 0 ? s.dayVolumeUsd : 0
  const session = Number.isFinite(s.sessionUsd) && s.sessionUsd > 0 ? s.sessionUsd * SESSION_WEIGHT : 0
  return Math.max(day, session, SIZE_FLOOR_USD)
}

/** Which input set the size (the readout says so). */
export function sizeBasis(s: { dayVolumeUsd?: number | null; sessionUsd: number }): 'day' | 'session' | 'floor' {
  const size = plotSize(s)
  const day = s.dayVolumeUsd != null && Number.isFinite(s.dayVolumeUsd) && s.dayVolumeUsd > 0 ? s.dayVolumeUsd : 0
  if (day > 0 && size === day) return 'day'
  if (size === SIZE_FLOOR_USD && s.sessionUsd * SESSION_WEIGHT < SIZE_FLOOR_USD) return 'floor'
  return 'session'
}

// ── Layout: continents on a row, a squarified treemap inside each ────────────

/** A rectangle on the ground: x across, z toward the viewer, w × d. */
export interface Rect {
  x: number
  z: number
  w: number
  d: number
}

export interface PlotInput {
  key: string
  continent: ContinentId
  size: number
}

export interface LaidContinent {
  id: ContinentId
  rect: Rect
  /** The plots' summed size. */
  total: number
  count: number
}

export interface LaidPlot {
  key: string
  market: string
  continent: ContinentId
  /** The treemap's cell, before the gutter (areas ∝ size). */
  cell: Rect
  /** The drawn plot: the cell inset by the gutter. */
  rect: Rect
}

export interface WorldLayout {
  continents: LaidContinent[]
  plots: LaidPlot[]
  /** The world's bounds, centred on the origin. */
  width: number
  depth: number
}

export interface LayoutOpts {
  /** The biggest continent's side, in world units. */
  maxSide?: number
  /** A continent is never narrower than this share of the biggest. */
  minSideShare?: number
  /** Between continents. */
  gap?: number
  /** A continent's shore: its plots sit this far inside its slab. */
  shore?: number
  /** Between plots (each side gives half), capped by the plot's own size. */
  gutter?: number
}

export const LAYOUT_DEFAULTS: Required<LayoutOpts> = { maxSide: 120, minSideShare: 0.3, gap: 14, shore: 2.5, gutter: 0.5 }
/** Past this many non-empty continents the world wraps to two rows. */
export const ONE_ROW_MAX = 4

/** Size desc, then name: the order every layout is built in. */
function byPlotOrder(a: { key: string; size: number }, b: { key: string; size: number }): number {
  return b.size - a.size || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
}

/**
 * Squarified treemap (Bruls, Huizing, van Wijk) over `rect`, in the order
 * given (callers sort size desc, name). Every cell's area is its weight's
 * share of the rect, exactly; deterministic for a given input.
 */
export function squarify<T>(items: readonly { item: T; weight: number }[], rect: Rect): { item: T; rect: Rect }[] {
  const total = items.reduce((s, i) => s + (i.weight > 0 ? i.weight : 0), 0)
  if (!items.length || total <= 0 || rect.w <= 0 || rect.d <= 0) return []
  const area = rect.w * rect.d
  const scaled = items.filter((i) => i.weight > 0).map((i) => ({ item: i.item, a: (i.weight / total) * area }))
  const out: { item: T; rect: Rect }[] = []
  let x = rect.x
  let z = rect.z
  let w = rect.w
  let d = rect.d
  let row: { item: T; a: number }[] = []
  let rowSum = 0
  const worst = (sum: number, mx: number, mn: number, side: number) => {
    if (sum <= 0) return Infinity
    const s2 = sum * sum
    const side2 = side * side
    return Math.max((side2 * mx) / s2, s2 / (side2 * mn))
  }
  let rowMax = 0
  let rowMin = Infinity
  const place = () => {
    const across = w >= d // the row runs along the shorter side
    if (across) {
      const rw = rowSum / d
      let cz = z
      for (const c of row) {
        const cd = c.a / rw
        out.push({ item: c.item, rect: { x, z: cz, w: rw, d: cd } })
        cz += cd
      }
      x += rw
      w -= rw
    } else {
      const rd = rowSum / w
      let cx = x
      for (const c of row) {
        const cw = c.a / rd
        out.push({ item: c.item, rect: { x: cx, z, w: cw, d: rd } })
        cx += cw
      }
      z += rd
      d -= rd
    }
    row = []
    rowSum = 0
    rowMax = 0
    rowMin = Infinity
  }
  for (const c of scaled) {
    const side = Math.min(w, d)
    if (row.length) {
      const now = worst(rowSum, rowMax, rowMin, side)
      const next = worst(rowSum + c.a, Math.max(rowMax, c.a), Math.min(rowMin, c.a), side)
      if (next > now) place()
    }
    row.push(c)
    rowSum += c.a
    if (c.a > rowMax) rowMax = c.a
    if (c.a < rowMin) rowMin = c.a
  }
  if (row.length) place()
  return out
}

/** A plot's drawn rect: the cell inset by the gutter (never more than a
 *  sixth of its own side, so a sliver stays a sliver, not nothing). */
export function insetRect(r: Rect, gutter: number): Rect {
  const gx = Math.min(gutter, r.w / 6)
  const gz = Math.min(gutter, r.d / 6)
  return { x: r.x + gx / 2, z: r.z + gz / 2, w: Math.max(0, r.w - gx), d: Math.max(0, r.d - gz) }
}

/**
 * The world: one square continent per venue that has plots, side ∝ √(its
 * plots' total size) (so its area ∝ the total), never under a share of the
 * biggest; one row of up to four, two rows past four (the first half of the
 * display order on the back row); inside each, a squarified treemap of its
 * plots by size, each inset by a gutter. Centred on the origin. Pure and
 * deterministic: the same plots in any order lay out the same.
 */
export function layoutWorld(plots: readonly PlotInput[], opts: LayoutOpts = {}): WorldLayout {
  const o = { ...LAYOUT_DEFAULTS, ...opts }
  const by = new Map<ContinentId, PlotInput[]>()
  for (const p of plots) {
    if (!(p.size > 0)) continue
    const arr = by.get(p.continent) ?? []
    arr.push(p)
    by.set(p.continent, arr)
  }
  const live = CONTINENTS.filter((c) => by.has(c.id))
  if (!live.length) return { continents: [], plots: [], width: 0, depth: 0 }
  const totals = live.map((c) => by.get(c.id)!.reduce((s, p) => s + p.size, 0))
  const maxRoot = Math.max(...totals.map((t) => Math.sqrt(t)))
  const sides = totals.map((t) => Math.max(o.maxSide * o.minSideShare, (Math.sqrt(t) / maxRoot) * o.maxSide))
  const rows: number[][] = live.length > ONE_ROW_MAX ? [live.slice(0, Math.ceil(live.length / 2)).map((_, i) => i), live.slice(Math.ceil(live.length / 2)).map((_, i) => i + Math.ceil(live.length / 2))] : [live.map((_, i) => i)]
  const rowW = rows.map((r) => r.reduce((s, i) => s + sides[i], 0) + o.gap * (r.length - 1))
  const rowD = rows.map((r) => Math.max(...r.map((i) => sides[i])))
  const width = Math.max(...rowW)
  const depth = rowD.reduce((s, d) => s + d, 0) + o.gap * (rows.length - 1)
  const continents: LaidContinent[] = []
  const laid: LaidPlot[] = []
  let z = -depth / 2
  rows.forEach((r, ri) => {
    let x = -rowW[ri] / 2
    for (const i of r) {
      const side = sides[i]
      const c = live[i]
      // Centred on the row's midline.
      const rect: Rect = { x, z: z + (rowD[ri] - side) / 2, w: side, d: side }
      const mine = [...by.get(c.id)!].sort(byPlotOrder)
      continents.push({ id: c.id, rect, total: totals[i], count: mine.length })
      const inner: Rect = { x: rect.x + o.shore, z: rect.z + o.shore, w: Math.max(0, rect.w - 2 * o.shore), d: Math.max(0, rect.d - 2 * o.shore) }
      for (const cell of squarify(mine.map((p) => ({ item: p, weight: p.size })), inner)) {
        const parsed = parsePlotKey(cell.item.key)
        laid.push({ key: cell.item.key, market: parsed?.market ?? cell.item.key, continent: c.id, cell: cell.rect, rect: insetRect(cell.rect, o.gutter) })
      }
      x += side + o.gap
    }
    z += rowD[ri] + o.gap
  })
  return { continents, plots: laid, width, depth }
}

// ── Stability: which plots, and when the land moves ──────────────────────────

/** The most plots the world draws (one instanced mesh). */
export const PLOT_CAP = 160
/** Seats held for markets that printed in the last minute and would
 *  otherwise be left out by size. */
export const RECENT_SEATS = 20
export const RECENT_PRINT_MS = 60_000
export const RELAYOUT_MIN_MS = 30_000
/** A plot's size moving more than this (either way) earns a relayout. */
export const RELAYOUT_SIZE_SHIFT = 0.35

export interface PlotCandidate {
  key: string
  size: number
  /** The newest print (ms). */
  lastAt: number
  pick: boolean
}

/**
 * Which plots the world draws, at most `cap`: the pick always; then the
 * biggest by size up to `cap − RECENT_SEATS`; then markets that printed in
 * the last minute, biggest first, if they fit; then the rest by size. Every
 * tie breaks by key. Returns keys in that order.
 */
export function selectPlots(cands: readonly PlotCandidate[], nowMs: number, cap = PLOT_CAP, recentSeats = RECENT_SEATS): string[] {
  const sorted = [...cands].sort(byPlotOrder)
  const out: string[] = []
  const taken = new Set<string>()
  const take = (k: string) => {
    if (taken.has(k) || out.length >= cap) return
    taken.add(k)
    out.push(k)
  }
  for (const c of sorted) if (c.pick) take(c.key)
  const bySizeTo = Math.max(out.length, cap - recentSeats)
  for (const c of sorted) {
    if (out.length >= bySizeTo) break
    take(c.key)
  }
  for (const c of sorted) if (nowMs - c.lastAt <= RECENT_PRINT_MS) take(c.key)
  for (const c of sorted) take(c.key)
  return out
}

/** The census: which plots hold land is re-decided this often (between
 *  censuses the set is fixed, so the land never reshuffles under a reader);
 *  faster while the world first fills. */
export const CENSUS_MS = 15_000
export const CENSUS_WARM_MS = 3_000
export const CENSUS_WARM_FOR_MS = 30_000

/** Is a census due? The first one is always due; then every CENSUS_MS, or
 *  CENSUS_WARM_MS during the first CENSUS_WARM_FOR_MS after the world opened. */
export function censusDue(lastAt: number | null, openedAt: number, nowMs: number): boolean {
  if (lastAt === null) return true
  const every = nowMs - openedAt < CENSUS_WARM_FOR_MS ? CENSUS_WARM_MS : CENSUS_MS
  return nowMs - lastAt >= every
}

export interface LayoutStamp {
  keys: readonly string[]
  sizes: ReadonlyMap<string, number>
  /** When this layout was made (ms). */
  at: number
}

/** Relayout when the plot set changed, or — no sooner than RELAYOUT_MIN_MS
 *  after the last — when any plot's size moved more than 35%. */
export function shouldRelayout(prev: LayoutStamp | null, next: { keys: readonly string[]; sizes: ReadonlyMap<string, number> }, nowMs: number): boolean {
  if (!prev) return next.keys.length > 0
  if (prev.keys.length !== next.keys.length) return true
  const was = new Set(prev.keys)
  for (const k of next.keys) if (!was.has(k)) return true
  if (nowMs - prev.at < RELAYOUT_MIN_MS) return false
  for (const k of next.keys) {
    const a = prev.sizes.get(k)
    const b = next.sizes.get(k)
    if (!a || !b) continue
    if (Math.abs(b / a - 1) > RELAYOUT_SIZE_SHIFT) return true
  }
  return false
}

// ── The leaderboard ──────────────────────────────────────────────────────────

export interface BoardRow {
  key: string
  market: string
  continent: ContinentId
  netUsd: number
  grossUsd: number
  movePct: number | null
  count: number
}

export type BoardBy = 'net' | 'gross' | 'move'

export function boardByFor(lens: FlyoverLens): BoardBy {
  return lens === 'flow' ? 'net' : lens === 'activity' ? 'gross' : 'move'
}

/** The two columns' heads, per lens. */
export function boardHeads(lens: FlyoverLens): { risers: string; sinkers: string } {
  if (lens === 'activity') return { risers: 'Busiest, buyers ahead', sinkers: 'Busiest, sellers ahead' }
  if (lens === 'move') return { risers: 'Up most', sinkers: 'Down most' }
  return { risers: 'Rising', sinkers: 'Sinking' }
}

const byKey = (a: BoardRow, b: BoardRow) => (a.market < b.market ? -1 : a.market > b.market ? 1 : a.key < b.key ? -1 : a.key > b.key ? 1 : 0)

/**
 * The winners and losers. `net`: risers are the biggest net buyers (> 0),
 * sinkers the biggest net sellers (< 0). `gross`: the busiest plots, split
 * by which side carried them (net ≥ 0 rides with the risers). `move`: the
 * biggest price moves up and down (no move = on neither). Ties by name.
 */
export function leaderboard(rows: readonly BoardRow[], n = 5, by: BoardBy = 'net'): { risers: BoardRow[]; sinkers: BoardRow[] } {
  if (by === 'gross') {
    const busy = rows.filter((r) => r.grossUsd > 0)
    return {
      risers: busy.filter((r) => r.netUsd >= 0).sort((a, b) => b.grossUsd - a.grossUsd || byKey(a, b)).slice(0, n),
      sinkers: busy.filter((r) => r.netUsd < 0).sort((a, b) => b.grossUsd - a.grossUsd || byKey(a, b)).slice(0, n),
    }
  }
  if (by === 'move') {
    const moved = rows.filter((r) => r.movePct !== null && Number.isFinite(r.movePct))
    return {
      risers: moved.filter((r) => r.movePct! > 0).sort((a, b) => b.movePct! - a.movePct! || byKey(a, b)).slice(0, n),
      sinkers: moved.filter((r) => r.movePct! < 0).sort((a, b) => a.movePct! - b.movePct! || byKey(a, b)).slice(0, n),
    }
  }
  return {
    risers: rows.filter((r) => r.netUsd > 0).sort((a, b) => b.netUsd - a.netUsd || byKey(a, b)).slice(0, n),
    sinkers: rows.filter((r) => r.netUsd < 0).sort((a, b) => a.netUsd - b.netUsd || byKey(a, b)).slice(0, n),
  }
}

// ── Labels ───────────────────────────────────────────────────────────────────

/** The biggest plots by area always wear their name. */
export const LABEL_ALWAYS_TOP = 40
/** …if they hold at least this share of the world's plot area. */
export const LABEL_MIN_SHARE = 0.0008

export interface LabelFlags {
  board?: boolean
  pick?: boolean
  hovered?: boolean
  pinned?: boolean
}

/** `always` for the top 40 by area (big enough to hold a name), the
 *  leaderboard's plots, the pick, and the hovered or pinned plot; `hover`
 *  for everything else. `rank` is 1-based by area. */
export function labelTier(areaShare: number, rank: number, flags: LabelFlags = {}): 'always' | 'hover' {
  if (flags.pinned || flags.hovered || flags.board || flags.pick) return 'always'
  return rank >= 1 && rank <= LABEL_ALWAYS_TOP && areaShare >= LABEL_MIN_SHARE ? 'always' : 'hover'
}

// ── Formats (ASCII) ──────────────────────────────────────────────────────────

/** Dollars in three significant figures: $950 · $86.3K · $230K · $1.29M. */
export function fmtUsd3(usd: number): string {
  if (!Number.isFinite(usd) || usd === 0) return '$0'
  const a = Math.abs(usd)
  const sign = usd < 0 ? '-' : ''
  const unit = (v: number, u: string) => {
    const s = v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)
    return `${sign}$${s}${u}`
  }
  if (a >= 1e9) return unit(a / 1e9, 'B')
  if (a >= 1e6) return unit(a / 1e6, 'M')
  if (a >= 1e3) return unit(a / 1e3, 'K')
  return `${sign}$${a >= 100 ? a.toFixed(0) : a.toFixed(2)}`
}

/** Net dollars with their sign: +$1.06M · -$230K · $0. */
export function fmtNet(usd: number): string {
  if (!Number.isFinite(usd) || usd === 0) return '$0'
  return usd > 0 ? `+${fmtUsd3(usd)}` : fmtUsd3(usd)
}

/** A percent with its sign, places by size: +0.04% · -1.20% · +0.004% · +12.3%. */
export function fmtPctAscii(pct: number | null): string {
  if (pct === null || !Number.isFinite(pct)) return 'n/a'
  const a = Math.abs(pct)
  if (a < 0.0005) return '0.00%'
  const places = a >= 10 ? 1 : a < 0.01 ? 3 : 2
  const sign = pct > 0 ? '+' : pct < 0 ? '-' : ''
  return `${sign}${a.toFixed(places)}%`
}

function commas(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** A price at its own precision, thousands grouped: 81,279 · 2,512.4 · 182.35 · 0.13248. */
export function fmtPx(p: number | null): string {
  if (p === null || !Number.isFinite(p) || p <= 0) return 'n/a'
  if (p >= 10_000) return commas(Math.round(p).toString())
  if (p >= 1_000) {
    const [i, f] = p.toFixed(1).split('.')
    return `${commas(i)}.${f}`
  }
  if (p >= 100) return p.toFixed(2)
  if (p >= 1) return String(+p.toFixed(4))
  return String(+p.toPrecision(4))
}

/** How long ago: 4s ago · 3m ago · 1h ago. */
export function fmtAgo(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  return `${Math.round(m / 60)}h ago`
}

// ── The readout: what the data knows about a plot, in sentences ──────────────

export interface PlotWhere {
  market: string
  continent: ContinentId
}

/**
 * The readout card's lines. ASCII only (a line may become a chip or a share
 * text). Every number is measured over the window; a field the feed does not
 * carry (the position effect on the venue's own socket) is left out, never
 * guessed.
 */
export function readoutLines(where: PlotWhere, s: PlotSums, w: FlyoverWindow, nowMs: number, size?: { dayVolumeUsd?: number | null; sessionUsd: number }): string[] {
  const def = continentDef(where.continent)
  const name = plotName(where.market)
  const out: string[] = [`${name} on ${def.label} (${def.blurb}), last ${w}`]
  if (s.count === 0) {
    out.push(`No fills in the last ${w}.`)
    return out.map(asciiOnly)
  }
  const buyPct = s.grossUsd > 0 ? Math.round((s.buyUsd / s.grossUsd) * 100) : 50
  out.push(`Bought ${fmtUsd3(s.buyUsd)}, sold ${fmtUsd3(s.sellUsd)}: net ${fmtNet(s.netUsd)} (${buyPct}% buys)`)
  if (s.movePct === null) out.push(`Price ${fmtPx(s.lastPx)} (one print so far, no move to measure yet)`)
  else out.push(`Price ${fmtPx(s.firstPx)} to ${fmtPx(s.lastPx)} (${fmtPctAscii(s.movePct)})`)
  const lg = s.largest
  out.push(`${s.count} fill${s.count === 1 ? '' : 's'}${lg ? `; largest ${fmtUsd3(lg.usd)} ${lg.side} ${fmtAgo(nowMs - lg.at)}` : ''}`)
  const e = s.effects
  const knownEffects = e['long-open'] + e['long-close'] + e['short-open'] + e['short-cover']
  if (def.kind === 'perp' && knownEffects > 0) {
    out.push(`Opened longs ${fmtUsd3(e['long-open'])}, closed longs ${fmtUsd3(e['long-close'])}, opened shorts ${fmtUsd3(e['short-open'])}, covered shorts ${fmtUsd3(e['short-cover'])}`)
  }
  if (size) {
    const basis = sizeBasis(size)
    out.push(
      basis === 'day'
        ? `Footprint: ${fmtUsd3(plotSize(size))} traded in 24h (the venue's own number)`
        : basis === 'session'
          ? `Footprint: ${fmtUsd3(size.sessionUsd)} seen here in 15m (x${SESSION_WEIGHT} for a day)`
          : `Footprint: the floor (${fmtUsd3(SIZE_FLOOR_USD)}), too few prints to size it`,
    )
  }
  return out.map(asciiOnly)
}

/** The belt for a line that must be ASCII: anything outside printable ASCII
 *  is dropped (a venue names a market `USD₮0`; a line says `USD0`). */
export function asciiOnly(s: string): string {
  return s.replace(/[^\x20-\x7e]/g, '').replace(/ {2,}/g, ' ').trim()
}

// ── The chips: whatever lib/tape followAsk answers, nothing more ─────────────

export interface PlotVenue {
  venue: TapeVenue
  chainId: number | null
}

/**
 * The sentences a plot offers: lib/tape followAsk for the buy side and the
 * sell side, verbatim (a perp gets Long and Short on Hyperliquid; a listed
 * stock perp the Robinhood Chain buy; a DEX coin the spot buy on its chain —
 * followAsk offers no spot sell, a sell needs a holding). The side carrying
 * the flow comes first. The page draws one only when canTradeAsk passes.
 */
export function plotAsks(market: string, s: Pick<PlotSums, 'netUsd'> | null, where: PlotVenue): FollowAsk[] {
  const sides: TapeSide[] = s && s.netUsd < 0 ? ['sell', 'buy'] : ['buy', 'sell']
  const out: FollowAsk[] = []
  for (const side of sides) {
    const f = followAsk({ market, side, venue: where.venue, chainId: where.chainId })
    if (f && !out.some((o) => o.ask === f.ask)) out.push(f)
  }
  return out
}

// ── The sky: big prints ──────────────────────────────────────────────────────

export const SKY_LOG_ROWS = 8

export function isBigPrint(fill: Pick<TapeFill, 'usd'>): boolean {
  return fill.usd >= DEFAULT_THRESHOLDS.bigPrintUsd
}

export interface SkyRow {
  id: string
  at: number
  market: string
  side: TapeSide
  usd: number
  price: number
  venue: TapeVenue
  chainId: number | null
}

/** A big print onto the log: newest first, one row per fill id, eight rows. */
export function pushSky(log: readonly SkyRow[], fill: TapeFill, max = SKY_LOG_ROWS): SkyRow[] {
  if (!isBigPrint(fill) || log.some((r) => r.id === fill.id)) return [...log]
  const row: SkyRow = { id: fill.id, at: fill.at, market: fill.market, side: fill.side, usd: fill.usd, price: fill.price, venue: fill.venue, chainId: fill.venue === 'dex' ? fill.chainId ?? null : null }
  return [row, ...log].sort((a, b) => b.at - a.at).slice(0, max)
}

/** `$86.3K bought BTC at 81,279 on HyperCore, 12s ago` — ASCII. */
export function skyLine(r: SkyRow, nowMs: number): string {
  const c = continentOf(r.venue, r.chainId, r.market)
  const where = c ? ` on ${continentDef(c).label}` : ''
  return asciiOnly(`${fmtUsd3(r.usd)} ${r.side === 'buy' ? 'bought' : 'sold'} ${plotName(r.market)} at ${fmtPx(r.price)}${where}, ${fmtAgo(nowMs - r.at)}`)
}

/** The meteor's own tag over the plot: `$86K BTC buy`. */
export function meteorTag(fill: Pick<TapeFill, 'usd' | 'market' | 'side'>): string {
  return asciiOnly(`${fmtUsd3(fill.usd)} ${plotName(fill.market)} ${fill.side}`)
}

// ── The legend: what every channel means, in words ───────────────────────────

/**
 * The legend's lines for a window and a lens. ASCII. The first line says
 * what height means in this lens, with the dollar ladder; then color,
 * footprint, the drops, the source, and the rule that nothing fires.
 */
export function LEGEND_LINES(w: FlyoverWindow, lens: FlyoverLens, source: TapeSource = 'dune'): string[] {
  const ladder = [1, 2, 3].map((s) => `${s} = ${fmtUsd3(storyUsd(s, w))}`).join(', ')
  const height =
    lens === 'flow'
      ? `Height = net taker flow over the last ${w}: buys raise the land, sells sink it below the sea. Stories: ${ladder}; each story is ten times the dollars of the one below.`
      : lens === 'activity'
        ? `Height = everything traded (buys plus sells) over the last ${w}, no sea. Stories: ${ladder}.`
        : `Height = the price move over the last ${w}: up stands above the sea, down sinks below it; ${MOVE_STORIES} stories = ${fmtPctAscii(MOVE_CLAMP_PCT[w])} or more.`
  return [
    height,
    `Color = the price move over the same ${w}: green up, red down, full color at ${fmtPctAscii(MOVE_CLAMP_PCT[w]).replace('+', '+/-')}; grey = no move yet.`,
    `Footprint = size: the venue's own 24h volume where it gives one (HyperCore), else ${SESSION_WEIGHT}x the last 15 minutes seen here, never under ${fmtUsd3(SIZE_FLOOR_USD)}.`,
    `A drop is one fill (green buy, red sell, bigger = more dollars); a meteor is one fill of ${fmtUsd3(DEFAULT_THRESHOLDS.bigPrintUsd)} or more.`,
    source === 'dune'
      ? 'Fills: Dune real-time feeds, live (HyperCore, Lighter, Lighter Robinhood, and the DEX trial on Base, Ethereum and Arbitrum).'
      : "Fills: Hyperliquid's own trades socket (the relay has no Dune key here); HyperCore only, no position effect.",
    'Every plot is a sentence your wallet can sign - nothing fires on its own.',
  ].map(asciiOnly)
}
