// ─────────────────────────────────────────────────────────────────────────
//  A chip needs a venue that LISTS it (Nate, 2026-10-05, on /t/UNI: he
//  pressed "Supply on Aave" and the chat answered "UNI isn't an active,
//  supplyable Aave v4 reserve" — "if we offer a button anywhere … make sure
//  we can execute it").
//
//  lib/trade-venue-gate judges market buys and sells against the swap
//  cascade. This is the same rule for everything that is NOT a swap: an Aave
//  supply, a borrow against the token, a Hyperliquid perp, a Guardian stop on
//  that perp. Each is only real when the venue's own list says so, and that
//  list moves (Hyperliquid delisted MKR; Aave v4 never listed UNI).
//
//  Pure + client-safe. Two halves:
//  • the VERDICT, from the venue's own list, asked the way the builder asks
//    it (`aaveCapability` is lib/aave-supply's reserve pick; `perpCapability`
//    is the universe the HL layer validates against) — so a chip and the
//    build behind it can never disagree about what is listed;
//  • the SENTENCE rule (`capabilityTarget`), which reads what a chip sends,
//    so one rule covers every surface that already filters through
//    lib/trade-venue-gate `canTradeAsk`.
//
//  Like the swap gate it fails OPEN: only a measured, recent "not listed"
//  hides a chip (lib/tradability canFill). The cold lists in
//  lib/symbol-venues are what a page offers before anything is measured, so
//  they are held to the live lists by a harness pin.
// ─────────────────────────────────────────────────────────────────────────

import { chartPairFor, isChartOnlyPair, isHip3Pair, type ChartPair } from '@/lib/charts'
import { resolveHlCoin } from '@/lib/hl-dex'
import { AAVE_CHAIN_ID, HL_SIGNING_CHAIN_ID, venuesFor } from '@/lib/symbol-venues'
import { canFill, fillRefusal, type CapabilitySideKey, type TradabilityMap } from '@/lib/tradability'
import { normalizeWatchSymbol } from '@/lib/watchlists'
import { aaveReserveSymbolFor } from '@/lib/weth-wrap'

/** One thing a venue has to list for a symbol's chips to run. */
export interface CapabilityLeg {
  symbol: string
  chainId: number
  side: CapabilitySideKey
}

/**
 * Every listing a symbol's own chips depend on, read off the venue map: a
 * lend row's supply side needs a supplyable reserve, its borrow side needs
 * the token to count as collateral, and any perp or Guardian-on-a-perp row
 * needs the coin in the live perp universe.
 */
export function capabilityLegsFor(symbol: string, pair: ChartPair): CapabilityLeg[] {
  const sym = (pair?.symbol ?? symbol).toUpperCase()
  const sides = new Set<CapabilitySideKey>()
  for (const r of venuesFor(sym, pair)) {
    if (r.kind === 'lend') sides.add(r.side === 'sell' ? 'collateral' : 'supply')
    else if (r.kind === 'perp' || (r.kind === 'protect' && r.venue === 'hyperliquid')) sides.add('perp')
  }
  return [...sides].map((side) => ({ symbol: sym, side, chainId: side === 'perp' ? HL_SIGNING_CHAIN_ID : AAVE_CHAIN_ID }))
}

// ── The verdicts ────────────────────────────────────────────────────────────

/** The fields of an Aave reserve row the verdict reads (lib/aave-supply
 *  AaveReserveRow is a superset). */
export interface ReserveListing {
  asset?: { symbol?: string | null } | null
  active?: boolean | null
  canSupply?: boolean | null
  canUseAsCollateral?: boolean | null
}

/**
 * What Aave lists for a token, asked exactly as the supply layer asks it
 * (lib/aave-supply pickSupplyReserve): an ACTIVE row whose symbol is the
 * reserve the builder resolves for the token the sentence names, with
 * `canSupply` true. The builder wraps ETH into WETH first, so "ETH" reads the
 * WETH row (lib/weth-wrap aaveReserveSymbolFor, the one mapping both use).
 * Nothing else is aliased: "BTC" is neither WBTC nor cbBTC to the builder.
 */
export function aaveCapability(reserves: readonly ReserveListing[], token: string): { supply: boolean; collateral: boolean } {
  const sym = aaveReserveSymbolFor(token)
  const rows = reserves.filter((r) => r.active === true && (r.asset?.symbol ?? '').toUpperCase() === sym && r.canSupply === true)
  return { supply: rows.length > 0, collateral: rows.some((r) => r.canUseAsCollateral === true) }
}

export const aaveRefusal = (token: string, side: 'supply' | 'collateral'): string =>
  side === 'supply'
    ? `${token.toUpperCase()} isn't an active, supplyable Aave v4 reserve on Ethereum.`
    : `Aave v4 doesn't count ${token.toUpperCase()} as collateral on Ethereum.`

/**
 * Is the coin a live Hyperliquid perp an order builds on? Asked the way the
 * order layer resolves a coin (lib/hl-dex resolveHlCoin): the MAIN book's
 * universe first, then each builder dex the layer places orders on —
 * `SP500` is `xyz:SP500`. `listed` is the venue's own universe with delisted
 * markets already removed (lib/hl-universe); `builderDexes` maps a dex name to
 * its listed markets (omitted / unread = the main book alone decides).
 */
export function perpCapability(
  universe: { listed: ReadonlySet<string> },
  coin: string,
  builderDexes?: Readonly<Record<string, ReadonlySet<string> | null | undefined>> | null,
): boolean {
  return resolveHlCoin(coin, { main: universe.listed, dexes: builderDexes ?? {} }) !== null
}

