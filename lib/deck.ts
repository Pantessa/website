// THE DECK (2026-10-13 — Nate: "make it easier to find tape, the front, the
// siege … a little option called Streaming Order book that the user can flick
// and see the streams coming"): the pure half of the band at the top of `/`.
//
// The pulse band grew a BAR of four channels — Pulse · Tape · The Front · The
// Siege — and a STAGE that plays the picked one. The Map stays on /live (the
// brief). A channel is a real link to its page on /live (a URL never fires a
// turn; pasted, prefetched or with JS off it still opens the page) that, on
// the deck, switches the stage in place. The STREAMING ORDER BOOK is a switch
// at the bar's right end: on, the stage splits and a ladder of the venue's
// resting orders takes the third — asks above the mid, bids below, the prints
// the channel's feed carries landing on the rung they hit. The ladder follows
// the channel's market (the pulse's picked chip, else the hot market, else the
// leading army): Hyperliquid's l2Book, the book of the instrument every chip
// on the band trades (measured 2026-10-13: the keyless socket answers the
// main-book perps AND the xyz: stock dex, twenty rungs a side).
//
// This module holds the rules and nothing that touches a browser: the
// channels, the doors, the switch's memory, which market the ladder follows,
// the ladder's bins, the prints, the words, the heights the SSR frame is drawn
// at. Pinned by scripts/deck-pins.ts; drawn by components/home/Deck.tsx.

import { LIVE_VIEWS, type LiveView } from '@/lib/battle'
import { chartPairFor } from '@/lib/charts'
import { PRINT_FADE_MS, bookWords, cumulate, type BookFeedStatus, type DepthBook, type DepthLevel } from '@/lib/depth'
import { PULSE_VENUE_WORD, pulseLiveHref, pulseStatusWords } from '@/lib/pulse'
import { tapeMarket, type TapeFill, type TapeSource } from '@/lib/tape'
import type { FeedStatus } from '@/lib/tape-feed'

// ── The channels ─────────────────────────────────────────────────────────────

export type DeckChannel = 'pulse' | 'tape' | 'front' | 'siege' | 'flyover'

export interface DeckChannelDef {
  id: DeckChannel
  /** The word on the bar (lib/battle LIVE_VIEWS' own label for a view). */
  label: string
  /** One line under the word. */
  blurb: string
  /** The /live view the channel is a door to. */
  view: LiveView
  /** The foot's door, in words. */
  door: string
}

/** Five channels, in bar order. The Map is deliberately not one (Nate,
 *  2026-10-13: "no need to add the map as an option on the home"); The
 *  Flyover joined 2026-10-15 (Nate: "add the flyover to the tab"). */
export const DECK_CHANNELS: readonly DeckChannelDef[] = [
  { id: 'pulse', label: 'Pulse', blurb: 'the market, per second', view: 'tape', door: 'Open the live tape' },
  { id: 'tape', label: 'Tape', blurb: 'every print is a button', view: 'tape', door: 'Open the full tape' },
  { id: 'front', label: 'The Front', blurb: 'time × percent, the armies', view: 'front', door: 'Open The Front' },
  { id: 'siege', label: 'The Siege', blurb: 'the polar arena', view: 'siege', door: 'Open The Siege' },
  { id: 'flyover', label: 'The Flyover', blurb: 'every market as land', view: 'flyover', door: 'Open The Flyover' },
]

export const DECK_DEFAULT_CHANNEL: DeckChannel = 'pulse'

export function parseDeckChannel(raw: string | null | undefined): DeckChannel {
  return DECK_CHANNELS.some((c) => c.id === raw) ? (raw as DeckChannel) : DECK_DEFAULT_CHANNEL
}

export function deckChannel(id: DeckChannel): DeckChannelDef {
  return DECK_CHANNELS.find((c) => c.id === id) ?? DECK_CHANNELS[0]
}

export function isDeckBattle(id: DeckChannel): id is 'front' | 'siege' {
  return id === 'front' || id === 'siege'
}

/** A channel that plays a /live view at /live's own size (2026-10-15 — Nate:
 *  "when the user clicks on the tabs … tape, the front … make the chart
 *  larger, same size as we do on the live page"). Only the pulse keeps the
 *  band's height: it is the SSR frame, and the first board row must stay
 *  inside the phone's first screen. */
export function isDeckFullSize(id: DeckChannel): boolean {
  return id !== 'pulse'
}

/** Where a channel's door goes. The tape doors carry the pulse's pick as
 *  /live's `?m=` (lib/pulse pulseLiveHref); the battle doors are the views'
 *  own URLs (lib/battle LIVE_VIEWS). */
export function deckHref(ch: DeckChannel, pick: string | null = null): string {
  const def = deckChannel(ch)
  if (def.view === 'tape') return pulseLiveHref(pick)
  return `/live?view=${def.view}`
}

/** The battle views the deck names exist on /live under the same label. */
export function deckChannelsMatchViews(): boolean {
  return DECK_CHANNELS.every((c) => LIVE_VIEWS.some((v) => v.id === c.view && (c.view === 'tape' || v.label === c.label)))
}

