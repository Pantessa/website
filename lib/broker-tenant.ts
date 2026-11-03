// lib/broker-tenant.ts — the agent desk's TENANT half (five-million, TENANT lane).
//
// The desk (/api/broker/mcp) has always been one door for every agent. A
// tenant — one firm's governed desk — walks through the same door holding a
// scoped desk key (`Authorization: Bearer dk_…`), and from that moment the
// desk answers to the tenant's ACTIVE policy, not to the retail rules:
//
//   · identity  — the key IS the agent identity: an intent a tenant opens is
//                 bound to `tenant:<keyId>`, whatever agent_key the caller
//                 typed, and only that key (same tenant, same key) may choose,
//                 hand off, execute, drive, close or read it. A retail caller
//                 can never touch a tenant intent; a tenant key can never
//                 drive a retail one.
//   · pause     — a paused key or tenant refuses every tool BY NAME
//                 (KEY_PAUSED / TENANT_PAUSED) except broker_status and
//                 broker_close, so an agent mid-flight can still look and
//                 walk away.
//   · the gate  — broker_open judges the plan; broker_choose the rewrite;
//                 broker_handoff and broker_execute re-judge with the policy
//                 active NOW and count approvals; broker_next judges the BUILT
//                 leg before it is served (lib/tenant/gate). A refusal is the
//                 desk's own words with `gate: 'policy'`; it never warns.
//
// A caller with no key, or a `yf_` key, never reaches anything in here: the
// retail desk is gated exactly as main today.

import prisma from '@/lib/db'
import { cancelJob, getJobWithSteps } from '@/lib/jobs-runner'
import type { CompiledJob } from '@/lib/jobs'
import { resolveDeskCaller, approvalCount, type DeskCaller, type ResolvedTenant } from '@/lib/tenant/store'
import { gateOrders, blot, refusalSay, TenantRefusedError, tenantGate, type GateStage, type PlanVerdict } from '@/lib/tenant/gate'
import type { TenantRefusal } from '@/lib/tenant/spec'
import { ordersOfCompiled, ordersOfPlan, orderOfLeg } from '@/lib/tenant/order'
import type { DeskDriveResult } from '@/lib/desk-drive'

const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.pantessa.com').replace(/\/$/, '')

/** Tools a paused key / tenant may still call. */
export const PAUSE_EXEMPT_TOOLS: ReadonlySet<string> = new Set(['broker_status', 'broker_close'])

/** The agent identity a tenant intent is bound to — the desk key's id, never
 *  a string the caller chose (spec: "agent_key for a tenant caller = the key
 *  id"). Shaped to survive lib/broker-policy cleanAgentKey. */
export function tenantAgentKey(ctx: Pick<ResolvedTenant, 'keyId'>): string {
  return `tenant:${ctx.keyId}`
}

/** The tenant summary an intent's plan carries (and the desk echoes). */
export interface PlanTenant {
  tenantId: string
  slug: string
  deskId: string
  policyVersion: number | null
  verdict: 'allowed' | 'refused'
  reason?: TenantRefusal
  detail?: string
  needsApproval?: boolean
  approvers?: number
  venues?: string[]
  usd?: number | null
}

/** Read the desk caller off an MCP tool callback's `extra`. */
export async function deskCaller(extra: unknown): Promise<DeskCaller> {
  const headers = (extra as { requestInfo?: { headers?: Record<string, string | string[] | undefined> } } | undefined)?.requestInfo?.headers
  return resolveDeskCaller(headers ?? null)
}

function refusal(reason: TenantRefusal, detail: string, ctx: Pick<ResolvedTenant, 'tenantSlug' | 'policyVersion' | 'deskId'> | null, extra: Record<string, unknown> = {}): TenantRefusedError {
  const say = ctx ? refusalSay(ctx, reason, detail) : `Refused — ${reason}: ${detail}`
  return new TenantRefusedError({ gate: 'policy', reason, detail, say, ...extra })
}

