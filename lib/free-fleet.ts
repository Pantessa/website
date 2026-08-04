// The first-party FREE MCP fleet (repo Yeetful/free-mcps) — the canonical
// slugs, in display order, plus a static fallback so free-first surfaces
// (home working-set section, directory sort) render the fleet even before
// /api/servers answers or when the DB is off. Descriptions mirror the seed
// scripts (seed-free-mcps.ts / seed-cow-free.ts / seed-hyperliquid-free.ts);
// the DB rows win whenever they're available.
import type { McpServer } from '@/lib/store'

export const FREE_FLEET_SLUGS = [
  'uniswap-free',
  'snapshot-free',
  'cow-free',
  'hyperliquid-free',
  'opensea-free',
  'yeetful-tool-wallet',
] as const

// The default working set a brand-new visitor lands on in chat: Uniswap +
// Snapshot + Hyperliquid (each carries a connected-wallet splash source, so a
// fresh view with a wallet immediately renders the dashboard building itself)
// PLUS Pantessa Wallet, the internal tool (yeetful-tool-*) that answers "show
// my portfolio" and re-reads fresh balances after a swap settles. CoW is in
// the browsable fleet but left out of the auto-on set to keep the splash
// focused. NOTE: /embed caps its working set at 4 (EmbedChat MAX_MCPS) —
// this default set must stay ≤4.
export const DEFAULT_CHAT_FLEET_SLUGS = [
  'uniswap-free',
  'snapshot-free',
  'hyperliquid-free',
  'yeetful-tool-wallet',
] as const

/** Sort key: fleet rows first (in fleet order), then everything else. */
export function fleetRank(slug: string): number {
  const i = (FREE_FLEET_SLUGS as readonly string[]).indexOf(slug)
  return i === -1 ? FREE_FLEET_SLUGS.length : i
}

export const FREE_FLEET_FALLBACK: McpServer[] = [
  {
    id: 'uniswap-free',
    slug: 'uniswap-free',
    name: 'Uniswap (Free)',
    description:
      'Uniswap v3 + v4 on Base, free and non-gated: live quotes across every fee tier (QuoterV2), spot prices, pool state, and deterministic swap-transaction building the user signs. Builds only — never holds keys, never submits. Rate-limited. By Pantessa.',
    category: 'Trading',
    websiteUrl: 'https://github.com/Yeetful/free-mcps',
    color: null,
    kind: 'data',
    priceUsd: '0',
    networks: ['Base'],
    callable: false,
    gated: false,
    autoCallable: true,
    source: 'yeetful',
  },
  {
    id: 'snapshot-free',
    slug: 'snapshot-free',
    name: 'Snapshot DAO (Free)',
    description:
      'Snapshot DAO governance, free and non-gated: browse spaces, proposals, and votes, then build the EIP-712 vote the user signs with their own wallet and relay it to the sequencer. The server never signs, never holds keys. Rate-limited. By Pantessa.',
    category: 'Data',
    websiteUrl: 'https://github.com/Yeetful/free-mcps',
    color: null,
    kind: 'data',
    priceUsd: '0',
    networks: ['Ethereum'],
    callable: false,
    gated: false,
    autoCallable: true,
    source: 'yeetful',
  },
  {
    id: 'cow-free',
    slug: 'cow-free',
    name: 'CoW Protocol (Free)',
    description:
      'CoW Protocol, free and non-gated: live order-book quotes, MEV-protected swap + limit orders built into the exact EIP-712 order the user signs, open orders, trade history, portfolio, solver competition, and the official CoW docs (bundled, searchable). Builds only — never holds keys, never submits unsigned. Rate-limited. By Pantessa.',
    category: 'Trading',
    websiteUrl: 'https://github.com/Yeetful/free-mcps',
    color: null,
    kind: 'data',
    priceUsd: '0',
    networks: ['Ethereum', 'Base', 'Arbitrum', 'Gnosis'],
    callable: false,
    gated: false,
    autoCallable: true,
    source: 'yeetful',
  },
  {
    id: 'hyperliquid-free',
    slug: 'hyperliquid-free',
    name: 'Hyperliquid (Free)',
    description:
      'Hyperliquid, free and non-gated: live perp + spot markets, prices, orderbooks, candles, funding, and the full per-address account surface — positions, PnL, open orders, fills — plus a real-time settlement watch. Read-only by construction. Rate-limited. By Pantessa.',
    category: 'Trading',
    websiteUrl: 'https://github.com/Yeetful/free-mcps',
    color: null,
    kind: 'data',
    priceUsd: '0',
    networks: ['Hyperliquid'],
    callable: false,
    gated: false,
    autoCallable: true,
    source: 'yeetful',
  },
  {
    id: 'opensea-free',
    slug: 'opensea-free',
    name: 'OpenSea NFTs (Free)',
    description:
      'OpenSea NFTs, free and non-gated: wallet NFT portfolios with images across Ethereum/Base/Arbitrum, collection floor prices and stats, live listings and best offers, plus construction-only NFT transactions — ERC-721/1155 transfers, Seaport sell listings the user signs gasless, cancels, and guarded buys. Ownership verified on-chain before any build; never holds keys, never signs. Rate-limited. By Pantessa.',
    category: 'NFTs',
    websiteUrl: 'https://github.com/Yeetful/free-mcps',
    color: null,
    kind: 'data',
    priceUsd: '0',
    networks: ['Ethereum', 'Base', 'Arbitrum'],
    callable: false,
    gated: false,
    autoCallable: true,
    source: 'yeetful',
  },
  {
    id: 'yeetful-tool-wallet',
    slug: 'yeetful-tool-wallet',
    name: 'Pantessa Wallet',
    description:
      'Multichain wallet reads — an internal Pantessa tool: USD-priced whole-wallet portfolios across 9 top EVM chains (rendered as a rich card in chat), gas balances, precise token balances, recent transfers with scam-symbol flagging, and transaction confirmation status. The fresh-data layer after any swap or transfer settles. Read-only by construction. Rate-limited. By Pantessa.',
    category: 'Wallets',
    websiteUrl: 'https://github.com/Yeetful/free-mcps',
    color: null,
    kind: 'data',
    priceUsd: '0',
    networks: ['Ethereum', 'Base', 'Arbitrum', 'Optimism', 'Polygon', 'BNB Chain', 'Avalanche', 'Scroll', 'Gnosis'],
    callable: false,
    gated: false,
    autoCallable: true,
    source: 'yeetful',
  },
]
