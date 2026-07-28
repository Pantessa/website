#!/usr/bin/env tsx
/**
 * House-link pre-flight — the clip-day button. Drives every LIVE house
 * link's ask over HTTP against a running server (BASE) with a REAL wallet,
 * through the exact set the /i runtime composes, and classifies the
 * outcome. audit:asks proves the parse ladder and audit:funding proves the
 * wallet-shape decisions — this sweep proves the LIVE seam those two
 * deliberately skip: real RPC reads, real venue quotes, real MCP
 * endpoints. Read-only: nothing is ever signed, jobs are counted and left
 * unsigned (revoke nothing — the wallet owns them).
 *
 * Run it the morning of a recording:
 *   BASE=http://localhost:3481 npm run preflight:house
 *   WALLET=0x… overrides the default (the .env.local burner).
 *
 * PASS = the turn lands an actionable artifact (tx/txChain/order/job/
 * chips/clarify) or an honest connect ask. FAIL = a bare planner reply —
 * exactly the shape that stalls a take.
 *
 * NOTE: job-compiling asks (protected-long, a due DCA period) create REAL
 * unsigned job/schedule rows for the wallet — they appear in its Jobs rail.
 * Cancel them from the rail after a run, or ignore them (nothing signs
 * itself).
 */
import { readFileSync } from 'node:fs'
import { privateKeyToAccount } from 'viem/accounts'
import { PrismaClient } from '@prisma/client'
import { HOUSE_LINKS } from '../lib/house-links'
import { composeMcps } from '../lib/intent-links'

const BASE = process.env.BASE ?? 'http://localhost:3481'

/** Documented gaps — a bare reply here WARNS instead of failing, and a row
 *  that stops being bare FAILS (stale entry) so the fix promotes it to
 *  strict in the same PR (audit:funding's knownUnnamed discipline). */
const KNOWN_GAPS: Record<string, string> = {}

function envLocal(key: string): string | null {
  try {
    return readFileSync('.env.local', 'utf8').match(new RegExp(`^${key}=(.*)$`, 'm'))?.[1]?.trim().replace(/^"|"$/g, '') ?? null
  } catch {
    return null
  }
}

async function main() {
  const pkRaw = envLocal('PRIVATE_KEY')
  const wallet =
    process.env.WALLET ??
    (pkRaw ? privateKeyToAccount((pkRaw.startsWith('0x') ? pkRaw : `0x${pkRaw}`) as `0x${string}`).address.toLowerCase() : null)
  if (!wallet) throw new Error('No wallet — set WALLET=0x… or run from a worktree with .env.local')

  // The real server rows for each composed set — the same defs the /i page
  // hands its runtime (endpoints included; the public listing hides them).
  const dbUrl = envLocal('DATABASE_URL')
  if (!dbUrl) throw new Error('No DATABASE_URL in .env.local')
  const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } })
  const allSlugs = [...new Set(HOUSE_LINKS.flatMap((l) => composeMcps(l.ask)))]
  const rows = await prisma.mcpServer.findMany({ where: { slug: { in: allSlugs } } })
  await prisma.$disconnect()
  const bySlug = new Map(rows.map((r) => [r.slug, r]))

  let failures = 0
  console.log(`\nHouse-link pre-flight @ ${BASE} · wallet ${wallet.slice(0, 6)}…${wallet.slice(-4)}\n`)
  for (const link of HOUSE_LINKS) {
    const slugs = composeMcps(link.ask)
    const activeServers = slugs
      .map((s) => bySlug.get(s))
      .filter(Boolean)
      .map((r) => ({
        slug: r!.slug,
        name: r!.name,
        kind: r!.kind,
        protocol: r!.protocol,
        endpoint: r!.endpoint,
        callable: true,
      }))
    const missing = slugs.filter((s) => !bySlug.has(s))
    const started = Date.now()
    let verdict = ''
    let ok = false
    try {
      const res = await fetch(`${BASE}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-yf-no-ask-log': '1' },
        body: JSON.stringify({ message: link.ask, activeServers, history: [], walletAddress: wallet }),
      })
      const body = (await res.json()) as Record<string, unknown> & { reply?: string }
      const artifact = [
        'tx',
        'txChain',
        'txRequest',
        'orderRequest',
        'jobId',
        'job',
        'chips',
        'clarify',
        'vote',
        'schedule',
        'guardianPolicyId',
        'connectWallet',
        'portfolio',
        'nfts',
        'nftMarket',
        'guardrails',
      ].find((k) => body[k] !== undefined && body[k] !== null)
      ok = res.status === 200 && !!artifact
      verdict = artifact ? `→ ${artifact}` : `BARE REPLY: ${(body.reply ?? '').slice(0, 140)}`
    } catch (e) {
      verdict = `ERROR: ${(e as Error).message}`
    }
    const secs = ((Date.now() - started) / 1000).toFixed(1)
    const gap = KNOWN_GAPS[link.slug]
    if (!ok && gap) {
      // documented gap: warn, don't fail — but a healed row must be promoted
      console.log(`  ⚠️ /i/${link.slug} (${secs}s) known gap — ${gap}`)
      continue
    }
    if (ok && gap) {
      failures++
      console.log(`  ❌ /i/${link.slug} (${secs}s) STALE known-gap entry — the turn now lands ${verdict}; promote the row to strict`)
      continue
    }
    if (!ok) failures++
    console.log(`  ${ok ? '✅' : '❌'} /i/${link.slug} (${secs}s) ${verdict}${missing.length ? ` [set missing: ${missing.join(',')}]` : ''}`)
    if (!ok) console.log(`     ask: ${link.ask}`)
  }
  console.log(`\n${failures === 0 ? '✅ every house link lands an actionable turn — record away.' : `❌ ${failures} link(s) would stall a take.`}\n`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
