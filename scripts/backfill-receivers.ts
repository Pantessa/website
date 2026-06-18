#!/usr/bin/env tsx
/**
 * Backfill McpServer.receiver — the x402 `payTo` each MCP is paid to, read live
 * from its own 402 challenge. Whoever controls that wallet operates the server
 * (collects its revenue), so storing it lets the dashboard surface a logged-in
 * wallet's owned servers — and offer a one-click Claim on the unclaimed ones
 * (the claim flow re-verifies against the live endpoint; this is just for the
 * ownership match + display).
 *
 * Only servers with a wired `endpoint` have a readable receiver; the rest can
 * only be admin-claimed and are skipped (left null). Idempotent — re-run any
 * time to refresh. Reads receivers over the network; no writes are destructive
 * (one nullable column gets filled).
 *
 *   DATABASE_URL=… npx tsx scripts/backfill-receivers.ts [--dry]
 *   npm run db:receivers
 */
import prisma from '../lib/db'
import { getReceiver } from '../lib/x402'

const DRY = process.argv.includes('--dry')
const CONCURRENCY = 6
const TIMEOUT_MS = 15_000

async function receiverFor(endpoint: string): Promise<string | null> {
  return Promise.race([
    getReceiver(endpoint),
    new Promise<null>((res) => setTimeout(() => res(null), TIMEOUT_MS)),
  ])
}

async function main() {
  const servers = await prisma.mcpServer.findMany({
    where: { endpoint: { not: null } },
    select: { slug: true, endpoint: true, receiver: true },
    orderBy: { slug: 'asc' },
  })
  console.log(`${servers.length} servers with a wired endpoint${DRY ? ' (dry run)' : ''}\n`)

  let updated = 0
  let unread = 0
  // Simple fixed-size worker pool over the list.
  let i = 0
  async function worker() {
    while (i < servers.length) {
      const s = servers[i++]
      const receiver = (await receiverFor(s.endpoint!))?.toLowerCase() ?? null
      if (!receiver) {
        unread++
        console.log(`  ✗ ${s.slug} — no receiver read`)
        continue
      }
      const changed = receiver !== s.receiver
      console.log(`  ✓ ${s.slug} → ${receiver}${changed ? '' : ' (unchanged)'}`)
      if (!DRY) {
        await prisma.mcpServer.update({
          where: { slug: s.slug },
          data: { receiver, receiverCheckedAt: new Date() },
        })
      }
      updated++
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))

  console.log(`\n${updated} receivers ${DRY ? 'resolved' : 'stored'}, ${unread} unread.`)
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
