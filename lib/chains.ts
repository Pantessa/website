// ─────────────────────────────────────────────────────────────────────────
//  App chain registry — the single source of truth for the chains Pantessa
//  treats as first-class: the chat chain picker, the splash card scoping,
//  the native swap layer's per-chain routers/tokens, and the wagmi config
//  all read THIS list. Adding a chain here lights it up everywhere (picker,
//  cards, swaps, network switching) — no other registry to update.
//
//  Address provenance (never from a model): Uniswap contract addresses are
//  from the official deployments registry (github.com/Uniswap/contracts →
//  deployments/<chainId>.md, fetched 2026-07-13) and each Robinhood address
//  was verified live via eth_getCode against the chain's public RPC before
//  landing here. Stable-coin addresses come from the canonical issuers'
//  well-known deployments (and on Robinhood from the chain's own top-holder
//  registry — USDC does not exist there; USDG/USDe are the money tokens).
// ─────────────────────────────────────────────────────────────────────────

import { defineChain, createPublicClient, fallback, http, type Chain, type PublicClient } from 'viem'
import { base, mainnet, arbitrum, optimism } from 'viem/chains'

// Robinhood Chain (Arbitrum Orbit L2, mainnet 2026-07-01) — not in viem's
// bundled chains yet. lib/wagmi.ts imports this (the definition moved here
// so server code can use the chain without pulling in wallet connectors).
export const robinhoodChain = defineChain({
  id: 4663,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.mainnet.chain.robinhood.com'] } },
  blockExplorers: {
    default: { name: 'Robinhood Chain Explorer', url: 'https://robinhoodchain.blockscout.com' },
  },
})

// Circle's Arc (L1, mainnet 2026-09-16; viem 2.56 ships `arc`, our 2.48 has
// only the testnet). USDC IS the gas token: the native view is 18 decimals
// (eth_getBalance / msg.value / gas) and the ERC-20 view at 0x3600…0000 is
// 6 decimals — the SAME asset, never summed (see nativeSymbol below). The
// chain default RPC is dRPC's public Arc endpoint, measured 2026-09-16:
// full archive depth (reads at −100,000 blocks ok), CORS `*`, 25 parallel
// reads in 0.5s, receipts served. Circle's rpc.mainnet.arc.io rate-limits
// receipt polling and eth_getLogs, so it is not the browser transport.
export const arcChain = defineChain({
  id: 5042,
  name: 'Arc',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.drpc.mainnet.arc.io'] } },
  blockExplorers: {
    default: { name: 'Arc Explorer', url: 'https://explorer.arc.io', apiUrl: 'https://explorer.arc.io/api/v2' },
  },
  contracts: { multicall3: { address: '0xcA11bde05977b3631167028862bE2a173976CA11', blockCreated: 0 } },
})

export interface AppChainToken {
  address: `0x${string}`
  decimals: number
}

export interface AppChain {
  id: number
  /** Stable slug — URL params, store state, splash scoping. */
  key: string
  name: string
  /** Short label for tight UI (the picker chip). */
  short: string
  /** Brand color for the picker ring / accents. */
  color: string
  viem: Chain
  /** Alchemy network key (portfolio/activity reads) — must match lib/alchemy.ts. */
  alchemyNet: string
  /** Server-side RPC override when the viem default is unusable (mainnet's
   *  default eth.merkle.io Cloudflare-blocks many networks — same reason
   *  lib/wagmi.ts pins publicnode for the browser). */
  rpcUrl?: string
  /** Server-side: front the chain's reads with Alchemy's JSON-RPC for
   *  `alchemyNet` when ALCHEMY_API_KEY is set (the public RPC stays as the
   *  fallback). Opt-in per chain, and only after MEASURING the endpoint —
   *  the publicnode lesson (#710). Never reaches the browser bundle: the key
   *  is server-only and `serverRpcEndpoints` is window-guarded. */
  alchemyRpc?: boolean
  /** What pays for gas here. 'ETH' on every EVM chain we knew before Arc;
   *  'USDC' on Arc, where the native token IS the primary stable (18-dec
   *  native view, 6-dec ERC-20 view at `tokens.USDC`). Every "no ETH for
   *  gas" rule keys off this — see gasIsStable(). */
  nativeSymbol: 'ETH' | 'USDC'
  /** Words that name this chain in a message ("on arbitrum", "on robinhood"). */
  words: RegExp
  /** Uniswap v3 build support — null means no native venue on this chain. */
  uniswap: { swapRouter02: `0x${string}`; quoterV2: `0x${string}` } | null
  /** Uniswap v4 FALLBACK — only consulted when v3 has no pool for a pair
   *  (Robinhood's tokenized stocks are v4-only; WETH↔USDG stays on v3).
   *  null = no v4 fallback on this chain. */
  uniswapV4: { quoter: `0x${string}`; universalRouter: `0x${string}`; permit2: `0x${string}` } | null
  /** CoW Protocol order-book support (must also exist in COW_API_BASE). */
  cow: boolean
  wrappedNative: `0x${string}`
  /** USD-pegged tokens (lowercase address → decimals) — prices guardrail valueUsd. */
  stables: Record<string, number>
  /** Hand-pinned symbol map so the flagship tokens resolve without the dynamic list. */
  tokens: Record<string, AppChainToken>
  explorerTx: string
}

