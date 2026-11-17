// ─────────────────────────────────────────────────────────────────────────
//  Hyperliquid builder-deployed (HIP-3) dexes — the registry of the ones the
//  ORDER layer has been proven on, the asset-id rule, and the coin resolver.
//
//  Pure + client-safe (no I/O): the chart gates, the order builder, the relay
//  and the pins all read the same table, so a page can never offer an order
//  on a dex the builder was not measured against.
//
//  Everything here was MEASURED against the venue on 2026-11-09 (the PR that
//  added this file carries the raw responses), never copied from the docs:
//
//  · ASSET ID. A builder-dex market is `100000 + dexIndex × 10000 + index`,
//    where `dexIndex` is the dex's position in `{"type":"perpDexs"}` (slot 0
//    is null: the main book) and `index` its position in that dex's own
//    `meta.universe`. Seen on real fills: mainnet `xyz:SP500` orders carry
//    `a: 110052` (xyz is dex 1, SP500 is row 52); our own testnet fill on
//    `xyz:JPY` carried `a: 750024` (xyz is dex 65 THERE). The dex index is
//    per network — it is read live and never assumed across networks.
//  · COLLATERAL. `meta.collateralToken` is 0 (USDC) on xyz. A standard
//    account ("default" / "disabled") keeps a SEPARATE balance per dex: 999
//    USDC in the main perp account trades $0 on xyz ("Insufficient margin to
//    place order. asset=750024") until a `sendAsset` moves it there. A
//    unified or portfolio-margin account backs every USDC dex from spot USDC
//    with no transfer. `activeAssetData.availableToTrade` for the coin is the
//    venue's own figure in every mode.
//  · MARGIN MODE. Per market, and it moves (testnet lists xyz:CL isolated-only
//    where mainnet lets it cross): no flag = cross allowed; `onlyIsolated`
//    with `marginMode: noCross | strictIsolated` = isolated only — a cross
//    leverage update is refused ("Cross margin is not allowed for this
//    asset."). Read live, never pinned.
//  · FEES. A builder code rides a builder-dex order exactly as on the main
//    book: a real `xyz:SP500` fill carried `builder: { f: 100 }` and paid a
//    0.1% `builderFee` in USDC.
// ─────────────────────────────────────────────────────────────────────────

/** A builder-dex asset id starts here (the main book's ids are its bare row index). */
export const HL_BUILDER_ASSET_BASE = 100_000
/** Each dex owns this many ids. */
export const HL_BUILDER_ASSET_SPAN = 10_000

export interface HlBuilderDex {
  /** The venue's dex name — the prefix of every market on it (`xyz:SP500`). */
  name: string
  /** How a card names it. */
  label: string
  /** The dex's slot in MAINNET `perpDexs`. Slots are append-only, so a live
   *  read that disagrees means the venue is not the one this was measured
   *  against: the build fails closed. Testnet slots differ (xyz is 65 there)
   *  and are read live. */
  mainnetIndex: number
  /** The dex's deployer on mainnet — a second identity check beside the slot. */
  mainnetDeployer: string
  /** The only collateral token this layer builds against (spot token index;
   *  0 = USDC). A dex whose live `meta.collateralToken` differs is refused. */
  collateralToken: 0
}

/**
 * The builder dexes the order layer builds on. A dex belongs here ONLY after
 * its asset ids, collateral model, margin modes and fee path have been
 * measured against the venue AND an order built by this code has filled on
 * it (scripts/hl-hip3-drill.ts). Charting a dex is not proof.
 *
 * Measured and NOT added (2026-11-09): `para` (33 live markets, USDC, slot 8 —
 * `para:10Y` is there), `io` (14, slot 10) and `mkts` (1, slot 9) carry USDC
 * collateral too, but nothing in this app charts them and no order of ours has
 * run there. `flx`, `vntl`, `hyna`, `km`, `cash` use USDH / USDE / USDT0 and
 * had no live market left.
 */
