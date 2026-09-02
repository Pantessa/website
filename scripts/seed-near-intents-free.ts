#!/usr/bin/env tsx
// Seed the FREE (non-gated) first-party NEAR Intents cross-chain swap MCP —
// `near-intents-free` (repo Yeetful/free-mcps, service `near-intents`) — as a
// directory row with one mcp_endpoints child per TOOL, mirroring
// seed-yeetful-tool-wallet.ts exactly. priceUsd '0' = explicitly free.
//
// Tool names + param names below MIRROR the shipped zod schemas in
// free-mcps/services/near-intents/lib/tools.ts — the planner sends tools/call
// arguments by these exact names. Re-align if the service surface changes.
//
// Live domain: near-intents.yeetful.com (SEEDED 2026-07-09 night — Nate
// attached this domain, not the near-intents-mcp subdomain DEPLOY.md guessed).
//
// source:'yeetful' keeps db:ingest/db:audit from pruning or diffing it.
// Idempotent: upserts by slug, replaces endpoints. Run:
//   DATABASE_URL=... npx tsx scripts/seed-near-intents-free.ts
// Local-dev overlay without touching Neon:
//   FREE_NEAR_INTENTS_MCP_BASE=http://localhost:3268/mcp npx tsx scripts/seed-near-intents-free.ts --print-extra-env
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

const NI_BASE = process.env.FREE_NEAR_INTENTS_MCP_BASE ?? 'https://near-intents.yeetful.com/mcp'

const pair = (): Param[] => [
  p('originChain', 'string', 'Origin chain — "base", "arbitrum", "ethereum", "solana", … or an EVM chainId like "8453".', true),
  p('originToken', 'string', 'Origin (sell) token — a symbol like "USDC"/"ETH", a contract address, or a full 1Click assetId. Never a wallet address.', true),
  p('destinationChain', 'string', 'Destination chain — same formats as originChain.', true),
  p('destinationToken', 'string', 'Destination (receive) token — same formats as originToken.', true),
  p('amount', 'string', 'Amount to sell in HUMAN units of the origin token, e.g. "1.5" — never base units.', true),
  p('slippageBps', 'number', 'Slippage tolerance in basis points (default 100 = 1%, max 1000).'),
]

const depositAddress = () =>
  p('depositAddress', 'string', "The one-time deposit address returned by build_swap — the swap's tracking ID for its whole life.", true)

const SERVICE = {
  slug: 'near-intents-free',
  name: 'NEAR Intents (Free)',
  description:
    'Cross-chain swaps via the official NEAR Intents 1Click API, free and non-gated: any asset to any other across ~35 chains (~190 assets — USDC Base→Arbitrum, ETH→SOL, USDC→BTC…) with ONE transfer the user signs. Dry-run quotes, then a one-time deposit address + the single unsigned transfer; solvers deliver on the destination chain automatically, tracked to SUCCESS with explorer links. Unfillable swaps auto-refund. Never holds keys, never signs. Rate-limited. By Pantessa.',
  category: 'Trading',
  kind: 'data',
  priceUsd: '0',
  networks: ['Ethereum', 'Base', 'Arbitrum', 'Optimism', 'Polygon', 'BNB Chain', 'Avalanche', 'Gnosis', 'Scroll', 'Solana', 'Bitcoin', 'NEAR'],
  websiteUrl: 'https://github.com/Pantessa/free-mcps',
  // callable:false like the sibling free rows — planner-driven via the
  // mcp_endpoints children below.
  callable: false,
  protocol: 'mcp',
  endpoint: NI_BASE,
  tags: ['cross-chain', 'bridge', 'swap', 'intents', 'near'],
  exampleQueries: [
    'swap 1 USDC from base to arbitrum',
    'move my USDC from base to solana',
    'how do cross-chain swaps work?',
  ],
  source: 'yeetful',
}

