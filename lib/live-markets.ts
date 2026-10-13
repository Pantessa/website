// YOUR OWN MARKETS ON THE LIVE ROWS (2026-10-13). Nate: "allow the user to
// add their own custom tokens, like UNI, and add multiple … save them for
// when they come back … add and remove, possibly use their watchlist as a
// default input" — "same for the home page". One rulebook for /live's chip
// row and the splash pulse's: the markets a hand added lead the row, are
// remembered in this browser (lib/battle's army memory, one key over), and
// until a hand touches the row the watchlist stands in for it.
//
// Rules carried over from the battle views (lib/battle openingArmies): only
// a HAND writes the memory — a watchlist default is never remembered as
// "yours", so the next visit follows the watchlist again; a remembered
// EMPTY row (every chip removed) stays empty and never re-seeds. A typed
// name resolves to the venue's spelling (`nvda` → xyz:NVDA, `pepe` →
// kPEPE) against the market list the page knows — the venue's universe
// plus every market the stream has already printed, so a Lighter-only
// book (OPENAI) resolves once it has been seen. Pure except the two
// localStorage helpers (try/catch, never throw). Pinned in scripts/tape-pins.
//
// RETIRED AS A WRITER (GTM squad 2026-10-13, lane PICK): the rows now read
// THE ONE PICK (lib/market-pick + lib/use-market-pick, key
// `pantessa.markets.pick.v1`). This key is only READ, once, by
// lib/market-pick readMarketPick to carry an old row over; nothing writes it.
// The pure row helpers (chipRow, knownMarkets, watchlistMarkets) stay live.

import { addOwnMarkets, resolveMarket, type OwnAdd } from '@/lib/battle'

export const LIVE_MARKETS_KEY = 'pantessa.live.markets.v1'
export const MAX_OWN_MARKETS = 12

const MARKET_RE = /^(?:xyz:)?[A-Za-z][A-Za-z0-9]{0,11}$/i

export interface LiveMarketMemory {
  /** Venue spellings, in the order the hand set them; may be EMPTY. */
  own: string[]
  at: number
}

/** Any defect reads as nothing remembered. An empty list is a real memory
 *  (a hand removed everything) and is kept. */
export function parseLiveMarketMemory(raw: string | null | undefined): LiveMarketMemory | null {
  if (!raw) return null
  let v: unknown
  try {
    v = JSON.parse(raw)
  } catch {
    return null
  }
  if (!v || typeof v !== 'object' || (v as { v?: unknown }).v !== 1) return null
  const o = v as { own?: unknown; at?: unknown }
  if (!Array.isArray(o.own)) return null
  const own: string[] = []
  for (const x of o.own) {
    if (typeof x !== 'string' || !MARKET_RE.test(x.trim())) continue
    const m = x.trim()
    const norm = m.toLowerCase().startsWith('xyz:') ? `xyz:${m.slice(4)}` : m
    if (!own.includes(norm)) own.push(norm)
    if (own.length >= MAX_OWN_MARKETS) break
  }
  const at = typeof o.at === 'number' && Number.isFinite(o.at) ? o.at : 0
  return { own, at }
}

export function serializeLiveMarketMemory(m: LiveMarketMemory): string {
  return JSON.stringify({ v: 1, own: m.own.slice(0, MAX_OWN_MARKETS), at: m.at })
}

/** Retired as a surface read (2026-10-13): lib/market-pick readMarketPick carries it over once. */
export function readLiveMarketMemory(): LiveMarketMemory | null {
  try {
    return parseLiveMarketMemory(window.localStorage.getItem(LIVE_MARKETS_KEY))
  } catch {
    return null
  }
}

/** Retired (2026-10-13): no surface writes this key any more — lib/market-pick writeMarketPick does. */
export function writeLiveMarketMemory(own: readonly string[], at = Date.now()): void {
  try {
    window.localStorage.setItem(LIVE_MARKETS_KEY, serializeLiveMarketMemory({ own: [...own], at }))
  } catch {
    // a private window or blocked storage: the row still works for this visit
  }
}

