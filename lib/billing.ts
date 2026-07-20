// YEET credits + subscriptions — the billing engine. Credits are ledgered
// off-chain (credit_ledger) and meter HOUSE-model answers only; x402 calls
// stay pay-per-call from the user's wallet. Allowance comes from the plan
// (lib/plans.ts) and resets each calendar month (UTC) by construction: usage
// is the sum of the current month's debits, never a stored counter.
//
// Every read/write here FAILS OPEN — a billing-store hiccup must never take
// chat down. The chat route treats { ok: true } as "carry on".

import prisma from '@/lib/db'
import { PLAN_BY_ID, planCreditsFor, type Plan, type PlanId, isPlanId } from '@/lib/plans'

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
): Promise<{ plan: Plan; status: string; row: { stripeCustomerId: string | null; currentPeriodEnd: Date | null; createdAt: Date } | null }> {
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

// ── Inference circuit breakers (the "leave it open" guarantee) ─────────────
// Pricing bounds EXPECTED house-inference cost; these bound the WORST case.
// Both are turn-count caps (a turn is the unit spendCredits debits), env-
// overridable, clamped to sane ranges so a typo can't zero-out chat.

/** Free-tier wallets: max house-answered turns per UTC day. Default 40 —
 * a heavy real session, nowhere near a runaway script. */
export const FREE_DAILY_TURN_CAP: number = (() => {
  const raw = Number(process.env.FREE_DAILY_TURN_CAP ?? '40')
  return Number.isInteger(raw) && raw >= 5 && raw <= 1000 ? raw : 40
})()

/** ALL wallets combined: max house-answered turns per UTC day. Default
 * 2000 (~$60/day at ~$0.03/turn) — the hard ceiling on the Anthropic bill
 * no matter what any user or bug does. */
export const HOUSE_DAILY_TURN_CAP: number = (() => {
  const raw = Number(process.env.HOUSE_DAILY_TURN_CAP ?? '2000')
  return Number.isInteger(raw) && raw >= 100 && raw <= 1_000_000 ? raw : 2000
})()

const dayStartUTC = () => {
  const d = new Date()
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
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
  const allowance = planCreditsFor(plan, row?.createdAt ?? null)
  return {
    plan: plan.id,
    planName: plan.name,
    priceUsd: plan.priceUsd,
    status,
    allowance,
    used,
    granted,
    remaining: Math.max(0, allowance + granted - used),
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
  /** Which gate refused (absent when ok): the monthly allowance, the
   * free-tier daily cap, or the system-wide daily breaker. */
  gate?: 'monthly' | 'daily' | 'house'
}

/** Debit `n` credits for one house-model answer. Refuses (ok:false) only when
 * the ledger is readable AND a gate genuinely trips: the monthly allowance,
 * the free-tier per-day cap, or the system-wide daily breaker
 * (FREE_DAILY_TURN_CAP / HOUSE_DAILY_TURN_CAP — the bound on the worst-case
 * Anthropic bill). Any store error fails open so chat keeps working.
 * Concurrency note: racing turns can both pass a check — an off-by-one on a
 * soft meter, fine. */
export async function spendCredits(owner: string, reason: string, n = 1): Promise<SpendResult> {
  try {
    const usage = await getPlanUsage(owner)
    const refuse = (gate: 'monthly' | 'daily' | 'house'): SpendResult => ({
      ok: false, plan: usage.plan, planName: usage.planName, allowance: usage.allowance, remaining: usage.remaining, gate,
    })
    if (usage.remaining < n) return refuse('monthly')

    const today = dayStartUTC()
    // System-wide breaker first: one aggregate over today's debits.
    const houseToday = await prisma.creditLedgerEntry.aggregate({
      where: { createdAt: { gte: today }, delta: { lt: 0 } },
      _sum: { delta: true },
    })
    if (-(houseToday._sum.delta ?? 0) >= HOUSE_DAILY_TURN_CAP) return refuse('house')

    if (usage.plan === 'free') {
      const mineToday = await prisma.creditLedgerEntry.aggregate({
        where: { ownerAddress: norm(owner), createdAt: { gte: today }, delta: { lt: 0 } },
        _sum: { delta: true },
      })
      if (-(mineToday._sum.delta ?? 0) + n > FREE_DAILY_TURN_CAP) return refuse('daily')
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
