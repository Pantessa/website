// YEET credits + subscriptions — the billing engine. Credits are ledgered
// off-chain (credit_ledger) and meter HOUSE-model answers only; x402 calls
// stay pay-per-call from the user's wallet. Allowance comes from the plan
// (lib/plans.ts) and resets each calendar month (UTC) by construction: usage
// is the sum of the current month's debits, never a stored counter.
//
// Every read/write here FAILS OPEN — a billing-store hiccup must never take
// chat down. The chat route treats { ok: true } as "carry on".

import prisma from '@/lib/db'
import { PLAN_BY_ID, type Plan, type PlanId, isPlanId } from '@/lib/plans'

/** Stripe statuses that keep a paid plan's allowance active. `past_due` gets
 * grace (Stripe retries the charge); anything else falls back to free. */
const ACTIVE_STATUSES = new Set(['active', 'trialing', 'past_due'])

export interface PlanUsage {
  plan: PlanId
  planName: string
  priceUsd: number
  status: string
  /** Monthly credit allowance from the plan. */
  allowance: number
  /** Credits spent this calendar month (UTC). */
  used: number
  /** Extra credits granted this month (top-ups, promos). */
  granted: number
  /** max(0, allowance + granted - used) */
  remaining: number
  periodStart: string
  periodEnd: string
  /** Paid plans: when Stripe renews, if known. */
  renewsAt: string | null
  stripeCustomerId: string | null
}

export function monthStartUTC(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
}
export function monthEndUTC(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
}

const norm = (addr: string) => addr.toLowerCase()

/** The wallet's effective plan — subscription row when its status is live,
 * else the free tier. */
export async function getEffectivePlan(
  owner: string,
): Promise<{ plan: Plan; status: string; row: { stripeCustomerId: string | null; currentPeriodEnd: Date | null } | null }> {
  try {
    const row = await prisma.subscription.findUnique({ where: { ownerAddress: norm(owner) } })
    if (row && isPlanId(row.plan) && row.plan !== 'free' && ACTIVE_STATUSES.has(row.status)) {
      return { plan: PLAN_BY_ID[row.plan], status: row.status, row }
    }
    return { plan: PLAN_BY_ID.free, status: 'active', row }
  } catch {
    return { plan: PLAN_BY_ID.free, status: 'active', row: null }
  }
}

/** Current-month usage rollup for the plan page + the chat gate. */
export async function getPlanUsage(owner: string): Promise<PlanUsage> {
  const { plan, status, row } = await getEffectivePlan(owner)
  const start = monthStartUTC()
  const end = monthEndUTC()
  let used = 0
  let granted = 0
  try {
    const entries = await prisma.creditLedgerEntry.groupBy({
      by: ['ownerAddress'],
      where: { ownerAddress: norm(owner), createdAt: { gte: start } },
      _sum: { delta: true },
    })
    const net = entries[0]?._sum.delta ?? 0
    // one more pass for the split (debits vs grants) — cheap on an indexed month slice
    const debits = await prisma.creditLedgerEntry.aggregate({
      where: { ownerAddress: norm(owner), createdAt: { gte: start }, delta: { lt: 0 } },
      _sum: { delta: true },
    })
    used = -(debits._sum.delta ?? 0)
    granted = net + used
  } catch {
    // fail open: an unreadable ledger reports zero usage rather than erroring
  }
  return {
    plan: plan.id,
    planName: plan.name,
    priceUsd: plan.priceUsd,
    status,
    allowance: plan.credits,
    used,
    granted,
    remaining: Math.max(0, plan.credits + granted - used),
    periodStart: start.toISOString(),
    periodEnd: end.toISOString(),
    renewsAt: row?.currentPeriodEnd?.toISOString() ?? null,
    stripeCustomerId: row?.stripeCustomerId ?? null,
  }
}

export interface SpendResult {
  ok: boolean
  plan: PlanId
  planName: string
  allowance: number
  remaining: number
}

/** Debit `n` credits for one house-model answer. Refuses (ok:false) only when
 * the ledger is readable AND the wallet is genuinely out of credits; any
 * store error fails open so chat keeps working. Concurrency note: two racing
 * turns can both pass the check — an off-by-one on a soft meter, fine. */
export async function spendCredits(owner: string, reason: string, n = 1): Promise<SpendResult> {
  try {
    const usage = await getPlanUsage(owner)
    if (usage.remaining < n) {
      return { ok: false, plan: usage.plan, planName: usage.planName, allowance: usage.allowance, remaining: usage.remaining }
    }
    await prisma.creditLedgerEntry.create({
      data: { ownerAddress: norm(owner), delta: -n, reason },
    })
    return { ok: true, plan: usage.plan, planName: usage.planName, allowance: usage.allowance, remaining: usage.remaining - n }
  } catch {
    return { ok: true, plan: 'free', planName: PLAN_BY_ID.free.name, allowance: PLAN_BY_ID.free.credits, remaining: PLAN_BY_ID.free.credits }
  }
}

/** Recent ledger entries for the plan page's activity list. */
export async function recentCreditEntries(owner: string, take = 12) {
  try {
    return await prisma.creditLedgerEntry.findMany({
      where: { ownerAddress: norm(owner) },
      orderBy: { createdAt: 'desc' },
      take,
      select: { id: true, delta: true, reason: true, createdAt: true },
    })
  } catch {
    return []
  }
}
