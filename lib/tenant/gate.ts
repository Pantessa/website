// lib/tenant/gate.ts — the tenant gate: evaluate + record (TENANT lane).
//
// Every place a tenant order can move toward money calls in here:
//   broker_open / broker_choose  → stage 'open'     (the plan's orders)
//   broker_handoff / execute     → stage 'handoff' / 'execute' (re-gated with
//                                  the ACTIVE policy, approvals counted)
//   broker_next / broker_done    → stage 'leg'      (the built leg, before it
//                                  is served)
//   /api/hl/submit, /api/cow/submit, /api/tx/refresh → stage 'relay' (the leg
//                                  a JOB with tenantId owns, joined from the
//                                  server's own record — never a body claim)
// and every verdict becomes a `policy_verdict` blotter row (lib/tenant/blotter,
// BLOTTER's lane — the call shape is the contract). A tenant signer BLOCKS:
// nothing in here ever returns "allowed with a warning".

import prisma from '@/lib/db'
import { Prisma } from '@prisma/client'
import { guardianIsTestnet } from '@/lib/hl-guardian-store'
import { recordBlotter, spentTodayUsd } from '@/lib/tenant/blotter'
import { evaluateTenantPolicy, chainName, RISK_REDUCING_OPS } from '@/lib/tenant/policy'
import { orderOfLeg, ordersOfPlan, type GateOrder } from '@/lib/tenant/order'
import { approvalCount, tenantContextForJob, type ResolvedTenant } from '@/lib/tenant/store'
import type { BlotterKind, BlotterVerification, TenantContext, TenantRefusal, TenantVerdict, TenantVenue } from '@/lib/tenant/spec'

export type GateStage = 'open' | 'choose' | 'handoff' | 'execute' | 'offer' | 'leg' | 'relay'

export interface GateIds {
  stage: GateStage
  intentId?: string | null
  jobId?: string | null
  /** Free-form note for the blotter row (the relay's name, the leg seq). */
  note?: string
  /** Skip the blotter write (a pure re-read the caller records itself). */
  silent?: boolean
}

/** The network a Hyperliquid order lands on when its leg does not say — the
 *  server's own HL network (the guardian layer's switch). Under the sandbox
 *  an HL order is refused unless this is testnet. */
export function serverHlNetwork(): 'mainnet' | 'testnet' {
  return guardianIsTestnet() ? 'testnet' : 'mainnet'
}

type Ctx = TenantContext & Partial<Pick<ResolvedTenant, 'pausedBy' | 'keyRevoked' | 'tenantName'>>

/** Every refusal the desk answers is a spec TenantRefusal (the door reasons
 *  joined the spec 2026-11-03). Kept as an alias for readers of this file. */
export type DeskRefusal = TenantRefusal

/** Judge ONE order: candidates (a swap the cascade has not built yet) are
 *  tried in the builder's own order and the first the policy admits governs;
 *  an off-chain leg's network meets the sandbox rule; the desk's own spend
 *  today rides in from the blotter. Records `policy_verdict` unless silent. */
export async function tenantGate(ctx: Ctx, order: GateOrder, ids: GateIds): Promise<TenantVerdict> {
  // BLOTTER's spentTodayUsd THROWS when the blotter cannot be read, so a day
  // cap never silently reads $0 — an unreadable spend refuses (OVER_DAY) any
  // order a day cap governs, instead of judging it against a guess.
  // An offered-but-unsettled leg RESERVES its dollars (QA F6): N intents
  // executed in parallel, or an agent that broadcasts without reporting, are
  // judged against what is signed AND what is already out for signature. The
  // order's own intent / job is excluded (a re-judge of the same leg).
  let spent = 0
  let spendUnreadable = false
  try {
    const [signed, open] = await Promise.all([
      spentTodayUsd(ctx.tenantId, order.deskId),
      openOffersUsd(ctx.tenantId, order.deskId, { intentId: ids.intentId ?? null, jobId: ids.jobId ?? null }),
    ])
    spent = signed + open
  } catch {
    spendUnreadable = true
  }
  const verdict = judge(ctx, { ...order, spentTodayUsd: spent }, { spendUnreadable })
  if (!ids.silent) await recordVerdict(ctx, order, verdict, ids)
  return verdict
}

