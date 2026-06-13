import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getSessionAddress } from '@/lib/auth'
import { requireRole } from '@/lib/org'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

const MAX_RANGE_DAYS = 366

/**
 * The expense report — org spend over a date range (member+), broken down
 * three ways. Attribution is key-based and honest about it: "per agent" is
 * the org's ground truth (every Bearer-synced row carries its key);
 * "per member" maps each agent to the wallet that MINTED it, and rows synced
 * without a key (SIWE members, wallet-mode) land in an `unattributed` bucket
 * rather than being guessed.
 *
 *   GET /api/orgs/[id]/report?from=2026-06-01&to=2026-06-30
 *
 * Defaults to the last 30 days. `to` is exclusive-end-of-day inclusive (the
 * whole `to` day counts).
 */
export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params
  const addr = await getSessionAddress()
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const gate = await requireRole(id, addr, 'member')
  if (!gate.ok) return NextResponse.json({ error: 'Not found.' }, { status: gate.status })

  const org = await prisma.organization.findUnique({
    where: { id },
    select: { id: true, name: true, slug: true },
  })
  if (!org) return NextResponse.json({ error: 'Not found.' }, { status: 404 })

  const q = req.nextUrl.searchParams
  const parse = (v: string | null): Date | null => {
    if (!v) return null
    const d = new Date(v)
    return isNaN(d.getTime()) ? null : d
  }
  const to = parse(q.get('to')) ?? new Date()
  const toEnd = new Date(to)
  toEnd.setUTCHours(23, 59, 59, 999)
  const from = parse(q.get('from')) ?? new Date(toEnd.getTime() - 30 * 24 * 60 * 60 * 1000)
  if (from > toEnd || toEnd.getTime() - from.getTime() > MAX_RANGE_DAYS * 24 * 60 * 60 * 1000) {
    return NextResponse.json({ error: `Range must be positive and ≤ ${MAX_RANGE_DAYS} days.` }, { status: 400 })
  }

  const where = { orgId: id, createdAt: { gte: from, lte: toEnd } }
  const [settled, denied, byService, byKey, keys] = await Promise.all([
    prisma.spendLedgerEntry.aggregate({ where: { ...where, ok: true }, _sum: { amountUsd: true }, _count: true }),
    prisma.spendLedgerEntry.count({ where: { ...where, ok: false } }),
    prisma.$queryRaw<{ service: string; spent: number; calls: bigint; denied: bigint }[]>`
      SELECT COALESCE(service_name, host) AS service,
             COALESCE(SUM(amount_usd) FILTER (WHERE ok), 0)::float AS spent,
             COUNT(*) FILTER (WHERE ok) AS calls,
             COUNT(*) FILTER (WHERE NOT ok) AS denied
      FROM spend_ledger
      WHERE org_id = ${id} AND created_at >= ${from} AND created_at <= ${toEnd}
      GROUP BY 1 ORDER BY 2 DESC`,
    prisma.spendLedgerEntry.groupBy({
      by: ['apiKeyId'],
      where,
      _sum: { amountUsd: true },
      _count: true,
    }),
    prisma.apiKey.findMany({ where: { orgId: id }, select: { id: true, label: true, prefix: true, ownerAddress: true } }),
  ])

  const keyMeta = new Map(keys.map((k) => [k.id, k]))
  const perAgent = byKey
    .map((g) => {
      const meta = g.apiKeyId ? keyMeta.get(g.apiKeyId) : undefined
      return {
        keyId: g.apiKeyId,
        label: meta?.label ?? (g.apiKeyId ? 'revoked key' : 'unattributed'),
        prefix: meta?.prefix ?? null,
        mintedBy: meta?.ownerAddress ?? null,
        spentUsd: g._sum.amountUsd ?? 0,
        calls: g._count,
      }
    })
    .sort((a, b) => b.spentUsd - a.spentUsd)

  // Per member = per key-minter; key-less rows stay "unattributed" (honest).
  const perMemberMap = new Map<string, { spentUsd: number; calls: number; agents: Set<string> }>()
  for (const a of perAgent) {
    const who = a.mintedBy ?? 'unattributed'
    const row = perMemberMap.get(who) ?? { spentUsd: 0, calls: 0, agents: new Set<string>() }
    row.spentUsd += a.spentUsd
    row.calls += a.calls
    if (a.keyId) row.agents.add(a.label)
    perMemberMap.set(who, row)
  }
  const perMember = [...perMemberMap.entries()]
    .map(([address, r]) => ({ address, spentUsd: r.spentUsd, calls: r.calls, agents: [...r.agents] }))
    .sort((a, b) => b.spentUsd - a.spentUsd)

  return NextResponse.json({
    org,
    range: { from: from.toISOString(), to: toEnd.toISOString() },
    totals: {
      spentUsd: settled._sum.amountUsd ?? 0,
      calls: settled._count,
      deniedCalls: denied,
    },
    perAgent,
    perMember,
    perService: byService.map((s) => ({
      service: s.service,
      spentUsd: s.spent,
      calls: Number(s.calls),
      denied: Number(s.denied),
    })),
  })
}
