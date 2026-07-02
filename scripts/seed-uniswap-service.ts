#!/usr/bin/env tsx
/**
 * Seed the Uniswap MCP first-party service into the directory (idempotent).
 *
 *   DATABASE_URL=… npx tsx scripts/seed-uniswap-service.ts [--callable]
 *
 * The Uniswap MCP (repo Yeetful/x402-services, services/uniswap) is LIVE at
 * uniswap.yeetful.com — on-chain quotes across every v3 fee tier, v3+v4 pool
 * state, and deterministic swap-tx building ({action:'send_transaction'} →
 * the website's evm-tx artifact). A directory row makes it shortlistable +
 * star-able. Seed with `callable: false` until the deploy's x402 gate answers
 * a real 402 (PAYMENT_ADDRESS + CDP envs); then re-run with --callable to
 * flip it on (endpoint/protocol/tool are wired either way). source:'yeetful'
 * keeps it invisible to the agentic.market ingest/audit.
 */
import { Prisma, PrismaClient } from '@prisma/client'

const MCP_URL = 'https://uniswap.yeetful.com/mcp'
const CALLABLE = process.argv.includes('--callable')

const SERVICE = {
  slug: 'uniswap',
  name: 'Uniswap',
  description:
    'Uniswap on Base, read straight from the contracts — live exact-in quotes across every v3 fee tier (QuoterV2, no indexer lag), spot prices, pool state for v3 AND v4 (including v4 native-ETH pools), and deterministic swap-transaction building: fresh quote → min-out with your slippage bound → SwapRouter02 calldata the user signs, approve step included, eth_call dry-run with real revert reasons. Recipient is always the payer; the service never holds keys, never submits. No upstream API key exists at all.',
  category: 'Trading',
  kind: 'data',
  priceUsd: '0.003',
  networks: ['Base'],
  callable: CALLABLE,
  endpoint: MCP_URL,
  protocol: 'mcp',
  tool: 'quote',
  websiteUrl: 'https://uniswap.yeetful.com',
  tags: ['trading', 'swap', 'quote', 'dex', 'defi', 'uniswap', 'transaction-building'],
  exampleQueries: [
    'Quote 100 USDC to WETH on Uniswap',
    'What is the ETH price on Uniswap',
    'Build a Uniswap swap: 50 USDC for cbBTC',
  ],
  source: 'yeetful',
}

const ENDPOINTS = [
  {
    method: 'POST',
    url: MCP_URL,
    description:
      'MCP Streamable HTTP (JSON-RPC tools/call) — quote (exact-in across all v3 fee tiers), price, pool_info (v3 + v4 via StateView), build_swap (SwapRouter02 calldata to sign, approve step + dry-run included), build_wrap/build_unwrap, convert_amount. First-party (Yeetful/x402-services).',
    priceUsd: '0.003',
    maxPriceUsd: null,
    scheme: 'exact',
    network: 'Base',
    provider: 'Yeetful',
    position: 0,
    // ⚠️ Param schemas make an endpoint PLANNER-CALLABLE regardless of the
    // server's `callable` flag (the planner gates on "has params", learned
    // the hard way: the router paid a 500ing gate on 2026-07-02). Only
    // advertise them once the x402 gate actually answers (--callable).
    // DbNull (not undefined): undefined would SKIP the field on upsert and
    // leave previously-seeded params live in the planner.
    parameters: CALLABLE
      ? [
          { group: 'body', name: 'sellToken', type: 'string', required: true, description: 'Base symbol (USDC, WETH, ETH…) or 0x address', example: 'USDC' },
          { group: 'body', name: 'buyToken', type: 'string', required: true, description: 'Base symbol or 0x address', example: 'WETH' },
          { group: 'body', name: 'amount', type: 'string', required: true, description: 'Human units of the sell token', example: '100' },
        ]
      : Prisma.DbNull,
  },
]

async function main() {
  const prisma = new PrismaClient()
  const server = await prisma.mcpServer.upsert({
    where: { slug: SERVICE.slug },
    update: SERVICE,
    create: SERVICE,
  })
  console.log(`✓ mcp_servers ${server.slug} (${server.id}) callable=${server.callable}`)
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
