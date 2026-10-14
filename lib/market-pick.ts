// YOUR MARKETS — ONE selection for every live surface (2026-10-13; Nate:
// "users select their own token, add and remove, on The Front, The Siege,
// the Tape — the same token selection flows through all").
//
// Until now three rows remembered three things: the pulse and the tape shared
// lib/live-markets (`pantessa.live.markets.v1`, up to twelve), the battle
// views kept lib/battle's army memory (`pantessa.live.armies.v1`, up to five,
// with `?t=`), and the deck's Tape stage had no row at all. This module is the
// one rulebook: one list, one memory, one URL shape, one opening order. The
// pure half lives here (pinned by scripts/pick-pins.ts, `npm run pins:pick`);
// the browser half is lib/use-market-pick.ts (the PICK lane of the GTM squad):
// a shared store every surface on a page reads, the opening decision made
// once, add/remove by hand, the URL mirror on /live, the two old memories
// read once and carried over.
//
// Rules that carry over from both parents, now decided for all four:
// - Only a HAND writes the memory. A default (the watchlist, the wallet's
//   holdings, the venue's pick) is never remembered as "yours"; an EMPTY
//   memory is real (a hand cleared the row) and never re-seeds.
// - The memory holds the venue's spelling (kPEPE, xyz:NVDA) as resolved
//   against the universe when it was added; never re-cased.
// - The battle views march the FIRST five (lib/battle MAX_ARMIES) and say
//   so when the pick is longer; the pulse and the tape rows show every pick;
//   the deck's ladder follows the first.
// - `?t=` is the one URL shape (the battle views' own, now every view's).
//   `?m=` stays the tape's single-market LENS: it must name a pick, else it
//   reads as no lens (`lensFor`).
// - Opening order: URL → memory → watchlist → holdings → the venue's pick →
//   the fallback trio, holding a few seconds for a wallet that may still
//   answer (lib/battle's rule, `waitForHeld`).

import { ARMY_MEMORY_KEY, FALLBACK_ARMIES, MAX_ARMIES, addOwnMarkets, parseArmyMemory, type OwnAdd } from '@/lib/battle'
import { LIVE_MARKETS_KEY, parseLiveMarketMemory } from '@/lib/live-markets'

export { chipRow as pickRow } from '@/lib/live-markets'
export { heldArmies as heldPick } from '@/lib/battle'
export { watchlistMarkets as watchlistPick } from '@/lib/live-markets'

export const MARKET_PICK_KEY = 'pantessa.markets.pick.v1'
/** The row holds this many of yours. */
export const MAX_PICK = 8
/** The battle views march the first five. */
export const ARMY_SLICE = MAX_ARMIES
/** The URL carries the pick as `?t=A,B,C` on /live (every view). */
export const PICK_PARAM = 't'
/** Read once and carried over, never read again once the new key exists. */
export const LEGACY_PICK_KEYS = [ARMY_MEMORY_KEY, LIVE_MARKETS_KEY] as const

const MARKET_RE = /^(?:xyz:)?[A-Za-z][A-Za-z0-9]{0,11}$/i

export type PickSource = 'url' | 'hand' | 'watchlist' | 'held' | 'venue' | 'fallback'

export interface MarketPick {
  /** Venue spellings, in the order they were set; may be EMPTY (a hand cleared it). */
  markets: string[]
  source: PickSource
  /** When it was set (ms); 0 for a memory with no stamp. */
  at: number
}

/** The venue's spelling of a market the URL or the memory names: `xyz:` kept
 *  lower, the ticker as given (a memory holds the resolved case; a URL is
 *  upper-cased by `parsePickParam`). null for a shape no venue prints. */
export function normalizeMarket(raw: string): string | null {
  const s = raw.trim()
  if (!MARKET_RE.test(s)) return null
  return s.toLowerCase().startsWith('xyz:') ? `xyz:${s.slice(4)}` : s
}

