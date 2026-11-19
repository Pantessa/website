// THE HERO MOSAIC (2026-11-19, Nate picked "C2 · Lit tiles" from a canvas of
// six heroes: "trading for the AI age … hint at intents is all you need …
// crypto and traditional assets and charting as the hero … show the connected
// dapps logos … just the logos").
//
// The stranger's hero on `/` is a mosaic: every market is a tile, every dapp
// is a tile, and ONE sentence in the middle lights the tiles it would use.
// This file is the table behind it: which tiles, in what order, and the
// sentence each one says. Pure and client-safe; drawn by
// components/home/HeroMosaic.tsx, pinned by scripts/hero-mosaic-pins.ts.
//
// RULES
//   - A sentence here is one the builders read today, in the shape their own
//     grammar files state (lib/lido-stake "stake $3 worth of eth on lido",
//     lib/aave-supply "supply $100 of USDC on aave", lib/morpho-supply "lend
//     … USDC on morpho", lib/cross-chain-swap "swap 1 USDC from Base to
//     Arbitrum", lib/home-tour "Buy $10 of AAPL on Robinhood Chain",
//     lib/apps-trade cowBuyLowerAsk). Nothing recurring is offered.
//   - A logo tile wears the mark only (the name is its accessible label).
//   - A tile that needs a live price to say its sentence (the CoW limit)
//     says nothing without one and opens the app with that dapp on instead.
import type { ReadId } from '@/lib/read'
import { cowBuyLowerAsk } from '@/lib/apps-trade'
import { homeAppHref } from '@/lib/home-apps'

/** A market tile of the read's nine instruments. */
export interface HeroMarketTile {
  kind: 'market'
  id: ReadId
}
/** A stock tile filled from the day's biggest movers (HERO_MOVER_FALLBACK when the day is quiet). */
export interface HeroMoverTile {
  kind: 'mover'
  /** 0 = the day's biggest listed mover, 1 = the next. */
  slot: 0 | 1
}
/** A dapp's tile: its mark, and the sentence a press sends. */
export interface HeroAppTile {
  kind: 'app'
  /** The tile's id and the key components/protocol-marks resolves. */
  id: HeroAppId
  /** The accessible name (never drawn). */
  name: string
  /** The directory slug, for the fallback door into the app with it on. */
  slug: string
  /** The market tile this sentence also lights. */
  lights?: ReadId | 'aapl'
}
/** The stock buy (two cells wide). */
export interface HeroBuyTile {
  kind: 'buy'
  id: 'aapl'
}
/** The Called it record (two cells wide). */
export interface HeroCalledTile {
  kind: 'called'
  id: 'called'
}
export type HeroTile = HeroMarketTile | HeroMoverTile | HeroAppTile | HeroBuyTile | HeroCalledTile

export type HeroAppId = 'uniswap' | 'lido' | 'hyperliquid' | 'morpho' | 'robinhood' | 'cow' | 'near' | 'aave' | 'opensea'

/** The stock the buy tile buys, its words (Nate's) and the sentence it sends. */
export const HERO_BUY = { symbol: 'AAPL', usd: 25, label: 'Buy $25 worth of AAPL shares', ask: 'Buy $25 of AAPL' } as const

/** The Called it record the hero points at: one of the home shelf's own
 *  (app/x/_lib/home-shelf HOME_CALLED). The tile opens the ASSET's chart with
 *  the account's calls pinned (lib/called-it/spec chartHref, written out here
 *  so the client bundle does not carry that module; the pin holds them equal),
 *  not the profile (Nate, 2026-11-19). */
export const HERO_CALLED = { handle: 'dcinvestor', symbol: 'ETH', name: 'DC Investor', href: '/t/ETH?x=dcinvestor', eyebrow: 'Called it on X', line: 'Every call, pinned to the chart.' } as const

/** What the server knows about that record when the page is rendered: the
 *  account's photo (a data URI, never X's own URL) and the tally. Null fields
 *  when the record is not on this database: the tile then wears an initial. */
export interface HeroCalledSeedData {
  avatar: string | null
  tally: { total: number; right: number } | null
}
export const EMPTY_HERO_CALLED: HeroCalledSeedData = { avatar: null, tally: null }

/** Pure: the hero's record out of the shelf's read (same order: summaries[i] wears avatars[i]). */
export function heroCalledFrom(shelf: { summaries: readonly { handle: string; symbol: string; tally: { total: number; right: number } }[]; avatars: readonly (string | null)[] }): HeroCalledSeedData {
  const i = shelf.summaries.findIndex((s) => s.handle === HERO_CALLED.handle && s.symbol === HERO_CALLED.symbol)
  if (i < 0) return EMPTY_HERO_CALLED
  const t = shelf.summaries[i].tally
  return { avatar: shelf.avatars[i] ?? null, tally: t.total > 0 ? { total: t.total, right: t.right } : null }
}

/** The tile's foot line: the record's own count when it is known, the plain line otherwise. */
export function heroCalledLine(seed: HeroCalledSeedData): string {
  if (!seed.tally) return HERO_CALLED.line
  const { total, right } = seed.tally
  return `${total} ${HERO_CALLED.symbol} ${total === 1 ? 'call' : 'calls'} on the chart, ${right} called it.`
}

/** The stocks a mover tile shows when fewer than two listed stocks moved enough to rank. */
export const HERO_MOVER_FALLBACK: readonly string[] = ['NVDA', 'TSLA']

/** Columns and rows of the wide mosaic; the claim holds the middle 4 × 2. */
export const HERO_COLS = 8
export const HERO_ROWS = 4

