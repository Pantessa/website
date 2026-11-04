// POST /api/tenants/:id/intents/:intentId/approve — an admin approves an
// over-threshold desk intent (TENANT lane).
//
// The desk's policy says an order over a desk's `approvals.overUsd` needs N
// DISTINCT admin approvals before it is handed off or executed. One row per
// (intent, admin) — a second press by the same admin is a no-op answered
// 409. When the count reaches N the intent returns to `open` and the agent's
// next broker_handoff / broker_execute proceeds (both re-judge it with the
// ACTIVE policy and count again).
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getSessionAddress } from '@/lib/auth'
import { approvalCount, tenantForAdmin } from '@/lib/tenant/store'
import { blot } from '@/lib/tenant/gate'
import type { PlanTenant } from '@/lib/broker-tenant'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string; intentId: string }> }

export async function POST(_req: NextRequest, { params }: Params) {
  const { id, intentId } = await params
  const gate = await tenantForAdmin(id, await getSessionAddress())
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const intent = await prisma.brokerIntent.findUnique({ where: { id: intentId } }).catch(() => null)
  if (!intent || intent.tenantId !== id) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  const t = (intent.plan as { tenant?: PlanTenant } | null)?.tenant
  if (intent.state === 'refused' || intent.state === 'closed') {
    return NextResponse.json({ error: `Intent ${intentId} is ${intent.state} — there is nothing to approve.`, state: intent.state }, { status: 409 })
  }
  if (!t?.needsApproval) {
    return NextResponse.json({ error: `Intent ${intentId} is under the desk's approval threshold — it needs no approval.`, state: intent.state }, { status: 409 })
  }
  const needed = t.approvers ?? 1
  try {
    await prisma.tenantApproval.create({ data: { tenantId: id, intentId, approver: gate.addr } })
  } catch (e) {
    if (/Unique constraint/i.test(e instanceof Error ? e.message : String(e))) {
      const have = await approvalCount(intentId)
      return NextResponse.json({ error: `${gate.addr} already approved intent ${intentId} — approvals count DISTINCT admins.`, approvals: { have, needed } }, { status: 409 })
    }
    throw e
  }
  const have = await approvalCount(intentId)
  const satisfied = have >= needed
  if (satisfied && intent.state === 'awaiting_approval') {
    await prisma.brokerIntent.update({ where: { id: intentId }, data: { state: 'open' } })
  }
  await blot(
    { tenantId: id, deskId: t.deskId, keyId: intent.deskKeyId ?? undefined },
    'approval',
    { approver: gate.addr, have, needed, satisfied, ask: intent.ask, policyVersion: t.policyVersion },
    { intentId, valueUsd: typeof t.usd === 'number' ? t.usd : null },
  )
  return NextResponse.json({
    intentId,
    approvals: { have, needed },
    satisfied,
    state: satisfied && intent.state === 'awaiting_approval' ? 'open' : intent.state,
    next: satisfied ? 'The agent may now call broker_handoff or broker_execute; both re-judge the intent with the active policy.' : `${needed - have} more distinct admin approval${needed - have === 1 ? '' : 's'} needed.`,
  })
}
