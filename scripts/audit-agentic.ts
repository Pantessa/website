#!/usr/bin/env tsx
/**
 * Audit the agentic.market directory against our Postgres copy — the daily
 * sync check. Read-only by default: it never writes the DB.
 *
 *   npm run db:audit            # human report; exit 1 if drift / unhealthy
 *   npm run db:audit -- --json  # machine-readable JSON (for cron / alerts)
 *   npm run db:audit -- --no-health   # skip the live 402 health probes (faster)
 *
 * It uses the SAME parse pipeline as the live ingest (lib/agentic.ts), so what
 * it reports as "would add / would update" is exactly what `npm run db:ingest`
 * would do. Run it on a schedule (see scripts/audit-agentic + cron) to catch:
 *   • NEW branded services on agentic.market we haven't ingested
 *   • STALE rows in our DB the source no longer lists (prune candidates)
 *   • PRICE / CATEGORY / ENDPOINT-COUNT drift since the last ingest
 *   • CALLABLE services whose wired x402 endpoint stopped returning a 402
 *
 * Exit code: 0 = fully in sync + all callable endpoints healthy; 1 = drift or
 * an unhealthy callable endpoint (so a cron wrapper can alert).
 */
import { PrismaClient } from '@prisma/client'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getChallenge } from '../lib/x402'
import { build, fetchAll, slugify, type ParsedService } from '../lib/agentic'

const JSON_OUT = process.argv.includes('--json')
const NO_HEALTH = process.argv.includes('--no-health')

// agentic.market's offset pagination returns a slightly different branded subset
// per fetch (~65–71 of ~71 brands), so "missing from THIS fetch" is not proof a
// service was removed. Real removals are detected by AGE instead: a row whose
// last_seen_at hasn't been re-stamped by the daily ingest for this many days is
// a genuine prune candidate. Override with --stale-days=N.
const STALE_DAYS = (() => {
  const a = process.argv.find((x) => x.startsWith('--stale-days='))
  return a ? Number(a.split('=')[1]) || 3 : 3
})()

function loadEnv() {
  for (const file of ['.env.local', '.env']) {
    try {
      for (const line of readFileSync(join(process.cwd(), file), 'utf8').split('\n')) {
        const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/)
        if (m && !line.trimStart().startsWith('#') && !(m[1] in process.env)) {
          process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
        }
      }
    } catch {
      /* no env file */
    }
  }
}

function log(...a: unknown[]) {
  if (!JSON_OUT) console.log(...a)
}

interface HealthResult {
  slug: string
  name: string
  endpoint: string
  protocol: string | null
  ok: boolean
  detail: string
}

// Best-effort: a wired x402 endpoint is "healthy" if it answers with a parseable
// 402 payment challenge. A non-402 isn't proof of breakage (some need params),
// but it's worth flagging — the chat orchestrator relies on the 402 handshake.
async function probeCallable(s: ParsedService): Promise<HealthResult> {
  const base = { slug: s.slug, name: s.name, endpoint: s.endpoint ?? '', protocol: s.protocol }
  if (!s.endpoint) return { ...base, ok: false, detail: 'no wired endpoint' }
  if (s.protocol === 'mcp') {
    // MCP Streamable HTTP — a bare GET/POST won't 402 the same way; just check reachability.
    try {
      const res = await fetch(s.endpoint, { method: 'GET' })
      return { ...base, ok: res.status > 0, detail: `reachable (HTTP ${res.status})` }
    } catch (e) {
      return { ...base, ok: false, detail: `unreachable: ${(e as Error).message.slice(0, 80)}` }
    }
  }
  // http: probe the wired endpoint, expecting a 402 challenge.
  const isPost = /chat\/completions/.test(s.endpoint)
  try {
    const challenge = await getChallenge(
      s.endpoint,
      isPost
        ? {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ model: s.tool ?? 'gpt-4o-mini', messages: [{ role: 'user', content: 'probe' }], max_tokens: 8 }),
          }
        : { method: 'GET' },
    )
    if (!challenge) return { ...base, ok: false, detail: 'no 402 challenge returned' }
    const acc = challenge.accepts?.[0]
    const raw = acc?.amount ?? acc?.maxAmountRequired
    const price = raw ? Number(raw) / 1e6 : NaN
    return { ...base, ok: true, detail: `402 ok · ${acc?.scheme ?? '?'} $${isNaN(price) ? '?' : price}` }
  } catch (e) {
    return { ...base, ok: false, detail: `probe failed: ${(e as Error).message.slice(0, 80)}` }
  }
}

