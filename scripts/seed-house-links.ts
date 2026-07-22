#!/usr/bin/env tsx
// Seed the first-party HOUSE intent links (lib/house-links.ts) — the
// canonical demo set with deterministic slugs (/i/buy-aapl, /i/dca-eth, …)
// that landing CTAs and the /links start-here strip point at. creator=null:
// house links earn nothing and belong to no dashboard.
//
// Idempotent: upserts by slug and un-revokes (the house set is meant to be
// live; revoking one deliberately means removing it from HOUSE_LINKS too).
//   DATABASE_URL=... npx tsx scripts/seed-house-links.ts
import { PrismaClient } from '@prisma/client'
import { HOUSE_LINKS } from '../lib/house-links'
import { cleanAsk, composeMcps } from '../lib/intent-links'

const prisma = new PrismaClient()

async function main() {
  for (const h of HOUSE_LINKS) {
    const ask = cleanAsk(h.ask)
    const mcps = composeMcps(ask).join(',')
    await prisma.intentLink.upsert({
      where: { id: h.slug },
      create: { id: h.slug, ask, mcps, creator: null, agent: 'Yeetful', revoked: false },
      update: { ask, mcps, agent: 'Yeetful', revoked: false },
    })
    console.log(`✓ /i/${h.slug} — "${ask}" [${mcps}]`)
  }
  console.log(`${HOUSE_LINKS.length} house links live.`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => void prisma.$disconnect())