/**
 * The tiles, in reading order (row by row around the claim). 9 markets, 2
 * movers, 9 dapps, the buy and the record: 24 cells of the 32, the claim
 * holds the other 8. A dapp sits beside the market its sentence lights where
 * the grid allows (Lido by Ether, Hyperliquid by Bitcoin).
 */
export const HERO_TILES: readonly HeroTile[] = [
  // row 1
  { kind: 'market', id: 'spx' },
  { kind: 'app', id: 'uniswap', name: 'Uniswap', slug: 'uniswap-free', lights: 'eth' },
  { kind: 'app', id: 'lido', name: 'Lido', slug: 'lido-free', lights: 'eth' },
  { kind: 'market', id: 'eth' },
  { kind: 'mover', slot: 0 },
  { kind: 'market', id: 'btc' },
  { kind: 'app', id: 'hyperliquid', name: 'Hyperliquid', slug: 'hyperliquid-free', lights: 'btc' },
  { kind: 'market', id: 'ndx' },
  // row 2 (two each side of the claim)
  { kind: 'app', id: 'morpho', name: 'Morpho', slug: 'morpho-free' },
  { kind: 'market', id: 'gold' },
  { kind: 'market', id: 'us10y' },
  { kind: 'app', id: 'robinhood', name: 'Robinhood Chain', slug: 'robinhood-free', lights: 'aapl' },
  // row 3
  { kind: 'market', id: 'oil' },
  { kind: 'app', id: 'cow', name: 'CoW Swap', slug: 'cow-free', lights: 'eth' },
  { kind: 'app', id: 'near', name: 'NEAR Intents', slug: 'near-intents' },
  { kind: 'mover', slot: 1 },
  // row 4
  { kind: 'buy', id: 'aapl' },
  { kind: 'app', id: 'aave', name: 'Aave', slug: 'aave' },
  { kind: 'market', id: 'vix' },
  { kind: 'called', id: 'called' },
  { kind: 'app', id: 'opensea', name: 'OpenSea', slug: 'opensea-free' },
  { kind: 'market', id: 'dxy' },
]

/** Cells a tile takes in the wide mosaic. */
export function heroTileSpan(t: HeroTile): 1 | 2 {
  return t.kind === 'buy' || t.kind === 'called' ? 2 : 1
}

/** What a dapp's tile says. `ethPrice` is the read's own ether quote (the CoW
 *  limit is priced off it); null = that tile has no sentence right now. */
export function heroAppAsk(id: HeroAppId, ethPrice: number | null | undefined): string | null {
  switch (id) {
    case 'uniswap':
      return 'Swap $20 of ETH to USDC'
    case 'lido':
      return 'Stake $20 worth of ETH on Lido'
    case 'hyperliquid':
      return 'Long BTC 2x'
    case 'morpho':
      return 'Lend $20 of USDC on Morpho'
    case 'robinhood':
      return 'Buy $20 of NVDA on Robinhood Chain'
    case 'cow':
      return ethPrice && ethPrice > 0 ? (cowBuyLowerAsk('ETH', ethPrice, { usd: 25, pct: 5, chainWord: 'Base' })?.ask ?? null) : null
    case 'near':
      return 'Swap 20 USDC from Base to Arbitrum'
    case 'aave':
      return 'Supply $20 of USDC on Aave'
    case 'opensea':
      return 'What am I being bid on my NFTs?'
  }
}

/** Where a dapp's tile goes when it has no sentence: the app, with that dapp on. */
export function heroAppFallbackHref(t: HeroAppTile): string {
  return homeAppHref(t.slug)
}

/** One thing the middle sentence can say, and the tiles it lights. */
export interface HeroSay {
  /** The tile that owns the sentence. */
  from: HeroAppId | 'aapl'
  ask: string
  /** Tile ids lit while it shows (the owner first). */
  lit: readonly string[]
}

/** The sentences the middle cycles through by itself, in order: a stake, a
 *  stock, a perp, a swap, a deposit. Yield first: it is the one a stranger
 *  does not expect from a chart. */
export const HERO_CYCLE: readonly (HeroAppId | 'aapl')[] = ['lido', 'aapl', 'hyperliquid', 'uniswap', 'aave']

/** How long one sentence holds, ms. */
export const HERO_CYCLE_MS = 4200

/** The sentence a tile owns, with what it lights. Null when the tile has none right now. */
export function heroSay(from: HeroAppId | 'aapl', ethPrice: number | null | undefined): HeroSay | null {
  if (from === 'aapl') return { from, ask: HERO_BUY.ask, lit: ['aapl', 'robinhood'] }
  const tile = HERO_TILES.find((t): t is HeroAppTile => t.kind === 'app' && t.id === from)
  const ask = tile ? heroAppAsk(from, ethPrice) : null
  if (!tile || !ask) return null
  return { from, ask, lit: tile.lights ? [from, tile.lights] : [from] }
}

/** The two stocks the mover tiles show: the day's ranked movers first, then
 *  the fallback, never the buy tile's own stock twice. */
export function heroMoverSymbols(movers: readonly { symbol: string }[]): [string, string] {
  const out: string[] = []
  for (const s of [...movers.map((m) => m.symbol), ...HERO_MOVER_FALLBACK]) {
    const sym = s.toUpperCase()
    if (sym === HERO_BUY.symbol || out.includes(sym)) continue
    out.push(sym)
    if (out.length === 2) break
  }
  return [out[0] ?? HERO_MOVER_FALLBACK[0], out[1] ?? HERO_MOVER_FALLBACK[1]]
}