/** The door every tool walks through first: a dk_ key that does not resolve
 *  refuses (never falls back to retail); a paused key / tenant refuses every
 *  tool but status + close. Returns the tenant context, or null for retail. */
export async function usableCaller(caller: DeskCaller, tool: string): Promise<ResolvedTenant | null> {
  if (caller.kind === 'retail') return null
  if (caller.kind === 'refused') {
    // A revoked key still names its tenant: the attempt is the firm's record.
    if (caller.tenantId) await blot({ tenantId: caller.tenantId, deskId: caller.deskId, keyId: caller.keyId }, 'policy_verdict', { stage: 'door', tool, allowed: false, reason: caller.reason, detail: caller.detail })
    throw refusal(caller.reason, caller.detail, null)
  }
  const ctx = caller.ctx
  if (ctx.pausedBy && !PAUSE_EXEMPT_TOOLS.has(tool)) {
    const reason = ctx.pausedBy === 'key' ? 'KEY_PAUSED' : 'TENANT_PAUSED'
    const detail =
      ctx.pausedBy === 'key'
        ? `desk key ${ctx.keyId} is paused by a tenant admin — ${tool} refuses until it is resumed. broker_status and broker_close still answer.`
        : `the ${ctx.tenantSlug} desk is paused by its admins — ${tool} refuses until it is resumed. broker_status and broker_close still answer.`
    await blot(ctx, 'policy_verdict', { stage: 'door', tool, allowed: false, reason, detail, policyVersion: ctx.policyVersion })
    throw refusal(reason, detail, ctx)
  }
  return ctx
}

/** Tools a tenant desk does not offer in wave 1 (their sign side is a
 *  stranger's inbox / a portfolio link — nothing the policy can follow). */
export function assertTenantTool(ctx: ResolvedTenant | null, tool: string): void {
  if (!ctx) return
  if (tool === 'broker_send' || tool === 'broker_tile') {
    throw refusal('NOT_ON_TENANT_DESK', `${tool} is not available on a tenant desk — its sign side leaves the policy's sight. Use broker_open → broker_handoff or broker_execute.`, ctx)
  }
}

/** Who may act on an intent: a tenant intent only its own key; a retail
 *  intent never a tenant key. Returns the row's tenant binding. */
export async function assertIntentCaller(intentId: unknown, ctx: ResolvedTenant | null): Promise<{ tenantId: string | null; deskKeyId: string | null } | null> {
  const id = typeof intentId === 'string' ? intentId.trim() : ''
  if (!id) return null
  const row = await prisma.brokerIntent.findUnique({ where: { id }, select: { tenantId: true, deskKeyId: true } }).catch(() => null)
  if (!row) return null // the tool's own lookup answers "No such intent" by name
  if (row.tenantId) {
    if (!ctx || ctx.tenantId !== row.tenantId || ctx.keyId !== row.deskKeyId) {
      // Same words whether the intent exists for another tenant or another key:
      // a caller who cannot claim it learns nothing about it.
      throw refusal('TENANT_MISMATCH', `intent ${id} belongs to a tenant desk and answers only the desk key that opened it.`, ctx)
    }
  } else if (ctx) {
    throw refusal('NOT_ON_TENANT_DESK', `intent ${id} was opened on the retail desk — a tenant desk key acts only on intents it opened.`, ctx)
  }
  return row
}

/** A tenant may name a wallet only from its custody list (when it keeps one). */
export function assertSigner(ctx: ResolvedTenant, wallet: string | null | undefined): void {
  if (!wallet || ctx.signers.length === 0) return
  if (!ctx.signers.includes(wallet.toLowerCase())) {
    throw refusal('SIGNER_DENIED', `${wallet.toLowerCase()} is not one of the ${ctx.tenantSlug} desk's signers (${ctx.signers.length} on file) — a tenant leg is offered only to its own custody.`, ctx)
  }
}

/* ── the gate at each desk stage ─────────────────────────────────────── */

