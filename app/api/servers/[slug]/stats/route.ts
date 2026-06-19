import { NextResponse } from 'next/server'
import prisma from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DAY = 86_400_000

// Block explorer per settlement network (receipts settle on Base mainnet; the
// token itself lives on the launch testnet, so this is independent of the token
// explorer).
const EXPLORERS: Record<string, string> = {
  base: 'https://basescan.org',
  'base-mainnet': 'https://basescan.org',
  'base-sepolia': 'https://sepolia.basescan.org',
}
const explorerFor = (network: string | null) => EXPLORERS[(network ?? 'base').toLowerCase()] ?? 'https://basescan.org'

// GET /api/servers/[slug]/stats — PUBLIC per-MCP performance, scoped by mcpSlug
// (the dashboard's earnings route is the same data scoped by wallet). Aggregates
// the receipts this MCP reported: settled (on-chain verified) vs total earned,
// calls served, active paying accounts, a 30-day usage series, and the most
// recent settlements with their on-chain verification + explorer links.
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  try {
    const since30 = new Date(Date.now() - 30 * DAY)
    const [all, verified, payers, recent, txs] = await Promise.all([
      prisma.mcpReceipt.aggregate({ where: { mcpSlug: slug }, _sum: { amountUsd: true }, _count: true }),
      prisma.mcpReceipt.aggregate({ where: { mcpSlug: slug, verified: true }, _sum: { amountUsd: true }, _count: true }),
      prisma.mcpReceipt.findMany({ where: { mcpSlug: slug, payer: { not: null } }, select: { payer: true }, distinct: ['payer'] }),
      prisma.mcpReceipt.findMany({
        where: { mcpSlug: slug, createdAt: { gte: since30 } },
        select: { amountUsd: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.mcpReceipt.findMany({
        where: { mcpSlug: slug },
        take: 8,
        orderBy: [{ verified: 'desc' }, { createdAt: 'desc' }],
        select: { id: true, amountUsd: true, payer: true, tool: true, txHash: true, network: true, verified: true, createdAt: true },
      }),
    ])

    // 30-day daily usage series (UTC days), zero-filled, for the area chart.
    const calls = new Map<string, number>()
    const usd = new Map<string, number>()
    for (let i = 29; i >= 0; i--) {
      const d = new Date(Date.now() - i * DAY).toISOString().slice(0, 10)
      calls.set(d, 0)
      usd.set(d, 0)
    }
    for (const r of recent) {
      const d = r.createdAt.toISOString().slice(0, 10)
      if (calls.has(d)) {
        calls.set(d, (calls.get(d) ?? 0) + 1)
        usd.set(d, (usd.get(d) ?? 0) + r.amountUsd)
      }
    }
    const series30d = [...calls.keys()].map((date) => ({ date, calls: calls.get(date) ?? 0, usd: usd.get(date) ?? 0 }))

    const transactions = txs.map((t) => ({
      id: t.id,
      amountUsd: t.amountUsd,
      payer: t.payer,
      tool: t.tool,
      verified: t.verified,
      createdAt: t.createdAt,
      explorerUrl: t.txHash ? `${explorerFor(t.network)}/tx/${t.txHash}` : null,
    }))

    return NextResponse.json({
      kpis: {
        settledUsd: verified._sum.amountUsd ?? 0,
        totalEarnedUsd: all._sum.amountUsd ?? 0,
        callsServed: all._count,
        activeAccounts: payers.length,
        verifiedCalls: verified._count,
      },
      series30d,
      transactions,
    })
  } catch {
    // DB unavailable → an empty, well-formed payload rather than a 500.
    return NextResponse.json({
      kpis: { settledUsd: 0, totalEarnedUsd: 0, callsServed: 0, activeAccounts: 0, verifiedCalls: 0 },
      series30d: [],
      transactions: [],
    })
  }
}
