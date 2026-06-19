#!/usr/bin/env tsx
/**
 * Probe-verify auto-callable services (P1 — harden the routing engine's reach).
 *
 * #153 made services with a plannable endpoint show as auto-callable in the
 * directory. "Has a param schema + a price" is necessary but not sufficient —
 * this script confirms the endpoint actually ANSWERS: it builds a sample request
 * from each service's cheapest plannable endpoint (using the params' `example`
 * values), fires it UNPAID, and classifies the response. A real x402 402
 * challenge = alive + payable (the strong positive); from it we also backfill
 * McpServer.receiver — which db:receivers can't reach for these services (they
 * have no wired `endpoint`), and which P0 earn-verification needs.
 *
 * Nothing is ever paid (no payment header is attached). Idempotent.
 *
 *   DATABASE_URL=… npx tsx scripts/probe-callable.ts [--dry]
 *   npm run probe:callable
 */
import { getAddress } from 'viem'
import prisma from '../lib/db'
import { getChallenge } from '../lib/x402'
import { buildSmartRequest, loadPlannableEndpoints, type EndpointParam, type PlannableEndpoint } from '../lib/endpoint-planner'

const DRY = process.argv.includes('--dry')
const TIMEOUT_MS = 15_000

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((res) => setTimeout(() => res(null), ms))])
}

/** A usable scalar sample value from a param's `example`, or undefined. */
function sampleValue(p: EndpointParam): string | number | boolean | undefined {
  const ex = p.example
  if (ex === undefined || ex === null || ex === '') return undefined
  return typeof ex === 'string' || typeof ex === 'number' || typeof ex === 'boolean' ? ex : undefined
}

/** Sample params from examples; null if a required param has no usable example. */
function buildSample(ep: PlannableEndpoint): Record<string, string | number | boolean> | null {
  const out: Record<string, string | number | boolean> = {}
  for (const p of ep.parameters) {
    const v = sampleValue(p)
    if (v !== undefined) out[p.name] = v
    else if (p.required) return null
  }
  return out
}

interface ProbeResult {
  status: string
  price?: number
  scheme?: string
  payTo?: string
}

async function probe(req: { url: string; method: string; headers: Record<string, string>; body?: string }): Promise<ProbeResult> {
  const init: RequestInit = { method: req.method, headers: req.headers, body: req.body }
  let challenge = null
  try {
    challenge = await withTimeout(getChallenge(req.url, init), TIMEOUT_MS)
  } catch {
    // getChallenge can reject (DNS, expired TLS cert, connection reset) — that's
    // a reachability failure, not a crash. Fall through to classify below.
    challenge = null
  }
  if (challenge) {
    const acc = challenge.accepts?.find((a) => a.payTo) ?? challenge.accepts?.[0]
    const raw = acc?.amount ?? acc?.maxAmountRequired
    const price = raw ? Number(raw) / 1e6 : undefined
    let payTo: string | undefined
    try {
      payTo = acc?.payTo ? getAddress(acc.payTo).toLowerCase() : undefined
    } catch {
      /* malformed payTo */
    }
    return { status: 'alive · 402 payable', price, scheme: acc?.scheme, payTo }
  }
  // No 402 — classify reachability with a single unpaid fetch.
  try {
    const res = await withTimeout(fetch(req.url, init), TIMEOUT_MS)
    if (!res) return { status: 'timeout' }
    if (res.ok) return { status: 'alive · 200 (free?)' }
    if ([400, 401, 403, 404, 405, 422].includes(res.status)) return { status: `reachable · ${res.status} (sample rejected)` }
    return { status: `http ${res.status}` }
  } catch {
    return { status: 'unreachable' }
  }
}

async function main() {
  const servers = await prisma.mcpServer.findMany({
    select: { id: true, slug: true, name: true, callable: true, receiver: true },
  })
  const allSlugs = servers.map((s) => s.slug)
  const plannable = await loadPlannableEndpoints(allSlugs)

  // Group plannable endpoints by service, cheapest first.
  const byService = new Map<string, PlannableEndpoint[]>()
  for (const e of plannable) byService.set(e.serverSlug, [...(byService.get(e.serverSlug) ?? []), e])
  for (const eps of byService.values()) eps.sort((a, b) => Number(a.priceUsd) - Number(b.priceUsd))

  const bySlug = new Map(servers.map((s) => [s.slug, s]))
  console.log(`Probing ${byService.size} auto-callable service(s)${DRY ? ' (dry run — no writes)' : ''}\n`)

  let alive = 0
  let receiversFilled = 0
  let unverified = 0

  for (const [slug, eps] of byService) {
    const svc = bySlug.get(slug)!
    // First endpoint whose sample params build a valid request.
    let built: { ep: PlannableEndpoint; req: { url: string; method: string; headers: Record<string, string>; body?: string } } | null = null
    for (const ep of eps) {
      const sample = buildSample(ep)
      if (!sample) continue
      const r = buildSmartRequest(ep, sample)
      if ('request' in r) {
        built = { ep, req: r.request }
        break
      }
    }
    const wiredTag = svc.callable ? ' (wired)' : ''
    if (!built) {
      console.log(`  ?  ${slug}${wiredTag} — no sample request (required params lack examples)`)
      unverified++
      continue
    }

    const res = await probe(built.req).catch((): ProbeResult => ({ status: 'probe error' }))
    const isAlive = res.status.startsWith('alive')
    if (isAlive) alive++
    else unverified++

    const priceTag = res.price !== undefined ? ` $${res.price}` : ''
    const recvTag = res.payTo ? ` payTo=${res.payTo.slice(0, 10)}…` : ''
    console.log(`  ${isAlive ? '✓' : '✗'}  ${slug}${wiredTag} — ${res.status}${priceTag}${recvTag}`)

    // Fill a MISSING receiver for services db:receivers can't reach (no wired
    // endpoint). Only fill gaps — never overwrite a stored value, since some
    // gateways rotate the payTo per challenge (seen: tavily, allium) and a
    // snapshot would churn a stable owner address.
    if (res.payTo && !svc.receiver) {
      if (!DRY) {
        await prisma.mcpServer.update({
          where: { id: svc.id },
          data: { receiver: res.payTo, receiverCheckedAt: new Date() },
        })
      }
      receiversFilled++
    }
  }

  console.log(`\n${alive} alive, ${unverified} unverified · ${receiversFilled} receiver(s) ${DRY ? 'resolvable' : 'backfilled'}.`)
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
