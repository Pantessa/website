// /api/tenants/:id — read and edit one governed desk (TENANT lane).
//
// GET   any admin: the tenant, its ACTIVE policy, every policy version (state
//       only — documents ride on the policy route), its desk keys (never a
//       hash or a secret), and what the owner's plan lets it do.
// PATCH any admin: { name, signingLane, status: 'active'|'paused', sandbox }
//       — `sandbox: false` only when the owner's plan includes mainnet;
//       OWNER only: { admins, signers } (who may approve, and which custody
//       wallets a leg may be offered to — an admin cannot widen either).
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getSessionAddress } from '@/lib/auth'
import { SIGNING_LANES } from '@/lib/tenant/spec'
import { activePolicy, deskKeyView, lowerList, planName, tenantEntitlements, tenantForAdmin, tenantView } from '@/lib/tenant/store'
import { cheapestPlanAllowing, entitlementsJson, planAllows } from '@/lib/tenant/entitlements'
import { blot, withdrawTenantOffers } from '@/lib/tenant/gate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }
const WALLET_RE = /^0x[0-9a-fA-F]{40}$/

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params
  const gate = await tenantForAdmin(id, await getSessionAddress())
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const { plan, ent } = await tenantEntitlements(gate.tenant)
  const [active, versions, keys] = await Promise.all([
    activePolicy(id),
    prisma.tenantPolicy.findMany({ where: { tenantId: id }, orderBy: { version: 'desc' }, take: 50, select: { version: true, state: true, proposedBy: true, approvedBy: true, note: true, createdAt: true, activatedAt: true } }),
    prisma.deskKey.findMany({ where: { tenantId: id }, orderBy: { createdAt: 'desc' }, take: 100 }),
  ])
  return NextResponse.json({
    tenant: { ...tenantView(gate.tenant), plan },
    entitlements: entitlementsJson(ent),
    policy: active ? { version: active.version, document: active.doc } : null,
    versions,
    keys: keys.map(deskKeyView),
    you: { address: gate.addr, owner: gate.isOwner },
  })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params
  const gate = await tenantForAdmin(id, await getSessionAddress())
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const data: { name?: string; signingLane?: string; status?: string; sandbox?: boolean; admins?: string[]; signers?: string[] } = {}

  if ('name' in body) {
    const name = typeof body.name === 'string' ? body.name.replace(/\s+/g, ' ').trim().slice(0, 80) : ''
    if (!name) return NextResponse.json({ error: 'name must be a non-empty string.', field: 'name' }, { status: 400 })
    data.name = name
  }
  if ('signingLane' in body) {
    if (typeof body.signingLane !== 'string' || !(SIGNING_LANES as readonly string[]).includes(body.signingLane)) {
      return NextResponse.json({ error: `signingLane must be one of ${SIGNING_LANES.join(', ')}.`, field: 'signingLane' }, { status: 400 })
    }
    data.signingLane = body.signingLane
  }
  if ('status' in body) {
    if (body.status !== 'active' && body.status !== 'paused') return NextResponse.json({ error: "status must be 'active' or 'paused'.", field: 'status' }, { status: 400 })
    data.status = body.status
  }
  if ('sandbox' in body) {
    if (typeof body.sandbox !== 'boolean') return NextResponse.json({ error: 'sandbox must be a boolean.', field: 'sandbox' }, { status: 400 })
    if (body.sandbox === false) {
      const { plan } = await tenantEntitlements(gate.tenant)
      if (!planAllows(plan, 'mainnet')) {
        const upgrade = cheapestPlanAllowing('mainnet')
        return NextResponse.json({ error: `Leaving the sandbox (mainnet chains) is not in the ${plan} plan — it needs ${planName(upgrade)}.`, entitlement: 'mainnet', plan, upgrade }, { status: 403 })
      }
    }
    data.sandbox = body.sandbox
  }
  for (const field of ['admins', 'signers'] as const) {
    if (!(field in body)) continue
    if (!gate.isOwner) return NextResponse.json({ error: `Only the tenant owner edits ${field}.`, field }, { status: 403 })
    const raw = body[field]
    if (!Array.isArray(raw) || raw.length > 50 || !raw.every((w) => typeof w === 'string' && WALLET_RE.test(w))) {
      return NextResponse.json({ error: `${field} must be an array of up to 50 0x wallet addresses.`, field }, { status: 400 })
    }
    const list = [...new Set(raw.map((w) => (w as string).toLowerCase()))]
    if (field === 'signers') {
      // QA B1: a signer is ADDED only with its own proof of control (GET
      // …/signers/challenge, then POST …/signers with the signature). PATCH
      // may only REMOVE signers.
      const current = new Set(lowerList(gate.tenant.signers))
      const added = list.filter((w) => !current.has(w))
      if (added.length) {
        return NextResponse.json(
          { error: `signers are added only with a proof of control: GET /api/tenants/${id}/signers/challenge?address=<0x…>, sign the text with that wallet (personal_sign, or EIP-1271 for a Safe), then POST /api/tenants/${id}/signers. PATCH may only remove signers (not on file: ${added.join(', ')}).`, field, reason: 'SIGNER_DENIED' },
          { status: 400 },
        )
      }
    }
    data[field] = field === 'admins' ? list.filter((w) => w !== gate.tenant.ownerAddress.toLowerCase()) : list
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'Nothing to change — send name, signingLane, status, sandbox, admins or signers.' }, { status: 400 })
  }
  const before = gate.tenant
  const tenant = await prisma.tenant.update({ where: { id }, data })
  // Every state change on a tenant desk is a blotter row: a pause / resume on
  // its own kind, everything else (name, lane, sandbox, admins, signers) as
  // one tenant_updated row naming each field before → after.
  if (data.status !== undefined && data.status !== before.status) {
    await blot({ tenantId: id }, data.status === 'paused' ? 'tenant_paused' : 'tenant_resumed', { by: gate.addr, from: before.status, to: data.status })
    // QA F3: a pause withdraws what is out — live jobs canceled, offered
    // artifacts nulled, live handed-off links revoked.
    if (data.status === 'paused') await withdrawTenantOffers({ tenantId: id }, 'TENANT_PAUSED', `the ${before.slug} desk was paused by ${gate.addr}.`)
  }
  const changes: Record<string, { from: unknown; to: unknown }> = {}
  const was: Record<string, unknown> = { name: before.name, signingLane: before.signingLane, sandbox: before.sandbox, admins: lowerList(before.admins), signers: lowerList(before.signers) }
  for (const k of ['name', 'signingLane', 'sandbox', 'admins', 'signers'] as const) {
    if (data[k] !== undefined && JSON.stringify(data[k]) !== JSON.stringify(was[k])) changes[k] = { from: was[k], to: data[k] }
  }
  if (Object.keys(changes).length) await blot({ tenantId: id }, 'tenant_updated', { by: gate.addr, changes })
  return NextResponse.json({ tenant: tenantView(tenant) })
}
