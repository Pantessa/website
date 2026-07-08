#!/usr/bin/env tsx
// Flag the free fleet's featured ("start here") endpoints —
// mcp_endpoints.featured. Two consumers: the endpoint planner floats these
// to the front of its menu as starting hints when an ask is broad, and the
// connect-time quick view pings them first for a newly connected wallet
// (the same tools the hand-coded splash sources call, plus the marquee
// quote actions).
//
// Idempotent: clears featured on each fleet server, then re-flags the
// listed tools. Run:
//   DATABASE_URL=... npx tsx scripts/seed-featured-endpoints.ts
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

/** slug → tool names to feature (matched against the stored url convention
 *  `<base>/mcp#tool` or `…/mcp/tool`). */
const FEATURED: Record<string, string[]> = {
  'uniswap-free': ['balances', 'quote'],
  'snapshot-free': ['list_proposals'],
  'cow-free': ['portfolio', 'quote'],
  'hyperliquid-free': ['portfolio'],
}

function toolNameOf(url: string): string | null {
  const m = url.match(/\/mcp[#/]([^#/?]+)$/)
  return m ? m[1] : null
}

async function main() {
  for (const [slug, tools] of Object.entries(FEATURED)) {
    const eps = await prisma.mcpEndpoint.findMany({
      where: { server: { slug } },
      select: { id: true, url: true, featured: true },
    })
    if (eps.length === 0) {
      console.log(`⚠️  ${slug}: no endpoints found — is the row seeded?`)
      continue
    }
    const want = new Set(tools)
    const onIds = eps.filter((e) => want.has(toolNameOf(e.url) ?? '')).map((e) => e.id)
    const offIds = eps.filter((e) => e.featured && !onIds.includes(e.id)).map((e) => e.id)
    if (offIds.length > 0) {
      await prisma.mcpEndpoint.updateMany({ where: { id: { in: offIds } }, data: { featured: false } })
    }
    if (onIds.length > 0) {
      await prisma.mcpEndpoint.updateMany({ where: { id: { in: onIds } }, data: { featured: true } })
    }
    const missing = tools.filter((t) => !eps.some((e) => toolNameOf(e.url) === t))
    console.log(
      `✓ ${slug}: featured [${tools.filter((t) => !missing.includes(t)).join(', ')}]` +
        (missing.length ? ` — MISSING: ${missing.join(', ')}` : ''),
    )
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
