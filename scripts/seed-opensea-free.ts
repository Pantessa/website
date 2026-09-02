#!/usr/bin/env tsx
// Seed the FREE (non-gated) first-party OpenSea NFT MCP — `opensea-free`
// (repo Yeetful/free-mcps, service `opensea`, deploys to
// opensea-mcp.yeetful.com) — as a directory row with one mcp_endpoints child
// per TOOL, mirroring seed-lido-free.ts exactly. priceUsd '0' = free.
//
// Tool names + param names below MIRROR the shipped zod schemas in
// free-mcps/services/opensea/lib/tools.ts — the planner sends tools/call
// arguments by these exact names. Addresses are 0x… ($USER_ADDRESS for the
// connected user); token ids and ERC-1155 amounts are decimal STRINGS.
//
// source:'yeetful' keeps db:ingest/db:audit from pruning or diffing it.
// Idempotent: upserts by slug, replaces endpoints. Run AFTER the service is
// live (needs OPENSEA_API_KEY on its Vercel project):
//   DATABASE_URL=... npx tsx scripts/seed-opensea-free.ts
// Local-dev overlay without touching Neon:
//   FREE_OPENSEA_MCP_BASE=http://localhost:3272/mcp npx tsx scripts/seed-opensea-free.ts --print-extra-env
import { Prisma } from '@prisma/client'

type Param = {
  group: 'body'
  name: string
  type: string
  description: string
  required: boolean
}

const p = (name: string, type: string, description: string, required = false): Param => ({
  group: 'body',
  name,
  type,
  description,
  required,
})

const OPENSEA_BASE = process.env.FREE_OPENSEA_MCP_BASE ?? 'https://opensea-mcp.yeetful.com/mcp'

const chain = (): Param => p('chain', 'string', 'Chain the NFT lives on: "ethereum" | "base" | "arbitrum".', true)
const contract = (): Param => p('contract', 'string', 'The NFT contract address (0x…).', true)
const tokenId = (): Param => p('token_id', 'string', 'The token id as a decimal string, e.g. "2489".', true)
const collection = (required = true): Param =>
  p('collection', 'string', 'The OpenSea collection slug, e.g. "pudgypenguins" (from get_account_nfts).', required)
const orderHash = (): Param => p('order_hash', 'string', 'The Seaport order hash (0x…64 hex) of a live listing.', true)
const amount1155 = (): Param => p('amount', 'string', 'Units to move/sell — ERC-1155 only (default "1"; must be "1" for ERC-721).')

const SERVICE = {
  slug: 'opensea-free',
  name: 'OpenSea NFTs (Free)',
  description:
    'OpenSea NFTs, free and non-gated: the NFTs a wallet owns (with images) across Ethereum, Base, and Arbitrum, NFT + collection detail, floor prices and stats, live listings and best offers — plus construction-only NFT transactions for BOTH ERC-721 and ERC-1155: transfers (ownership verified on-chain first), Seaport 1.6 sell listings the user signs gasless (payouts derived from the collection’s live fee schedule, re-validated at the relay), listing cancels, and guarded buys of live listings with locally re-encoded calldata. Never holds keys, never signs, never submits on-chain. Rate-limited. By Pantessa.',
  category: 'NFTs',
  kind: 'data',
  priceUsd: '0',
  networks: ['Ethereum', 'Base', 'Arbitrum'],
  websiteUrl: 'https://github.com/Pantessa/free-mcps',
  // callable:false like the sibling free rows — planner-driven via the
  // mcp_endpoints children below.
  callable: false,
  protocol: 'mcp',
  endpoint: OPENSEA_BASE,
  tags: ['nft', 'opensea', 'seaport', 'marketplace', 'erc721', 'erc1155', 'floor-price'],
  exampleQueries: [
    'what NFTs do I own?',
    'sell my Pudgy Penguin #2489 for 4.2 ETH',
    "what's the floor price of Pudgy Penguins?",
  ],
  source: 'yeetful',
}

