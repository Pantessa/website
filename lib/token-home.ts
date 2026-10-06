// ─────────────────────────────────────────────────────────────────────────
//  Where a coin actually LIVES. Base's permissionless token list carries a
//  "SOL", a "DOGE", a "DOT" — bridged copies and outright squats — so "Buy
//  $50 of SOL" (the chart overlay's own chip on a SOL chart) used to book a
//  USDC → squat swap on Base, and "DCA $10 into SOL weekly" a STANDING
//  schedule buying it. Same class as the AAPL-on-Base squat (2026-07-30):
//  a curated fact beats the dynamic list. Pure + client-safe: the route's
//  refusal, the DCA layer, the chart overlay's chips and the audit ladder
//  all read this one table. The honest next step for these coins is the
//  Hyperliquid perp (the venue validates the coin live — nothing here
//  promises a listing), never a squat swap and never a cross-chain leg
//  Pantessa can't deliver (an EVM wallet has no Solana address).
// ─────────────────────────────────────────────────────────────────────────

/** Symbol → the chain the real coin lives on. BTC is deliberately absent —
 *  cbBTC/WBTC on Base and Ethereum are the real thing, not squats. */
const HOMES: Record<string, string> = {
  SOL: 'Solana',
  JUP: 'Solana',
  JTO: 'Solana',
  AVAX: 'Avalanche',
  POL: 'Polygon',
  MATIC: 'Polygon',
  BNB: 'BNB Chain',
  NEAR: 'NEAR',
  TON: 'TON',
  TRX: 'Tron',
  SUI: 'Sui',
  XRP: 'the XRP Ledger',
  ADA: 'Cardano',
  DOGE: 'Dogecoin',
  DOT: 'Polkadot',
  ATOM: 'Cosmos',
  APT: 'Aptos',
  TIA: 'Celestia',
  INJ: 'Injective',
  FIL: 'Filecoin',
  LTC: 'Litecoin',
  XLM: 'Stellar',
  HBAR: 'Hedera',
  ALGO: 'Algorand',
  XMR: 'Monero',
  BCH: 'Bitcoin Cash',
  KAS: 'Kaspa',
}

/** The coin's home chain name when it is NOT an EVM-native asset on
 *  Pantessa's chains, else null. */
export function tokenHome(symbol: string | undefined | null): string | null {
  if (!symbol) return null
  const sym = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '')
  return HOMES[sym] ?? null
}

// ─────────────────────────────────────────────────────────────────────────
//  EVM homes — where a coin's SPOT MARKET lives among Pantessa's own chains.
//
//  "Buy $50 of UNI" from the /t/UNI chip names no chain; the picker said ALL
//  CHAINS; the build landed on Base's 1% pool on a bridged copy of UNI, and
//  so did the typed "let's buy $2 worth of uni" that followed (2026-10-06,
//  prod, twice). Nate: "no one buys UNI on Base" — a token issued on
//  Ethereum keeps its depth there; a Base-born memecoin has nothing anywhere
//  else. The chat route's home-chain inference (lib/spot-chain-infer), the
//  symbol page's venue map (lib/symbol-venues) and the funding destination
//  all read THIS table, so a chip and a typed ask agree on where a coin
//  trades. Hand-verified against the Uniswap default list's bridge
//  provenance (an Ethereum entry fans out to its L2 copies; each copy points
//  back to chain 1) and the routes API's live quotes; a symbol absent here
//  is measured (the depth probe) or falls to the registry default.
//
//  The FIRST entry is the home. ETH and BTC lead with Base on purpose: a gas
//  coin trades deep everywhere and Base is the cheapest place to sign.
// ─────────────────────────────────────────────────────────────────────────