export const perpRefusal = (coin: string): string => `Hyperliquid doesn't list a live ${coin.toUpperCase()} perp.`

// ── The sentence rule ───────────────────────────────────────────────────────

const SYM = String.raw`\$?([A-Za-z][A-Za-z0-9]{0,11})\b`
const USD = String.raw`\$\d[\d,]*(?:\.\d+)?`
const UNITS = String.raw`(?:\d[\d,]*(?:\.\d+)?|\.\d+)`

/** "Supply $50 of LINK to Aave", "supply 120 USDC to aave" — also as the
 *  supply clause of a compound ask ("…, then supply $40 of LINK to Aave"). */
const SUPPLY_RES: readonly RegExp[] = [
  new RegExp(String.raw`\bsupply\s+${USD}\s+(?:worth\s+)?of\s+${SYM}\s+(?:to|on|into|in)\s+aave\b`, 'i'),
  new RegExp(String.raw`\bsupply\s+${UNITS}\s+${SYM}\s+(?:to|on|into|in)\s+aave\b`, 'i'),
]
/** "2x Long $50 of UNI on Hyperliquid", "Short $25 of MKR on Hyperliquid". */
const PERP_RE = new RegExp(String.raw`\b(?:long|short)\s+${USD}\s+(?:worth\s+)?of\s+${SYM}\s+on\s+hyperliquid\b`, 'i')
/** "Protect my HYPE long with a 5% stop" — the Guardian on a perp position. */
const PERP_GUARD_RE = new RegExp(String.raw`^\s*protect\s+my\s+${SYM}\s+(?:long|short)\b`, 'i')

export interface CapabilityTarget {
  symbol: string
  side: CapabilitySideKey
  chainId: number
  /** The sentence arms the Guardian on a perp position ("Protect my HYPE
   *  long …") rather than placing an order. */
  guard?: true
}

/**
 * What a sentence needs a venue to list, or null when it needs nothing this
 * rule knows (a swap, a stake, a bridge, a borrow — a borrow sentence names
 * the loan, not the collateral, so the venue map drops that row instead:
 * app/api/markets/routes).
 *
 * The Aave token is kept as the sentence names it (see aaveCapability); a
 * perp coin is normalized like every other chart symbol.
 */
export function capabilityTarget(ask: string): CapabilityTarget | null {
  for (const re of SUPPLY_RES) {
    const m = ask.match(re)
    if (m) return { symbol: m[1].toUpperCase(), side: 'supply', chainId: AAVE_CHAIN_ID }
  }
  const order = ask.match(PERP_RE)
  if (order) return { symbol: normalizeWatchSymbol(order[1]) ?? order[1].toUpperCase(), side: 'perp', chainId: HL_SIGNING_CHAIN_ID }
  const guard = ask.match(PERP_GUARD_RE)
  if (guard) return { symbol: normalizeWatchSymbol(guard[1]) ?? guard[1].toUpperCase(), side: 'perp', chainId: HL_SIGNING_CHAIN_ID, guard: true }
  return null
}

/**
 * Show this chip? Anything that needs no listing: yes. A supply or a perp:
 * yes unless its venue has been measured NOT listing the token, recently —
 * and, structurally, never where the builder cannot build (builderMarketBar).
 */
export function canRunVenueAsk(ask: string, tradable: TradabilityMap | null | undefined, now = Date.now()): boolean {
  const t = capabilityTarget(ask)
  if (!t) return true
  if (builderMarketBar(t)) return false
  if (!tradable) return true
  return canFill(tradable[t.symbol], t.side, t.chainId, now)
}

/**
 * The STRUCTURAL bars on a builder-dex (HIP-3) market — not measured, so no
 * verdict can open them:
 *   · `chart-only` — the market's dex is not one the order layer builds on
 *     (lib/charts isChartOnlyPair; the registry in lib/hl-dex is the gate).
 *     Until 2026-11-09 that was every builder-dex market; `xyz` is proven now,
 *     so "Long $25 of SP500 on Hyperliquid" builds.
 *   · `guard` — a Guardian stop on ANY builder-dex position: the watcher
 *     reads the main book's ledger only and would never see it.
 * Known only where the live perp table is (the server, a symbol page);
 * elsewhere the pair is unknown and the measured verdict decides as before.
 */
function builderMarketBar(t: CapabilityTarget): 'chart-only' | 'guard' | null {
  if (t.side !== 'perp') return null
  const pair = chartPairFor(t.symbol)
  if (isChartOnlyPair(pair)) return 'chart-only'
  if (t.guard && isHip3Pair(pair)) return 'guard'
  return null
}

/** The page's words for a chart whose market the order layer cannot reach yet. */
export const hip3Refusal = (coin: string): string => `${coin.toUpperCase()} is a Hyperliquid builder market: the chart is live, and Pantessa does not place orders there yet.`

/** Why no stop can be armed on a builder-dex position. */
export const builderGuardRefusal = (coin: string): string =>
  `${coin.toUpperCase()} trades on a Hyperliquid builder dex: long, short and close build here, and the Guardian watches the main book only — no stop can be armed on it yet.`

/** The venue's words for why a chip is missing, or null when nothing is
 *  known to refuse. */
export function venueAskRefusal(ask: string, tradable: TradabilityMap | null | undefined, now = Date.now()): string | null {
  const t = capabilityTarget(ask)
  const bar = t ? builderMarketBar(t) : null
  if (t && bar) return bar === 'guard' ? builderGuardRefusal(t.symbol) : hip3Refusal(t.symbol)
  if (!t || !tradable) return null
  return fillRefusal(tradable[t.symbol], t.side, t.chainId, now)
}