/** A list of markets, deduped and capped, bad shapes dropped. */
export function cleanPick(list: readonly unknown[], max = MAX_PICK, upper = false): string[] {
  const out: string[] = []
  for (const x of list) {
    if (typeof x !== 'string') continue
    const m = normalizeMarket(upper ? x.trim().toUpperCase().replace(/^XYZ:/, 'xyz:') : x)
    if (!m || out.includes(m)) continue
    out.push(m)
    if (out.length >= max) break
  }
  return out
}

// ── The memory ───────────────────────────────────────────────────────────────

/** What localStorage holds. Any defect reads as nothing remembered; an empty
 *  list is a real memory (a hand removed everything) and is kept. A memory is
 *  always a hand's. */
export function parseMarketPick(raw: string | null | undefined): MarketPick | null {
  if (!raw) return null
  let v: unknown
  try {
    v = JSON.parse(raw)
  } catch {
    return null
  }
  if (!v || typeof v !== 'object' || (v as { v?: unknown }).v !== 1) return null
  const o = v as { markets?: unknown; at?: unknown }
  if (!Array.isArray(o.markets)) return null
  const at = typeof o.at === 'number' && Number.isFinite(o.at) ? o.at : 0
  return { markets: cleanPick(o.markets), source: 'hand', at }
}

export function serializeMarketPick(markets: readonly string[], at = Date.now()): string {
  return JSON.stringify({ v: 1, markets: cleanPick(markets), at })
}

/**
 * The two old memories, read ONCE when the new key is empty: the battle's
 * army memory wins (a hand picked a field — the more deliberate act), else
 * the live row's own markets (an empty one included — a hand cleared it).
 * Nothing in either → null, and the opening order decides.
 */
export function migrateLegacyPick(legacy: { armies: string | null | undefined; live: string | null | undefined }): MarketPick | null {
  const a = parseArmyMemory(legacy.armies)
  if (a) return { markets: cleanPick(a.armies), source: 'hand', at: a.at }
  const l = parseLiveMarketMemory(legacy.live)
  if (l) return { markets: cleanPick(l.own), source: 'hand', at: l.at }
  return null
}

/** Browser: the memory, carrying the old keys over the first time. */
export function readMarketPick(): MarketPick | null {
  try {
    const ls = window.localStorage
    const mine = parseMarketPick(ls.getItem(MARKET_PICK_KEY))
    if (mine) return mine
    const carried = migrateLegacyPick({ armies: ls.getItem(ARMY_MEMORY_KEY), live: ls.getItem(LIVE_MARKETS_KEY) })
    if (carried) ls.setItem(MARKET_PICK_KEY, serializeMarketPick(carried.markets, carried.at || Date.now()))
    return carried
  } catch {
    return null
  }
}

/** Browser: only a hand calls this. */
export function writeMarketPick(markets: readonly string[], at = Date.now()): void {
  try {
    window.localStorage.setItem(MARKET_PICK_KEY, serializeMarketPick(markets, at))
  } catch {
    // a private window or blocked storage: the row still works for this visit
  }
}

// ── The URL ──────────────────────────────────────────────────────────────────

/** `?t=` in any case → the venue's upper-case spellings, capped at MAX_PICK
 *  (lib/battle parseFrontTokens' shape, the row's cap). */
export function parsePickParam(raw: string | null | undefined): string[] {
  if (!raw) return []
  return cleanPick(raw.split(','), MAX_PICK, true)
}

export function pickParam(markets: readonly string[]): string {
  return cleanPick(markets).join(',')
}

/** The tape's single-market lens must be one of the picks, else no lens. */
export function lensFor(lens: string | null | undefined, markets: readonly string[]): string | null {
  if (!lens) return null
  const m = normalizeMarket(lens)
  return m && markets.includes(m) ? m : null
}

// ── The opening decision ─────────────────────────────────────────────────────

