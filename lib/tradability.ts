// ─────────────────────────────────────────────────────────────────────────
//  Can this symbol actually be TRADED here? — the shapes every surface
//  shares (Nate, 2026-09-22, on the /markets row for AMBA: "seems there is
//  no venue for AMBA, but we offer it for a trigger on the markets page…
//  I like keeping the stock so people can follow, but let's not add an
//  option to buy if they cannot buy").
//
//  Pure and client-safe: no fetch, no registry, no React. The legs a
//  symbol's Buy/Sell chips would execute (`tradeLegsFor`), the verdict a
//  venue read produces, and the one rule a chip asks before it renders
//  (lib/trade-venue-gate). The LIVE verdicts come from the venue cascade
//  itself (lib/venue-preflight over these legs) and are cached per symbol
//  and chain — see app/api/markets/tradable.
//
//  Two rules hold everywhere:
//  • Only a MEASURED refusal hides a chip. Unknown — a cold cache, a
//    timeout, a chain nobody has read yet — offers it, exactly as before
//    (the chat still refuses honestly, and #829's funding pre-flight still
//    keeps money off a chain that can't complete the buy). A stale cache
//    must never make a tradable market look closed.
//  • The row STAYS. A symbol nothing can fill keeps its chart, its quote,
//    its watchlist row and its page — only the action goes (Nate: "I like
//    keeping the stock so people can follow").
// ─────────────────────────────────────────────────────────────────────────

import type { ChartPair } from '@/lib/charts'
import { venuesFor } from '@/lib/symbol-venues'

/** The size every venue read is taken at — the smallest chip any surface
 *  offers (QuickAct's $25). A pool that cannot fill the smallest offer
 *  cannot fill a bigger one; a pool that fills $25 but not $500 refuses at
 *  build time with its own words, which is a refusal, not a dead button. */
export const TRADABILITY_PROBE_USD = 25

/** The stable each chain quotes against — mirrors lib/chains `primaryStable`
 *  (the registry is not client-safe). The harness pins this map against the
 *  registry, so a new chain fails a gate instead of quoting the wrong leg. */
export const VENUE_STABLE: Readonly<Record<number, string>> = {
  1: 'USDC',
  8453: 'USDC',
  42161: 'USDC',
  10: 'USDC',
  4663: 'USDG',
  5042: 'USDC',
}

export type TradeSideKey = 'buy' | 'sell'

/** One swap a Buy/Sell chip would execute: the exact leg lib/swap-exec is
 *  asked for when the sentence is sent. */
export interface TradeLeg {
  symbol: string
  chainId: number
  side: TradeSideKey
  sellToken: string
  buyToken: string
}

/**
 * Every same-chain swap leg a symbol's spot/stock chips would execute, in
 * the venue map's own order. Perps, lends, stakes and guardian rows are not
 * swaps and are not here: they carry their own venue fences (the HL perp
 * universe, the Aave reserve list, lib/guardian-coin-fence).
 */
export function tradeLegsFor(symbol: string, pair: ChartPair): TradeLeg[] {
  const sym = (pair?.symbol ?? symbol).toUpperCase()
  const out: TradeLeg[] = []
  const seen = new Set<string>()
  for (const r of venuesFor(sym, pair, { usd: TRADABILITY_PROBE_USD })) {
    if (r.kind !== 'spot' && r.kind !== 'stock') continue
    const stable = VENUE_STABLE[r.chainId]
    const side = r.side
    if (!stable || (side !== 'buy' && side !== 'sell')) continue
    const key = `${r.chainId}:${side}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(
      side === 'sell'
        ? { symbol: sym, chainId: r.chainId, side, sellToken: sym, buyToken: stable }
        : { symbol: sym, chainId: r.chainId, side, sellToken: stable, buyToken: sym },
    )
  }
  return out
}

/** What a venue read concluded about one leg. `no-venue` is the only value
 *  that hides anything. */
export type LegVerdict = 'fillable' | 'no-venue'

/** One measured leg, as the cache stores and the API serves it. */
export interface TradableLeg {
  chainId: number
  side: TradeSideKey
  verdict: LegVerdict
  /** The cascade's own words for a refusal — what the UI says instead of a chip. */
  reason?: string
  /** ISO — how old the read is (the UI never hides on a stale refusal). */
  checkedAt: string
}

/** Everything known about one symbol. Absent from a map = never measured. */
export interface SymbolTradability {
  symbol: string
  legs: TradableLeg[]
}

export type TradabilityMap = Readonly<Record<string, SymbolTradability>>

/** How long a measured refusal is trusted. Past it the symbol reads unknown
 *  again and its chips come back — a market that reopens must not stay dark
 *  because the refresher stopped. */
export const TRADABILITY_MAX_AGE_MS = 24 * 60 * 60 * 1000

function fresh(leg: TradableLeg, now: number): boolean {
  const at = Date.parse(leg.checkedAt)
  return Number.isFinite(at) && now - at < TRADABILITY_MAX_AGE_MS
}

/**
 * Can this side be filled for this symbol? `true` unless every chain that
 * could fill it has been measured refusing, recently. A chain nobody has
 * read is a reason to offer, not to hide.
 *
 * `chainId` narrows it to one chain (a "Buy on Base" row); omitted asks
 * whether ANY chain can fill it (a chip that names no chain).
 */
export function canFill(t: SymbolTradability | null | undefined, side: TradeSideKey, chainId?: number | null, now = Date.now()): boolean {
  if (!t) return true
  const legs = t.legs.filter((l) => l.side === side && (chainId == null || l.chainId === chainId) && fresh(l, now))
  if (legs.length === 0) return true
  return legs.some((l) => l.verdict === 'fillable')
}

/** The refusal to SAY where a chip used to be — the cascade's own words for
 *  the most recently measured miss, or null when nothing is known to refuse. */
export function fillRefusal(t: SymbolTradability | null | undefined, side: TradeSideKey, chainId?: number | null, now = Date.now()): string | null {
  if (canFill(t, side, chainId, now)) return null
  const miss = t!.legs
    .filter((l) => l.side === side && (chainId == null || l.chainId === chainId) && l.verdict === 'no-venue' && fresh(l, now))
    .sort((a, b) => Date.parse(b.checkedAt) - Date.parse(a.checkedAt))[0]
  return miss?.reason ?? null
}

/** The one line a surface shows in place of the actions it dropped. */
export function noVenueNote(symbol: string, sides: TradeSideKey[]): string {
  const what = sides.length === 2 ? 'buy or sell' : sides[0] === 'buy' ? 'buy' : 'sell'
  return `No venue can ${what} ${symbol.toUpperCase()} right now — the chart stays, the order doesn't. Nothing here would fill.`
}
