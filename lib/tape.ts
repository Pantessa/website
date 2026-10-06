// The live tape (2026-10-06): every print is a button.
//
// Dune's HyperCore "Live feed" (Mats, 2026-09-24) is the shape: USD notional
// per second split by taker flow, five tiles (trades/s, notional/min, the
// largest print, the hot market, the taker-flow split), and a tape of fills
// with the taker's position EFFECT and the block. It reads. Pantessa's
// difference is the signature at the end of every row: the same sentences
// the symbol pages compose ("Long $25 of HYPE on Hyperliquid", "Buy $25 of
// INTC") hang off every fill and every trigger, and the wallet signs them
// through the ask door — nothing on this page ever moves money by itself.
//
// This module is the pure half: fill shapes, the flow classes, the per-second
// buckets, the tiles, the follow asks, the trigger rules, the market pick.
// No browser, no network. lib/tape-feed.ts is the streaming half (the
// Hyperliquid WebSocket today; the Dune adapter slot beside it), and
// components/live/LiveFeed.tsx draws it. Pinned by scripts/tape-pins.ts.
//
// Rules the chart work taught (HANDOFF-battlefield): every pixel is a
// number; measured and estimated never mix — a field a feed does not carry
// is shown as missing, never guessed (the HL stream has no position effect
// and no block; those two columns are what a position-aware stream adds).

import { chartPairFor, isChartedStock } from '@/lib/charts'

/** The taker's direction: a buy lifted the ask, a sell hit the bid. */
export type TapeSide = 'buy' | 'sell'

/** What the fill did to the taker's position — Dune's vocabulary. Only a
 *  position-aware stream knows it; the venue's own trade feed does not. */
export type TapeEffect = 'open' | 'increase' | 'decrease' | 'close' | 'flip'

export type TapeSource = 'hyperliquid' | 'dune'

export interface TapeFill {
  /** The venue's own id (HL `tid`), the dedupe key across reconnects. */
  id: string
  /** The venue's market name: `HYPE`, `BTC`, or a HIP-3 dex market like `xyz:SNDK`. */
  market: string
  side: TapeSide
  size: number
  price: number
  /** size × price, in dollars (every HL perp quotes in USDC). */
  usd: number
  /** Milliseconds since the epoch, the venue's stamp. */
  at: number
  /** The address the venue names as the aggressor, when it names one. */
  taker: string | null
  maker: string | null
  /** The L1 transaction hash, when the venue gives a real one. */
  hash: string | null
  effect: TapeEffect | null
  block: number | null
  source: TapeSource
}

/** What a feed carries. Rendered as columns when true, named as missing when
 *  false — never inferred. */
export interface TapeFields {
  effect: boolean
  block: boolean
}

// ── Flow classes ─────────────────────────────────────────────────────────────

/** Dune's four when the effect is known; the taker side alone otherwise. */
export type FlowClass = 'long-open' | 'short-cover' | 'long-close' | 'short-open' | 'buy' | 'sell'

export const FLOW_CLASSES: readonly FlowClass[] = ['long-open', 'short-cover', 'long-close', 'short-open', 'buy', 'sell']

export const FLOW_LABEL: Record<FlowClass, string> = {
  'long-open': 'long open',
  'short-cover': 'short cover',
  'long-close': 'long close',
  'short-open': 'short open',
  buy: 'taker buys',
  sell: 'taker sells',
}

/** The four classes stack in this order (bottom → top), buys under sells. */
export const FLOW_STACK: readonly FlowClass[] = ['long-open', 'short-cover', 'buy', 'long-close', 'short-open', 'sell']

export function flowClassOf(fill: Pick<TapeFill, 'side' | 'effect'>): FlowClass {
  const e = fill.effect
  if (!e) return fill.side
  if (fill.side === 'buy') return e === 'close' || e === 'decrease' ? 'short-cover' : 'long-open'
  return e === 'close' || e === 'decrease' ? 'long-close' : 'short-open'
}

/** Up-ink or down-ink, and whether it is the strong or the soft shade. */
export function flowTone(cls: FlowClass): { dir: 'up' | 'down'; strong: boolean } {
  switch (cls) {
    case 'long-open':
      return { dir: 'up', strong: true }
    case 'short-cover':
      return { dir: 'up', strong: false }
    case 'buy':
      return { dir: 'up', strong: true }
    case 'long-close':
      return { dir: 'down', strong: false }
    case 'short-open':
      return { dir: 'down', strong: true }
    case 'sell':
      return { dir: 'down', strong: true }
  }
}

