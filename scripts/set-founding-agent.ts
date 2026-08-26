#!/usr/bin/env tsx
/**
 * set-founding-agent — the OWNER-GATED set-path for the Founding Manager
 * badge (FOUNDING-MANAGERS.md §1). Nothing in the product writes
 * founding_agents; the only door is this script, run by the owner with DB
 * credentials (Prisma reads .env, not .env.local — pass DATABASE_URL inline):
 *
 *   DATABASE_URL=... npx tsx scripts/set-founding-agent.ts --list
 *   DATABASE_URL=... npx tsx scripts/set-founding-agent.ts <handle> [--label "cohort 1"]
 *   DATABASE_URL=... npx tsx scripts/set-founding-agent.ts <handle> --remove
 *
 * <handle> is the agent's PUBLIC hash (sha256(agent_key)[:16], the
 * /agents/<handle> slug) — never a raw key. The badge is cosmetic +
 * historical (never a rank): it renders on the record page, its OG card,
 * and the standings row wherever the handle appears.
 */
import prisma from '../lib/db'

async function main() {
  const args = process.argv.slice(2)
  if (args.includes('--list')) {
    const rows = await prisma.foundingAgent.findMany({ orderBy: { createdAt: 'asc' } })
    if (rows.length === 0) console.log('No founding agents set.')
    for (const r of rows)
      console.log(`${r.agentKeyHash}  ${r.createdAt.toISOString()}  ${r.label ?? ''}`)
    return
  }

  const handle = args.find((a) => !a.startsWith('--'))?.trim().toLowerCase()
  if (!handle || !/^[0-9a-f]{16}$/.test(handle)) {
    console.error(
      'Usage: set-founding-agent.ts <16-hex handle> [--label "…"] [--remove] | --list\n' +
        'The handle is the /agents/<handle> slug — a hash, never a raw agent key.',
    )
    process.exit(1)
  }

  if (args.includes('--remove')) {
    const gone = await prisma.foundingAgent.deleteMany({ where: { agentKeyHash: handle } })
    console.log(gone.count ? `Removed founding badge from ${handle}.` : `${handle} had no badge.`)
    return
  }

  const labelIdx = args.indexOf('--label')
  const label = labelIdx >= 0 ? (args[labelIdx + 1] ?? null) : null
  await prisma.foundingAgent.upsert({
    where: { agentKeyHash: handle },
    create: { agentKeyHash: handle, label },
    update: { label },
  })
  console.log(`Founding badge set on ${handle}${label ? ` (label: ${label})` : ''}.`)
  console.log(`Verify: /agents/${handle} shows the FOUNDING chip; its OG card carries the pill.`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