/** Refusals that come AFTER OVER_DAY in the engine's check order: an
 *  unreadable day spend outranks them (it would have been checked first). */
const AFTER_OVER_DAY = new Set(['OVER_LEVERAGE', 'OVER_IMPACT'])

/** The pure half of tenantGate — exported for the pins. `spendUnreadable` =
 *  the blotter did not answer for today's spend. */
export function judge(ctx: Ctx, order: GateOrder, opts: { spendUnreadable?: boolean } = {}): TenantVerdict {
  const v = judgeShape(ctx, order)
  if (opts.spendUnreadable && !RISK_REDUCING_OPS.has(order.op) && (v.allowed || AFTER_OVER_DAY.has(v.reason))) {
    const desk = ctx.policy?.desks.find((d) => d.id === order.deskId)
    if (desk?.perDayUsd != null) {
      return {
        allowed: false,
        reason: 'OVER_DAY',
        detail: `desk "${desk.id}"'s day cap is unreadable right now — the blotter did not answer for today's signed total, and a tenant order is never judged against a guessed $0. Try again in a moment.`,
      }
    }
  }
  return v
}

function judgeShape(ctx: Ctx, order: GateOrder): TenantVerdict {
  const pause = { status: ctx.status, sandbox: ctx.sandbox, pausedBy: ctx.pausedBy ?? null }
  if (ctx.keyRevoked) return { allowed: false, reason: 'KEY_PAUSED', detail: 'the desk key that opened this job was revoked — no leg it opened moves again. Open a new intent with a live key.' }
  const candidates = order.candidates?.length ? order.candidates : [order.venue]
  let first: TenantVerdict | null = null
  let specific: TenantVerdict | null = null
  for (const venue of candidates) {
    const v = evaluateTenantPolicy(ctx.policy, pause, { ...order, venue })
    if (v.allowed) {
      // QA F4: an HL order whose network is unknown (every plan-stage order)
      // lands on the server's own HL network — mainnet unless the layer runs
      // testnet — so the sandbox refuses it at open, handoff, execute and next.
      if (ctx.sandbox && venue === 'hyperliquid' && (order.network ?? serverHlNetwork()) === 'mainnet') {
        return { allowed: false, reason: 'SANDBOX_ONLY', detail: 'this tenant is in the sandbox — Hyperliquid here is MAINNET. Testnet legs trade in the sandbox; mainnet opens with a plan that includes it.' }
      }
      return v
    }
    first ??= v
    if (v.reason !== 'VENUE_DENIED') specific ??= v
  }
  if (specific) return specific
  if (first && !first.allowed && candidates.length > 1) {
    const admitted = [...new Set((ctx.policy?.venues ?? []).map((r) => r.venue))]
    return {
      allowed: false,
      reason: 'VENUE_DENIED',
      detail: `this ${order.op} builds through ${candidates.join(' / ')} on ${chainName(order.chainId)}, and the policy admits none of them — admitted: ${admitted.join(', ') || 'none'}. The policy is default-deny.`,
    }
  }
  return first ?? { allowed: false, reason: 'NO_POLICY', detail: 'nothing to judge.' }
}

export interface PlanVerdict {
  allowed: boolean
  needsApproval: boolean
  approvers: number
  /** The first refusal, when one step refused. */
  reason?: TenantRefusal
  detail?: string
  orders: number
  /** The venue each judged order landed on (the admitted candidate). */
  venues: TenantVenue[]
  /** The largest priced order — the intent's notional for the approval rule. */
  usd: number | null
}

/** Judge every order of a plan or a compiled job: the first refusal refuses
 *  the whole intent; approvals are the strictest any step needs. */
export async function gateOrders(ctx: Ctx, orders: GateOrder[], ids: GateIds): Promise<PlanVerdict> {
  const venues: TenantVenue[] = []
  let needsApproval = false
  let approvers = 0
  let usd: number | null = null
  for (const o of orders) {
    const v = await tenantGate(ctx, o, ids)
    if (!v.allowed) return { allowed: false, needsApproval: false, approvers: 0, reason: v.reason, detail: v.detail, orders: orders.length, venues, usd: o.usd ?? null }
    venues.push(v.rule.venue)
    if (typeof o.usd === 'number') usd = Math.max(usd ?? 0, o.usd)
    if (v.needsApproval) {
      needsApproval = true
      approvers = Math.max(approvers, v.approvers)
    }
  }
  return { allowed: true, needsApproval, approvers, orders: orders.length, venues, usd }
}

