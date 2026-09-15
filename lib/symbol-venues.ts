// ─────────────────────────────────────────────────────────────────────────
//  The venue map — every way a wallet can act on a symbol across dapps.
//  Pure, client-safe, no fetch (MK2/EXEC, 2026-09-15). The symbol page's
//  RouteTable, the header ExecStrip, the AI brief's chips and the landing
//  all read THIS list; live numbers for each row come from
//  GET /api/markets/routes?symbol= (app/api/markets/routes).
//
//  Every `ask` is a SENTENCE in a native parser's own example phrasing
//  (memory chip-send-contract: the chip IS the contract) — swap / CoW limit
//  / HL perp (+ leverage) / Aave supply+borrow / Lido stake / DCA / Spot
//  Guardian + HL Guardian / NEAR cross-chain funding / Robinhood Chain
//  funding / 4663 stock buys. Nothing here writes calldata, addresses or
//  amounts that get signed; the harness pins every row through
//  scripts/ask-ladder.ts (a row that lands on the planner is a bug).
//
//  Honesty rules (each one is a walled ask avoided):
//  • CoW has NO order book on Optimism or Robinhood Chain (lib/chains
//    `cow`), so a limit row never names them;
//  • the Spot Guardian runs on Base only and arms from an EOA-capable
//    wallet — the row says Base and names the caveat;
//  • the HL Guardian only protects a LIVE perp — `needs: 'position'`;
//  • a Robinhood Chain stock has no perp, no lend, no stake, no resting
//    book: buy / sell / DCA on 4663 + funding from any origin, and the
//    missing kinds are NAMED (`missingVenueNotes`), never silent;
//  • a coin whose home isn't an EVM chain (SOL, XRP… lib/token-home) gets
//    Hyperliquid perps only — a spot row could only ever buy a Base squat;
//  • Aave supply/borrow and Lido stake live on Ethereum mainnet (the v4
//    spokes + the stETH contract) — one chain, said out loud;
//  • a limit row and a stake row need a PRICE to size honestly (units, not
//    dollars, are what those grammars read) — pass `last` from the live
//    quote; without it those rows are omitted rather than guessed.
// ─────────────────────────────────────────────────────────────────────────

import type { ChartPair } from '@/lib/charts'
import { tokenHome } from '@/lib/token-home'
import { fmtAskPrice, fmtAskUnits } from '@/lib/chart-actions'

export type VenueKind = 'spot' | 'limit' | 'perp' | 'lend' | 'stake' | 'dca' | 'protect' | 'fund' | 'stock'

export type VenueRoute = {
  /** Stable row id (`spot:uniswap:8453:buy`). */
  id: string
  kind: VenueKind
  /** Venue key — matches components/protocol-marks keys where a vendored
   *  mark exists (uniswap · cow · hyperliquid · aave · lido · near ·
   *  robinhood · lifi); 'pantessa' for the house autonomy rows. */
  venue: string
  /** The chain the artifact signs on. Hyperliquid L1 actions carry the
   *  venue's own signing domain (1337); a stock row is 4663. */
  chainId: number
  label: string
  /** The sentence that gets sent — round-trips an existing parser. */
  ask: string
  /** The free MCP slug the route is usually described by (informational —
   *  every ask here lands on a NATIVE layer whether or not the MCP is in
   *  the working set). */
  mcp?: string
  note?: string
  /** 'wallet' = needs a connected wallet to size honestly (every row does,
   *  at signature); 'position' = only meaningful with a live position. */
  needs?: 'wallet' | 'position'
  /** Which side of the market the row trades ('buy' = acquires the symbol). */
  side?: 'buy' | 'sell'
  /** The fee family lib/fees prices this row at (the routes API turns it
   *  into real bps — server-side, so env overrides never split the render). */
  fee: 'swap' | 'hl' | 'cross-chain' | 'lifi' | 'none'
}

export interface VenuesOptions {
  /** Dollar size for buy/sell/perp/lend/fund rows (default $50). */
  usd?: number
  /** Dollar size per period for the DCA row (default $10). */
  dcaUsd?: number
  /** Stop distance for protect rows (default 5%). */
  stopPct?: number
  /** Leverage for the perp rows (omit = the venue's current setting). */
  leverage?: number
  /** The live last price — sizes the limit (CoW) and stake (Lido) rows in
   *  token units. Those rows are omitted when unknown. */
  last?: number
  /** Limit distance from `last` for the CoW rows (default 1%). */
  limitPct?: number
}

