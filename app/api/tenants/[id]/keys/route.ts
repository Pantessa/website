// /api/tenants/:id/keys — scoped desk keys (TENANT lane).
//
// POST { deskId, label? } by a tenant admin mints `dk_…`: bound to this
// tenant and ONE desk id that must exist in the ACTIVE policy, so a key can
// never widen what the policy admits. Only the sha256 is stored; the secret
// is in this response and nowhere else. Live keys per tenant are capped by
// the owner's plan (revoked keys do not count).
// GET  the keys (prefix, desk, paused, last use — never a hash).
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getSessionAddress } from '@/lib/auth'
import { DESK_ID_RE } from '@/lib/tenant/spec'
import { activePolicy, deskKeyView, generateDeskKey, planName, tenantEntitlements, tenantForAdmin } from '@/lib/tenant/store'
import { capAllows, cheapestPlanForCap } from '@/lib/tenant/entitlements'
import { blot } from '@/lib/tenant/gate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params
  const gate = await tenantForAdmin(id, await getSessionAddress())
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const keys = await prisma.deskKey.findMany({ where: { tenantId: id }, orderBy: { createdAt: 'desc' }, take: 200 })
  return NextResponse.json({ keys: keys.map(deskKeyView) })
}

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params
  const gate = await tenantForAdmin(id, await getSessionAddress())
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>

  const deskId = typeof body.deskId === 'string' ? body.deskId.trim() : ''
  if (!DESK_ID_RE.test(deskId)) return NextResponse.json({ error: 'deskId must be a desk id from the active policy (lowercase letters, digits, dashes).', field: 'deskId' }, { status: 400 })
  const active = await activePolicy(id)
  if (!active) return NextResponse.json({ error: 'This tenant has no ACTIVE policy yet — propose one and approve it before minting keys.', reason: 'NO_POLICY' }, { status: 409 })
  if (!active.doc.desks.some((d) => d.id === deskId)) {
    return NextResponse.json(
      { error: `Desk "${deskId}" is not in the active policy (v${active.version} desks: ${active.doc.desks.map((d) => d.id).join(', ')}).`, field: 'deskId', reason: 'DESK_UNKNOWN' },
      { status: 400 },
    )
  }
  const { plan, ent } = await tenantEntitlements(gate.tenant)
  const live = await prisma.deskKey.count({ where: { tenantId: id, revokedAt: null } })
  if (!capAllows(plan, 'keysPerTenant', live)) {
    const upgrade = cheapestPlanForCap('keysPerTenant', live + 1)
    return NextResponse.json(
      {
        error: `Your ${plan} plan includes ${ent.keysPerTenant} live desk key${ent.keysPerTenant === 1 ? '' : 's'} per tenant, and this tenant has ${live}. Revoke one, or ${live + 1} keys need ${planName(upgrade)}.`,
        entitlement: 'keysPerTenant',
        limit: Number.isFinite(ent.keysPerTenant) ? ent.keysPerTenant : null,
        plan,
        upgrade,
      },
      { status: 403 },
    )
  }
  const label = typeof body.label === 'string' && body.label.trim() ? body.label.replace(/\s+/g, ' ').trim().slice(0, 60) : 'Desk key'
  const minted = generateDeskKey()
  const key = await prisma.deskKey.create({ data: { tenantId: id, deskId, label, hash: minted.hash, prefix: minted.prefix } })
  await blot({ tenantId: id, deskId, keyId: key.id }, 'key_minted', { keyId: key.id, prefix: key.prefix, deskId, label, mintedBy: gate.addr, policyVersion: active.version })
  return NextResponse.json(
    {
      ...deskKeyView(key),
      secret: minted.secret,
      note: 'Shown once — store it now. An agent presents it as `Authorization: Bearer <secret>` on /api/broker/mcp; every order it opens answers to this tenant\'s active policy for this desk.',
    },
    { status: 201 },
  )
}
