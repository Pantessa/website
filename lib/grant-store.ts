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

/** Append one authorization decision to the ledger (audit trail + receipt).
 *  orgId = the grant's org (denormalized so org rollups never join) — pass
 *  `grant.orgId ?? undefined` wherever the grant row is in hand. */
export async function recordLedger(entry: {
  grantId: string
  host: string
  serviceName?: string
  amountUsd: number
  ok: boolean
  txHash?: string
  note?: string
  apiKeyId?: string
  orgId?: string
}) {
  return prisma.spendLedgerEntry.create({ data: entry })
}

/** USD an org settled since UTC midnight, across ALL its keys and grants —
 *  the org level of the two-level budget. */
export async function orgSpentTodayUsd(orgId: string): Promise<number> {
  const agg = await prisma.spendLedgerEntry.aggregate({
    where: { orgId, ok: true, createdAt: { gte: utcMidnight() } },
    _sum: { amountUsd: true },
  })
  return agg._sum.amountUsd ?? 0
}

/** USD a connected agent (API key) settled since UTC midnight. */
export async function agentSpentTodayUsd(apiKeyId: string): Promise<number> {
  const agg = await prisma.spendLedgerEntry.aggregate({
    where: { apiKeyId, ok: true, createdAt: { gte: utcMidnight() } },
    _sum: { amountUsd: true },
  })
  return agg._sum.amountUsd ?? 0
}

/** Settled USD since UTC midnight for many agents at once (the Agents tab). */
export async function agentSpentTodayByKey(apiKeyIds: string[]): Promise<Record<string, number>> {
  if (apiKeyIds.length === 0) return {}
  const rows = await prisma.spendLedgerEntry.groupBy({
    by: ['apiKeyId'],
    where: { apiKeyId: { in: apiKeyIds }, ok: true, createdAt: { gte: utcMidnight() } },
    _sum: { amountUsd: true },
  })
  const out: Record<string, number> = {}
  for (const r of rows) if (r.apiKeyId) out[r.apiKeyId] = r._sum.amountUsd ?? 0
  return out
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