// ── The switch ───────────────────────────────────────────────────────────────

/** Per-viewer convenience: whether the book was on, in this browser only. Read
 *  after mount — the server frame always starts with the book off. */
export const DECK_BOOK_KEY = 'pantessa.home.book.v1'

export function parseDeckBook(raw: string | null | undefined): boolean {
  return raw === 'on'
}

export function serializeDeckBook(on: boolean): string {
  return on ? 'on' : 'off'
}

// ── Which market the ladder follows ──────────────────────────────────────────

const MARKET_RE = /^[A-Za-z0-9:]{1,24}$/

/** The first usable venue market among the candidates, in the caller's order
 *  (the pulse's picked chip first, then the channel's hot market or leading
 *  army); null until a channel has measured one. */
export function deckBookMarket(candidates: readonly (string | null | undefined)[]): string | null {
  for (const c of candidates) if (c && MARKET_RE.test(c)) return c
  return null
}

/** The ladder's door: the market's symbol page with the Depth view when the
 *  page has a book to show (a coin Coinbase lists, a Hyperliquid perp), the
 *  plain page for a tokenized stock (it trades against a pool, no resting
 *  book on Robinhood Chain), nothing for a market with no page (gold, FX, an
 *  index, a k-prefixed coin). */
export function deckBookDoor(market: string): string | null {
  const m = tapeMarket(market)
  if (!m.href) return null
  const pair = chartPairFor(m.ticker)
  if (pair && (pair.source === 'coinbase' || pair.source === 'hyperliquid')) return `${m.href}?view=depth`
  return m.href
}

// ── The ladder ───────────────────────────────────────────────────────────────

/** Rungs a side: the nearest seven resting levels — fourteen rungs, the mid,
 *  three prints and the foot stand level with a split stage's channel. */
export const DECK_LADDER_RUNGS = 7

export interface LadderRung {
  /** The level's price. */
  px: number
  /** Dollars resting at this level. */
  usd: number
  /** Dollars resting between the mid and this level, inclusive. */
  cumUsd: number
  /** cumUsd over the taller side's far rung: the bar's length, 0..1. */
  share: number
}

export interface Ladder {
  /** Far to near (the DOM reads top = the furthest ask … the mid … bottom = the furthest bid). */
  asks: LadderRung[]
  /** Near to far. */
  bids: LadderRung[]
  mid: number
  /** Best ask − best bid; null while a side is empty. */
  spread: number | null
  /** Resting on the ladder, per side: the far rung's cumulative. */
  bidUsd: number
  askUsd: number
  /** How far the ladder reaches from the mid, in percent — the further side, to a tenth. */
  pct: number
  maxCumUsd: number
}

/**
 * The nearest `n` resting levels a side, dollars cumulated FROM THE MID
 * OUTWARD (the Depth view's rule). Levels, not price bins: Hyperliquid's
 * l2Book at the coarse precision the feed asks for holds one level per
 * tick (about 0.4–0.6% apart — twenty of them span ±6% or so), so a rung
 * IS a resting level and a bin finer than the tick would read as a hole.
 * A book with no mid, or an empty side, has no ladder.
 */
export function deckLadder(book: DepthBook, n = DECK_LADDER_RUNGS): Ladder | null {
  const mid = book.mid
  if (mid == null || !Number.isFinite(mid) || mid <= 0 || !(n >= 1) || !book.bids.length || !book.asks.length) return null
  const rungs = (levels: readonly DepthLevel[]): LadderRung[] => cumulate(levels.slice(0, n)).map((l) => ({ px: l.px, usd: l.size * l.px, cumUsd: l.cumUsd, share: 0 }))
  const asksNear = rungs(book.asks)
  const bidsNear = rungs(book.bids)
  if (!asksNear.length || !bidsNear.length) return null
  const farAsk = asksNear[asksNear.length - 1]
  const farBid = bidsNear[bidsNear.length - 1]
  const maxCumUsd = Math.max(farAsk.cumUsd, farBid.cumUsd, 0)
  for (const r of [...asksNear, ...bidsNear]) r.share = maxCumUsd > 0 ? r.cumUsd / maxCumUsd : 0
  const reach = Math.max((farAsk.px - mid) / mid, (mid - farBid.px) / mid) * 100
  return {
    asks: [...asksNear].reverse(),
    bids: bidsNear,
    mid,
    spread: book.asks[0].px - book.bids[0].px,
    bidUsd: farBid.cumUsd,
    askUsd: farAsk.cumUsd,
    pct: Math.round(reach * 10) / 10,
    maxCumUsd,
  }
}

/** Which rung a print hit: the nearest level at or past the print's price on
 *  its side of the mid (0 = nearest the mid); null when the print landed past
 *  the ladder. A print at the mid itself counts on the ask side. */