export const DEFAULT_ROUTE_USD = 50
export const DEFAULT_ROUTE_DCA_USD = 10
export const DEFAULT_ROUTE_STOP_PCT = 5
export const DEFAULT_ROUTE_LIMIT_PCT = 1

// ── Chain facts (mirrors lib/chains — the registry is not client-safe) ─────
export const SPOT_CHAINS: ReadonlyArray<{ id: number; name: string; word: string; cow: boolean }> = [
  { id: 8453, name: 'Base', word: 'Base', cow: true },
  { id: 1, name: 'Ethereum', word: 'Ethereum', cow: true },
  { id: 42161, name: 'Arbitrum', word: 'Arbitrum', cow: true },
  { id: 10, name: 'Optimism', word: 'Optimism', cow: false },
]
export const ROBINHOOD_CHAIN_ID = 4663
export const HL_SIGNING_CHAIN_ID = 1337
export const AAVE_CHAIN_ID = 1
export const LIDO_CHAIN_ID = 1
export const SPOT_GUARD_CHAIN_ID = 8453

export const VENUE_CHAIN_LABELS: Record<number, string> = {
  1: 'Ethereum',
  8453: 'Base',
  42161: 'Arbitrum',
  10: 'Optimism',
  4663: 'Robinhood Chain',
  1337: 'Hyperliquid L1',
}
export const venueChainLabel = (id: number): string => VENUE_CHAIN_LABELS[id] ?? `chain ${id}`

/** Where a coin has Uniswap v3 depth worth a chip (cold table; the routes
 *  API quotes each chain live and a dead pair shows "—"). Absent = the
 *  Ethereum + Base pair the token list resolves for most majors. */
const SPOT_CHAIN_HINTS: Record<string, number[]> = {
  ETH: [8453, 1, 42161, 10],
  BTC: [8453, 1, 42161],
  ARB: [42161, 1],
  OP: [10, 1],
  AERO: [8453],
  LINK: [1, 8453, 42161],
  UNI: [1, 8453, 42161],
  AAVE: [1, 8453],
  MORPHO: [8453, 1],
}
const DEFAULT_SPOT_CHAINS = [1, 8453]

/** Aave v4 mainnet reserves we list cold (the routes API reads the live
 *  reserve list; a token that isn't there answers "—" and the supply layer
 *  refuses by name at build). */
const AAVE_RESERVE_COLD = new Set(['ETH', 'BTC', 'LINK', 'AAVE', 'UNI', 'LDO', 'CRV', 'MKR', 'SNX'])

/** Hyperliquid perps we list cold when the pair isn't already an HL chart
 *  (the live universe — lib/hl-universe — refines this server-side; kPEPE /
 *  kSHIB casing is deliberately left out of the cold set). */
const HL_PERP_COLD = new Set([
  'ETH', 'BTC', 'SOL', 'DOGE', 'XRP', 'ADA', 'AVAX', 'DOT', 'ATOM', 'NEAR', 'LINK', 'UNI', 'AAVE', 'LDO', 'CRV',
  'ARB', 'OP', 'SUI', 'APT', 'INJ', 'TIA', 'FIL', 'ONDO', 'ENA', 'WLD', 'JTO', 'JUP', 'EIGEN', 'MKR', 'COMP', 'SNX',
  'HYPE', 'SYRUP', 'FARTCOIN',
])

export const hasPerpCold = (symbol: string): boolean => HL_PERP_COLD.has(symbol.toUpperCase())
export const hasAaveReserveCold = (symbol: string): boolean => AAVE_RESERVE_COLD.has(symbol.toUpperCase())

const usdWord = (usd: number) => (Number.isInteger(usd) ? `$${usd}` : `$${usd.toFixed(2)}`)

/**
 * Every venue a wallet can act on `symbol` through, in the order a trader
 * reaches for them: spot → limit → perp → lend → stake → standing (DCA,
 * protect) → funding. Empty for a chartless symbol; stables never reach
 * here (chartPairFor refuses them first).
 */
