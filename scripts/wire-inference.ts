#!/usr/bin/env tsx
/**
 * Wire the OpenAI-compatible inference providers to the BlockRun x402 gateway.
 *
 *   DATABASE_URL=… npx tsx scripts/wire-inference.ts
 *
 * Idempotent UPDATE of the flat callable fields on existing directory rows —
 * the same wiring `scripts/ingest-agentic.ts` (CALLABLE map) applies on a full
 * ingest, applied directly so no re-ingest is needed. Prints before/after.
 * Prices probed 2026-06-10 from live 402 challenges: exact $0.001/call at
 * chat-sized prompts (flat tier to ~2.4K input tokens, 256-token output cap).
 */
import { PrismaClient } from '@prisma/client'

const GATEWAY = 'https://blockrun.ai/api/v1/chat/completions'

const WIRING: Record<string, { tool: string }> = {
  chatgpt: { tool: 'openai/gpt-4o-mini' },
  deepseek: { tool: 'deepseek/deepseek-chat' },
  'google-gemini': { tool: 'google/gemini-2.5-flash-lite' },
  claude: { tool: 'anthropic/claude-haiku-4.5' },
}

async function main() {
  const prisma = new PrismaClient()
  for (const [slug, w] of Object.entries(WIRING)) {
    const before = await prisma.mcpServer.findUnique({
      where: { slug },
      select: { callable: true, endpoint: true, protocol: true, tool: true, priceUsd: true, kind: true },
    })
    if (!before) {
      console.log(`  ✗ ${slug}: not in directory — run db:ingest first, skipping`)
      continue
    }
    await prisma.mcpServer.update({
      where: { slug },
      data: {
        callable: true,
        kind: 'inference',
        endpoint: GATEWAY,
        protocol: 'http',
        tool: w.tool,
        priceUsd: '0.001',
      },
    })
    console.log(
      `  ✓ ${slug}: callable ${before.callable}→true, model ${before.tool ?? '—'}→${w.tool}`,
    )
  }
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
