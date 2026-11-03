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
  let spent = 0
  let spendUnreadable = false
  try {
    spent = await spentTodayUsd(ctx.tenantId, order.deskId)
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
      if (ctx.sandbox && order.network === 'mainnet' && venue === 'hyperliquid') {
        return { allowed: false, reason: 'SANDBOX_ONLY', detail: 'this tenant is in the sandbox — the leg targets Hyperliquid MAINNET. Testnet legs trade here; mainnet opens with a plan that includes it.' }
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
  await prisma.jobStep.update({ where: { id: step.id }, data: { status: 'failed', artifact: undefined, result: { error: say, policyRefused: reason } as object } })
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

/* ── the link lane: a leg signed through a desk-minted LINK (no job) ─────
 *
 * broker_handoff mints /i/<slug> for a human; the human's own chat turn builds
 * the leg, so no job row exists for a relay to join. What the server DOES own:
 * the tenant-scoped broker_intents row (its linkSlug, its wallet — the signer
 * the tenant's agent named at open — and the tenant's own `signers` list, set
 * by the owner). A submission from a wallet the TENANT named, while one of its
 * handed-off links is live and that link's ask compiles to an order of the
 * same venue/chain/coin, is that tenant's leg: it is re-gated with the ACTIVE
 * policy, and (because no runner books it) its `signed` row is written here.
 * Never a body claim: the join reads only rows the tenant (or the desk) wrote.
 * The tx/refresh lane joins by the recipe's own linkSlug (the server built it;
 * omitting it only skips a REBUILD — the prebuilt calldata was gated at
 * handoff and is bounded by its own slippage). */

const LINK_STATES = ['handed_off', 'signed']
/** A sign link's binding window (the expectations table's, lib/link-receipt-verify). */
const LINK_WINDOW_MS = 7 * 24 * 3600 * 1000

export interface LinkJoin {
  intentId: string
  linkSlug: string
  ctx: ResolvedTenant
  /** The order the LINK's ask compiles to (the policy judged it at handoff). */
  base: GateOrder
  join: 'intent-wallet' | 'tenant-signer' | 'link-slug'
}

type LinkRow = { id: string; ask: string; plan: unknown; wallet: string | null; linkSlug: string | null; tenantId: string | null; deskKeyId: string | null }
const LINK_SELECT = { id: true, ask: true, plan: true, wallet: true, linkSlug: true, tenantId: true, deskKeyId: true } as const

async function linkJoinOf(row: LinkRow, want: (o: GateOrder) => boolean, join: LinkJoin['join']): Promise<LinkJoin | null> {
  if (!row.tenantId || !row.linkSlug) return null
  const ctx = await tenantContextForJob(row)
  if (!ctx) return null
  const orders = ordersOfPlan({ ask: row.ask, venue: (row.plan as { venue?: unknown } | null)?.venue }, ctx.deskId) ?? []
  const base = orders.find(want)
  return base ? { intentId: row.id, linkSlug: row.linkSlug, ctx, base, join } : null
}

/** Join a relay submission from `wallet` to a live tenant LINK (see above). */
export async function joinTenantLink(wallet: string, want: (o: GateOrder) => boolean): Promise<LinkJoin | null> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) return null
  const w = wallet.toLowerCase()
  const signerOf = await prisma.tenant.findMany({ where: { signers: { array_contains: [w] } }, select: { id: true } }).catch(() => [])
  const rows = await prisma.brokerIntent
    .findMany({
      where: {
        tenantId: { not: null },
        linkSlug: { not: null },
        state: { in: LINK_STATES },
        updatedAt: { gte: new Date(Date.now() - LINK_WINDOW_MS) },
        OR: [{ wallet: w }, ...(signerOf.length ? [{ tenantId: { in: signerOf.map((t) => t.id) } }] : [])],
      },
      orderBy: { updatedAt: 'desc' },
      take: 20,
      select: LINK_SELECT,
    })
    .catch(() => [] as LinkRow[])
  for (const row of rows) {
    const j = await linkJoinOf(row, want, row.wallet === w ? 'intent-wallet' : 'tenant-signer')
    if (j) return j
  }
  return null
}

/** Join by the link slug a server-built recipe carries (tx/refresh). */
export async function joinTenantLinkBySlug(slug: string, want: (o: GateOrder) => boolean): Promise<LinkJoin | null> {
  if (!slug) return null
  const row = await prisma.brokerIntent.findFirst({ where: { linkSlug: slug, tenantId: { not: null } }, select: LINK_SELECT }).catch(() => null)
  return row ? linkJoinOf(row, want, 'link-slug') : null
}

/** Re-gate a link-lane leg with the ACTIVE policy (approvals counted). null =
 *  allowed; otherwise the 403 body, after a `refused` row. */
export async function linkGate(join: LinkJoin, relay: 'hl-submit' | 'cow-submit' | 'tx-refresh', leg: GateOrder): Promise<{ error: string; reason: TenantRefusal } | null> {
  const v = await tenantGate(join.ctx, leg, { stage: 'relay', intentId: join.intentId, note: `${relay} via link ${join.linkSlug} (${join.join})` })
  const refuse = async (reason: TenantRefusal, detail: string) => {
    await blot(join.ctx, 'refused', { relay, lane: 'human', linkSlug: join.linkSlug, join: join.join, reason, detail }, { intentId: join.intentId, venue: leg.venue, chainId: leg.chainId, valueUsd: leg.usd })
    return { error: refusalSay(join.ctx, reason, detail), reason }
  }
  if (!v.allowed) return refuse(v.reason, v.detail)
  if (v.needsApproval) {
    const have = await approvalCount(join.intentId)
    if (have < v.approvers) return refuse('APPROVAL_PENDING', `this leg is over the desk's approval threshold and carries ${have} of ${v.approvers} admin approvals.`)
  }
  return null
}

/** The `signed` row for a link-lane leg the venue ACCEPTED — the one place
 *  that books it (no runner owns it; BLOTTER's beacon path books only
 *  chain-VERIFIED EVM turns, and a CoW/HL turn never verifies there).
 *  `attested`: the venue accepted the wallet's signature; no chain receipt. */
export async function bookLinkSigned(
  join: LinkJoin,
  relay: 'hl-submit' | 'cow-submit',
  leg: GateOrder,
  e: { valueUsd: number | null; feeBps?: number | null; txHash?: string | null; payload: Record<string, unknown> },
): Promise<void> {
  const feeUsd = e.valueUsd != null && e.feeBps != null ? Math.round(e.valueUsd * e.feeBps) / 10_000 : null
  await blot(
    join.ctx,
    'signed',
    { lane: 'human', relay, linkSlug: join.linkSlug, join: join.join, op: leg.op, tokens: leg.tokens, side: leg.side, policyVersion: join.ctx.policyVersion, ...e.payload },
    { intentId: join.intentId, venue: leg.venue, chainId: leg.chainId, valueUsd: e.valueUsd, feeBps: e.feeBps ?? null, feeUsd, txHash: e.txHash ?? null, verification: 'attested' },
  )
}
