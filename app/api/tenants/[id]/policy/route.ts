// /api/tenants/:id/policy — propose a policy version (TENANT lane, maker-checker).
//
// POST { document, note? } by a tenant admin: the document is validated
// against the spec (lib/tenant/policy validatePolicyDoc — an unknown venue,
// op, chain, side or field, a malformed desk id, a chain outside the venue's
// own VENUE_CHAINS each refuse with 400 NAMING the field), then stored as
// version max+1 in state `proposed`. Nothing trades on it until it is
// approved (…/policy/:version/approve) — by a DIFFERENT admin when the
// owner's plan has the approvals entitlement, by the proposer otherwise.
// GET  the versions, newest first, documents included.
import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import prisma from '@/lib/db'
import { getSessionAddress } from '@/lib/auth'
import { canonicalJson } from '@/lib/tenant/spec'
import { validatePolicyDoc } from '@/lib/tenant/policy'
import { planName, tenantEntitlements, tenantForAdmin } from '@/lib/tenant/store'
import { cheapestPlanAllowing, planAllows } from '@/lib/tenant/entitlements'
import { blot } from '@/lib/tenant/gate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params
  const gate = await tenantForAdmin(id, await getSessionAddress())
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const rows = await prisma.tenantPolicy.findMany({ where: { tenantId: id }, orderBy: { version: 'desc' }, take: 50 })
  return NextResponse.json({
    policies: rows.map((r) => ({ version: r.version, state: r.state, document: r.document, proposedBy: r.proposedBy, approvedBy: r.approvedBy, note: r.note, createdAt: r.createdAt, activatedAt: r.activatedAt })),
  })
}

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params
  const gate = await tenantForAdmin(id, await getSessionAddress())
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>

  const v = validatePolicyDoc(body.document)
  if (!v.ok) return NextResponse.json({ error: v.error, field: v.field }, { status: 400 })
  const { plan } = await tenantEntitlements(gate.tenant)
  const makerChecker = planAllows(plan, 'approvals')
  if (v.doc.hooks && (v.doc.hooks.preTrade || v.doc.hooks.postTrade) && !planAllows(plan, 'hooks')) {
    const upgrade = cheapestPlanAllowing('hooks')
    return NextResponse.json({ error: `Pre/post-trade hooks are not in the ${plan} plan — they need ${planName(upgrade)}.`, entitlement: 'hooks', field: 'hooks', plan, upgrade }, { status: 403 })
  }
  const note = typeof body.note === 'string' ? body.note.replace(/\s+/g, ' ').trim().slice(0, 280) || null : null

  // version = max + 1; a concurrent proposal that took the same number loses
  // the unique (tenant_id, version) race and retries once.
  let row = null
  for (let attempt = 0; attempt < 3 && !row; attempt++) {
    const last = await prisma.tenantPolicy.findFirst({ where: { tenantId: id }, orderBy: { version: 'desc' }, select: { version: true } })
    try {
      row = await prisma.tenantPolicy.create({
        data: { tenantId: id, version: (last?.version ?? 0) + 1, state: 'proposed', document: v.doc as object, proposedBy: gate.addr, note },
      })
    } catch (e) {
      if (!/Unique constraint/i.test(e instanceof Error ? e.message : String(e))) throw e
    }
  }
  if (!row) return NextResponse.json({ error: 'Another proposal landed at the same moment — propose again.' }, { status: 409 })

  const docHash = createHash('sha256').update(canonicalJson(v.doc)).digest('hex')
  await blot({ tenantId: id }, 'policy_proposed', { version: row.version, proposedBy: gate.addr, docHash, venues: v.doc.venues.map((r) => r.venue), desks: v.doc.desks.map((d) => d.id), ...(note ? { note } : {}) })

  return NextResponse.json(
    {
      version: row.version,
      state: row.state,
      document: v.doc,
      docHash,
      next: makerChecker
        ? `A DIFFERENT admin approves it at POST /api/tenants/${id}/policy/${row.version}/approve (maker-checker); until then the active policy stands.`
        : `Approve it at POST /api/tenants/${id}/policy/${row.version}/approve — your ${plan} plan has no maker-checker, so the proposer may activate it.`,
    },
    { status: 201 },
  )
}