async function recordVerdict(ctx: Ctx, order: GateOrder, v: TenantVerdict, ids: GateIds): Promise<void> {
  await recordBlotter({
    tenantId: ctx.tenantId,
    kind: 'policy_verdict',
    intentId: ids.intentId ?? null,
    jobId: ids.jobId ?? null,
    deskId: order.deskId,
    keyId: ctx.keyId,
    venue: v.allowed ? v.rule.venue : order.venue,
    chainId: order.chainId,
    valueUsd: order.usd,
    payload: {
      stage: ids.stage,
      allowed: v.allowed,
      ...(v.allowed ? { needsApproval: v.needsApproval, ...(v.needsApproval ? { approvers: v.approvers } : {}) } : { reason: v.reason, detail: v.detail }),
      policyVersion: ctx.policyVersion,
      op: order.op,
      tokens: order.tokens,
      side: order.side,
      leverage: order.leverage ?? null,
      ...(order.candidates && order.candidates.length > 1 ? { candidates: order.candidates } : {}),
      ...(order.network ? { network: order.network } : {}),
      ...(order.label ? { label: order.label } : {}),
      ...(ids.note ? { note: ids.note } : {}),
    },
  }).catch(() => {})
}

/** A blotter row at one of TENANT's own sites (intent, offered, refused,
 *  approval, policy_*, key_*). Never throws (recordBlotter's contract). */
export async function blot(
  ctx: Pick<TenantContext, 'tenantId'> & Partial<Pick<TenantContext, 'deskId' | 'keyId'>>,
  kind: BlotterKind,
  payload: Record<string, unknown>,
  extra: {
    intentId?: string | null
    jobId?: string | null
    venue?: string | null
    chainId?: number | null
    valueUsd?: number | null
    feeUsd?: number | null
    feeBps?: number | null
    txHash?: string | null
    verification?: BlotterVerification | null
  } = {},
): Promise<void> {
  await recordBlotter({ tenantId: ctx.tenantId, kind, deskId: ctx.deskId ?? null, keyId: ctx.keyId ?? null, ...extra, payload }).catch(() => {})
}

/** The desk's own words for a refusal. */
export function refusalSay(ctx: Pick<TenantContext, 'tenantSlug' | 'policyVersion' | 'deskId'>, reason: TenantRefusal, detail: string): string {
  const v = ctx.policyVersion != null ? ` v${ctx.policyVersion}` : ''
  return `Refused by the ${ctx.tenantSlug} desk policy${v} (desk ${ctx.deskId}) — ${reason}: ${detail}`
}

/** A structured refusal the MCP route answers as isError with a JSON body
 *  (`gate: 'policy'`), so an agent reads the reason instead of parsing prose. */
export class TenantRefusedError extends Error {
  constructor(public payload: { gate: 'policy'; reason: TenantRefusal; detail: string; say: string; intentId?: string; state?: string; [k: string]: unknown }) {
    super(payload.say)
    this.name = 'TenantRefusedError'
  }
}

/* ── the runner's OFFER site (lib/jobs-runner advanceJob) ───────────────
 *
 * The one place a tenant job's leg becomes servable — to broker_next AND to
 * the Jobs REST channel (`GET /api/jobs/:id?t=`), which never passes through
 * the desk. So the leg is judged HERE, on what was just built, with the
 * tenant's policy active NOW (a policy activated after execute governs every
 * leg not yet offered). A refusal fails the step, cancels the job, lands the
 * intent `refused` and writes the `refused` row; the leg is never stored as
 * offered. Errors propagate: the runner's catch fails the step (closed). */