export function venuesFor(symbol: string, pair: ChartPair, opts: VenuesOptions = {}): VenueRoute[] {
  const sym = (pair?.symbol ?? symbol).toUpperCase()
  const usd = opts.usd ?? DEFAULT_ROUTE_USD
  const dcaUsd = opts.dcaUsd ?? DEFAULT_ROUTE_DCA_USD
  const stopPct = opts.stopPct ?? DEFAULT_ROUTE_STOP_PCT
  const lev = opts.leverage && opts.leverage > 1 ? `${opts.leverage}x ` : ''
  const last = opts.last && Number.isFinite(opts.last) && opts.last > 0 ? opts.last : null
  const out: VenueRoute[] = []

  // ── Tokenized stocks: Robinhood Chain only ──
  if (pair.source === 'robinhood') {
    out.push({
      id: `stock:robinhood:${ROBINHOOD_CHAIN_ID}:buy`,
      kind: 'stock', venue: 'robinhood', chainId: ROBINHOOD_CHAIN_ID, side: 'buy', fee: 'swap',
      label: `Buy ${sym}`, ask: `Buy ${usdWord(usd)} of ${sym}`, mcp: 'robinhood-free',
      note: 'Settles in USDG on Robinhood Chain, 24/7. An empty wallet gets a funding path, not a wall.',
    })
    out.push({
      id: `stock:robinhood:${ROBINHOOD_CHAIN_ID}:sell`,
      kind: 'stock', venue: 'robinhood', chainId: ROBINHOOD_CHAIN_ID, side: 'sell', fee: 'swap',
      label: `Sell ${sym}`, ask: `Sell ${usdWord(usd)} of ${sym}`, mcp: 'robinhood-free', needs: 'position',
    })
    out.push({
      id: `dca:robinhood:${ROBINHOOD_CHAIN_ID}`,
      kind: 'dca', venue: 'pantessa', chainId: ROBINHOOD_CHAIN_ID, side: 'buy', fee: 'swap',
      label: 'DCA weekly', ask: `DCA ${usdWord(dcaUsd)} into ${sym} weekly`,
      note: 'Each period compiles a fresh guarded buy for you to sign — no double buys, cancel any time.',
    })
    for (const c of SPOT_CHAINS) {
      out.push({
        id: `fund:lifi:${c.id}`,
        kind: 'fund', venue: 'lifi', chainId: c.id, fee: 'lifi',
        label: `Fund from ${c.name}`,
        ask: `Fund Robinhood Chain with ${usdWord(usd)} from ${c.word} including gas, then buy ${usdWord(Math.max(1, Math.round(usd * 0.8)))} of ${sym}`,
        note: `USDC on ${c.name} → USDG + gas on Robinhood Chain, then the buy — one signed job.`,
      })
    }
    return out
  }

  const home = tokenHome(sym)
  const isPerpChart = pair.source === 'hyperliquid'

  // ── Spot (Uniswap v3 per chain) + limit (CoW where a book exists) ──
  if (!home && !isPerpChart) {
    const chains = SPOT_CHAIN_HINTS[sym] ?? DEFAULT_SPOT_CHAINS
    for (const id of chains) {
      const c = SPOT_CHAINS.find((x) => x.id === id)
      if (!c) continue
      out.push({
        id: `spot:uniswap:${id}:buy`, kind: 'spot', venue: 'uniswap', chainId: id, side: 'buy', fee: 'swap',
        label: `Buy on ${c.name}`, ask: `Buy ${usdWord(usd)} of ${sym} on ${c.word}`, mcp: 'uniswap-free',
      })
      out.push({
        id: `spot:uniswap:${id}:sell`, kind: 'spot', venue: 'uniswap', chainId: id, side: 'sell', fee: 'swap',
        label: `Sell on ${c.name}`, ask: `Sell ${usdWord(usd)} of ${sym} on ${c.word}`, mcp: 'uniswap-free', needs: 'position',
      })
    }
    if (last) {
      const limitPct = opts.limitPct ?? DEFAULT_ROUTE_LIMIT_PCT
      const units = fmtAskUnits(usd, last)
      for (const id of chains) {
        const c = SPOT_CHAINS.find((x) => x.id === id)
        if (!c || !c.cow || !units) continue
        const buyAt = last * (1 - limitPct / 100)
        const sellAt = last * (1 + limitPct / 100)
        const buyUsdc = fmtAskPrice(Number(units) * buyAt)
        const sellUsdc = fmtAskPrice(Number(units) * sellAt)
        out.push({
          id: `limit:cow:${id}:buy`, kind: 'limit', venue: 'cow', chainId: id, side: 'buy', fee: 'swap',
          label: `Limit buy on ${c.name}`,
          ask: `limit order: buy ${units} ${sym} for at most ${buyUsdc} USDC on ${c.word}`, mcp: 'cow-free',
          note: `Rests ${limitPct}% under market ($${fmtAskPrice(buyAt)}) — fills at-or-better, gasless, cancel any time.`,
        })
        out.push({
          id: `limit:cow:${id}:sell`, kind: 'limit', venue: 'cow', chainId: id, side: 'sell', fee: 'swap',
          label: `Limit sell on ${c.name}`,
          ask: `limit order: sell ${units} ${sym} for at least ${sellUsdc} USDC on ${c.word}`, mcp: 'cow-free', needs: 'position',
          note: `Rests ${limitPct}% over market ($${fmtAskPrice(sellAt)}).`,
        })
      }
    }
  }

  // ── Perps (Hyperliquid) ──
  if (isPerpChart || hasPerpCold(sym)) {
    out.push({
      id: `perp:hyperliquid:long`, kind: 'perp', venue: 'hyperliquid', chainId: HL_SIGNING_CHAIN_ID, side: 'buy', fee: 'hl',
      label: `${lev ? `${lev}long` : 'Long'} ${sym}`, ask: `${lev}Long ${usdWord(usd)} of ${sym} on Hyperliquid`, mcp: 'hyperliquid-free',
      note: lev ? `Sets ${lev.trim()} cross leverage venue-side first (signed 1/2), then the order (2/2).` : 'Fills at market (IOC) at the account’s current leverage.',
    })
    out.push({
      id: `perp:hyperliquid:short`, kind: 'perp', venue: 'hyperliquid', chainId: HL_SIGNING_CHAIN_ID, side: 'sell', fee: 'hl',
      label: `${lev ? `${lev}short` : 'Short'} ${sym}`, ask: `${lev}Short ${usdWord(usd)} of ${sym} on Hyperliquid`, mcp: 'hyperliquid-free',
    })
    out.push({
      id: `protect:hyperliquid`, kind: 'protect', venue: 'hyperliquid', chainId: HL_SIGNING_CHAIN_ID, fee: 'none', needs: 'position',
      label: 'Guardian stop', ask: `Protect my ${sym} long with a ${stopPct}% stop`, mcp: 'hyperliquid-free',
      note: 'The Guardian watches the venue every minute and closes the position at your stop — delegated, never custodial.',
    })
  }

  if (home) return out // non-EVM home: perps are the honest whole

  // ── Lend (Aave v4, Ethereum) ──
  if (hasAaveReserveCold(sym)) {
    out.push({
      id: `lend:aave:${AAVE_CHAIN_ID}:supply`, kind: 'lend', venue: 'aave', chainId: AAVE_CHAIN_ID, side: 'buy', fee: 'none',
      label: 'Supply on Aave', ask: `Supply ${usdWord(usd)} of ${sym} to Aave`, mcp: 'aave-free', needs: 'position',
      note: 'Earns the pool’s supply APY; the reply shows the best-rate spoke beside the default.',
    })
    out.push({
      id: `lend:aave:${AAVE_CHAIN_ID}:borrow`, kind: 'lend', venue: 'aave', chainId: AAVE_CHAIN_ID, side: 'sell', fee: 'none',
      label: 'Borrow on Aave', ask: `Borrow ${usdWord(usd)} of ${sym} from Aave`, mcp: 'aave-free', needs: 'position',
      note: 'Needs supplied collateral; the build previews your health factor before you sign.',
    })
  }

  // ── Stake (Lido, Ethereum) ──
  if (sym === 'ETH' && last) {
    const units = fmtAskUnits(usd, last)
    if (units) {
      out.push({
        id: `stake:lido:${LIDO_CHAIN_ID}`, kind: 'stake', venue: 'lido', chainId: LIDO_CHAIN_ID, side: 'buy', fee: 'none',
        label: 'Stake on Lido', ask: `Stake ${units} ETH on Lido`, mcp: 'lido-free',
        note: 'Receives stETH; earnings accrue daily. The guarded build keeps a gas buffer.',
      })
    }
  }

  // ── Standing: DCA + protect ──
  if (!isPerpChart) {
    out.push({
      id: `dca:pantessa`, kind: 'dca', venue: 'pantessa', chainId: SPOT_GUARD_CHAIN_ID, side: 'buy', fee: 'swap',
      label: 'DCA weekly', ask: `DCA ${usdWord(dcaUsd)} into ${sym} weekly`,
      note: 'Each period compiles a fresh guarded swap for you to sign — no double buys, cancel any time.',
    })
    out.push({
      id: `protect:spot:${SPOT_GUARD_CHAIN_ID}`, kind: 'protect', venue: 'pantessa', chainId: SPOT_GUARD_CHAIN_ID, fee: 'none', needs: 'position',
      label: 'Spot stop on Base', ask: `Protect my ${sym} in my wallet with a ${stopPct}% stop`,
      note: 'A one-shot Spend Permission on Base (smart wallets): the Guardian sells only if your line breaks. Signed once.',
    })
  }

  // ── Funding: bring money to where the symbol trades (NEAR Intents) ──
  if (!isPerpChart) {
    const dest = SPOT_CHAINS.find((c) => c.id === (SPOT_CHAIN_HINTS[sym] ?? DEFAULT_SPOT_CHAINS)[0])!
    for (const c of SPOT_CHAINS) {
      if (c.id === dest.id) continue
      out.push({
        id: `fund:near:${c.id}`, kind: 'fund', venue: 'near', chainId: c.id, fee: 'cross-chain',
        label: `Bring USDC from ${c.name}`,
        ask: `Swap ${Math.max(1, Math.round(usd))} USDC from ${c.word} to ${sym} on ${dest.word}`, mcp: 'near-intents',
        note: `USDC on ${c.name} → ${sym} on ${dest.name} through NEAR Intents — one deposit, settles in seconds.`,
      })
    }
  }

  return out
}

