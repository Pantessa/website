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

import { defineChain, createPublicClient, http, type Chain, type PublicClient } from 'viem'
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
    // NO rpcUrl override: viem's default (mainnet.optimism.io) measured
    // clean 2026-09-04 — full archive depth, 25 concurrent reads in 0.8s.
    // The publicnode override that was here first is what broke the initial
    // live run (see lib/wagmi.ts); the 429 risk it was guarding against is
    // real on Base/mainnet but was never measured on Optimism.
    words: /\boptim(?:ism|sim|isim)\b/i,
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
]

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

export function publicClientFor(chainId: number): PublicClient | null {
  const chain = BY_ID.get(chainId)
  if (!chain) return null
  let client = clients.get(chainId)
  if (!client) {
    client = createPublicClient({ chain: chain.viem, transport: http(chain.rpcUrl) })
    clients.set(chainId, client)
  }
  return client
}