export const APP_CHAINS: AppChain[] = [
  {
    id: 8453,
    key: 'base',
    name: 'Base',
    short: 'Base',
    color: '#0052ff',
    viem: base,
    alchemyNet: 'base-mainnet',
    nativeSymbol: 'ETH',
    // viem's default (mainnet.base.org) rate-limits in bursts — the same
    // 429 pattern that hit mainnet (see the Ethereum entry) and once made a
    // funding scan miss a $15k balance. publicnode holds up.
    rpcUrl: 'https://base-rpc.publicnode.com',
    words: /\bbase\b/i,
    uniswap: {
      swapRouter02: '0x2626664c2603336E57B271c5C0b26F421741e481',
      quoterV2: '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a',
    },
    uniswapV4: null,
    cow: true,
    wrappedNative: '0x4200000000000000000000000000000000000006',
    stables: {
      '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': 6, // USDC
      '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca': 6, // USDbC
      '0x50c5725949a6f0c72e6c4a641f24049a917db0cb': 18, // DAI
    },
    tokens: {
      USDC: { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6 },
      USDBC: { address: '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA', decimals: 6 },
      DAI: { address: '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb', decimals: 18 },
      WETH: { address: '0x4200000000000000000000000000000000000006', decimals: 18 },
      ETH: { address: '0x4200000000000000000000000000000000000006', decimals: 18 },
      CBETH: { address: '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22', decimals: 18 },
    },
    explorerTx: 'https://basescan.org/tx/',
  },
  {
    id: 1,
    key: 'ethereum',
    name: 'Ethereum',
    short: 'Ethereum',
    color: '#627eea',
    viem: mainnet,
    alchemyNet: 'eth-mainnet',
    nativeSymbol: 'ETH',
    rpcUrl: 'https://ethereum-rpc.publicnode.com',
    words: /\b(?:ethereum|eth\s?mainnet|mainnet)\b/i,
    uniswap: {
      swapRouter02: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
      quoterV2: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
    },
    uniswapV4: null,
    cow: true,
    wrappedNative: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    stables: {
      '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 6, // USDC
      '0xdac17f958d2ee523a2206206994597c13d831ec7': 6, // USDT
      '0x6b175474e89094c44da98b954eedeac495271d0f': 18, // DAI
    },
    tokens: {
      USDC: { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
      USDT: { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 },
      DAI: { address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', decimals: 18 },
      WETH: { address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', decimals: 18 },
      ETH: { address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', decimals: 18 },
      WBTC: { address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', decimals: 8 },
    },
    explorerTx: 'https://etherscan.io/tx/',
  },
  {
    id: 42161,
    key: 'arbitrum',
    name: 'Arbitrum',
    short: 'Arbitrum',
    color: '#1b4add',
    viem: arbitrum,
    alchemyNet: 'arb-mainnet',
    nativeSymbol: 'ETH',
    rpcUrl: 'https://arbitrum-one-rpc.publicnode.com',
    words: /\barb(?:itrum|itum)?\b/i, // "arbitum" = live typo, matched deliberately
    uniswap: {
      swapRouter02: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
      quoterV2: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
    },
    uniswapV4: null,
    cow: true,
    wrappedNative: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
    stables: {
      '0xaf88d065e77c8cc2239327c5edb3a432268e5831': 6, // USDC (native)
      '0xff970a61a04b1ca14834a43f5de4533ebddb5cc8': 6, // USDC.e
      '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9': 6, // USDT
      '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1': 18, // DAI
    },
    tokens: {
      USDC: { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6 },
      USDT: { address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', decimals: 6 },
      DAI: { address: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1', decimals: 18 },
      WETH: { address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', decimals: 18 },
      ETH: { address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', decimals: 18 },
      ARB: { address: '0x912CE59144191C1204E64559FE8253a0e49E6548', decimals: 18 },
    },
    explorerTx: 'https://arbiscan.io/tx/',
  },
  {
    id: 10,
    key: 'optimism',
    name: 'Optimism',
    short: 'Optimism',
    color: '#ff0420',
    viem: optimism,
    alchemyNet: 'opt-mainnet',
    nativeSymbol: 'ETH',
    // NO rpcUrl override: viem's default (mainnet.optimism.io) measured
    // clean 2026-09-04 — full archive depth, 25 concurrent reads in 0.8s.
    // The publicnode override that was here first is what broke the initial
    // live run (see lib/wagmi.ts); the 429 risk it was guarding against is
    // real on Base/mainnet but was never measured on Optimism.
    // Unlike base/arbitrum, "optimism" is an everyday finance noun ("I have
    // optimism about ETH") — so only a CHAIN SLOT names the chain: after a
    // preposition, or before "chain". The lexicon's prep-gated shorts do the
    // same for sol/btc/op. Pinned in test:api.
    words: /(?:\b(?:on|from|to|into|onto)\s+optim(?:ism|sim|isim)\b|\boptim(?:ism|sim|isim)\s+chain\b)/i,
    // Same canonical SwapRouter02 / QuoterV2 addresses as Ethereum and
    // Arbitrum (deployments/10.md); bytecode verified via eth_getCode and a
    // live quoteExactInputSingle (1 USDC -> 0.00039380 WETH, 0.05% pool)
    // 2026-09-04 before landing here.
    uniswap: {
      swapRouter02: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
      quoterV2: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
    },
    // No v4 fallback needed: v3 has the pools for everything we route here
    // (the v4 lane exists for Robinhood's stock-only pools).
    uniswapV4: null,
    // CoW has no Optimism order book (api.cow.fi/optimism 404s, probed
    // 2026-09-04) — limit orders stay off this chain, swaps ride v3.
    cow: false,
    wrappedNative: '0x4200000000000000000000000000000000000006',
    // Both USDC deployments live here: native (Circle) and the legacy
    // bridged one. The bridged contract's on-chain symbol() is literally
    // "USDC" even though every explorer and LiFi call it USDC.e — a wallet
    // holding only bridged USDC must never read as "no USDC on Optimism"
    // (the Arbitrum USDC.e bite, one chain over).
    stables: {
      '0x0b2c639c533813f4aa9d7837caf62653d097ff85': 6, // USDC (native)
      '0x7f5c764cbc14f9669b88837ca1490cca17c31607': 6, // USDC.e (bridged)
      '0x94b008aa00579c1307b0ef2c499ad98a8ce58e58': 6, // USDT
      '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1': 18, // DAI
    },
    tokens: {
      USDC: { address: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', decimals: 6 },
      USDT: { address: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58', decimals: 6 },
      DAI: { address: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1', decimals: 18 },
      WETH: { address: '0x4200000000000000000000000000000000000006', decimals: 18 },
      ETH: { address: '0x4200000000000000000000000000000000000006', decimals: 18 },
      OP: { address: '0x4200000000000000000000000000000000000042', decimals: 18 },
    },
    explorerTx: 'https://optimistic.etherscan.io/tx/',
  },
  {
    id: 4663,
    key: 'robinhood',
    name: 'Robinhood Chain',
    short: 'Robinhood',
    color: '#ccff00',
    viem: robinhoodChain,
    alchemyNet: 'robinhood-mainnet',
    nativeSymbol: 'ETH',
    // rpc.mainnet.chain.robinhood.com rate-limits per IP ("Rate Limit Hit,
    // limit will reset in 60 seconds") and Vercel's egress IPs are shared —
    // 2026-09-15 a funded OP→USDG funding leg and (09-08) a USDG→SPY buy
    // both died on ONE balanceOf read there. Alchemy's robinhood-mainnet
    // JSON-RPC measured 2026-09-15: chainId 4663, eth_call at latest AND
    // 5,000 blocks back, eth_estimateGas, eth_getCode, 20 parallel calls
    // all 200. It leads on the server; the public RPC is the fallback.
    alchemyRpc: true,
    words: /\brobinhood(?:\s+chain)?\b/i,
    // v2/v3/v4 live day one (blog.uniswap.org/robinhood-chain-is-live);
    // addresses from deployments/4663.md, bytecode verified via eth_getCode.
    uniswap: {
      swapRouter02: '0xcaf681a66d020601342297493863e78c959e5cb2',
      quoterV2: '0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7',
    },
    // v4 fallback for the pairs v3 can't fill — the 100 tokenized stocks
    // (AAPL/TSLA/…) trade in v4-ONLY pools quoted against USDG. Addresses
    // from deployments/4663.md, bytecode verified via eth_getCode 2026-07-13.
    uniswapV4: {
      quoter: '0x8dc178efb8111bb0973dd9d722ebeff267c98f94',
      universalRouter: '0x8876789976decbfcbbbe364623c63652db8c0904',
      permit2: '0x000000000022d473030f116ddee9f6b43ac78ba3',
    },
    cow: false,
    wrappedNative: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73',
    // No USDC on Robinhood Chain — USDG (Global Dollar) and USDe are the
    // money tokens (top-holder ERC-20s, blockscout-verified 2026-07-13).
    stables: {
      '0x5fc5360d0400a0fd4f2af552add042d716f1d168': 6, // USDG
      '0x5d3a1ff2b6bab83b63cd9ad0787074081a52ef34': 18, // USDe
    },
    tokens: {
      USDG: { address: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168', decimals: 6 },
      USDE: { address: '0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34', decimals: 18 },
      WETH: { address: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73', decimals: 18 },
      ETH: { address: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73', decimals: 18 },
    },
    explorerTx: 'https://robinhoodchain.blockscout.com/tx/',
  },
  {
    id: 5042,
    key: 'arc',
    name: 'Arc',
    short: 'Arc',
    color: '#1b3059',
    viem: arcChain,
    alchemyNet: 'arc-mainnet',
    // Alchemy carries ARC_MAINNET but it is not enabled on our app yet
    // (lib/alchemy gates the Data API on a live probe); the server client
    // fronts with QuickNode's public Arc endpoint, measured 2026-09-16:
    // full archive, 25 parallel reads in 0.7s, receipts served.
    rpcUrl: 'https://rpc.quicknode.mainnet.arc.io',
    // USDC is the gas token (see arcChain above).
    nativeSymbol: 'USDC',
    // "arc" is an English noun (the arc of a trade, an arc lamp), so only a
    // CHAIN SLOT names the chain — after a preposition, before "chain /
    // network / mainnet", or as "Circle's Arc". Same rule as "optimism".
    words: /(?:\b(?:on|from|to|into|onto)\s+(?:circle'?s?\s+)?arc\b|\barc\s+(?:chain|network|mainnet)\b|\bcircle'?s?\s+arc\b)/i,
    // Uniswap v3 + v4 both deployed day one (github.com/Uniswap/contracts
    // deployments/5042.md); every address bytecode-verified via eth_getCode
    // 2026-09-16 and a live quoteExactInputSingle ($10 USDC → 8.656 EURC on
    // the 0.05% pool; $10 USDC → 0.00013213 cirBTC on the 0.3% pool). The
    // USDC/WETH 0.05% pool exists but had no liquidity at launch.
    uniswap: {
      swapRouter02: '0x53BF6B0684Ec7eF91e1387Da3D1a1769bC5A6F77',
      quoterV2: '0x7DfD4F31be6814D2906BDE155c3e1B146EAc1468',
    },
    // No v4 fallback pinned yet: the pairs that trade (USDC/EURC, USDC/
    // cirBTC) are v3; the v4 PoolManager (0x8366…0951) waits on a live pool
    // scan before it earns a slot here.
    uniswapV4: null,
    // CoW has no Arc order book (api.cow.fi has no arc route) — swaps ride v3.
    cow: false,
    // The "wrapped native" IS the ERC-20 view of USDC — no WETH-style wrap
    // exists for a stable-gas chain. Consumers that treat wrappedNative as
    // WETH (watchlist symbol mapping, wrap-then-sell) check nativeSymbol.
    wrappedNative: '0x3600000000000000000000000000000000000000',
    // EURC is NOT a USD stable (≈ $1.15) — only USDC prices as $1 here.
    stables: {
      '0x3600000000000000000000000000000000000000': 6, // USDC (native + ERC-20 view)
    },
    // symbol()/decimals() read on-chain 2026-09-16 for every row. BTC and
    // EUR are ask-side aliases: "buy $10 of BTC on arc" is cirBTC (Circle's
    // native bitcoin on Arc), "swap $10 to EUR" is EURC. No ETH key on
    // purpose — ETH is not native here and the WETH pool was empty at
    // launch, so an "ETH" ask refuses by name instead of wrapping USDC.
    tokens: {
      USDC: { address: '0x3600000000000000000000000000000000000000', decimals: 6 },
      EURC: { address: '0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1', decimals: 6 },
      EUR: { address: '0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1', decimals: 6 },
      CIRBTC: { address: '0x171A4217b86A807A64eB94757Db6849fb4bDbAA0', decimals: 8 },
      BTC: { address: '0x171A4217b86A807A64eB94757Db6849fb4bDbAA0', decimals: 8 },
      WETH: { address: '0x128cC466B61f542da60c70e3aA11c10e19B84EDB', decimals: 18 },
    },
    explorerTx: 'https://explorer.arc.io/tx/',
  },
]

/** True when the chain's gas token is its primary stable (Arc): there is no
 *  ETH to run out of, an all-stable sell/send must keep a sliver back for
 *  gas, and "no ETH for gas" copy must say the real token. */
export const gasIsStable = (chain: Pick<AppChain, 'nativeSymbol'>): boolean => chain.nativeSymbol !== 'ETH'

/** Gas kept back on a stable-gas chain when the STABLE itself is sold or
 *  sent in full — whole units of that stable. Arc measured 2026-09-16:
 *  gasPrice ≈ 92.5 gwei-equivalent in the 18-dec native view, so a 200k-gas
 *  swap costs ≈ $0.0185; 0.10 USDC covers several transactions. */
export const STABLE_GAS_RESERVE = 0.1
/** Below this much of its stable a stable-gas chain can't sign a plain move. */
export const STABLE_GAS_FLOOR = 0.02

/** The gas token's symbol for a chain id ('ETH' for unknown ids). */
export function nativeSymbolFor(chainId: number): 'ETH' | 'USDC' {
  return chainById(chainId)?.nativeSymbol ?? 'ETH'
}

export const DEFAULT_CHAIN_ID = 8453

const BY_ID = new Map(APP_CHAINS.map((c) => [c.id, c]))
const BY_KEY = new Map(APP_CHAINS.map((c) => [c.key, c]))

export function chainById(id: number | null | undefined): AppChain | null {
  return (id != null && BY_ID.get(id)) || null
}

export function chainByKey(key: string | null | undefined): AppChain | null {
  return (key && BY_KEY.get(key.toLowerCase())) || null
}

/** The chain's primary $1 unit-of-account (USDC on Base, USDG on Robinhood)
 *  — the first pinned token that's also in the stables map. Used to price
 *  dollar-denominated swap asks ("$1 worth of ETH") and as the default spend
 *  token for "buy $5 of AAPL". */
export function primaryStable(chainId: number): { symbol: string; address: `0x${string}`; decimals: number } | null {
  const chain = BY_ID.get(chainId)
  if (!chain) return null
  for (const [symbol, t] of Object.entries(chain.tokens)) {
    if (chain.stables[t.address.toLowerCase()] !== undefined) return { symbol, ...t }
  }
  return null
}

/** Explorer token page for a contract on a first-class chain — the ⓘ "more
 *  info" target splash holding rows carry. Accepts a chain id or the human
 *  label rows use ("Ethereum", "Robinhood Chain"); native pseudo-holdings
 *  (zero/absent address) get null. Etherscan-family and Blockscout explorers
 *  both serve /token/{address}. */
export function explorerTokenUrl(chain: string | number, address: string | null | undefined): string | null {
  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address) || /^0x0{40}$/.test(address)) return null
  const c =
    typeof chain === 'number'
      ? chainById(chain)
      : APP_CHAINS.find((x) => x.name.toLowerCase() === chain.toLowerCase() || x.short.toLowerCase() === chain.toLowerCase()) ?? null
  return c ? c.explorerTx.replace(/\/tx\/$/, '/token/') + address : null
}

/** The chain a message names ("on arbitrum", "on robinhood") — null if none. */
export function chainNamedIn(message: string): AppChain | null {
  for (const c of APP_CHAINS) if (c.words.test(message)) return c
  return null
}

/** Validate an untrusted picker value from the client (chat/splash POST bodies). */
export function sanitizeChainId(v: unknown): number | null {
  return typeof v === 'number' && BY_ID.has(v) ? v : null
}

// Per-chain viem clients for quotes + allowance/balance reads, lazily created
// and cached per runtime. Base keeps its dedicated client in lib/auth.ts (SIWE
// depends on it); this factory serves the multi-chain swap path.
const clients = new Map<number, PublicClient>()

/** One server-side RPC endpoint: the URL viem prints in its errors, plus any
 *  auth header. The Alchemy key rides in `Authorization: Bearer` with a bare
 *  `/v2/` path (probed 2026-09-15: 200 with the header, 401 "Must be
 *  authenticated!" without), so a viem error's "URL: …" line — which the
 *  runner persists on the job step and the chat prints — never carries it. */
export type ServerRpcEndpoint = { url: string; headers?: Record<string, string> }

/** The RPC endpoints a SERVER client tries, in order, before viem's chain
 *  default: Alchemy's JSON-RPC for chains that opted in (`alchemyRpc`) when
 *  the key is present, then the chain's pinned `rpcUrl`. Empty in the
 *  browser and for chains with neither — those keep the single default
 *  transport. Exported for the harness. */
export function serverRpcEndpoints(chain: Pick<AppChain, 'alchemyNet' | 'alchemyRpc' | 'rpcUrl'>): ServerRpcEndpoint[] {
  const out: ServerRpcEndpoint[] = []
  const key = typeof window === 'undefined' ? process.env.ALCHEMY_API_KEY : undefined
  if (chain.alchemyRpc && key) out.push({ url: `https://${chain.alchemyNet}.g.alchemy.com/v2/`, headers: { Authorization: `Bearer ${key}` } })
  if (chain.rpcUrl) out.push({ url: chain.rpcUrl })
  return out
}

export function publicClientFor(chainId: number): PublicClient | null {
  const chain = BY_ID.get(chainId)
  if (!chain) return null
  let client = clients.get(chainId)
  if (!client) {
    // The pinned RPC first; viem's own default for the chain as the fallback.
    // viem's fallback transport moves to the next endpoint on TRANSPORT
    // failures (429 / 5xx / timeout) and throws straight through on chain
    // evidence (execution reverted, user rejected) — so a rate-limited
    // publicnode no longer turns the stranger's first "$1 of ETH" chip into
    // "I couldn't price ETH on Base" (squad QA P-2, 2026-09-08). Chains
    // without a pin keep the single default transport.
    const endpoints = serverRpcEndpoints(chain)
    const transport =
      endpoints.length > 0
        ? fallback([...endpoints.map((e) => http(e.url, e.headers ? { fetchOptions: { headers: e.headers } } : undefined)), http()])
        : http()
    client = createPublicClient({ chain: chain.viem, transport })
    clients.set(chainId, client)
  }
  return client
}
