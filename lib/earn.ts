// ─────────────────────────────────────────────────────────────────────────
//  EARN — the yield board on /markets (2026-09-16). Pure, client-safe.
//
//  TradingView shows you a price. Pantessa shows you where that asset can
//  EARN — Lido (stake), Aave (supply), Morpho (lend) — with the live rate and
//  ONE chip per row whose sentence round-trips the venue's own parser
//  (memory chip-send-contract: the chip IS the contract; the signature is the
//  gate). Nothing here builds calldata: the server route composes rows from
//  the venues' own readers and this module shapes them for the board.
//
//  Honesty rules baked in:
//   • the APY shown is the rate the ASK lands on — Aave's "at the best rate"
//     picks the highest-APY spoke (that spoke's rate is the row's number);
//     Morpho's lend lands on the deepest curated market for the loan asset
//     (pickLendMarket), so that market's rate is the row's number, not the
//     best of all markets.
//   • a Lido stake sizes in ETH from a live price — the parser wants units;
//     without a price the row shows and the chip is omitted, never guessed.
//   • "best" is per asset, among the rows WE list, and rates are variable.
// ─────────────────────────────────────────────────────────────────────────

import type { AaveReserveRow } from '@/lib/aave-supply'
import type { MorphoMarketRow } from '@/lib/morpho-supply'

export type EarnVenue = 'lido' | 'aave' | 'morpho'
export type EarnKind = 'stake' | 'supply' | 'lend'
export type EarnClass = 'stable' | 'eth' | 'btc' | 'other'

export interface EarnRow {
  id: string
  venue: EarnVenue
  venueLabel: string
  kind: EarnKind
  chainId: number
  chainLabel: string
  /** The asset you put in (USDC, ETH, WETH, cbBTC…). */
  asset: string
  /** What you hold afterwards, when it differs (stETH, aUSDC…). */
  receives?: string
  /** Variable rate, percent per year — null when the venue didn't say. */
  apyPct: number | null
  /** Money already earning there, in dollars — null when unread. */
  tvlUsd: number | null
  /** One line of provenance: the spoke, the collateral, the market count. */
  detail: string
  /** True when the row's rate is the highest we list for this asset. */
  best: boolean
  /** The sentence a chip sends for `usd` dollars — null when it can't be sized. */
  askFor: (usd: number) => string | null
}

/** Wire shape of GET /api/markets/earn — rows are `EarnRow` minus the function. */
export type EarnWireRow = Omit<EarnRow, 'askFor' | 'best'> & { askTemplate: string | null; askUnitsPerUsd?: number | null }
export interface EarnResponse {
  rows: EarnWireRow[]
  /** Venues that didn't answer this read — named, never silently zero. */
  failed: EarnVenue[]
  ethUsd: number | null
  asOf: string
  cached?: boolean
}

export const EARN_AMOUNTS = [10, 25, 100] as const
export const EARN_DEFAULT_USD = 25
/** Rows shown before the fold — the rest behind SHOW ALL (the boards' idiom). */
export const EARN_FOLD_AT = 12
export const EARN_FOOTNOTE = 'Rates are variable and read live from each venue · the chip sends the sentence · your wallet signs · not advice'

const STABLES = new Set(['USDC', 'USDT', 'USDG', 'DAI', 'PYUSD', 'RLUSD', 'USDE', 'GHO', 'USDS', 'FRAX', 'LUSD', 'CRVUSD', 'EURC', 'USD1', 'USDA', 'USDTB'])
const ETHISH = new Set(['ETH', 'WETH', 'STETH', 'WSTETH', 'WEETH', 'RETH', 'CBETH', 'EZETH', 'RSETH', 'OSETH', 'ETHX'])
const BTCISH = new Set(['BTC', 'WBTC', 'CBBTC', 'TBTC', 'LBTC', 'KBTC', 'EBTC'])

