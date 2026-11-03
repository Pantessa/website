// POST /api/tenants/:id/policy/:version/approve — activate a proposed policy
// (TENANT lane, the checker half of maker-checker).
//
// A tenant admin approves a version in state `proposed`. When the owner's
// plan has the approvals entitlement the approver must be a DIFFERENT admin
// than the proposer; otherwise the proposer may activate it. The previous
// active version becomes `superseded` in the same transaction, so a tenant
// never has two policies (or none) mid-switch.
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getSessionAddress } from '@/lib/auth'
import { tenantEntitlements, tenantForAdmin } from '@/lib/tenant/store'
import { planAllows } from '@/lib/tenant/entitlements'
import { blot } from '@/lib/tenant/gate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string; version: string }> }

export async function POST(_req: NextRequest, { params }: Params) {
  const { id, version: raw } = await params
  const gate = await tenantForAdmin(id, await getSessionAddress())
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const version = /^\d{1,6}$/.test(raw) ? Number(raw) : NaN
  if (!Number.isInteger(version)) return NextResponse.json({ error: 'version must be an integer.' }, { status: 400 })

  const row = await prisma.tenantPolicy.findUnique({ where: { tenantId_version: { tenantId: id, version } } })
  if (!row) return NextResponse.json({ error: `No policy version ${version}.` }, { status: 404 })
  if (row.state !== 'proposed') return NextResponse.json({ error: `Version ${version} is ${row.state} — only a proposed version is approved.`, state: row.state }, { status: 409 })

  const { plan } = await tenantEntitlements(gate.tenant)
  const makerChecker = planAllows(plan, 'approvals')
  if (makerChecker && row.proposedBy.toLowerCase() === gate.addr) {
    return NextResponse.json(
      { error: `Maker-checker: ${gate.addr} proposed version ${version}, so a DIFFERENT tenant admin must approve it.`, entitlement: 'approvals', plan },
      { status: 403 },
    )
  }

  const now = new Date()
  const previous = await prisma.tenantPolicy.findFirst({ where: { tenantId: id, state: 'active' }, orderBy: { version: 'desc' }, select: { version: true } })
  const activated = await prisma.$transaction(async (tx) => {
    // Re-read under the transaction: a concurrent approve/reject of the same
    // version must not activate it twice.
    const claimed = await tx.tenantPolicy.updateMany({ where: { id: row.id, state: 'proposed' }, data: { state: 'active', approvedBy: gate.addr, activatedAt: now } })
    if (claimed.count !== 1) return false
    await tx.tenantPolicy.updateMany({ where: { tenantId: id, state: 'active', NOT: { id: row.id } }, data: { state: 'superseded' } })
    return true
  })
  if (!activated) return NextResponse.json({ error: `Version ${version} changed state while you approved it — reload.` }, { status: 409 })

  await blot({ tenantId: id }, 'policy_activated', {
    version,
    approvedBy: gate.addr,
    proposedBy: row.proposedBy,
    selfApproved: row.proposedBy.toLowerCase() === gate.addr,
    makerChecker,
    ...(previous ? { superseded: previous.version } : {}),
  })
  return NextResponse.json({ version, state: 'active', approvedBy: gate.addr, activatedAt: now, ...(previous ? { superseded: previous.version } : {}) })
}
