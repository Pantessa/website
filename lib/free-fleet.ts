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
] as const

// The default working set a brand-new visitor lands on in chat: Uniswap +
// Snapshot + Hyperliquid. These three each carry a connected-wallet splash
// source (portfolio / proposals / positions), so a fresh view with a wallet
// immediately renders the dashboard building itself — the first-run "aha".
// CoW is in the browsable fleet but left out of the auto-on set to keep the
// splash focused on three distinct dashboards.
export const DEFAULT_CHAT_FLEET_SLUGS = [
  'uniswap-free',
  'snapshot-free',
  'hyperliquid-free',
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
      'Uniswap v3 + v4 on Base, free and non-gated: live quotes across every fee tier (QuoterV2), spot prices, pool state, and deterministic swap-transaction building the user signs. Builds only — never holds keys, never submits. Rate-limited. By Yeetful.',
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
      'Snapshot DAO governance, free and non-gated: browse spaces, proposals, and votes, then build the EIP-712 vote the user signs with their own wallet and relay it to the sequencer. The server never signs, never holds keys. Rate-limited. By Yeetful.',
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
      'CoW Protocol, free and non-gated: live order-book quotes, MEV-protected swap + limit orders built into the exact EIP-712 order the user signs, open orders, trade history, portfolio, solver competition, and the official CoW docs (bundled, searchable). Builds only — never holds keys, never submits unsigned. Rate-limited. By Yeetful.',
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
      'Hyperliquid, free and non-gated: live perp + spot markets, prices, orderbooks, candles, funding, and the full per-address account surface — positions, PnL, open orders, fills — plus a real-time settlement watch. Read-only by construction. Rate-limited. By Yeetful.',
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
]