/** A wrapped or staked form of a coin is that coin's market. */
const WATCH_ALIASES: Readonly<Record<string, string>> = {
  WETH: 'ETH', STETH: 'ETH', WSTETH: 'ETH', CBETH: 'ETH', RETH: 'ETH', WEETH: 'ETH',
  WBTC: 'BTC', CBBTC: 'BTC', TBTC: 'BTC',
  WSOL: 'SOL',
}
/** Money is not a market to watch print. */
const NOT_A_MARKET: ReadonlySet<string> = new Set(['USDC', 'USDC.E', 'USDT', 'DAI', 'USDG', 'USDE', 'USDS', 'PYUSD', 'EURC', 'FRAX', 'GHO', 'USD1', 'USDB'])

/**
 * The watchlist as a row: every watched symbol that resolves to a market
 * the page knows, in list order, aliases folded (cbBTC is BTC), money
 * skipped, capped. Nothing while the universe is unknown — a stock would
 * miss its `xyz:` and read as a coin.
 */
export function watchlistMarkets(symbols: readonly string[], universe: readonly string[], max = MAX_OWN_MARKETS): string[] {
  if (!universe.length) return []
  const out: string[] = []
  for (const raw of symbols) {
    const s = raw.trim().toUpperCase()
    if (!s || NOT_A_MARKET.has(s)) continue
    const m = resolveMarket(WATCH_ALIASES[s] ?? s, universe)
    if (!m || out.includes(m)) continue
    out.push(m)
    if (out.length >= max) break
  }
  return out
}

export type OwnSource = 'memory' | 'watchlist' | null

/** What the row opens on: the memory (even an empty one — a hand cleared
 *  it), else the watchlist, else nothing. */
/** Retired (2026-10-13): lib/market-pick openingPick decides every row's opening. */
export function openingOwnMarkets(d: { memory: LiveMarketMemory | null; watch: readonly string[] }): { own: string[]; source: OwnSource } {
  if (d.memory) return { own: [...d.memory.own], source: 'memory' }
  if (d.watch.length) return { own: [...d.watch], source: 'watchlist' }
  return { own: [], source: null }
}

/** Several at once, resolved against the venue's list plus what the
 *  stream has printed; capped at MAX_OWN_MARKETS. */
/** Retired (2026-10-13): lib/market-pick addToPick (cap MAX_PICK). */
export function addLiveMarkets(raw: string, known: readonly string[], current: readonly string[]): OwnAdd {
  return addOwnMarkets(raw, known, current, MAX_OWN_MARKETS)
}

/** Retired (2026-10-13): lib/market-pick removeFromPick. */
export function removeLiveMarket(current: readonly string[], market: string): string[] {
  return current.filter((m) => m !== market)
}

/** The venue's list plus every market the buffer has seen, deduped, so a
 *  typed name resolves to a spelling the stream actually prints. */
export function knownMarkets(universe: readonly string[], seen: Iterable<string>): string[] {
  const out = [...universe]
  const have = new Set(out.map((m) => m.toLowerCase()))
  for (const m of seen) {
    const k = m.toLowerCase()
    if (have.has(k)) continue
    have.add(k)
    out.push(m)
  }
  return out
}

export interface ChipEntry {
  market: string
  /** A hand (or the watchlist standing in for it) put it here: it wears a remove button. */
  own: boolean
}

/**
 * The row: your own markets first, in your order; then the page's own list
 * (the busiest books on the firehose, or the venue socket's subscription)
 * minus what you already have, capped; the active filter kept in view.
 */
export function chipRow(own: readonly string[], rest: readonly string[], filter: string | null, restCap: number): ChipEntry[] {
  const out: ChipEntry[] = own.map((m) => ({ market: m, own: true }))
  const have = new Set(own)
  let n = 0
  for (const m of rest) {
    if (have.has(m)) continue
    if (n >= restCap) break
    have.add(m)
    out.push({ market: m, own: false })
    n++
  }
  if (filter && !have.has(filter)) out.unshift({ market: filter, own: false })
  return out
}

/** The note beside the add box while no hand has touched the row. Retired (2026-10-13): lib/market-pick pickSourceWord. */
export const OWN_SOURCE_NOTE: Record<Exclude<OwnSource, null>, string> = { watchlist: 'from your watchlist', memory: 'as you left them' }