/** Judge a plan (open / choose). The plan carries the verdict; a refusal
 *  throws after the caller persisted the row (see broker-exec). */
export async function gatePlan(ctx: ResolvedTenant, plan: { ask: string; venue?: unknown }, stage: GateStage, intentId: string): Promise<PlanVerdict> {
  const orders = ordersOfPlan(plan, ctx.deskId)
  if (!orders) {
    const detail = `the desk could not compile "${plan.ask}" into a venue and chain the policy can judge, and a tenant desk refuses what it cannot judge — name the amount in dollars, the token and the chain (e.g. "Buy $25 of ETH on Base").`
    await blot(ctx, 'policy_verdict', { stage, allowed: false, reason: 'VENUE_DENIED', detail, policyVersion: ctx.policyVersion }, { intentId })
    return { allowed: false, needsApproval: false, approvers: 0, reason: 'VENUE_DENIED', detail, orders: 0, venues: [], usd: null }
  }
  return gateOrders(ctx, orders, { stage, intentId })
}

/** Judge a compiled job before any job row exists (broker_execute). */
export async function gateCompiled(ctx: ResolvedTenant, compiled: CompiledJob, intentId: string): Promise<PlanVerdict> {
  const orders = ordersOfCompiled(compiled, ctx.deskId)
  if (orders.length === 0) {
    const detail = 'the compiled job carries no leg the policy can judge, and a tenant desk refuses what it cannot judge.'
    await blot(ctx, 'policy_verdict', { stage: 'execute', allowed: false, reason: 'VENUE_DENIED', detail, policyVersion: ctx.policyVersion }, { intentId })
    return { allowed: false, needsApproval: false, approvers: 0, reason: 'VENUE_DENIED', detail, orders: 0, venues: [], usd: null }
  }
  return gateOrders(ctx, orders, { stage: 'execute', intentId })
}

/** The plan's tenant summary, from a verdict. */
export function planTenantOf(ctx: ResolvedTenant, v: PlanVerdict): PlanTenant {
  return {
    tenantId: ctx.tenantId,
    slug: ctx.tenantSlug,
    deskId: ctx.deskId,
    policyVersion: ctx.policyVersion,
    verdict: v.allowed ? 'allowed' : 'refused',
    ...(v.allowed ? {} : { reason: v.reason, detail: v.detail }),
    ...(v.allowed && v.needsApproval ? { needsApproval: true, approvers: v.approvers } : {}),
    venues: v.venues,
    usd: v.usd,
  }
}

/** The approval door an admin uses for an intent waiting on one. */
export function approveUrl(tenantId: string, intentId: string): string {
  return `${SITE}/api/tenants/${tenantId}/intents/${intentId}/approve`
}

/**
 * Re-judge a stored intent at handoff / execute with the ACTIVE policy and
 * count its approvals. On a refusal the intent lands `refused` (and its sign
 * link, if one was minted, is revoked) before the refusal throws; on a short
 * approval count it lands `awaiting_approval`.
 */
export async function regateIntent(
  ctx: ResolvedTenant,
  row: { id: string; ask: string; plan: unknown; linkSlug?: string | null },
  stage: 'handoff' | 'execute',
  compiled?: CompiledJob,
): Promise<PlanVerdict> {
  const venue = (row.plan as { venue?: unknown } | null)?.venue
  const v = compiled ? await gateCompiled(ctx, compiled, row.id) : await gatePlan(ctx, { ask: row.ask, venue }, stage, row.id)
  if (!v.allowed) {
    await prisma.brokerIntent
      .update({ where: { id: row.id }, data: { state: 'refused', plan: { ...(row.plan as object), tenant: planTenantOf(ctx, v) } as object } })
      .catch(() => {})
    if (row.linkSlug) await prisma.intentLink.update({ where: { id: row.linkSlug }, data: { revoked: true } }).catch(() => {})
    throw refusal(v.reason ?? 'VENUE_DENIED', v.detail ?? 'refused by the desk policy.', ctx, { intentId: row.id, state: 'refused' })
  }
  if (v.needsApproval) {
    const have = await approvalCount(row.id)
    if (have < v.approvers) {
      await prisma.brokerIntent
        .update({ where: { id: row.id }, data: { state: 'awaiting_approval', plan: { ...(row.plan as object), tenant: planTenantOf(ctx, v) } as object } })
        .catch(() => {})
      throw refusal(
        'APPROVAL_PENDING',
        `this order (~$${v.usd ?? '?'}) is over desk "${ctx.deskId}"'s approval threshold and carries ${have} of ${v.approvers} distinct admin approvals. An admin approves at POST ${approveUrl(ctx.tenantId, row.id)}; poll broker_status, then call ${stage === 'handoff' ? 'broker_handoff' : 'broker_execute'} again.`,
        ctx,
        { intentId: row.id, state: 'awaiting_approval', approvals: { have, needed: v.approvers } },
      )
    }
  }
  return v
}

