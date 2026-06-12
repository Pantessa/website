// DB helpers for spend grants + their ledger. The policy logic lives in
// lib/spend-grant.ts (pure); this module owns the I/O.

import prisma from '@/lib/db'
import type { GrantPolicy } from '@/lib/spend-grant'

/** UTC midnight — the per-day budget window boundary. */
function utcMidnight(): Date {
  const d = new Date()
  d.setUTCHours(0, 0, 0, 0)
  return d
}

/**
 * The owner's current spendable grant: active, unexpired, most-recently created.
 * Returns null if they have no usable grant (callers fall back to unenforced).
 */
export async function getActiveGrant(ownerAddress: string) {
  return prisma.spendGrant.findFirst({
    where: { ownerAddress, status: 'active', expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  })
}

/** USD successfully spent under a grant since UTC midnight. */
export async function spentTodayUsd(grantId: string): Promise<number> {
  const agg = await prisma.spendLedgerEntry.aggregate({
    where: { grantId, ok: true, createdAt: { gte: utcMidnight() } },
    _sum: { amountUsd: true },
  })
  return agg._sum.amountUsd ?? 0
}

/** USD successfully spent under a grant over its whole life (for the total cap). */
export async function spentTotalUsd(grantId: string): Promise<number> {
  const agg = await prisma.spendLedgerEntry.aggregate({
    where: { grantId, ok: true },
    _sum: { amountUsd: true },
  })
  return agg._sum.amountUsd ?? 0
}

/** Append one authorization decision to the ledger (audit trail + receipt). */
export async function recordLedger(entry: {
  grantId: string
  host: string
  serviceName?: string
  amountUsd: number
  ok: boolean
  txHash?: string
  note?: string
}) {
  return prisma.spendLedgerEntry.create({ data: entry })
}

/** Narrow a SpendGrant row to the fields the policy checks need. */
export function toPolicy(grant: {
  id: string
  allow: string[]
  perCallUsd: number
  perDayUsd: number
  totalUsd: number | null
  expiresAt: Date
  status: string
}): GrantPolicy {
  return {
    id: grant.id,
    allow: grant.allow,
    perCallUsd: grant.perCallUsd,
    perDayUsd: grant.perDayUsd,
    totalUsd: grant.totalUsd,
    expiresAt: grant.expiresAt,
    status: grant.status,
  }
}

/** Settled spend per service for the UTC day — feeds the per-agent caps. */
export async function agentSpentTodayByService(grantId: string): Promise<Record<string, number>> {
  const midnight = new Date()
  midnight.setUTCHours(0, 0, 0, 0)
  const rows = await prisma.spendLedgerEntry.groupBy({
    by: ['serviceName'],
    where: { grantId, ok: true, createdAt: { gte: midnight } },
    _sum: { amountUsd: true },
  })
  const out: Record<string, number> = {}
  for (const r of rows) if (r.serviceName) out[r.serviceName] = r._sum.amountUsd ?? 0
  return out
}

/** Per-agent caps keyed by SERVER NAME (the key the chat path + ledger use). */
export async function agentCapsByName(
  ownerAddress: string,
): Promise<Record<string, { perCallUsd: number | null; perDayUsd: number | null }>> {
  const rows = await prisma.agentApproval.findMany({
    where: {
      ownerAddress: ownerAddress.toLowerCase(),
      OR: [{ perCallUsd: { not: null } }, { perDayUsd: { not: null } }],
    },
    select: { perCallUsd: true, perDayUsd: true, server: { select: { name: true } } },
  })
  const out: Record<string, { perCallUsd: number | null; perDayUsd: number | null }> = {}
  for (const r of rows) out[r.server.name] = { perCallUsd: r.perCallUsd, perDayUsd: r.perDayUsd }
  return out
}