// ── Markets ──────────────────────────────────────────────────────────────────

export interface TapeMarket {
  /** The venue's name as subscribed (`HYPE`, `xyz:SNDK`). */
  name: string
  /** The dex prefix (`xyz`) or null for the main perp book. */
  dex: string | null
  /** The bare ticker (`SNDK`). */
  ticker: string
  kind: 'coin' | 'stock' | 'other'
  /** The symbol page for it, when one exists. */
  href: string | null
}

const TICKER_RE = /^[A-Z][A-Z0-9]{0,11}$/

export function tapeMarket(name: string): TapeMarket {
  const i = name.indexOf(':')
  const dex = i > 0 ? name.slice(0, i) : null
  const ticker = i > 0 ? name.slice(i + 1) : name
  const pair = TICKER_RE.test(ticker) ? chartPairFor(ticker) : null
  if (dex) {
    const stock = TICKER_RE.test(ticker) && isChartedStock(ticker)
    return { name, dex, ticker, kind: stock ? 'stock' : 'other', href: stock ? `/t/${ticker}` : null }
  }
  return { name, dex: null, ticker, kind: 'coin', href: pair ? `/t/${pair.symbol}` : null }
}

export interface UniverseRow {
  name: string
  /** The venue's 24h notional volume in dollars. */
  volumeUsd: number
  delisted?: boolean
}

export interface MarketPick {
  main: number
  xyz: number
}

export const DEFAULT_PICK: MarketPick = { main: 14, xyz: 8 }

/**
 * Which markets the tape subscribes to: the busiest main-book perps and the
 * busiest xyz (stock) perps by the venue's own 24h volume. Delisted rows and
 * the dex's index product (`xyz:XYZ100`) never make the list. A feed that
 * fails to answer leaves the caller on FALLBACK_MARKETS.
 */
export function pickTapeMarkets(main: readonly UniverseRow[], xyz: readonly UniverseRow[], pick: MarketPick = DEFAULT_PICK): string[] {
  const live = (rows: readonly UniverseRow[]) => rows.filter((r) => !r.delisted && Number.isFinite(r.volumeUsd) && r.volumeUsd > 0 && !/:XYZ100$/.test(r.name))
  const top = (rows: readonly UniverseRow[], n: number) => [...live(rows)].sort((a, b) => b.volumeUsd - a.volumeUsd).slice(0, n).map((r) => r.name)
  return [...top(main, pick.main), ...top(xyz, pick.xyz)]
}

/** What the page runs on when the universe read fails (the venue's biggest
 *  books, 2026-10-06, and the xyz stocks Dune's own clip showed). */
export const FALLBACK_MARKETS: readonly string[] = ['BTC', 'ETH', 'HYPE', 'SOL', 'XRP', 'DOGE', 'UNI', 'AAVE', 'NEAR', 'SUI', 'xyz:TSLA', 'xyz:NVDA', 'xyz:INTC', 'xyz:SNDK', 'xyz:AAPL', 'xyz:HOOD']

// ── Parsing a venue's row ────────────────────────────────────────────────────

/** Hyperliquid's `trades` WebSocket row. `users` is `[buyer, seller]`; the
 *  side is the TAKER's: `B` lifted the ask, so the buyer is the aggressor. */
export interface HlWsTrade {
  coin: string
  side: 'A' | 'B'
  px: string
  sz: string
  time: number
  hash?: string
  tid: number | string
  users?: [string, string]
}

const ZERO_HASH = /^0x0+$/

