// ─────────────────────────────────────────────────────────────────────────
//  MCP Health — "how well is this MCP actually working?" in one number.
//
//  The self-heal spine. Three independent signals, each already logged, fused
//  into one health score + a weakest-lever headline that says what to fix:
//    • reputation  — real usage: settle rate, latency, adoption (lib/reputation)
//    • routability — can a router even discover + construct calls (mcp:lint)
//    • incidents   — unresolved failures deduped from live traffic (route_incidents)
//
//  Usage + analytics → a status (healthy / watch / attention / unproven) and a
//  one-line action. `/dashboard/health` ranks every MCP by this and hands the
//  operator a Claude Code fix prompt grounded in the real failures.
// ─────────────────────────────────────────────────────────────────────────

import prisma from '@/lib/db'
import type { ReputationScore } from '@/lib/reputation'
import type { RoutabilityReport } from '@/lib/mcp-lint-report'

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n))

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

export interface HealthIncidents {
  /** distinct open/dispatched/pr_open incidents for this service */
  open: number
  /** total failure occurrences across those incidents */
  occurrences: number
  /** the highest-impact open incident's human title */
  topTitle: string | null
  /** its stable id, for linking to /incidents/<id> */
  topId: string | null
}

export type HealthStatus = 'healthy' | 'watch' | 'attention' | 'unproven'

export interface McpHealth {
  slug: string
  name: string
  /** 0..100 blended; null only when there is zero evidence (unproven). */
  health: number | null
  status: HealthStatus
  /** weakest-lever, action-first one-liner. */
  headline: string
  reputation: { overall: number; tier: string; settleRate: number; calls: number; qualified: boolean } | null
  routability: { score: number; grade: string } | null
  incidents: HealthIncidents
}

// Unresolved failures sink health fast, then flatten: 1 occ→~82, 3→~64, 7→~46,
// 15→~28, 40→~10. A single flaky call shouldn't nuke an otherwise-good service.
function incidentHealth(occurrences: number): number {
  if (occurrences <= 0) return 100
  return clamp(100 - 18 * Math.log2(occurrences + 1))
}

const EMPTY_INCIDENTS: HealthIncidents = { open: 0, occurrences: 0, topTitle: null, topId: null }

/**
 * Fuse the three signals for one service into a single health verdict. Pure —
 * callers supply the already-loaded reputation/routability/incidents.
 */
export function computeHealth(input: {
  slug: string
  name: string
  reputation: ReputationScore | null
  routability: RoutabilityReport | null
  incidents?: HealthIncidents
}): McpHealth {
  const incidents = input.incidents ?? EMPTY_INCIDENTS
  const rep = input.reputation
  const rout = input.routability

  const repQualified = !!rep?.qualified
  const repScore = repQualified ? rep!.overall : null
  const routScore = rout ? rout.score : null
  const incScore = incidentHealth(incidents.occurrences)

  const hasEvidence = repQualified || routScore != null || incidents.open > 0

  // Weighted blend over the dimensions we actually have signal for. Incident
  // health only counts once there's other evidence OR real incidents — a
  // never-touched service shouldn't read as "100% healthy".
  const dims: { v: number; w: number }[] = []
  if (repScore != null) dims.push({ v: repScore, w: 0.45 })
  if (routScore != null) dims.push({ v: routScore, w: 0.35 })
  if (hasEvidence) dims.push({ v: incScore, w: 0.2 })
  const den = dims.reduce((a, d) => a + d.w, 0)
  const health = den > 0 ? Math.round(dims.reduce((a, d) => a + d.v * d.w, 0) / den) : null

  let status: HealthStatus
  if (!hasEvidence || health == null) status = 'unproven'
  else if (health < 55 || incidents.open >= 3) status = 'attention'
  else if (health < 78 || incidents.open > 0) status = 'watch'
  else status = 'healthy'

  // Weakest-lever headline — the one thing most worth fixing.
  let headline: string
  if (incidents.open > 0) {
    const n = incidents.occurrences
    headline = `${n} unresolved failure${n === 1 ? '' : 's'}${incidents.topTitle ? ` — ${incidents.topTitle}` : ''}`
  } else if (routScore != null && routScore < 70) {
    headline = `Routability ${rout!.grade} (${routScore}/100) — tighten schemas & descriptions`
  } else if (repQualified && rep!.settleRate < 0.9) {
    headline = `Settle rate ${Math.round(rep!.settleRate * 100)}% over ${rep!.calls} call${rep!.calls === 1 ? '' : 's'}`
  } else if (routScore == null) {
    headline = 'Not yet linted — run routability diagnostics'
  } else if (!repQualified) {
    headline = 'No traffic yet — routable, but unproven in use'
  } else {
    headline = 'Working well across usage, routability, and reliability'
  }

  return {
    slug: input.slug,
    name: input.name,
    health,
    status,
    headline,
    reputation: rep
      ? { overall: rep.overall, tier: rep.tier, settleRate: rep.settleRate, calls: rep.calls, qualified: repQualified }
      : null,
    routability: rout ? { score: rout.score, grade: rout.grade } : null,
    incidents,
  }
}