const TOOLS: Array<{ name: string; description: string; params: Param[] }> = [
  {
    name: 'how_it_works',
    description:
      'START HERE for cross-chain asks: the full quote → deposit → settle → verify flow, which chains deposits can be built for, and the safety rules. Free, instant.',
    params: [],
  },
  {
    name: 'chains',
    description: 'Every blockchain 1Click can swap between, with live token counts and whether deposit transactions can be built there (EVM) or quote-only.',
    params: [],
  },
  {
    name: 'tokens',
    description: 'Search the ~190 supported assets — filter by chain and/or symbol substring; returns assetId, contract, decimals, live USD price.',
    params: [
      p('chain', 'string', 'Filter chain — "base", "solana", …'),
      p('search', 'string', 'Symbol substring, e.g. "usdc". Case-insensitive.'),
      p('limit', 'number', 'Max rows (default 30).'),
    ],
  },
  {
    name: 'quote',
    description:
      'DRY-RUN preview of a cross-chain swap (USDC Base→Arbitrum, ETH→SOL, …): expected output, minimum after slippage, USD values, fees, ETA. Commits NOTHING and creates NO deposit address — always safe. Quote first, confirm with the user, then build_swap.',
    params: [
      ...pair(),
      p('refundTo', 'string', "Optional for previews: the user's origin-chain address."),
      p('recipient', 'string', 'Optional for EVM/Solana/NEAR destinations, REQUIRED otherwise: the delivery address on the destination chain.'),
    ],
  },
  {
    name: 'build_swap',
    description:
      'EXECUTE a cross-chain swap: real quote → one-time deposit address → ONE unsigned transfer the user signs (the only signature the whole swap needs — solvers deliver on the destination chain automatically). Origin must be an EVM chain. from = the payer AND refund address — pass "$USER_ADDRESS" for the connected user. recipient defaults to `from` on EVM destinations; for Solana/Bitcoin/NEAR destinations ask the user — NEVER guess. Response carries the numbered flow to narrate + warnings.',
    params: [
      ...pair(),
      p('from', 'string', 'The USER\'S OWN origin-chain wallet (0x…) — pays the deposit, receives refunds. Pass "$USER_ADDRESS" for the connected user.', true),
      p('recipient', 'string', "Delivery address on the DESTINATION chain (that chain's format). Defaults to `from` when the destination is EVM."),
      p('deadlineMinutes', 'number', 'Minutes until the deposit address expires and refunds begin (default 30).'),
    ],
  },
  {
    name: 'submit_deposit_tx',
    description: 'AFTER the deposit transfer confirms on-chain: submit its hash so 1Click picks it up immediately. Optional but recommended.',
    params: [depositAddress(), p('txHash', 'string', "Transaction hash of the user's confirmed deposit transfer.", true)],
  },
  {
    name: 'check_status',
    description:
      "One status poll by deposit address — the state, what it MEANS, both chains' tx hashes with explorer links, delivered/refunded amounts, and the next step.",
    params: [depositAddress()],
  },
  {
    name: 'await_completion',
    description:
      'Watch a swap by deposit address until SUCCESS / REFUNDED / FAILED (≤45s per call), then report the outcome with explorer links — then re-read balances so the user sees fresh holdings.',
    params: [depositAddress(), p('timeoutSec', 'number', 'Seconds to keep watching (default 40, max 45).')],
  },
]

/** Print the local-dev env overlays derived from the SAME tool table (no DB). */
function printExtraEnv() {
  const rows = [{ ...SERVICE, gated: false }]
  const endpoints = TOOLS.map((t) => ({
    serverSlug: SERVICE.slug,
    serverName: SERVICE.name,
    method: 'POST',
    url: `${NI_BASE}/${t.name}`,
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
      url: `${NI_BASE}/${t.name}`,
      description: t.description,
      priceUsd: '0',
      scheme: 'exact',
      network: 'multichain',
      provider: 'Pantessa (free)',
      position: i,
      parameters: t.params.length ? (t.params as unknown as object) : Prisma.DbNull,
    })),
  })
  console.log(`✓ ${SERVICE.slug}: ${TOOLS.length} tool endpoints @ ${NI_BASE}`)
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