export function fillFromHl(t: HlWsTrade): TapeFill | null {
  const price = Number(t.px)
  const size = Number(t.sz)
  if (!t.coin || !Number.isFinite(price) || !Number.isFinite(size) || price <= 0 || size <= 0) return null
  if (t.side !== 'A' && t.side !== 'B') return null
  const side: TapeSide = t.side === 'B' ? 'buy' : 'sell'
  const users = Array.isArray(t.users) && t.users.length === 2 ? t.users : null
  const taker = users ? (side === 'buy' ? users[0] : users[1]) : null
  const maker = users ? (side === 'buy' ? users[1] : users[0]) : null
  const hash = t.hash && !ZERO_HASH.test(t.hash) ? t.hash : null
  return {
    id: `hl:${t.tid}`,
    market: t.coin,
    side,
    size,
    price,
    usd: size * price,
    at: Number(t.time),
    taker: taker?.toLowerCase() ?? null,
    maker: maker?.toLowerCase() ?? null,
    hash,
    effect: null,
    block: null,
    source: 'hyperliquid',
  }
}

/**
 * The row shape the Dune adapter expects — the columns of Dune's own feed
 * (market · side · size · price · notional · effect · time · taker · block),
 * so wiring their stream is a field map, not a rewrite. Anything the row
 * does not carry is null, never guessed.
 */
export interface DuneStreamRow {
  market: string
  side: 'buy' | 'sell' | 'B' | 'A'
  size: number | string
  price: number | string
  notional?: number | string
  effect?: string | null
  time: number | string
  taker?: string | null
  maker?: string | null
  tx_hash?: string | null
  block?: number | string | null
  id?: string | number
}

const EFFECTS = new Set<TapeEffect>(['open', 'increase', 'decrease', 'close', 'flip'])

export function fillFromDune(r: DuneStreamRow): TapeFill | null {
  const price = Number(r.price)
  const size = Number(r.size)
  if (!r.market || !Number.isFinite(price) || !Number.isFinite(size) || price <= 0 || size <= 0) return null
  const side: TapeSide | null = r.side === 'buy' || r.side === 'B' ? 'buy' : r.side === 'sell' || r.side === 'A' ? 'sell' : null
  if (!side) return null
  const at = typeof r.time === 'number' ? r.time : Date.parse(String(r.time))
  if (!Number.isFinite(at)) return null
  const effect = typeof r.effect === 'string' && EFFECTS.has(r.effect.toLowerCase() as TapeEffect) ? (r.effect.toLowerCase() as TapeEffect) : null
  const block = r.block == null ? null : Number(r.block)
  const notional = r.notional == null ? NaN : Number(r.notional)
  return {
    id: `dune:${r.id ?? `${r.market}:${at}:${r.taker ?? ''}:${size}`}`,
    market: r.market,
    side,
    size,
    price,
    usd: Number.isFinite(notional) && notional > 0 ? notional : size * price,
    at,
    taker: r.taker?.toLowerCase() ?? null,
    maker: r.maker?.toLowerCase() ?? null,
    hash: r.tx_hash && !ZERO_HASH.test(r.tx_hash) ? r.tx_hash : null,
    effect,
    block: block != null && Number.isFinite(block) ? block : null,
    source: 'dune',
  }
}

// ── The buffer ───────────────────────────────────────────────────────────────

/** How much tape the page keeps: the flow window plus the trigger windows. */
export const TAPE_KEEP_MS = 180_000
export const TAPE_MAX_FILLS = 4_000

/**
 * Merge a batch into the buffer (newest first), dropping duplicates by id
 * and anything older than the keep window. A fill stamped in the future
 * (a client clock behind the venue's) is kept — the venue's clock rules.
 */
export function mergeFills(buffer: readonly TapeFill[], incoming: readonly TapeFill[], nowMs: number): TapeFill[] {
  const seen = new Set(buffer.map((f) => f.id))
  const fresh: TapeFill[] = []
  for (const f of incoming) {
    if (seen.has(f.id)) continue
    seen.add(f.id) // a batch with its own duplicates is deduped too
    fresh.push(f)
  }
  const floor = nowMs - TAPE_KEEP_MS
  const out = [...fresh, ...buffer].filter((f) => f.at >= floor)
  out.sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1))
  return out.length > TAPE_MAX_FILLS ? out.slice(0, TAPE_MAX_FILLS) : out
}

// ── Per-second flow ──────────────────────────────────────────────────────────

export interface FlowBucket {
  /** Unix seconds. */
  sec: number
  usd: Record<FlowClass, number>
  total: number
  count: number
}

export const FLOW_WINDOW_SEC = 120

/** The last `windowSec` seconds ending at the current second, every second
 *  present (an empty one is a zero bar, not a gap). */
