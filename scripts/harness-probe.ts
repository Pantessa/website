#!/usr/bin/env tsx
/**
 * harness-probe.ts — FREE x402 liveness probe + price/scheme/network backfill.
 *
 * For each GET/POST mcp_endpoints row, makes ONE UNPAID request:
 *   402            -> alive + payable; harvest price/scheme/network/payTo/version from the challenge
 *   200/2xx        -> alive, no payment required (free or misconfigured)
 *   4xx/5xx        -> reachable but erroring
 *   timeout/network-> down / blocked
 * Writes one row per probe to `harness_results` (self-bootstrapping table) so the
 * leaderboard health column + per-endpoint accordion can read it.
 *
 * With --apply it ALSO backfills mcp_endpoints.price_usd/scheme/network where the
 * price is currently MISSING and the probe harvested a positive exact price.
 * It NEVER overwrites an existing numeric price, and it NEVER sends a payment —
 * there is no wallet/payment code path in this file.
 *
 * Usage:
 *   npx tsx scripts/harness-probe.ts                  # probe ALL GET/POST, write results, PREVIEW backfill
 *   npx tsx scripts/harness-probe.ts --apply          # also write the price backfill
 *   npx tsx scripts/harness-probe.ts --only-missing   # probe only price-missing endpoints
 *   npx tsx scripts/harness-probe.ts --limit=25       # small validation batch
 *   npx tsx scripts/harness-probe.ts --service=AgentMail
 *   npx tsx scripts/harness-probe.ts --concurrency=8
 */
import { PrismaClient } from '@prisma/client'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

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

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1]
const has = (k: string) => process.argv.includes(`--${k}`)

const APPLY = has('apply')
const LIMIT = arg('limit') ? parseInt(arg('limit')!, 10) : undefined
const SERVICE = arg('service')
const ONLY_MISSING = has('only-missing')
const CONCURRENCY = arg('concurrency') ? parseInt(arg('concurrency')!, 10) : 8
const TIMEOUT_MS = 15_000

type Probe = {
  endpointId: string
  service: string
  method: string
  url: string
  httpStatus: number | null
  status: string
  priceUsd: number | null
  scheme: string | null
  network: string | null
  payTo: string | null
  x402Version: number | null
  errorReason: string | null
  latencyMs: number | null
}

const isNumeric = (s: string | null | undefined) => !!s && /^[0-9]+(\.[0-9]+)?$/.test(s)

// Minimal, version-aware challenge reader (body JSON or base64 payment-required header). No payment.
function parseChallenge(bodyText: string, headerVal: string | null): any | null {
  if (bodyText) {
    try {
      const j = JSON.parse(bodyText)
      if (j && (j.accepts || j.x402Version || j.maxAmountRequired || j.amount)) return j
    } catch {
      /* not JSON */
    }
  }
  if (headerVal) {
    try {
      return JSON.parse(Buffer.from(headerVal, 'base64').toString('utf8'))
    } catch {
      /* not base64 json */
    }
  }
  return null
}

function harvest(ch: any) {
  const version = typeof ch?.x402Version === 'number' ? ch.x402Version : 1
  const accepts: any[] = Array.isArray(ch?.accepts) ? ch.accepts : []
  const pick =
    accepts.find(
      (a) =>
        a?.scheme === 'exact' &&
        (String(a?.network || '').includes('8453') || String(a?.network || '').toLowerCase() === 'base'),
    ) ??
    accepts.find((a) => a?.scheme === 'exact') ??
    accepts[0]
  if (!pick) return { priceUsd: null, scheme: null, network: null, payTo: null, version }
  const raw = pick.amount ?? pick.maxAmountRequired
  let priceUsd: number | null = null
  if (raw != null && /^[0-9]+$/.test(String(raw)))
    priceUsd = Number(raw) / 1e6 // microUSDC -> USD
  else if (raw != null && /^[0-9.]+$/.test(String(raw))) priceUsd = Number(raw)
  return { priceUsd, scheme: pick.scheme ?? null, network: pick.network ?? null, payTo: pick.payTo ?? null, version }
}

