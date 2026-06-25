#!/usr/bin/env tsx
/**
 * Ingest the x402 agent directory from agentic.market into Postgres.
 *
 *   npm run db:ingest -- --dry      # fetch + preview, NO DB writes
 *   npm run db:ingest               # upsert into the DB (DATABASE_URL)
 *   npm run db:ingest -- --prune    # also delete agentic.market rows not seen this run
 *
 * Source: https://api.agentic.market/v1/services — the JSON directory API
 * (paginated, ~1100 services). Each service carries name, description, category,
 * networks, per-endpoint USDC pricing, and provider. The markdown feed used
 * previously had no endpoint/price wiring; this API does.
 *
 * The pure fetch + parse pipeline lives in lib/agentic.ts (shared with the
 * daily sync audit, scripts/audit-agentic.ts). This script adds the live
 * auto-wire 402 probe and the DB upsert.
 *
 * NOTE: a service is only marked `callable: true` (wired into the chat
 * orchestrator) when it appears in CALLABLE (lib/agentic.ts). Each callable
 * needs the one right endpoint + query param (http) or tool name (mcp) chosen
 * by hand — the API lists ~26 endpoints per service (GET/POST/path-params) and
 * doesn't say which param carries a free-text query, so callability can't be
 * auto-derived.
 */
import { PrismaClient } from '@prisma/client'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getChallenge } from '../lib/x402'
import {
  API_BASE,
  CALLABLE,
  type ParsedEndpoint,
  type ParsedService,
  build,
  fetchAll,
} from '../lib/agentic'

// ── Auto-wire probe ──────────────────────────────────────────────────────────
// Inference services NOT hand-wired in CALLABLE get their OpenAI-compatible
// chat/completions endpoint probed (a free request that elicits the 402
// challenge — nothing is ever paid). A service is auto-wired only when the
// challenge parses, the scheme is `exact`, and the per-call price fits the
// default grant cap; metered (`upto`), keyed, dead, or expensive gateways stay
// listed-only with the reason recorded. Hand-wired entries are never touched.

const AUTO_WIRE_MAX_PER_CALL_USD = 0.05
/** Probe/wire model per service slug; generic fallback elsewhere (most
 *  gateways answer the 402 before validating the model). */
const PROBE_MODELS: Record<string, string> = {
  'blockrun-ai': 'openai/gpt-4o-mini',
}
const PROBE_FALLBACK_MODEL = 'gpt-4o-mini'

interface WireDecision {
  slug: string
  url: string
  decision: 'wired' | 'listed-only'
  reason: string
}

async function autoWireInference(
  services: ParsedService[],
  endpoints: Map<string, ParsedEndpoint[]>,
): Promise<WireDecision[]> {
  const decisions: WireDecision[] = []
  for (const svc of services) {
    if (svc.kind !== 'inference' || svc.callable || CALLABLE[svc.slug]) continue
    const candidates = (endpoints.get(svc.slug) ?? []).filter(
      (e) => e.method === 'POST' && /\/chat\/completions\/?$/.test(e.url),
    )
    if (candidates.length === 0) {
      decisions.push({ slug: svc.slug, url: '—', decision: 'listed-only', reason: 'no OpenAI-compatible chat/completions endpoint' })
      continue
    }
    let wired = false
    for (const ep of candidates) {
      if (wired) break
      const model = PROBE_MODELS[svc.slug] ?? PROBE_FALLBACK_MODEL
      try {
        const challenge = await getChallenge(ep.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model, messages: [{ role: 'user', content: 'probe' }], max_tokens: 16 }),
        })
        if (!challenge) {
          decisions.push({ slug: svc.slug, url: ep.url, decision: 'listed-only', reason: 'no 402 challenge (dead, free, or API-key gated)' })
          continue
        }
        const acc = challenge.accepts?.[0]
        const raw = acc?.amount ?? acc?.maxAmountRequired
        const price = raw ? Number(raw) / 1e6 : NaN
        if (acc?.scheme !== 'exact') {
          decisions.push({ slug: svc.slug, url: ep.url, decision: 'listed-only', reason: `scheme '${acc?.scheme ?? '?'}' — metered pricing is unsafe to auto-authorize` })
          continue
        }
        if (!(price > 0) || price > AUTO_WIRE_MAX_PER_CALL_USD) {
          decisions.push({ slug: svc.slug, url: ep.url, decision: 'listed-only', reason: `exact $${isNaN(price) ? '?' : price} exceeds the $${AUTO_WIRE_MAX_PER_CALL_USD} auto-wire cap` })
          continue
        }
        svc.callable = true
        svc.endpoint = ep.url
        svc.protocol = 'http'
        svc.tool = model
        svc.priceUsd = String(price)
        decisions.push({ slug: svc.slug, url: ep.url, decision: 'wired', reason: `exact $${price} ≤ $${AUTO_WIRE_MAX_PER_CALL_USD} (model ${model})` })
        wired = true
      } catch (err) {
        decisions.push({ slug: svc.slug, url: ep.url, decision: 'listed-only', reason: `probe failed: ${err instanceof Error ? err.message.slice(0, 80) : 'error'}` })
      }
    }
  }
  return decisions
}