export function flowBuckets(fills: readonly TapeFill[], nowMs: number, windowSec = FLOW_WINDOW_SEC, market: string | null = null): FlowBucket[] {
  const end = Math.floor(nowMs / 1000)
  const start = end - windowSec + 1
  const empty = (): Record<FlowClass, number> => ({ 'long-open': 0, 'short-cover': 0, 'long-close': 0, 'short-open': 0, buy: 0, sell: 0 })
  const buckets: FlowBucket[] = []
  for (let s = start; s <= end; s++) buckets.push({ sec: s, usd: empty(), total: 0, count: 0 })
  for (const f of fills) {
    if (market && f.market !== market) continue
    const s = Math.floor(f.at / 1000)
    if (s < start || s > end) continue
    const b = buckets[s - start]
    b.usd[flowClassOf(f)] += f.usd
    b.total += f.usd
    b.count++
  }
  return buckets
}

/** A round axis top for the tallest bar: 1 · 2 · 2.5 · 5 × 10ⁿ, never zero. */
export function niceCeil(max: number): number {
  if (!(max > 0)) return 1
  const p = Math.pow(10, Math.floor(Math.log10(max)))
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= max) return m * p
  return 10 * p
}

// ── The tiles ────────────────────────────────────────────────────────────────

export interface TapeStats {
  /** Fills per second over the last ten seconds. */
  tradesPerSec: number
  /** Dollars over the last sixty seconds. */
  notionalPerMin: number
  largestPrint: TapeFill | null
  hotMarket: { market: string; usd: number } | null
  takerFlow: { buyUsd: number; sellUsd: number; buyPct: number | null }
}

export function tapeStats(fills: readonly TapeFill[], nowMs: number, market: string | null = null): TapeStats {
  const tenAgo = nowMs - 10_000
  const minAgo = nowMs - 60_000
  let ten = 0
  let notional = 0
  let largest: TapeFill | null = null
  let buyUsd = 0
  let sellUsd = 0
  const byMarket = new Map<string, number>()
  for (const f of fills) {
    if (market && f.market !== market) continue
    if (f.at < minAgo) continue
    if (f.at >= tenAgo) ten++
    notional += f.usd
    if (!largest || f.usd > largest.usd) largest = f
    if (f.side === 'buy') buyUsd += f.usd
    else sellUsd += f.usd
    byMarket.set(f.market, (byMarket.get(f.market) ?? 0) + f.usd)
  }
  let hot: { market: string; usd: number } | null = null
  for (const [m, usd] of byMarket) if (!hot || usd > hot.usd) hot = { market: m, usd }
  const flow = buyUsd + sellUsd
  return {
    tradesPerSec: Math.round(ten / 10),
    notionalPerMin: notional,
    largestPrint: largest,
    hotMarket: hot,
    takerFlow: { buyUsd, sellUsd, buyPct: flow > 0 ? Math.round((buyUsd / flow) * 100) : null },
  }
}

// ── Follow asks: the button on every row ─────────────────────────────────────

export const FOLLOW_USD = 25

export interface FollowAsk {
  ask: string
  label: string
  tone: 'buy' | 'sell'
  /** The venue the sentence runs on. */
  venue: 'hyperliquid' | 'robinhood'
}

/**
 * The sentence that does what this fill did, in the grammar the symbol
 * pages already compose (lib/trade-asks composeExecAsk shapes, kept here
 * verbatim so the harness can pin them without a React import):
 *   • a main-book coin → `Long $25 of HYPE on Hyperliquid` / `Short …`
 *   • an xyz stock the house lists on Robinhood Chain → `Buy $25 of INTC`
 *     (our Hyperliquid layer runs the main book only; the spot stock is the
 *     honest twin). A stock SELL needs a position, so it offers nothing —
 *     the sell gate's rule.
 *   • anything else (a k-prefixed 1000× coin, gold, FX) → null.
 * The caller still asks canTradeAsk before drawing it.
 */
