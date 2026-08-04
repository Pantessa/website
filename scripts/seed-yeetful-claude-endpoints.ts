#!/usr/bin/env tsx
/**
 * Seed Yeetful · Claude's endpoint surface (committed fixture, idempotent).
 *
 *   DATABASE_URL=… npx tsx scripts/seed-yeetful-claude-endpoints.ts
 *
 * agentic.market doesn't publish our own MCP's endpoint surface, so the
 * detail page showed the empty state. This seeds the one real endpoint —
 * the MCP Streamable HTTP URL the chat orchestrator actually pays. Hand-
 * seeded provenance lives here (mcp_endpoints has no source column); the
 * upsert keys on the natural (serverId, method, url) unique, so ingest
 * re-runs and re-seeds coexist.
 */
import { PrismaClient } from '@prisma/client'

const ENDPOINTS = [
  {
    method: 'POST',
    url: 'https://anthropic.yeetful.com/api/mcp/mcp',
    description:
      'MCP Streamable HTTP (JSON-RPC tools/call) — ask_claude (single prompt) and claude_chat (multi-turn). Claude Haiku 4.5, 256-token output cap. Hand-seeded: not listed on agentic.market.',
    priceUsd: '0.005',
    maxPriceUsd: null,
    scheme: 'exact',
    network: 'Base',
    provider: 'Pantessa',
    position: 0,
  },
]

async function main() {
  const prisma = new PrismaClient()
  const server = await prisma.mcpServer.findUnique({ where: { slug: 'yeetful-claude' } })
  if (!server) {
    console.error('yeetful-claude not in directory — run db:ingest first.')
    process.exit(1)
  }
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