async function main() {
  const dry = process.argv.includes('--dry')
  const prune = process.argv.includes('--prune')
  if (!dry) loadEnv() // load DATABASE_URL from .env.local for live runs

  console.log(`Fetching ${API_BASE} …`)
  const apiServices = await fetchAll((n, total) => process.stdout.write(`\r  fetched ${n}/${total}…`))
  process.stdout.write('\n')
  const { services, endpoints } = build(apiServices)

  console.log('\nAuto-wire probe (inference, free 402 probes — nothing is paid):')
  const wireDecisions = await autoWireInference(services, endpoints)
  for (const d of wireDecisions) {
    console.log(`  ${d.decision === 'wired' ? '⚡' : '·'} ${d.slug.padEnd(16)} ${d.decision.padEnd(12)} ${d.reason}${d.url !== '—' ? `  [${d.url}]` : ''}`)
  }
  if (wireDecisions.length === 0) console.log('  (no unwired inference candidates)')

  const callable = services.filter((s) => s.callable)
  const byCat = services.reduce<Record<string, number>>((a, s) => ((a[s.category] = (a[s.category] ?? 0) + 1), a), {})
  const totalEndpoints = [...endpoints.values()].reduce((a, e) => a + e.length, 0)

  console.log(`\nParsed ${services.length} services (from ${apiServices.length} API rows), ${totalEndpoints} endpoints`)
  console.log('By category:', byCat)
  console.log('Callable (wired):', callable.map((s) => s.name).join(', '))
  console.log('\nSample:')
  for (const s of services.slice(0, 6)) {
    const ep = endpoints.get(s.slug)?.length ?? 0
    console.log(`  • ${s.name} [${s.category}] $${s.priceUsd ?? '—'} ${s.networks.join('/')} · ${ep} endpoints${s.callable ? ' ⚡callable' : ''}`)
  }

  if (dry) {
    console.log('\n(dry run — no DB writes)')
    return
  }

  const prisma = new PrismaClient()
  const runStart = new Date()
  console.log('\nUpserting into DB…')
  let n = 0
  let epWritten = 0
  for (const s of services) {
    const saved = await prisma.mcpServer.upsert({
      where: { slug: s.slug },
      update: { ...s, lastSeenAt: new Date() },
      create: s,
    })
    n++
    // Replace this service's endpoint surface (cascade-owned child rows).
    const eps = endpoints.get(s.slug) ?? []
    // Replace the endpoint surface only when the source actually carries one —
    // wiping on empty would destroy hand-seeded rows (e.g. yeetful-claude's MCP
    // endpoint, which agentic.market doesn't list). Deliberate cleanup = --prune.
    if (eps.length) {
      await prisma.mcpEndpoint.deleteMany({ where: { serverId: saved.id } })
      await prisma.mcpEndpoint.createMany({
        // Json? fields reject plain null — omit `parameters` for DB NULL.
        data: eps.map(({ parameters, ...e }) => ({
          ...e,
          serverId: saved.id,
          ...(parameters ? { parameters: parameters as object[] } : {}),
        })),
        skipDuplicates: true,
      })
      epWritten += eps.length
    }
  }
  console.log(`✅ Upserted ${n} services, ${epWritten} endpoints.`)

  if (prune) {
    // Drop agentic.market rows not refreshed this run (stale listings).
    const { count } = await prisma.mcpServer.deleteMany({
      where: { source: 'agentic.market', lastSeenAt: { lt: runStart } },
    })
    console.log(`🧹 Pruned ${count} stale services.`)
  }

  await prisma.$disconnect()
}

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

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