export function followAsk(fill: Pick<TapeFill, 'market' | 'side'>, usd = FOLLOW_USD): FollowAsk | null {
  const m = tapeMarket(fill.market)
  if (m.kind === 'coin') {
    if (!TICKER_RE.test(m.ticker)) return null
    return fill.side === 'buy'
      ? { ask: `Long $${usd} of ${m.ticker} on Hyperliquid`, label: `Long ${m.ticker}`, tone: 'buy', venue: 'hyperliquid' }
      : { ask: `Short $${usd} of ${m.ticker} on Hyperliquid`, label: `Short ${m.ticker}`, tone: 'sell', venue: 'hyperliquid' }
  }
  if (m.kind === 'stock' && fill.side === 'buy') {
    return { ask: `Buy $${usd} of ${m.ticker}`, label: `Buy ${m.ticker}`, tone: 'buy', venue: 'robinhood' }
  }
  return null
}

// ── Triggers: a rule on the stream arms a ready-to-sign ask ──────────────────

export type TriggerRule = 'big-print' | 'whale-repeat' | 'flow-skew'

export interface TriggerEvent {
  /** Stable per occurrence: the same event never fires twice. */
  id: string
  rule: TriggerRule
  at: number
  market: string
  /** One sentence, past tense, every number measured. */
  text: string
  usd: number
  side: TapeSide
  follow: FollowAsk | null
}

export interface TriggerThresholds {
  /** A single fill this big. */
  bigPrintUsd: number
  /** One taker, one market: this many fills inside the window, this much in total. */
  whaleFills: number
  whaleWindowMs: number
  whaleUsd: number
  /** One market, the last minute: this share of notional on one side, over this many fills. */
  skewPct: number
  skewMinFills: number
}

export const DEFAULT_THRESHOLDS: TriggerThresholds = {
  bigPrintUsd: 50_000,
  whaleFills: 3,
  whaleWindowMs: 10_000,
  whaleUsd: 10_000,
  skewPct: 70,
  skewMinFills: 20,
}

export const TRIGGER_LABEL: Record<TriggerRule, string> = {
  'big-print': 'Big print',
  'whale-repeat': 'One taker, repeatedly',
  'flow-skew': 'One-sided minute',
}

export function triggerDetail(rule: TriggerRule, t: TriggerThresholds): string {
  switch (rule) {
    case 'big-print':
      return `a single fill of ${fmtUsd(t.bigPrintUsd)} or more`
    case 'whale-repeat':
      return `the same taker fills ${t.whaleFills}+ times in ${Math.round(t.whaleWindowMs / 1000)}s, ${fmtUsd(t.whaleUsd)}+ in all`
    case 'flow-skew':
      return `${t.skewPct}%+ of a market's last minute on one side, over ${t.skewMinFills}+ fills`
  }
}

/**
 * Evaluate the rules over the buffer. `seen` carries event ids across calls
 * so a rule fires once per occurrence; new events come back newest first.
 * Pure: the caller owns `seen` and the clock.
 */