export const HL_BUILDER_DEXES: Readonly<Record<string, HlBuilderDex>> = {
  xyz: {
    name: 'xyz',
    label: 'XYZ',
    mainnetIndex: 1,
    mainnetDeployer: '0x88806a71d74ad0a510b350545c9ae490912f0888',
    collateralToken: 0,
  },
}

/** The proven dex names, in the order a bare ticker is looked up after the main book. */
export const HL_BUILDER_DEX_NAMES: readonly string[] = Object.keys(HL_BUILDER_DEXES)

/** Spot USDC as `sendAsset` names it (`name:tokenId`), per network — read from
 *  each network's own `spotMeta` (token index 0). The mainnet id is "Unknown
 *  token" on testnet, so the two never stand in for each other. */
export const HL_USDC_TOKEN = {
  mainnet: 'USDC:0x6d1e7cde53ba9467b783cb7c530ce054',
  testnet: 'USDC:0xeb62eee3685fc4c43992febcd9e75443',
} as const

/** The dex a venue coin name is on: `xyz:SP500` → `xyz`; a main-book coin → null. */
export function hlDexOf(coin: string | null | undefined): string | null {
  if (typeof coin !== 'string') return null
  const i = coin.indexOf(':')
  return i > 0 ? coin.slice(0, i).toLowerCase() : null
}

/** The ticker a person reads: `xyz:SP500` → `SP500`; `BTC` → `BTC`. */
export function hlTickerOf(coin: string): string {
  const i = coin.indexOf(':')
  return i > 0 ? coin.slice(i + 1) : coin
}

/** Is this dex one the order layer builds on? */
export function isOrderableHlDex(dex: string | null | undefined): boolean {
  return typeof dex === 'string' && Object.hasOwn(HL_BUILDER_DEXES, dex.toLowerCase())
}

/** Can the order layer place an order on this venue coin? Every main-book
 *  coin, and a builder-dex coin only when its dex is proven. */
export function isOrderableHlCoin(coin: string | null | undefined): boolean {
  if (typeof coin !== 'string' || !coin) return false
  const dex = hlDexOf(coin)
  return dex === null ? !coin.includes(':') : isOrderableHlDex(dex)
}

/**
 * The venue's asset id for a market. `dexIndex` null = the main book (the id
 * IS the row index). Throws on anything that is not a clean slot — an id that
 * silently wraps into another dex's range would be an order on the wrong
 * market.
 */
export function hlAssetId(dexIndex: number | null, localIndex: number): number {
  if (!Number.isInteger(localIndex) || localIndex < 0) throw new Error(`hlAssetId: bad market index ${localIndex}`)
  if (dexIndex === null) {
    if (localIndex >= HL_BUILDER_ASSET_BASE) throw new Error(`hlAssetId: main-book index ${localIndex} is out of range`)
    return localIndex
  }
  if (!Number.isInteger(dexIndex) || dexIndex < 1) throw new Error(`hlAssetId: bad dex index ${dexIndex}`)
  if (localIndex >= HL_BUILDER_ASSET_SPAN) throw new Error(`hlAssetId: market index ${localIndex} does not fit one dex's range`)
  return HL_BUILDER_ASSET_BASE + dexIndex * HL_BUILDER_ASSET_SPAN + localIndex
}

/** The inverse: which dex slot and row an asset id names. Null on anything
 *  that is not an integer id in a perp range. */
export function splitHlAssetId(assetId: unknown): { dexIndex: number | null; localIndex: number } | null {
  if (typeof assetId !== 'number' || !Number.isInteger(assetId) || assetId < 0) return null
  if (assetId < HL_BUILDER_ASSET_BASE) return { dexIndex: null, localIndex: assetId }
  const rel = assetId - HL_BUILDER_ASSET_BASE
  const dexIndex = Math.floor(rel / HL_BUILDER_ASSET_SPAN)
  if (dexIndex < 1) return null
  return { dexIndex, localIndex: rel % HL_BUILDER_ASSET_SPAN }
}