const TOOLS: Array<{ name: string; description: string; params: Param[]; featured?: boolean }> = [
  {
    name: 'get_account_nfts',
    featured: true,
    description:
      "The NFTs an address owns on one chain (most recently active first) with names, collection slugs, IMAGE URLs, and OpenSea links — the 'what NFTs do I own / show my NFTs' tool. Paginate with `next`; filter to one collection with `collection`.",
    params: [
      chain(),
      p('address', 'string', "EVM address (0x…) — pass \"$USER_ADDRESS\" for the connected user's own NFTs.", true),
      p('limit', 'number', 'Max NFTs to return (1–50, default 20).'),
      collection(false),
      p('next', 'string', 'Opaque pagination cursor from a previous call.'),
    ],
  },
  {
    name: 'get_nft',
    featured: true,
    description: "One NFT's full detail: name, description, image, traits, current owners (with ERC-1155 quantities), and rarity rank.",
    params: [chain(), contract(), tokenId()],
  },
  {
    name: 'get_collection',
    description: 'Collection metadata: name, verification status, contracts, and the marketplace fee schedule every listing must honor.',
    params: [collection()],
  },
  {
    name: 'get_collection_stats',
    description: "Floor price, total/one-day volume and sales, owner count, and average price — \"what's the floor of X?\".",
    params: [collection()],
  },
  {
    name: 'get_best_listings',
    description: 'The cheapest live listings in a collection (price in ETH, token id, order hash, seller). Order hashes feed build_buy_nft.',
    params: [collection(), p('limit', 'number', 'Max listings (1–30, default 10).')],
  },
  {
    name: 'get_best_offer',
    description: 'The highest live offer on one NFT — what selling into the bid would fetch right now (usually priced in WETH).',
    params: [collection(), tokenId()],
  },
  {
    name: 'get_nft_events',
    description: 'Recent sales, transfers, and listings for one NFT.',
    params: [chain(), contract(), tokenId(), p('limit', 'number', 'Max events (1–30, default 10).')],
  },
  {
    name: 'build_transfer_nft',
    description:
      "Construct an UNSIGNED safeTransferFrom for an ERC-721 or ERC-1155 NFT (standard auto-detected, ownership verified on-chain first) — returns send_transaction steps for the USER's wallet. This service never signs. Transfers are irreversible.",
    params: [
      chain(),
      contract(),
      tokenId(),
      p('from', 'string', 'Current owner — pass "$USER_ADDRESS" for the connected user.', true),
      p('to', 'string', 'Recipient address (0x…).', true),
      amount1155(),
    ],
  },
  {
    name: 'build_listing',
    description:
      'Construct a fixed-price Seaport 1.6 SELL listing: verifies ownership on-chain, derives the payout split from the collection’s live fee schedule, and returns a one-time conduit approval step (if needed) plus an EIP-712 order for the USER to sign (gasless). Publish the signed order with submit_listing.',
    params: [
      chain(),
      contract(),
      tokenId(),
      p('offerer', 'string', 'The seller — pass "$USER_ADDRESS" for the connected user.', true),
      p('price_eth', 'string', 'Asking price in ETH as a decimal string, e.g. "0.5".', true),
      p('duration_hours', 'number', 'Listing lifetime in hours (default 168 = 7 days, max 720 = 30 days).'),
      amount1155(),
      p('include_creator_fees', 'boolean', "Also pay the collection's optional creator royalty (required fees are always included)."),
    ],
  },
  {
    name: 'submit_listing',
    description:
      'Relay a USER-signed Seaport order (from build_listing) to the OpenSea order book. Re-validates every payout recipient against the collection’s published fee schedule before relaying — tampered orders are refused.',
    params: [
      chain(),
      p('parameters', 'object', 'The signed OrderComponents message EXACTLY as returned by build_listing.', true),
      p('signature', 'string', "The user's EIP-712 signature over those parameters (0x…).", true),
    ],
  },
  {
    name: 'build_cancel_listing',
    description: "Construct the on-chain Seaport cancel for one of the USER's own live listings (only the offerer can cancel).",
    params: [chain(), orderHash(), p('canceller', 'string', 'The listing\'s offerer — pass "$USER_ADDRESS".', true)],
  },
  {
    name: 'build_buy_nft',
    description:
      "Construct the UNSIGNED purchase of a live OpenSea listing: calldata re-encoded locally from OpenSea's fulfillment, target pinned to Seaport 1.6, buyer's ETH balance checked, optional max-price cap enforced.",
    params: [
      chain(),
      orderHash(),
      p('buyer', 'string', 'The buyer — pass "$USER_ADDRESS" for the connected user.', true),
      p('max_price_eth', 'string', 'Optional cap in ETH — refuse if the listing costs more.'),
    ],
  },
]

function printExtraEnv() {
  const rows = [{ ...SERVICE, gated: false }]
  const endpoints = TOOLS.map((t) => ({
    serverSlug: SERVICE.slug,
    serverName: SERVICE.name,
    method: 'POST',
    url: `${OPENSEA_BASE}/${t.name}`,
    description: t.description,
    priceUsd: '0',
    parameters: t.params,
    category: SERVICE.category,
    tags: SERVICE.tags,
    exampleQueries: SERVICE.exampleQueries,
  }))
  console.log(`EXTRA_MCP_ROWS='${JSON.stringify(rows)}'`)
  console.log(`EXTRA_MCP_ENDPOINTS='${JSON.stringify(endpoints)}'`)
}

async function main() {
  const { default: prisma } = await import('../lib/db')
  const server = await prisma.mcpServer.upsert({
    where: { slug: SERVICE.slug },
    create: { ...SERVICE, gated: false },
    update: { ...SERVICE, gated: false },
  })

  await prisma.mcpEndpoint.deleteMany({ where: { serverId: server.id } })
  await prisma.mcpEndpoint.createMany({
    data: TOOLS.map((t, i) => ({
      serverId: server.id,
      method: 'POST',
      url: `${OPENSEA_BASE}/${t.name}`,
      description: t.description,
      priceUsd: '0',
      scheme: 'exact',
      network: 'ethereum',
      provider: 'Pantessa (free)',
      position: i,
      featured: t.featured === true,
      parameters: t.params.length ? (t.params as unknown as object) : Prisma.DbNull,
    })),
  })
  console.log(`✓ ${SERVICE.slug}: ${TOOLS.length} tool endpoints @ ${OPENSEA_BASE} (featured: get_account_nfts, get_nft)`)
  await prisma.$disconnect()
}

if (process.argv.includes('--print-extra-env')) {
  printExtraEnv()
} else {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
