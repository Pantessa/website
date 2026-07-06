#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────────────────
//  mcp:lint — the MCP ROUTABILITY grader (RR14).
//
//  The Reason Router is only as good as the metadata it routes over: weak
//  descriptions and missing param schemas make a capable MCP invisible or
//  unconstructable (the whack-a-mole class RR12 fixed for snapshot). This
//  grades any directory service on what the router ACTUALLY needs and emits
//  a concrete fix list — the "is this MCP built well enough?" check, and
//  the seed of the upgrade-suggestion UX.
//
//  Dimensions (weights sum 100):
//   · schema (25)      — param-schema coverage: can requests be CONSTRUCTED?
//   · description (20) — intent-carrying descriptions + R1 tags/examples:
//                        can the router FIND the right tool?
//   · probe (15)       — are the endpoints alive (402 challenge / free 200)?
//   · planner (30)     — the killer check: run the REAL planner prompt on
//                        direct Claude against this service's own menu with
//                        plausible user questions — does it pick a tool and
//                        does buildSmartRequest construct the call? Zero
//                        spend: construction only, nothing is paid/executed.
//   · affordances (10) — context-var readiness ($USER_ADDRESS-style inputs),
//                        an escape-hatch tool, signing hygiene (build-don't-
//                        execute; custody smells flagged).
//
//  Usage:
//    DATABASE_URL=… npx tsx scripts/mcp-lint.ts <slug> [<slug>…] [--json]
//      [--save] [--no-planner] [--no-probe]
//    --save writes the report to mcp_servers.routability (server page panel).
//    Without ANTHROPIC_API_KEY the planner dimension is skipped + reweighted.
// ─────────────────────────────────────────────────────────────────────────
import prisma from '../lib/db'
import { lintService, type RoutabilityReport } from '../lib/mcp-lint'

function printReport(r: RoutabilityReport) {
  const bar = (s: number | null) => (s === null ? '· skipped' : `${'█'.repeat(Math.round(s * 10)).padEnd(10, '░')} ${Math.round(s * 100)}%`)
  console.log(`\n━━ ${r.name} (${r.slug}) — ROUTABILITY ${r.score}/100 · grade ${r.grade} ━━`)
  for (const d of r.dimensions) {
    console.log(`  ${d.key.padEnd(12)} w${String(d.weight).padStart(2)}  ${bar(d.score)}`)
    for (const c of d.checks) console.log(`    ${c.ok ? '✓' : '✗'} ${c.note}`)
  }
  if (r.fixes.length) {
    console.log(`  FIXES (${r.fixes.length}):`)
    r.fixes.forEach((f, i) => console.log(`    ${i + 1}. ${f}`))
  } else {
    console.log('  FIXES: none — routable as built. 🏁')
  }
}

async function main() {
  const args = process.argv.slice(2)
  const flags = new Set(args.filter((a) => a.startsWith('--')))
  const slugs = args.filter((a) => !a.startsWith('--'))
  if (slugs.length === 0) {
    console.error('usage: npx tsx scripts/mcp-lint.ts <slug> [<slug>…] [--json] [--save] [--no-probe] [--no-planner]')
    process.exit(1)
  }
  const opts = { probe: !flags.has('--no-probe'), planner: !flags.has('--no-planner') }
  const reports: RoutabilityReport[] = []
  for (const slug of slugs) {
    const r = await lintService(slug, opts)
    if (!r) {
      console.error(`❌ unknown service slug "${slug}"`)
      continue
    }
    reports.push(r)
    if (!flags.has('--json')) printReport(r)
    if (flags.has('--save')) {
      await prisma.mcpServer.update({ where: { slug: r.slug }, data: { routability: r as unknown as object } })
      if (!flags.has('--json')) console.log(`  💾 saved to mcp_servers.routability`)
    }
  }
  if (flags.has('--json')) console.log(JSON.stringify(reports, null, 2))
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error('❌', e instanceof Error ? e.message : e)
  process.exit(1)
})
