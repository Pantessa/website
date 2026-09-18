// House answers + subscriptions — the billing engine (pricing v2).
//
// One house-model answer can be paid for four ways, tried in this order
// (lib/plans.ts has the why):
//
//   TASTE  free, per UTC day, keyed to the connection AND the wallet. Counted
//          in `unsigned_turn_windows` (day windows, `t:` keys) — never a
//          ledger balance, because a wallet is free to mint and an allowance
//          keyed to one is an allowance keyed to nothing.
//   PLAN   the Plus monthly allowance: this calendar month's 'plan' debits
//          against the plan's credits. Resets by construction.
//   BANK   answers EARNED by trading or BOUGHT in a pack: lifetime grants
//          minus lifetime 'bank' debits. Never expires.
//   BYOK   the user's own key: admitted without touching any of the above.
//
// PROOF RULE: the taste asks for no proof (it is free and bounded by the
// connection). PLAN and BANK spend something a person paid for or earned, so
// they draw ONLY for a PROVEN owner — a SIWE session or an embed key. The
// chat body's `walletAddress` is client-asserted; before v2 it could name
// whose credits to burn.
//
// FUSES: the taste lane and the paid lanes have separate daily fuses
// (lib/inference-fuse) — a flood can exhaust the free taste and nothing else.
//
// Every read/write here FAILS OPEN — a billing-store hiccup must never take
// chat down. Pure decisions are exported for the harness.

import prisma from '@/lib/db'
import { PLAN_BY_ID, TASTE, planCreditsFor, type Plan, type PlanId, isPlanId } from '@/lib/plans'
import { bumpFuse, dayStartUTC, FUSE_CAPS } from '@/lib/inference-fuse'
import { hashIp } from '@/lib/turn-limits'

/** Stripe statuses that keep a paid plan's allowance active. `past_due` gets
 * grace (Stripe retries the charge); anything else falls back to free. */
const ACTIVE_STATUSES = new Set(['active', 'trialing', 'past_due'])

export type AnswerLane = 'byok' | 'taste' | 'plan' | 'bank'