export async function gateTenantOffer(
  job: { id: string; tenantId: string | null; deskKeyId: string | null },
  step: { id: string; seq: number; builder: string; params: unknown; kind: string },
  built: { artifact: Record<string, unknown>; valueUsd: number | null | undefined },
): Promise<{ reason: TenantRefusal; say: string } | null> {
  const ctx = await tenantContextForJob(job)
  if (!ctx) return null
  const intent = await prisma.brokerIntent.findFirst({ where: { jobId: job.id }, select: { id: true } })
  const order = orderOfLeg({ builder: step.builder, params: step.params, kind: step.kind, artifact: built.artifact, valueUsd: built.valueUsd ?? null }, ctx.deskId)
  let reason: TenantRefusal | null = null
  let detail = ''
  if (!order) {
    reason = 'VENUE_DENIED'
    detail = `the desk cannot name the venue of leg ${step.seq + 1} (${step.builder}), and a tenant leg it cannot judge is never offered.`
  } else {
    const v = await tenantGate(ctx, order, { stage: 'offer', intentId: intent?.id ?? null, jobId: job.id, note: `offer leg ${step.seq}` })
    if (!v.allowed) {
      reason = v.reason
      detail = v.detail
    } else if (v.needsApproval) {
      const have = intent ? await approvalCount(intent.id) : 0
      if (have < v.approvers) {
        reason = 'APPROVAL_PENDING'
        detail = `the built leg (~$${order.usd ?? '?'}) is over the desk's approval threshold and carries ${have} of ${v.approvers} admin approvals.`
      }
    }
  }
  if (!reason) return null
  const say = refusalSay(ctx, reason, `${detail} Leg ${step.seq + 1} was not offered and the job is canceled.`)
  // An explicit JSON null, never `undefined` (Prisma's "leave as is"): a
  // refused leg must not stay servable from the row (QA F3).
  await prisma.jobStep.update({ where: { id: step.id }, data: { status: 'failed', artifact: Prisma.DbNull, result: { error: say, policyRefused: reason } as object } })
  await prisma.jobStep.updateMany({ where: { jobId: job.id, status: { in: ['offered', 'pending'] } }, data: { artifact: Prisma.DbNull } })
  await prisma.job.update({ where: { id: job.id }, data: { status: 'canceled', failReason: say.slice(0, 500) } })
  if (intent) await prisma.brokerIntent.update({ where: { id: intent.id }, data: { state: 'refused' } }).catch(() => {})
  await blot(ctx, 'refused', { stage: 'offer', seq: step.seq, builder: step.builder, reason, detail }, { intentId: intent?.id ?? null, jobId: job.id, venue: order?.venue ?? null, chainId: order?.chainId ?? null, valueUsd: order?.usd ?? null })
  return { reason, say }
}

/* ── the relays: join a submitted leg to the JOB that owns it ─────────── */

const LIVE_JOB = ['running', 'waiting_signature', 'waiting_settlement']

export interface RelayJoin {
  jobId: string
  seq: number
  ctx: ResolvedTenant
  step: { builder: string; params: unknown; kind: string; artifact: unknown; valueUsd: number | null }
}

/**
 * Find the tenant job step a relay is being asked to move — from the server's
 * OWN rows: live tenant jobs owned by `wallet` (the relay has already
 * authenticated it by signature where it can), their offered steps, the first
 * whose built artifact `match`es what was submitted. null = the submission is
 * not a tenant leg (a retail build of the same wallet stays retail).
 */
export async function joinTenantLeg(wallet: string, match: (artifact: Record<string, unknown>) => boolean): Promise<RelayJoin | null> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) return null
  const jobs = await prisma.job
    .findMany({
      where: { wallet: wallet.toLowerCase(), tenantId: { not: null }, status: { in: LIVE_JOB } },
      include: { steps: { where: { status: { in: ['offered', 'running'] } } } },
      orderBy: { createdAt: 'desc' },
      take: 25,
    })
    .catch(() => [])
  for (const job of jobs) {
    for (const s of job.steps) {
      const a = s.artifact && typeof s.artifact === 'object' && !Array.isArray(s.artifact) ? (s.artifact as Record<string, unknown>) : null
      if (!a || !match(a)) continue
      const ctx = await tenantContextForJob(job)
      if (!ctx) return null
      return { jobId: job.id, seq: s.seq, ctx, step: { builder: s.builder, params: s.params, kind: s.kind, artifact: s.artifact, valueUsd: s.valueUsd } }
    }
  }
  return null
}

/** Re-gate a joined relay leg with the ACTIVE policy. `liveUsd` (the relay's
 *  own fresh price) wins over the stored one; `network` is the relay's own
 *  testnet flag. null = allowed; otherwise the 403 body to answer. */