export function detectTriggers(fills: readonly TapeFill[], nowMs: number, seen: Set<string>, t: TriggerThresholds = DEFAULT_THRESHOLDS): TriggerEvent[] {
  const out: TriggerEvent[] = []
  const minAgo = nowMs - 60_000
  const push = (e: TriggerEvent) => {
    if (seen.has(e.id)) return
    seen.add(e.id)
    out.push(e)
  }
  // Big prints: every fill at or over the bar, once.
  for (const f of fills) {
    if (f.at < minAgo) break
    if (f.usd >= t.bigPrintUsd) {
      push({ id: `big:${f.id}`, rule: 'big-print', at: f.at, market: f.market, usd: f.usd, side: f.side, follow: followAsk(f), text: `${fmtUsd(f.usd)} ${f.side === 'buy' ? 'bought' : 'sold'} on ${f.market} in one fill at ${fmtPrice(f.price)}.` })
    }
  }
  // Whale repeat: group the last window by taker + market.
  const groups = new Map<string, TapeFill[]>()
  for (const f of fills) {
    if (f.at < nowMs - t.whaleWindowMs) break
    if (!f.taker) continue
    const k = `${f.taker}|${f.market}`
    const g = groups.get(k)
    if (g) g.push(f)
    else groups.set(k, [f])
  }
  for (const [k, g] of groups) {
    if (g.length < t.whaleFills) continue
    const usd = g.reduce((s, f) => s + f.usd, 0)
    if (usd < t.whaleUsd) continue
    const buys = g.filter((f) => f.side === 'buy').reduce((s, f) => s + f.usd, 0)
    const side: TapeSide = buys * 2 >= usd ? 'buy' : 'sell'
    const newest = g[0]
    const bucket = Math.floor(newest.at / t.whaleWindowMs)
    push({ id: `whale:${k}:${bucket}`, rule: 'whale-repeat', at: newest.at, market: newest.market, usd, side, follow: followAsk({ market: newest.market, side }), text: `${fmtAddr(newest.taker!)} ${side === 'buy' ? 'bought' : 'sold'} ${fmtUsd(usd)} of ${newest.market} across ${g.length} fills in ${Math.round(t.whaleWindowMs / 1000)}s.` })
  }
  // Flow skew: per market over the last minute.
  const perMarket = new Map<string, { n: number; buy: number; sell: number; at: number }>()
  for (const f of fills) {
    if (f.at < minAgo) break
    const r = perMarket.get(f.market) ?? { n: 0, buy: 0, sell: 0, at: f.at }
    r.n++
    if (f.side === 'buy') r.buy += f.usd
    else r.sell += f.usd
    if (f.at > r.at) r.at = f.at
    perMarket.set(f.market, r)
  }
  for (const [market, r] of perMarket) {
    if (r.n < t.skewMinFills) continue
    const total = r.buy + r.sell
    if (!(total > 0)) continue
    const buyPct = (r.buy / total) * 100
    const side: TapeSide | null = buyPct >= t.skewPct ? 'buy' : 100 - buyPct >= t.skewPct ? 'sell' : null
    if (!side) continue
    const pct = Math.round(side === 'buy' ? buyPct : 100 - buyPct)
    const minute = Math.floor(nowMs / 60_000)
    push({ id: `skew:${market}:${side}:${minute}`, rule: 'flow-skew', at: r.at, market, usd: total, side, follow: followAsk({ market, side }), text: `${pct}% of ${fmtUsd(total)} on ${market} in the last minute was ${side === 'buy' ? 'buying' : 'selling'}, over ${r.n} fills.` })
  }
  out.sort((a, b) => b.at - a.at)
  return out
}

// ── Formatting ───────────────────────────────────────────────────────────────

/** Dollars the way a tape prints them: $898.53 · $1.53K · $83.85K · $1.2M. */
export function fmtUsd(usd: number): string {
  if (!Number.isFinite(usd)) return '—'
  const abs = Math.abs(usd)
  if (abs >= 1e9) return `$${(usd / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `$${(usd / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `$${(usd / 1e3).toFixed(2)}K`
  return `$${usd.toFixed(2)}`
}

/** An axis label: 200K · 1M · 1.2M. */
export function fmtAxisUsd(usd: number): string {
  if (usd >= 1e6) return `${+(usd / 1e6).toFixed(1)}M`
  if (usd >= 1e3) return `${+(usd / 1e3).toFixed(0)}K`
  return `${Math.round(usd)}`
}

/** A price at its own precision: 86047.0 · 1762.0 · 0.13248 · 0.008636. */
export function fmtPrice(p: number): string {
  if (!Number.isFinite(p)) return '—'
  if (p >= 1000) return p.toFixed(1)
  if (p >= 100) return p.toFixed(2)
  if (p >= 1) return String(+p.toFixed(4))
  return String(+p.toPrecision(4))
}

/** A size with the venue's precision kept, trailing zeros gone. */
export function fmtSize(s: number): string {
  if (!Number.isFinite(s)) return '—'
  if (s >= 1000) return s.toFixed(0)
  if (s >= 1) return String(+s.toFixed(4))
  return String(+s.toPrecision(3))
}

/** `0x98da_f13b` — the tape's address shorthand. */
export function fmtAddr(a: string): string {
  return a.length > 12 ? `${a.slice(0, 6)}_${a.slice(-4)}` : a
}

/** `10:03:28.859` in the viewer's clock. */
export function fmtClock(ms: number, tz?: string): string {
  const d = new Date(ms)
  const hms = d.toLocaleTimeString('en-GB', { hour12: false, timeZone: tz })
  return `${hms}.${String(d.getMilliseconds()).padStart(3, '0')}`
}

/** `09:02:14` for the axis. */
export function fmtAxisClock(sec: number, tz?: string): string {
  return new Date(sec * 1000).toLocaleTimeString('en-GB', { hour12: false, timeZone: tz })
}
