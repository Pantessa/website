#!/usr/bin/env tsx
/**
 * Probe-verified fix-up for stale directory endpoint URLs (committed,
 * idempotent — safe to re-run any time; a clean DB yields zero changes).
 *
 *   DATABASE_URL=… npx tsx scripts/fix-stale-endpoint-urls.ts [--dry]
 *
 * agentic.market lists BlockRun's surface at `blockrun.ai/v1/*`, but the live
 * API tree is `blockrun.ai/api/v1/*` (probed 2026-06-10: the /v1/ paths serve
 * the marketing site's HTML 404). For every row matching a stale pattern, BOTH
 * forms are probed with a free request; the row is rewritten only when the
 * stale form is dead AND the corrected form is demonstrably an API (402, 2xx,
 * or a JSON reply of any status — HTML means the marketing site). Rows where
 * neither form responds stay untouched and are reported. Nothing is ever paid;
 * nothing is deleted (a rewrite that would collide with an existing row is
 * skipped and reported instead).
 */
import { PrismaClient } from '@prisma/client'

const REWRITES: { prefix: string; replace: (url: string) => string }[] = [
  {
    prefix: 'https://blockrun.ai/v1/',
    replace: (url) => url.replace('https://blockrun.ai/v1/', 'https://blockrun.ai/api/v1/'),
  },
]

type Verdict = 'api' | 'dead'

/** Free probe: an x402 402, any 2xx, or a JSON reply means an API answered. */
async function probe(url: string, method: string): Promise<{ verdict: Verdict; note: string }> {
  try {
    const init: RequestInit =
      method === 'GET'
        ? { method, headers: { accept: 'application/json' } }
        : {
            method,
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'probe' }], max_tokens: 16, prompt: 'probe' }),
          }
    const res = await fetch(url, init)
    const ct = res.headers.get('content-type') ?? ''
    await res.arrayBuffer().catch(() => {})
    if (res.status === 402) return { verdict: 'api', note: '402 challenge' }
    if (res.ok) return { verdict: 'api', note: `${res.status}` }
    if (ct.includes('json')) return { verdict: 'api', note: `${res.status} json` }
    return { verdict: 'dead', note: `${res.status} ${ct.split(';')[0] || 'no content-type'}` }
  } catch (err) {
    return { verdict: 'dead', note: err instanceof Error ? err.message.slice(0, 50) : 'fetch error' }
  }
}

async function main() {
  const dry = process.argv.includes('--dry')
  const prisma = new PrismaClient()

  let rewritten = 0
  let skipped = 0
  for (const rule of REWRITES) {
    const stale = await prisma.mcpEndpoint.findMany({
      where: { url: { startsWith: rule.prefix } },
      include: { server: { select: { slug: true } } },
    })
    if (stale.length === 0) continue

    // Probe each DISTINCT method+url once.
    const verdicts = new Map<string, { old: Awaited<ReturnType<typeof probe>>; neu: Awaited<ReturnType<typeof probe>>; target: string }>()
    for (const key of new Set(stale.map((r) => `${r.method} ${r.url}`))) {
      const [method, url] = [key.slice(0, key.indexOf(' ')), key.slice(key.indexOf(' ') + 1)]
      const target = rule.replace(url)
      const [old, neu] = [await probe(url, method), await probe(target, method)]
      verdicts.set(key, { old, neu, target })
      console.log(`  ${method} ${url}`)
      console.log(`    stale → ${old.verdict} (${old.note}) · corrected → ${neu.verdict} (${neu.note})`)
    }

    for (const row of stale) {
      const v = verdicts.get(`${row.method} ${row.url}`)!
      if (!(v.old.verdict === 'dead' && v.neu.verdict === 'api')) {
        console.log(`    · ${row.server.slug}: left untouched (stale=${v.old.verdict}, corrected=${v.neu.verdict})`)
        skipped++
        continue
      }
      const collision = await prisma.mcpEndpoint.findUnique({
        where: { serverId_method_url: { serverId: row.serverId, method: row.method, url: v.target } },
      })
      if (collision) {
        console.log(`    · ${row.server.slug}: SKIPPED — corrected row already exists (no deletes here)`)
        skipped++
        continue
      }
      if (!dry) {
        await prisma.mcpEndpoint.update({ where: { id: row.id }, data: { url: v.target } })
      }
      console.log(`    ✓ ${row.server.slug}: ${dry ? 'would rewrite' : 'rewritten'} → ${v.target}`)
      rewritten++
    }
  }
  console.log(`\n${dry ? '(dry) ' : ''}rewritten: ${rewritten}, untouched: ${skipped}`)
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