export async function relayGate(
  join: RelayJoin,
  relay: 'hl-submit' | 'cow-submit' | 'tx-refresh',
  live: { usd?: number | null; network?: 'mainnet' | 'testnet' } = {},
): Promise<{ error: string; reason: TenantRefusal } | null> {
  const o = orderOfLeg(join.step, join.ctx.deskId)
  const intent = await prisma.brokerIntent.findFirst({ where: { jobId: join.jobId }, select: { id: true } }).catch(() => null)
  if (!o) {
    const detail = `the desk cannot name the venue of leg ${join.seq + 1} (${join.step.builder}), and a tenant leg it cannot judge never moves.`
    await blot(join.ctx, 'refused', { relay, seq: join.seq, reason: 'VENUE_DENIED', detail }, { intentId: intent?.id ?? null, jobId: join.jobId })
    return { error: refusalSay(join.ctx, 'VENUE_DENIED', detail), reason: 'VENUE_DENIED' }
  }
  if (typeof live.usd === 'number' && Number.isFinite(live.usd)) o.usd = live.usd
  if (live.network) o.network = live.network
  const v = await tenantGate(join.ctx, o, { stage: 'relay', intentId: intent?.id ?? null, jobId: join.jobId, note: `${relay} leg ${join.seq}` })
  if (v.allowed && v.needsApproval) {
    const have = intent ? await approvalCount(intent.id) : 0
    if (have < v.approvers) {
      const detail = `this leg is over the desk's approval threshold and carries ${have} of ${v.approvers} admin approvals.`
      await blot(join.ctx, 'refused', { relay, seq: join.seq, reason: 'APPROVAL_PENDING', detail }, { intentId: intent?.id ?? null, jobId: join.jobId, venue: o.venue, chainId: o.chainId, valueUsd: o.usd })
      return { error: refusalSay(join.ctx, 'APPROVAL_PENDING', detail), reason: 'APPROVAL_PENDING' }
    }
  }
  if (v.allowed) return null
  await blot(join.ctx, 'refused', { relay, seq: join.seq, reason: v.reason, detail: v.detail }, { intentId: intent?.id ?? null, jobId: join.jobId, venue: o.venue, chainId: o.chainId, valueUsd: o.usd })
  return { error: refusalSay(join.ctx, v.reason, v.detail), reason: v.reason }
}

/* ── the link lane (tx/refresh only) ─────────────────────────────────────
 *
 * broker_handoff mints /i/<slug> for a human; the human's own chat turn builds
 * the leg, so no job row exists for a relay to join. The server records no
 * CoW order and no HL action per link (intent_link_expectations stores EVM
 * {to, selector} only), so /api/cow/submit and /api/hl/submit join NOTHING
 * for the link lane: such a submission is not gated, not refused and not
 * booked on the tenant's blotter — the intent was judged at handoff (QA B2:
 * a join by wallet let a free tenant refuse, or book, a stranger's orders).
 * tx/refresh is different: the recipe it rebuilds carries the linkSlug the
 * SERVER put there when it built the chain, so that rebuild is joined by
 * slug and re-gated (omitting it only skips a rebuild; the prebuilt calldata
 * was judged at handoff and is bounded by its own slippage). */

export interface LinkJoin {
  intentId: string
  linkSlug: string
  ctx: ResolvedTenant
  /** The order the LINK's ask compiles to (the policy judged it at handoff). */
  base: GateOrder
}

/** Join a rebuild to its tenant link by the slug the server-built recipe carries. */
export async function joinTenantLinkBySlug(slug: string, want: (o: GateOrder) => boolean): Promise<LinkJoin | null> {
  if (!slug) return null
  const row = await prisma.brokerIntent
    .findFirst({ where: { linkSlug: slug, tenantId: { not: null } }, select: { id: true, ask: true, plan: true, linkSlug: true, tenantId: true, deskKeyId: true } })
    .catch(() => null)
  if (!row?.tenantId || !row.linkSlug) return null
  const ctx = await tenantContextForJob(row)
  if (!ctx) return null
  const orders = ordersOfPlan({ ask: row.ask, venue: (row.plan as { venue?: unknown } | null)?.venue }, ctx.deskId) ?? []
  const base = orders.find(want)
  return base ? { intentId: row.id, linkSlug: row.linkSlug, ctx, base } : null
}