export function deckPrintRung(l: Ladder, price: number): { side: 'ask' | 'bid'; index: number } | null {
  if (!Number.isFinite(price)) return null
  if (price >= l.mid) {
    const asksNear = [...l.asks].reverse()
    const i = asksNear.findIndex((r) => r.px >= price)
    return i < 0 ? null : { side: 'ask', index: i }
  }
  const i = l.bids.findIndex((r) => r.px <= price)
  return i < 0 ? null : { side: 'bid', index: i }
}

// ── The prints ───────────────────────────────────────────────────────────────

/** A print fades off the ladder after this long — the Depth view's own fade. */
export const DECK_PRINT_FADE_MS = PRINT_FADE_MS
/** The strip under the mid keeps this many. */
export const DECK_PRINT_ROWS = 3

export interface DeckPrint {
  fill: TapeFill
  /** 1 as it lands, 0 as it fades. */
  alpha: number
}

/** The last prints of one market from a newest-first buffer (lib/tape
 *  mergeFills' order), inside the fade, newest first. */
export function deckPrints(fills: readonly TapeFill[], market: string, nowMs: number, n = DECK_PRINT_ROWS, fadeMs = DECK_PRINT_FADE_MS): DeckPrint[] {
  const out: DeckPrint[] = []
  for (const f of fills) {
    if (out.length >= n) break
    const age = nowMs - f.at
    if (age > fadeMs) break
    if (f.market !== market) continue
    out.push({ fill: f, alpha: Math.max(0, Math.min(1, 1 - age / fadeMs)) })
  }
  return out
}

// ── The words ────────────────────────────────────────────────────────────────

export interface StageReport {
  status: FeedStatus
  detail?: string
  source: TapeSource
  markets: number
  hidden: boolean
}

/** The foot's source line: where the fills come from and how the feed is
 *  doing — the pulse's own words (lib/pulse pulseStatusWords); a battle view
 *  names its mids too. */
export function deckSourceLine(ch: DeckChannel, r: StageReport): string {
  const words = pulseStatusWords(r.status, r.detail, { markets: r.markets, hidden: r.hidden })
  if (isDeckBattle(ch)) return `${PULSE_VENUE_WORD[r.source]} fills · Hyperliquid mids · ${words}`
  if (ch === 'flyover') return `${PULSE_VENUE_WORD[r.source]} · every venue · ${words}`
  return `${PULSE_VENUE_WORD[r.source]} · ${words}`
}

/** The switch's small line. */
export function deckSwitchWords(on: boolean, market: string | null): string {
  if (!on) return 'off · flick to watch the book'
  return market ? `on · ${tapeMarket(market).ticker}` : 'on · waiting for a market'
}

/** The ladder's status words — lib/depth's book words, Hyperliquid's. */
export function deckBookWords(status: BookFeedStatus, market: string | null): string {
  if (!market) return 'book · waiting for a market'
  return bookWords('hyperliquid', status)
}

/** The ladder's foot: the window's own dollars, then whose book and whose prints. */
export function deckLadderFoot(l: Ladder | null, source: TapeSource, prints: number): string {
  const whose = source === 'dune' ? "the prints landing on it are Dune's" : "the prints landing on it are the venue's own"
  if (!l) return `the book is Hyperliquid's · ${whose}`
  return `${fmtLadderUsd(l.bidUsd)} bids · ${fmtLadderUsd(l.askUsd)} asks on the nearest ${l.bids.length} levels a side (±${l.pct}%) · the book is Hyperliquid's · ${prints > 0 ? whose : 'no print on this feed yet'}`
}

/** Dollars on the ladder: whole dollars under a thousand, one decimal above. */
export function fmtLadderUsd(usd: number): string {
  if (!Number.isFinite(usd) || usd < 0) return '—'
  if (usd >= 1e9) return `$${(usd / 1e9).toFixed(2)}B`
  if (usd >= 1e6) return `$${(usd / 1e6).toFixed(2)}M`
  if (usd >= 1e3) return `$${(usd / 1e3).toFixed(1)}K`
  return `$${Math.round(usd)}`
}

/** A ladder price with the precision its magnitude needs (the Depth view's rule). */
export function fmtLadderPrice(p: number): string {
  if (!Number.isFinite(p)) return '—'
  if (p >= 10_000) return p.toFixed(0)
  if (p >= 100) return p.toFixed(2)
  if (p >= 1) return p.toFixed(4)
  return p.toFixed(6)
}

// ── The frame ────────────────────────────────────────────────────────────────

/** The stage's minimum heights, pinned equal to components/home/deck.css: the
 *  SSR frame (the pulse channel, book off) is the final frame. The band in
 *  its stage seat has no head and no foot (the deck's own), so the desktop
 *  stage holds the chips, the chart and the tiles (≈180px) plus the seat's
 *  padding; the phone holds the phone band's chart and tile row (≈125px)
 *  the same way. */
export const DECK_STAGE_MIN_H = { desktop: 200, phone: 136 } as const

/** The ladder's column on a split stage. */
export const DECK_BOOK_W = 360
