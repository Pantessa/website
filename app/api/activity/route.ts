import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getLaunchpadSummary } from '@/lib/launchpad-summary'

export const runtime = 'nodejs'
// Never build-time-prerendered (the handler reads no request, so Next would
// otherwise freeze a static snapshot); CDN caching is the header's job.
export const dynamic = 'force-dynamic'

/**
 * Public network activity — the spend ledger as proof-of-life, aggregated
 * across ALL accounts. Unauthenticated read-only; no query params.
 *
 * Privacy rules (Run 7 constitution):
 *  P1 — no full wallet addresses (truncated server-side), no grant ids, no
 *       key material, no chat content in the payload.
 *  P2 — denials are aggregate-only (`blockedCalls`); denial rows never
 *       appear in the public feed (who got refused for what is private).
 */
export async function GET() {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const utcMidnight = new Date()
  utcMidnight.setUTCHours(0, 0, 0, 0)

  const [totals, blocked, today, activeAccounts, daily, top, recent, launchpad] = await Promise.all([
    prisma.spendLedgerEntry.aggregate({
      where: { ok: true },
      _sum: { amountUsd: true },
      _count: true,
    }),
    prisma.spendLedgerEntry.count({ where: { ok: false } }),
    prisma.spendLedgerEntry.count({ where: { ok: true, createdAt: { gte: utcMidnight } } }),
    // Distinct wallets that have ever produced a receipt (settled or denied).
    prisma.$queryRaw<[{ accounts: bigint }]>`
      SELECT COUNT(DISTINCT g.owner_address) AS accounts
      FROM spend_ledger l JOIN spend_grants g ON g.id = l.grant_id`,
    prisma.$queryRaw<{ day: Date; spent: number; calls: bigint }[]>`
      SELECT date_trunc('day', created_at) AS day,
             COALESCE(SUM(amount_usd) FILTER (WHERE ok), 0)::float AS spent,
             COUNT(*) FILTER (WHERE ok) AS calls
      FROM spend_ledger
      WHERE created_at >= ${since}
      GROUP BY 1 ORDER BY 1`,
    prisma.$queryRaw<{ service: string; spent: number; calls: bigint }[]>`
      SELECT COALESCE(service_name, host) AS service,
             COALESCE(SUM(amount_usd) FILTER (WHERE ok), 0)::float AS spent,
             COUNT(*) FILTER (WHERE ok) AS calls
      FROM spend_ledger
      GROUP BY 1 HAVING COUNT(*) FILTER (WHERE ok) > 0
      ORDER BY 2 DESC LIMIT 10`,
    // P2: settled rows ONLY in the public feed.
    prisma.spendLedgerEntry.findMany({
      where: { ok: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        host: true,
        serviceName: true,
        amountUsd: true,
        txHash: true,
        createdAt: true,
        grant: { select: { ownerAddress: true } },
      },
    }),
    // Launchpad: USDC directed to stakers + per-token staked (null on any failure).
    getLaunchpadSummary(),
  ])

  const payload = {
    stats: {
      settledUsd: totals._sum.amountUsd ?? 0,
      settledCalls: totals._count,
      callsToday: today,
      blockedCalls: blocked,
      activeAccounts: Number(activeAccounts[0]?.accounts ?? 0),
    },
    daily: daily.map((d) => ({ day: d.day, spent: d.spent, calls: Number(d.calls) })),
    top: top.map((t) => ({ service: t.service, spent: t.spent, calls: Number(t.calls) })),
    recent: recent.map((r) => ({
      id: r.id,
      service: r.serviceName ?? r.host,
      host: r.host,
      amountUsd: r.amountUsd,
      txHash: r.txHash,
      // P1: truncate server-side — the full address never leaves the API.
      account: shortAddress(r.grant.ownerAddress),
      createdAt: r.createdAt,
    })),
    launchpad,
  }

  return NextResponse.json(payload, {
    headers: {
      'cache-control': 'public, s-maxage=30, stale-while-revalidate=120',
    },
  })
}

function shortAddress(addr: string): string {
  return addr.length > 10 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr
}