async function probe(ep: { id: string; service: string; method: string; url: string }): Promise<Probe> {
  const out: Probe = {
    endpointId: ep.id, service: ep.service, method: ep.method, url: ep.url,
    httpStatus: null, status: 'unknown', priceUsd: null, scheme: null, network: null,
    payTo: null, x402Version: null, errorReason: null, latencyMs: null,
  }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  const t0 = Date.now()
  try {
    const init: RequestInit = {
      method: ep.method,
      redirect: 'follow',
      signal: ctrl.signal,
      headers:
        ep.method === 'POST'
          ? { 'content-type': 'application/json', accept: 'application/json' }
          : { accept: 'application/json' },
      ...(ep.method === 'POST' ? { body: '{}' } : {}),
    }
    const res = await fetch(ep.url, init)
    out.latencyMs = Date.now() - t0
    out.httpStatus = res.status
    const headerVal = res.headers.get('payment-required') || res.headers.get('x-payment-required')
    let bodyText = ''
    try {
      bodyText = await res.text()
    } catch {
      /* ignore */
    }
    if (res.status === 402) {
      const ch = parseChallenge(bodyText, headerVal)
      if (ch) {
        const h = harvest(ch)
        out.priceUsd = h.priceUsd
        out.scheme = h.scheme
        out.network = h.network
        out.payTo = h.payTo
        out.x402Version = h.version
        out.status = h.priceUsd != null ? 'alive_402_priced' : 'alive_402_noprice'
      } else {
        out.status = 'alive_402_unparsed'
      }
    } else if (res.status >= 200 && res.status < 300) {
      out.status = 'alive_200_free'
    } else if (res.status >= 400 && res.status < 500) {
      out.status = 'http_4xx'
    } else if (res.status >= 500) {
      out.status = 'http_5xx'
    } else {
      out.status = `http_${res.status}`
    }
  } catch (e: any) {
    out.latencyMs = Date.now() - t0
    out.status = e?.name === 'AbortError' ? 'timeout' : 'unreachable'
    out.errorReason = String(e?.cause?.code || e?.code || e?.message || 'network_error').slice(0, 200)
  } finally {
    clearTimeout(timer)
  }
  return out
}

async function main() {
  loadEnv()
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL not set (need website/.env.local). Aborting.')
    process.exit(1)
  }
  const prisma = new PrismaClient()

  // self-bootstrap the results table (additive, idempotent)
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS harness_results (
      id           text PRIMARY KEY,
      endpoint_id  text NOT NULL,
      service      text,
      method       text,
      url          text,
      http_status  integer,
      status       text NOT NULL,
      price_usd    double precision,
      scheme       text,
      network      text,
      pay_to       text,
      x402_version integer,
      error_reason text,
      latency_ms   integer,
      probed_at    timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS harness_results_endpoint_id_idx ON harness_results(endpoint_id)`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS harness_results_status_idx ON harness_results(status)`)

  const rows = await prisma.mcpEndpoint.findMany({
    where: { method: { in: ['GET', 'POST'] } },
    select: {
      id: true, method: true, url: true, priceUsd: true, scheme: true, network: true,
      server: { select: { name: true } },
    },
    orderBy: { createdAt: 'asc' },
  })
  let work = rows.map((r) => ({
    id: r.id, method: r.method, url: r.url, service: r.server?.name ?? '',
    priceUsd: r.priceUsd, scheme: r.scheme, network: r.network,
  }))
  if (SERVICE) work = work.filter((w) => w.service.toLowerCase().includes(SERVICE.toLowerCase()))
  if (ONLY_MISSING) work = work.filter((w) => !isNumeric(w.priceUsd))
  if (LIMIT) work = work.slice(0, LIMIT)

  console.log(`Probing ${work.length} endpoints · concurrency ${CONCURRENCY} · timeout ${TIMEOUT_MS}ms · apply=${APPLY}`)

  const results: Probe[] = []
  let idx = 0, done = 0
  async function worker() {
    while (idx < work.length) {
      const w = work[idx++]
      const r = await probe(w)
      results.push(r)
      done++
      if (done % 50 === 0) console.log(`  …${done}/${work.length}`)
      await prisma.$executeRawUnsafe(
        `INSERT INTO harness_results (id, endpoint_id, service, method, url, http_status, status, price_usd, scheme, network, pay_to, x402_version, error_reason, latency_ms)
         VALUES (gen_random_uuid()::text,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        r.endpointId, r.service, r.method, r.url, r.httpStatus, r.status,
        r.priceUsd, r.scheme, r.network, r.payTo, r.x402Version, r.errorReason, r.latencyMs,
      )
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))

  const by: Record<string, number> = {}
  for (const r of results) by[r.status] = (by[r.status] || 0) + 1
  console.log('\n=== probe summary ===')
  for (const [k, v] of Object.entries(by).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(20)} ${v}`)

  const wmap = new Map(work.map((w) => [w.id, w]))
  const fillable = results.filter(
    (r) =>
      r.priceUsd != null && r.priceUsd > 0 &&
      (r.scheme === 'exact' || r.scheme == null) &&
      !isNumeric(wmap.get(r.endpointId)?.priceUsd ?? null),
  )
  const newGet = fillable.filter((r) => r.method === 'GET').length
  console.log(`\nbackfill candidates (missing price -> harvested): ${fillable.length}  (GET, immediately callable: ${newGet})`)

  if (APPLY) {
    let n = 0
    for (const r of fillable) {
      await prisma.mcpEndpoint.update({
        where: { id: r.endpointId },
        data: {
          priceUsd: String(r.priceUsd),
          ...(r.scheme ? { scheme: r.scheme } : {}),
          ...(r.network ? { network: r.network } : {}),
        },
      })
      n++
    }
    console.log(`✅ backfilled ${n} endpoints (price/scheme/network)`)
  } else {
    console.log('(preview only — re-run with --apply to write the backfill)')
  }

  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