/**
 * broker_next / broker_done: judge the leg the runner is about to serve. An
 * allowed leg writes one `offered` row per build (keyed by the step's build
 * time, so polling never floods the blotter); a refused leg cancels the job —
 * the Jobs API would otherwise keep serving it — lands the intent `refused`,
 * and throws. Wait answers pass through untouched.
 */
export async function gateServedLeg<T extends DeskDriveResult>(ctx: ResolvedTenant, out: T): Promise<T> {
  const leg = out.next.leg
  if (!leg) return out
  const job = await getJobWithSteps(out.jobId)
  const step = job?.steps.find((s) => s.seq === leg.seq)
  if (!job || !step) return out
  const order = orderOfLeg(step, ctx.deskId)
  const fail = async (reason: TenantRefusal, detail: string): Promise<never> => {
    await blot(ctx, 'refused', { stage: 'leg', seq: leg.seq, reason, detail }, { intentId: out.intentId, jobId: out.jobId, venue: order?.venue ?? null, chainId: order?.chainId ?? null, valueUsd: order?.usd ?? null })
    await cancelJob(out.jobId, out.wallet).catch(() => false)
    await prisma.brokerIntent.update({ where: { id: out.intentId }, data: { state: 'refused' } }).catch(() => {})
    throw refusal(reason, `${detail} Leg ${leg.seq + 1} was not served and the job is canceled.`, ctx, { intentId: out.intentId, state: 'refused', jobId: out.jobId, seq: leg.seq })
  }
  if (!order) return fail('VENUE_DENIED', `the desk cannot name the venue of leg ${leg.seq + 1} (${step.builder}), and a tenant leg it cannot judge is never served.`)
  const v = await tenantGate(ctx, order, { stage: 'leg', intentId: out.intentId, jobId: out.jobId, note: `leg ${leg.seq}` })
  if (!v.allowed) return fail(v.reason, v.detail)
  if (v.needsApproval) {
    const have = await approvalCount(out.intentId)
    if (have < v.approvers) return fail('APPROVAL_PENDING', `the built leg (~$${order.usd ?? '?'}) is over desk "${ctx.deskId}"'s approval threshold and carries ${have} of ${v.approvers} admin approvals.`)
  }
  const offerKey = `${leg.seq}:${new Date(step.updatedAt).getTime()}`
  const seen = await prisma.blotterRow
    .findFirst({ where: { tenantId: ctx.tenantId, kind: 'offered', jobId: out.jobId, payload: { path: ['offerKey'], equals: offerKey } }, select: { id: true } })
    .catch(() => null)
  if (!seen) {
    await blot(
      ctx,
      'offered',
      { lane: 'agent', seq: leg.seq, kind: leg.kind, summary: leg.summary.slice(0, 200), offerKey, policyVersion: ctx.policyVersion },
      { intentId: out.intentId, jobId: out.jobId, venue: v.rule.venue, chainId: order.chainId, valueUsd: order.usd },
    )
  }
  return out
}

export type { ResolvedTenant }