/** Symbol → its spot chains, deepest first. */
export const EVM_SPOT_CHAINS: Record<string, readonly number[]> = {
  // Gas coins and the BTC wrappers trade deep on every chain — Base leads.
  ETH: [8453, 1, 42161, 10],
  BTC: [8453, 1, 42161],
  // Ethereum-born, Ethereum-deep.
  UNI: [1, 8453, 42161],
  LINK: [1, 8453, 42161],
  AAVE: [1, 8453],
  MKR: [1, 8453],
  LDO: [1, 8453],
  CRV: [1, 8453],
  SNX: [1, 10],
  COMP: [1, 8453],
  ENS: [1, 8453],
  PEPE: [1, 8453],
  SHIB: [1, 8453],
  MANA: [1, 8453],
  SAND: [1, 8453],
  GRT: [1, 42161],
  YFI: [1, 8453],
  SUSHI: [1, 8453],
  ONDO: [1, 8453],
  ENA: [1, 8453],
  EIGEN: [1, 8453],
  RPL: [1, 8453],
  FXS: [1, 8453],
  BAL: [1, 8453],
  ZRX: [1, 8453],
  BAT: [1, 8453],
  '1INCH': [1, 8453],
  APE: [1, 8453],
  IMX: [1, 8453],
  PENDLE: [1, 42161],
  LRC: [1, 8453],
  DYDX: [1, 8453],
  LPT: [1, 42161],
  RENDER: [1, 8453],
  FET: [1, 8453],
  CVX: [1, 8453],
  STETH: [1, 8453],
  WSTETH: [1, 8453, 42161],
  RETH: [1, 8453],
  // Arbitrum-born.
  ARB: [42161, 1],
  GMX: [42161],
  MAGIC: [42161],
  RDNT: [42161],
  // Optimism-born.
  OP: [10, 1],
  VELO: [10],
  WLD: [10],
  KWENTA: [10],
  // Base-born.
  AERO: [8453],
  DEGEN: [8453],
  BRETT: [8453],
  VIRTUAL: [8453, 1],
  TOSHI: [8453],
  WELL: [8453],
  HIGHER: [8453],
  MORPHO: [8453, 1],
}

const normSym = (symbol: string): string => symbol.toUpperCase().replace(/[^A-Z0-9.]/g, '')

/** The coin's spot chains (deepest first), or null for a symbol the table
 *  doesn't carry (callers measure, or fall to their own default). */
export function spotChainsFor(symbol: string | undefined | null): readonly number[] | null {
  if (!symbol) return null
  return EVM_SPOT_CHAINS[normSym(symbol)] ?? null
}

/** The coin's HOME chain id (the first spot chain), or null when unknown. */
export function spotHomeChainId(symbol: string | undefined | null): number | null {
  const chains = spotChainsFor(symbol)
  return chains && chains.length > 0 ? chains[0] : null
}

export type SpotChainReason = 'home' | 'only-listed' | 'held' | 'deepest' | 'default'

/** One chain's measured depth for a sized buy (lib/usd-probe spotDepthProbe). */
export interface SpotDepthFact {
  chainId: number
  /** Whole tokens out per dollar at the probe size (the fill, fee included). */
  outPerUsd: number
  /** How much the per-dollar fill decays between half the size and the full
   *  size, in bps — null when too small to measure. */
  decayBps: number | null
  /** The decay sat inside the depth fence (lib/usd-probe judgePoolDepth). */
  trusted: boolean
}

export interface SpotChainFacts {
  /** The token whose market decides the chain (the buy token; the sell token
   *  for a bare sell or a sell into a stable). */
  symbol: string
  side: 'buy' | 'sell'
  /** The chain the route would use with nothing named and nothing picked. */
  targetChainId: number
  /** Registry chains the symbol resolves on (static pin or warmed list), or
   *  null when the lists never warmed (the table is trusted alone then). */
  listedOn: readonly number[] | null
  /** The symbol is a hand-pinned registry token on the target chain (ETH,
   *  WETH, USDC, the chain's own coin): a flagship there never moves. */
  pinnedOnTarget?: boolean
  /** For a sell: whole units the wallet holds per chain (every chain the
   *  read covered, zeros included); null/absent = unread. */
  heldOn?: readonly { chainId: number; units: number }[] | null
  /** For a sell: chains whose balance read FAILED (a timeout, a rate limit).
   *  Nothing held on the chains that answered plus a chain nobody read is
   *  no evidence to move the sell anywhere — it stays on the target. */
  heldUnread?: readonly number[] | null
  /** For a buy of a symbol the table doesn't carry: the measured depth on
   *  every listed chain; absent = not measured. */
  depth?: readonly SpotDepthFact[] | null
}

export interface SpotChainVerdict {
  chainId: number
  reason: SpotChainReason
  /** One trace-sized phrase: why this chain. */
  note: string
}

const CHAIN_NAME: Record<number, string> = { 1: 'Ethereum', 8453: 'Base', 42161: 'Arbitrum', 10: 'Optimism', 4663: 'Robinhood Chain', 5042: 'Arc' }
export const spotChainName = (id: number): string => CHAIN_NAME[id] ?? `chain ${id}`