/** Re-gate a joined link rebuild with the ACTIVE policy (approvals counted).
 *  null = allowed; otherwise the 403 body, after a `refused` row. */
export async function linkGate(join: LinkJoin, relay: 'tx-refresh', leg: GateOrder): Promise<{ error: string; reason: TenantRefusal } | null> {
  const v = await tenantGate(join.ctx, leg, { stage: 'relay', intentId: join.intentId, note: `${relay} via link ${join.linkSlug}` })
  const refuse = async (reason: TenantRefusal, detail: string) => {
    await blot(join.ctx, 'refused', { relay, lane: 'human', linkSlug: join.linkSlug, reason, detail }, { intentId: join.intentId, venue: leg.venue, chainId: leg.chainId, valueUsd: leg.usd })
    return { error: refusalSay(join.ctx, reason, detail), reason }
  }
  if (!v.allowed) return refuse(v.reason, v.detail)
  if (v.needsApproval) {
    const have = await approvalCount(join.intentId)
    if (have < v.approvers) return refuse('APPROVAL_PENDING', `this leg is over the desk's approval threshold and carries ${have} of ${v.approvers} admin approvals.`)
  }
  return null
}

/* ── reserved spend: offered-but-unsettled legs (QA F6) ──────────────────
 *
 * The day cap reads BLOTTER's spentTodayUsd (signed rows) PLUS every leg the
 * desk put out for signature today that has not resolved: a `build` (ok) or
 * `offered` row whose job is still live and whose (job, leg) has no later
 * `signed` / `refused` / `settled` row, and a human-lane `offered` link whose
 * intent is still handed off with no later `signed` row. The latest offer of
 * a leg counts once. Throws when the blotter cannot be read (the gate then
 * refuses OVER_DAY, never a guessed $0). */

const LIVE_JOB_STATES = ['running', 'waiting_signature', 'waiting_settlement']
const CLOSING_KINDS = new Set(['signed', 'refused', 'settled'])

export async function openOffersUsd(tenantId: string, deskId: string, exclude: { intentId?: string | null; jobId?: string | null } = {}, now = new Date()): Promise<number> {
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const rows = await prisma.blotterRow.findMany({
    where: { tenantId, deskId, createdAt: { gte: dayStart }, kind: { in: ['build', 'offered', 'signed', 'refused', 'settled'] } },
    select: { seq: true, kind: true, jobId: true, intentId: true, valueUsd: true, payload: true },
    orderBy: { seq: 'asc' },
  })
  const open = new Map<string, { usd: number; jobId: string | null; intentId: string | null }>()
  for (const r of rows) {
    const p = (r.payload ?? {}) as { seq?: unknown; ok?: unknown; lane?: unknown }
    const legSeq = typeof p.seq === 'number' ? p.seq : null
    const key = r.jobId ? (legSeq != null ? `j:${r.jobId}:${legSeq}` : null) : r.intentId ? `i:${r.intentId}` : null
    if (!key) continue
    if (CLOSING_KINDS.has(r.kind)) {
      open.delete(key)
      continue
    }
    if (r.kind === 'build' && p.ok !== true) continue
    if (r.kind === 'offered' && !r.jobId && p.lane !== 'human') continue
    if (exclude.jobId && r.jobId === exclude.jobId) continue
    if (exclude.intentId && r.intentId === exclude.intentId) continue
    open.set(key, { usd: typeof r.valueUsd === 'number' && Number.isFinite(r.valueUsd) ? r.valueUsd : 0, jobId: r.jobId, intentId: r.intentId })
  }
  if (open.size === 0) return 0
  const jobIds = [...new Set([...open.values()].map((o) => o.jobId).filter((x): x is string => !!x))]
  const intentIds = [...new Set([...open.values()].filter((o) => !o.jobId).map((o) => o.intentId).filter((x): x is string => !!x))]
  const [liveJobs, liveLinks] = await Promise.all([
    jobIds.length ? prisma.job.findMany({ where: { id: { in: jobIds }, status: { in: LIVE_JOB_STATES } }, select: { id: true } }) : Promise.resolve([]),
    intentIds.length ? prisma.brokerIntent.findMany({ where: { id: { in: intentIds }, state: 'handed_off' }, select: { id: true } }) : Promise.resolve([]),
  ])
  const liveJob = new Set(liveJobs.map((j) => j.id))
  const liveLink = new Set(liveLinks.map((i) => i.id))
  let usd = 0
  for (const o of open.values()) {
    if (o.jobId ? liveJob.has(o.jobId) : o.intentId ? liveLink.has(o.intentId) : false) usd += o.usd
  }
  return Math.round(usd * 100) / 100
}

