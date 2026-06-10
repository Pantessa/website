import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getSessionAddress } from '@/lib/auth'
import { spentTodayUsd, spentTotalUsd } from '@/lib/grant-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Dashboard aggregates for the signed-in wallet, derived from the spend
 * ledger of ALL their grants (current + past): KPIs, a 30-day daily spend
 * series, per-agent totals, and the recent activity feed.
 */
export async function GET() {
  const addr = await getSessionAddress()
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const grants = await prisma.spendGrant.findMany({
    where: { ownerAddress: addr },
    select: { id: true, label: true, perCallUsd: true, perDayUsd: true, allow: true, status: true, expiresAt: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  })
  const grantIds = grants.map((g) => g.id)
  const active = grants.find((g) => g.status === 'active' && g.expiresAt > new Date()) ?? null

  if (grantIds.length === 0) {
    return NextResponse.json({
      grant: null,
      kpis: { spentTotalUsd: 0, spentTodayUsd: 0, calls: 0, deniedCalls: 0, successRate: null, topAgent: null },
      daily: [],
      perAgent: [],
      recent: [],
    })
  }

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const [today, totalActive, totals, denied, daily, perAgent, recent] = await Promise.all([
    active ? spentTodayUsd(active.id) : Promise.resolve(0),
    active ? spentTotalUsd(active.id) : Promise.resolve(0),
    prisma.spendLedgerEntry.aggregate({
      where: { grantId: { in: grantIds }, ok: true },
      _sum: { amountUsd: true },
      _count: true,
    }),
    prisma.spendLedgerEntry.count({ where: { grantId: { in: grantIds }, ok: false } }),
    // Daily spend + call counts, last 30 days (UTC buckets).
    prisma.$queryRaw<{ day: Date; spent: number; calls: bigint }[]>`
      SELECT date_trunc('day', created_at) AS day,
             COALESCE(SUM(amount_usd) FILTER (WHERE ok), 0)::float AS spent,
             COUNT(*) FILTER (WHERE ok) AS calls
      FROM spend_ledger
      WHERE grant_id = ANY(${grantIds}) AND created_at >= ${since}
      GROUP BY 1 ORDER BY 1`,
    prisma.$queryRaw<{ service: string; spent: number; calls: bigint }[]>`
      SELECT COALESCE(service_name, host) AS service,
             COALESCE(SUM(amount_usd) FILTER (WHERE ok), 0)::float AS spent,
             COUNT(*) FILTER (WHERE ok) AS calls
      FROM spend_ledger
      WHERE grant_id = ANY(${grantIds})
      GROUP BY 1 HAVING COUNT(*) FILTER (WHERE ok) > 0
      ORDER BY 2 DESC LIMIT 12`,
    prisma.spendLedgerEntry.findMany({
      where: { grantId: { in: grantIds } },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, host: true, serviceName: true, amountUsd: true, ok: true, txHash: true, note: true, createdAt: true },
    }),
  ])

  const okCalls = totals._count
  const successRate = okCalls + denied > 0 ? okCalls / (okCalls + denied) : null
  const topAgent = perAgent[0]?.service ?? null

  return NextResponse.json({
    grant: active
      ? {
          id: active.id,
          label: active.label,
          perCallUsd: active.perCallUsd,
          perDayUsd: active.perDayUsd,
          allowCount: active.allow.length,
          expiresAt: active.expiresAt,
          spentTodayUsd: today,
          spentTotalUsd: totalActive,
          remainingTodayUsd: Math.max(0, active.perDayUsd - today),
        }
      : null,
    kpis: {
      spentTotalUsd: totals._sum.amountUsd ?? 0,
      spentTodayUsd: today,
      calls: okCalls,
      deniedCalls: denied,
      successRate,
      topAgent,
    },
    daily: daily.map((d) => ({ day: d.day, spent: d.spent, calls: Number(d.calls) })),
    perAgent: perAgent.map((p) => ({ service: p.service, spent: p.spent, calls: Number(p.calls) })),
    recent,
  })
}
