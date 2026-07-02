#!/usr/bin/env tsx
/**
 * Seed the CoW Swap first-party service into the directory (idempotent).
 *
 *   DATABASE_URL=… npx tsx scripts/seed-cow-swap-service.ts
 *
 * The "CoW Agent" — Yeetful's reference safe-transaction-building service:
 * market swaps + limit orders on Base via CoW Protocol (quote → EIP-712 order
 * the USER signs; Yeetful never custodies), plus CoW DAO Snapshot voting via
 * the existing governance flow. A directory row is what makes it shortlistable
 * (lib/shortlist.ts only accepts real McpServer rows) and star-able on
 * /servers. `callable` stays FALSE until A2c wires swap intents into the chat
 * orchestrator — the row is browsable + shortlistable, never x402-probed.
 * `source: 'yeetful'` keeps it invisible to the agentic.market ingest/audit
 * (both scope stale-detection to source 'agentic.market').
 */
import { PrismaClient } from '@prisma/client'

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.yeetful.com'

const SERVICE = {
  slug: 'cow-swap',
  name: 'CoW Swap',
  description:
    'Safe transaction building for CoW Protocol on Base: ask for a swap in English and get a real CoW quote built into the exact EIP-712 order you sign — market swaps and limit orders (name your price, fee from surplus). Orders settle via CoW solvers with MEV protection; Yeetful builds and receipts, your wallet signs. Includes CoW DAO governance: vote on cow.eth Snapshot proposals from chat.',
  category: 'Trading',
  kind: 'data',
  priceUsd: '0',
  networks: ['Base'],
  callable: false,
  websiteUrl: 'https://swap.cow.fi',
  tags: ['trading', 'swap', 'limit-order', 'defi', 'governance', 'transaction-building'],
  exampleQueries: [
    'Swap 100 USDC for WETH',
    'Place a limit order: sell 0.5 WETH when it hits 3500 USDC',
    'Vote for the latest CoW DAO proposal',
  ],
  source: 'yeetful',
}

const ENDPOINTS = [
  {
    method: 'POST',
    url: `${SITE}/api/cow/quote`,
    description:
      'Quote → signable EIP-712 GPv2 order. mode "swap" fetches a live CoW quote; mode "limit" builds a user-priced limit order (buyAmountAtLeast, feeAmount 0, partially fillable). Returns the order, a human summary, and the sign_order artifact. First-party: free to build, settlement is on-chain via CoW solvers.',
    priceUsd: '0',
    maxPriceUsd: null,
    scheme: 'exact',
    network: 'Base',
    provider: 'Yeetful',
    position: 0,
  },
]

async function main() {
  const prisma = new PrismaClient()
  const server = await prisma.mcpServer.upsert({
    where: { slug: SERVICE.slug },
    update: SERVICE,
    create: SERVICE,
  })
  console.log(`✓ mcp_servers ${server.slug} (${server.id})`)
  for (const ep of ENDPOINTS) {
    await prisma.mcpEndpoint.upsert({
      where: {
        serverId_method_url: { serverId: server.id, method: ep.method, url: ep.url },
      },
      update: ep,
      create: { ...ep, serverId: server.id },
    })
    console.log(`  ✓ ${ep.method} ${ep.url} ($${ep.priceUsd} ${ep.scheme})`)
  }
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