export type HlMarginMode = 'cross' | 'isolated'

/** The margin mode a market allows, from its own `meta.universe` row: cross
 *  unless the venue marks it isolated-only (`onlyIsolated`, or a
 *  `marginMode` of `noCross` / `strictIsolated`). */
export function hlMarginModeOf(row: { onlyIsolated?: unknown; marginMode?: unknown } | null | undefined): HlMarginMode {
  if (!row) return 'cross'
  const mode = typeof row.marginMode === 'string' ? row.marginMode : ''
  return row.onlyIsolated === true || mode === 'noCross' || mode === 'strictIsolated' ? 'isolated' : 'cross'
}

export interface HlResolvedCoin {
  /** The venue's own spelling — `BTC`, `kPEPE`, `xyz:SP500`. */
  coin: string
  /** null = the main book. */
  dex: string | null
  /** What a person reads — `SP500`. */
  ticker: string
}

const findCi = (names: Iterable<string>, want: string): string | null => {
  const up = want.toUpperCase()
  for (const name of names) if (typeof name === 'string' && name.toUpperCase() === up) return name
  return null
}

/**
 * Resolve what someone typed (`sp500`, `SP500`, `xyz:sp500`, `KPEPE`) to the
 * venue's market. PURE on the listings it is handed:
 *   · a `dex:` prefix names that dex and nothing else — an unproven dex
 *     resolves to null (no order is built there), a proven one needs the
 *     market listed on it;
 *   · a bare ticker is the MAIN book's first (the main book wins a ticker
 *     collision, as it does on the chart — lib/charts hlChartTableFrom), then
 *     each proven builder dex in registry order;
 *   · matching ignores case and returns the venue's own casing (`kPEPE`).
 * `main` / `dexes[name]` are the LISTED names (delisted markets already out).
 */
export function resolveHlCoin(
  input: string,
  listings: { main?: Iterable<string> | null; dexes?: Readonly<Record<string, Iterable<string> | null | undefined>> },
): HlResolvedCoin | null {
  const raw = (input ?? '').trim()
  if (!raw) return null
  const prefix = hlDexOf(raw)
  if (prefix !== null) {
    if (!isOrderableHlDex(prefix)) return null
    const listed = listings.dexes?.[prefix]
    const hit = listed ? findCi(listed, `${prefix}:${hlTickerOf(raw)}`) : null
    return hit ? { coin: hit, dex: prefix, ticker: hlTickerOf(hit) } : null
  }
  if (raw.includes(':')) return null
  const onMain = listings.main ? findCi(listings.main, raw) : null
  if (onMain) return { coin: onMain, dex: null, ticker: onMain }
  for (const dex of HL_BUILDER_DEX_NAMES) {
    const listed = listings.dexes?.[dex]
    const hit = listed ? findCi(listed, `${dex}:${raw}`) : null
    if (hit) return { coin: hit, dex, ticker: hlTickerOf(hit) }
  }
  return null
}

/** Every ticker a perp sentence can name: the main book's coins plus the
 *  proven builder dexes' tickers (the bare form — what a person types). For
 *  the "did you mean" list. Main-book names first; duplicates collapse. */
export function orderableHlTickers(listings: { main?: Iterable<string> | null; dexes?: Readonly<Record<string, Iterable<string> | null | undefined>> }): string[] {
  const out = new Set<string>()
  for (const name of listings.main ?? []) if (typeof name === 'string' && !name.includes(':')) out.add(name)
  for (const dex of HL_BUILDER_DEX_NAMES) {
    for (const name of listings.dexes?.[dex] ?? []) {
      if (typeof name === 'string' && hlDexOf(name) === dex) out.add(hlTickerOf(name))
    }
  }
  return [...out]
}

/** One line for a card: where this market trades. Empty for the main book. */
export function hlDexPhrase(dex: string | null): string {
  if (!dex) return ''
  return ` (${HL_BUILDER_DEXES[dex]?.label ?? dex} builder dex)`
}