/**
 * Which chain a swap with NO chain named and NO chain picked builds on. Pure:
 * the route hands it what the lists, the wallet and the probe said.
 *
 *   · pinned on the target  → the target (ETH on Base stays on Base).
 *   · a SELL                → where the wallet HOLDS the token (the most
 *                             units wins); a chain whose read failed and
 *                             nothing held elsewhere → the target (no
 *                             evidence); nothing held anywhere read → the
 *                             home, else the only chain that lists it, else
 *                             the target.
 *   · a BUY                 → the HOME chain when the table has one and the
 *                             token resolves there; else the only chain
 *                             that lists it; else the deepest measured pool
 *                             (a trusted fence beats an untrusted one, then
 *                             more token per dollar); else the target.
 *
 * The verdict's chainId may equal the target: the caller compares.
 */
export function inferSpotChain(f: SpotChainFacts): SpotChainVerdict {
  const sym = normSym(f.symbol)
  const target = f.targetChainId
  const byDefault = (why: string): SpotChainVerdict => ({ chainId: target, reason: 'default', note: why })
  if (f.pinnedOnTarget) return byDefault(`${sym} is a registry token on ${spotChainName(target)}`)
  const listed = f.listedOn
  const isListed = (id: number): boolean => (listed === null ? true : listed.includes(id))
  const home = spotHomeChainId(sym)
  if (f.side === 'sell') {
    const held = (f.heldOn ?? []).filter((h) => Number.isFinite(h.units) && h.units > 0 && isListed(h.chainId))
    if (held.length > 0) {
      const best = held.reduce((a, b) => (b.units > a.units ? b : a))
      return { chainId: best.chainId, reason: 'held', note: `the wallet holds ${sym} on ${spotChainName(best.chainId)}` }
    }
    // A chain the read never answered may be exactly where the token sits
    // (2026-10-06: a rate-limited Base read turned a Base-held UNI sell into
    // an Ethereum one). No evidence is no reason to move: stay put.
    const unread = (f.heldUnread ?? []).filter((id) => isListed(id))
    if (unread.length > 0) return byDefault(`${sym} holdings on ${unread.map(spotChainName).join(' and ')} couldn't be read — ${spotChainName(target)} by default`)
  }
  if (home !== null && isListed(home)) {
    if (home === target) return byDefault(`${sym}'s home chain is ${spotChainName(target)} already`)
    return { chainId: home, reason: 'home', note: `${sym}'s market is on ${spotChainName(home)} (its home chain), not ${spotChainName(target)}` }
  }
  if (listed && listed.length === 1) {
    if (listed[0] === target) return byDefault(`${sym} is listed on ${spotChainName(target)} only`)
    return { chainId: listed[0], reason: 'only-listed', note: `${spotChainName(listed[0])} is the only chain of ours that lists ${sym}` }
  }
  if (f.side === 'buy' && f.depth && f.depth.length >= 2) {
    const live = f.depth.filter((d) => Number.isFinite(d.outPerUsd) && d.outPerUsd > 0)
    const trusted = live.filter((d) => d.trusted)
    const pool = trusted.length > 0 ? trusted : live
    if (pool.length > 0) {
      const best =
        trusted.length > 0
          ? pool.reduce((a, b) => (b.outPerUsd > a.outPerUsd ? b : a))
          : pool.reduce((a, b) => ((b.decayBps ?? Infinity) < (a.decayBps ?? Infinity) ? b : a))
      if (best.chainId === target) return byDefault(`${sym}'s deepest pool among our chains is on ${spotChainName(target)}`)
      return { chainId: best.chainId, reason: 'deepest', note: `${sym}'s deepest pool among our chains is on ${spotChainName(best.chainId)} (measured), not ${spotChainName(target)}` }
    }
  }
  return byDefault(`nothing says ${sym} trades better elsewhere — ${spotChainName(target)} by default`)
}

/** The one line a built swap opens with when the chain was inferred (the
 *  reply, not the trace): where it built and how to say otherwise. */
export function spotChainLine(v: SpotChainVerdict, symbol: string): string {
  const sym = normSym(symbol)
  const where = spotChainName(v.chainId)
  switch (v.reason) {
    case 'home':
      return `${sym}'s market is on ${where}, so this builds there — say the chain ("… on Base") to buy it elsewhere.`
    case 'held':
      return `You hold ${sym} on ${where}, so this builds there.`
    case 'only-listed':
      return `${where} is the only chain of ours that lists ${sym}, so this builds there.`
    case 'deepest':
      return `${sym}'s deepest pool among our chains is on ${where} (measured just now), so this builds there — say the chain to use another.`
    case 'default':
      return `Building on ${where}.`
  }
}
