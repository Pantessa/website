// ─────────────────────────────────────────────────────────────────────────
//  Route telemetry — persist each routed turn + aggregate routing metrics, so
//  the engine is observable over time. Privacy mirrors /api/activity: aggregate
//  + service slugs only, never a full wallet or the raw question.
// ─────────────────────────────────────────────────────────────────────────

import { Prisma } from '@prisma/client'
import prisma from '@/lib/db'

export interface RouteEventInput {
  intent?: string | null
  shortlisted?: number
  picks?: { service: string; endpoint?: string; priceUsd?: string }[]
  settledCount?: number
  failedCount?: number
  cachedCount?: number
  totalCostUsd?: number
  savedUsd?: number
  latencyMs?: number
  payer?: string | null
  blocked?: boolean
}

/** Fire-and-forget telemetry write — NEVER fail a turn over it. */
export function recordRouteEvent(e: RouteEventInput): void {
  if (process.env.USE_DB !== 'true' || !process.env.DATABASE_URL) return
  prisma.routeEvent
    .create({
      data: {
        intent: e.intent ? e.intent.slice(0, 200) : null,
        shortlisted: e.shortlisted ?? 0,
        picks: (e.picks ?? []) as unknown as Prisma.InputJsonValue,
        settledCount: e.settledCount ?? 0,
        failedCount: e.failedCount ?? 0,
        cachedCount: e.cachedCount ?? 0,
        totalCostUsd: e.totalCostUsd ?? 0,
        savedUsd: e.savedUsd ?? 0,
        latencyMs: e.latencyMs ?? 0,
        payer: e.payer ?? null,
        blocked: e.blocked ?? false,
      },
    })
    .catch(() => {})
}

/**
 * Per-turn value (B15): what smart routing saved vs naive routing. Two honest
 * components — cache (a re-pay avoided) and "vs priciest" (the engine picked a
 * cheaper relevant tool than the most expensive one it considered). Pure +
 * tested. Framed as "vs the priciest relevant option", not an absolute claim.
 */
export function routeSavings(opts: { shortlistPrices: number[]; pickPrices: number[]; cacheSavedUsd: number }): {
  cacheSavedUsd: number
  savedVsPriciestUsd: number
  totalUsd: number
} {
  const priciest = opts.shortlistPrices.length ? Math.max(0, ...opts.shortlistPrices) : 0
  const savedVsPriciestUsd = opts.pickPrices.reduce((a, p) => a + Math.max(0, priciest - p), 0)
  return { cacheSavedUsd: opts.cacheSavedUsd, savedVsPriciestUsd, totalUsd: opts.cacheSavedUsd + savedVsPriciestUsd }
}

const WINDOW_MS = 30 * 86_400_000

export interface RouteMetrics {
  turns: number
  avgCostUsd: number
  totalSavedUsd: number
  cacheHitRate: number
  avgShortlisted: number
  blockedRate: number
  latencyMs: { p50: number; p95: number }
  /** Per-MCP reliability from the spend ledger (richer than the picks JSON). */
  services: { service: string; settled: number; failed: number; settleRate: number }[]
}

/** Aggregate, privacy-safe routing metrics over the recent window. */
export async function routeMetrics(): Promise<RouteMetrics> {
  const since = new Date(Date.now() - WINDOW_MS)
  const [events, ledger] = await Promise.all([
    prisma.routeEvent.findMany({
      where: { createdAt: { gte: since } },
      select: { settledCount: true, failedCount: true, cachedCount: true, totalCostUsd: true, savedUsd: true, latencyMs: true, shortlisted: true, blocked: true },
      orderBy: { createdAt: 'desc' },
      take: 5000,
    }),
    prisma.spendLedgerEntry.groupBy({
      by: ['serviceName', 'ok'],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
    }),
  ])

  const turns = events.length
  const sum = (f: keyof (typeof events)[number]) => events.reduce((a, e) => a + (Number(e[f]) || 0), 0)
  const totalCalls = sum('settledCount') + sum('failedCount') + sum('cachedCount')
  const latencies = events.map((e) => e.latencyMs).filter((n) => n > 0).sort((a, b) => a - b)
  const pct = (p: number) => (latencies.length ? latencies[Math.min(latencies.length - 1, Math.floor(p * latencies.length))] : 0)

  const byService = new Map<string, { settled: number; failed: number }>()
  for (const r of ledger) {
    if (!r.serviceName) continue
    const cur = byService.get(r.serviceName) ?? { settled: 0, failed: 0 }
    if (r.ok) cur.settled += r._count._all
    else cur.failed += r._count._all
    byService.set(r.serviceName, cur)
  }
  const services = [...byService.entries()]
    .map(([service, c]) => ({ service, settled: c.settled, failed: c.failed, settleRate: c.settled + c.failed ? c.settled / (c.settled + c.failed) : 0 }))
    .sort((a, b) => b.settled - a.settled)
    .slice(0, 20)

  return {
    turns,
    avgCostUsd: turns ? sum('totalCostUsd') / turns : 0,
    totalSavedUsd: sum('savedUsd'),
    cacheHitRate: totalCalls ? sum('cachedCount') / totalCalls : 0,
    avgShortlisted: turns ? sum('shortlisted') / turns : 0,
    blockedRate: turns ? events.filter((e) => e.blocked).length / turns : 0,
    latencyMs: { p50: pct(0.5), p95: pct(0.95) },
    services,
  }
}