/* ── withdrawal: pause / revoke / refusal take back what is out (QA F3) ── */

/** Cancel a tenant's (or one key's) live jobs and wipe every offered or
 *  pending artifact to an explicit JSON null, and close + revoke its live
 *  handed-off links. One `refused` row per job withdrawn. Returns counts. */
export async function withdrawTenantOffers(scope: { tenantId: string; keyId?: string | null; deskId?: string | null }, reason: TenantRefusal, detail: string): Promise<{ jobs: number; links: number }> {
  const jobs = await prisma.job.findMany({
    where: { tenantId: scope.tenantId, ...(scope.keyId ? { deskKeyId: scope.keyId } : {}), status: { in: [...LIVE_JOB_STATES, 'paused'] } },
    select: { id: true, deskKeyId: true },
  })
  for (const j of jobs) {
    await prisma.jobStep.updateMany({ where: { jobId: j.id, status: { in: ['offered', 'pending', 'running'] } }, data: { artifact: Prisma.DbNull } })
    await prisma.jobStep.updateMany({ where: { jobId: j.id, status: 'offered' }, data: { status: 'pending' } })
    await prisma.job.update({ where: { id: j.id }, data: { status: 'canceled', failReason: `${reason}: ${detail}`.slice(0, 500) } })
    const intent = await prisma.brokerIntent.findFirst({ where: { jobId: j.id }, select: { id: true } })
    if (intent) await prisma.brokerIntent.update({ where: { id: intent.id }, data: { state: 'closed' } }).catch(() => {})
    await blot({ tenantId: scope.tenantId, keyId: j.deskKeyId ?? undefined, deskId: scope.deskId ?? undefined }, 'refused', { stage: 'withdraw', reason, detail }, { intentId: intent?.id ?? null, jobId: j.id })
  }
  const links = await prisma.brokerIntent.findMany({
    where: { tenantId: scope.tenantId, ...(scope.keyId ? { deskKeyId: scope.keyId } : {}), state: { in: ['handed_off', 'open', 'awaiting_approval'] }, linkSlug: { not: null } },
    select: { id: true, linkSlug: true, deskKeyId: true },
  })
  for (const l of links) {
    if (l.linkSlug) await prisma.intentLink.update({ where: { id: l.linkSlug }, data: { revoked: true } }).catch(() => {})
    await prisma.brokerIntent.update({ where: { id: l.id }, data: { state: 'closed' } }).catch(() => {})
    await blot({ tenantId: scope.tenantId, keyId: l.deskKeyId ?? undefined, deskId: scope.deskId ?? undefined }, 'refused', { stage: 'withdraw', lane: 'human', linkSlug: l.linkSlug, reason, detail }, { intentId: l.id })
  }
  return { jobs: jobs.length, links: links.length }
}

/**
 * The Jobs REST channel (`GET /api/jobs/:id?t=`): before a tenant job's
 * offered artifact is served, the tenant must be active, the key live, and
 * the leg admitted by the policy active NOW (gateTenantOffer — a refusal
 * fails the step, cancels the job and nulls the artifact). Returns the
 * refusal to answer with, or null to serve as is.
 */
export async function recheckTenantJob(job: { id: string; tenantId: string | null; deskKeyId: string | null; steps: { id: string; seq: number; builder: string; params: unknown; kind: string; status: string; artifact: unknown; valueUsd: number | null }[] }): Promise<{ reason: TenantRefusal; say: string } | null> {
  if (!job.tenantId) return null
  for (const step of job.steps) {
    if (step.status !== 'offered' || !step.artifact || typeof step.artifact !== 'object') continue
    const refused = await gateTenantOffer(job, step, { artifact: step.artifact as Record<string, unknown>, valueUsd: step.valueUsd })
    if (refused) return refused
  }
  return null
}