async function main() {
  loadEnv()
  log('Fetching agentic.market …')
  const apiServices = await fetchAll((n, total) => !JSON_OUT && process.stdout.write(`\r  fetched ${n}/${total}…`))
  if (!JSON_OUT) process.stdout.write('\n')
  const { services, endpoints } = build(apiServices)
  const parsedBySlug = new Map(services.map((s) => [s.slug, s]))

  const prisma = new PrismaClient()
  const dbRows = await prisma.mcpServer.findMany({
    select: {
      slug: true, name: true, category: true, priceUsd: true, callable: true,
      source: true, endpoint: true, protocol: true, tool: true, lastSeenAt: true,
      _count: { select: { endpoints: true } },
    },
  })
  await prisma.$disconnect()
  const dbBySlug = new Map(dbRows.map((r) => [r.slug, r]))

  // ── Diff ───────────────────────────────────────────────────────────────────
  const added: string[] = []          // in API parse, not in DB
  const stale: { slug: string; ageDays: number }[] = []  // agentic rows not re-stamped in STALE_DAYS
  const missingThisFetch: string[] = []  // in DB, absent from THIS fetch (often pagination flux)
  const priceChanges: { slug: string; from: string | null; to: string | null }[] = []
  const categoryChanges: { slug: string; from: string; to: string }[] = []
  const endpointDrift: { slug: string; db: number; api: number }[] = []

  for (const s of services) {
    const db = dbBySlug.get(s.slug)
    if (!db) {
      added.push(s.slug)
      continue
    }
    if ((db.priceUsd ?? null) !== (s.priceUsd ?? null) && !db.callable) {
      // callable rows carry hand-set prices; only flag non-callable drift
      priceChanges.push({ slug: s.slug, from: db.priceUsd, to: s.priceUsd })
    }
    if (db.category !== s.category) categoryChanges.push({ slug: s.slug, from: db.category, to: s.category })
    const apiEp = endpoints.get(s.slug)?.length ?? 0
    // Only flag when the source has endpoints (ingest never wipes on empty).
    if (apiEp > 0 && apiEp !== db._count.endpoints) {
      endpointDrift.push({ slug: s.slug, db: db._count.endpoints, api: apiEp })
    }
  }
  const now = Date.now()
  for (const r of dbRows) {
    if (r.source !== 'agentic.market') continue
    if (!parsedBySlug.has(r.slug)) {
      const ageDays = (now - new Date(r.lastSeenAt).getTime()) / 86_400_000
      missingThisFetch.push(r.slug)
      // Only a genuine prune candidate once the daily ingest has failed to
      // re-stamp it for STALE_DAYS — survives agentic.market's pagination flux.
      if (ageDays >= STALE_DAYS) stale.push({ slug: r.slug, ageDays: Math.round(ageDays) })
    }
  }

  // Newly-flagged on the source (helpful even if already ingested).
  const newOnSource = apiServices
    .filter((a) => a.isNew && parsedBySlug.has(slugify(a.name)))
    .map((a) => a.name)

  // ── Health probes (callable only) ───────────────────────────────────────────
  const callable = services.filter((s) => s.callable)
  let health: HealthResult[] = []
  if (!NO_HEALTH) {
    log(`\nHealth-probing ${callable.length} callable endpoints (free 402 probes — nothing paid)…`)
    health = await Promise.all(callable.map(probeCallable))
  }
  const unhealthy = health.filter((h) => !h.ok)

  // missingThisFetch is excluded from the drift gate on purpose — it's noisy
  // pagination flux, not a real difference (genuine removals surface via `stale`).
  const drift = added.length + stale.length + priceChanges.length + categoryChanges.length + endpointDrift.length
  const inSync = drift === 0 && unhealthy.length === 0

  if (JSON_OUT) {
    console.log(JSON.stringify({
      checkedAt: new Date().toISOString(),
      apiRows: apiServices.length,
      parsed: services.length,
      dbServers: dbRows.length,
      dbAgentic: dbRows.filter((r) => r.source === 'agentic.market').length,
      added, stale, missingThisFetch, priceChanges, categoryChanges, endpointDrift, newOnSource,
      staleDays: STALE_DAYS,
      callable: callable.length,
      health, unhealthy: unhealthy.map((h) => h.slug),
      inSync,
    }, null, 2))
  } else {
    const hr = '─'.repeat(60)
    console.log(`\n${hr}\n  AGENTIC.MARKET SYNC AUDIT — ${new Date().toISOString()}\n${hr}`)
    console.log(`  API rows: ${apiServices.length}  ·  parsed (branded): ${services.length}  ·  DB: ${dbRows.length} (${dbRows.filter((r) => r.source === 'agentic.market').length} agentic)`)

    console.log(`\n  ➕ NEW on source, missing from DB (${added.length}):`)
    console.log(added.length ? added.map((s) => `     • ${parsedBySlug.get(s)?.name} [${parsedBySlug.get(s)?.category}] $${parsedBySlug.get(s)?.priceUsd ?? '—'}`).join('\n') : '     (none)')

    console.log(`\n  🗑  STALE in DB — not re-stamped in ≥${STALE_DAYS}d, prune candidates (${stale.length}):`)
    console.log(stale.length ? stale.map((s) => `     • ${dbBySlug.get(s.slug)?.name} (${s.slug}) — last seen ${s.ageDays}d ago`).join('\n') : '     (none)')

    console.log(`\n  ◌ Absent from THIS fetch (agentic.market pagination flux, not counted as drift) (${missingThisFetch.length}):`)
    console.log(missingThisFetch.length ? `     ${missingThisFetch.join(', ')}` : '     (none)')

    console.log(`\n  💲 PRICE drift (non-callable) (${priceChanges.length}):`)
    console.log(priceChanges.length ? priceChanges.map((c) => `     • ${c.slug}: $${c.from ?? '—'} → $${c.to ?? '—'}`).join('\n') : '     (none)')

    console.log(`\n  🏷  CATEGORY drift (${categoryChanges.length}):`)
    console.log(categoryChanges.length ? categoryChanges.map((c) => `     • ${c.slug}: ${c.from} → ${c.to}`).join('\n') : '     (none)')

    console.log(`\n  🔌 ENDPOINT-COUNT drift (${endpointDrift.length}):`)
    console.log(endpointDrift.length ? endpointDrift.map((c) => `     • ${c.slug}: DB ${c.db} → API ${c.api}`).join('\n') : '     (none)')

    console.log(`\n  ✨ Flagged "new" by agentic.market (${newOnSource.length}):`)
    console.log(newOnSource.length ? `     ${newOnSource.join(', ')}` : '     (none)')

    if (!NO_HEALTH) {
      console.log(`\n  🩺 CALLABLE health (${callable.length}):`)
      for (const h of health) console.log(`     ${h.ok ? '✓' : '✗'} ${h.slug.padEnd(16)} ${h.detail}`)
    }

    console.log(`\n${hr}`)
    console.log(inSync ? '  ✅ IN SYNC — no drift, all callable endpoints healthy.' : `  ⚠️  DRIFT: ${drift} difference(s)${unhealthy.length ? `, ${unhealthy.length} unhealthy endpoint(s)` : ''}.`)
    if (added.length || stale.length) console.log('     → run `npm run db:ingest`' + (stale.length ? ' (add --prune to drop stale rows)' : '') + ' to resync.')
    console.log(hr)
  }

  process.exit(inSync ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(2)
})