export interface PickOpeningInput {
  /** `?t=` from the URL (a page's own; the deck's stage passes []). */
  url: readonly string[]
  /** This browser's memory (an empty one counts). */
  memory: MarketPick | null
  /** The watchlist resolved against the universe (lib/live-markets watchlistMarkets); [] = none or unknown universe. */
  watch: readonly string[]
  /** The wallet's holdings as markets (lib/battle heldArmies): null = no answer yet; [] = answered, nothing. */
  held: readonly string[] | null
  /** The venue's own pick, already sliced to the opening count. */
  venue: readonly string[]
  /** Hold the venue's pick while a wallet may still answer with holdings. */
  waitForHeld: boolean
}

/** null = keep waiting (nothing explicit, and a wallet may still answer). */
export function openingPick(s: PickOpeningInput): MarketPick | null {
  const now = Date.now()
  if (s.url.length) return { markets: cleanPick(s.url), source: 'url', at: now }
  if (s.memory) return { markets: cleanPick(s.memory.markets), source: 'hand', at: s.memory.at }
  if (s.watch.length) return { markets: cleanPick(s.watch), source: 'watchlist', at: now }
  if (s.held && s.held.length) return { markets: cleanPick(s.held), source: 'held', at: now }
  if (s.held === null && s.waitForHeld) return null
  if (s.venue.length) return { markets: cleanPick(s.venue), source: 'venue', at: now }
  return { markets: [...FALLBACK_ARMIES], source: 'fallback', at: now }
}

/** The battle views march the first five. */
export function armiesOf(markets: readonly string[]): string[] {
  return cleanPick(markets).slice(0, ARMY_SLICE)
}

/** The note under a field longer than its slots. */
export function armySliceNote(markets: readonly string[]): string | null {
  const n = cleanPick(markets).length
  return n > ARMY_SLICE ? `the first ${ARMY_SLICE} of your ${n} march` : null
}

// ── Add / remove (a hand) ────────────────────────────────────────────────────

/** Several at once (commas or spaces), each resolved to the venue's spelling
 *  against what the page knows (the universe plus what the stream printed). */
export function addToPick(raw: string, known: readonly string[], current: readonly string[]): OwnAdd {
  return addOwnMarkets(raw, known, current, MAX_PICK)
}

export function removeFromPick(current: readonly string[], market: string): string[] {
  return current.filter((m) => m !== market)
}

/** The picker's word for where the row came from; nothing for a link (its
 *  markets are in the address bar), the venue's pick, or a hand this visit. */
export function pickSourceWord(source: PickSource): string | null {
  if (source === 'watchlist') return 'from your watchlist'
  if (source === 'held') return 'from your wallet'
  if (source === 'hand') return 'as you left them'
  return null
}

// ── Which default may replace which (the browser store's guard) ──────────────

/** How explicit a source is: a link and a hand are choices; the rest are defaults. */
export const PICK_RANK: Readonly<Record<PickSource, number>> = { url: 6, hand: 5, watchlist: 4, held: 3, venue: 2, fallback: 1 }

export function samePick(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((m, i) => m === b[i])
}

/**
 * The store decides the opening more than once as reads land (memory first,
 * then the universe, the watchlist, the wallet, the venue). A later decision
 * replaces what is shown only when it is more explicit than a DEFAULT: a
 * watchlist that lands after the venue's pick painted takes the row; holdings
 * never replace a watchlist; nothing replaces a hand or a link except a link
 * the page itself carries (`?t=`, read on the page seat). Nothing shown yet →
 * the decision paints.
 */
export function replacesPick(current: { markets: readonly string[]; source: PickSource } | null, next: { markets: readonly string[]; source: PickSource }): boolean {
  if (!current) return true
  if (next.source === 'url') return !(current.source === 'url' && samePick(current.markets, next.markets))
  if (current.source === 'url' || current.source === 'hand') return false
  if (next.source === 'hand') return true
  return PICK_RANK[next.source] > PICK_RANK[current.source]
}
