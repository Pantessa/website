// ─────────────────────────────────────────────────────────────────────────
//  Yeetful tool benchmarks — the "are OUR tools doing their job?" view.
//
//  The leaderboard ranks the whole x402 directory by earned reputation. This
//  is the sibling telemetry for Yeetful's OWN tools — the first-party routing-
//  engine tools (source: 'yeetful'): the CoW / Uniswap transaction builders,
//  the Snapshot governance tools, and the hosted Yeetful MCPs. Same honest
//  data as the leaderboard (spend_ledger settle/fail/latency + the free x402
//  health probe + deduplicated route incidents), but framed operationally:
//  is the tool getting the job done, degraded, failing, or untested yet?
//
//  Pure aggregation over data we already log — NO fabricated numbers. A tool
//  with no calls reads "New" (never a fake green).
// ─────────────────────────────────────────────────────────────────────────

import prisma from '@/lib/db'
import { computeReputation } from '@/lib/reputation'
import { getHealthByService, type ServiceHealth } from '@/lib/health'
import { listIncidents } from '@/lib/incidents'

/** Operational status of a first-party tool, most-broken first. */
export type ToolStatus = 'failing' | 'degraded' | 'healthy' | 'new'

export interface ToolBenchmark {
  slug: string
  name: string
  category: string
  description: string
  iconSlug: string | null
  color: string | null
  websiteUrl: string | null
  /** Payment posture: gated = x402-paid, free = non-gated (ledgered at $0). */
  gated: boolean
  /** Wired for a direct free-text call in chat (vs planner-driven tools). */
  callable: boolean
  priceUsd: number | null
  /** How many tool endpoints this service exposes (the "capabilities" count). */
  toolCount: number

  // Earned from real paid/free calls (30-day window), via spend_ledger.
  calls: number
  settled: number
  failed: number
  settleRate: number
  medianLatencyMs: number | null
  lastSettledAt: string | null

  // Free x402 liveness probe (reachability, separate from earned reputation).
  health: ServiceHealth | null

  // Deduplicated live failures (the self-heal loop's open work for this tool).
  openIncidents: number
  incidentClasses: string[]

  status: ToolStatus
}

function statusOf(
  calls: number,
  settleRate: number,
  openIncidents: number,
  health: ServiceHealth | null,
): ToolStatus {
  // A live failure the self-heal loop is still working, or a probe that finds
  // every endpoint down, means the tool is failing regardless of old volume.
  if (openIncidents > 0) return 'failing'
  if (health && health.total > 0 && health.live === 0 && health.down > 0) return 'failing'
  if (calls === 0) return 'new'
  if (settleRate < 0.5) return 'failing'
  if (settleRate < 0.85) return 'degraded'
  return 'healthy'
}

/**
 * Benchmark every first-party (source: 'yeetful') tool. One servers read plus
 * the three shared aggregators (reputation / health / incidents). Ordered
 * most-broken first so a regression surfaces at the top, then by proven volume.
 */
export async function getYeetfulToolBenchmarks(): Promise<ToolBenchmark[]> {
  let servers: {
    slug: string
    name: string
    category: string
    description: string
    iconSlug: string | null
    color: string | null
    websiteUrl: string | null
    gated: boolean
    callable: boolean
    priceUsd: string | null
    _count: { endpoints: number }
  }[] = []
  try {
    servers = await prisma.mcpServer.findMany({
      where: { source: 'yeetful' },
      select: {
        slug: true,
        name: true,
        category: true,
        description: true,
        iconSlug: true,
        color: true,
        websiteUrl: true,
        gated: true,
        callable: true,
        priceUsd: true,
        _count: { select: { endpoints: true } },
      },
    })
  } catch {
    return []
  }
  if (servers.length === 0) return []

  const [repMap, healthMap, incidents] = await Promise.all([
    computeReputation(
      servers.map((s) => ({ slug: s.slug, name: s.name, category: s.category, priceUsd: s.priceUsd })),
    ),
    getHealthByService(),
    listIncidents(),
  ])

  // Open incidents (still being worked) keyed by the failing service name.
  const OPEN = new Set(['open', 'dispatched', 'pr_open'])
  const incByService = new Map<string, string[]>()
  for (const inc of incidents) {
    if (!inc.service || !OPEN.has(inc.status)) continue
    const arr = incByService.get(inc.service) ?? []
    if (inc.errorClass && !arr.includes(inc.errorClass)) arr.push(inc.errorClass)
    incByService.set(inc.service, arr)
  }

  const rows: ToolBenchmark[] = servers.map((s) => {
    const rep = repMap.get(s.slug)
    const health = healthMap.get(s.slug) ?? null
    const incidentClasses = incByService.get(s.name) ?? []
    const calls = rep?.calls ?? 0
    const settleRate = rep?.settleRate ?? 0
    return {
      slug: s.slug,
      name: s.name,
      category: s.category,
      description: s.description,
      iconSlug: s.iconSlug,
      color: s.color,
      websiteUrl: s.websiteUrl,
      gated: s.gated,
      callable: s.callable,
      priceUsd: Number.isFinite(Number(s.priceUsd)) ? Number(s.priceUsd) : null,
      toolCount: s._count.endpoints,
      calls,
      settled: rep?.settled ?? 0,
      failed: rep?.failed ?? 0,
      settleRate,
      medianLatencyMs: rep?.medianLatencyMs ?? null,
      lastSettledAt: rep?.lastSettledAt ?? null,
      health,
      openIncidents: incidentClasses.length,
      incidentClasses,
      status: statusOf(calls, settleRate, incidentClasses.length, health),
    }
  })

  const STATUS_RANK: Record<ToolStatus, number> = { failing: 0, degraded: 1, healthy: 2, new: 3 }
  rows.sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || b.calls - a.calls || a.name.localeCompare(b.name))
  return rows
}