/** Why a kind is missing for this pair — named on the page, never silent. */
export function missingVenueNotes(symbol: string, pair: ChartPair): string[] {
  const sym = (pair?.symbol ?? symbol).toUpperCase()
  const notes: string[] = []
  if (pair.source === 'robinhood') {
    notes.push('No perp, lending or resting book for a tokenized stock — buys and sells fill at market on Robinhood Chain; a DCA schedule buys over time.')
    return notes
  }
  const home = tokenHome(sym)
  if (home) {
    notes.push(`${sym} lives on ${home} — Pantessa opens Hyperliquid perps on it; a spot buy here could only ever buy a Base look-alike.`)
    return notes
  }
  if (!hasPerpCold(sym) && pair.source !== 'hyperliquid') notes.push(`No Hyperliquid perp listed for ${sym} in the cold map — the live universe check may add one.`)
  if (!hasAaveReserveCold(sym)) notes.push(`${sym} isn’t an Aave v4 reserve we list — supply and borrow are off.`)
  if (sym !== 'ETH') notes.push('Lido stakes ETH only.')
  return notes
}

/** The kinds present, in display order. */
export const VENUE_KIND_ORDER: VenueKind[] = ['spot', 'limit', 'stock', 'perp', 'lend', 'stake', 'dca', 'protect', 'fund']

export const VENUE_KIND_LABEL: Record<VenueKind, string> = {
  spot: 'Spot',
  limit: 'Limit',
  perp: 'Perp',
  lend: 'Lend',
  stake: 'Stake',
  dca: 'DCA',
  protect: 'Protect',
  fund: 'Fund',
  stock: 'Stock',
}

export const VENUE_NAME: Record<string, string> = {
  uniswap: 'Uniswap',
  cow: 'CoW Swap',
  hyperliquid: 'Hyperliquid',
  aave: 'Aave',
  lido: 'Lido',
  near: 'NEAR Intents',
  lifi: 'LiFi',
  robinhood: 'Robinhood Chain',
  pantessa: 'Pantessa',
}
