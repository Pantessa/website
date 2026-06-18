import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getSessionAddress } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DAY = 86_400_000

// GET /api/dashboard/earnings — the EARN side of the Overview, mirroring the
// spend KPIs. Wallet-scoped: aggregates the McpReceipts reported for the servers
// this wallet operates (claimed). Returns all-time + last-30-day totals, a
// per-MCP breakdown, and a 30-day daily series for the chart.
export async function GET() {
  const addr = await getSessionAddress()
  if (!addr) return NextResponse.json({ error: 'Sign in.' }, { status: 401 })

  const since30 = new Date(Date.now() - 30 * DAY)

  const [allTime, last30, byMcpAll, byMcp30, recent, distinctPayers] = await Promise.all([
    prisma.mcpReceipt.aggregate({ where: { ownerAddress: addr }, _sum: { amountUsd: true }, _count: true }),
    prisma.mcpReceipt.aggregate({
      where: { ownerAddress: addr, createdAt: { gte: since30 } },
      _sum: { amountUsd: true },
      _count: true,
    }),
    prisma.mcpReceipt.groupBy({
      by: ['mcpSlug'],
      where: { ownerAddress: addr },
      _sum: { amountUsd: true },
      _count: true,
    }),
    prisma.mcpReceipt.groupBy({
      by: ['mcpSlug'],
      where: { ownerAddress: addr, createdAt: { gte: since30 } },
      _sum: { amountUsd: true },
    }),
    prisma.mcpReceipt.findMany({
      where: { ownerAddress: addr, createdAt: { gte: since30 } },
      select: { amountUsd: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.mcpReceipt.findMany({
      where: { ownerAddress: addr, payer: { not: null } },
      select: { payer: true },
      distinct: ['payer'],
    }),
  ])

  // Names for the per-MCP breakdown.
  const slugs = byMcpAll.map((g) => g.mcpSlug)
  const servers = slugs.length
    ? await prisma.mcpServer.findMany({ where: { slug: { in: slugs } }, select: { slug: true, name: true } })
    : []
  const nameBySlug = new Map(servers.map((s) => [s.slug, s.name]))
  const usd30BySlug = new Map(byMcp30.map((g) => [g.mcpSlug, g._sum.amountUsd ?? 0]))

  const byMcp = byMcpAll
    .map((g) => ({
      slug: g.mcpSlug,
      name: nameBySlug.get(g.mcpSlug) ?? g.mcpSlug,
      earnedUsd: g._sum.amountUsd ?? 0,
      earned30dUsd: usd30BySlug.get(g.mcpSlug) ?? 0,
      calls: g._count,
    }))
    .sort((a, b) => b.earnedUsd - a.earnedUsd)

  // 30-day daily series (UTC days), zero-filled, for the area chart.
  const buckets = new Map<string, number>()
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * DAY).toISOString().slice(0, 10)
    buckets.set(d, 0)
  }
  for (const r of recent) {
    const d = r.createdAt.toISOString().slice(0, 10)
    if (buckets.has(d)) buckets.set(d, (buckets.get(d) ?? 0) + r.amountUsd)
  }
  const series30d = [...buckets.entries()].map(([date, usd]) => ({ date, usd }))

  return NextResponse.json({
    kpis: {
      totalEarnedUsd: allTime._sum.amountUsd ?? 0,
      earned30dUsd: last30._sum.amountUsd ?? 0,
      callsServed: allTime._count,
      calls30d: last30._count,
      payers: distinctPayers.length,
      topMcp: byMcp[0] ? { slug: byMcp[0].slug, name: byMcp[0].name, earnedUsd: byMcp[0].earnedUsd } : null,
      mcpCount: byMcp.length,
    },
    byMcp,
    series30d,
  })
}