/**
 * Load open-incident rollups keyed by the SLUGIFIED service name, so callers
 * can match them to a McpServer by slugify(server.name). Only unresolved states
 * count (open | dispatched | pr_open) — a resolved/wontfix incident is healed.
 */
export async function loadOpenIncidentsByService(): Promise<Map<string, HealthIncidents>> {
  const out = new Map<string, HealthIncidents>()
  if (process.env.USE_DB !== 'true' || !process.env.DATABASE_URL) return out
  try {
    const rows = await prisma.routeIncident.findMany({
      where: { status: { in: ['open', 'dispatched', 'pr_open'] } },
      orderBy: [{ count: 'desc' }, { lastSeenAt: 'desc' }],
      select: { id: true, service: true, title: true, count: true },
    })
    for (const r of rows) {
      const key = slugify(r.service ?? '')
      if (!key) continue
      const cur = out.get(key) ?? { open: 0, occurrences: 0, topTitle: null, topId: null }
      cur.open += 1
      cur.occurrences += r.count
      if (cur.topTitle == null) {
        // rows are count-desc, so the first one we see for a service is its worst
        cur.topTitle = r.title
        cur.topId = r.id
      }
      out.set(key, cur)
    }
  } catch {
    /* health is advisory — never throw a page over an incidents read */
  }
  return out
}

/** Convenience: the open incidents for ONE service name. */
export async function incidentsForService(name: string): Promise<HealthIncidents> {
  const map = await loadOpenIncidentsByService()
  return map.get(slugify(name)) ?? { ...EMPTY_INCIDENTS }
}

const STATUS_RANK: Record<HealthStatus, number> = { attention: 0, watch: 1, healthy: 2, unproven: 3 }

/**
 * Fleet health — every directory MCP scored and sorted worst-first (attention →
 * watch → healthy → unproven, then lowest health). Powers the /health cockpit:
 * one grouped ledger read (computeReputation), one incidents read, routability
 * off each row. Advisory: returns [] rather than throwing a page.
 */
export async function loadFleetHealth(): Promise<McpHealth[]> {
  if (process.env.USE_DB !== 'true' || !process.env.DATABASE_URL) return []
  const { computeReputation } = await import('@/lib/reputation')
  try {
    const servers = await prisma.mcpServer.findMany({
      select: { slug: true, name: true, category: true, priceUsd: true, routability: true },
    })
    const [repMap, incMap] = await Promise.all([
      computeReputation(servers.map((s) => ({ slug: s.slug, name: s.name, category: s.category, priceUsd: s.priceUsd }))),
      loadOpenIncidentsByService(),
    ])
    const fleet = servers.map((s) =>
      computeHealth({
        slug: s.slug,
        name: s.name,
        reputation: repMap.get(s.slug) ?? null,
        routability: (s.routability as unknown as RoutabilityReport | null) ?? null,
        incidents: incMap.get(slugify(s.name)) ?? { ...EMPTY_INCIDENTS },
      }),
    )
    return fleet.sort((a, b) => {
      const r = STATUS_RANK[a.status] - STATUS_RANK[b.status]
      if (r !== 0) return r
      return (a.health ?? 999) - (b.health ?? 999)
    })
  } catch {
    return []
  }
}

/** Status → display metadata (label + accent token) for panels/badges. */
export const HEALTH_STATUS_META: Record<HealthStatus, { label: string; tone: 'good' | 'warn' | 'bad' | 'muted' }> = {
  healthy: { label: 'Healthy', tone: 'good' },
  watch: { label: 'Watch', tone: 'warn' },
  attention: { label: 'Needs attention', tone: 'bad' },
  unproven: { label: 'Unproven', tone: 'muted' },
}