export function earnClassOf(asset: string): EarnClass {
  const a = asset.replace(/^\$/, '').toUpperCase()
  // Named stables, plus the naming convention every dollar/peso/euro coin
  // follows (AUSD, APXUSD, FRXUSD, USDTB…) — the long tail Morpho lists.
  if (STABLES.has(a) || /USD|^MXNB$|^EURC$|^EURS$/.test(a)) return 'stable'
  if (ETHISH.has(a)) return 'eth'
  if (BTCISH.has(a)) return 'btc'
  return 'other'
}

export const CHAIN_LABEL: Readonly<Record<number, string>> = { 1: 'Ethereum', 8453: 'Base', 42161: 'Arbitrum', 10: 'Optimism', 4663: 'Robinhood Chain', 5042: 'Arc' }

/** "4.40%" → 4.4; 4.4 → 4.4; junk → null. */
export function pctOf(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string') return null
  const n = Number(v.replace(/[%,\s]/g, ''))
  return Number.isFinite(n) ? n : null
}

/** "$91,106,249.55" → 91106249.55; a number passes through; digit-less → null. */
export function usdOf(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string' || !/\d/.test(v)) return null
  const n = Number(v.replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}

const MORPHO_MARKET_ID_RE = /^0x[0-9a-fA-F]{64}$/

const fmtUsdAmount = (usd: number) => (Number.isInteger(usd) ? `$${usd}` : `$${usd.toFixed(2)}`)

/** Aave v4 (Ethereum spokes): one row per supplyable asset. The ask says "at
 *  the best rate" whenever more than one spoke lists the asset, so the build
 *  lands on the highest-APY spoke — the rate the row shows. */
export function aaveRows(reserves: readonly AaveReserveRow[]): EarnRow[] {
  const byAsset = new Map<string, AaveReserveRow[]>()
  for (const r of reserves) {
    const sym = r.asset?.symbol?.toUpperCase()
    if (!sym || r.active === false || r.canSupply === false) continue
    if (typeof r.supplyApyPct !== 'number') continue
    const list = byAsset.get(sym) ?? []
    list.push(r)
    byAsset.set(sym, list)
  }
  const rows: EarnRow[] = []
  for (const [sym, list] of byAsset) {
    const best = list.reduce((a, b) => ((b.supplyApyPct ?? -1) > (a.supplyApyPct ?? -1) ? b : a))
    const tvl = list.reduce<number | null>((acc, r) => {
      const u = usdOf(r.suppliedUsd)
      return u == null ? acc : (acc ?? 0) + u
    }, null)
    const multi = list.length > 1
    const asset = sym === 'WETH' ? 'ETH' : sym
    const askAsset = sym === 'WETH' ? 'ETH' : sym // the parser resolves ETH → WETH on Aave (AAVE_ALIASES)
    rows.push({
      id: `aave:1:${sym}`,
      venue: 'aave',
      venueLabel: 'Aave',
      kind: 'supply',
      chainId: 1,
      chainLabel: CHAIN_LABEL[1],
      asset,
      receives: `a${sym}`,
      apyPct: best.supplyApyPct ?? null,
      tvlUsd: tvl,
      detail: multi ? `${list.length} spokes · best on ${best.spoke ?? 'a spoke'}` : `${best.spoke ?? 'Main'} spoke`,
      best: false,
      // The AAVE token itself: "Supply $25 of AAVE to Aave" reads as the venue
      // word twice and falls to the planner (probed through the ladder) — the
      // row shows its rate, the chip is omitted rather than sent to freelance.
      askFor: (usd) => (sym === 'AAVE' ? null : `Supply ${fmtUsdAmount(usd)} of ${askAsset} to Aave${multi ? ' at the best rate' : ''}`),
    })
  }
  return rows
}

/** Lido: one row. The parser wants ETH units, so the chip sizes from a live
 *  ETH price (4 decimals, floor 0.001 ETH); no price → no chip. */
export function lidoRow(aprPct: number | null, tvlUsd: number | null, ethUsd: number | null): EarnRow {
  return {
    id: 'lido:1:ETH',
    venue: 'lido',
    venueLabel: 'Lido',
    kind: 'stake',
    chainId: 1,
    chainLabel: CHAIN_LABEL[1],
    asset: 'ETH',
    receives: 'stETH',
    apyPct: aprPct,
    tvlUsd,
    detail: '7-day average APR · rebases daily',
    best: false,
    askFor: (usd) => {
      if (ethUsd == null || ethUsd <= 0) return null
      const eth = Math.max(0.001, Math.round((usd / ethUsd) * 1e4) / 1e4)
      return `Stake ${eth} ETH on Lido`
    },
  }
}

/** Morpho (Base + Ethereum): one row per loan asset per chain, on the DEEPEST
 *  curated market — the one `pickLendMarket` lends into — so the shown rate
 *  is the rate the chip lands on. The tool sorts by size; first match wins. */
export function morphoRows(markets: readonly MorphoMarketRow[], chainId: 1 | 8453): EarnRow[] {
  const seen = new Map<string, { row: MorphoMarketRow; count: number; tvl: number | null }>()
  for (const m of markets) {
    const loan = m.loan?.toUpperCase()
    // Same validity rule as lib/morpho-supply's marketRowValid: a curated row
    // with a 32-byte hex market id — anything else never becomes a chip.
    if (!loan || m.curated === false || typeof m.marketId !== 'string' || !MORPHO_MARKET_ID_RE.test(m.marketId)) continue
    const cur = seen.get(loan)
    const u = usdOf(m.totalSupplyUsd)
    if (!cur) seen.set(loan, { row: m, count: 1, tvl: u })
    else seen.set(loan, { row: cur.row, count: cur.count + 1, tvl: u == null ? cur.tvl : (cur.tvl ?? 0) + u })
  }
  const chainLabel = CHAIN_LABEL[chainId]
  const rows: EarnRow[] = []
  for (const [loan, { row, count, tvl }] of seen) {
    rows.push({
      id: `morpho:${chainId}:${loan}`,
      venue: 'morpho',
      venueLabel: 'Morpho',
      kind: 'lend',
      chainId,
      chainLabel,
      // Shown as ETH like Aave's WETH row (one asset, one 'best'); the ask keeps
      // the venue's own word — Morpho lends WETH.
      asset: loan === 'WETH' ? 'ETH' : loan,
      apyPct: pctOf(row.supplyApy),
      tvlUsd: tvl,
      detail: `vs ${row.collateral ?? '?'} collateral · deepest of ${count} curated market${count === 1 ? '' : 's'}`,
      best: false,
      askFor: (usd) => `Lend ${fmtUsdAmount(usd)} of ${loan} on Morpho on ${chainLabel}`,
    })
  }
  return rows
}

/** Mark the highest-APY row per asset (among what we list) and sort: best
 *  rows first by APY, then everything by APY desc; unrated rows sink. */
export function rankEarnRows(rows: readonly EarnRow[]): EarnRow[] {
  const bestByAsset = new Map<string, EarnRow>()
  for (const r of rows) {
    if (r.apyPct == null) continue
    const cur = bestByAsset.get(r.asset)
    if (!cur || (cur.apyPct ?? -1) < r.apyPct) bestByAsset.set(r.asset, r)
  }
  return rows
    .map((r) => ({ ...r, best: bestByAsset.get(r.asset) === r }))
    .sort((a, b) => (b.apyPct ?? -Infinity) - (a.apyPct ?? -Infinity) || (b.tvlUsd ?? 0) - (a.tvlUsd ?? 0) || a.asset.localeCompare(b.asset))
}

/** The assets a first-time visitor is likely to hold. The board's DEFAULT
 *  order puts their best rows first (by rate), then the long tail (by rate):
 *  a stranger should see "USDC 5.33% · ETH 2.27%" before a peso coin at 17%.
 *  The sort bar's RATE overrides this with the pure rate order. */
export const FEATURED_EARN_ASSETS: readonly string[] = ['USDC', 'ETH', 'USDT', 'USDG', 'BTC', 'WBTC', 'CBBTC', 'DAI', 'PYUSD']
export function featuredFirst(rows: readonly EarnRow[]): EarnRow[] {
  const featured = new Set(FEATURED_EARN_ASSETS)
  const rank = (r: EarnRow) => (featured.has(r.asset) ? 0 : 1)
  return [...rows].sort((a, b) => rank(a) - rank(b) || (b.apyPct ?? -Infinity) - (a.apyPct ?? -Infinity) || (b.tvlUsd ?? 0) - (a.tvlUsd ?? 0))
}

export type EarnSortKey = 'featured' | 'apy' | 'tvl' | 'asset'
export function sortEarnRows(rows: readonly EarnRow[], key: EarnSortKey, dir: 'asc' | 'desc'): EarnRow[] {
  if (key === 'featured') return dir === 'desc' ? featuredFirst(rows) : featuredFirst(rows).reverse()
  const s = dir === 'asc' ? 1 : -1
  const num = (v: number | null) => (v == null ? (dir === 'asc' ? Infinity : -Infinity) : v)
  return [...rows].sort((a, b) => {
    if (key === 'asset') return s * a.asset.localeCompare(b.asset)
    const av = key === 'apy' ? num(a.apyPct) : num(a.tvlUsd)
    const bv = key === 'apy' ? num(b.apyPct) : num(b.tvlUsd)
    return s * (av - bv)
  })
}

export function filterEarnRows(rows: readonly EarnRow[], cls: EarnClass | 'all', venue: EarnVenue | 'all'): EarnRow[] {
  return rows.filter((r) => (cls === 'all' || earnClassOf(r.asset) === cls) && (venue === 'all' || r.venue === venue))
}

/** The yield ladder — one bar per asset (its best row), familiar assets
 *  first then by rate, top N — the same order the board opens on. */
/** A best rate under this isn't a yield worth a bar (WBTC 0.00% on Aave). */
export const LADDER_MIN_APY_PCT = 0.1
export function yieldLadder(rows: readonly EarnRow[], n = 8): EarnRow[] {
  return featuredFirst(rankEarnRows(rows).filter((r) => r.best && r.apyPct != null && r.apyPct >= LADDER_MIN_APY_PCT)).slice(0, n)
}

/** Wire → rows (the client re-attaches `askFor` from the template). */
export function rowsFromWire(wire: readonly EarnWireRow[]): EarnRow[] {
  return wire.map((w) => ({
    ...w,
    best: false,
    askFor: (usd: number) => {
      if (!w.askTemplate) return null
      if (w.askTemplate.includes('{eth}')) {
        if (!w.askUnitsPerUsd || w.askUnitsPerUsd <= 0) return null
        const eth = Math.max(0.001, Math.round(usd * w.askUnitsPerUsd * 1e4) / 1e4)
        return w.askTemplate.replace('{eth}', String(eth))
      }
      return w.askTemplate.replace('{usd}', fmtUsdAmount(usd))
    },
  }))
}

/** Rows → wire (the server side of the same contract). */
export function rowsToWire(rows: readonly EarnRow[], ethUsd: number | null): EarnWireRow[] {
  return rows.map(({ askFor, best: _best, ...r }) => {
    void _best
    if (r.venue === 'lido') return { ...r, askTemplate: ethUsd ? 'Stake {eth} ETH on Lido' : null, askUnitsPerUsd: ethUsd ? 1 / ethUsd : null }
    const sample = askFor(25)
    return { ...r, askTemplate: sample ? sample.replace('$25', '{usd}') : null }
  })
}
