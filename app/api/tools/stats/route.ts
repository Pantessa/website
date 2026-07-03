import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getTurnTrace } from '@/lib/route-trace'
import { EMPTY_TOOLS_STATS, type ToolsStats } from '@/lib/thinking-tools'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Public aggregates for /tools — how often each thinking tool fired and what
 * the network's settled calls look like. SAME privacy posture as
 * /api/activity: everything here is derived from rows that were already
 * public-safe at write time (engine intent, service names, prices, statuses —
 * never the user's message, never an address).
 */
export async function GET() {
  if (process.env.USE_DB !== 'true' || !process.env.DATABASE_URL) {
    return NextResponse.json(EMPTY_TOOLS_STATS, { headers: { 'cache-control': 'no-store' } })
  }
  try {
    const [trace, toolRuns, selects, latestSelect, flow, eventsAgg, incidents, endpoints] =
      await Promise.all([
        prisma.$queryRaw<{ type: string; n: number }[]>`
          SELECT type, count(*)::int AS n FROM route_trace_lines GROUP BY type`,
        prisma.$queryRaw<{ name: string; runs: number; example: string | null }[]>`
          SELECT event->>'name' AS name,
                 count(*)::int AS runs,
                 max(CASE WHEN event->>'status' = 'ok' THEN event->>'detail' END) AS example
          FROM route_trace_lines
          WHERE type = 'tool' AND event->>'name' IS NOT NULL
          GROUP BY 1 ORDER BY runs DESC LIMIT 20`,
        prisma.$queryRaw<{ service: string; reason: string | null; price: string | null; at: Date }[]>`
          SELECT event->>'service' AS service, event->>'reason' AS reason,
                 event->>'priceUsd' AS price, created_at AS at
          FROM route_trace_lines
          WHERE type = 'select' AND event->>'service' IS NOT NULL
          ORDER BY created_at DESC LIMIT 40`,
        prisma.routeTraceLine.findFirst({
          where: { type: 'select' },
          orderBy: { n: 'desc' },
          select: { turnId: true, payer: true },
        }),
        prisma.$queryRaw<{ category: string | null; service: string; ok: boolean; calls: number; usd: number }[]>`
          SELECT s.category AS category, l.service_name AS service, l.ok,
                 count(*)::int AS calls, coalesce(sum(l.amount_usd), 0)::float AS usd
          FROM spend_ledger l
          LEFT JOIN mcp_servers s ON s.name = l.service_name
          WHERE l.service_name IS NOT NULL AND l.service_name NOT ILIKE 'fake%'
          GROUP BY 1, 2, 3 ORDER BY calls DESC LIMIT 60`,
        prisma.$queryRaw<{ turns: number; settled: number; blocked: number; cost: number }[]>`
          SELECT count(*)::int AS turns,
                 coalesce(sum(settled_count), 0)::int AS settled,
                 count(*) FILTER (WHERE blocked)::int AS blocked,
                 coalesce(sum(total_cost_usd), 0)::float AS cost
          FROM route_events`,
        prisma.$queryRaw<{ status: string; n: number }[]>`
          SELECT status, count(*)::int AS n FROM route_incidents GROUP BY status`,
        prisma.$queryRaw<{ total: number; with_params: number; embedded: number }[]>`
          SELECT count(*)::int AS total,
                 count(*) FILTER (WHERE parameters IS NOT NULL)::int AS with_params,
                 count(*) FILTER (WHERE embedding IS NOT NULL)::int AS embedded
          FROM mcp_endpoints`,
      ])

    const latestTurn = latestSelect
      ? {
          turnId: latestSelect.turnId,
          payer: latestSelect.payer,
          lines: await getTurnTrace(latestSelect.turnId),
        }
      : null

    const ev = eventsAgg[0] ?? { turns: 0, settled: 0, blocked: 0, cost: 0 }
    const ep = endpoints[0] ?? { total: 0, with_params: 0, embedded: 0 }
    const body: ToolsStats = {
      trace,
      toolRuns,
      selects: selects.map((s) => ({
        service: s.service,
        reason: s.reason,
        priceUsd: s.price,
        at: new Date(s.at).toISOString(),
      })),
      latestTurn,
      flow: flow.map((f) => ({
        category: f.category ?? '',
        service: f.service,
        ok: f.ok,
        calls: f.calls,
        usd: f.usd,
      })),
      events: { turns: ev.turns, settled: ev.settled, blocked: ev.blocked, costUsd: ev.cost },
      incidents,
      endpoints: { total: ep.total, withParams: ep.with_params, embedded: ep.embedded },
      generatedAt: new Date().toISOString(),
    }
    return NextResponse.json(body, { headers: { 'cache-control': 'no-store' } })
  } catch {
    // The page must render without the DB — zeros beat a 500.
    return NextResponse.json(EMPTY_TOOLS_STATS, { headers: { 'cache-control': 'no-store' } })
  }
}