export interface PlanUsage {
  plan: PlanId
  planName: string
  priceUsd: number
  status: string
  /** Monthly PLAN allowance (0 on the free tier). */
  allowance: number
  /** PLAN answers spent this calendar month (UTC). */
  used: number
  /** Banked answers granted this month (earned + bought) — for the activity view. */
  granted: number
  /** Banked answers available now (lifetime grants − lifetime bank debits). */
  bank: number
  /** What a PROVEN owner can still draw beyond the taste: plan left + bank. */
  remaining: number
  /** The free daily taste for a wallet (the cap, not what is left — the taste
   *  is counted per connection too, so "left" is only known at the gate). */
  tasteDaily: number
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

/** Kept for callers and env that predate v2: the paid-lane fuse. */
export const HOUSE_DAILY_TURN_CAP: number = FUSE_CAPS.paid
/** The free taste lane's own fuse (all visitors combined). */
export const TASTE_HOUSE_DAILY_CAP: number = FUSE_CAPS.taste

/** Current usage rollup for the plan page + the gate. */
export async function getPlanUsage(owner: string): Promise<PlanUsage> {
  const { plan, status, row } = await getEffectivePlan(owner)
  const start = monthStartUTC()
  const end = monthEndUTC()
  let used = 0
  let granted = 0
  let bank = 0
  try {
    const who = norm(owner)
    const [planDebits, monthGrants, bankNet] = await Promise.all([
      // PLAN usage: this month's debits that are not taste and not bank. A
      // pre-v2 row has no pool and reads as plan usage for its own month.
      prisma.creditLedgerEntry.aggregate({
        where: { ownerAddress: who, createdAt: { gte: start }, delta: { lt: 0 }, OR: [{ pool: 'plan' }, { pool: null }] },
        _sum: { delta: true },
      }),
      prisma.creditLedgerEntry.aggregate({
        where: { ownerAddress: who, createdAt: { gte: start }, delta: { gt: 0 } },
        _sum: { delta: true },
      }),
      // BANK: every grant ever, minus every bank debit ever. Grants carry
      // pool 'bank'; a pre-v2 grant (none exist in prod) has no pool.
      prisma.creditLedgerEntry.aggregate({
        where: { ownerAddress: who, OR: [{ pool: 'bank' }, { pool: null, delta: { gt: 0 } }] },
        _sum: { delta: true },
      }),
    ])
    used = -(planDebits._sum.delta ?? 0)
    granted = monthGrants._sum.delta ?? 0
    bank = Math.max(0, bankNet._sum.delta ?? 0)
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
    bank,
    remaining: Math.max(0, allowance - used) + bank,
    tasteDaily: TASTE.wallet,
    periodStart: start.toISOString(),
    periodEnd: end.toISOString(),
    renewsAt: row?.currentPeriodEnd?.toISOString() ?? null,
    stripeCustomerId: row?.stripeCustomerId ?? null,
  }
}

// ── The taste (pure decision + the store) ───────────────────────────────────

export interface TasteCounts {
  /** This connection's taste count today, AFTER this turn's bump. null = no
   *  platform IP (loopback: local dev + the API harness). */
  ip: number | null
  /** This wallet's (or this guest connection's) count today, after the bump. */
  who: number
  /** Is `who` a wallet (vs a wallet-less guest)? */
  hasWallet: boolean
  /** Only consulted between the fresh and full wallet caps. */
  walletHasHistory: boolean
}

/** Does the free taste cover this turn? Post-increment counts: the turn that
 *  lands ON a cap is served. */
export function tasteCovers(c: TasteCounts): boolean {
  if (c.ip !== null && c.ip > TASTE.ip) return false
  if (!c.hasWallet) return c.who <= TASTE.guest
  return c.who <= (c.walletHasHistory ? TASTE.wallet : TASTE.freshWallet)
}

/** Day-window keys for a taste turn. `t:` is its own namespace in the limiter
 *  table; the hourly sweeps skip it (lib/turn-limits). */
export function tasteKeysFor(ipHash: string | null, wallet: string | null | undefined): string[] {
  const keys: string[] = []
  if (ipHash) keys.push(`t:i:${ipHash}`)
  if (wallet) keys.push(`t:w:${norm(wallet)}`)
  else if (ipHash) keys.push(`t:g:${ipHash}`)
  return keys
}

// A wallet "has history" when it has ever done anything on-chain — cheap for
// a person, expensive at scale for a script (every minted wallet would need a
// funded transaction). Positive answers are permanent; negatives retry.
const historyCache: Map<string, { at: number; has: boolean }> =
  ((globalThis as Record<string, unknown>).__pantessaWalletHistory as Map<string, { at: number; has: boolean }>) ??
  (((globalThis as Record<string, unknown>).__pantessaWalletHistory = new Map()) as Map<string, { at: number; has: boolean }>)

export async function walletHasHistory(wallet: string): Promise<boolean> {
  const who = norm(wallet)
  const hit = historyCache.get(who)
  if (hit && (hit.has || Date.now() - hit.at < 10 * 60_000)) return hit.has
  let has = false
  try {
    // A verified trade with us is history by definition, and costs no RPC.
    const traded = await prisma.embedTurn.findFirst({ where: { walletAddress: who, outcome: 'signed', verification: 'verified' }, select: { id: true } })
    has = !!traded
    if (!has) {
      const { publicClientFor } = await import('@/lib/chains')
      const counts = await Promise.all(
        [8453, 1].map(async (chainId) => {
          try {
            const client = publicClientFor(chainId)
            return client ? await client.getTransactionCount({ address: who as `0x${string}` }) : -1
          } catch {
            return -1
          }
        }),
      )
      // Every read failed → we cannot tell; be generous (the connection cap
      // and the taste fuse still bound it). Otherwise any nonce is history.
      has = counts.every((n) => n < 0) ? true : counts.some((n) => n > 0)
    }
  } catch {
    has = true
  }
  if (historyCache.size > 5000) historyCache.clear()
  historyCache.set(who, { at: Date.now(), has })
  return has
}

async function bumpTaste(ip: string | null, wallet: string | null | undefined): Promise<TasteCounts | null> {
  // Loopback (no platform IP) is local dev and the API harness: the taste is
  // not counted at all there, exactly like the unsigned-turn fence — a shared
  // test DB would otherwise wall the harness's own reused wallets.
  if (!ip) return null
  const ipHash = hashIp(ip)
  const keys = tasteKeysFor(ipHash, wallet)
  const rows = await prisma.$queryRaw<{ key: string; count: number }[]>`
    INSERT INTO unsigned_turn_windows (key, window_start, count)
    SELECT unnest(${keys}::text[]), ${dayStartUTC()}, 1
    ON CONFLICT (key, window_start)
    DO UPDATE SET count = unsigned_turn_windows.count + 1
    RETURNING key, count
  `
  const byKey = new Map(rows.map((r) => [r.key, Number(r.count)]))
  const whoKey = wallet ? `t:w:${norm(wallet)}` : `t:g:${ipHash}`
  const who = byKey.get(whoKey) ?? 0
  const hasWallet = !!wallet
  // The history read only matters in the band between the two wallet caps.
  const needsHistory = hasWallet && who > TASTE.freshWallet && who <= TASTE.wallet
  return {
    ip: byKey.get(`t:i:${ipHash}`) ?? 0,
    who,
    hasWallet,
    walletHasHistory: needsHistory ? await walletHasHistory(wallet as string) : false,
  }
}

// ── Admission ───────────────────────────────────────────────────────────────

export type AnswerGate =
  /** Today's free answers are used and there is nothing else to draw on. */
  | 'taste'
  /** Free answers used; banked/plan answers exist but the wallet is unproven. */
  | 'sign-in'
  /** The free lane's daily fuse is blown (a flood) and nothing else to draw on. */
  | 'taste-fuse'
  /** The paid lanes' daily fuse is blown — the last-resort breaker. */
  | 'house'
  /** An embed host's pool is empty (the visitor's taste is used too). */
  | 'host'

export interface Admission {
  ok: boolean
  lane?: AnswerLane
  gate?: AnswerGate
  plan: PlanId
  planName: string
  /** Plan left + bank, for a proven owner (0 otherwise). */
  remaining: number
  /** Banked answers waiting behind a sign-in (gate 'sign-in'). */
  waiting?: number
}

export interface AdmitInput {
  /** PROVEN owner: the SIWE session address, or an embed key's owner. */
  owner: string | null
  /** The wallet in context — client-asserted; keys the taste, never a balance. */
  wallet: string | null | undefined
  /** Platform-stamped client IP; null on loopback. */
  ip: string | null
  /** This turn rides an embed key (the host pays beyond the visitor's taste). */
  embed: boolean
  /** The request runs on the user's own key. */
  byok: boolean
  reason: string
}

/** Pure lane choice, given what each lane can offer. Exported for the harness. */
export function chooseLane(o: { byok: boolean; taste: boolean; planLeft: number; bank: number; proven: boolean }): AnswerLane | null {
  if (o.byok) return 'byok'
  if (o.taste) return 'taste'
  if (o.proven && o.planLeft > 0) return 'plan'
  if (o.proven && o.bank > 0) return 'bank'
  return null
}

/**
 * May this turn spend one house answer — and from which lane? Debits the
 * lane it chooses. Refuses only when the stores are readable AND every lane
 * is genuinely empty; any store error admits (fail open).
 */
export async function admitHouseTurn(input: AdmitInput): Promise<Admission> {
  const free: Admission = { ok: true, lane: 'taste', plan: 'free', planName: PLAN_BY_ID.free.name, remaining: 0 }
  if (input.byok) return { ...free, lane: 'byok' }
  try {
    const tasteWallet = input.wallet ?? input.owner
    const counts = await bumpTaste(input.ip, tasteWallet)
    let taste = counts === null ? true : tasteCovers(counts)
    let tasteFuseBlown = false
    if (taste && counts !== null && (await bumpFuse('taste'))) {
      taste = false
      tasteFuseBlown = true
    }

    const usage = input.owner ? await getPlanUsage(input.owner) : null
    const planLeft = usage ? Math.max(0, usage.allowance - usage.used) : 0
    const bank = usage?.bank ?? 0
    const base = { plan: usage?.plan ?? 'free', planName: usage?.planName ?? PLAN_BY_ID.free.name, remaining: planLeft + bank } satisfies Partial<Admission>

    const lane = chooseLane({ byok: false, taste, planLeft, bank, proven: !!input.owner })
    if (lane === 'taste') {
      // Informational row so the owner's activity list shows the answer; the
      // taste itself is counted in the day windows, never against a balance.
      if (tasteWallet) void prisma.creditLedgerEntry.create({ data: { ownerAddress: norm(tasteWallet), delta: 0, reason: input.reason, pool: 'taste' } }).catch(() => {})
      return { ok: true, lane, ...base }
    }
    if (lane === 'plan' || lane === 'bank') {
      if (await bumpFuse('paid')) return { ok: false, gate: 'house', ...base }
      await prisma.creditLedgerEntry.create({ data: { ownerAddress: norm(input.owner as string), delta: -1, reason: input.reason, pool: lane } })
      return { ok: true, lane, ...base, remaining: Math.max(0, base.remaining - 1) }
    }

    // Nothing covers it. Say which door is actually closed.
    if (input.embed) return { ok: false, gate: 'host', ...base }
    if (!input.owner && input.wallet) {
      // Unproven wallet: does it have answers waiting behind a signature?
      const waiting = await getPlanUsage(input.wallet).then((u) => Math.max(0, u.allowance - u.used) + u.bank).catch(() => 0)
      if (waiting > 0) return { ok: false, gate: 'sign-in', waiting, ...base }
    }
    return { ok: false, gate: tasteFuseBlown ? 'taste-fuse' : 'taste', ...base }
  } catch {
    return free
  }
}

/** Grant banked answers exactly once per `grantKey` (the unique index is the
 *  idempotency). Returns the number granted; 0 on a replay. A store error is
 *  swallowed (0) unless `strict` — the Stripe webhook passes strict so a paid
 *  pack that could not be written 500s and Stripe redelivers it. */
export async function grantAnswers(owner: string, answers: number, reason: string, grantKey: string, opts: { strict?: boolean } = {}): Promise<number> {
  if (!Number.isInteger(answers) || answers <= 0) return 0
  try {
    await prisma.creditLedgerEntry.create({ data: { ownerAddress: norm(owner), delta: answers, reason, pool: 'bank', grantKey } })
    return answers
  } catch (err) {
    const replay = (err as { code?: string })?.code === 'P2002' // unique violation = already granted
    if (!replay && opts.strict) throw err
    return 0
  }
}

/** Recent ledger entries for the plan page's activity list. */
export async function recentCreditEntries(owner: string, take = 12) {
  try {
    return await prisma.creditLedgerEntry.findMany({
      where: { ownerAddress: norm(owner) },
      orderBy: { createdAt: 'desc' },
      take,
      select: { id: true, delta: true, reason: true, pool: true, createdAt: true },
    })
  } catch {
    return []
  }
}
